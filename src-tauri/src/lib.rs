mod cloudflare_manager;
mod commands;
mod config;
mod helpers;
mod proxy;
mod ssh_manager;
mod state;
mod types;
mod utils;

use crate::cloudflare_manager::CloudflareManager;
use crate::config::{get_auth_path, load_config};
use crate::helpers::migration::migrate_to_split_storage;
use crate::ssh_manager::SshManager;
use crate::state::AppState;
use crate::types::{AuthStatus, CopilotStatus, ProxyStatus};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

/// Get management key from config (used for internal proxy API calls)
pub(crate) fn get_management_key() -> String {
    load_config().management_key
}

// Windows-specific imports for hiding CMD windows
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// Windows CREATE_NO_WINDOW flag
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// GPT-5 base models that support reasoning level suffixes (single source of truth)
// Used by both backend (proxy config generation) and frontend (Settings UI)
pub(crate) const GPT5_BASE_MODELS: &[&str] = &[
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-codex",
    "gpt-5-codex-mini",
    "gpt-5.1",
    "gpt-5.1-codex",
    "gpt-5.1-codex-mini",
    "gpt-5.1-codex-max",
    "gpt-5.2",
    "gpt-5.2-codex",
    "gpt-5.3-codex",
    "gpt-5.3-codex-spark",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.5",
    "gpt-5.5-fast",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.6-sol",
];

// GPT-5 reasoning level suffixes supported by all configured GPT-5 aliases.
pub(crate) const GPT5_REASONING_SUFFIXES: &[&str] = &["minimal", "low", "medium", "high", "xhigh"];

// CLIProxyAPI exposes max and ultra reasoning only for GPT-5.6 variants.
pub(crate) const GPT56_REASONING_SUFFIXES: &[&str] =
    &["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

pub(crate) fn gpt5_reasoning_suffixes(model: &str) -> &'static [&'static str] {
    if model.starts_with("gpt-5.6-") {
        GPT56_REASONING_SUFFIXES
    } else {
        GPT5_REASONING_SUFFIXES
    }
}

// Load auth status from file
pub(crate) fn load_auth_status() -> AuthStatus {
    let path = get_auth_path();
    if path.exists() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(auth) = serde_json::from_str(&data) {
                return auth;
            }
        }
    }
    AuthStatus::default()
}

// Save auth status to file
pub(crate) fn save_auth_to_file(auth: &AuthStatus) -> Result<(), String> {
    let path = get_auth_path();
    let data = serde_json::to_string_pretty(auth).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

// Handle deep link OAuth callback
fn handle_deep_link(app: &tauri::AppHandle, urls: Vec<url::Url>) {
    for url in urls {
        if url.scheme() == "proxypal" && url.path() == "/oauth/callback" {
            // Parse query parameters
            let params: std::collections::HashMap<_, _> = url.query_pairs().collect();

            if let (Some(code), Some(state)) = (params.get("code"), params.get("state")) {
                // Verify state and get provider from pending OAuth
                let app_state = app.state::<AppState>();
                let pending = app_state.pending_oauth.lock().unwrap().clone();

                if let Some(oauth) = pending {
                    if oauth.state == state.as_ref() {
                        // Emit event to frontend
                        let _ = app.emit(
                            "oauth-callback",
                            serde_json::json!({
                                "provider": oauth.provider,
                                "code": code.as_ref()
                            }),
                        );
                    }
                }
            }

            // Bring window to front
            show_main_window(app);
        }
    }
}

// macOS tray-app lifecycle helpers. Per Tauri best practices (see
// https://dev.to/hiyoyok/complete-guide-to-building-a-macos-menu-bar-app-with-tauri-v2-aji
// and Tauri 2.10 AppHandle docs):
//   show → set_dock_visibility(true) + app.show() + window.show + focus
//   hide → window.hide() + app.hide() + set_dock_visibility(false)
// app.show()/hide() call NSApplication.show()/hide() so the app vanishes
// from Mission Control and the app switcher when in tray, and WKWebView
// backing store refills on show (fixes black window).

// Show the main window and focus it. On macOS, reveals the Dock icon,
// restores NSApplication (fixing WKWebView stale backing store), then
// unminimizes, shows, and focuses the window.
#[allow(dead_code)]
fn show_main_window(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_dock_visibility(true);
        let _ = app.show();
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// Hide the main window and, on macOS, the whole NSApplication.
// Removes the Dock icon and hides from Mission Control / app switcher.
#[allow(dead_code)]
fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = app.hide();
        let _ = app.set_dock_visibility(false);
    }
}

// Setup system tray
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let toggle_item = MenuItem::with_id(app, "toggle", "Toggle Proxy", true, None::<&str>)?;
    let dashboard_item = MenuItem::with_id(app, "dashboard", "Open Dashboard", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit ProxyPal", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&toggle_item, &dashboard_item, &quit_item])?;

    // Use dedicated tray icon (22x22 @1x, 44x44 @2x for retina)
    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon@2x.png"))
        .expect("Failed to load tray icon");

    // icon_as_template is macOS-only (renders icon as template image for dark/light mode).
    // On Windows/Linux the concept doesn't exist — calling it causes a transparent/invisible tray icon.
    #[allow(unused_mut)]
    let mut tray_builder = TrayIconBuilder::new().icon(tray_icon);
    #[cfg(target_os = "macos")]
    {
        tray_builder = tray_builder.icon_as_template(true);
    }
    let _tray = tray_builder
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("ProxyPal - Proxy stopped")
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "toggle" => {
                let app_state = app.state::<AppState>();
                let is_running = app_state.proxy_status.lock().unwrap().running;

                // Emit toggle event to frontend
                let _ = app.emit("tray-toggle-proxy", !is_running);
            }
            "dashboard" => {
                show_main_window(app);
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                show_main_window(app);
            }
        })
        .build(app)?;

    Ok(())
}

// Helper to build HTTP client for Management API
// Uses no_proxy() to prevent local 127.0.0.1 requests from being
// routed through the user's system proxy (which causes 502 errors)
pub(crate) fn build_management_client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

// Helper to get Management API base URL
pub(crate) fn get_management_url(port: u16, endpoint: &str) -> String {
    format!("http://127.0.0.1:{}/v0/management/{}", port, endpoint)
}

// Check if auto-updater is supported on this platform/install type
// Linux .deb installations do NOT support auto-update (only AppImage does)
#[tauri::command]
fn is_updater_supported() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "linux")]
    {
        // On Linux, check if running as AppImage (APPIMAGE env var is set)
        let is_appimage = std::env::var("APPIMAGE").is_ok();
        Ok(serde_json::json!({
            "supported": is_appimage,
            "reason": if is_appimage {
                "AppImage supports auto-update"
            } else {
                "Auto-update is only supported for AppImage installations. Please download the new version manually from GitHub Releases."
            }
        }))
    }
    #[cfg(not(target_os = "linux"))]
    {
        // Windows and macOS support auto-update
        Ok(serde_json::json!({
            "supported": true,
            "reason": "Auto-update supported"
        }))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Migrate old format to split storage on first run
    migrate_to_split_storage();

    // Clean up any orphaned clipproxyapi processes from previous crashes
    #[cfg(unix)]
    {
        println!("[ProxyPal] Cleaning up orphaned clipproxyapi processes on startup");
        let _ = std::process::Command::new("sh")
            .args(["-c", "pkill -9 -f clipproxyapi 2>/dev/null"])
            .spawn()
            .and_then(|mut child| child.wait());
    }
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", "taskkill /F /IM clipproxyapi*.exe 2>nul"]);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.spawn().and_then(|mut child| child.wait());
    }

    // Load persisted config and auth
    let config = load_config();
    let auth = load_auth_status();

    let app_state = AppState {
        proxy_status: Mutex::new(ProxyStatus::default()),
        auth_status: Mutex::new(auth),
        config: Mutex::new(config),
        pending_oauth: Mutex::new(None),
        proxy_process: Mutex::new(None),
        copilot_status: Mutex::new(CopilotStatus::default()),
        copilot_process: Mutex::new(None),
        log_watcher_running: Arc::new(AtomicBool::new(false)),
        usage_queue_collector_gen: Arc::new(AtomicU64::new(0)),
        request_counter: Arc::new(AtomicU64::new(0)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Handle deep links when app is already running
            let urls: Vec<url::Url> = args
                .iter()
                .filter_map(|arg| url::Url::parse(arg).ok())
                .collect();
            if !urls.is_empty() {
                handle_deep_link(app, urls);
            }

            // Show existing window
            show_main_window(app);
        }))
        .manage(app_state)
        .manage(SshManager::new())
        .manage(CloudflareManager::new())
        .setup(|app| {
            // Setup system tray
            #[cfg(desktop)]
            setup_tray(app)?;

            // Register deep link handler for when app is already running
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls: Vec<url::Url> = event.urls().to_vec();
                    if !urls.is_empty() {
                        handle_deep_link(&handle, urls);
                    }
                });
            }

            // Auto-start SSH connections
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let config = crate::config::load_config();
                let ssh_manager = app_handle.state::<SshManager>();
                for ssh_config in config.ssh_configs {
                    if ssh_config.enabled {
                        ssh_manager.connect(app_handle.clone(), ssh_config);
                    }
                }
            });

            // Auto-start Cloudflare tunnels
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let config = crate::config::load_config();
                let cf_manager = app_handle.state::<CloudflareManager>();
                for cf_config in config.cloudflare_configs {
                    if cf_config.enabled {
                        println!("[Cloudflare] Auto-starting tunnel: {}", cf_config.name);
                        cf_manager.connect(app_handle.clone(), cf_config);
                    }
                }
            });

            // Auto-start Copilot if enabled
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let config = crate::config::load_config();
                if config.copilot.enabled {
                    println!("[Copilot] Auto-starting copilot-api...");
                    // Small delay to let the app fully initialize
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    let state = app_handle.state::<AppState>();
                    match commands::copilot::start_copilot(app_handle.clone(), state).await {
                        Ok(status) => println!(
                            "[Copilot] Auto-start successful: running={}",
                            status.running
                        ),
                        Err(e) => eprintln!("[Copilot] Auto-start failed: {}", e),
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::proxy::get_proxy_status,
            commands::models::get_gpt_reasoning_models,
            commands::proxy::start_proxy,
            commands::proxy::stop_proxy,
            // Copilot Management
            commands::copilot::get_copilot_status,
            commands::copilot::start_copilot,
            commands::copilot::stop_copilot,
            commands::copilot::check_copilot_health,
            commands::copilot::detect_copilot_api,
            commands::copilot::install_copilot_api,
            // Auth & OAuth
            commands::auth::get_auth_status,
            commands::auth::refresh_auth_status,
            commands::auth::open_oauth,
            commands::auth::get_oauth_url,
            commands::auth::get_device_code,
            commands::auth::open_url_in_browser,
            commands::auth::poll_oauth_status,
            commands::auth::complete_oauth,
            commands::auth::disconnect_provider,
            commands::quota::fetch_antigravity_quota,
            commands::quota::fetch_codex_quota,
            commands::quota::fetch_copilot_quota,
            commands::quota::fetch_claude_quota,
            commands::quota::fetch_kiro_quota,
            commands::quota::test_kiro_connection,
            commands::quota::import_vertex_credential,
            commands::config::get_config,
            commands::config::save_config,
            commands::config::get_config_yaml,
            commands::config::save_config_yaml,
            commands::config::reload_config,
            commands::proxy::get_system_proxy,
            // CLI Agent & IDE Tool detection
            commands::agents::detect_ai_tools,
            commands::agents::configure_continue,
            commands::agents::get_tool_setup_info,
            commands::agents::detect_cli_agents,
            commands::agents::configure_cli_agent,
            commands::agents::get_shell_profile_path,
            commands::agents::append_to_shell_profile,
            // Usage & Analytics
            commands::usage::get_usage_stats,
            commands::usage::get_request_history,
            // Provider Health Check
            commands::health::check_provider_health,
            commands::usage::add_request_to_history,
            commands::usage::clear_request_history,
            commands::usage::sync_usage_from_proxy,
            commands::usage::export_usage_stats,
            commands::usage::import_usage_stats,
            commands::models::get_available_models,
            commands::models::test_openai_provider,
            commands::models::test_provider_connection,
            commands::models::fetch_openai_compatible_models,
            // API Keys Management
            commands::api_keys::get_gemini_api_keys,
            commands::api_keys::set_gemini_api_keys,
            commands::api_keys::add_gemini_api_key,
            commands::api_keys::delete_gemini_api_key,
            commands::api_keys::get_claude_api_keys,
            commands::api_keys::set_claude_api_keys,
            commands::api_keys::add_claude_api_key,
            commands::api_keys::delete_claude_api_key,
            commands::api_keys::get_codex_api_keys,
            commands::api_keys::set_codex_api_keys,
            commands::api_keys::add_codex_api_key,
            commands::api_keys::delete_codex_api_key,
            commands::api_keys::get_xai_api_keys,
            commands::api_keys::set_xai_api_keys,
            commands::api_keys::add_xai_api_key,
            commands::api_keys::delete_xai_api_key,
            commands::api_keys::get_vertex_api_keys,
            commands::api_keys::set_vertex_api_keys,
            commands::api_keys::add_vertex_api_key,
            commands::api_keys::delete_vertex_api_key,
            // Thinking Budget Settings
            commands::settings::get_thinking_budget_settings,
            commands::settings::set_thinking_budget_settings,
            // Reasoning Effort Settings (GPT/Codex)
            commands::settings::get_reasoning_effort_settings,
            commands::settings::set_reasoning_effort_settings,
            commands::api_keys::get_openai_compatible_providers,
            commands::api_keys::set_openai_compatible_providers,
            commands::api_keys::add_openai_compatible_provider,
            commands::api_keys::delete_openai_compatible_provider,
            // Auth Files Management
            commands::auth_files::get_auth_files,
            commands::auth_files::upload_auth_file,
            commands::auth_files::delete_auth_file,
            commands::auth_files::toggle_auth_file,
            commands::auth_files::download_auth_file,
            commands::auth_files::delete_all_auth_files,
            commands::auth_files::batch_delete_auth_files,
            commands::auth_files::verify_proxy_auth_status,
            // Log Viewer
            commands::logs::get_logs,
            commands::logs::clear_logs,
            // Management API Settings
            commands::settings::get_max_retry_interval,
            commands::settings::set_max_retry_interval,
            commands::settings::get_log_size,
            commands::settings::set_log_size,
            commands::settings::get_websocket_auth,
            commands::settings::set_websocket_auth,
            // Window behavior
            commands::settings::get_close_to_tray,
            commands::settings::set_close_to_tray,
            // Claude Code Settings
            commands::settings::get_claude_code_settings,
            commands::models::set_claude_code_model,
            // Updater support check
            is_updater_supported,
            // SSH
            commands::ssh::get_ssh_configs,
            commands::ssh::save_ssh_config,
            commands::ssh::delete_ssh_config,
            commands::ssh::set_ssh_connection,
            // Cloudflare Tunnel
            commands::cloudflare::get_cloudflare_configs,
            commands::cloudflare::save_cloudflare_config,
            commands::cloudflare::delete_cloudflare_config,
            commands::cloudflare::set_cloudflare_connection,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                tauri::RunEvent::WindowEvent {
                    label,
                    event: win_event,
                    ..
                } => {
                    // Handle close button based on close_to_tray setting
                    if label == "main" {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = win_event {
                            // Check if close_to_tray is enabled
                            let close_to_tray = app_handle
                                .try_state::<AppState>()
                                .map(|state| state.config.lock().unwrap().close_to_tray)
                                .unwrap_or(true);

                            if close_to_tray {
                                // Hide to tray instead of closing
                                println!("[ProxyPal] Hiding to system tray...");
                                hide_main_window(app_handle);
                                api.prevent_close();
                            }
                            // If close_to_tray is false, allow normal close behavior
                        }
                    }
                }
                tauri::RunEvent::ExitRequested { .. } => {
                    // Cleanup: Kill proxy and copilot processes before exit
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        // Stop background threads
                        state.log_watcher_running.store(false, Ordering::SeqCst);
                        // Invalidate usage-queue collector (generation bump stops the thread)
                        state
                            .usage_queue_collector_gen
                            .fetch_add(1, Ordering::SeqCst);

                        // Kill cliproxyapi process
                        if let Ok(mut process_guard) = state.proxy_process.lock() {
                            if let Some(child) = process_guard.take() {
                                println!("[ProxyPal] Shutting down cliproxyapi...");
                                let _ = child.kill();
                            }
                        }
                        // Kill copilot-api process
                        if let Ok(mut process_guard) = state.copilot_process.lock() {
                            if let Some(child) = process_guard.take() {
                                println!("[ProxyPal] Shutting down copilot-api...");
                                let _ = child.kill();
                            }
                        }
                    }

                    // Cleaning up SSH connections
                    if let Some(ssh_manager) = app_handle.try_state::<SshManager>() {
                        ssh_manager.disconnect_all();
                    }
                }
                _ => {}
            }
        });
}

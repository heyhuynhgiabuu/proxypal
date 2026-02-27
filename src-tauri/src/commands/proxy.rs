use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;

use crate::config::AppConfig;
use crate::state::AppState;
use crate::types::ProxyStatus;
use crate::helpers::log_watcher::start_log_watcher;
use crate::get_management_key;
use crate::GPT5_BASE_MODELS;
use crate::GPT5_REASONING_SUFFIXES;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use env_proxy;
use sysproxy::Sysproxy;
use url::Url;

const DEFAULT_PROXY_CHECK_URL: &str = "https://example.com";

fn env_proxy_for_url(target_url: &str) -> Option<String> {
    let parsed = Url::parse(target_url).ok()?;
    let proxy = env_proxy::for_url(&parsed);
    let (host, port) = proxy.host_port()?;
    Some(format!("http://{}:{}", host, port))
}

fn normalize_system_proxy(host: &str, port: u16) -> String {
    let protocol = if host.to_ascii_lowercase().contains("socks") {
        "socks5"
    } else {
        "http"
    };
    format!("{}://{}:{}", protocol, host, port)
}

#[tauri::command]
pub fn get_system_proxy() -> Result<Option<String>, String> {
    // 1. Check environment variables first (common in Linux/Dev environments)
    // We use a neutral URL to avoid region-specific assumptions.
    if let Some(proxy) = env_proxy_for_url(DEFAULT_PROXY_CHECK_URL) {
        return Ok(Some(proxy));
    }

    // 2. Check OS-level system proxy settings
    let sys_proxy = Sysproxy::get_system_proxy();

    match sys_proxy {
        Ok(proxy) if proxy.enable => Ok(Some(normalize_system_proxy(&proxy.host, proxy.port))),
        Ok(_) => Ok(None),
        Err(e) => Err(format!("Failed to detect system proxy: {}", e)),
    }
}

/// Build the complete proxy-config.yaml content from AppConfig.
/// Includes all provider configs, API keys, routing, payload injection,
/// and appends user customizations from proxy-config-custom.yaml.
fn build_proxy_config_yaml(config: &AppConfig, config_dir: &std::path::Path) -> Result<String, String> {
    let proxy_url_line = build_proxy_url_line(config);
    let amp_api_key_line = build_amp_api_key_line(config);
    let amp_model_mappings_section = build_amp_model_mappings_section(config);
    let openai_compat_section = build_openai_compat_section(config);
    let claude_api_key_section = build_claude_api_key_section(config);
    let gemini_api_key_section = build_gemini_api_key_section(config);
    let codex_api_key_section = build_codex_api_key_section(config);
    let vertex_api_key_section = build_vertex_api_key_section(config);
    let (thinking_budget, thinking_mode_display) = resolve_thinking_budget(config);
    let payload_section = build_payload_section(config, thinking_budget, thinking_mode_display);
    let routing_section = format!(
        "# Routing strategy for multiple API keys\nrouting:\n  strategy: \"{}\"\n\n",
        config.routing_strategy
    );

    let mut proxy_config = format!(
        r#"# ProxyPal generated config
port: {}
auth-dir: "~/.cli-proxy-api"
api-keys:
  - "{}"
debug: {}
usage-statistics-enabled: {}
logging-to-file: {}
logs-max-total-size-mb: {}
request-retry: {}
max-retry-interval: {}
{}
# Quota exceeded behavior
quota-exceeded:
  switch-project: {}
  switch-preview-model: {}

# Enable Management API for OAuth flows
remote-management:
  allow-remote: true
  secret-key: "{}"
  disable-control-panel: {}

{}{}{}{}{}{}{}# Amp CLI Integration - enables amp login and management routes
# See: https://help.router-for.me/agent-client/amp-cli.html
# Get API key from: https://ampcode.com/settings
ampcode:
  upstream-url: "https://ampcode.com"
{}
{}
  restrict-management-to-localhost: false
  force-model-mappings: {}

# Additional settings
request-log: {}
commercial-mode: {}
ws-auth: {}
"#,
        config.port,
        config.proxy_api_key,
        config.debug,
        config.usage_stats_enabled,
        config.logging_to_file,
        config.logs_max_total_size_mb,
        config.request_retry,
        config.max_retry_interval,
        proxy_url_line,
        config.quota_switch_project,
        config.quota_switch_preview_model,
        config.management_key,
        config.disable_control_panel,
        openai_compat_section,
        claude_api_key_section,
        gemini_api_key_section,
        codex_api_key_section,
        vertex_api_key_section,
        routing_section,
        payload_section,
        amp_api_key_line,
        amp_model_mappings_section,
        config.force_model_mappings,
        config.request_logging,
        config.commercial_mode,
        config.ws_auth
    );

    // Append user customizations from proxy-config-custom.yaml if it exists
    let custom_config_path = config_dir.join("proxy-config-custom.yaml");
    if custom_config_path.exists() {
        if let Ok(custom_yaml) = std::fs::read_to_string(&custom_config_path) {
            if !custom_yaml.trim().is_empty() {
                proxy_config.push_str("\n# User customizations (from proxy-config-custom.yaml)\n");
                proxy_config.push_str(&custom_yaml);
                proxy_config.push('\n');
            }
        }
    }

    Ok(proxy_config)
}

fn build_proxy_url_line(config: &AppConfig) -> String {
    let mut effective_proxy_url = if config.use_system_proxy {
        get_system_proxy().ok().flatten().unwrap_or_default()
    } else {
        config.proxy_url.clone()
    };

    if effective_proxy_url.is_empty() {
        return String::new();
    }

    if !config.proxy_username.is_empty() && !config.proxy_password.is_empty() {
        if let Ok(mut url) = url::Url::parse(&effective_proxy_url) {
            let _ = url.set_username(&config.proxy_username);
            let _ = url.set_password(Some(&config.proxy_password));
            effective_proxy_url = url.to_string();
        }
    }
    format!("proxy-url: \"{}\"\n", effective_proxy_url)
}

fn build_amp_api_key_line(config: &AppConfig) -> String {
    if config.amp_api_key.is_empty() {
        "  # upstream-api-key: \"\"  # Set your Amp API key from https://ampcode.com/settings".to_string()
    } else {
        format!("  upstream-api-key: \"{}\"", config.amp_api_key)
    }
}

fn build_amp_model_mappings_section(config: &AppConfig) -> String {
    let enabled_mappings: Vec<_> = config.amp_model_mappings.iter()
        .filter(|m| m.enabled)
        .collect();

    if enabled_mappings.is_empty() {
        "  # model-mappings:  # Optional: map Amp model requests to different models\n  #   - from: claude-opus-4-5-20251101\n  #     to: your-preferred-model".to_string()
    } else {
        let mut mappings = String::from("  model-mappings:");
        for mapping in &enabled_mappings {
            mappings.push_str(&format!("\n    - from: {}\n      to: {}", mapping.name, mapping.alias));
            if mapping.fork {
                mappings.push_str("\n      fork: true");
            }
        }
        mappings
    }
}

fn build_openai_compat_section(config: &AppConfig) -> String {
    let mut entries = Vec::new();

    // Custom providers
    for provider in &config.amp_openai_providers {
        if !provider.name.is_empty() && !provider.base_url.is_empty() && !provider.api_key.is_empty() {
            let mut entry = format!("  # Custom OpenAI-compatible provider: {}\n", provider.name);
            entry.push_str(&format!("  - name: \"{}\"\n", provider.name));
            entry.push_str(&format!("    base-url: \"{}\"\n", provider.base_url));
            entry.push_str("    schema-cleaner: true\n");
            entry.push_str("    api-key-entries:\n");
            entry.push_str(&format!("      - api-key: \"{}\"\n", provider.api_key));

            if !provider.models.is_empty() {
                entry.push_str("    models:\n");
                for model in &provider.models {
                    entry.push_str(&format!("      - alias: \"{}\"\n", model.alias));
                    entry.push_str(&format!("        name: \"{}\"\n", model.name));
                }
            }
            entries.push(entry);
        }
    }

    // Copilot OpenAI-compatible entry
    if config.copilot.enabled {
        entries.push(build_copilot_openai_entry(&config.copilot));
    }

    if entries.is_empty() {
        String::new()
    } else {
        let mut section = String::from("# OpenAI-compatible providers\nopenai-compatibility:\n");
        for entry in entries {
            section.push_str(&entry);
        }
        section.push('\n');
        section
    }
}

fn build_copilot_openai_entry(copilot: &crate::types::copilot::CopilotConfig) -> String {
    let port = copilot.port;
    let mut entry = String::from("  # GitHub Copilot GPT/OpenAI models (via copilot-api)\n");
    entry.push_str("  - name: \"copilot\"\n");
    entry.push_str(&format!("    base-url: \"http://localhost:{}/v1\"\n", port));
    entry.push_str("    schema-cleaner: true\n");
    entry.push_str("    api-key-entries:\n");
    entry.push_str("      - api-key: \"dummy\"\n");
    entry.push_str("    models:\n");

    // OpenAI GPT models
    entry.push_str("      - alias: \"gpt-4.1\"\n");
    entry.push_str("        name: \"gpt-4.1\"\n");

    // GPT-5 models with reasoning suffixes
    for model in GPT5_BASE_MODELS {
        entry.push_str(&format!("      - alias: \"{}\"\n", model));
        entry.push_str(&format!("        name: \"{}\"\n", model));
        for suffix in GPT5_REASONING_SUFFIXES {
            let suffixed = format!("{}({})", model, suffix);
            entry.push_str(&format!("      - alias: \"{}\"\n", suffixed));
            entry.push_str(&format!("        name: \"{}\"\n", suffixed));
        }
    }

    // Legacy OpenAI models
    for name in ["gpt-4o", "gpt-4", "gpt-4-turbo", "o1", "o1-mini"] {
        entry.push_str(&format!("      - alias: \"{}\"\n", name));
        entry.push_str(&format!("        name: \"{}\"\n", name));
    }

    // xAI, fine-tuned, Gemini, Claude models
    let extra_models = [
        "grok-code-fast-1", "raptor-mini",
        "gemini-2.5-pro", "gemini-3-pro-preview", "gemini-3.1-pro-high", "gemini-3.1-pro-low",
        "claude-haiku-4.5", "claude-opus-4.1", "claude-sonnet-4", "claude-sonnet-4.5",
        "claude-opus-4.5", "claude-opus-4.6",
    ];
    for name in extra_models {
        entry.push_str(&format!("      - alias: \"{}\"\n", name));
        entry.push_str(&format!("        name: \"{}\"\n", name));
    }

    entry
}

fn build_claude_api_key_section(config: &AppConfig) -> String {
    let mut entries: Vec<String> = Vec::new();
    for key in &config.claude_api_keys {
        let mut entry = format!("  - api-key: \"{}\"\n", key.api_key);
        if let Some(ref base_url) = key.base_url {
            entry.push_str(&format!("    base-url: \"{}\"\n", base_url));
        }
        if let Some(ref proxy_url) = key.proxy_url {
            if !proxy_url.is_empty() {
                entry.push_str(&format!("    proxy-url: \"{}\"\n", proxy_url));
            }
        }
        entries.push(entry);
    }

    if entries.is_empty() {
        String::new()
    } else {
        let mut section = String::from("# Claude API keys\nclaude-api-key:\n");
        for entry in entries {
            section.push_str(&entry);
        }
        section.push('\n');
        section
    }
}

fn build_gemini_api_key_section(config: &AppConfig) -> String {
    if config.gemini_api_keys.is_empty() {
        return String::new();
    }
    let mut section = String::from("# Gemini API keys\ngemini-api-key:\n");
    for key in &config.gemini_api_keys {
        section.push_str(&format!("  - api-key: \"{}\"\n", key.api_key));
        section.push_str("    signature-cache: false\n");
        if let Some(ref base_url) = key.base_url {
            section.push_str(&format!("    base-url: \"{}\"\n", base_url));
        }
        if let Some(ref proxy_url) = key.proxy_url {
            if !proxy_url.is_empty() {
                section.push_str(&format!("    proxy-url: \"{}\"\n", proxy_url));
            }
        }
    }
    section.push('\n');
    section
}

fn build_codex_api_key_section(config: &AppConfig) -> String {
    if config.codex_api_keys.is_empty() {
        return String::new();
    }
    let mut section = String::from("# Codex API keys\ncodex-api-key:\n");
    for key in &config.codex_api_keys {
        section.push_str(&format!("  - api-key: \"{}\"\n", key.api_key));
        if let Some(ref base_url) = key.base_url {
            section.push_str(&format!("    base-url: \"{}\"\n", base_url));
        }
        if let Some(ref proxy_url) = key.proxy_url {
            if !proxy_url.is_empty() {
                section.push_str(&format!("    proxy-url: \"{}\"\n", proxy_url));
            }
        }
    }
    section.push('\n');
    section
}

fn build_vertex_api_key_section(config: &AppConfig) -> String {
    if config.vertex_api_keys.is_empty() {
        return String::new();
    }
    let mut section = String::from("# Vertex API keys\nvertex-api-key:\n");
    for key in &config.vertex_api_keys {
        section.push_str(&format!("  - api-key: \"{}\"\n", key.api_key));
        if let Some(ref project_id) = key.project_id {
            if !project_id.is_empty() {
                section.push_str(&format!("    project-id: \"{}\"\n", project_id));
            }
        }
        if let Some(ref location) = key.location {
            if !location.is_empty() {
                section.push_str(&format!("    location: \"{}\"\n", location));
            }
        }
        if let Some(ref base_url) = key.base_url {
            if !base_url.is_empty() {
                section.push_str(&format!("    base-url: \"{}\"\n", base_url));
            }
        }
        if let Some(ref prefix) = key.prefix {
            if !prefix.is_empty() {
                section.push_str(&format!("    prefix: \"{}\"\n", prefix));
            }
        }
    }
    section.push('\n');
    section
}

fn resolve_thinking_budget(config: &AppConfig) -> (u32, &str) {
    let mode = if config.thinking_budget_mode.is_empty() {
        "medium"
    } else {
        &config.thinking_budget_mode
    };
    let custom = if config.thinking_budget_custom == 0 { 16000 } else { config.thinking_budget_custom };
    let budget = match mode {
        "low" => 2048,
        "medium" => 8192,
        "high" => 32768,
        "custom" => custom,
        _ => 8192,
    };
    (budget, mode)
}

fn build_payload_section(config: &AppConfig, thinking_budget: u32, thinking_mode_display: &str) -> String {
    let gemini3_thinking_level = match thinking_budget {
        2048 => "low",
        8192 => "medium",
        _ => "high",
    };

    let gemini_override_section = if config.gemini_thinking_injection {
        build_gemini_override_section(gemini3_thinking_level)
    } else {
        String::new()
    };

    format!(r#"# Payload injection for thinking models
# Antigravity Claude: Thinking budget mode: {} ({} tokens)
# Gemini 3: Thinking injection: {}
payload:
  default:
    # Antigravity Claude models - thinking budget
    - models:
        - name: "claude-sonnet-4-5"
          protocol: "claude"
        - name: "claude-sonnet-4-5-thinking"
          protocol: "claude"
        - name: "gemini-claude-sonnet-4-5"
          protocol: "claude"
        - name: "gemini-claude-sonnet-4-5-thinking"
          protocol: "claude"
      params:
        "thinking.budget_tokens": {}
    - models:
        - name: "claude-opus-4-5"
          protocol: "claude"
        - name: "claude-opus-4-5-thinking"
          protocol: "claude"
        - name: "gemini-claude-opus-4-5"
          protocol: "claude"
        - name: "gemini-claude-opus-4-5-thinking"
          protocol: "claude"
        - name: "claude-opus-4-6"
          protocol: "claude"
        - name: "claude-opus-4-6-thinking"
          protocol: "claude"
        - name: "gemini-claude-opus-4-6"
          protocol: "claude"
        - name: "gemini-claude-opus-4-6-thinking"
          protocol: "claude"
      params:
        "thinking.budget_tokens": {}
{}
"#,
        thinking_mode_display,
        thinking_budget,
        if config.gemini_thinking_injection { format!("enabled ({})", gemini3_thinking_level) } else { "disabled".to_string() },
        thinking_budget,
        thinking_budget,
        gemini_override_section
    )
}

fn build_gemini_override_section(thinking_level: &str) -> String {
    format!(r#"  override:
    # Gemini 3 models - thinking level
    - models:
        - name: "gemini-3-pro-preview*"
      params:
        generationConfig.thinkingConfig.thinkingLevel: "{0}"
    - models:
        - name: "gemini-3-flash-preview*"
      params:
        generationConfig.thinkingConfig.thinkingLevel: "{0}"
    - models:
        - name: "gemini-3.1-pro-high*"
      params:
        generationConfig.thinkingConfig.thinkingLevel: "high"
    - models:
        - name: "gemini-3.1-pro-low*"
      params:
        generationConfig.thinkingConfig.thinkingLevel: "low"
    - models:
        - name: "gemini-3-pro-high"
      params:
        generationConfig.thinkingConfig.thinkingLevel: "high"
    - models:
        - name: "gemini-3-pro-low"
      params:
        generationConfig.thinkingConfig.thinkingLevel: "low"
    - models:
        - name: "gemini-3-flash"
      params:
        generationConfig.thinkingConfig.thinkingLevel: "{0}"
"#, thinking_level)
}

// Tauri commands
#[tauri::command]
pub fn get_proxy_status(state: State<AppState>) -> ProxyStatus {
    state.proxy_status.lock().unwrap().clone()
}

#[tauri::command]
pub async fn start_proxy(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ProxyStatus, String> {
    let config = state.config.lock().unwrap().clone();
    
    // Check if already running (according to our tracked state)
    {
        let status = state.proxy_status.lock().unwrap();
        if status.running {
            return Ok(status.clone());
        }
    }

    // Kill any existing tracked proxy process first
    {
        let mut process = state.proxy_process.lock().unwrap();
        if let Some(child) = process.take() {
            println!("[ProxyPal] Killing tracked proxy process");
            let _ = child.kill(); // Ignore errors, process might already be dead
        }
    }

    // Kill any external process using our port (handles orphaned processes from previous runs)
    let port = config.port;
    #[cfg(unix)]
    {
        // Kill by port
        println!("[ProxyPal] Killing any process on port {}", port);
        let _ = std::process::Command::new("sh")
            .args(["-c", &format!("lsof -ti :{} | xargs kill -9 2>/dev/null", port)])
            .output();
        
        // Also kill any orphaned cliproxyapi processes by name
        println!("[ProxyPal] Killing any orphaned cliproxyapi processes");
        let _ = std::process::Command::new("sh")
            .args(["-c", "pkill -9 -f cliproxyapi 2>/dev/null"])
            .output();
    }
    #[cfg(windows)]
    {
        // On Windows, use netstat and taskkill for port (hidden window)
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", &format!("for /f \"tokens=5\" %a in ('netstat -aon ^| findstr :{} ^| findstr LISTENING') do taskkill /F /PID %a 2>nul", port)]);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.output();
        
        // Also kill by process name on Windows (hidden window)
        let mut cmd2 = std::process::Command::new("cmd");
        cmd2.args(["/C", "taskkill /F /IM cliproxyapi*.exe 2>nul"]);
        #[cfg(target_os = "windows")]
        cmd2.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd2.output();
    }

    // Longer delay to ensure port is fully released
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // Create config directory and config file for CLIProxyAPI
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("proxypal");
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    
    let proxy_config_path = config_dir.join("proxy-config.yaml");

    // Build YAML config and append user customizations
    let proxy_config = build_proxy_config_yaml(&config, &config_dir)?;
    std::fs::write(&proxy_config_path, proxy_config).map_err(|e| e.to_string())?;

    // Spawn the sidecar process with WRITABLE_PATH set to app config dir
    // This prevents CLIProxyAPI from writing logs to src-tauri/logs/ which triggers hot reload
    let sidecar = app
        .shell()
        .sidecar("cli-proxy-api")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .env("WRITABLE_PATH", config_dir.to_str().unwrap())
        .args(["--config", proxy_config_path.to_str().unwrap()]);

    let (mut rx, child) = sidecar.spawn().map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // Store the child process
    {
        let mut process = state.proxy_process.lock().unwrap();
        *process = Some(child);
    }

    // Listen for stdout/stderr in a separate task (for logging only)
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    println!("[CLIProxyAPI] {}", text);
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    eprintln!("[CLIProxyAPI ERROR] {}", text);
                }
                CommandEvent::Terminated(payload) => {
                    println!("[CLIProxyAPI] Process terminated: {:?}", payload);
                    // Update status when process dies unexpectedly
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        let mut status = state.proxy_status.lock().unwrap();
                        status.running = false;
                        let _ = app_handle.emit("proxy-status-changed", status.clone());
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    // Wait for the proxy to be ready before syncing settings
    let port = config.port;
    let client = crate::build_management_client();
    let health_url = format!("http://127.0.0.1:{}/v0/management/config.yaml", port);
    let mut ready = false;
    for attempt in 0..25 {
        // 25 attempts × 200ms = 5s max
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
        match client
            .get(&health_url)
            .header("X-Management-Key", &get_management_key())
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                ready = true;
                break;
            }
            _ => {
                if attempt == 24 {
                    eprintln!("[ProxyPal Debug] Proxy not ready after 5s, proceeding anyway");
                }
            }
        }
    }

    // Sync settings via Management API (best-effort, don't fail proxy start)
    if ready {
        let _ = client
            .put(&format!(
                "http://127.0.0.1:{}/v0/management/usage-statistics-enabled",
                port
            ))
            .header("X-Management-Key", &get_management_key())
            .json(&serde_json::json!({"value": config.usage_stats_enabled}))
            .send()
            .await;

        let _ = client
            .put(&format!(
                "http://127.0.0.1:{}/v0/management/ampcode/force-model-mappings",
                port
            ))
            .header("X-Management-Key", &get_management_key())
            .json(&serde_json::json!({"value": config.force_model_mappings}))
            .send()
            .await;

        let _ = client
            .put(&format!(
                "http://127.0.0.1:{}/v0/management/max-retry-interval",
                port
            ))
            .header("X-Management-Key", &get_management_key())
            .json(&serde_json::json!({"value": config.max_retry_interval}))
            .send()
            .await;
    }
    
    // Start log file watcher for request tracking
    // This replaces the old polling approach and captures ALL requests including Amp proxy forwarding
    let log_path = config_dir.join("logs").join("main.log");
    let log_watcher_running = state.log_watcher_running.clone();
    let request_counter = state.request_counter.clone();
    
    // Signal any existing watcher to stop, then start new one
    log_watcher_running.store(false, Ordering::SeqCst);
    std::thread::sleep(std::time::Duration::from_millis(100)); // Give old watcher time to stop
    log_watcher_running.store(true, Ordering::SeqCst);
    
    let app_handle2 = app.clone();
    start_log_watcher(app_handle2, log_path, log_watcher_running, request_counter);
    
    // Sync usage statistics from proxy to local history on startup (in background)
    // This ensures analytics page shows data without requiring restart or manual refresh
    let port = config.port;
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        let client = crate::build_management_client();
        let usage_url = format!("http://127.0.0.1:{}/v0/management/usage", port);
        let _ = client
            .get(&usage_url)
            .header("X-Management-Key", &get_management_key())
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await;
    });

    // Update status
    let new_status = {
        let mut status = state.proxy_status.lock().unwrap();
        status.running = true;
        status.port = config.port;
        status.endpoint = format!("http://localhost:{}/v1", config.port);
        status.clone()
    };

    // Emit status update
    let _ = app.emit("proxy-status-changed", new_status.clone());

    Ok(new_status)
}

#[tauri::command]
pub async fn stop_proxy(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ProxyStatus, String> {
    // Check if running
    {
        let status = state.proxy_status.lock().unwrap();
        if !status.running {
            return Ok(status.clone());
        }
    }

    // Stop the log watcher
    state.log_watcher_running.store(false, Ordering::SeqCst);

    // Kill the tracked child process
    {
        let mut process = state.proxy_process.lock().unwrap();
        if let Some(child) = process.take() {
            println!("[ProxyPal] Killing tracked proxy process");
            let _ = child.kill();
        }
    }

    // Also kill any orphaned cliproxyapi processes by name (belt and suspenders)
    #[cfg(unix)]
    {
        println!("[ProxyPal] Cleaning up any orphaned cliproxyapi processes");
        let _ = std::process::Command::new("sh")
            .args(["-c", "pkill -9 -f cliproxyapi 2>/dev/null"])
            .output();
    }
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", "taskkill /F /IM cliproxyapi*.exe 2>nul"]);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.output();
    }

    // Update status
    let new_status = {
        let mut status = state.proxy_status.lock().unwrap();
        status.running = false;
        status.clone()
    };

    // Emit status update
    let _ = app.emit("proxy-status-changed", new_status.clone());

    Ok(new_status)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_var_lock() -> &'static std::sync::Mutex<()> {
        static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        LOCK.get_or_init(|| std::sync::Mutex::new(()))
    }

    #[test]
    fn env_proxy_for_url_returns_none_for_invalid_target() {
        assert!(env_proxy_for_url("not-a-url").is_none());
    }

    #[test]
    fn env_proxy_for_url_returns_none_when_env_is_missing() {
        let _guard = env_var_lock().lock().unwrap();
        let old_http_upper = std::env::var_os("HTTP_PROXY");
        let old_https_upper = std::env::var_os("HTTPS_PROXY");
        let old_http_lower = std::env::var_os("http_proxy");
        let old_https_lower = std::env::var_os("https_proxy");

        std::env::remove_var("HTTP_PROXY");
        std::env::remove_var("HTTPS_PROXY");
        std::env::remove_var("http_proxy");
        std::env::remove_var("https_proxy");

        let detected = env_proxy_for_url(DEFAULT_PROXY_CHECK_URL);

        if let Some(value) = old_http_upper {
            std::env::set_var("HTTP_PROXY", value);
        }
        if let Some(value) = old_https_upper {
            std::env::set_var("HTTPS_PROXY", value);
        }
        if let Some(value) = old_http_lower {
            std::env::set_var("http_proxy", value);
        }
        if let Some(value) = old_https_lower {
            std::env::set_var("https_proxy", value);
        }

        assert!(detected.is_none());
    }

    #[test]
    fn normalize_system_proxy_uses_http_for_regular_hosts() {
        assert_eq!(
            normalize_system_proxy("127.0.0.1", 8080),
            "http://127.0.0.1:8080"
        );
    }

    #[test]
    fn normalize_system_proxy_uses_socks5_for_socks_hosts() {
        assert_eq!(
            normalize_system_proxy("socks-proxy.local", 1080),
            "socks5://socks-proxy.local:1080"
        );
    }
}

mod commands;
mod config;
mod proxy;
mod state;
mod types;
mod utils;
mod ssh_manager;

use crate::config::{get_aggregate_path, get_auth_path, get_history_path, load_config, save_config_to_file};
use crate::state::AppState;
use crate::types::{
    ProxyStatus, RequestLog, AuthStatus, OAuthState,
    UsageStats, TimeSeriesPoint, ModelUsage, ProviderUsage, RequestHistory,
    Aggregate, ModelStats,
    CopilotStatus, CopilotApiDetection, CopilotApiInstallResult,
    ClaudeApiKey, GeminiApiKey, CodexApiKey, OpenAICompatibleProvider,
    ThinkingBudgetSettings, ReasoningEffortSettings,
    AuthFile, LogEntry, DetectedTool, AgentStatus,
    AvailableModel, ProviderTestResult, ProviderHealth, HealthStatus,
};
use crate::ssh_manager::SshManager;
use crate::utils::{estimate_request_cost, detect_provider_from_model, detect_provider_from_path, extract_model_from_path};
use serde::Deserialize;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State,
};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::ShellExt;

/// Get management key from config (used for internal proxy API calls)
fn get_management_key() -> String {
    load_config().management_key
}
use regex::Regex;
use std::io::{BufRead, BufReader, Seek, SeekFrom};

// Windows-specific imports for hiding CMD windows
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// Windows CREATE_NO_WINDOW flag
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// Load request history from file
fn load_request_history() -> RequestHistory {
    let path = get_history_path();
    if path.exists() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(mut history) = serde_json::from_str::<RequestHistory>(&data) {
                // Recalculate totals from saved requests if counters are missing
                // This handles migration from old format
                if history.total_request_count == 0 && !history.requests.is_empty() {
                    history.total_request_count = history.requests.len() as u64;
                }
                if history.total_success_count == 0 && !history.requests.is_empty() {
                    history.total_success_count = history.requests.iter().filter(|r| r.status < 400).count() as u64;
                }
                return history;
            }
        }
    }
    RequestHistory::default()
}

// Save request history to file (keep last 500 requests)
fn save_request_history(history: &RequestHistory) -> Result<(), String> {
    let path = get_history_path();
    let mut trimmed = history.clone();
    // Keep only last 500 requests in the array for UI display
    // But preserve totalRequestCount and totalSuccessCount (cumulative across all history)
    if trimmed.requests.len() > 500 {
        trimmed.requests = trimmed.requests.split_off(trimmed.requests.len() - 500);
    }
    let data = serde_json::to_string_pretty(&trimmed).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

fn load_aggregate() -> Aggregate {
    let path = get_aggregate_path();
    if path.exists() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(agg) = serde_json::from_str(&data) {
                return agg;
            }
        }
    }
    Aggregate::default()
}

fn save_aggregate(agg: &Aggregate) -> Result<(), String> {
    let path = get_aggregate_path();
    let temp_path = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(agg).map_err(|e| e.to_string())?;
    std::fs::write(&temp_path, data).map_err(|e| e.to_string())?;
    std::fs::rename(&temp_path, &path).map_err(|e| e.to_string())
}

/// Migrate from old single-file format to split storage
/// Called once on app startup
fn migrate_to_split_storage() {
    let agg_path = get_aggregate_path();

    // Skip if aggregate already exists
    if agg_path.exists() {
        return;
    }

    let history = load_request_history();

    // Skip if no history to migrate
    if history.requests.is_empty() {
        return;
    }

    eprintln!("[Migration] Building aggregate.json from existing history...");

    let mut agg = Aggregate::default();

    // Count totals from requests
    agg.total_requests = history.requests.len() as u64;
    agg.total_success_count = history.requests.iter()
        .filter(|r| r.status < 400)
        .count() as u64;
    agg.total_failure_count = agg.total_requests - agg.total_success_count;

    // Use existing token totals from history
    agg.total_tokens_in = history.total_tokens_in;
    agg.total_tokens_out = history.total_tokens_out;
    agg.total_cost_usd = history.total_cost_usd;

    // Build time-series from requests
    for req in &history.requests {
        if let Some(dt) = chrono::DateTime::from_timestamp_millis(req.timestamp as i64) {
            let day = dt.format("%Y-%m-%d").to_string();
            update_timeseries(&mut agg.requests_by_day, &day, 1);
            let tokens = (req.tokens_in.unwrap_or(0) + req.tokens_out.unwrap_or(0)) as u64;
            update_timeseries(&mut agg.tokens_by_day, &day, tokens);
        }

        // Build model/provider stats
        update_model_stats(&mut agg, req);
        update_provider_stats(&mut agg, req);
    }

    // Also use existing time-series from history if available
    if !history.tokens_by_day.is_empty() && agg.tokens_by_day.is_empty() {
        agg.tokens_by_day = history.tokens_by_day.clone();
    }

    // Sort time-series by date
    agg.requests_by_day.sort_by(|a, b| a.label.cmp(&b.label));
    agg.tokens_by_day.sort_by(|a, b| a.label.cmp(&b.label));

    // Save the new aggregate file
    match save_aggregate(&agg) {
        Ok(_) => eprintln!("[Migration] Success! Created aggregate.json with {} requests", agg.total_requests),
        Err(e) => eprintln!("[Migration] Failed to save aggregate: {}", e),
    }
}

fn update_timeseries(series: &mut Vec<TimeSeriesPoint>, label: &str, increment: u64) {
    if let Some(point) = series.iter_mut().find(|p| p.label == label) {
        point.value += increment;
    } else {
        series.push(TimeSeriesPoint {
            label: label.to_string(),
            value: increment,
        });
    }
}

fn update_model_stats(agg: &mut Aggregate, req: &RequestLog) {
    let model = if req.model.is_empty() || req.model == "unknown" {
        "unknown".to_string()
    } else {
        req.model.clone()
    };
    
    let entry = agg.model_stats.entry(model).or_insert(ModelStats::default());
    entry.requests += 1;
    if req.status < 400 {
        entry.success_count += 1;
    }
    entry.tokens += (req.tokens_in.unwrap_or(0) + req.tokens_out.unwrap_or(0)) as u64;
    entry.input_tokens += req.tokens_in.unwrap_or(0) as u64;
    entry.output_tokens += req.tokens_out.unwrap_or(0) as u64;
    entry.cached_tokens += req.tokens_cached.unwrap_or(0) as u64;
}

fn update_provider_stats(agg: &mut Aggregate, req: &RequestLog) {
    let provider = if req.provider.is_empty() || req.provider == "unknown" {
        "unknown".to_string()
    } else {
        req.provider.clone()
    };
    
    let entry = agg.provider_stats.entry(provider).or_insert(ModelStats::default());
    entry.requests += 1;
    if req.status < 400 {
        entry.success_count += 1;
    }
    entry.tokens += (req.tokens_in.unwrap_or(0) + req.tokens_out.unwrap_or(0)) as u64;
}

// Load auth status from file
fn load_auth_status() -> AuthStatus {
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
fn save_auth_to_file(auth: &AuthStatus) -> Result<(), String> {
    let path = get_auth_path();
    let data = serde_json::to_string_pretty(auth).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

// Parse duration string to milliseconds
fn parse_duration(duration_str: &str) -> u64 {
    if duration_str.ends_with("ms") {
        duration_str.trim_end_matches("ms").parse().unwrap_or(0)
    } else if duration_str.ends_with('s') {
        let secs: f64 = duration_str.trim_end_matches('s').parse().unwrap_or(0.0);
        (secs * 1000.0) as u64
    } else {
        0
    }
}

// Extract timestamp from log line
// Format: 2025-12-24 15:14:21 or similar at the start of line
fn extract_timestamp_from_line(line: &str) -> Option<u64> {
    lazy_static::lazy_static! {
        static ref TS_REGEX: Regex = Regex::new(
            r#"(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})"#
        ).unwrap();
    }
    
    if let Some(caps) = TS_REGEX.captures(line) {
        let date_str = caps.get(1)?.as_str();
        let time_str = caps.get(2)?.as_str();
        let datetime_str = format!("{} {}", date_str, time_str);
        return chrono::NaiveDateTime::parse_from_str(&datetime_str, "%Y-%m-%d %H:%M:%S")
            .ok()
            .map(|dt| dt.and_local_timezone(chrono::Local).unwrap().timestamp_millis() as u64);
    }
    None
}

// Parse a GIN log line and extract request information
// Format: [GIN] 2025/12/04 - 20:51:48 | 200 | 6.656s | ::1 | POST "/api/provider/anthropic/v1/messages"
// Also handles new format: | request_id | 200 | 6.656s | ip | POST "/path"
fn parse_gin_log_line(line: &str, request_counter: &AtomicU64, model_cache: &std::sync::RwLock<std::collections::HashMap<String, String>>) -> Option<RequestLog> {
    // Check for model info in DEBUG lines and cache it
    // Format: | f803bb77 | Use OAuth user@email.com for model gemini-claude-opus-4-5-thinking
    if line.contains("for model ") {
        lazy_static::lazy_static! {
            static ref MODEL_REGEX: Regex = Regex::new(
                r#"\|\s+([a-f0-9]{8})\s+\|.*for model\s+(\S+)"#
            ).unwrap();
        }
        if let Some(caps) = MODEL_REGEX.captures(line) {
            let request_id = caps.get(1)?.as_str().to_string();
            let model = caps.get(2)?.as_str().to_string();
            if let Ok(mut cache) = model_cache.write() {
                cache.insert(request_id, model);
                // Keep cache size reasonable
                if cache.len() > 1000 {
                    let keys: Vec<String> = cache.keys().take(500).cloned().collect();
                    for key in keys {
                        cache.remove(&key);
                    }
                }
            }
        }
        return None;
    }
    
    // Only process GIN request logs or new format logs with request ID
    let is_gin_log = line.contains("[GIN]");
    let is_new_format = !is_gin_log && line.contains("| POST") || line.contains("| GET");
    
    if !is_gin_log && !is_new_format {
        return None;
    }
    
    // Skip management/internal routes we don't want to track
    if line.contains("/v0/management/") || 
       line.contains("/v1/models") ||
       line.contains("?uploadThread") ||
       line.contains("?getCreditsByRequestId") ||
       line.contains("?threadDisplayCostInfo") ||
       line.contains("/api/internal") ||
       line.contains("/api/telemetry") ||
       line.contains("/api/otel") {
        return None;
    }
    
    // Only track actual API calls (chat completions, messages, etc.)
    let is_trackable = line.contains("/chat/completions") || 
                       line.contains("/v1/messages") ||
                       line.contains("/completions") ||
                       line.contains("/v1beta") ||
                       line.contains(":generateContent") ||
                       line.contains(":streamGenerateContent");
    
    if !is_trackable {
        return None;
    }
    
    // Try new format first: | request_id | status | duration | ip | METHOD "path"
    // Example: | f803bb77 | 200 | 12.453s | 127.0.0.1 | POST "/v1/messages"
    lazy_static::lazy_static! {
        static ref NEW_FORMAT_REGEX: Regex = Regex::new(
            r#"\|\s+([a-f0-9]{8}|-{8})\s+\|\s+(\d+)\s+\|\s+([^\s]+)\s+\|\s+[^\s]+\s+\|\s+(\w+)\s+"([^"]+)""#
        ).unwrap();
        static ref GIN_REGEX: Regex = Regex::new(
            r#"\[GIN\]\s+(\d{4}/\d{2}/\d{2})\s+-\s+(\d{2}:\d{2}:\d{2})\s+\|\s+(\d+)\s+\|\s+([^\s]+)\s+\|\s+[^\s]+\s+\|\s+(\w+)\s+"([^"]+)"(?:\s+\|\s+model=(\S+))?"#
        ).unwrap();
    }
    
    // Try new format
    if let Some(captures) = NEW_FORMAT_REGEX.captures(line) {
        let request_id = captures.get(1)?.as_str().to_string();
        let status: u16 = captures.get(2)?.as_str().parse().ok()?;
        let duration_str = captures.get(3)?.as_str();
        let method = captures.get(4)?.as_str().to_string();
        let path = captures.get(5)?.as_str().to_string();
        
        // Get timestamp from the beginning of the line if present
        let timestamp = extract_timestamp_from_line(line)
            .unwrap_or_else(|| std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64);
        
        // Parse duration to milliseconds
        let duration_ms = parse_duration(duration_str);
        
        // Look up model from cache using request_id, or fall back to path extraction
        let model = if request_id != "--------" {
            model_cache.read().ok()
                .and_then(|cache| cache.get(&request_id).cloned())
                .or_else(|| extract_model_from_path(&path))
                .unwrap_or_else(|| "unknown".to_string())
        } else {
            extract_model_from_path(&path).unwrap_or_else(|| "unknown".to_string())
        };
        
        // Determine provider from model first (more accurate), fallback to path-based detection
        let model_provider = detect_provider_from_model(&model);
        let provider = if model_provider != "unknown" {
            model_provider
        } else {
            detect_provider_from_path(&path).unwrap_or_else(|| "unknown".to_string())
        };
        
        // Generate unique ID
        let count = request_counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let id = format!("req_{}_{}", timestamp, count);
        
        return Some(RequestLog {
            id,
            timestamp,
            provider,
            model,
            method,
            path,
            status,
            duration_ms,
            tokens_in: None,
            tokens_out: None,
            tokens_cached: None,
        });
    }
    
    // Fall back to GIN format
    let captures = GIN_REGEX.captures(line)?;
    
    let date_str = captures.get(1)?.as_str(); // 2025/12/04
    let time_str = captures.get(2)?.as_str(); // 20:51:48
    let status: u16 = captures.get(3)?.as_str().parse().ok()?;
    let duration_str = captures.get(4)?.as_str(); // 6.656s or 65ms
    let method = captures.get(5)?.as_str().to_string();
    let path = captures.get(6)?.as_str().to_string();
    
    // Parse timestamp
    let datetime_str = format!("{} {}", date_str.replace('/', "-"), time_str);
    let timestamp = chrono::NaiveDateTime::parse_from_str(&datetime_str, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|dt| dt.and_local_timezone(chrono::Local).unwrap().timestamp_millis() as u64)
        .unwrap_or_else(|| std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64);
    
    // Parse duration to milliseconds
    let duration_ms = parse_duration(duration_str);
    
    // Extract model from log line (group 7) or fall back to path extraction for Gemini
    let model = captures.get(7)
        .map(|m| m.as_str().to_string())
        .or_else(|| extract_model_from_path(&path))
        .unwrap_or_else(|| "unknown".to_string());
    
    // Determine provider from model first (more accurate), fallback to path-based detection
    let model_provider = detect_provider_from_model(&model);
    let provider = if model_provider != "unknown" {
        model_provider
    } else {
        detect_provider_from_path(&path).unwrap_or_else(|| "unknown".to_string())
    };
    
    let id = request_counter.fetch_add(1, Ordering::SeqCst);
    // Use timestamp + counter for unique ID (survives app restarts)
    let unique_id = format!("req_{}_{}", timestamp, id);
    
    Some(RequestLog {
        id: unique_id,
        timestamp,
        provider,
        model,
        method,
        path,
        status,
        duration_ms,
        tokens_in: None,  // Not available from GIN logs
        tokens_out: None, // Not available from GIN logs
        tokens_cached: None, // Not available from GIN logs
    })
}

// Start watching the proxy log file for new entries
fn start_log_watcher(
    app_handle: tauri::AppHandle,
    log_path: std::path::PathBuf,
    running: Arc<AtomicBool>,
    request_counter: Arc<AtomicU64>,
) {
    std::thread::spawn(move || {
        // Model cache to associate request IDs with model names from DEBUG lines
        let model_cache: std::sync::RwLock<std::collections::HashMap<String, String>> = 
            std::sync::RwLock::new(std::collections::HashMap::new());
        
        // Wait for log file to exist
        let mut attempts = 0;
        while !log_path.exists() && attempts < 30 {
            std::thread::sleep(std::time::Duration::from_millis(500));
            attempts += 1;
        }
        
        if !log_path.exists() {
            eprintln!("[LogWatcher] Log file not found: {:?}", log_path);
            return;
        }
        
        // Open file and seek to end (only watch new entries)
        let file = match std::fs::File::open(&log_path) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("[LogWatcher] Failed to open log file: {}", e);
                return;
            }
        };
        
        let mut reader = BufReader::new(file);
        // Seek to end to only process new lines
        if let Err(e) = reader.seek(SeekFrom::End(0)) {
            eprintln!("[LogWatcher] Failed to seek to end: {}", e);
            return;
        }
        
        // Track file position
        let mut last_pos = reader.stream_position().unwrap_or(0);
        
        println!("[LogWatcher] Started watching: {:?}", log_path);
        
        // Poll for new content (more reliable than notify for log files)
        while running.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(500));
            
            // Check if file has grown
            let current_size = std::fs::metadata(&log_path)
                .map(|m| m.len())
                .unwrap_or(last_pos);
            
            if current_size <= last_pos {
                // File might have been rotated, reset
                if current_size < last_pos {
                    last_pos = 0;
                    if let Err(e) = reader.seek(SeekFrom::Start(0)) {
                        eprintln!("[LogWatcher] Failed to seek after rotation: {}", e);
                        continue;
                    }
                }
                continue;
            }
            
            // Read new lines
            let mut line = String::new();
            while reader.read_line(&mut line).unwrap_or(0) > 0 {
                if let Some(request_log) = parse_gin_log_line(&line, &request_counter, &model_cache) {
                    // Emit to frontend for live display
                    let _ = app_handle.emit("request-log", request_log.clone());
                    
                    // Persist to history (without token data for now)
                    let mut history = load_request_history();
                    
                    // Check for duplicate by timestamp and path
                    let is_duplicate = history.requests.iter().any(|r| 
                        r.timestamp == request_log.timestamp && r.path == request_log.path
                    );
                    
                    if !is_duplicate {
                        // Load aggregate for cumulative stats
                        let mut agg = load_aggregate();
                        
                        // Update aggregate counters
                        agg.total_requests += 1;
                        if request_log.status < 400 {
                            agg.total_success_count += 1;
                        } else {
                            agg.total_failure_count += 1;
                        }
                        agg.total_tokens_in += request_log.tokens_in.unwrap_or(0) as u64;
                        agg.total_tokens_out += request_log.tokens_out.unwrap_or(0) as u64;
                        agg.total_tokens_cached += request_log.tokens_cached.unwrap_or(0) as u64;
                        
                        // Update time-series (today's date)
                        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
                        update_timeseries(&mut agg.requests_by_day, &today, 1);
                        let tokens = (request_log.tokens_in.unwrap_or(0) + request_log.tokens_out.unwrap_or(0)) as u64;
                        update_timeseries(&mut agg.tokens_by_day, &today, tokens);
                        
                        // Update model/provider stats
                        update_model_stats(&mut agg, &request_log);
                        update_provider_stats(&mut agg, &request_log);
                        
                        // Update history (keep only last 500 for UI display)
                        history.requests.push(request_log);
                        if history.requests.len() > 500 {
                            history.requests = history.requests.split_off(history.requests.len() - 500);
                        }
                        
                        // Save both files
                        if let Err(e) = save_request_history(&history) {
                            eprintln!("[LogWatcher] Failed to save history: {}", e);
                        }
                        if let Err(e) = save_aggregate(&agg) {
                            eprintln!("[LogWatcher] Failed to save aggregate: {}", e);
                        }
                    }
                }
                line.clear();
            }
            
            last_pos = reader.stream_position().unwrap_or(last_pos);
        }
        
        println!("[LogWatcher] Stopped watching");
    });
}

// Tauri commands
#[tauri::command]
fn get_proxy_status(state: State<AppState>) -> ProxyStatus {
    state.proxy_status.lock().unwrap().clone()
}

#[tauri::command]
async fn start_proxy(
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
    
    // Build proxy-url line if configured
    let proxy_url_line = if config.proxy_url.is_empty() {
        String::new()
    } else {
        format!("proxy-url: \"{}\"\n", config.proxy_url)
    };
    
    // Build amp api key line if configured
    let amp_api_key_line = if config.amp_api_key.is_empty() {
        "  # upstream-api-key: \"\"  # Set your Amp API key from https://ampcode.com/settings".to_string()
    } else {
        format!("  upstream-api-key: \"{}\"", config.amp_api_key)
    };
    
    // Build amp model-mappings section if configured
    // Model mappings route Amp model requests to other models available in the proxy
    // (e.g., from: claude-opus-4-5-20251101 -> to: copilot-gpt-5-mini)
    // Only include mappings that are enabled
    let enabled_mappings: Vec<_> = config.amp_model_mappings.iter()
        .filter(|m| m.enabled)
        .collect();
    
    let amp_model_mappings_section = if enabled_mappings.is_empty() {
        "  # model-mappings:  # Optional: map Amp model requests to different models\n  #   - from: claude-opus-4-5-20251101\n  #     to: your-preferred-model".to_string()
    } else {
        let mut mappings = String::from("  model-mappings:");
        for mapping in &enabled_mappings {
            mappings.push_str(&format!("\n    - from: {}\n      to: {}", mapping.from, mapping.to));
        }
        mappings
    };
    
    // Build openai-compatibility section combining custom providers and copilot
    // This defines OpenAI-compatible providers with custom base URLs and model aliases
    let mut openai_compat_entries = Vec::new();
    
    // Add custom providers if configured (multiple providers support)
    for provider in &config.amp_openai_providers {
        if !provider.name.is_empty() && !provider.base_url.is_empty() && !provider.api_key.is_empty() {
            let mut entry = format!("  # Custom OpenAI-compatible provider: {}\n", provider.name);
            entry.push_str(&format!("  - name: \"{}\"\n", provider.name));
            entry.push_str(&format!("    base-url: \"{}\"\n", provider.base_url));
            entry.push_str("    api-key-entries:\n");
            entry.push_str(&format!("      - api-key: \"{}\"\n", provider.api_key));
            
            if !provider.models.is_empty() {
                entry.push_str("    models:\n");
                for model in &provider.models {
                    entry.push_str(&format!("      - alias: \"{}\"\n", model.alias));
                    entry.push_str(&format!("        name: \"{}\"\n", model.name));
                }
            }
            openai_compat_entries.push(entry);
        }
    }
    
    // Add copilot OpenAI-compatible entry if enabled
    if config.copilot.enabled {
        let port = config.copilot.port;
        let mut entry = String::from("  # GitHub Copilot GPT/OpenAI models (via copilot-api)\n");
        entry.push_str(&format!("  - name: \"copilot\"\n"));
        entry.push_str(&format!("    base-url: \"http://localhost:{}/v1\"\n", port));
        entry.push_str("    api-key-entries:\n");
        entry.push_str("      - api-key: \"dummy\"\n");
        entry.push_str("    models:\n");
        // OpenAI GPT models - use direct names (no prefix) for CLIProxyAPI compatibility
        entry.push_str("      - alias: \"gpt-4.1\"\n");
        entry.push_str("        name: \"gpt-4.1\"\n");
        entry.push_str("      - alias: \"gpt-5\"\n");
        entry.push_str("        name: \"gpt-5\"\n");
        entry.push_str("      - alias: \"gpt-5-mini\"\n");
        entry.push_str("        name: \"gpt-5-mini\"\n");
        entry.push_str("      - alias: \"gpt-5-codex\"\n");
        entry.push_str("        name: \"gpt-5-codex\"\n");
        entry.push_str("      - alias: \"gpt-5.1\"\n");
        entry.push_str("        name: \"gpt-5.1\"\n");
        entry.push_str("      - alias: \"gpt-5.1-codex\"\n");
        entry.push_str("        name: \"gpt-5.1-codex\"\n");
        entry.push_str("      - alias: \"gpt-5.1-codex-mini\"\n");
        entry.push_str("        name: \"gpt-5.1-codex-mini\"\n");
        entry.push_str("      - alias: \"gpt-5.1-codex-max\"\n");
        entry.push_str("        name: \"gpt-5.1-codex-max\"\n");
        entry.push_str("      - alias: \"gpt-5.2\"\n");
        entry.push_str("        name: \"gpt-5.2\"\n");
        // Legacy OpenAI models (may still work)
        entry.push_str("      - alias: \"gpt-4o\"\n");
        entry.push_str("        name: \"gpt-4o\"\n");
        entry.push_str("      - alias: \"gpt-4\"\n");
        entry.push_str("        name: \"gpt-4\"\n");
        entry.push_str("      - alias: \"gpt-4-turbo\"\n");
        entry.push_str("        name: \"gpt-4-turbo\"\n");
        entry.push_str("      - alias: \"o1\"\n");
        entry.push_str("        name: \"o1\"\n");
        entry.push_str("      - alias: \"o1-mini\"\n");
        entry.push_str("        name: \"o1-mini\"\n");
        // xAI Grok model
        entry.push_str("      - alias: \"grok-code-fast-1\"\n");
        entry.push_str("        name: \"grok-code-fast-1\"\n");
        // Fine-tuned models
        entry.push_str("      - alias: \"raptor-mini\"\n");
        entry.push_str("        name: \"raptor-mini\"\n");
        // Google Gemini models (via OpenAI-compat)
        entry.push_str("      - alias: \"gemini-2.5-pro\"\n");
        entry.push_str("        name: \"gemini-2.5-pro\"\n");
        entry.push_str("      - alias: \"gemini-3-pro-preview\"\n");
        entry.push_str("        name: \"gemini-3-pro-preview\"\n");
        // Claude models (GA)
        entry.push_str("      - alias: \"claude-haiku-4.5\"\n");
        entry.push_str("        name: \"claude-haiku-4.5\"\n");
        entry.push_str("      - alias: \"claude-opus-4.1\"\n");
        entry.push_str("        name: \"claude-opus-4.1\"\n");
        entry.push_str("      - alias: \"claude-sonnet-4\"\n");
        entry.push_str("        name: \"claude-sonnet-4\"\n");
        entry.push_str("      - alias: \"claude-sonnet-4.5\"\n");
        entry.push_str("        name: \"claude-sonnet-4.5\"\n");
        // Claude models (Preview)
        entry.push_str("      - alias: \"claude-opus-4.5\"\n");
        entry.push_str("        name: \"claude-opus-4.5\"\n");
        openai_compat_entries.push(entry);
    }
    
    // Build final openai-compatibility section
    let openai_compat_section = if openai_compat_entries.is_empty() {
        String::new()
    } else {
        let mut section = String::from("# OpenAI-compatible providers\nopenai-compatibility:\n");
        for entry in openai_compat_entries {
            section.push_str(&entry);
        }
        section.push('\n');
        section
    };
    
    // Build claude-api-key section combining copilot and user's persisted keys
    let claude_api_key_section = {
        let mut entries: Vec<String> = Vec::new();
        
        // Add user's persisted Claude API keys only
        for key in &config.claude_api_keys {
            let mut entry = String::new();
            entry.push_str(&format!("  - api-key: \"{}\"\n", key.api_key));
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
    };
    
    // Build gemini-api-key section from user's persisted keys
    let gemini_api_key_section = if config.gemini_api_keys.is_empty() {
        String::new()
    } else {
        let mut section = String::from("# Gemini API keys\ngemini-api-key:\n");
        for key in &config.gemini_api_keys {
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
    };
    
    // Build codex-api-key section from user's persisted keys
    let codex_api_key_section = if config.codex_api_keys.is_empty() {
        String::new()
    } else {
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
    };
    
    // Get thinking budget from config
    let thinking_budget = {
        let mode = if config.thinking_budget_mode.is_empty() {
            "medium"
        } else {
            &config.thinking_budget_mode
        };
        let custom = if config.thinking_budget_custom == 0 {
            16000
        } else {
            config.thinking_budget_custom
        };
        match mode {
            "low" => 2048,
            "medium" => 8192,
            "high" => 32768,
            "custom" => custom,
            _ => 8192,
        }
    };
    
    let thinking_mode_display = if config.thinking_budget_mode.is_empty() { "medium" } else { &config.thinking_budget_mode };
    
    // Build payload section to inject thinking budget for Antigravity Claude models
    // Note: GPT/Codex reasoning_effort is NOT injected via payload config because it would
    // apply to ALL requests matching gpt-5*, including those routed to Claude via model mapping.
    // Users should use model suffix like gpt-5(high) to specify reasoning effort, which
    // CLIProxyAPI handles via applyReasoningEffortMetadata() from request metadata.
    let payload_section = format!(r#"# Payload injection for thinking models
# Antigravity Claude: Thinking budget mode: {} ({} tokens)
payload:
  default:
    # Antigravity Claude models - thinking budget
    - models:
        - name: "gemini-claude-sonnet-4-5"
          protocol: "claude"
        - name: "gemini-claude-sonnet-4-5-thinking"
          protocol: "claude"
      params:
        "thinking.budget_tokens": {}
    - models:
        - name: "gemini-claude-opus-4-5"
          protocol: "claude"
        - name: "gemini-claude-opus-4-5-thinking"
          protocol: "claude"
      params:
        "thinking.budget_tokens": {}

"#, 
        thinking_mode_display,
        thinking_budget,
        thinking_budget,
        thinking_budget
    );
    
    // Always regenerate config on start because CLIProxyAPI hashes the secret-key in place
    // and we need the plaintext key for Management API access
    let proxy_config = format!(
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
{}
# Quota exceeded behavior
quota-exceeded:
  switch-project: {}
  switch-preview-model: {}

# Enable Management API for OAuth flows
remote-management:
  allow-remote: true
  secret-key: "{}"
  disable-control-panel: true

{}{}{}{}{}# Amp CLI Integration - enables amp login and management routes
# See: https://help.router-for.me/agent-client/amp-cli.html
# Get API key from: https://ampcode.com/settings
ampcode:
  upstream-url: "https://ampcode.com"
{}
{}
  restrict-management-to-localhost: false
"#,
        config.port,
        config.proxy_api_key,
        config.debug,
        config.usage_stats_enabled,
        config.logging_to_file,
        config.logs_max_total_size_mb,
        config.request_retry,
        proxy_url_line,
        config.quota_switch_project,
        config.quota_switch_preview_model,
        config.management_key,
        openai_compat_section,
        claude_api_key_section,
        gemini_api_key_section,
        codex_api_key_section,
        payload_section,
        amp_api_key_line,
        amp_model_mappings_section
    );
    
    std::fs::write(&proxy_config_path, proxy_config).map_err(|e| e.to_string())?;

    // Spawn the sidecar process with WRITABLE_PATH set to app config dir
    // This prevents CLIProxyAPI from writing logs to src-tauri/logs/ which triggers hot reload
    let sidecar = app
        .shell()
        .sidecar("cliproxyapi")
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

    // Give it a moment to start
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    
    // Sync usage statistics setting via Management API (in case it differs from config file)
    let port = config.port;
    let enable_url = format!("http://127.0.0.1:{}/v0/management/usage-statistics-enabled", port);
    let client = reqwest::Client::new();
    let _ = client
        .put(&enable_url)
        .header("X-Management-Key", &get_management_key())
        .json(&serde_json::json!({"value": config.usage_stats_enabled}))
        .send()
        .await;
    
    // Sync force-model-mappings setting from config to proxy runtime
    let force_mappings_url = format!("http://127.0.0.1:{}/v0/management/ampcode/force-model-mappings", port);
    let _ = client
        .put(&force_mappings_url)
        .header("X-Management-Key", &get_management_key())
        .json(&serde_json::json!({"value": config.force_model_mappings}))
        .send()
        .await;
    
    // Sync max retry interval to CLIProxyAPI
    let max_retry_url = format!("http://127.0.0.1:{}/v0/management/max-retry-interval", port);
    let _ = client
        .put(&max_retry_url)
        .header("X-Management-Key", &get_management_key())
        .json(&serde_json::json!({"value": config.max_retry_interval}))
        .send()
        .await;
    
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
        let client = reqwest::Client::new();
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
async fn stop_proxy(
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

// ============================================
// Copilot API Management (via copilot-api)
// ============================================

#[tauri::command]
fn get_copilot_status(state: State<AppState>) -> CopilotStatus {
    state.copilot_status.lock().unwrap().clone()
}

#[tauri::command]
async fn start_copilot(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<CopilotStatus, String> {
    let config = state.config.lock().unwrap().clone();
    let port = config.copilot.port;
    
    // Check if copilot is enabled
    if !config.copilot.enabled {
        return Err("Copilot is not enabled in settings".to_string());
    }
    
    // First, check if copilot-api is already running on this port (maybe externally)
    let client = reqwest::Client::new();
    let health_url = format!("http://127.0.0.1:{}/v1/models", port);
    if let Ok(response) = client
        .get(&health_url)
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
    {
        if response.status().is_success() {
            // Already running and healthy - just update status
            let new_status = {
                let mut status = state.copilot_status.lock().unwrap();
                status.running = true;
                status.port = port;
                status.endpoint = format!("http://localhost:{}", port);
                status.authenticated = true;
                status.clone()
            };
            let _ = app.emit("copilot-status-changed", new_status.clone());
            return Ok(new_status);
        }
    }
    
    // Kill any existing copilot process we're tracking
    {
        let mut process = state.copilot_process.lock().unwrap();
        if let Some(child) = process.take() {
            let _ = child.kill(); // Ignore errors, process might already be dead
        }
    }
    
    // Small delay to let port be released
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    
    // Check if copilot-api is installed globally (faster startup)
    let detection = detect_copilot_api(app.clone()).await?;
    
    if !detection.node_available {
        let checked = detection.checked_node_paths.join(", ");
        return Err(format!(
            "Node.js is required for GitHub Copilot support.\n\n\
            Checked paths: {}\n\n\
            Please install Node.js from https://nodejs.org/ or via a version manager (nvm, volta, fnm) and restart ProxyPal.",
            if checked.is_empty() { "none".to_string() } else { checked }
        ));
    }
    
    // Check Node.js version >= 20.16.0 (required for process.getBuiltinModule)
    if let Some(ref version_str) = detection.node_version {
        // Parse version like "v20.16.0" or "v18.19.0"
        let version_clean = version_str.trim_start_matches('v');
        let parts: Vec<&str> = version_clean.split('.').collect();
        if parts.len() >= 2 {
            let major: u32 = parts[0].parse().unwrap_or(0);
            let minor: u32 = parts[1].parse().unwrap_or(0);
            
            // Require Node.js >= 20.16.0
            if major < 20 || (major == 20 && minor < 16) {
                return Err(format!(
                    "Node.js version {} is too old for GitHub Copilot support.\n\n\
                    The copilot-api package requires Node.js 20.16.0 or later.\n\
                    Your current version: {}\n\n\
                    Please upgrade Node.js:\n\
                    • Download from https://nodejs.org/ (LTS recommended)\n\
                    • Or use a version manager: nvm install 22 / volta install node@22\n\n\
                    After upgrading, restart ProxyPal.",
                    version_str, version_str
                ));
            }
        }
    }
    
    // Determine command and arguments based on installation status
    let (bin_path, mut args) = if detection.installed {
        // Use copilot-api directly
        let copilot_bin = detection.copilot_bin.clone()
            .ok_or_else(|| format!(
                "copilot-api binary path not found.\n\n\
                Checked paths: {}",
                detection.checked_copilot_paths.join(", ")
            ))?;
        println!("[copilot] Using globally installed copilot-api: {}{}", 
            copilot_bin,
            detection.version.as_ref().map(|v| format!(" v{}", v)).unwrap_or_default());
        (copilot_bin, vec![])
    } else if let Some(npx_bin) = detection.npx_bin.clone() {
        // Prefer npx over bunx for downloading packages (more reliable)
        println!("[copilot] Using npx: {} copilot-api@latest", npx_bin);
        (npx_bin, vec!["copilot-api@latest".to_string()])
    } else if let Some(bunx_bin) = detection.bunx_bin.clone() {
        // Fallback to bunx
        println!("[copilot] Using bunx: {} copilot-api@latest", bunx_bin);
        (bunx_bin, vec!["copilot-api@latest".to_string()])
    } else {
        return Err(
            "Neither npx nor bunx found (required to run copilot-api).\n\n\
            Install Node.js (https://nodejs.org/) or bun (https://bun.sh) and restart ProxyPal.".to_string()
        );
    };
    
    // Add common arguments
    args.push("start".to_string());
    args.push("--port".to_string());
    args.push(port.to_string());
    
    // Add account type if specified
    if !config.copilot.account_type.is_empty() {
        args.push("--account".to_string());
        args.push(config.copilot.account_type.clone());
    }
    
    // Add GitHub token if specified (for direct authentication)
    if !config.copilot.github_token.is_empty() {
        args.push("--github-token".to_string());
        args.push(config.copilot.github_token.clone());
    }
    
    // Add rate limit if specified
    if let Some(rate_limit) = config.copilot.rate_limit {
        args.push("--rate-limit".to_string());
        args.push(rate_limit.to_string());
    }
    
    // Add rate limit wait flag (copilot-api uses --wait)
    if config.copilot.rate_limit_wait {
        args.push("--wait".to_string());
    }
    
    println!("[copilot] Executing: {} {}", bin_path, args.join(" "));
    
    let command = app.shell().command(&bin_path).args(&args);
    
    let (mut rx, child) = command.spawn().map_err(|e| format!("Failed to spawn copilot-api: {}. Make sure Node.js is installed.", e))?;
    
    // Store the child process
    {
        let mut process = state.copilot_process.lock().unwrap();
        *process = Some(child);
    }
    
    // Update status to running (but not yet authenticated)
    {
        let mut status = state.copilot_status.lock().unwrap();
        status.running = true;
        status.port = port;
        status.endpoint = format!("http://localhost:{}", port);
        status.authenticated = false;
    }
    
    // Listen for stdout/stderr in background task
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        
        println!("[copilot] Starting stdout/stderr listener...");
        
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    println!("[copilot-api] {}", text);
                    
                    // Check for successful login message
                    // copilot-api outputs "Listening on: http://localhost:PORT/" when ready
                    let text_lower = text.to_lowercase();
                    if text_lower.contains("listening on") || text.contains("Logged in as") || text.contains("Server running") {
                        // Update authenticated status
                        if let Some(state) = app_handle.try_state::<AppState>() {
                            let mut status = state.copilot_status.lock().unwrap();
                            status.authenticated = true;
                            let _ = app_handle.emit("copilot-status-changed", status.clone());
                            println!("[copilot] ✓ Authenticated via stdout detection");
                        }
                    }
                    
                    // Check for auth URL in output
                    if text.contains("https://github.com/login/device") || text.contains("device code") {
                        // Emit auth required event
                        let _ = app_handle.emit("copilot-auth-required", text.to_string());
                        println!("[copilot] Auth required - device code flow initiated");
                    }
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    eprintln!("[copilot-api ERROR] {}", text);
                    
                    // Some processes log to stderr even for non-errors
                    // Check if it's actually a login/running message
                    let text_lower = text.to_lowercase();
                    if text_lower.contains("listening on") || text.contains("Logged in as") || text.contains("Server running") {
                        if let Some(state) = app_handle.try_state::<AppState>() {
                            let mut status = state.copilot_status.lock().unwrap();
                            status.authenticated = true;
                            let _ = app_handle.emit("copilot-status-changed", status.clone());
                            println!("[copilot] ✓ Authenticated via stderr detection");
                        }
                    }
                }
                CommandEvent::Terminated(payload) => {
                    println!("[copilot-api] Process terminated: {:?}", payload);
                    // Update status when process dies
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        let mut status = state.copilot_status.lock().unwrap();
                        status.running = false;
                        status.authenticated = false;
                        let _ = app_handle.emit("copilot-status-changed", status.clone());
                    }
                    break;
                }
                _ => {}
            }
        }
    });
    
    // Wait for copilot-api to be ready (up to 8 seconds)
    // bunx/npx may need to download packages on first run, which takes ~5s
    let client = reqwest::Client::new();
    let health_url = format!("http://127.0.0.1:{}/v1/models", port);
    
    for i in 0..16 {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        
        // Check if stdout listener already detected authentication
        {
            let status = state.copilot_status.lock().unwrap();
            if status.authenticated {
                println!("[copilot] ✓ Ready via stdout detection at {:.1}s", (i + 1) as f32 * 0.5);
                let status_clone = status.clone();
                let _ = app.emit("copilot-status-changed", status_clone.clone());
                return Ok(status_clone);
            }
            if !status.running {
                return Err("Copilot process stopped unexpectedly".to_string());
            }
        }
        
        // Also check health endpoint
        if let Ok(response) = client
            .get(&health_url)
            .timeout(std::time::Duration::from_secs(1))
            .send()
            .await
        {
            if response.status().is_success() {
                println!("[copilot] ✓ Ready via health check at {:.1}s", (i + 1) as f32 * 0.5);
                let new_status = {
                    let mut status = state.copilot_status.lock().unwrap();
                    status.authenticated = true;
                    status.clone()
                };
                let _ = app.emit("copilot-status-changed", new_status.clone());
                return Ok(new_status);
            }
        }
    }
    
    // Return with "running but not authenticated" status after timeout
    // The background task will continue polling and emit status updates
    let initial_status = state.copilot_status.lock().unwrap().clone();
    println!("[copilot] Returning after 8s wait: running={}, authenticated={}", initial_status.running, initial_status.authenticated);
    let _ = app.emit("copilot-status-changed", initial_status.clone());
    
    // Spawn background task to poll for authentication
    // This runs independently and emits status updates as authentication completes
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::new();
        let health_url = format!("http://127.0.0.1:{}/v1/models", port);
        
        // Poll for up to 60 seconds to catch slower authentication (especially on first run)
        for i in 0..120 {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            
            // Check if stdout listener already detected authentication
            if let Some(state) = app_handle.try_state::<AppState>() {
                let status = state.copilot_status.lock().unwrap();
                if status.authenticated {
                    println!("✓ Copilot authenticated via stdout detection at {:.1}s", i as f32 * 0.5);
                    return;
                }
                // If process stopped, exit polling
                if !status.running {
                    println!("⚠ Copilot process stopped, ending auth poll");
                    return;
                }
            }
            
            // Also check health endpoint
            if let Ok(response) = client
                .get(&health_url)
                .timeout(std::time::Duration::from_secs(2))
                .send()
                .await
            {
                if response.status().is_success() {
                    println!("✓ Copilot authenticated via health check at {:.1}s", i as f32 * 0.5);
                    // Update status
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        let new_status = {
                            let mut status = state.copilot_status.lock().unwrap();
                            status.authenticated = true;
                            status.clone()
                        };
                        let _ = app_handle.emit("copilot-status-changed", new_status);
                    }
                    return;
                }
            }
            
            // Log progress every 10 seconds
            if i > 0 && i % 20 == 0 {
                println!("⏳ Waiting for Copilot authentication... ({:.0}s elapsed)", i as f32 * 0.5);
            }
        }
        
        println!("⚠ Copilot authentication poll timed out after 60s - user may need to complete GitHub auth manually");
    });
    
    Ok(initial_status)
}

#[tauri::command]
async fn stop_copilot(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<CopilotStatus, String> {
    // Check if running
    {
        let status = state.copilot_status.lock().unwrap();
        if !status.running {
            return Ok(status.clone());
        }
    }
    
    // Kill the child process
    {
        let mut process = state.copilot_process.lock().unwrap();
        if let Some(child) = process.take() {
            child.kill().map_err(|e| format!("Failed to kill copilot-api: {}", e))?;
        }
    }
    
    // Update status
    let new_status = {
        let mut status = state.copilot_status.lock().unwrap();
        status.running = false;
        status.authenticated = false;
        status.clone()
    };
    
    // Emit status update
    let _ = app.emit("copilot-status-changed", new_status.clone());
    
    Ok(new_status)
}

#[tauri::command]
async fn check_copilot_health(state: State<'_, AppState>) -> Result<CopilotStatus, String> {
    let config = state.config.lock().unwrap().clone();
    let port = config.copilot.port;
    
    let client = reqwest::Client::new();
    let health_url = format!("http://127.0.0.1:{}/v1/models", port);
    
    let (running, authenticated) = match client
        .get(&health_url)
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
    {
        Ok(response) => (true, response.status().is_success()),
        Err(_) => (false, false),
    };
    
    // Update status
    let new_status = {
        let mut status = state.copilot_status.lock().unwrap();
        status.running = running;
        status.authenticated = authenticated;
        if running {
            status.port = port;
            status.endpoint = format!("http://localhost:{}", port);
        }
        status.clone()
    };
    
    Ok(new_status)
}

#[tauri::command]
async fn detect_copilot_api(app: tauri::AppHandle) -> Result<CopilotApiDetection, String> {
    // Common Node.js installation paths on macOS/Linux
    // GUI apps don't inherit shell PATH, so we need to check common locations
    // Including version managers: Volta, nvm, fnm, asdf
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("~"));
    let home_str = home.to_string_lossy();
    
    // Helper: find nvm node binary by checking versions directory
    let find_nvm_node = |home: &std::path::Path| -> Option<String> {
        let nvm_versions = home.join(".nvm/versions/node");
        if nvm_versions.exists() {
            // Try to read the default alias first
            let default_alias = home.join(".nvm/alias/default");
            if let Ok(alias) = std::fs::read_to_string(&default_alias) {
                let alias = alias.trim();
                // Find matching version directory
                if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
                    for entry in entries.flatten() {
                        let name = entry.file_name();
                        let name_str = name.to_string_lossy();
                        if name_str.starts_with(&format!("v{}", alias)) || name_str == alias {
                            let node_path = entry.path().join("bin/node");
                            if node_path.exists() {
                                return Some(node_path.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
            // Fallback: use the most recent version (sorted alphabetically, last is usually newest)
            if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
                let mut versions: Vec<_> = entries
                    .flatten()
                    .filter(|e| e.path().join("bin/node").exists())
                    .collect();
                versions.sort_by(|a, b| b.file_name().cmp(&a.file_name())); // Descending
                if let Some(entry) = versions.first() {
                    let node_path = entry.path().join("bin/node");
                    return Some(node_path.to_string_lossy().to_string());
                }
            }
        }
        None
    };
    
    let mut node_paths: Vec<String> = if cfg!(target_os = "macos") {
        vec![
            // Version managers (most common for developers)
            format!("{}/.volta/bin/node", home_str),      // Volta
            format!("{}/.fnm/current/bin/node", home_str), // fnm
            format!("{}/.asdf/shims/node", home_str),      // asdf
            // System package managers
            "/opt/homebrew/bin/node".to_string(),      // Apple Silicon Homebrew
            "/usr/local/bin/node".to_string(),          // Intel Homebrew / manual install
            "/usr/bin/node".to_string(),                // System install
            "/opt/local/bin/node".to_string(),          // MacPorts
        ]
    } else if cfg!(target_os = "windows") {
        vec![
            // Standard Windows Node.js installation paths
            "C:\\Program Files\\nodejs\\node.exe".to_string(),
            "C:\\Program Files (x86)\\nodejs\\node.exe".to_string(),
            // Version managers on Windows
            format!("{}/.volta/bin/node.exe", home_str),  // Volta
            format!("{}/AppData/Roaming/nvm/current/node.exe", home_str), // nvm-windows
            format!("{}/AppData/Local/fnm_multishells/node.exe", home_str), // fnm
            format!("{}/scoop/apps/nodejs/current/node.exe", home_str), // Scoop
            format!("{}/scoop/apps/nodejs-lts/current/node.exe", home_str), // Scoop LTS
            // Chocolatey installation path
            "C:\\ProgramData\\chocolatey\\bin\\node.exe".to_string(),
            // Windows Store / winget paths
            format!("{}/AppData/Local/Microsoft/WindowsApps/node.exe", home_str),
            // npm global bin (for detecting npm-installed tools)
            format!("{}/AppData/Roaming/npm/node.exe", home_str),
            // PowerShell profile paths (pnpm, yarn global)
            format!("{}/AppData/Local/pnpm/node.exe", home_str),
            // Fallback to PATH (works with any terminal: CMD, PowerShell, Windows Terminal)
            "node.exe".to_string(),
            "node".to_string(),
        ]
    } else {
        vec![
            // Version managers
            format!("{}/.volta/bin/node", home_str),
            format!("{}/.fnm/current/bin/node", home_str),
            format!("{}/.asdf/shims/node", home_str),
            // System paths
            "/usr/bin/node".to_string(),
            "/usr/local/bin/node".to_string(),
            "/home/linuxbrew/.linuxbrew/bin/node".to_string(),
        ]
    };
    
    // Add nvm path if found (nvm doesn't use a simple symlink structure)
    if cfg!(not(target_os = "windows")) {
        if let Some(nvm_node) = find_nvm_node(&home) {
            node_paths.insert(0, nvm_node); // Prioritize nvm
        }
    };
    
    // Find working node binary and get version
    let mut node_bin: Option<String> = None;
    let mut node_version: Option<String> = None;
    for path in &node_paths {
        let check = app.shell().command(path).args(["--version"]).output().await;
        if let Ok(ref output) = check {
            if output.status.success() {
                node_bin = Some(path.to_string());
                node_version = Some(String::from_utf8_lossy(&output.stdout).trim().to_string());
                break;
            }
        }
    }
    
    // Also try just "node" in case PATH is available
    if node_bin.is_none() {
        let check = app.shell().command("node").args(["--version"]).output().await;
        if let Ok(ref output) = check {
            if output.status.success() {
                node_bin = Some("node".to_string());
                node_version = Some(String::from_utf8_lossy(&output.stdout).trim().to_string());
            }
        }
    }
    
    if node_bin.is_none() {
        // Even without Node, check if bunx is available (bun can run copilot-api)
        let bunx_paths: Vec<String> = if cfg!(target_os = "macos") {
            vec![
                format!("{}/.bun/bin/bunx", home_str),
                "/opt/homebrew/bin/bunx".to_string(),
                "/usr/local/bin/bunx".to_string(),
            ]
        } else if cfg!(target_os = "windows") {
            vec![
                format!("{}/.bun/bin/bunx.exe", home_str),
                format!("{}/AppData/Local/bun/bunx.exe", home_str),
            ]
        } else {
            vec![
                format!("{}/.bun/bin/bunx", home_str),
                "/usr/local/bin/bunx".to_string(),
            ]
        };
        
        let mut bunx_bin: Option<String> = None;
        for path in &bunx_paths {
            let check = app.shell().command(path).args(["--version"]).output().await;
            if check.as_ref().map(|o| o.status.success()).unwrap_or(false) {
                bunx_bin = Some(path.clone());
                println!("[copilot] Found bunx at: {} (no Node.js needed)", path);
                break;
            }
        }
        
        if bunx_bin.is_some() {
            // Bun available, can still run copilot-api via bunx
            return Ok(CopilotApiDetection {
                installed: false,
                version: None,
                copilot_bin: None,
                npx_bin: None,
                npm_bin: None,
                node_bin: None,
                node_version: None,
                bunx_bin,
                node_available: true, // Mark as available since bunx works
                checked_node_paths: node_paths,
                checked_copilot_paths: vec![],
            });
        }
        
        return Ok(CopilotApiDetection {
            installed: false,
            version: None,
            copilot_bin: None,
            npx_bin: None,
            npm_bin: None,
            node_bin: None,
            node_version: None,
            bunx_bin: None,
            node_available: false,
            checked_node_paths: node_paths,
            checked_copilot_paths: vec![],
        });
    }
    
    // Derive npm/npx paths from node path (handle Windows and Unix paths)
    let npx_bin = node_bin.as_ref().map(|n| {
        if cfg!(target_os = "windows") {
            if n == "node" || n == "node.exe" {
                "npx.cmd".to_string()
            } else {
                n.replace("\\node.exe", "\\npx.cmd")
                    .replace("/node.exe", "/npx.cmd")
                    .replace("\\node", "\\npx")
                    .replace("/node", "/npx")
            }
        } else {
            let n_trimmed = n.trim();
            if n_trimmed == "node" {
                "npx".to_string()
            } else if n_trimmed.ends_with("/node") {
                let node_len = "/node".len();
                format!("{}/npx", &n_trimmed[..n_trimmed.len() - node_len])
            } else {
                // Fallback: npx should be alongside node
                "npx".to_string()
            }
        }
    }).unwrap_or_else(|| if cfg!(target_os = "windows") { "npx.cmd".to_string() } else { "npx".to_string() });
    
    let npm_bin = node_bin.as_ref().map(|n| {
        if cfg!(target_os = "windows") {
            n.replace("\\node.exe", "\\npm.cmd")
                .replace("/node.exe", "/npm.cmd")
                .replace("\\node", "\\npm")
                .replace("/node", "/npm")
        } else {
            n.replace("/node", "/npm")
        }
    }).unwrap_or_else(|| if cfg!(target_os = "windows") { "npm.cmd".to_string() } else { "npm".to_string() });
    
    // Check for bun/bunx (preferred over npx - faster startup)
    let bunx_paths: Vec<String> = if cfg!(target_os = "macos") {
        vec![
            format!("{}/.bun/bin/bunx", home_str),
            "/opt/homebrew/bin/bunx".to_string(),
            "/usr/local/bin/bunx".to_string(),
        ]
    } else if cfg!(target_os = "windows") {
        vec![
            format!("{}/.bun/bin/bunx.exe", home_str),
            format!("{}/AppData/Local/bun/bunx.exe", home_str),
        ]
    } else {
        vec![
            format!("{}/.bun/bin/bunx", home_str),
            "/usr/local/bin/bunx".to_string(),
        ]
    };
    
    let mut bunx_bin: Option<String> = None;
    for path in &bunx_paths {
        let check = app.shell().command(path).args(["--version"]).output().await;
        if check.as_ref().map(|o| o.status.success()).unwrap_or(false) {
            bunx_bin = Some(path.clone());
            println!("[copilot] Found bunx at: {}", path);
            break;
        }
    }
    
    // Try to find copilot-api binary directly first
    let copilot_paths: Vec<String> = if cfg!(target_os = "macos") {
        vec![
            // Version managers (most common for developers)
            format!("{}/.volta/bin/copilot-api", home_str),
            format!("{}/.nvm/current/bin/copilot-api", home_str),
            format!("{}/.fnm/current/bin/copilot-api", home_str),
            format!("{}/.asdf/shims/copilot-api", home_str),
            // Package managers
            "/opt/homebrew/bin/copilot-api".to_string(),
            "/usr/local/bin/copilot-api".to_string(),
            "/usr/bin/copilot-api".to_string(),
            // pnpm/yarn global bins
            format!("{}/Library/pnpm/copilot-api", home_str),
            format!("{}/.local/share/pnpm/copilot-api", home_str),
            format!("{}/.yarn/bin/copilot-api", home_str),
            format!("{}/.config/yarn/global/node_modules/.bin/copilot-api", home_str),
        ]
    } else if cfg!(target_os = "windows") {
        vec![
            // npm global bin (most common location after npm install -g)
            format!("{}/AppData/Roaming/npm/copilot-api.cmd", home_str),
            // Version managers on Windows
            format!("{}/.volta/bin/copilot-api.exe", home_str),  // Volta
            format!("{}/AppData/Roaming/nvm/current/copilot-api.cmd", home_str), // nvm-windows
            format!("{}/scoop/apps/nodejs/current/bin/copilot-api.cmd", home_str), // Scoop
            // Fallback to PATH
            "copilot-api.cmd".to_string(),
            "copilot-api".to_string(),
        ]
    } else {
        vec![
            format!("{}/.volta/bin/copilot-api", home_str),
            format!("{}/.nvm/current/bin/copilot-api", home_str),
            format!("{}/.fnm/current/bin/copilot-api", home_str),
            format!("{}/.asdf/shims/copilot-api", home_str),
            "/usr/local/bin/copilot-api".to_string(),
            "/usr/bin/copilot-api".to_string(),
        ]
    };
    
    for path in &copilot_paths {
        let check = app.shell().command(path).args(["--version"]).output().await;
        if check.as_ref().map(|o| o.status.success()).unwrap_or(false) {
            return Ok(CopilotApiDetection {
                installed: true,
                version: None,
                copilot_bin: Some(path.to_string()),
                npx_bin: Some(npx_bin),
                npm_bin: Some(npm_bin),
                node_bin: node_bin.clone(),
                node_version: node_version.clone(),
                bunx_bin,
                node_available: true,
                checked_node_paths: node_paths,
                checked_copilot_paths: copilot_paths,
            });
        }
    }
    
    // Check if copilot-api is installed globally via npm
    let npm_list = app
        .shell()
        .command(&npm_bin)
        .args(["list", "-g", "copilot-api", "--depth=0", "--json"])
        .output()
        .await;
    
    if let Ok(output) = npm_list {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) {
                if let Some(deps) = json.get("dependencies") {
                    if let Some(copilot) = deps.get("copilot-api") {
                        let version = copilot.get("version")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        
                        // npm says it's installed, derive copilot-api path from npm prefix
                        let copilot_bin = node_bin.as_ref()
                            .map(|n| {
                                if cfg!(target_os = "windows") {
                                    // Windows: node.exe -> copilot-api.cmd
                                    n.replace("\\node.exe", "\\copilot-api.cmd")
                                        .replace("/node.exe", "/copilot-api.cmd")
                                        .replace("\\node", "\\copilot-api.cmd")
                                        .replace("/node", "/copilot-api.cmd")
                                } else {
                                    n.replace("/node", "/copilot-api")
                                }
                            })
                            .unwrap_or_else(|| {
                                if cfg!(target_os = "windows") {
                                    "copilot-api.cmd".to_string()
                                } else {
                                    "copilot-api".to_string()
                                }
                            });
                        
                        return Ok(CopilotApiDetection {
                            installed: true,
                            version,
                            copilot_bin: Some(copilot_bin),
                            npx_bin: Some(npx_bin),
                            npm_bin: Some(npm_bin),
                            node_bin: node_bin.clone(),
                            node_version: node_version.clone(),
                            bunx_bin,
                            node_available: true,
                            checked_node_paths: node_paths,
                            checked_copilot_paths: copilot_paths,
                        });
                    }
                }
            }
        }
    }
    
    // Not installed globally
    Ok(CopilotApiDetection {
        installed: false,
        version: None,
        copilot_bin: None,
        npx_bin: Some(npx_bin),
        npm_bin: Some(npm_bin),
        node_bin: node_bin.clone(),
        node_version,
        bunx_bin,
        node_available: true,
        checked_node_paths: node_paths,
        checked_copilot_paths: copilot_paths,
    })
}

#[tauri::command]
async fn install_copilot_api(app: tauri::AppHandle) -> Result<CopilotApiInstallResult, String> {
    // Find npm binary - GUI apps don't inherit shell PATH on macOS
    // Including version managers: Volta, nvm, fnm, asdf
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("~"));
    let home_str = home.to_string_lossy();
    
    let npm_paths: Vec<String> = if cfg!(target_os = "macos") {
        vec![
            // Version managers (most common for developers)
            format!("{}/.volta/bin/npm", home_str),
            format!("{}/.nvm/current/bin/npm", home_str),
            format!("{}/.fnm/current/bin/npm", home_str),
            format!("{}/.asdf/shims/npm", home_str),
            // System package managers
            "/opt/homebrew/bin/npm".to_string(),
            "/usr/local/bin/npm".to_string(),
            "/usr/bin/npm".to_string(),
            "/opt/local/bin/npm".to_string(),
        ]
    } else if cfg!(target_os = "windows") {
        vec![
            // Standard Windows Node.js installation paths
            "C:\\Program Files\\nodejs\\npm.cmd".to_string(),
            "C:\\Program Files (x86)\\nodejs\\npm.cmd".to_string(),
            // Version managers on Windows
            format!("{}/.volta/bin/npm.exe", home_str),  // Volta
            format!("{}/AppData/Roaming/nvm/current/npm.cmd", home_str), // nvm-windows
            format!("{}/AppData/Local/fnm_multishells/npm.cmd", home_str), // fnm
            format!("{}/scoop/apps/nodejs/current/npm.cmd", home_str), // Scoop
            format!("{}/scoop/apps/nodejs-lts/current/npm.cmd", home_str), // Scoop LTS
            format!("{}/AppData/Roaming/npm/npm.cmd", home_str),
            // Fallback to PATH
            "npm.cmd".to_string(),
            "npm".to_string(),
        ]
    } else {
        vec![
            format!("{}/.volta/bin/npm", home_str),
            format!("{}/.nvm/current/bin/npm", home_str),
            format!("{}/.fnm/current/bin/npm", home_str),
            format!("{}/.asdf/shims/npm", home_str),
            "/usr/bin/npm".to_string(),
            "/usr/local/bin/npm".to_string(),
            "/home/linuxbrew/.linuxbrew/bin/npm".to_string(),
        ]
    };
    
    let mut npm_bin: Option<String> = None;
    for path in &npm_paths {
        let check = app.shell().command(path).args(["--version"]).output().await;
        if check.as_ref().map(|o| o.status.success()).unwrap_or(false) {
            npm_bin = Some(path.to_string());
            break;
        }
    }
    
    // Also try just "npm" in case PATH is available
    if npm_bin.is_none() {
        let check = app.shell().command("npm").args(["--version"]).output().await;
        if check.as_ref().map(|o| o.status.success()).unwrap_or(false) {
            npm_bin = Some("npm".to_string());
        }
    }
    
    let npm_bin = match npm_bin {
        Some(bin) => bin,
        None => {
            return Ok(CopilotApiInstallResult {
                success: false,
                message: "Node.js/npm is required. Please install Node.js from https://nodejs.org/".to_string(),
                version: None,
            });
        }
    };
    
    // Install copilot-api globally
    let install_output = app
        .shell()
        .command(&npm_bin)
        .args(["install", "-g", "copilot-api"])
        .output()
        .await
        .map_err(|e| format!("Failed to run npm install: {}", e))?;
    
    if !install_output.status.success() {
        let stderr = String::from_utf8_lossy(&install_output.stderr);
        return Ok(CopilotApiInstallResult {
            success: false,
            message: format!("Installation failed: {}", stderr),
            version: None,
        });
    }
    
    // Get the installed version
    let detection = detect_copilot_api(app).await?;
    
    if detection.installed {
        Ok(CopilotApiInstallResult {
            success: true,
            message: format!("Successfully installed copilot-api{}", 
                detection.version.as_ref().map(|v| format!(" v{}", v)).unwrap_or_default()),
            version: detection.version,
        })
    } else {
        Ok(CopilotApiInstallResult {
            success: false,
            message: "Installation completed but copilot-api was not found. You may need to restart your terminal.".to_string(),
            version: None,
        })
    }
}

#[tauri::command]
fn get_auth_status(state: State<AppState>) -> AuthStatus {
    state.auth_status.lock().unwrap().clone()
}

// Live usage data from Go backend
struct LiveUsageData {
    total_tokens: u64,
    input_tokens: u64,
    output_tokens: u64,
    cached_tokens: u64,
    model_tokens: std::collections::HashMap<String, u64>,
    model_token_breakdown: std::collections::HashMap<String, (u64, u64, u64)>, // (input, output, cached)
    tokens_by_hour: Vec<TimeSeriesPoint>,
}

// Fetch live usage stats from Go backend (blocking version for sync context)
fn fetch_live_usage_stats_blocking(port: u16) -> Option<LiveUsageData> {
    let url = format!("http://127.0.0.1:{}/v0/management/usage", port);
    let client = reqwest::blocking::Client::new();
    
    let response = client.get(&url)
        .header("X-Management-Key", &get_management_key())
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .ok()?;
    
    let json: serde_json::Value = response.json().ok()?;
    
    // Parse the response structure:
    // { "usage": { "total_tokens": N, "apis": { "api-name": { "models": { "model": { "total_tokens": N, "details": [...] } } } } } }
    let usage = json.get("usage")?;
    
    let total_tokens = usage.get("total_tokens")?.as_u64().unwrap_or(0);
    
    // Extract input/output/cached tokens from the detailed data
    let mut input_tokens = 0u64;
    let mut output_tokens = 0u64;
    let mut cached_tokens = 0u64;
    let mut model_tokens: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    let mut model_token_breakdown: std::collections::HashMap<String, (u64, u64, u64)> = std::collections::HashMap::new();
    
    if let Some(apis) = usage.get("apis").and_then(|v| v.as_object()) {
        for (_api_name, api_data) in apis {
            if let Some(models) = api_data.get("models").and_then(|v| v.as_object()) {
                for (model_name, model_data) in models {
                    let model_total = model_data.get("total_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                    *model_tokens.entry(model_name.clone()).or_insert(0) += model_total;
                    
                    // Sum up input/output/cached from details per model
                    let mut model_input = 0u64;
                    let mut model_output = 0u64;
                    let mut model_cached = 0u64;
                    
                    if let Some(details) = model_data.get("details").and_then(|v| v.as_array()) {
                        for detail in details {
                            if let Some(tokens) = detail.get("tokens") {
                                let inp = tokens.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                let out = tokens.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                let cached = tokens.get("cached_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                
                                input_tokens += inp;
                                output_tokens += out;
                                cached_tokens += cached;
                                
                                model_input += inp;
                                model_output += out;
                                model_cached += cached;
                            }
                        }
                    }
                    
                    // Store per-model breakdown
                    let entry = model_token_breakdown.entry(model_name.clone()).or_insert((0, 0, 0));
                    entry.0 += model_input;
                    entry.1 += model_output;
                    entry.2 += model_cached;
                }
            }
        }
    }
    
    Some(LiveUsageData {
        total_tokens,
        input_tokens,
        output_tokens,
        cached_tokens,
        model_tokens,
        model_token_breakdown,
        tokens_by_hour: {
            // Parse tokens_by_hour from Go backend: { "HH": value, ... }
            let mut result = Vec::new();
            if let Some(tbh) = usage.get("tokens_by_hour").and_then(|v| v.as_object()) {
                let today = chrono::Local::now().format("%Y-%m-%d").to_string();
                for (hour, value) in tbh {
                    if let Some(v) = value.as_u64() {
                        // Convert "HH" format to "YYYY-MM-DDTHH" format
                        let label = format!("{}T{}", today, hour);
                        result.push(TimeSeriesPoint { label, value: v });
                    }
                }
                result.sort_by(|a, b| a.label.cmp(&b.label));
            }
            result
        },
    })
}

// Compute usage statistics - fetches live data from Go backend when proxy is running
#[tauri::command]
fn get_usage_stats(state: State<'_, AppState>) -> Result<UsageStats, String> {
    let agg = load_aggregate();
    let history = load_request_history();
    
    // Get proxy status
    let (is_running, port) = {
        let status = state.proxy_status.lock().unwrap();
        (status.running, status.port)
    };
    
    // Try to fetch live data from Go backend if proxy is running
    let live_data = if is_running {
        fetch_live_usage_stats_blocking(port)
    } else {
        None
    };
    
    // Merge live data with aggregate
    let (total_tokens, input_tokens, output_tokens, cached_tokens, model_tokens, model_token_breakdown): (u64, u64, u64, u64, std::collections::HashMap<String, u64>, std::collections::HashMap<String, (u64, u64, u64)>) = if let Some(ref live) = live_data {
        (live.total_tokens, live.input_tokens, live.output_tokens, live.cached_tokens, live.model_tokens.clone(), live.model_token_breakdown.clone())
    } else {
        // Build model token breakdown from aggregate stats
        let agg_model_tokens: std::collections::HashMap<String, u64> = agg.model_stats.iter()
            .map(|(k, v)| (k.clone(), v.tokens))
            .collect();
        let agg_model_breakdown: std::collections::HashMap<String, (u64, u64, u64)> = agg.model_stats.iter()
            .map(|(k, v)| (k.clone(), (v.input_tokens, v.output_tokens, v.cached_tokens)))
            .collect();
        (agg.total_tokens_in + agg.total_tokens_out, agg.total_tokens_in, agg.total_tokens_out, agg.total_tokens_cached, agg_model_tokens, agg_model_breakdown)
    };
    
    // If no data yet, return defaults
    if agg.total_requests == 0 && history.requests.is_empty() {
        return Ok(UsageStats::default());
    }
    
    // Use aggregate as primary source of truth for all-time stats
    let total_requests = agg.total_requests;
    let success_count = agg.total_success_count;
    let failure_count = agg.total_failure_count;
    
    // Calculate today's stats from aggregate time-series
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let requests_today = agg.requests_by_day.iter()
        .find(|p| p.label == today)
        .map(|p| p.value)
        .unwrap_or(0);
    
    // Get today's tokens from live data or aggregate
    let tokens_today = if let Some(ref live) = live_data {
        live.total_tokens // Use live total as "today" since it's current session
    } else {
        agg.tokens_by_day.iter()
            .find(|p| p.label == today)
            .map(|p| p.value)
            .unwrap_or(0)
    };
    
    // Build model stats - merge aggregate with live token data
    let mut models: Vec<ModelUsage> = agg.model_stats.iter()
        .filter(|(model, _)| *model != "unknown" && !model.is_empty())
        .map(|(model, stats)| {
            let tokens = model_tokens.get(model).copied().unwrap_or(stats.tokens);
            let (input, output, cached) = model_token_breakdown.get(model).copied().unwrap_or((0, 0, 0));
            ModelUsage {
                model: model.clone(),
                requests: stats.requests,
                tokens,
                input_tokens: input,
                output_tokens: output,
                cached_tokens: cached,
            }
        })
        .collect();
    
    // Add any models from live data that aren't in aggregate
    for (model, tokens) in &model_tokens {
        if !models.iter().any(|m| &m.model == model) && model != "unknown" && !model.is_empty() {
            let (input, output, cached) = model_token_breakdown.get(model).copied().unwrap_or((0, 0, 0));
            models.push(ModelUsage {
                model: model.clone(),
                requests: 0, // Will be updated from aggregate
                tokens: *tokens,
                input_tokens: input,
                output_tokens: output,
                cached_tokens: cached,
            });
        }
    }
    models.sort_by(|a, b| b.requests.cmp(&a.requests));
    
    // Build provider stats from aggregate
    let mut providers: Vec<ProviderUsage> = agg.provider_stats.iter()
        .filter(|(provider, _)| *provider != "unknown" && !provider.is_empty())
        .map(|(provider, stats)| ProviderUsage {
            provider: provider.clone(),
            requests: stats.requests,
            tokens: stats.tokens,
        })
        .collect();
    providers.sort_by(|a, b| b.requests.cmp(&a.requests));
    
    // Use aggregate time-series, fall back to history if empty
    let mut requests_by_day = agg.requests_by_day.clone();
    if requests_by_day.is_empty() && !history.requests.is_empty() {
        // Build from history requests
        let mut map: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
        for req in &history.requests {
            if let Some(dt) = chrono::DateTime::from_timestamp_millis(req.timestamp as i64) {
                let day = dt.format("%Y-%m-%d").to_string();
                *map.entry(day).or_insert(0) += 1;
            }
        }
        let mut points: Vec<TimeSeriesPoint> = map.into_iter()
            .map(|(label, value)| TimeSeriesPoint { label, value })
            .collect();
        points.sort_by(|a, b| a.label.cmp(&b.label));
        // Keep last 14 days
        if points.len() > 14 {
            points = points.split_off(points.len() - 14);
        }
        requests_by_day = points;
    } else if requests_by_day.len() > 14 {
        requests_by_day = requests_by_day.split_off(requests_by_day.len() - 14);
    }
    
    let mut tokens_by_day = agg.tokens_by_day.clone();
    if tokens_by_day.is_empty() {
        tokens_by_day = history.tokens_by_day.clone();
    }
    if tokens_by_day.len() > 14 {
        tokens_by_day = tokens_by_day.split_off(tokens_by_day.len() - 14);
    }
    
    // Build hourly data from history (recent only)
    let mut requests_by_hour_map: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    let mut tokens_by_hour_map: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    for req in &history.requests {
        if let Some(dt) = chrono::DateTime::from_timestamp_millis(req.timestamp as i64) {
            let hour_label = dt.format("%Y-%m-%dT%H").to_string();
            *requests_by_hour_map.entry(hour_label.clone()).or_insert(0) += 1;
            let tokens = (req.tokens_in.unwrap_or(0) + req.tokens_out.unwrap_or(0)) as u64;
            *tokens_by_hour_map.entry(hour_label).or_insert(0) += tokens;
        }
    }
    
    let mut requests_by_hour: Vec<TimeSeriesPoint> = requests_by_hour_map.into_iter()
        .map(|(label, value)| TimeSeriesPoint { label, value })
        .collect();
    requests_by_hour.sort_by(|a, b| a.label.cmp(&b.label));
    if requests_by_hour.len() > 24 {
        requests_by_hour = requests_by_hour.split_off(requests_by_hour.len() - 24);
    }
    
    // Use live tokens_by_hour if available (more accurate), otherwise use computed from history
    let mut tokens_by_hour: Vec<TimeSeriesPoint> = if let Some(ref live) = live_data {
        if !live.tokens_by_hour.is_empty() {
            live.tokens_by_hour.clone()
        } else {
            tokens_by_hour_map.into_iter()
                .map(|(label, value)| TimeSeriesPoint { label, value })
                .collect()
        }
    } else {
        tokens_by_hour_map.into_iter()
            .map(|(label, value)| TimeSeriesPoint { label, value })
            .collect()
    };
    tokens_by_hour.sort_by(|a, b| a.label.cmp(&b.label));
    if tokens_by_hour.len() > 24 {
        tokens_by_hour = tokens_by_hour.split_off(tokens_by_hour.len() - 24);
    }
    
    Ok(UsageStats {
        total_requests,
        success_count,
        failure_count,
        total_tokens,
        input_tokens,
        output_tokens,
        cached_tokens,
        requests_today,
        tokens_today,
        models,
        providers,
        requests_by_day,
        tokens_by_day,
        requests_by_hour,
        tokens_by_hour,
    })
}

// Get request history
#[tauri::command]
fn get_request_history() -> RequestHistory {
    load_request_history()
}

// Add a request to history (called when request-log event is emitted)
// Returns only the added request to minimize data transfer (memory optimization)
#[tauri::command]
fn add_request_to_history(request: RequestLog) -> Result<RequestLog, String> {
    let mut history = load_request_history();
    
    // Calculate cost for this request
    let tokens_in = request.tokens_in.unwrap_or(0);
    let tokens_out = request.tokens_out.unwrap_or(0);
    let cost = estimate_request_cost(&request.model, tokens_in, tokens_out);
    let tokens_cached = request.tokens_cached.unwrap_or(0);
    
    // Update totals
    history.total_tokens_in += tokens_in as u64;
    history.total_tokens_out += tokens_out as u64;
    history.total_tokens_cached += tokens_cached as u64;
    history.total_cost_usd += cost;
    
    // Add request (with deduplication check)
    // Check if request with same ID already exists to prevent duplicates
    let request_clone = request.clone();
    if !history.requests.iter().any(|r| r.id == request.id) {
        history.requests.push(request);
        
        // Trim to prevent unbounded growth (keep last 500 requests)
        const MAX_HISTORY_SIZE: usize = 500;
        if history.requests.len() > MAX_HISTORY_SIZE {
            let excess = history.requests.len() - MAX_HISTORY_SIZE;
            history.requests.drain(0..excess);
        }
    }
    
    // Save
    save_request_history(&history)?;
    
    // Return only the added request, not the full history
    Ok(request_clone)
}

// Clear request history
#[tauri::command]
fn clear_request_history() -> Result<(), String> {
    let history = RequestHistory::default();
    save_request_history(&history)
}

// Sync usage statistics from CLIProxyAPI's Management API
// This fetches real token counts that aren't available in GIN logs
#[tauri::command]
async fn sync_usage_from_proxy(state: State<'_, AppState>) -> Result<RequestHistory, String> {
    let port = {
        let config = state.config.lock().unwrap();
        config.port
    };
    
    let client = reqwest::Client::new();
    let usage_url = format!("http://127.0.0.1:{}/v0/management/usage", port);
    
    let response = client
        .get(&usage_url)
        .header("X-Management-Key", &get_management_key())
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch usage: {}. Is the proxy running?", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Usage API returned status: {}", response.status()));
    }
    
    let body: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse usage response: {}", e))?;
    
    // Extract token totals from CLIProxyAPI's usage response
    // Structure: { "usage": { "total_tokens": N, "apis": { "POST /v1/messages": { "total_tokens": N, "models": {...} } } } }
    let usage = body.get("usage").ok_or("Missing 'usage' field in response")?;
    
    // Calculate input/output token split from APIs data
    let mut total_input: u64 = 0;
    let mut total_output: u64 = 0;
    let mut total_cached: u64 = 0;
    let mut model_stats: std::collections::HashMap<String, (u64, u64, u64, u64)> = std::collections::HashMap::new(); // (requests, input, output, cached)
    
    if let Some(apis) = usage.get("apis").and_then(|v| v.as_object()) {
        for (_api_path, api_data) in apis {
            if let Some(models) = api_data.get("models").and_then(|v| v.as_object()) {
                for (model_name, model_data) in models {
                    if let Some(details) = model_data.get("details").and_then(|v| v.as_array()) {
                        for detail in details {
                            if let Some(tokens) = detail.get("tokens") {
                                let input = tokens.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                let output = tokens.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                let cached = tokens.get("cached_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                total_input += input;
                                total_output += output;
                                total_cached += cached;
                                
                                let entry = model_stats.entry(model_name.clone()).or_insert((0, 0, 0, 0));
                                entry.0 += 1; // request count
                                entry.1 += input;
                                entry.2 += output;
                                entry.3 += cached;
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Calculate cost based on real token data
    let mut total_cost: f64 = 0.0;
    for (model_name, (_, input, output, _cached)) in &model_stats {
        total_cost += estimate_request_cost(model_name, *input as u32, *output as u32);
    }
    
    // Extract time-series data from CLIProxyAPI response
    // Structure: { "usage": { "tokens_by_day": {...}, "tokens_by_hour": {...}, "requests_by_day": {...} } }
    let mut tokens_by_day: Vec<TimeSeriesPoint> = Vec::new();
    let mut tokens_by_hour: Vec<TimeSeriesPoint> = Vec::new();
    let mut requests_by_day: Vec<TimeSeriesPoint> = Vec::new();
    
    if let Some(tbd) = usage.get("tokens_by_day").and_then(|v| v.as_object()) {
        for (day, value) in tbd {
            if let Some(v) = value.as_u64() {
                tokens_by_day.push(TimeSeriesPoint {
                    label: day.clone(),
                    value: v,
                });
            }
        }
        tokens_by_day.sort_by(|a, b| a.label.cmp(&b.label));
        if tokens_by_day.len() > 14 {
            tokens_by_day = tokens_by_day.split_off(tokens_by_day.len() - 14);
        }
    }
    
    if let Some(tbh) = usage.get("tokens_by_hour").and_then(|v| v.as_object()) {
        for (hour, value) in tbh {
            if let Some(v) = value.as_u64() {
                tokens_by_hour.push(TimeSeriesPoint {
                    label: hour.clone(),
                    value: v,
                });
            }
        }
        tokens_by_hour.sort_by(|a, b| a.label.cmp(&b.label));
        if tokens_by_hour.len() > 24 {
            tokens_by_hour = tokens_by_hour.split_off(tokens_by_hour.len() - 24);
        }
    }
    
    // Parse requests_by_day from proxy (source of truth)
    if let Some(rbd) = usage.get("requests_by_day").and_then(|v| v.as_object()) {
        for (day, value) in rbd {
            if let Some(v) = value.as_u64() {
                requests_by_day.push(TimeSeriesPoint {
                    label: day.clone(),
                    value: v,
                });
            }
        }
        requests_by_day.sort_by(|a, b| a.label.cmp(&b.label));
        if requests_by_day.len() > 14 {
            requests_by_day = requests_by_day.split_off(requests_by_day.len() - 14);
        }
    }
    
    // Update local history with synced data
    let mut history = load_request_history();
    history.total_tokens_in = total_input;
    history.total_tokens_out = total_output;
    history.total_tokens_cached = total_cached;
    history.total_cost_usd = total_cost;
    history.tokens_by_day = tokens_by_day.clone();
    history.tokens_by_hour = tokens_by_hour;
    
    // Save updated history
    save_request_history(&history)?;
    
    // Also update aggregate with token data from proxy
    let mut agg = load_aggregate();
    agg.total_tokens_in = total_input;
    agg.total_tokens_out = total_output;
    agg.total_cost_usd = total_cost;
    // Merge tokens_by_day into aggregate (proxy is source of truth for tokens)
    for point in &tokens_by_day {
        if let Some(existing) = agg.tokens_by_day.iter_mut().find(|p| p.label == point.label) {
            existing.value = point.value; // Update with proxy value
        } else {
            agg.tokens_by_day.push(point.clone());
        }
    }
    agg.tokens_by_day.sort_by(|a, b| a.label.cmp(&b.label));
    
    // Merge requests_by_day into aggregate (proxy is source of truth for requests)
    for point in &requests_by_day {
        if let Some(existing) = agg.requests_by_day.iter_mut().find(|p| p.label == point.label) {
            existing.value = point.value; // Update with proxy value
        } else {
            agg.requests_by_day.push(point.clone());
        }
    }
    agg.requests_by_day.sort_by(|a, b| a.label.cmp(&b.label));
    
    // Update total_requests from proxy data if available
    if !requests_by_day.is_empty() {
        let proxy_total: u64 = requests_by_day.iter().map(|p| p.value).sum();
        if proxy_total > agg.total_requests {
            agg.total_requests = proxy_total;
        }
    }
    
    // Sync model_stats from proxy (source of truth for per-model request/token counts)
    // Structure: { "apis": { "provider": { "models": { "model-name": { "total_requests": N, "total_tokens": N, "details": [...] } } } } }
    if let Some(apis) = usage.get("apis").and_then(|v| v.as_object()) {
        for (_provider, provider_data) in apis {
            if let Some(models) = provider_data.get("models").and_then(|v| v.as_object()) {
                for (model_name, model_data) in models {
                    let total_requests = model_data.get("total_requests").and_then(|v| v.as_u64()).unwrap_or(0);
                    let total_tokens = model_data.get("total_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                    
                    // Sum up token details from the model's request history
                    let mut input_tokens: u64 = 0;
                    let mut output_tokens: u64 = 0;
                    let mut cached_tokens: u64 = 0;
                    
                    if let Some(details) = model_data.get("details").and_then(|v| v.as_array()) {
                        for detail in details {
                            if let Some(tokens) = detail.get("tokens").and_then(|v| v.as_object()) {
                                input_tokens += tokens.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                output_tokens += tokens.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                cached_tokens += tokens.get("cached_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                            }
                        }
                    }
                    
                    // Update or insert model stats
                    let stats = agg.model_stats.entry(model_name.clone()).or_insert_with(Default::default);
                    stats.requests = total_requests;
                    stats.success_count = total_requests; // Assume all synced requests succeeded
                    stats.tokens = total_tokens;
                    stats.input_tokens = input_tokens;
                    stats.output_tokens = output_tokens;
                    stats.cached_tokens = cached_tokens;
                }
            }
        }
    }
    
    let _ = save_aggregate(&agg);
    
    Ok(history)
}

// Export usage statistics from CLIProxyAPI for backup
#[tauri::command]
async fn export_usage_stats(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let port = {
        let config = state.config.lock().unwrap();
        config.port
    };
    
    let client = reqwest::Client::new();
    let export_url = format!("http://127.0.0.1:{}/v0/management/usage/export", port);
    
    let response = client
        .get(&export_url)
        .header("X-Management-Key", &get_management_key())
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Failed to export usage: {}. Is the proxy running?", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Export API returned status: {}", response.status()));
    }
    
    let body: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse export response: {}", e))?;
    
    Ok(body)
}

// Import usage statistics into CLIProxyAPI from backup
#[tauri::command]
async fn import_usage_stats(state: State<'_, AppState>, data: serde_json::Value) -> Result<serde_json::Value, String> {
    let port = {
        let config = state.config.lock().unwrap();
        config.port
    };
    
    let client = reqwest::Client::new();
    let import_url = format!("http://127.0.0.1:{}/v0/management/usage/import", port);
    
    let response = client
        .post(&import_url)
        .header("X-Management-Key", &get_management_key())
        .header("Content-Type", "application/json")
        .json(&data)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Failed to import usage: {}. Is the proxy running?", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Import API returned status: {} - {}", status, body));
    }
    
    let body: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse import response: {}", e))?;
    
    Ok(body)
}

#[tauri::command]
async fn open_oauth(app: tauri::AppHandle, state: State<'_, AppState>, provider: String) -> Result<String, String> {
    // Get proxy port from config
    let port = {
        let config = state.config.lock().unwrap();
        config.port
    };

    // Get the OAuth URL from CLIProxyAPI's Management API
    // Add is_webui=true to use the embedded callback forwarder
    // Use 127.0.0.1 consistently (not localhost) to avoid access control issues
    let endpoint = match provider.as_str() {
        "claude" => format!("http://127.0.0.1:{}/v0/management/anthropic-auth-url?is_webui=true", port),
        "openai" => format!("http://127.0.0.1:{}/v0/management/codex-auth-url?is_webui=true", port),
        "gemini" => format!("http://127.0.0.1:{}/v0/management/gemini-cli-auth-url?is_webui=true", port),
        "qwen" => format!("http://127.0.0.1:{}/v0/management/qwen-auth-url?is_webui=true", port),
        "iflow" => format!("http://127.0.0.1:{}/v0/management/iflow-auth-url?is_webui=true", port),
        "antigravity" => format!("http://127.0.0.1:{}/v0/management/antigravity-auth-url?is_webui=true", port),
        "vertex" => return Err("Vertex uses service account import, not OAuth. Use import_vertex_credential instead.".to_string()),
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    // Make HTTP request to get OAuth URL
    let client = reqwest::Client::new();
    let response = client
        .get(&endpoint)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to get OAuth URL: {}. Is the proxy running?", e))?;

    if !response.status().is_success() {
        return Err(format!("Management API returned error: {}", response.status()));
    }

    // Parse response to get URL and state
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let oauth_url = body["url"]
        .as_str()
        .ok_or("No URL in response")?
        .to_string();
    
    let oauth_state = body["state"]
        .as_str()
        .unwrap_or("")
        .to_string();

    // Store pending OAuth state
    {
        let mut pending = state.pending_oauth.lock().unwrap();
        *pending = Some(OAuthState {
            provider: provider.clone(),
            state: oauth_state.clone(),
        });
    }

    // Open the OAuth URL in the default browser
    app.opener()
        .open_url(&oauth_url, None::<&str>)
        .map_err(|e| e.to_string())?;

    // Return the state so frontend can poll for completion
    Ok(oauth_state)
}

#[tauri::command]
async fn poll_oauth_status(state: State<'_, AppState>, oauth_state: String) -> Result<bool, String> {
    let port = {
        let config = state.config.lock().unwrap();
        config.port
    };

    let endpoint = format!(
        "http://localhost:{}/v0/management/get-auth-status?state={}",
        port, oauth_state
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&endpoint)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to poll OAuth status: {}", e))?;

    if !response.status().is_success() {
        return Ok(false); // Not ready yet
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    // Check if auth is complete - CLIProxyAPI returns { "status": "ok" } when done
    let status = body["status"].as_str().unwrap_or("wait");
    Ok(status == "ok")
}

#[tauri::command]
async fn refresh_auth_status(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<AuthStatus, String> {
    // Check CLIProxyAPI's auth directory for credentials
    let auth_dir = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".cli-proxy-api");

    let mut new_auth = AuthStatus::default();

    // Scan auth directory for credential files and count them per provider
    if let Ok(entries) = std::fs::read_dir(&auth_dir) {
        for entry in entries.flatten() {
            let filename = entry.file_name().to_string_lossy().to_lowercase();
            
            // CLIProxyAPI naming patterns:
            // - claude-{email}.json or anthropic-*.json
            // - codex-{email}.json
            // - gemini-{email}-{project}.json
            // - qwen-{email}.json
            // - iflow-{email}.json
            // - vertex-{project_id}.json
            // - antigravity-{email}.json
            
            if filename.ends_with(".json") {
                if filename.starts_with("claude-") || filename.starts_with("anthropic-") {
                    new_auth.claude += 1;
                } else if filename.starts_with("codex-") {
                    new_auth.openai += 1;
                } else if filename.starts_with("gemini-") {
                    new_auth.gemini += 1;
                } else if filename.starts_with("qwen-") {
                    new_auth.qwen += 1;
                } else if filename.starts_with("iflow-") {
                    new_auth.iflow += 1;
                } else if filename.starts_with("vertex-") {
                    new_auth.vertex += 1;
                } else if filename.starts_with("antigravity-") {
                    new_auth.antigravity += 1;
                }
            }
        }
    }

    // Update state
    {
        let mut auth = state.auth_status.lock().unwrap();
        *auth = new_auth.clone();
    }

    // Save to our config
    save_auth_to_file(&new_auth)?;

    // Emit auth status update
    let _ = app.emit("auth-status-changed", new_auth.clone());

    Ok(new_auth)
}

#[tauri::command]
async fn complete_oauth(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    provider: String,
    code: String,
) -> Result<AuthStatus, String> {
    // In a real implementation, we would:
    // 1. Exchange the code for tokens
    // 2. Store the tokens securely (keychain/credential manager)
    // 3. Update the auth status
    let _ = code; // Mark as used

    // For now, just increment the account count
    {
        let mut auth = state.auth_status.lock().unwrap();
        match provider.as_str() {
            "claude" => auth.claude += 1,
            "openai" => auth.openai += 1,
            "gemini" => auth.gemini += 1,
            "qwen" => auth.qwen += 1,
            "iflow" => auth.iflow += 1,
            "vertex" => auth.vertex += 1,
            "antigravity" => auth.antigravity += 1,
            _ => return Err(format!("Unknown provider: {}", provider)),
        }

        // Save to file
        save_auth_to_file(&auth)?;

        // Clear pending OAuth
        let mut pending = state.pending_oauth.lock().unwrap();
        *pending = None;

        // Emit auth status update
        let _ = app.emit("auth-status-changed", auth.clone());

        Ok(auth.clone())
    }
}

#[tauri::command]
async fn disconnect_provider(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    provider: String,
) -> Result<AuthStatus, String> {
    // Delete credential files from ~/.cli-proxy-api/ for this provider
    let auth_dir = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".cli-proxy-api");
    
    if auth_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&auth_dir) {
            for entry in entries.flatten() {
                let filename = entry.file_name().to_string_lossy().to_lowercase();
                
                // Match credential files by provider prefix
                let should_delete = match provider.as_str() {
                    "claude" => filename.starts_with("claude-") || filename.starts_with("anthropic-"),
                    "openai" => filename.starts_with("codex-"),
                    "gemini" => filename.starts_with("gemini-"),
                    "qwen" => filename.starts_with("qwen-"),
                    "iflow" => filename.starts_with("iflow-"),
                    "vertex" => filename.starts_with("vertex-"),
                    "antigravity" => filename.starts_with("antigravity-"),
                    _ => false,
                };
                
                if should_delete && filename.ends_with(".json") {
                    if let Err(e) = std::fs::remove_file(entry.path()) {
                        eprintln!("Failed to delete credential file {:?}: {}", entry.path(), e);
                    }
                }
            }
        }
    }
    
    let mut auth = state.auth_status.lock().unwrap();

    match provider.as_str() {
        "claude" => auth.claude = 0,
        "openai" => auth.openai = 0,
        "gemini" => auth.gemini = 0,
        "qwen" => auth.qwen = 0,
        "iflow" => auth.iflow = 0,
        "vertex" => auth.vertex = 0,
        "antigravity" => auth.antigravity = 0,
        _ => return Err(format!("Unknown provider: {}", provider)),
    }

    // Save to file
    save_auth_to_file(&auth)?;

    // Emit auth status update
    let _ = app.emit("auth-status-changed", auth.clone());

    Ok(auth.clone())
}

// Helper function to refresh Antigravity OAuth token
async fn refresh_antigravity_token(client: &reqwest::Client, refresh_token: &str) -> Result<String, String> {
    let token_url = "https://oauth2.googleapis.com/token";
    
    // Antigravity OAuth credentials (from CLIProxyAPI)
    let client_id = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
    let client_secret = "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";
    
    let params = [
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];
    
    let response = client
        .post(token_url)
        .form(&params)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Token refresh failed ({}): {}", status, body));
    }
    
    let token_response: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;
    
    token_response
        .get("access_token")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "No access_token in refresh response".to_string())
}

// Fetch Antigravity quota for all authenticated accounts
#[tauri::command]
async fn fetch_antigravity_quota() -> Result<Vec<types::AntigravityQuotaResult>, String> {
    use types::{AntigravityQuotaResult, ModelQuota, AntigravityModelsResponse};
    
    let auth_dir = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".cli-proxy-api");
    
    if !auth_dir.exists() {
        return Ok(vec![]);
    }
    
    let mut results: Vec<AntigravityQuotaResult> = Vec::new();
    let client = reqwest::Client::new();
    
    // Scan for Antigravity auth files
    if let Ok(entries) = std::fs::read_dir(&auth_dir) {
        for entry in entries.flatten() {
            let filename = entry.file_name().to_string_lossy().to_lowercase();
            let file_path = entry.path();
            
            if filename.starts_with("antigravity-") && filename.ends_with(".json") {
                // Extract email from filename: antigravity-{email}.json
                let email = filename
                    .trim_start_matches("antigravity-")
                    .trim_end_matches(".json")
                    .to_string();
                
                // Read and parse auth file
                let content = match std::fs::read_to_string(&file_path) {
                    Ok(c) => c,
                    Err(e) => {
                        results.push(AntigravityQuotaResult {
                            account_email: email,
                            quotas: vec![],
                            fetched_at: chrono::Local::now().to_rfc3339(),
                            error: Some(format!("Failed to read auth file: {}", e)),
                        });
                        continue;
                    }
                };
                
                let mut auth_json: serde_json::Value = match serde_json::from_str(&content) {
                    Ok(v) => v,
                    Err(e) => {
                        results.push(AntigravityQuotaResult {
                            account_email: email,
                            quotas: vec![],
                            fetched_at: chrono::Local::now().to_rfc3339(),
                            error: Some(format!("Invalid JSON: {}", e)),
                        });
                        continue;
                    }
                };
                
                // Check if token is expired and refresh if needed
                let expired_str = auth_json.get("expired").and_then(|e| e.as_str());
                let refresh_token = auth_json.get("refresh_token").and_then(|r| r.as_str()).map(|s| s.to_string());
                
                let mut access_token = auth_json
                    .get("access_token")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string());
                
                // Check if token is expired
                let is_expired = if let Some(exp) = expired_str {
                    chrono::DateTime::parse_from_rfc3339(exp)
                        .map(|dt| dt < chrono::Local::now())
                        .unwrap_or(true)
                } else {
                    true // Assume expired if no expiry field
                };
                
                // Refresh token if expired
                if is_expired {
                    if let Some(ref rt) = refresh_token {
                        match refresh_antigravity_token(&client, rt).await {
                            Ok(new_token) => {
                                // Update auth file with new token
                                if let Some(obj) = auth_json.as_object_mut() {
                                    obj.insert("access_token".to_string(), serde_json::Value::String(new_token.clone()));
                                    // Update expiry (1 hour from now)
                                    let new_expiry = (chrono::Local::now() + chrono::Duration::hours(1)).to_rfc3339();
                                    obj.insert("expired".to_string(), serde_json::Value::String(new_expiry));
                                    
                                    // Save updated auth file
                                    if let Ok(updated_content) = serde_json::to_string(&auth_json) {
                                        let _ = std::fs::write(&file_path, updated_content);
                                    }
                                }
                                access_token = Some(new_token);
                            }
                            Err(e) => {
                                results.push(AntigravityQuotaResult {
                                    account_email: email,
                                    quotas: vec![],
                                    fetched_at: chrono::Local::now().to_rfc3339(),
                                    error: Some(format!("Token refresh failed: {}", e)),
                                });
                                continue;
                            }
                        }
                    } else {
                        results.push(AntigravityQuotaResult {
                            account_email: email,
                            quotas: vec![],
                            fetched_at: chrono::Local::now().to_rfc3339(),
                            error: Some("Token expired and no refresh_token available".to_string()),
                        });
                        continue;
                    }
                }
                
                let access_token = match access_token {
                    Some(t) => t,
                    None => {
                        results.push(AntigravityQuotaResult {
                            account_email: email,
                            quotas: vec![],
                            fetched_at: chrono::Local::now().to_rfc3339(),
                            error: Some("No access_token found in auth file".to_string()),
                        });
                        continue;
                    }
                };
                
                // Fetch quota from Google API - try multiple endpoints with fallback
                let base_urls = [
                    "https://daily-cloudcode-pa.googleapis.com",
                    "https://daily-cloudcode-pa.sandbox.googleapis.com",
                    "https://cloudcode-pa.googleapis.com",
                ];
                
                let mut last_error: Option<String> = None;
                let mut quotas_result: Option<Vec<ModelQuota>> = None;
                
                'url_loop: for base_url in base_urls {
                    let api_url = format!("{}/v1internal:fetchAvailableModels", base_url);
                    let response = client
                        .post(&api_url)
                        .header("Authorization", format!("Bearer {}", access_token))
                        .header("Content-Type", "application/json")
                        .header("User-Agent", "antigravity/1.104.0 darwin/arm64")
                        .body("{}")
                        .timeout(std::time::Duration::from_secs(10))
                        .send()
                        .await;
                
                    match response {
                        Ok(resp) => {
                            if resp.status() == 403 {
                                last_error = Some("Account forbidden (possibly banned or token expired)".to_string());
                                break 'url_loop; // Don't retry on 403
                            }
                            
                            if resp.status() == 404 {
                                last_error = Some(format!("API error: {} (trying next endpoint)", resp.status()));
                                continue 'url_loop; // Try next URL
                            }
                            
                            if !resp.status().is_success() {
                                last_error = Some(format!("API error: {}", resp.status()));
                                continue 'url_loop; // Try next URL
                            }
                            
                            let body: AntigravityModelsResponse = match resp.json().await {
                                Ok(b) => b,
                                Err(e) => {
                                    last_error = Some(format!("Failed to parse response: {}", e));
                                    continue 'url_loop;
                                }
                            };
                            
                            // Parse models and extract quota info (HashMap format)
                            let mut quotas: Vec<ModelQuota> = Vec::new();
                            
                            if let Some(models) = body.models {
                                for (model_name, model_info) in models {
                                    if let Some(quota_info) = model_info.quota_info {
                                        if let Some(remaining) = quota_info.remaining_fraction {
                                            // Map model names to display names
                                            let display_name = match model_name.as_str() {
                                                "gemini-2.5-pro" => "Gemini 2.5 Pro",
                                                "gemini-2.5-flash" => "Gemini 2.5 Flash",
                                                "gemini-2.0-flash" => "Gemini 2.0 Flash",
                                                "gemini-2.0-flash-lite" => "Gemini 2.0 Flash Lite",
                                                "gemini-exp-1206" => "Gemini Exp",
                                                "gemini-claude-sonnet-4-5" | "gemini-claude-sonnet-4-5-thinking" => "Claude Sonnet 4.5",
                                                "gemini-claude-opus-4-5" | "gemini-claude-opus-4-5-thinking" => "Claude Opus 4.5",
                                                "imagen-3.0-generate-002" => "Imagen 3",
                                                _ => &model_name,
                                            }.to_string();
                                            
                                            quotas.push(ModelQuota {
                                                model: model_name,
                                                display_name,
                                                remaining_percent: remaining * 100.0,
                                                reset_time: quota_info.reset_time,
                                            });
                                        }
                                    }
                                }
                            }
                            
                            // Sort by model name for consistent display
                            quotas.sort_by(|a, b| a.display_name.cmp(&b.display_name));
                            quotas_result = Some(quotas);
                            break 'url_loop; // Success, stop trying
                        }
                        Err(e) => {
                            last_error = Some(format!("Network error: {}", e));
                            continue 'url_loop; // Try next URL
                        }
                    }
                }
                
                // Push result based on whether we succeeded
                if let Some(quotas) = quotas_result {
                    results.push(AntigravityQuotaResult {
                        account_email: email,
                        quotas,
                        fetched_at: chrono::Local::now().to_rfc3339(),
                        error: None,
                    });
                } else {
                    results.push(AntigravityQuotaResult {
                        account_email: email,
                        quotas: vec![],
                        fetched_at: chrono::Local::now().to_rfc3339(),
                        error: last_error.or(Some("All API endpoints failed".to_string())),
                    });
                }
            }
        }
    }
    
    Ok(results)
}

// Import Vertex service account credential (JSON file)
#[tauri::command]
async fn import_vertex_credential(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    file_path: String,
) -> Result<AuthStatus, String> {
    // Read the service account JSON file
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    
    // Parse to validate it's valid JSON with required fields
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    
    // Check for required service account fields
    let project_id = json["project_id"]
        .as_str()
        .ok_or("Missing 'project_id' field in service account JSON")?;
    
    if json["type"].as_str() != Some("service_account") {
        return Err("Invalid service account: 'type' must be 'service_account'".to_string());
    }
    
    // Copy to CLIProxyAPI auth directory
    let auth_dir = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".cli-proxy-api");
    
    std::fs::create_dir_all(&auth_dir).map_err(|e| e.to_string())?;
    
    let dest_path = auth_dir.join(format!("vertex-{}.json", project_id));
    std::fs::write(&dest_path, &content)
        .map_err(|e| format!("Failed to save credential: {}", e))?;
    
    // Update auth status (increment count)
    let mut auth = state.auth_status.lock().unwrap();
    auth.vertex += 1;
    
    // Save to file
    save_auth_to_file(&auth)?;
    
    // Emit auth status update
    let _ = app.emit("auth-status-changed", auth.clone());
    
    Ok(auth.clone())
}

#[derive(Debug, Deserialize)]
struct ModelsApiResponse {
    data: Vec<ModelsApiModel>,
}

#[derive(Debug, Deserialize)]
struct ModelsApiModel {
    id: String,
    owned_by: String,
}

#[tauri::command]
async fn get_available_models(state: State<'_, AppState>) -> Result<Vec<AvailableModel>, String> {
    let config = state.config.lock().unwrap().clone();
    let proxy_running = state.proxy_status.lock().unwrap().running;
    
    if !proxy_running {
        return Ok(vec![]);
    }
    
    // Get auth status to determine model sources
    let auth_status = state.auth_status.lock().unwrap().clone();
    let has_vertex = auth_status.vertex > 0;
    let has_gemini_api = !config.gemini_api_keys.is_empty();
    let has_copilot = config.copilot.enabled;
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    
    let endpoint = format!("http://localhost:{}/v1/models", config.port);
    
    let response = match client.get(&endpoint)
        .header("Authorization", "Bearer proxypal-local")
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(e) => {
            // Connection error - proxy might have crashed
            // Update state to reflect proxy is not running
            {
                let mut status = state.proxy_status.lock().unwrap();
                status.running = false;
            }
            return Err(format!("Proxy not responding. Please restart the proxy. ({})", e));
        }
    };
    
    if !response.status().is_success() {
        return Err(format!("API returned status {}", response.status()));
    }
    
    let api_response: ModelsApiResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse models response: {}", e))?;
    
    let models: Vec<AvailableModel> = api_response.data
        .into_iter()
        .map(|m| {
            // Determine source based on owned_by and auth status
            let source = match m.owned_by.as_str() {
                "google" => {
                    // Google models can come from Vertex AI or Gemini API
                    if has_vertex && !has_gemini_api {
                        "vertex".to_string()
                    } else if has_gemini_api && !has_vertex {
                        "gemini-api".to_string()
                    } else if has_vertex && has_gemini_api {
                        "vertex+gemini-api".to_string() // Both sources available
                    } else {
                        "google".to_string() // Fallback
                    }
                },
                "anthropic" => {
                    if !config.claude_api_keys.is_empty() {
                        "api-key".to_string()
                    } else {
                        "oauth".to_string()
                    }
                },
                "openai" => {
                    if has_copilot {
                        "copilot".to_string()
                    } else if !config.codex_api_keys.is_empty() {
                        "api-key".to_string()
                    } else {
                        "oauth".to_string()
                    }
                },
                owner => owner.to_string(),
            };
            
            AvailableModel {
                id: m.id,
                owned_by: m.owned_by,
                source,
            }
        })
        .collect();
    
    Ok(models)
}

#[tauri::command]
async fn test_openai_provider(base_url: String, api_key: String) -> Result<ProviderTestResult, String> {
    if base_url.is_empty() || api_key.is_empty() {
        return Ok(ProviderTestResult {
            success: false,
            message: "Base URL and API key are required".to_string(),
            latency_ms: None,
            models_found: None,
        });
    }
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    
    // Normalize base URL - remove trailing slash
    let base_url = base_url.trim_end_matches('/');
    
    // Try multiple endpoint patterns since providers have varying API structures:
    // 1. {baseUrl}/models - for providers where user specifies full path (e.g., .../v1 or .../v4)
    // 2. {baseUrl}/v1/models - for providers where user specifies root URL
    let endpoints = vec![
        format!("{}/models", base_url),
        format!("{}/v1/models", base_url),
    ];
    
    let start = std::time::Instant::now();
    
    for endpoint in &endpoints {
        let response = client.get(endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await;
        let latency = start.elapsed().as_millis() as u64;
        
        match response {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    // Try to count models
                    let models_count = if let Ok(json) = resp.json::<serde_json::Value>().await {
                        json.get("data")
                            .and_then(|d| d.as_array())
                            .map(|arr| arr.len() as u32)
                    } else {
                        None
                    };
                    
                    return Ok(ProviderTestResult {
                        success: true,
                        message: format!("Connection successful! ({}ms)", latency),
                        latency_ms: Some(latency),
                        models_found: models_count,
                    });
                } else if status.as_u16() == 401 || status.as_u16() == 403 {
                    return Ok(ProviderTestResult {
                        success: false,
                        message: "Authentication failed - check your API key".to_string(),
                        latency_ms: Some(latency),
                        models_found: None,
                    });
                }
                // For 404, try the next endpoint pattern
            }
            Err(e) => {
                // For connection errors, return immediately
                if e.is_timeout() {
                    return Ok(ProviderTestResult {
                        success: false,
                        message: "Connection timed out - check your base URL".to_string(),
                        latency_ms: Some(start.elapsed().as_millis() as u64),
                        models_found: None,
                    });
                } else if e.is_connect() {
                    return Ok(ProviderTestResult {
                        success: false,
                        message: "Could not connect - check your base URL".to_string(),
                        latency_ms: Some(start.elapsed().as_millis() as u64),
                        models_found: None,
                    });
                }
            }
        }
    }
    
    // All endpoints failed with 404 or similar
    let latency = start.elapsed().as_millis() as u64;
    Ok(ProviderTestResult {
        success: false,
        message: "Provider returned 404 Not Found - check your base URL (tried /models and /v1/models)".to_string(),
        latency_ms: Some(latency),
        models_found: None,
    })
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
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    }
}

// Setup system tray
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let toggle_item = MenuItem::with_id(app, "toggle", "Toggle Proxy", true, None::<&str>)?;
    let dashboard_item = MenuItem::with_id(app, "dashboard", "Open Dashboard", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit ProxyPal", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&toggle_item, &dashboard_item, &quit_item])?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
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
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
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
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

// Detect installed CLI agents
#[tauri::command]
fn detect_cli_agents(state: State<AppState>) -> Vec<AgentStatus> {
    let home = dirs::home_dir().unwrap_or_default();
    let config = state.config.lock().unwrap();
    let endpoint = format!("http://127.0.0.1:{}", config.port);
    let mut agents = Vec::new();
    
    // 1. Claude Code - uses environment variables
    // Check if claude/claude-code binary exists
    let claude_installed = which_exists("claude");
    let claude_configured = check_env_configured("ANTHROPIC_BASE_URL", &endpoint);
    
    agents.push(AgentStatus {
        id: "claude-code".to_string(),
        name: "Claude Code".to_string(),
        description: "Anthropic's official CLI for Claude models".to_string(),
        installed: claude_installed,
        configured: claude_configured,
        config_type: "env".to_string(),
        config_path: None,
        logo: "/logos/claude.svg".to_string(),
        docs_url: "https://help.router-for.me/agent-client/claude-code.html".to_string(),
    });
    
    // 2. Codex - uses ~/.codex/config.toml and ~/.codex/auth.json
    let codex_installed = which_exists("codex");
    let codex_config = home.join(".codex/config.toml");
    let codex_configured = if codex_config.exists() {
        std::fs::read_to_string(&codex_config)
            .map(|c| c.contains("cliproxyapi") || c.contains(&endpoint))
            .unwrap_or(false)
    } else {
        false
    };
    
    agents.push(AgentStatus {
        id: "codex".to_string(),
        name: "Codex CLI".to_string(),
        description: "OpenAI's Codex CLI for GPT-5 models".to_string(),
        installed: codex_installed,
        configured: codex_configured,
        config_type: "file".to_string(),
        config_path: Some(codex_config.to_string_lossy().to_string()),
        logo: "/logos/openai.svg".to_string(),
        docs_url: "https://help.router-for.me/agent-client/codex.html".to_string(),
    });
    
    // 3. Gemini CLI - uses environment variables
    let gemini_installed = which_exists("gemini");
    let gemini_configured = check_env_configured("CODE_ASSIST_ENDPOINT", &endpoint) 
        || check_env_configured("GOOGLE_GEMINI_BASE_URL", &endpoint);
    
    agents.push(AgentStatus {
        id: "gemini-cli".to_string(),
        name: "Gemini CLI".to_string(),
        description: "Google's Gemini CLI for Gemini models".to_string(),
        installed: gemini_installed,
        configured: gemini_configured,
        config_type: "env".to_string(),
        config_path: None,
        logo: "/logos/gemini.svg".to_string(),
        docs_url: "https://help.router-for.me/agent-client/gemini-cli.html".to_string(),
    });
    
    // 4. Factory Droid - uses ~/.factory/config.json
    let droid_installed = which_exists("droid") || which_exists("factory");
    let droid_config = home.join(".factory/config.json");
    let droid_configured = if droid_config.exists() {
        std::fs::read_to_string(&droid_config)
            .map(|c| c.contains(&endpoint) || c.contains("127.0.0.1:8317"))
            .unwrap_or(false)
    } else {
        false
    };
    
    agents.push(AgentStatus {
        id: "factory-droid".to_string(),
        name: "Factory Droid".to_string(),
        description: "Factory's AI coding agent".to_string(),
        installed: droid_installed,
        configured: droid_configured,
        config_type: "file".to_string(),
        config_path: Some(droid_config.to_string_lossy().to_string()),
        logo: "/logos/droid.svg".to_string(),
        docs_url: "https://help.router-for.me/agent-client/droid.html".to_string(),
    });
    
    // 5. Amp CLI - uses ~/.config/amp/settings.json or AMP_URL env
    let amp_installed = which_exists("amp");
    let amp_config = home.join(".config/amp/settings.json");
    let amp_configured = check_env_configured("AMP_URL", &endpoint) || {
        if amp_config.exists() {
            std::fs::read_to_string(&amp_config)
                .map(|c| c.contains(&endpoint) || c.contains("localhost:8317"))
                .unwrap_or(false)
        } else {
            false
        }
    };
    
    agents.push(AgentStatus {
        id: "amp-cli".to_string(),
        name: "Amp CLI".to_string(),
        description: "Sourcegraph's Amp coding assistant".to_string(),
        installed: amp_installed,
        configured: amp_configured,
        config_type: "both".to_string(),
        config_path: Some(amp_config.to_string_lossy().to_string()),
        logo: "/logos/amp.svg".to_string(),
        docs_url: "https://help.router-for.me/agent-client/amp-cli.html".to_string(),
    });
    
    // 6. OpenCode - uses opencode.json config file with custom provider
    let opencode_installed = which_exists("opencode");
    // Check for global opencode.json in ~/.config/opencode/opencode.json
    let opencode_global_config = home.join(".config/opencode/opencode.json");
    let opencode_configured = if opencode_global_config.exists() {
        // Check if our proxypal provider is configured
        std::fs::read_to_string(&opencode_global_config)
            .map(|content| content.contains("proxypal") && content.contains(&endpoint))
            .unwrap_or(false)
    } else {
        false
    };
    
    agents.push(AgentStatus {
        id: "opencode".to_string(),
        name: "OpenCode".to_string(),
        description: "Terminal-based AI coding assistant".to_string(),
        installed: opencode_installed,
        configured: opencode_configured,
        config_type: "config".to_string(),
        config_path: Some(opencode_global_config.to_string_lossy().to_string()),
        logo: "/logos/opencode.svg".to_string(),
        docs_url: "https://opencode.ai/docs/providers/".to_string(),
    });
    
    agents
}

// Helper to check if a command exists by checking common installation paths
// Note: Using `which` command doesn't work in production builds (sandboxed macOS app)
// so we check common binary locations directly
fn which_exists(cmd: &str) -> bool {
    let home = dirs::home_dir().unwrap_or_default();
    
    // Common binary installation paths (static)
    let mut paths = vec![
        // Homebrew (Apple Silicon)
        std::path::PathBuf::from("/opt/homebrew/bin"),
        // Homebrew (Intel) / system
        std::path::PathBuf::from("/usr/local/bin"),
        // System binaries
        std::path::PathBuf::from("/usr/bin"),
        // Cargo (Rust)
        home.join(".cargo/bin"),
        // npm global (default)
        home.join(".npm-global/bin"),
        // npm global (alternative)
        std::path::PathBuf::from("/usr/local/lib/node_modules/.bin"),
        // Local bin
        home.join(".local/bin"),
        // Go binaries
        home.join("go/bin"),
        // Bun binaries
        home.join(".bun/bin"),
        // OpenCode CLI
        home.join(".opencode/bin"),
    ];
    
    // WSL-specific paths: check Windows side binaries
    // On WSL, Windows paths are accessible via /mnt/c/
    if std::path::Path::new("/mnt/c").exists() {
        let windows_home = std::path::PathBuf::from("/mnt/c/Users")
            .join(home.file_name().unwrap_or_default());
        
        // Add Windows-side paths
        paths.push(windows_home.join("scoop/shims")); // Scoop package manager
        paths.push(windows_home.join(".cargo/bin"));
        paths.push(windows_home.join("go/bin"));
        paths.push(windows_home.join(".bun/bin"));
        paths.push(windows_home.join("AppData/Local/npm"));
        paths.push(windows_home.join("AppData/Roaming/npm"));
    }
    
    // Windows-specific paths (when running on Windows directly)
    #[cfg(target_os = "windows")]
    {
        // AppData\Roaming\npm - where npm global packages are installed by default
        if let Some(app_data) = std::env::var_os("APPDATA") {
            let app_data_path = std::path::PathBuf::from(app_data);
            paths.push(app_data_path.join("npm"));
        }
        // AppData\Local paths
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            let local_app_data_path = std::path::PathBuf::from(local_app_data);
            paths.push(local_app_data_path.join("npm"));
            paths.push(local_app_data_path.join("scoop/shims"));
        }
        if let Some(program_files) = std::env::var_os("PROGRAMFILES") {
            paths.push(std::path::PathBuf::from(program_files).join("Git\\cmd"));
        }
        
        // Windows detecting WSL-installed binaries
        // Only search WSL paths if WSL is actually installed and available
        // Check by seeing if wsl.exe exists and can be executed
        let mut wsl_cmd = std::process::Command::new("wsl");
        wsl_cmd.arg("--status");
        #[cfg(target_os = "windows")]
        wsl_cmd.creation_flags(CREATE_NO_WINDOW);
        let wsl_available = wsl_cmd
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        
        if wsl_available {
            // WSL paths accessible via \\wsl.localhost\<distro>\home\<user> or \\wsl$\<distro>\home\<user>
            let wsl_distros = ["Ubuntu", "Ubuntu-22.04", "Ubuntu-24.04", "Debian"];
            let username = home.file_name().unwrap_or_default().to_string_lossy();
            
            'wsl_search: for distro in &wsl_distros {
                // Try both WSL path formats (wsl.localhost is newer, wsl$ is legacy)
                for prefix in &[r"\\wsl.localhost", r"\\wsl$"] {
                    let wsl_home = std::path::PathBuf::from(
                        format!(r"{}\{}\home\{}", prefix, distro, username)
                    );
                    if wsl_home.exists() {
                        // Standard Linux paths in WSL
                        paths.push(wsl_home.join(".local/bin"));
                        paths.push(wsl_home.join(".cargo/bin"));
                        paths.push(wsl_home.join(".bun/bin"));
                        paths.push(wsl_home.join("go/bin"));
                        paths.push(wsl_home.join(".opencode/bin"));
                        
                        // NVM node versions in WSL
                        let wsl_nvm = wsl_home.join(".nvm/versions/node");
                        if wsl_nvm.exists() {
                            if let Ok(entries) = std::fs::read_dir(&wsl_nvm) {
                                for entry in entries.flatten() {
                                    let bin_path = entry.path().join("bin");
                                    if bin_path.exists() {
                                        paths.push(bin_path);
                                    }
                                }
                            }
                        }
                        break 'wsl_search; // Found valid distro, stop searching
                    }
                }
            }
        }
    }
    
    // Add NVM node versions - scan for installed node versions
    let nvm_dir = home.join(".nvm/versions/node");
    if nvm_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            for entry in entries.flatten() {
                let bin_path = entry.path().join("bin");
                if bin_path.exists() {
                    paths.push(bin_path);
                }
            }
        }
    }
    
    // Check all paths
    for path in &paths {
        // Check base command (no extension)
        if path.join(cmd).exists() {
            return true;
        }
        // On Windows, also check common executable extensions
        #[cfg(target_os = "windows")]
        {
            for ext in &[".cmd", ".exe", ".bat", ".ps1"] {
                if path.join(format!("{}{}", cmd, ext)).exists() {
                    return true;
                }
            }
        }
    }

    false
}

// Helper to check if env var is set to expected value
fn check_env_configured(var: &str, expected_prefix: &str) -> bool {
    std::env::var(var)
        .map(|v| v.starts_with(expected_prefix))
        .unwrap_or(false)
}

// Get model context/output limits based on model ID, provider, and source
// Source: https://models.dev (sst/models.dev repo)
fn get_model_limits(model_id: &str, owned_by: &str, source: &str) -> (u64, u64) {
    // Return (context_limit, output_limit)
    // First check model_id patterns (handles Antigravity/proxied models like gemini-claude-*)
    let model_lower = model_id.to_lowercase();
    
    // Claude models (direct or via Antigravity like gemini-claude-*)
    if model_lower.contains("claude") {
        // Claude 4.5 models: 200K context, 64K output
        // Claude 3.5 haiku: 200K context, 8K output
        if model_lower.contains("3-5-haiku") || model_lower.contains("3-haiku") {
            return (168000, 8192);
        } else {
            // sonnet-4-5, opus-4-5, haiku-4-5, and other Claude 4.x models
            return (168000, 64000);
        }
    }
    
    // Gemini models (but not gemini-claude-* which is handled above)
    if model_lower.contains("gemini") {
        // Gemini 2.5 models: 1M context, 65K output
        return (880964, 65536);
    }
    
    // GPT/OpenAI models
    if model_lower.contains("gpt") || model_lower.starts_with("o1") || model_lower.starts_with("o3") {
        // o1, o3 reasoning models: 200K context, 100K output
        if model_lower.contains("o3") || model_lower.contains("o1") {
            return (168000, 100000);
        } else if model_lower.contains("gpt-5") || model_lower.contains("gpt5") {
            // GPT-5 via Copilot: 128K context (Copilot limit)
            // GPT-5 via ChatGPT/ProxyPal: 400K context
            if source == "copilot" {
                return (107520, 32768);
            } else {
                return (336000, 32768);
            }
        } else {
            // gpt-4o, gpt-4o-mini, gpt-4.1: 128K context, 16K output
            return (107520, 16384);
        }
    }
    
    // Qwen models
    if model_lower.contains("qwen") {
        // Qwen3 Coder Plus: 1M context
        if model_lower.contains("coder") {
            return (880964, 65536);
        } else {
            // Qwen3 models: 262K context (max), 65K output
            return (220201, 65536);
        }
    }
    
    // DeepSeek models
    if model_lower.contains("deepseek") {
        // deepseek-reasoner: 128K output, deepseek-chat: 8K output
        if model_lower.contains("reasoner") || model_lower.contains("r1") {
            return (107520, 128000);
        } else {
            return (107520, 8192);
        }
    }
    
    // Fallback to owned_by for any remaining models
    match owned_by {
        "anthropic" => (168000, 64000),
        "google" => (880964, 65536),
        "openai" => (107520, 16384),
        "qwen" => (220201, 65536),
        "deepseek" => (107520, 8192),
        _ => (107520, 16384) // safe defaults
    }
}

// Get display name for a model
fn get_model_display_name(model_id: &str, owned_by: &str, source: &str) -> String {
    // Convert model ID to human-readable name
    let base_name = model_id
        .replace("-", " ")
        .replace(".", " ")
        .split_whitespace()
        .map(|word| {
            let mut chars: Vec<char> = word.chars().collect();
            if !chars.is_empty() {
                chars[0] = chars[0].to_uppercase().next().unwrap_or(chars[0]);
            }
            chars.into_iter().collect::<String>()
        })
        .collect::<Vec<String>>()
        .join(" ");
    
    // Add provider prefix for clarity
    let name = match owned_by {
        "copilot" => format!("Copilot {}", base_name),
        "anthropic" => format!("{}", base_name),
        "google" => format!("{}", base_name),
        "openai" => format!("{}", base_name),
        "qwen" => format!("{}", base_name),
        _ => base_name
    };
    
    // Add source indicator for Vertex AI and other special sources
    match source {
        "vertex" => format!("{} [Vertex]", name),
        "vertex+gemini-api" => format!("{} [Vertex+API]", name),
        "copilot" => format!("{} [Copilot]", name),
        _ => name
    }
}

// Configure a CLI agent with ProxyPal
#[tauri::command]
async fn configure_cli_agent(state: State<'_, AppState>, agent_id: String, models: Vec<AvailableModel>) -> Result<serde_json::Value, String> {
    let (port, endpoint, endpoint_v1) = {
        let config = state.config.lock().unwrap();
        let port = config.port;
        let endpoint = format!("http://127.0.0.1:{}", port);
        let endpoint_v1 = format!("{}/v1", endpoint);
        (port, endpoint, endpoint_v1)
    }; // Mutex guard dropped here
    let home = dirs::home_dir().ok_or("Could not find home directory")?;

    match agent_id.as_str() {
        "claude-code" => {
            // Write config to ~/.claude/settings.json (Claude Code's config file)
            let config_dir = home.join(".claude");
            std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
            let config_path = config_dir.join("settings.json");
            
            // Find best models for each tier from available models
            // Priority: Claude > Gemini-Claude > Gemini > GPT
            let find_model = |patterns: &[&str]| -> Option<String> {
                for pattern in patterns {
                    if let Some(m) = models.iter().find(|m| m.id.contains(pattern)) {
                        return Some(m.id.clone());
                    }
                }
                None
            };
            
            // Opus tier: claude-opus > gemini-claude-opus > gpt-5(high)
            let opus_model = find_model(&["claude-opus-4", "gemini-claude-opus", "gpt-5"])
                .unwrap_or_else(|| "claude-opus-4-1-20250805".to_string());
            
            // Sonnet tier: claude-sonnet-4-5 > gemini-claude-sonnet > gpt-5
            let sonnet_model = find_model(&["claude-sonnet-4-5", "claude-sonnet-4", "gemini-claude-sonnet", "gpt-5"])
                .unwrap_or_else(|| "claude-sonnet-4-5-20250929".to_string());
            
            // Haiku tier: claude-haiku > gemini-2.5-flash > gpt-5(minimal)
            let haiku_model = find_model(&["claude-3-5-haiku", "claude-haiku", "gemini-2.5-flash", "gpt-5"])
                .unwrap_or_else(|| "claude-3-5-haiku-20241022".to_string());
            
            // Build env config for Claude Code settings.json
            let env_config = serde_json::json!({
                "ANTHROPIC_BASE_URL": endpoint,
                "ANTHROPIC_AUTH_TOKEN": "proxypal-local",
                "ANTHROPIC_DEFAULT_OPUS_MODEL": opus_model,
                "ANTHROPIC_DEFAULT_SONNET_MODEL": sonnet_model,
                "ANTHROPIC_DEFAULT_HAIKU_MODEL": haiku_model
            });
            
            // If config exists, merge with existing (preserve other settings)
            let final_config = if config_path.exists() {
                if let Ok(existing) = std::fs::read_to_string(&config_path) {
                    if let Ok(mut existing_json) = serde_json::from_str::<serde_json::Value>(&existing) {
                        // Merge env into existing config
                        if let Some(env) = existing_json.get_mut("env") {
                            if let Some(obj) = env.as_object_mut() {
                                // Update ProxyPal-related env vars
                                obj.insert("ANTHROPIC_BASE_URL".to_string(), env_config["ANTHROPIC_BASE_URL"].clone());
                                obj.insert("ANTHROPIC_AUTH_TOKEN".to_string(), env_config["ANTHROPIC_AUTH_TOKEN"].clone());
                                obj.insert("ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(), env_config["ANTHROPIC_DEFAULT_OPUS_MODEL"].clone());
                                obj.insert("ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(), env_config["ANTHROPIC_DEFAULT_SONNET_MODEL"].clone());
                                obj.insert("ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(), env_config["ANTHROPIC_DEFAULT_HAIKU_MODEL"].clone());
                            }
                        } else {
                            existing_json["env"] = env_config;
                        }
                        existing_json
                    } else {
                        serde_json::json!({ "env": env_config })
                    }
                } else {
                    serde_json::json!({ "env": env_config })
                }
            } else {
                serde_json::json!({ "env": env_config })
            };
            
            let config_str = serde_json::to_string_pretty(&final_config).map_err(|e| e.to_string())?;
            std::fs::write(&config_path, &config_str).map_err(|e| e.to_string())?;
            
            // Create a reference file with all available model options from each provider
            let reference_path = config_dir.join("proxypal-models.md");
            let reference_content = format!(r#"# ProxyPal Model Reference for Claude Code

Edit your `~/.claude/settings.json` and replace the model values in the `env` section.

## Current Configuration
```json
"ANTHROPIC_BASE_URL": "{}",
"ANTHROPIC_AUTH_TOKEN": "proxypal-local",
"ANTHROPIC_DEFAULT_OPUS_MODEL": "{}",
"ANTHROPIC_DEFAULT_SONNET_MODEL": "{}",
"ANTHROPIC_DEFAULT_HAIKU_MODEL": "{}"
```

## Available Models by Provider

### Claude (Anthropic)
| Tier | Model ID |
|------|----------|
| Opus | `claude-opus-4-1-20250805`, `claude-opus-4-5-20251101` |
| Sonnet | `claude-sonnet-4-5-20250929`, `claude-sonnet-4-20250514` |
| Haiku | `claude-3-5-haiku-20241022` |

### Gemini via Antigravity (with extended thinking)
| Tier | Model ID |
|------|----------|
| Opus | `gemini-claude-opus-4-5-thinking` |
| Sonnet | `gemini-claude-sonnet-4-5-thinking`, `gemini-claude-sonnet-4-5` |
| Haiku | `gemini-2.5-flash`, `gemini-2.5-flash-lite` |

### Gemini (Google)
| Tier | Model ID |
|------|----------|
| Opus | `gemini-2.5-pro` |
| Sonnet | `gemini-2.5-flash` |
| Haiku | `gemini-2.5-flash-lite` |

### Vertex AI (Google Cloud)
| Tier | Model ID |
|------|----------|
| Opus | `gemini-2.5-pro`, `gemini-3-pro-preview` |
| Sonnet | `gemini-2.5-flash`, `gemini-3-pro-image-preview` |
| Haiku | `gemini-2.5-flash-lite` |

> **Note**: Vertex AI uses Google Cloud service account authentication.
> Import your service account JSON in ProxyPal to use these models.

### OpenAI GPT-5
| Tier | Model ID |
|------|----------|
| Opus | `gpt-5(high)`, `gpt-5` |
| Sonnet | `gpt-5(medium)`, `gpt-5-codex` |
| Haiku | `gpt-5(minimal)`, `gpt-5(low)` |

### Qwen
| Tier | Model ID |
|------|----------|
| Opus | `qwen3-coder-plus`, `qwen3-max` |
| Sonnet | `qwen3-coder-plus` |
| Haiku | `qwen3-coder-flash`, `qwen3-235b-a22b-instruct` |

### iFlow
| Tier | Model ID |
|------|----------|
| Opus | `qwen3-max` |
| Sonnet | `qwen3-coder-plus` |
| Haiku | `qwen3-235b-a22b-instruct` |

## Example Configurations

### Use Gemini Antigravity (with thinking)
```json
"ANTHROPIC_DEFAULT_OPUS_MODEL": "gemini-claude-opus-4-5-thinking",
"ANTHROPIC_DEFAULT_SONNET_MODEL": "gemini-claude-sonnet-4-5-thinking",
"ANTHROPIC_DEFAULT_HAIKU_MODEL": "gemini-2.5-flash"
```

### Use OpenAI GPT-5
```json
"ANTHROPIC_DEFAULT_OPUS_MODEL": "gpt-5(high)",
"ANTHROPIC_DEFAULT_SONNET_MODEL": "gpt-5(medium)",
"ANTHROPIC_DEFAULT_HAIKU_MODEL": "gpt-5(minimal)"
```

### Use Qwen
```json
"ANTHROPIC_DEFAULT_OPUS_MODEL": "qwen3-coder-plus",
"ANTHROPIC_DEFAULT_SONNET_MODEL": "qwen3-coder-plus",
"ANTHROPIC_DEFAULT_HAIKU_MODEL": "qwen3-coder-flash"
```

---
Generated by ProxyPal. Run `claude` to start using Claude Code.
"#, endpoint, opus_model, sonnet_model, haiku_model);
            
            std::fs::write(&reference_path, &reference_content).map_err(|e| e.to_string())?;
            
            Ok(serde_json::json!({
                "success": true,
                "configType": "config",
                "configPath": config_path.to_string_lossy(),
                "modelsConfigured": models.len(),
                "instructions": format!("ProxyPal configured for Claude Code. See {} for all available model options from different providers.", reference_path.to_string_lossy())
            }))
        },
        
        "codex" => {
            // Create ~/.codex directory
            let codex_dir = home.join(".codex");
            std::fs::create_dir_all(&codex_dir).map_err(|e| e.to_string())?;
            
            // Write config.toml
            let config_content = format!(r#"# ProxyPal - Codex Configuration
model_provider = "cliproxyapi"
model = "gpt-5-codex"
model_reasoning_effort = "high"

[model_providers.cliproxyapi]
name = "cliproxyapi"
base_url = "{}/v1"
wire_api = "responses"
"#, endpoint);
            
            let config_path = codex_dir.join("config.toml");
            std::fs::write(&config_path, &config_content).map_err(|e| e.to_string())?;
            
            // Write auth.json
            let auth_content = r#"{
  "OPENAI_API_KEY": "proxypal-local"
}"#;
            let auth_path = codex_dir.join("auth.json");
            std::fs::write(&auth_path, auth_content).map_err(|e| e.to_string())?;
            
            Ok(serde_json::json!({
                "success": true,
                "configType": "file",
                "configPath": config_path.to_string_lossy(),
                "authPath": auth_path.to_string_lossy(),
                "instructions": "Codex has been configured. Run 'codex' to start using it."
            }))
        },

        "gemini-cli" => {
            // Generate shell config for Gemini CLI
            let shell_config = format!(r#"# ProxyPal - Gemini CLI Configuration
# Option 1: OAuth mode (local only)
export CODE_ASSIST_ENDPOINT="{}"

# Option 2: API Key mode (works with any IP/domain)
# export GOOGLE_GEMINI_BASE_URL="{}"
# export GEMINI_API_KEY="proxypal-local"
"#, endpoint, endpoint);

            Ok(serde_json::json!({
                "success": true,
                "configType": "env",
                "shellConfig": shell_config,
                "instructions": "Add the above to your ~/.bashrc, ~/.zshrc, or shell config file, then restart your terminal."
            }))
        },
        
        "factory-droid" => {
            // Create ~/.factory directory
            let factory_dir = home.join(".factory");
            std::fs::create_dir_all(&factory_dir).map_err(|e| e.to_string())?;
            
            // Build dynamic custom_models array from available models
            let proxypal_models: Vec<serde_json::Value> = models.iter().map(|m| {
                let (base_url, provider) = match m.owned_by.as_str() {
                    "anthropic" => (endpoint.clone(), "anthropic"),
                    _ => (format!("{}/v1", endpoint), "openai"),
                };
                
                // Add source indicator to model display name for clarity
                let display_name = match m.source.as_str() {
                    "vertex" => format!("{} [Vertex]", m.id),
                    "vertex+gemini-api" => format!("{} [Vertex+API]", m.id),
                    "copilot" => format!("{} [Copilot]", m.id),
                    _ => m.id.clone(),
                };
                
                serde_json::json!({
                    "model": m.id,
                    "model_display_name": display_name,
                    "base_url": base_url,
                    "api_key": "proxypal-local",
                    "provider": provider
                })
            }).collect();
            
            let config_path = factory_dir.join("config.json");
            
            // Merge with existing config to preserve user's other custom_models
            let final_config = if config_path.exists() {
                if let Ok(existing) = std::fs::read_to_string(&config_path) {
                    if let Ok(mut existing_json) = serde_json::from_str::<serde_json::Value>(&existing) {
                        // Get existing custom_models, filter out proxypal entries, then add new ones
                        let mut merged_models: Vec<serde_json::Value> = Vec::new();
                        
                        // Keep existing models that are NOT from proxypal (don't have proxypal-local api_key)
                        if let Some(existing_models) = existing_json.get("custom_models").and_then(|v| v.as_array()) {
                            for model in existing_models {
                                let is_proxypal = model.get("api_key")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s == "proxypal-local")
                                    .unwrap_or(false);
                                if !is_proxypal {
                                    merged_models.push(model.clone());
                                }
                            }
                        }
                        
                        // Add all proxypal models
                        merged_models.extend(proxypal_models);
                        
                        // Update the custom_models field
                        existing_json["custom_models"] = serde_json::json!(merged_models);
                        existing_json
                    } else {
                        // Existing file is not valid JSON, create new
                        serde_json::json!({ "custom_models": proxypal_models })
                    }
                } else {
                    // Can't read file, create new
                    serde_json::json!({ "custom_models": proxypal_models })
                }
            } else {
                // No existing config, create new
                serde_json::json!({ "custom_models": proxypal_models })
            };
            
            let config_str = serde_json::to_string_pretty(&final_config).map_err(|e| e.to_string())?;
            std::fs::write(&config_path, &config_str).map_err(|e| e.to_string())?;
            
            Ok(serde_json::json!({
                "success": true,
                "configType": "file",
                "configPath": config_path.to_string_lossy(),
                "modelsConfigured": models.len(),
                "instructions": "Factory Droid has been configured. Run 'droid' or 'factory' to start using it."
            }))
        },
        
        "amp-cli" => {
            // Create ~/.config/amp directory
            let amp_dir = home.join(".config/amp");
            std::fs::create_dir_all(&amp_dir).map_err(|e| e.to_string())?;
            
            // Amp CLI requires localhost URL (not 127.0.0.1) per CLIProxyAPI docs
            // See: https://help.router-for.me/agent-client/amp-cli.html
            let amp_endpoint = format!("http://localhost:{}", port);
            
            // NOTE: Model mappings are configured in CLIProxyAPI's config.yaml (proxy-config.yaml),
            // NOT in Amp's settings.json. Amp CLI doesn't support amp.modelMapping setting.
            // The mappings in ProxyPal settings are written to CLIProxyAPI config when proxy starts.
            // See: https://help.router-for.me/agent-client/amp-cli.html#model-fallback-behavior
            
            // ProxyPal settings to add/update (only valid Amp CLI settings)
            let proxypal_settings = serde_json::json!({
                // Core proxy URL - routes all Amp traffic through CLIProxyAPI
                "amp.url": amp_endpoint,
                
                // API key for authentication with the proxy
                // This matches the api-keys in CLIProxyAPI config
                "amp.apiKey": "proxypal-local",
                
                // Enable extended thinking for Claude models
                "amp.anthropic.thinking.enabled": true,
                
                // Enable TODOs tracking
                "amp.todos.enabled": true,
                
                // Git commit settings - add Amp thread link and co-author
                "amp.git.commit.ampThread.enabled": true,
                "amp.git.commit.coauthor.enabled": true,
                
                // Tool timeout (5 minutes)
                "amp.tools.stopTimeout": 300,
                
                // Auto-update mode
                "amp.updates.mode": "auto"
            });
            
            let config_path = amp_dir.join("settings.json");
            
            // Merge with existing config to preserve user's other settings
            let final_config = if config_path.exists() {
                if let Ok(existing) = std::fs::read_to_string(&config_path) {
                    if let Ok(mut existing_json) = serde_json::from_str::<serde_json::Value>(&existing) {
                        // Merge proxypal settings into existing config
                        if let Some(existing_obj) = existing_json.as_object_mut() {
                            if let Some(new_obj) = proxypal_settings.as_object() {
                                for (key, value) in new_obj {
                                    existing_obj.insert(key.clone(), value.clone());
                                }
                            }
                            // Remove invalid amp.modelMapping key if it exists
                            // Model mappings should be in CLIProxyAPI config, not Amp settings
                            existing_obj.remove("amp.modelMapping");
                        }
                        existing_json
                    } else {
                        // Existing file is not valid JSON, create new
                        proxypal_settings
                    }
                } else {
                    // Can't read file, create new
                    proxypal_settings
                }
            } else {
                // No existing config, create new
                proxypal_settings
            };
            
            let settings_content = serde_json::to_string_pretty(&final_config).map_err(|e| e.to_string())?;
            std::fs::write(&config_path, &settings_content).map_err(|e| e.to_string())?;
            
            // Also provide env var option and API key instructions
            let shell_config = format!(r#"# ProxyPal - Amp CLI Configuration (alternative to settings.json)
export AMP_URL="{}"
export AMP_API_KEY="proxypal-local"

# For Amp cloud features, get your API key from https://ampcode.com/settings
# and add it to ProxyPal Settings > Amp CLI Integration > Amp API Key
"#, amp_endpoint);
            
            Ok(serde_json::json!({
                "success": true,
                "configType": "both",
                "configPath": config_path.to_string_lossy(),
                "shellConfig": shell_config,
                "instructions": "Amp CLI has been configured. Run 'amp' to start using it. The API key 'proxypal-local' is pre-configured for local proxy access."
            }))
        },
        
        "opencode" => {
            let home = dirs::home_dir().ok_or("Could not find home directory")?;
            let config_dir = home.join(".config/opencode");
            tokio::fs::create_dir_all(&config_dir).await.map_err(|e| e.to_string())?;
            let config_path = config_dir.join("opencode.json");
            
            // Build dynamic models object from available models
            // OpenCode needs model configs with name and limits
            let mut models_obj = serde_json::Map::new();
            
            // Get user's thinking budget setting
            let user_thinking_budget: u64 = {
                let config = state.config.lock().unwrap();
                let mode = if config.thinking_budget_mode.is_empty() {
                    "medium"
                } else {
                    &config.thinking_budget_mode
                };
                let custom = if config.thinking_budget_custom == 0 {
                    16000
                } else {
                    config.thinking_budget_custom
                };
                match mode {
                    "low" => 2048,
                    "medium" => 8192,
                    "high" => 32768,
                    "custom" => custom as u64,
                    _ => 8192,
                }
            };
            
            // Get user's reasoning effort setting for GPT/Codex models
            let user_reasoning_effort: &str = {
                let config = state.config.lock().unwrap();
                let level = if config.reasoning_effort_level.is_empty() {
                    "medium"
                } else {
                    &config.reasoning_effort_level
                };
                // Leak to get 'static lifetime - this is fine for a single config value
                Box::leak(level.to_string().into_boxed_str())
            };
            
            for m in &models {
                let (context_limit, output_limit) = get_model_limits(&m.id, &m.owned_by, &m.source);
                let display_name = get_model_display_name(&m.id, &m.owned_by, &m.source);
                // Enable reasoning display for models with "-thinking" suffix
                let is_thinking_model = m.id.ends_with("-thinking");
                // Check if this is a GPT-5.x model (Codex reasoning models)
                let is_gpt5_model = m.id.starts_with("gpt-5");
                // Use user's configured thinking budget
                let thinking_budget: u64 = user_thinking_budget;
                let min_thinking_output: u64 = thinking_budget + 8192;  // thinking + 8K buffer for response
                let effective_output_limit = if is_thinking_model { 
                    std::cmp::max(output_limit, min_thinking_output) 
                } else { 
                    output_limit 
                };
                
                let mut model_config = serde_json::json!({
                    "name": display_name,
                    "limit": { "context": context_limit, "output": effective_output_limit }
                });
                if is_thinking_model {
                    // Enable extended thinking
                    model_config["reasoning"] = serde_json::json!(true);
                    // Check if this is a Claude thinking model (uses thinking.budgetTokens)
                    // vs OpenAI o-series (uses reasoningEffort)
                    let is_claude_thinking = m.id.contains("claude") && m.id.ends_with("-thinking");
                    if is_claude_thinking {
                        model_config["options"] = serde_json::json!({
                            "thinking": {
                                "type": "enabled",
                                "budgetTokens": thinking_budget
                            }
                        });
                    } else {
                        // OpenAI o-series models use reasoningEffort
                        model_config["options"] = serde_json::json!({
                            "reasoningEffort": "high"
                        });
                    }
                } else if is_gpt5_model && user_reasoning_effort != "none" {
                    // Add reasoning effort for GPT-5.x models (Codex)
                    model_config["reasoning"] = serde_json::json!(true);
                    model_config["options"] = serde_json::json!({
                        "reasoningEffort": user_reasoning_effort
                    });
                }
                models_obj.insert(m.id.clone(), model_config);
            }
            
            // Create or update opencode.json with proxypal provider
            // Use @ai-sdk/anthropic for native Anthropic API (better for Claude models with thinking)
            let opencode_config = serde_json::json!({
                "$schema": "https://opencode.ai/config.json",
                "provider": {
                    "proxypal": {
                        "npm": "@ai-sdk/anthropic",
                        "name": "ProxyPal",
                        "options": {
                            "baseURL": endpoint_v1,
                            "apiKey": "proxypal-local",
                            "includeUsage": true
                        },
                        "models": models_obj
                    }
                }
            });
            
            // If config exists, merge with existing
            let final_config = if config_path.exists() {
                if let Ok(existing) = std::fs::read_to_string(&config_path) {
                    if let Ok(mut existing_json) = serde_json::from_str::<serde_json::Value>(&existing) {
                        // Merge provider into existing config
                        if let Some(providers) = existing_json.get_mut("provider") {
                            if let Some(obj) = providers.as_object_mut() {
                                obj.insert("proxypal".to_string(), opencode_config["provider"]["proxypal"].clone());
                            }
                        } else {
                            existing_json["provider"] = opencode_config["provider"].clone();
                        }
                        existing_json
                    } else {
                        opencode_config
                    }
                } else {
                    opencode_config
                }
            } else {
                opencode_config
            };
            
            let config_str = serde_json::to_string_pretty(&final_config).map_err(|e| e.to_string())?;
            std::fs::write(&config_path, &config_str).map_err(|e| e.to_string())?;
            
            Ok(serde_json::json!({
                "success": true,
                "configType": "config",
                "configPath": config_path.to_string_lossy(),
                "modelsConfigured": models.len(),
                "instructions": "ProxyPal provider added to OpenCode. Run 'opencode' and use /models to select a model (e.g., proxypal/gemini-2.5-pro). OpenCode uses AI SDK (ai-sdk.dev) and models.dev registry."
            }))
        },
        
        _ => Err(format!("Unknown agent: {}", agent_id)),
    }
}

// Get shell profile path
#[tauri::command]
fn get_shell_profile_path() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;

    // Check for common shell config files
    let shell = std::env::var("SHELL").unwrap_or_default();

    let profile_path = if shell.contains("zsh") {
        home.join(".zshrc")
    } else if shell.contains("bash") {
        // Prefer .bashrc on Linux, .bash_profile on macOS
        #[cfg(target_os = "macos")]
        let path = home.join(".bash_profile");
        #[cfg(not(target_os = "macos"))]
        let path = home.join(".bashrc");
        path
    } else if shell.contains("fish") {
        home.join(".config/fish/config.fish")
    } else {
        // Default to .profile
        home.join(".profile")
    };

    Ok(profile_path.to_string_lossy().to_string())
}

// Append environment config to shell profile
#[tauri::command]
fn append_to_shell_profile(content: String) -> Result<String, String> {
    let profile_path = get_shell_profile_path()?;
    let path = std::path::Path::new(&profile_path);

    // Read existing content
    let existing = std::fs::read_to_string(path).unwrap_or_default();

    // Check if ProxyPal config already exists
    if existing.contains("# ProxyPal") {
        return Err("ProxyPal configuration already exists in shell profile. Please remove it first or update manually.".to_string());
    }

    // Append new config
    let new_content = format!("{}\n\n{}", existing.trim_end(), content);
    std::fs::write(path, new_content).map_err(|e| e.to_string())?;

    Ok(profile_path)
}

// Detect installed AI coding tools
#[tauri::command]
fn detect_ai_tools() -> Vec<DetectedTool> {
    let home = dirs::home_dir().unwrap_or_default();
    let mut tools = Vec::new();
    
    // Check for Cursor
    #[cfg(target_os = "macos")]
    let cursor_app = std::path::Path::new("/Applications/Cursor.app").exists();
    #[cfg(target_os = "windows")]
    let cursor_app = dirs::data_local_dir()
        .map(|p| p.join("Programs/cursor/Cursor.exe").exists())
        .unwrap_or(false);
    #[cfg(target_os = "linux")]
    let cursor_app = home.join(".local/share/applications/cursor.desktop").exists() 
        || std::path::Path::new("/usr/share/applications/cursor.desktop").exists();
    
    tools.push(DetectedTool {
        id: "cursor".to_string(),
        name: "Cursor".to_string(),
        installed: cursor_app,
        config_path: None, // Cursor doesn't support custom API base URL
        can_auto_configure: false,
    });
    
    // Check for VS Code (needed for Continue/Cline)
    #[cfg(target_os = "macos")]
    let vscode_installed = std::path::Path::new("/Applications/Visual Studio Code.app").exists();
    #[cfg(target_os = "windows")]
    let vscode_installed = dirs::data_local_dir()
        .map(|p| p.join("Programs/Microsoft VS Code/Code.exe").exists())
        .unwrap_or(false);
    #[cfg(target_os = "linux")]
    let vscode_installed = std::path::Path::new("/usr/bin/code").exists();
    
    // Check for Continue extension (config file)
    let continue_config = home.join(".continue");
    let continue_yaml = continue_config.join("config.yaml");
    let continue_json = continue_config.join("config.json");
    let continue_installed = continue_yaml.exists() || continue_json.exists() || continue_config.exists();
    
    tools.push(DetectedTool {
        id: "continue".to_string(),
        name: "Continue".to_string(),
        installed: continue_installed || vscode_installed,
        config_path: if continue_yaml.exists() {
            Some(continue_yaml.to_string_lossy().to_string())
        } else if continue_json.exists() {
            Some(continue_json.to_string_lossy().to_string())
        } else {
            Some(continue_yaml.to_string_lossy().to_string()) // Default to yaml
        },
        can_auto_configure: true, // Continue has editable config
    });
    
    // Check for Cline extension
    #[cfg(target_os = "macos")]
    let cline_storage = home.join("Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev");
    #[cfg(target_os = "windows")]
    let cline_storage = dirs::data_dir()
        .map(|p| p.join("Code/User/globalStorage/saoudrizwan.claude-dev"))
        .unwrap_or_default();
    #[cfg(target_os = "linux")]
    let cline_storage = home.join(".config/Code/User/globalStorage/saoudrizwan.claude-dev");
    
    tools.push(DetectedTool {
        id: "cline".to_string(),
        name: "Cline".to_string(),
        installed: cline_storage.exists() || vscode_installed,
        config_path: None, // Cline uses VS Code settings UI
        can_auto_configure: false,
    });
    
    // Check for Windsurf
    #[cfg(target_os = "macos")]
    let windsurf_app = std::path::Path::new("/Applications/Windsurf.app").exists();
    #[cfg(target_os = "windows")]
    let windsurf_app = dirs::data_local_dir()
        .map(|p| p.join("Programs/Windsurf/Windsurf.exe").exists())
        .unwrap_or(false);
    #[cfg(target_os = "linux")]
    let windsurf_app = std::path::Path::new("/usr/bin/windsurf").exists();
    
    tools.push(DetectedTool {
        id: "windsurf".to_string(),
        name: "Windsurf".to_string(),
        installed: windsurf_app,
        config_path: None,
        can_auto_configure: false,
    });
    
    tools
}

// Configure Continue extension with ProxyPal endpoint
#[tauri::command]
fn configure_continue(state: State<AppState>) -> Result<String, String> {
    let config = state.config.lock().unwrap();
    let endpoint = format!("http://localhost:{}/v1", config.port);
    
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let continue_dir = home.join(".continue");
    
    // Create directory if it doesn't exist
    std::fs::create_dir_all(&continue_dir).map_err(|e| e.to_string())?;
    
    let config_path = continue_dir.join("config.yaml");
    
    // Check if config already exists
    let existing_content = std::fs::read_to_string(&config_path).unwrap_or_default();
    
    // If config exists and already has ProxyPal, update it
    if existing_content.contains("ProxyPal") || existing_content.contains(&endpoint) {
        return Ok("Continue is already configured with ProxyPal".to_string());
    }
    
    // Create new config or append to existing
    let new_config = if existing_content.is_empty() {
        format!(r#"# Continue configuration - Auto-configured by ProxyPal
name: ProxyPal Config
version: 0.0.1
schema: v1

models:
  - name: ProxyPal (Auto-routed)
    provider: openai
    model: gpt-4
    apiKey: proxypal-local
    apiBase: {}
    roles:
      - chat
      - edit
      - apply
"#, endpoint)
    } else {
        // Append ProxyPal model to existing config
        format!(r#"{}
  # Added by ProxyPal
  - name: ProxyPal (Auto-routed)
    provider: openai
    model: gpt-4
    apiKey: proxypal-local
    apiBase: {}
    roles:
      - chat
      - edit
      - apply
"#, existing_content.trim_end(), endpoint)
    };
    
    std::fs::write(&config_path, new_config).map_err(|e| e.to_string())?;
    
    Ok(config_path.to_string_lossy().to_string())
}

// ============================================
// API Keys Management - CRUD operations via Management API
// ============================================

// Helper to build HTTP client for Management API
fn build_management_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

// Helper to get Management API base URL
fn get_management_url(port: u16, endpoint: &str) -> String {
    format!("http://127.0.0.1:{}/v0/management/{}", port, endpoint)
}

// Convert Management API kebab-case keys to camelCase for frontend
// The Management API returns data wrapped in an object like: { "gemini-api-key": [...] }
// It may also return null for empty lists: { "gemini-api-key": null }
fn convert_api_key_response<T: serde::de::DeserializeOwned>(json: serde_json::Value, wrapper_key: &str) -> Result<Vec<T>, String> {
    // Extract the array from the wrapper object
    let array_value = match &json {
        serde_json::Value::Object(obj) => {
            match obj.get(wrapper_key) {
                Some(serde_json::Value::Array(arr)) => serde_json::Value::Array(arr.clone()),
                Some(serde_json::Value::Null) | None => serde_json::Value::Array(vec![]), // null or missing = empty array
                Some(other) => return Err(format!("Expected array or null for key '{}', got: {:?}", wrapper_key, other)),
            }
        }
        serde_json::Value::Array(_) => json.clone(), // Already an array, use as-is
        serde_json::Value::Null => serde_json::Value::Array(vec![]), // Top-level null = empty array
        _ => return Err(format!("Unexpected response format: expected object with key '{}' or array", wrapper_key)),
    };
    
    // The Management API returns kebab-case, we need to convert
    let json_str = serde_json::to_string(&array_value).map_err(|e| e.to_string())?;
    // Replace kebab-case with camelCase for our structs
    let converted = json_str
        .replace("\"api-key\"", "\"apiKey\"")
        .replace("\"base-url\"", "\"baseUrl\"")
        .replace("\"proxy-url\"", "\"proxyUrl\"")
        .replace("\"excluded-models\"", "\"excludedModels\"")
        .replace("\"api-key-entries\"", "\"apiKeyEntries\"");
    serde_json::from_str(&converted).map_err(|e| e.to_string())
}

// Convert camelCase to kebab-case for Management API
fn convert_to_management_format<T: serde::Serialize>(data: &T) -> Result<serde_json::Value, String> {
    let json_str = serde_json::to_string(data).map_err(|e| e.to_string())?;
    let converted = json_str
        .replace("\"apiKey\"", "\"api-key\"")
        .replace("\"baseUrl\"", "\"base-url\"")
        .replace("\"proxyUrl\"", "\"proxy-url\"")
        .replace("\"excludedModels\"", "\"excluded-models\"")
        .replace("\"apiKeyEntries\"", "\"api-key-entries\"");
    serde_json::from_str(&converted).map_err(|e| e.to_string())
}

// Gemini API Keys
#[tauri::command]
async fn get_gemini_api_keys(state: State<'_, AppState>) -> Result<Vec<GeminiApiKey>, String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "gemini-api-key");
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Gemini API keys: {}", e))?;
    
    if !response.status().is_success() {
        return Ok(Vec::new());
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    convert_api_key_response(json, "gemini-api-key")
}

#[tauri::command]
async fn set_gemini_api_keys(state: State<'_, AppState>, keys: Vec<GeminiApiKey>) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "gemini-api-key");
    
    let client = build_management_client();
    let body = convert_to_management_format(&keys)?;
    
    let response = client
        .put(&url)
        .header("X-Management-Key", &get_management_key())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to set Gemini API keys: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to set Gemini API keys: {} - {}", status, text));
    }
    
    // Persist to ProxyPal config for restart persistence
    {
        let mut config = state.config.lock().unwrap();
        config.gemini_api_keys = keys;
        save_config_to_file(&config)?;
    }
    
    Ok(())
}

#[tauri::command]
async fn add_gemini_api_key(state: State<'_, AppState>, key: GeminiApiKey) -> Result<(), String> {
    let mut keys = get_gemini_api_keys(state.clone()).await?;
    keys.push(key);
    set_gemini_api_keys(state, keys).await
}

#[tauri::command]
async fn delete_gemini_api_key(state: State<'_, AppState>, index: usize) -> Result<(), String> {
    let mut keys = get_gemini_api_keys(state.clone()).await?;
    if index >= keys.len() {
        return Err("Index out of bounds".to_string());
    }
    keys.remove(index);
    set_gemini_api_keys(state, keys).await
}

// Claude API Keys
#[tauri::command]
async fn get_claude_api_keys(state: State<'_, AppState>) -> Result<Vec<ClaudeApiKey>, String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "claude-api-key");
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Claude API keys: {}", e))?;
    
    if !response.status().is_success() {
        return Ok(Vec::new());
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    convert_api_key_response(json, "claude-api-key")
}

#[tauri::command]
async fn set_claude_api_keys(state: State<'_, AppState>, keys: Vec<ClaudeApiKey>) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "claude-api-key");
    
    let client = build_management_client();
    let body = convert_to_management_format(&keys)?;
    
    let response = client
        .put(&url)
        .header("X-Management-Key", &get_management_key())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to set Claude API keys: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to set Claude API keys: {} - {}", status, text));
    }
    
    // Persist to ProxyPal config for restart persistence
    {
        let mut config = state.config.lock().unwrap();
        config.claude_api_keys = keys;
        save_config_to_file(&config)?;
    }
    
    Ok(())
}

#[tauri::command]
async fn add_claude_api_key(state: State<'_, AppState>, key: ClaudeApiKey) -> Result<(), String> {
    let mut keys = get_claude_api_keys(state.clone()).await?;
    keys.push(key);
    set_claude_api_keys(state, keys).await
}

#[tauri::command]
async fn delete_claude_api_key(state: State<'_, AppState>, index: usize) -> Result<(), String> {
    let mut keys = get_claude_api_keys(state.clone()).await?;
    if index >= keys.len() {
        return Err("Index out of bounds".to_string());
    }
    keys.remove(index);
    set_claude_api_keys(state, keys).await
}

// Codex API Keys
#[tauri::command]
async fn get_codex_api_keys(state: State<'_, AppState>) -> Result<Vec<CodexApiKey>, String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "codex-api-key");
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Codex API keys: {}", e))?;
    
    if !response.status().is_success() {
        return Ok(Vec::new());
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    convert_api_key_response(json, "codex-api-key")
}

#[tauri::command]
async fn set_codex_api_keys(state: State<'_, AppState>, keys: Vec<CodexApiKey>) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "codex-api-key");
    
    let client = build_management_client();
    let body = convert_to_management_format(&keys)?;
    
    let response = client
        .put(&url)
        .header("X-Management-Key", &get_management_key())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to set Codex API keys: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to set Codex API keys: {} - {}", status, text));
    }
    
    // Persist to ProxyPal config for restart persistence
    {
        let mut config = state.config.lock().unwrap();
        config.codex_api_keys = keys;
        save_config_to_file(&config)?;
    }
    
    Ok(())
}

#[tauri::command]
async fn add_codex_api_key(state: State<'_, AppState>, key: CodexApiKey) -> Result<(), String> {
    let mut keys = get_codex_api_keys(state.clone()).await?;
    keys.push(key);
    set_codex_api_keys(state, keys).await
}

#[tauri::command]
async fn delete_codex_api_key(state: State<'_, AppState>, index: usize) -> Result<(), String> {
    let mut keys = get_codex_api_keys(state.clone()).await?;
    if index >= keys.len() {
        return Err("Index out of bounds".to_string());
    }
    keys.remove(index);
    set_codex_api_keys(state, keys).await
}

// ============================================
// Provider Health Check
// ============================================

#[tauri::command]
async fn check_provider_health(state: State<'_, AppState>) -> Result<ProviderHealth, String> {
    let (port, proxy_running) = {
        let config = state.config.lock().unwrap();
        let status = state.proxy_status.lock().unwrap();
        (config.port, status.running)
    };
    
    let auth_status = state.auth_status.lock().unwrap().clone();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    
    // If proxy is not running, all providers are offline
    if !proxy_running {
        let offline_status = HealthStatus {
            status: "offline".to_string(),
            latency_ms: None,
            last_checked: now,
        };
        return Ok(ProviderHealth {
            claude: offline_status.clone(),
            openai: offline_status.clone(),
            gemini: offline_status.clone(),
            qwen: offline_status.clone(),
            iflow: offline_status.clone(),
            vertex: offline_status.clone(),
            antigravity: offline_status,
        });
    }
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    
    // Check health for each provider based on auth status
    // Note: We use a single /v1/models call since the proxy handles routing
    // For now, if the proxy is responsive, all configured providers are healthy
    let models_url = format!("http://127.0.0.1:{}/v1/models", port);
    let start = std::time::Instant::now();
    let (proxy_healthy, latency) = match client
        .get(&models_url)
        .header("Authorization", "Bearer proxypal-local")
        .send()
        .await
    {
        Ok(response) => {
            let latency = start.elapsed().as_millis() as u64;
            (response.status().is_success(), Some(latency))
        }
        Err(_) => (false, None),
    };
    
    // Build health status for each provider
    let make_status = |is_configured: bool| -> HealthStatus {
        if !is_configured {
            HealthStatus {
                status: "unconfigured".to_string(),
                latency_ms: None,
                last_checked: now,
            }
        } else if !proxy_healthy {
            HealthStatus {
                status: "offline".to_string(),
                latency_ms: latency,
                last_checked: now,
            }
        } else {
            let is_degraded = latency.map(|l| l > 2000).unwrap_or(false);
            HealthStatus {
                status: if is_degraded { "degraded" } else { "healthy" }.to_string(),
                latency_ms: latency,
                last_checked: now,
            }
        }
    };
    
    Ok(ProviderHealth {
        claude: make_status(auth_status.claude > 0),
        openai: make_status(auth_status.openai > 0),
        gemini: make_status(auth_status.gemini > 0),
        qwen: make_status(auth_status.qwen > 0),
        iflow: make_status(auth_status.iflow > 0),
        vertex: make_status(auth_status.vertex > 0),
        antigravity: make_status(auth_status.antigravity > 0),
    })
}

// ============================================
// Thinking Budget Settings
// ============================================

// ============================================
// Claude Code Settings (from ~/.claude/settings.json)
// ============================================

#[tauri::command]
async fn get_claude_code_settings() -> Result<crate::types::agents::ClaudeCodeSettings, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let config_path = home.join(".claude").join("settings.json");
    
    if !config_path.exists() {
        return Ok(crate::types::agents::ClaudeCodeSettings {
            haiku_model: None,
            opus_model: None,
            sonnet_model: None,
            base_url: None,
            auth_token: None,
        });
    }
    
    let content = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    
    let env = json.get("env").and_then(|e| e.as_object());
    
    Ok(crate::types::agents::ClaudeCodeSettings {
        haiku_model: env.and_then(|e| e.get("ANTHROPIC_DEFAULT_HAIKU_MODEL")).and_then(|v| v.as_str()).map(String::from),
        opus_model: env.and_then(|e| e.get("ANTHROPIC_DEFAULT_OPUS_MODEL")).and_then(|v| v.as_str()).map(String::from),
        sonnet_model: env.and_then(|e| e.get("ANTHROPIC_DEFAULT_SONNET_MODEL")).and_then(|v| v.as_str()).map(String::from),
        base_url: env.and_then(|e| e.get("ANTHROPIC_BASE_URL")).and_then(|v| v.as_str()).map(String::from),
        auth_token: env.and_then(|e| e.get("ANTHROPIC_AUTH_TOKEN")).and_then(|v| v.as_str()).map(String::from),
    })
}

#[tauri::command]
async fn set_claude_code_model(model_type: String, model_name: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let config_dir = home.join(".claude");
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let config_path = config_dir.join("settings.json");
    
    // Read existing config or create new
    let mut json: serde_json::Value = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    
    // Ensure env object exists
    if json.get("env").is_none() {
        json["env"] = serde_json::json!({});
    }
    
    // Map model_type to env var name
    let env_key = match model_type.as_str() {
        "haiku" => "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "opus" => "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "sonnet" => "ANTHROPIC_DEFAULT_SONNET_MODEL",
        _ => return Err(format!("Unknown model type: {}", model_type)),
    };
    
    // Update the model
    if let Some(env) = json.get_mut("env").and_then(|e| e.as_object_mut()) {
        env.insert(env_key.to_string(), serde_json::Value::String(model_name));
    }
    
    // Write back
    let config_str = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, config_str).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
async fn get_thinking_budget_settings(state: State<'_, AppState>) -> Result<ThinkingBudgetSettings, String> {
    let config = state.config.lock().unwrap();
    let mode = if config.thinking_budget_mode.is_empty() {
        "medium".to_string()
    } else {
        config.thinking_budget_mode.clone()
    };
    let custom_budget = if config.thinking_budget_custom == 0 {
        16000
    } else {
        config.thinking_budget_custom
    };
    Ok(ThinkingBudgetSettings { mode, custom_budget })
}

#[tauri::command]
async fn set_thinking_budget_settings(state: State<'_, AppState>, settings: ThinkingBudgetSettings) -> Result<(), String> {
    {
        let mut config = state.config.lock().unwrap();
        config.thinking_budget_mode = settings.mode;
        config.thinking_budget_custom = settings.custom_budget;
    }
    let config_to_save = {
        let config = state.config.lock().unwrap();
        config.clone()
    };
    crate::commands::config::save_config(state, config_to_save)?;
    
    // Config is saved - proxy will pick up new thinking budget on next request
    
    Ok(())
}

// ============================================
// Reasoning Effort Settings (GPT/Codex models)
// ============================================

#[tauri::command]
async fn get_reasoning_effort_settings(state: State<'_, AppState>) -> Result<ReasoningEffortSettings, String> {
    let config = state.config.lock().unwrap();
    let level = if config.reasoning_effort_level.is_empty() {
        "medium".to_string()
    } else {
        config.reasoning_effort_level.clone()
    };
    Ok(ReasoningEffortSettings { level })
}

#[tauri::command]
async fn set_reasoning_effort_settings(state: State<'_, AppState>, settings: ReasoningEffortSettings) -> Result<(), String> {
    // Validate level
    let valid_levels = ["none", "low", "medium", "high", "xhigh"];
    if !valid_levels.contains(&settings.level.as_str()) {
        return Err(format!("Invalid reasoning effort level: {}. Must be one of: {:?}", settings.level, valid_levels));
    }
    
    {
        let mut config = state.config.lock().unwrap();
        config.reasoning_effort_level = settings.level;
    }
    let config_to_save = {
        let config = state.config.lock().unwrap();
        config.clone()
    };
    crate::commands::config::save_config(state, config_to_save)?;
    
    Ok(())
}

// ============================================
// Close to Tray Setting
// ============================================

#[tauri::command]
async fn get_close_to_tray(state: State<'_, AppState>) -> Result<bool, String> {
    let config = state.config.lock().unwrap();
    Ok(config.close_to_tray)
}

#[tauri::command]
async fn set_close_to_tray(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    {
        let mut config = state.config.lock().unwrap();
        config.close_to_tray = enabled;
    }
    let config_to_save = {
        let config = state.config.lock().unwrap();
        config.clone()
    };
    crate::commands::config::save_config(state, config_to_save)?;
    Ok(())
}

// OpenAI-Compatible Providers
#[tauri::command]
async fn get_openai_compatible_providers(state: State<'_, AppState>) -> Result<Vec<OpenAICompatibleProvider>, String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "openai-compatibility");
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch OpenAI-compatible providers: {}", e))?;
    
    if !response.status().is_success() {
        return Ok(Vec::new());
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    convert_api_key_response(json, "openai-compatibility")
}

#[tauri::command]
async fn set_openai_compatible_providers(state: State<'_, AppState>, providers: Vec<OpenAICompatibleProvider>) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "openai-compatibility");
    
    let client = build_management_client();
    let body = convert_to_management_format(&providers)?;
    
    let response = client
        .put(&url)
        .header("X-Management-Key", &get_management_key())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to set OpenAI-compatible providers: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to set OpenAI-compatible providers: {} - {}", status, text));
    }
    
    Ok(())
}

#[tauri::command]
async fn add_openai_compatible_provider(state: State<'_, AppState>, provider: OpenAICompatibleProvider) -> Result<(), String> {
    let mut providers = get_openai_compatible_providers(state.clone()).await?;
    providers.push(provider);
    set_openai_compatible_providers(state, providers).await
}

#[tauri::command]
async fn delete_openai_compatible_provider(state: State<'_, AppState>, index: usize) -> Result<(), String> {
    let mut providers = get_openai_compatible_providers(state.clone()).await?;
    if index >= providers.len() {
        return Err("Index out of bounds".to_string());
    }
    providers.remove(index);
    set_openai_compatible_providers(state, providers).await
}

// ============================================
// Auth Files Management - via Management API
// ============================================

// Get all auth files
#[tauri::command]
async fn get_auth_files(state: State<'_, AppState>) -> Result<Vec<AuthFile>, String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "auth-files");
    
    // 1. Fetch active files from Management API
    let mut files: Vec<AuthFile> = Vec::new();
    
    // Only try to fetch if proxy is running
    let proxy_running = state.proxy_status.lock().unwrap().running;
    if proxy_running {
        let client = build_management_client();
        match client
            .get(&url)
            .header("X-Management-Key", &get_management_key())
            .send()
            .await 
        {
            Ok(response) => {
                if response.status().is_success() {
                    if let Ok(json) = response.json::<serde_json::Value>().await {
                        let files_array = if let Some(f) = json.get("files") {
                            f.clone()
                        } else if json.is_array() {
                            json
                        } else {
                            serde_json::Value::Array(Vec::new())
                        };
                        
                        // Convert snake_case to camelCase
                        if let Ok(json_str) = serde_json::to_string(&files_array) {
                            let converted = json_str
                                .replace("\"status_message\"", "\"statusMessage\"")
                                .replace("\"runtime_only\"", "\"runtimeOnly\"")
                                .replace("\"account_type\"", "\"accountType\"")
                                .replace("\"created_at\"", "\"createdAt\"")
                                .replace("\"updated_at\"", "\"updatedAt\"")
                                .replace("\"last_refresh\"", "\"lastRefresh\"")
                                .replace("\"success_count\"", "\"successCount\"")
                                .replace("\"failure_count\"", "\"failureCount\"");
                                
                            if let Ok(parsed) = serde_json::from_str::<Vec<AuthFile>>(&converted) {
                                files = parsed;
                            }
                        }
                    }
                }
            },
            Err(_) => {
                // Ignore connection errors if proxy just stopped
            }
        }
    }
    
    // 2. Scan for disabled files (.json.disabled) in auth directory
    let auth_dir = dirs::home_dir()
        .ok_or("Could not find home directory")?
        .join(".cli-proxy-api");
        
    if auth_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&auth_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.ends_with(".json.disabled") {
                        // This is a disabled auth file
                        if let Ok(content) = std::fs::read_to_string(&path) {
                            if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                                // Try to extract provider/email for metadata
                                let provider = json.get("provider")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("unknown")
                                    .to_string();
                                    
                                let dummy_id = name.strip_suffix(".json.disabled").unwrap_or(name).to_string();
                                
                                // Create AuthFile entry for this disabled file
                                let disabled_file = AuthFile {
                                    id: dummy_id.clone(),
                                    name: dummy_id,
                                    provider,
                                    status: "disabled".to_string(),
                                    disabled: true,
                                    unavailable: false,
                                    runtime_only: false,
                                    source: Some("file".to_string()),
                                    path: Some(path.to_string_lossy().to_string()),
                                    size: Some(entry.metadata().map(|m| m.len()).unwrap_or(0)),
                                    modtime: Some(entry.metadata().ok()
                                        .and_then(|m| m.modified().ok())
                                        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
                                        .unwrap_or_default()),
                                    email: None, // Could parse from content if standard format
                                    account_type: None,
                                    account: None,
                                    created_at: None,
                                    updated_at: None,
                                    last_refresh: None,
                                    success_count: None,
                                    failure_count: None,
                                    label: None,
                                    status_message: None,
                                };
                                
                                files.push(disabled_file);
                            }
                        }
                    }
                }
            }
        }
    }
    
    Ok(files)
}

// Upload auth file
#[tauri::command]
async fn upload_auth_file(state: State<'_, AppState>, file_path: String, provider: String) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "auth-files");
    
    // Read file content
    let content = std::fs::read(&file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    
    // Get filename from path
    let filename = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("auth.json")
        .to_string();
    
    let client = build_management_client();
    
    // Create multipart form
    let part = reqwest::multipart::Part::bytes(content)
        .file_name(filename.clone())
        .mime_str("application/json")
        .map_err(|e| e.to_string())?;
    
    let form = reqwest::multipart::Form::new()
        .text("provider", provider)
        .text("filename", filename)
        .part("file", part);
    
    let response = client
        .post(&url)
        .header("X-Management-Key", &get_management_key())
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Failed to upload auth file: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to upload auth file: {} - {}", status, text));
    }
    
    Ok(())
}

// Delete auth file
#[tauri::command]
async fn delete_auth_file(state: State<'_, AppState>, file_id: String) -> Result<(), String> {
    // Check if it's a disabled file first (file_id matches filename without extension usually)
    let auth_dir = dirs::home_dir()
        .ok_or("Could not find home directory")?
        .join(".cli-proxy-api");
        
    let disabled_path = auth_dir.join(format!("{}.json.disabled", file_id));
    if disabled_path.exists() {
        std::fs::remove_file(disabled_path)
            .map_err(|e| format!("Failed to delete disabled file: {}", e))?;
        return Ok(());
    }

    // Otherwise try to delete via API
    let port = state.config.lock().unwrap().port;
    let url = format!("{}?name={}", get_management_url(port, "auth-files"), file_id);
    
    let client = build_management_client();
    let response = client
        .delete(&url)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to delete auth file: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to delete auth file: {} - {}", status, text));
    }
    
    Ok(())
}

// Toggle auth file enabled/disabled
#[tauri::command]
async fn toggle_auth_file(_state: State<'_, AppState>, file_id: String, disabled: bool) -> Result<(), String> {
    let auth_dir = dirs::home_dir()
        .ok_or("Could not find home directory")?
        .join(".cli-proxy-api");
        
    if !auth_dir.exists() {
        return Err("Auth directory not found".to_string());
    }
    
    // CAUTION: 'file_id' from the API is typically the filename WITHOUT .json extension
    // But sometimes it might include it depending on how the ID was constructed.
    // We try to find the source file.
    
    let enabled_path = auth_dir.join(format!("{}.json", file_id));
    let disabled_path = auth_dir.join(format!("{}.json.disabled", file_id));
    
    if disabled {
        // Disable: Rename .json -> .json.disabled
        if enabled_path.exists() {
            std::fs::rename(&enabled_path, &disabled_path)
                .map_err(|e| format!("Failed to disable file: {}", e))?;
        } else {
            // Check if ID already had extension?
             let enabled_path_asis = auth_dir.join(&file_id);
             let disabled_path_asis = auth_dir.join(format!("{}.disabled", file_id));
             
             if enabled_path_asis.exists() {
                 std::fs::rename(&enabled_path_asis, &disabled_path_asis)
                    .map_err(|e| format!("Failed to disable file: {}", e))?;
             } else {
                 return Err("File not found to disable".to_string());
             }
        }
    } else {
        // Enable: Rename .json.disabled -> .json
        if disabled_path.exists() {
            std::fs::rename(&disabled_path, &enabled_path)
                .map_err(|e| format!("Failed to enable file: {}", e))?;
        } else {
            // Check alt path
             let enabled_path_asis = auth_dir.join(&file_id);
             let disabled_path_asis = auth_dir.join(format!("{}.disabled", file_id));
             
              if disabled_path_asis.exists() {
                  std::fs::rename(&disabled_path_asis, &enabled_path_asis)
                    .map_err(|e| format!("Failed to enable file: {}", e))?;
              } else {
                  return Err("File not found to enable".to_string());
              }
        }
    }
    
    Ok(())
}

// Download auth file - returns path to temp file
#[tauri::command]
async fn download_auth_file(state: State<'_, AppState>, _file_id: String, filename: String) -> Result<String, String> {
    let port = state.config.lock().unwrap().port;
    let url = format!("{}?name={}", get_management_url(port, "auth-files/download"), filename);
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to download auth file: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to download auth file: {} - {}", status, text));
    }
    
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    
    // Save to downloads directory
    let downloads_dir = dirs::download_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default());
    
    let dest_path = downloads_dir.join(&filename);
    std::fs::write(&dest_path, &bytes)
        .map_err(|e| format!("Failed to save file: {}", e))?;
    
    Ok(dest_path.to_string_lossy().to_string())
}

// Delete all auth files
#[tauri::command]
async fn delete_all_auth_files(state: State<'_, AppState>) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = format!("{}?all=true", get_management_url(port, "auth-files"));
    
    let client = build_management_client();
    let response = client
        .delete(&url)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to delete all auth files: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to delete all auth files: {} - {}", status, text));
    }
    
    Ok(())
}

// ============================================================================
// Management API Settings (Runtime Updates)
// ============================================================================

// Get max retry interval from Management API
#[tauri::command]
async fn get_max_retry_interval(state: State<'_, AppState>) -> Result<i32, String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "max-retry-interval");
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to get max retry interval: {}", e))?;
    
    if !response.status().is_success() {
        return Ok(0); // Default to 0 if not set
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(json["max-retry-interval"].as_i64().unwrap_or(0) as i32)
}

// Set max retry interval via Management API
#[tauri::command]
async fn set_max_retry_interval(state: State<'_, AppState>, value: i32) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "max-retry-interval");
    
    let client = build_management_client();
    let response = client
        .put(&url)
        .header("X-Management-Key", &get_management_key())
        .json(&serde_json::json!({ "value": value }))
        .send()
        .await
        .map_err(|e| format!("Failed to set max retry interval: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to set max retry interval: {} - {}", status, text));
    }
    
    // Persist to Tauri config so it survives restart
    let mut config = state.config.lock().unwrap();
    config.max_retry_interval = value;
    save_config_to_file(&config).map_err(|e| format!("Failed to save config: {}", e))?;
    
    Ok(())
}

// Get WebSocket auth status from Management API
#[tauri::command]
async fn get_websocket_auth(state: State<'_, AppState>) -> Result<bool, String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "ws-auth");
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to get WebSocket auth: {}", e))?;
    
    if !response.status().is_success() {
        return Ok(false); // Default to false
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(json["ws-auth"].as_bool().unwrap_or(false))
}

// Set WebSocket auth via Management API
#[tauri::command]
async fn set_websocket_auth(state: State<'_, AppState>, value: bool) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "ws-auth");
    
    let client = build_management_client();
    let response = client
        .put(&url)
        .header("X-Management-Key", &get_management_key())
        .json(&serde_json::json!({ "value": value }))
        .send()
        .await
        .map_err(|e| format!("Failed to set WebSocket auth: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to set WebSocket auth: {} - {}", status, text));
    }
    
    Ok(())
}

// Get force model mappings from Management API
#[tauri::command]
async fn get_force_model_mappings(state: State<'_, AppState>) -> Result<bool, String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "ampcode/force-model-mappings");
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to get force model mappings: {}", e))?;
    
    if !response.status().is_success() {
        return Ok(false); // Default to false
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(json.get("force-model-mappings").and_then(|v| v.as_bool()).unwrap_or(false))
}

// Set force model mappings via Management API
#[tauri::command]
async fn set_force_model_mappings(state: State<'_, AppState>, value: bool) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "ampcode/force-model-mappings");
    
    let client = build_management_client();
    let response = client
        .put(&url)
        .header("X-Management-Key", &get_management_key())
        .json(&serde_json::json!({ "value": value }))
        .send()
        .await
        .map_err(|e| format!("Failed to set force model mappings: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to set force model mappings: {} - {}", status, text));
    }
    
    // Persist to Tauri config so it survives restart
    let mut config = state.config.lock().unwrap();
    config.force_model_mappings = value;
    save_config_to_file(&config).map_err(|e| format!("Failed to save config: {}", e))?;
    
    Ok(())
}

// API response structure for logs
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "kebab-case")]
struct LogsApiResponse {
    #[serde(default)]
    #[allow(dead_code)]
    latest_timestamp: Option<i64>,
    #[serde(default)]
    #[allow(dead_code)]
    line_count: Option<u32>,
    #[serde(default)]
    lines: Vec<String>,
}

// Get logs from the proxy server
#[tauri::command]
async fn get_logs(state: State<'_, AppState>, lines: Option<u32>) -> Result<Vec<LogEntry>, String> {
    let port = state.config.lock().unwrap().port;
    let lines_param = lines.unwrap_or(500);
    let url = format!("{}?lines={}", get_management_url(port, "logs"), lines_param);
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to get logs: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to get logs: {} - {}", status, text));
    }
    
    // Parse JSON response
    let api_response: LogsApiResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse logs response: {}", e))?;
    
    // Parse each line into a LogEntry
    let entries: Vec<LogEntry> = api_response
        .lines
        .iter()
        .filter(|line| !line.is_empty())
        .map(|line| parse_log_line(line))
        .collect();
    
    Ok(entries)
}

// Parse a log line into a LogEntry struct
// Expected formats from CLIProxyAPI:
// - "[2025-12-02 22:12:52] [info] [gin_logger.go:58] message"
// - "[2025-12-02 22:12:52] [info] message"  
// - "2024-01-15T10:30:45.123Z [INFO] message"
fn parse_log_line(line: &str) -> LogEntry {
    let line = line.trim();
    
    // Format: [timestamp] [level] [source] message
    // or: [timestamp] [level] message
    if line.starts_with('[') {
        let mut parts = Vec::new();
        let mut current_start = 0;
        let mut in_bracket = false;
        
        for (i, c) in line.char_indices() {
            if c == '[' && !in_bracket {
                in_bracket = true;
                current_start = i + 1;
            } else if c == ']' && in_bracket {
                in_bracket = false;
                parts.push(&line[current_start..i]);
                current_start = i + 1;
            }
        }
        
        // Get the message (everything after the last bracket)
        let message_start = line.rfind(']').map(|i| i + 1).unwrap_or(0);
        let message = line[message_start..].trim();
        
        if parts.len() >= 2 {
            let timestamp = parts[0].to_string();
            let level = parts[1].to_uppercase();
            
            return LogEntry {
                timestamp,
                level: normalize_log_level(&level),
                message: message.to_string(),
            };
        }
    }
    
    // Try ISO timestamp format: "2024-01-15T10:30:45.123Z [INFO] message"
    if line.len() > 20 && (line.chars().nth(4) == Some('-') || line.chars().nth(10) == Some('T')) {
        if let Some(bracket_start) = line.find('[') {
            if let Some(bracket_end) = line[bracket_start..].find(']') {
                let timestamp = line[..bracket_start].trim().to_string();
                let level = line[bracket_start + 1..bracket_start + bracket_end].to_string();
                let message = line[bracket_start + bracket_end + 1..].trim().to_string();
                
                return LogEntry {
                    timestamp,
                    level: normalize_log_level(&level),
                    message,
                };
            }
        }
    }
    
    // Try "LEVEL: message" format
    for level in &["ERROR", "WARN", "INFO", "DEBUG", "TRACE"] {
        if line.to_uppercase().starts_with(level) {
            let rest = &line[level.len()..];
            if rest.starts_with(':') || rest.starts_with(' ') {
                return LogEntry {
                    timestamp: String::new(),
                    level: level.to_string(),
                    message: rest.trim_start_matches(|c| c == ':' || c == ' ').to_string(),
                };
            }
        }
    }
    
    // Default: plain text as INFO
    LogEntry {
        timestamp: String::new(),
        level: "INFO".to_string(),
        message: line.to_string(),
    }
}

// Normalize log level to standard format
fn normalize_log_level(level: &str) -> String {
    match level.to_uppercase().as_str() {
        "ERROR" | "ERR" | "E" => "ERROR".to_string(),
        "WARN" | "WARNING" | "W" => "WARN".to_string(),
        "INFO" | "I" => "INFO".to_string(),
        "DEBUG" | "DBG" | "D" => "DEBUG".to_string(),
        "TRACE" | "T" => "TRACE".to_string(),
        _ => level.to_uppercase(),
    }
}

// Clear all logs
#[tauri::command]
async fn clear_logs(state: State<'_, AppState>) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "logs");
    
    let client = build_management_client();
    let response = client
        .delete(&url)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to clear logs: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to clear logs: {} - {}", status, text));
    }
    
    Ok(())
}

// Get setup instructions for a specific tool
#[tauri::command]
fn get_tool_setup_info(tool_id: String, state: State<AppState>) -> Result<serde_json::Value, String> {
    let config = state.config.lock().unwrap();
    let endpoint = format!("http://localhost:{}/v1", config.port);
    
    let info = match tool_id.as_str() {
        "cursor" => serde_json::json!({
            "name": "Cursor",
            "logo": "/logos/cursor.svg",
            "canAutoConfigure": false,
            "note": "Cursor doesn't support custom API base URLs. Use your connected providers' API keys directly in Cursor settings.",
            "steps": [
                {
                    "title": "Open Cursor Settings",
                    "description": "Press Cmd+, (Mac) or Ctrl+, (Windows) and go to 'Models'"
                },
                {
                    "title": "Add API Keys",
                    "description": "Enter your API keys for Claude, OpenAI, or other providers directly"
                }
            ]
        }),
        "continue" => serde_json::json!({
            "name": "Continue",
            "logo": "/logos/continue.svg",
            "canAutoConfigure": true,
            "steps": [
                {
                    "title": "Auto-Configure",
                    "description": "Click the button below to automatically configure Continue"
                },
                {
                    "title": "Or Manual Setup",
                    "description": "Open ~/.continue/config.yaml and add:"
                }
            ],
            "manualConfig": format!(r#"models:
  - name: ProxyPal
    provider: openai
    model: gpt-4
    apiKey: proxypal-local
    apiBase: {}"#, endpoint),
            "endpoint": endpoint
        }),
        "cline" => serde_json::json!({
            "name": "Cline",
            "logo": "/logos/cline.svg",
            "canAutoConfigure": false,
            "steps": [
                {
                    "title": "Open Cline Settings",
                    "description": "Click the Cline icon in VS Code sidebar, then click the gear icon"
                },
                {
                    "title": "Select API Provider",
                    "description": "Choose 'OpenAI Compatible' from the provider dropdown"
                },
                {
                    "title": "Set Base URL",
                    "description": "Enter the ProxyPal endpoint:",
                    "copyable": endpoint.clone()
                },
                {
                    "title": "Set API Key",
                    "description": "Enter: proxypal-local",
                    "copyable": "proxypal-local".to_string()
                },
                {
                    "title": "Select Model",
                    "description": "Enter any model name (e.g., gpt-4, claude-3-sonnet)"
                }
            ],
            "endpoint": endpoint
        }),
        "windsurf" => serde_json::json!({
            "name": "Windsurf",
            "logo": "/logos/windsurf.svg",
            "canAutoConfigure": false,
            "note": "Windsurf doesn't support custom API endpoints. It only supports direct API keys for Claude models.",
            "steps": [
                {
                    "title": "Not Supported",
                    "description": "Windsurf routes all requests through Codeium servers and doesn't allow custom endpoints."
                }
            ]
        }),
        _ => return Err(format!("Unknown tool: {}", tool_id)),
    };
    
    Ok(info)
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
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(app_state)
        .manage(SshManager::new())
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_proxy_status,
            start_proxy,
            stop_proxy,
            // Copilot Management
            get_copilot_status,
            start_copilot,
            stop_copilot,
            check_copilot_health,
            detect_copilot_api,
            install_copilot_api,
            get_auth_status,
            refresh_auth_status,
            open_oauth,
            poll_oauth_status,
            complete_oauth,
            disconnect_provider,
            fetch_antigravity_quota,
            import_vertex_credential,
            commands::config::get_config,
            commands::config::save_config,
            commands::config::get_config_yaml,
            commands::config::save_config_yaml,
            detect_ai_tools,
            configure_continue,
            get_tool_setup_info,
            detect_cli_agents,
            configure_cli_agent,
            get_shell_profile_path,
            append_to_shell_profile,
            get_usage_stats,
            get_request_history,
            // Provider Health Check
            check_provider_health,
            add_request_to_history,
            clear_request_history,
            sync_usage_from_proxy,
            export_usage_stats,
            import_usage_stats,
            get_available_models,
            test_openai_provider,
            // API Keys Management
            get_gemini_api_keys,
            set_gemini_api_keys,
            add_gemini_api_key,
            delete_gemini_api_key,
            get_claude_api_keys,
            set_claude_api_keys,
            add_claude_api_key,
            delete_claude_api_key,
            get_codex_api_keys,
            set_codex_api_keys,
            add_codex_api_key,
            delete_codex_api_key,
            // Thinking Budget Settings
            get_thinking_budget_settings,
            set_thinking_budget_settings,
            // Reasoning Effort Settings (GPT/Codex)
            get_reasoning_effort_settings,
            set_reasoning_effort_settings,
            get_openai_compatible_providers,
            set_openai_compatible_providers,
            add_openai_compatible_provider,
            delete_openai_compatible_provider,
            // Auth Files Management
            get_auth_files,
            upload_auth_file,
            delete_auth_file,
            toggle_auth_file,
            download_auth_file,
            delete_all_auth_files,
            // Log Viewer
            get_logs,
            clear_logs,
            // Management API Settings
            get_max_retry_interval,
            set_max_retry_interval,
            get_websocket_auth,
            set_websocket_auth,
            get_force_model_mappings,
            set_force_model_mappings,
            // Window behavior
            get_close_to_tray,
            set_close_to_tray,
            // Claude Code Settings
            get_claude_code_settings,
            set_claude_code_model,
            // Updater support check
            is_updater_supported,
            // SSH
            commands::ssh::get_ssh_configs,
            commands::ssh::save_ssh_config,
            commands::ssh::delete_ssh_config,
            commands::ssh::set_ssh_connection,
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
                                if let Some(window) = app_handle.get_webview_window("main") {
                                    println!("[ProxyPal] Hiding to system tray...");
                                    let _ = window.hide();
                                }
                                api.prevent_close();
                            }
                            // If close_to_tray is false, allow normal close behavior
                        }
                    }
                }
                tauri::RunEvent::ExitRequested { .. } => {
                    // Cleanup: Kill proxy and copilot processes before exit
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        // Stop log watcher thread
                        state.log_watcher_running.store(false, Ordering::SeqCst);
                        
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

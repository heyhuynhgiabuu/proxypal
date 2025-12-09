use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State,
};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use regex::Regex;
use std::io::{BufRead, BufReader, Seek, SeekFrom};

// Proxy status structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyStatus {
    pub running: bool,
    pub port: u16,
    pub endpoint: String,
}

// Request log entry for live monitoring
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestLog {
    pub id: String,
    pub timestamp: u64,
    pub provider: String,
    pub model: String,
    pub method: String,
    pub path: String,
    pub status: u16,
    pub duration_ms: u64,
    pub tokens_in: Option<u32>,
    pub tokens_out: Option<u32>,
}

impl Default for ProxyStatus {
    fn default() -> Self {
        Self {
            running: false,
            port: 8317,
            endpoint: "http://localhost:8317/v1".to_string(),
        }
    }
}

// Auth status for different providers (count of connected accounts)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthStatus {
    pub claude: u32,
    pub openai: u32,
    pub gemini: u32,
    pub qwen: u32,
    pub iflow: u32,
    pub vertex: u32,
    pub antigravity: u32,
}

impl Default for AuthStatus {
    fn default() -> Self {
        Self {
            claude: 0,
            openai: 0,
            gemini: 0,
            qwen: 0,
            iflow: 0,
            vertex: 0,
            antigravity: 0,
        }
    }
}

// App configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub port: u16,
    pub auto_start: bool,
    pub launch_at_login: bool,
    #[serde(default)]
    pub debug: bool,
    #[serde(default)]
    pub proxy_url: String,
    #[serde(default)]
    pub request_retry: u16,
    #[serde(default)]
    pub quota_switch_project: bool,
    #[serde(default)]
    pub quota_switch_preview_model: bool,
    #[serde(default = "default_usage_stats_enabled")]
    pub usage_stats_enabled: bool,
    #[serde(default)]
    pub request_logging: bool,
    #[serde(default)]
    pub logging_to_file: bool,
    #[serde(default = "default_config_version")]
    pub config_version: u8,
    #[serde(default)]
    pub amp_api_key: String,
    #[serde(default)]
    pub amp_model_mappings: Vec<AmpModelMapping>,
    #[serde(default)]
    pub amp_openai_provider: Option<AmpOpenAIProvider>, // DEPRECATED: Use amp_openai_providers
    #[serde(default)]
    pub amp_openai_providers: Vec<AmpOpenAIProvider>, // Multiple custom OpenAI-compatible providers
    #[serde(default)]
    pub amp_routing_mode: String, // "mappings" or "openai" - default is "mappings"
    #[serde(default)]
    pub copilot: CopilotConfig,
    // Persisted API keys for providers (stored in config, synced to CLIProxyAPI on startup)
    #[serde(default)]
    pub claude_api_keys: Vec<ClaudeApiKey>,
    #[serde(default)]
    pub gemini_api_keys: Vec<GeminiApiKey>,
    #[serde(default)]
    pub codex_api_keys: Vec<CodexApiKey>,
}

fn default_usage_stats_enabled() -> bool {
    true
}

fn default_config_version() -> u8 {
    1
}

// Amp model mapping for routing requests to different models (simple mode)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmpModelMapping {
    pub from: String,
    pub to: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true // Default to enabled for backward compatibility
}

// OpenAI-compatible provider model for Amp routing
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AmpOpenAIModel {
    pub name: String,
    #[serde(default)]
    pub alias: String,
}

// OpenAI-compatible provider configuration for Amp
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AmpOpenAIProvider {
    #[serde(default = "generate_uuid")]
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    #[serde(default)]
    pub models: Vec<AmpOpenAIModel>,
}

fn generate_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

// GitHub Copilot proxy configuration (via copilot-api)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_copilot_port")]
    pub port: u16,
    #[serde(default)]
    pub account_type: String, // "individual", "business", "enterprise"
    #[serde(default)]
    pub github_token: String, // Optional pre-authenticated token
    #[serde(default)]
    pub rate_limit: Option<u16>, // Seconds between requests
    #[serde(default)]
    pub rate_limit_wait: bool, // Wait instead of error on rate limit
}

fn default_copilot_port() -> u16 {
    4141
}

impl Default for CopilotConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 4141,
            account_type: "individual".to_string(),
            github_token: String::new(),
            rate_limit: None,
            rate_limit_wait: false,
        }
    }
}

// Copilot proxy status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotStatus {
    pub running: bool,
    pub port: u16,
    pub endpoint: String,
    pub authenticated: bool,
}

impl Default for CopilotStatus {
    fn default() -> Self {
        Self {
            running: false,
            port: 4141,
            endpoint: "http://localhost:4141".to_string(),
            authenticated: false,
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            port: 8317,
            auto_start: true,
            launch_at_login: false,
            debug: false,
            proxy_url: String::new(),
            request_retry: 0,
            quota_switch_project: false,
            quota_switch_preview_model: false,
            usage_stats_enabled: true,
            request_logging: false,
            logging_to_file: false,
            config_version: 1,
            amp_api_key: String::new(),
            amp_model_mappings: Vec::new(),
            amp_openai_provider: None,
            amp_openai_providers: Vec::new(),
            amp_routing_mode: "mappings".to_string(),
            copilot: CopilotConfig::default(),
            claude_api_keys: Vec::new(),
            gemini_api_keys: Vec::new(),
            codex_api_keys: Vec::new(),
        }
    }
}


// OAuth state for tracking pending auth flows
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthState {
    pub provider: String,
    pub state: String,
}

// Usage statistics from Management API
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageStats {
    pub total_requests: u64,
    pub success_count: u64,
    pub failure_count: u64,
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub requests_today: u64,
    pub tokens_today: u64,
    #[serde(default)]
    pub models: Vec<ModelUsage>,
    /// Time-series data for charts
    #[serde(default)]
    pub requests_by_day: Vec<TimeSeriesPoint>,
    #[serde(default)]
    pub tokens_by_day: Vec<TimeSeriesPoint>,
    #[serde(default)]
    pub requests_by_hour: Vec<TimeSeriesPoint>,
    #[serde(default)]
    pub tokens_by_hour: Vec<TimeSeriesPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeSeriesPoint {
    pub label: String,
    pub value: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    pub requests: u64,
    pub tokens: u64,
}

// App state
pub struct AppState {
    pub proxy_status: Mutex<ProxyStatus>,
    pub auth_status: Mutex<AuthStatus>,
    pub config: Mutex<AppConfig>,
    pub pending_oauth: Mutex<Option<OAuthState>>,
    pub proxy_process: Mutex<Option<CommandChild>>,
    pub copilot_status: Mutex<CopilotStatus>,
    pub copilot_process: Mutex<Option<CommandChild>>,
    pub log_watcher_running: Arc<AtomicBool>,
    pub request_counter: Arc<AtomicU64>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            proxy_status: Mutex::new(ProxyStatus::default()),
            auth_status: Mutex::new(AuthStatus::default()),
            config: Mutex::new(AppConfig::default()),
            pending_oauth: Mutex::new(None),
            proxy_process: Mutex::new(None),
            copilot_status: Mutex::new(CopilotStatus::default()),
            copilot_process: Mutex::new(None),
            log_watcher_running: Arc::new(AtomicBool::new(false)),
            request_counter: Arc::new(AtomicU64::new(0)),
        }
    }
}

// Config file path
fn get_config_path() -> std::path::PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("proxypal");
    std::fs::create_dir_all(&config_dir).ok();
    config_dir.join("config.json")
}

fn get_auth_path() -> std::path::PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("proxypal");
    std::fs::create_dir_all(&config_dir).ok();
    config_dir.join("auth.json")
}

fn get_history_path() -> std::path::PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("proxypal");
    std::fs::create_dir_all(&config_dir).ok();
    config_dir.join("history.json")
}

// Request history with metadata
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RequestHistory {
    pub requests: Vec<RequestLog>,
    pub total_tokens_in: u64,
    pub total_tokens_out: u64,
    pub total_cost_usd: f64,
}

// Load request history from file
fn load_request_history() -> RequestHistory {
    let path = get_history_path();
    if path.exists() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(history) = serde_json::from_str(&data) {
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
    // Keep only last 500 requests
    if trimmed.requests.len() > 500 {
        trimmed.requests = trimmed.requests.split_off(trimmed.requests.len() - 500);
    }
    let data = serde_json::to_string_pretty(&trimmed).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

// Estimate cost based on model and tokens
fn estimate_request_cost(model: &str, tokens_in: u32, tokens_out: u32) -> f64 {
    // Pricing per 1M tokens (input, output) - approximate as of 2024
    // Using broader patterns to match all model versions (3.x, 4.x, 4.5, 5.x, etc.)
    let (input_rate, output_rate) = match model.to_lowercase().as_str() {
        // Claude models - broader patterns to match all versions (3.x, 4.x, 4.5, etc.)
        m if m.contains("claude") && m.contains("opus") => (15.0, 75.0),
        m if m.contains("claude") && m.contains("sonnet") => (3.0, 15.0),
        m if m.contains("claude") && m.contains("haiku") => (0.25, 1.25),
        // GPT models - check newer versions first
        m if m.contains("gpt-5") => (15.0, 45.0), // GPT-5 estimated pricing
        m if m.contains("gpt-4o") => (2.5, 10.0),
        m if m.contains("gpt-4-turbo") || m.contains("gpt-4") => (10.0, 30.0),
        m if m.contains("gpt-3.5") => (0.5, 1.5),
        // Gemini models - broader patterns for all 2.x versions
        m if m.contains("gemini") && m.contains("pro") => (1.25, 5.0),
        m if m.contains("gemini") && m.contains("flash") => (0.075, 0.30),
        m if m.contains("gemini-2") => (0.10, 0.40),
        m if m.contains("qwen") => (0.50, 2.0),
        _ => (1.0, 3.0), // Default conservative estimate
    };
    
    let input_cost = (tokens_in as f64 / 1_000_000.0) * input_rate;
    let output_cost = (tokens_out as f64 / 1_000_000.0) * output_rate;
    input_cost + output_cost
}

// Load config from file
fn load_config() -> AppConfig {
    let path = get_config_path();
    if path.exists() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(mut config) = serde_json::from_str::<AppConfig>(&data) {
                // Migration: Convert deprecated amp_openai_provider to amp_openai_providers array
                if let Some(old_provider) = config.amp_openai_provider.take() {
                    // Only migrate if the new array is empty (first-time migration)
                    if config.amp_openai_providers.is_empty() {
                        // Ensure the migrated provider has an ID
                        let provider_with_id = if old_provider.id.is_empty() {
                            AmpOpenAIProvider {
                                id: generate_uuid(),
                                ..old_provider
                            }
                        } else {
                            old_provider
                        };
                        config.amp_openai_providers.push(provider_with_id);
                        // Save the migrated config
                        let _ = save_config_to_file(&config);
                    }
                }
                return config;
            }
        }
    }
    AppConfig::default()
}

// Save config to file
fn save_config_to_file(config: &AppConfig) -> Result<(), String> {
    let path = get_config_path();
    let data = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
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

// Detect provider from model name
fn detect_provider_from_model(model: &str) -> String {
    let model_lower = model.to_lowercase();
    
    if model_lower.contains("claude") || model_lower.contains("sonnet") || 
       model_lower.contains("opus") || model_lower.contains("haiku") {
        return "claude".to_string();
    }
    if model_lower.contains("gpt") || model_lower.contains("codex") || 
       model_lower.starts_with("o3") || model_lower.starts_with("o1") {
        return "openai".to_string();
    }
    if model_lower.contains("gemini") {
        return "gemini".to_string();
    }
    if model_lower.contains("qwen") {
        return "qwen".to_string();
    }
    if model_lower.contains("deepseek") {
        return "deepseek".to_string();
    }
    if model_lower.contains("glm") {
        return "zhipu".to_string();
    }
    
    if model_lower.contains("antigravity") {
        return "antigravity".to_string();
    }
    
    "unknown".to_string()
}

// Extract provider from Amp-style API path
// e.g., "/api/provider/anthropic/v1/messages" -> "claude"
// e.g., "/api/provider/openai/v1/chat/completions" -> "openai"
// Also handles standard paths: /v1/messages -> claude, /v1/chat/completions -> openai-compat
fn detect_provider_from_path(path: &str) -> Option<String> {
    // First try Amp-style path
    if path.contains("/api/provider/") {
        let parts: Vec<&str> = path.split('/').collect();
        // Path format: /api/provider/{provider}/...
        if let Some(idx) = parts.iter().position(|&p| p == "provider") {
            if let Some(provider) = parts.get(idx + 1) {
                return Some(match *provider {
                    "anthropic" => "claude".to_string(),
                    "openai" => "openai".to_string(),
                    "google" => "gemini".to_string(),
                    p => p.to_string(),
                });
            }
        }
    }
    
    // Fallback: infer from standard endpoint paths
    if path.contains("/v1/messages") || path.contains("/messages") {
        return Some("claude".to_string());
    }
    if path.contains("/v1/chat/completions") || path.contains("/chat/completions") {
        // Could be OpenAI, Gemini, etc. - mark as openai-compat
        return Some("openai-compat".to_string());
    }
    if path.contains("/v1beta") || path.contains(":generateContent") || path.contains(":streamGenerateContent") {
        return Some("gemini".to_string());
    }
    
    None
}

// Extract model from API path
// For Gemini: "/api/provider/google/v1beta1/publishers/google/models/gemini-2.5-pro:streamGenerateContent"
// For Claude/OpenAI: model is in request body, so we return empty to let the UI use provider name
fn extract_model_from_path(path: &str) -> Option<String> {
    // First try Gemini-style path with /models/{model-name}
    if path.contains("/models/") {
        if let Some(idx) = path.find("/models/") {
            let model_part = &path[idx + 8..]; // Skip "/models/"
            // Model may end with :action (e.g., ":generateContent")
            let model = if let Some(colon_idx) = model_part.find(':') {
                &model_part[..colon_idx]
            } else if let Some(slash_idx) = model_part.find('/') {
                &model_part[..slash_idx]
            } else {
                model_part
            };
            if !model.is_empty() {
                return Some(model.to_string());
            }
        }
    }
    
    // For Claude/OpenAI, model is in request body - we can't extract it from URL
    // Return None to let UI show provider-based display
    None
}

// Parse a GIN log line and extract request information
// Format: [GIN] 2025/12/04 - 20:51:48 | 200 | 6.656s | ::1 | POST "/api/provider/anthropic/v1/messages"
fn parse_gin_log_line(line: &str, request_counter: &AtomicU64) -> Option<RequestLog> {
    // Only process GIN request logs
    if !line.contains("[GIN]") {
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
    
    // Parse the GIN log format using regex
    // Example: [GIN] 2025/12/04 - 20:51:48 | 200 | 6.656s | ::1 | POST "/api/provider/anthropic/v1/messages" | model=claude-3-opus
    lazy_static::lazy_static! {
        static ref GIN_REGEX: Regex = Regex::new(
            r#"\[GIN\]\s+(\d{4}/\d{2}/\d{2})\s+-\s+(\d{2}:\d{2}:\d{2})\s+\|\s+(\d+)\s+\|\s+([^\s]+)\s+\|\s+[^\s]+\s+\|\s+(\w+)\s+"([^"]+)"(?:\s+\|\s+model=(\S+))?"#
        ).unwrap();
    }
    
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
    let duration_ms: u64 = if duration_str.ends_with("ms") {
        duration_str.trim_end_matches("ms").parse().unwrap_or(0)
    } else if duration_str.ends_with('s') {
        let secs: f64 = duration_str.trim_end_matches('s').parse().unwrap_or(0.0);
        (secs * 1000.0) as u64
    } else {
        0
    };
    
    // Extract model from log line (group 7) or fall back to path extraction for Gemini
    let model = captures.get(7)
        .map(|m| m.as_str().to_string())
        .or_else(|| extract_model_from_path(&path))
        .unwrap_or_else(|| "unknown".to_string());
    
    // Determine provider from path first, then fallback to model-based detection
    let provider = detect_provider_from_path(&path)
        .unwrap_or_else(|| detect_provider_from_model(&model));
    
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
                if let Some(request_log) = parse_gin_log_line(&line, &request_counter) {
                    // Emit to frontend for live display
                    let _ = app_handle.emit("request-log", request_log.clone());
                    
                    // Persist to history (without token data for now)
                    let mut history = load_request_history();
                    
                    // Check for duplicate by timestamp and path
                    let is_duplicate = history.requests.iter().any(|r| 
                        r.timestamp == request_log.timestamp && r.path == request_log.path
                    );
                    
                    if !is_duplicate {
                        history.requests.push(request_log);
                        
                        // Keep only last 500 requests
                        if history.requests.len() > 500 {
                            history.requests = history.requests.split_off(history.requests.len() - 500);
                        }
                        
                        if let Err(e) = save_request_history(&history) {
                            eprintln!("[LogWatcher] Failed to save history: {}", e);
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
            let _ = child.kill(); // Ignore errors, process might already be dead
        }
    }

    // Kill any external process using our port (handles orphaned processes from previous runs)
    let port = config.port;
    #[cfg(unix)]
    {
        // Use lsof to find and kill any process using the port
        let _ = std::process::Command::new("sh")
            .args(["-c", &format!("lsof -ti :{} | xargs -r kill -9 2>/dev/null", port)])
            .output();
    }
    #[cfg(windows)]
    {
        // On Windows, use netstat and taskkill
        let _ = std::process::Command::new("cmd")
            .args(["/C", &format!("for /f \"tokens=5\" %a in ('netstat -aon ^| findstr :{} ^| findstr LISTENING') do taskkill /F /PID %a 2>nul", port)])
            .output();
    }

    // Small delay to let port be released
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

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
        // OpenAI GPT models
        entry.push_str("      - alias: \"copilot-gpt-4.1\"\n");
        entry.push_str("        name: \"gpt-4.1\"\n");
        entry.push_str("      - alias: \"copilot-gpt-5\"\n");
        entry.push_str("        name: \"gpt-5\"\n");
        entry.push_str("      - alias: \"copilot-gpt-5-mini\"\n");
        entry.push_str("        name: \"gpt-5-mini\"\n");
        entry.push_str("      - alias: \"copilot-gpt-5-codex\"\n");
        entry.push_str("        name: \"gpt-5-codex\"\n");
        entry.push_str("      - alias: \"copilot-gpt-5.1\"\n");
        entry.push_str("        name: \"gpt-5.1\"\n");
        entry.push_str("      - alias: \"copilot-gpt-5.1-codex\"\n");
        entry.push_str("        name: \"gpt-5.1-codex\"\n");
        entry.push_str("      - alias: \"copilot-gpt-5.1-codex-mini\"\n");
        entry.push_str("        name: \"gpt-5.1-codex-mini\"\n");
        // Legacy OpenAI models (may still work)
        entry.push_str("      - alias: \"copilot-gpt-4o\"\n");
        entry.push_str("        name: \"gpt-4o\"\n");
        entry.push_str("      - alias: \"copilot-gpt-4\"\n");
        entry.push_str("        name: \"gpt-4\"\n");
        entry.push_str("      - alias: \"copilot-gpt-4-turbo\"\n");
        entry.push_str("        name: \"gpt-4-turbo\"\n");
        entry.push_str("      - alias: \"copilot-o1\"\n");
        entry.push_str("        name: \"o1\"\n");
        entry.push_str("      - alias: \"copilot-o1-mini\"\n");
        entry.push_str("        name: \"o1-mini\"\n");
        // xAI Grok model
        entry.push_str("      - alias: \"copilot-grok-code-fast-1\"\n");
        entry.push_str("        name: \"grok-code-fast-1\"\n");
        // Fine-tuned models
        entry.push_str("      - alias: \"copilot-raptor-mini\"\n");
        entry.push_str("        name: \"raptor-mini\"\n");
        // Google Gemini models (via OpenAI-compat)
        entry.push_str("      - alias: \"copilot-gemini-2.5-pro\"\n");
        entry.push_str("        name: \"gemini-2.5-pro\"\n");
        entry.push_str("      - alias: \"copilot-gemini-3-pro\"\n");
        entry.push_str("        name: \"gemini-3-pro\"\n");
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
        
        // Add copilot entry if enabled
        if config.copilot.enabled {
            let port = config.copilot.port;
            let mut entry = String::new();
            entry.push_str("  - api-key: \"dummy\"\n");
            entry.push_str(&format!("    base-url: \"http://localhost:{}\"\n", port));
            entry.push_str("    models:\n");
            // Claude models (GA)
            entry.push_str("      - alias: \"copilot-claude-haiku-4.5\"\n");
            entry.push_str("        name: \"claude-haiku-4.5\"\n");
            entry.push_str("      - alias: \"copilot-claude-opus-4.1\"\n");
            entry.push_str("        name: \"claude-opus-4.1\"\n");
            entry.push_str("      - alias: \"copilot-claude-sonnet-4\"\n");
            entry.push_str("        name: \"claude-sonnet-4\"\n");
            entry.push_str("      - alias: \"copilot-claude-sonnet-4.5\"\n");
            entry.push_str("        name: \"claude-sonnet-4.5\"\n");
            // Claude models (Preview)
            entry.push_str("      - alias: \"copilot-claude-opus-4.5\"\n");
            entry.push_str("        name: \"claude-opus-4.5\"\n");
            entry.push_str("    proxy-url: \"\"\n");
            entries.push(entry);
        }
        
        // Add user's persisted Claude API keys
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
    
    // Always regenerate config on start because CLIProxyAPI hashes the secret-key in place
    // and we need the plaintext key for Management API access
    let proxy_config = format!(
        r#"# ProxyPal generated config
port: {}
auth-dir: "~/.cli-proxy-api"
api-keys:
  - "proxypal-local"
debug: {}
usage-statistics-enabled: {}
logging-to-file: {}
request-retry: {}
{}
# Quota exceeded behavior
quota-exceeded:
  switch-project: {}
  switch-preview-model: {}

# Enable Management API for OAuth flows
remote-management:
  allow-remote: false
  secret-key: "proxypal-mgmt-key"
  disable-control-panel: true

{}{}{}{}# Amp CLI Integration - enables amp login and management routes
# See: https://help.router-for.me/agent-client/amp-cli.html
# Get API key from: https://ampcode.com/settings
ampcode:
  upstream-url: "https://ampcode.com"
{}
{}
  restrict-management-to-localhost: true
"#,
        config.port,
        config.debug,
        config.usage_stats_enabled,
        config.logging_to_file,
        config.request_retry,
        proxy_url_line,
        config.quota_switch_project,
        config.quota_switch_preview_model,
        openai_compat_section,
        claude_api_key_section,
        gemini_api_key_section,
        codex_api_key_section,
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
        .header("X-Management-Key", "proxypal-mgmt-key")
        .json(&serde_json::json!({"value": config.usage_stats_enabled}))
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

    // Kill the child process
    {
        let mut process = state.proxy_process.lock().unwrap();
        if let Some(child) = process.take() {
            child.kill().map_err(|e| format!("Failed to kill process: {}", e))?;
        }
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
    
    // Determine command and arguments based on installation status
    let (bin_path, mut args) = if detection.installed {
        // Use copilot-api directly
        let copilot_bin = detection.copilot_bin.clone()
            .ok_or_else(|| format!(
                "copilot-api binary path not found.\n\n\
                Checked paths: {}\n\n\
                Install with: npm install -g copilot-api",
                detection.checked_copilot_paths.join(", ")
            ))?;
        println!("[copilot] Using globally installed copilot-api: {}{}", 
            copilot_bin,
            detection.version.as_ref().map(|v| format!(" v{}", v)).unwrap_or_default());
        (copilot_bin, vec![])
    } else {
        // Use npx to run copilot-api
        let npx_bin = detection.npx_bin.clone()
            .ok_or_else(|| format!(
                "npx binary not found (required to run copilot-api).\n\n\
                Node path: {}\n\n\
                Please ensure npm/npx is installed alongside Node.js.",
                detection.node_bin.as_deref().unwrap_or("not found")
            ))?;
        println!("[copilot] Using npx: {} copilot-api@latest", npx_bin);
        (npx_bin, vec!["copilot-api@latest".to_string()])
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
    
    // Add rate limit if specified
    if let Some(rate_limit) = config.copilot.rate_limit {
        args.push("--rate-limit".to_string());
        args.push(rate_limit.to_string());
    }
    
    // Add rate limit wait flag
    if config.copilot.rate_limit_wait {
        args.push("--rate-limit-wait".to_string());
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
    
    // Listen for stdout/stderr
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    println!("[copilot-api] {}", text);
                    
                    // Check for successful login message
                    if text.contains("Logged in as") {
                        // Update authenticated status
                        if let Some(state) = app_handle.try_state::<AppState>() {
                            let mut status = state.copilot_status.lock().unwrap();
                            status.authenticated = true;
                            let _ = app_handle.emit("copilot-status-changed", status.clone());
                        }
                    }
                    
                    // Check for auth URL in output
                    if text.contains("https://github.com/login/device") {
                        // Emit auth required event
                        let _ = app_handle.emit("copilot-auth-required", text.to_string());
                    }
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    eprintln!("[copilot-api ERROR] {}", text);
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
    
    // Give it a moment to start, then poll for authentication
    // copilot-api typically takes 3-8 seconds to fully authenticate on first run
    let mut authenticated = false;
    for _ in 0..16 {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        
        // Check if stdout listener already detected authentication
        {
            let status = state.copilot_status.lock().unwrap();
            if status.authenticated {
                authenticated = true;
                break;
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
                authenticated = true;
                break;
            }
        }
    }
    
    // Update status - only upgrade authenticated status, don't downgrade
    // (stdout listener may have already set authenticated = true)
    let new_status = {
        let mut status = state.copilot_status.lock().unwrap();
        if authenticated && !status.authenticated {
            status.authenticated = true;
        }
        status.clone()
    };
    
    // Emit status update
    let _ = app.emit("copilot-status-changed", new_status.clone());
    
    Ok(new_status)
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

// Detection result for copilot-api installation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotApiDetection {
    pub installed: bool,
    pub version: Option<String>,
    pub copilot_bin: Option<String>,  // Path to copilot-api binary (if installed)
    pub npx_bin: Option<String>,      // Path to npx binary (for fallback)
    pub npm_bin: Option<String>,      // Path to npm binary (for installs)
    pub node_bin: Option<String>,     // Path to node binary actually used
    pub node_available: bool,
    pub checked_node_paths: Vec<String>,
    pub checked_copilot_paths: Vec<String>,
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
            // npm global bin (for detecting npm-installed tools)
            format!("{}/AppData/Roaming/npm/node.exe", home_str),
            // Fallback to PATH
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
    
    // Find working node binary
    let mut node_bin: Option<String> = None;
    for path in &node_paths {
        let check = app.shell().command(path).args(["--version"]).output().await;
        if check.as_ref().map(|o| o.status.success()).unwrap_or(false) {
            node_bin = Some(path.to_string());
            break;
        }
    }
    
    // Also try just "node" in case PATH is available
    if node_bin.is_none() {
        let check = app.shell().command("node").args(["--version"]).output().await;
        if check.as_ref().map(|o| o.status.success()).unwrap_or(false) {
            node_bin = Some("node".to_string());
        }
    }
    
    if node_bin.is_none() {
        return Ok(CopilotApiDetection {
            installed: false,
            version: None,
            copilot_bin: None,
            npx_bin: None,
            npm_bin: None,
            node_bin: None,
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
                            .map(|n| n.replace("/node", "/copilot-api"))
                            .unwrap_or_else(|| "copilot-api".to_string());
                        
                        return Ok(CopilotApiDetection {
                            installed: true,
                            version,
                            copilot_bin: Some(copilot_bin),
                            npx_bin: Some(npx_bin),
                            npm_bin: Some(npm_bin),
                            node_bin: node_bin.clone(),
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
        node_available: true,
        checked_node_paths: node_paths,
        checked_copilot_paths: copilot_paths,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotApiInstallResult {
    pub success: bool,
    pub message: String,
    pub version: Option<String>,
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

// Compute usage statistics from local request history (persisted data)
// This ensures Analytics shows the same data as Dashboard's Request History
#[tauri::command]
fn get_usage_stats() -> UsageStats {
    let history = load_request_history();
    
    if history.requests.is_empty() {
        return UsageStats::default();
    }
    
    // Compute aggregate stats
    let total_requests = history.requests.len() as u64;
    let success_count = history.requests.iter().filter(|r| r.status < 400).count() as u64;
    let failure_count = total_requests - success_count;
    
    let input_tokens = history.total_tokens_in;
    let output_tokens = history.total_tokens_out;
    let total_tokens = input_tokens + output_tokens;
    
    // Get today's start timestamp for filtering
    let today_start = chrono::Local::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(chrono::Local)
        .unwrap()
        .timestamp_millis() as u64;
    
    // Compute today's stats
    let requests_today = history.requests.iter()
        .filter(|r| r.timestamp >= today_start)
        .count() as u64;
    
    let tokens_today: u64 = history.requests.iter()
        .filter(|r| r.timestamp >= today_start)
        .map(|r| (r.tokens_in.unwrap_or(0) + r.tokens_out.unwrap_or(0)) as u64)
        .sum();
    
    // Build time-series data (requests by day)
    let mut requests_by_day_map: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    let mut tokens_by_day_map: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    let mut requests_by_hour_map: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    let mut tokens_by_hour_map: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    
    for req in &history.requests {
        // Convert timestamp to datetime
        let dt = chrono::DateTime::from_timestamp_millis(req.timestamp as i64)
            .unwrap_or_else(|| chrono::Utc::now());
        let local_dt = dt.with_timezone(&chrono::Local);
        
        // Day key: YYYY-MM-DD
        let day_key = local_dt.format("%Y-%m-%d").to_string();
        *requests_by_day_map.entry(day_key.clone()).or_insert(0) += 1;
        let req_tokens = (req.tokens_in.unwrap_or(0) + req.tokens_out.unwrap_or(0)) as u64;
        *tokens_by_day_map.entry(day_key).or_insert(0) += req_tokens;
        
        // Hour key: YYYY-MM-DDTHH
        let hour_key = local_dt.format("%Y-%m-%dT%H").to_string();
        *requests_by_hour_map.entry(hour_key.clone()).or_insert(0) += 1;
        *tokens_by_hour_map.entry(hour_key).or_insert(0) += req_tokens;
    }
    
    // Convert maps to sorted vectors (oldest first)
    let mut requests_by_day: Vec<TimeSeriesPoint> = requests_by_day_map
        .into_iter()
        .map(|(label, value)| TimeSeriesPoint { label, value })
        .collect();
    requests_by_day.sort_by(|a, b| a.label.cmp(&b.label));
    // Keep last 14 days
    if requests_by_day.len() > 14 {
        requests_by_day = requests_by_day.split_off(requests_by_day.len() - 14);
    }
    
    let mut tokens_by_day: Vec<TimeSeriesPoint> = tokens_by_day_map
        .into_iter()
        .map(|(label, value)| TimeSeriesPoint { label, value })
        .collect();
    tokens_by_day.sort_by(|a, b| a.label.cmp(&b.label));
    if tokens_by_day.len() > 14 {
        tokens_by_day = tokens_by_day.split_off(tokens_by_day.len() - 14);
    }
    
    let mut requests_by_hour: Vec<TimeSeriesPoint> = requests_by_hour_map
        .into_iter()
        .map(|(label, value)| TimeSeriesPoint { label, value })
        .collect();
    requests_by_hour.sort_by(|a, b| a.label.cmp(&b.label));
    // Keep last 24 hours
    if requests_by_hour.len() > 24 {
        requests_by_hour = requests_by_hour.split_off(requests_by_hour.len() - 24);
    }
    
    let mut tokens_by_hour: Vec<TimeSeriesPoint> = tokens_by_hour_map
        .into_iter()
        .map(|(label, value)| TimeSeriesPoint { label, value })
        .collect();
    tokens_by_hour.sort_by(|a, b| a.label.cmp(&b.label));
    if tokens_by_hour.len() > 24 {
        tokens_by_hour = tokens_by_hour.split_off(tokens_by_hour.len() - 24);
    }
    
    // Build model usage stats
    let mut model_map: std::collections::HashMap<String, (u64, u64)> = std::collections::HashMap::new();
    for req in &history.requests {
        let entry = model_map.entry(req.model.clone()).or_insert((0, 0));
        entry.0 += 1; // requests
        entry.1 += (req.tokens_in.unwrap_or(0) + req.tokens_out.unwrap_or(0)) as u64; // tokens
    }
    
    let mut models: Vec<ModelUsage> = model_map
        .into_iter()
        .map(|(model, (requests, tokens))| ModelUsage { model, requests, tokens })
        .collect();
    models.sort_by(|a, b| b.requests.cmp(&a.requests));
    
    UsageStats {
        total_requests,
        success_count,
        failure_count,
        total_tokens,
        input_tokens,
        output_tokens,
        requests_today,
        tokens_today,
        models,
        requests_by_day,
        tokens_by_day,
        requests_by_hour,
        tokens_by_hour,
    }
}

// Get request history
#[tauri::command]
fn get_request_history() -> RequestHistory {
    load_request_history()
}

// Add a request to history (called when request-log event is emitted)
#[tauri::command]
fn add_request_to_history(request: RequestLog) -> Result<RequestHistory, String> {
    let mut history = load_request_history();
    
    // Calculate cost for this request
    let tokens_in = request.tokens_in.unwrap_or(0);
    let tokens_out = request.tokens_out.unwrap_or(0);
    let cost = estimate_request_cost(&request.model, tokens_in, tokens_out);
    
    // Update totals
    history.total_tokens_in += tokens_in as u64;
    history.total_tokens_out += tokens_out as u64;
    history.total_cost_usd += cost;
    
    // Add request (with deduplication check)
    // Check if request with same ID already exists to prevent duplicates
    if !history.requests.iter().any(|r| r.id == request.id) {
        history.requests.push(request);
    }
    
    // Save
    save_request_history(&history)?;
    
    Ok(history)
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
        .header("X-Management-Key", "proxypal-mgmt-key")
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
    let mut model_stats: std::collections::HashMap<String, (u64, u64, u64)> = std::collections::HashMap::new(); // (requests, input, output)
    
    if let Some(apis) = usage.get("apis").and_then(|v| v.as_object()) {
        for (_api_path, api_data) in apis {
            if let Some(models) = api_data.get("models").and_then(|v| v.as_object()) {
                for (model_name, model_data) in models {
                    if let Some(details) = model_data.get("details").and_then(|v| v.as_array()) {
                        for detail in details {
                            if let Some(tokens) = detail.get("tokens") {
                                let input = tokens.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                let output = tokens.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                total_input += input;
                                total_output += output;
                                
                                let entry = model_stats.entry(model_name.clone()).or_insert((0, 0, 0));
                                entry.0 += 1; // request count
                                entry.1 += input;
                                entry.2 += output;
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Calculate cost based on real token data
    let mut total_cost: f64 = 0.0;
    for (model_name, (_, input, output)) in &model_stats {
        total_cost += estimate_request_cost(model_name, *input as u32, *output as u32);
    }
    
    // Update local history with synced data
    let mut history = load_request_history();
    history.total_tokens_in = total_input;
    history.total_tokens_out = total_output;
    history.total_cost_usd = total_cost;
    
    // Save updated history
    save_request_history(&history)?;
    
    Ok(history)
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
    let endpoint = match provider.as_str() {
        "claude" => format!("http://localhost:{}/v0/management/anthropic-auth-url?is_webui=true", port),
        "openai" => format!("http://localhost:{}/v0/management/codex-auth-url?is_webui=true", port),
        "gemini" => format!("http://localhost:{}/v0/management/gemini-cli-auth-url?is_webui=true", port),
        "qwen" => format!("http://localhost:{}/v0/management/qwen-auth-url?is_webui=true", port),
        "iflow" => format!("http://localhost:{}/v0/management/iflow-auth-url?is_webui=true", port),
        "antigravity" => format!("http://localhost:{}/v0/management/antigravity-auth-url?is_webui=true", port),
        "vertex" => return Err("Vertex uses service account import, not OAuth. Use import_vertex_credential instead.".to_string()),
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    // Make HTTP request to get OAuth URL
    let client = reqwest::Client::new();
    let response = client
        .get(&endpoint)
        .header("X-Management-Key", "proxypal-mgmt-key")
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
        .header("X-Management-Key", "proxypal-mgmt-key")
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

#[tauri::command]
fn get_config(state: State<AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn save_config(state: State<AppState>, config: AppConfig) -> Result<(), String> {
    let mut current_config = state.config.lock().unwrap();
    *current_config = config.clone();
    save_config_to_file(&config)
}

// Provider health status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderHealth {
    pub claude: HealthStatus,
    pub openai: HealthStatus,
    pub gemini: HealthStatus,
    pub qwen: HealthStatus,
    pub iflow: HealthStatus,
    pub vertex: HealthStatus,
    pub antigravity: HealthStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    pub status: String,  // "healthy", "degraded", "offline", "unconfigured"
    pub latency_ms: Option<u64>,
    pub last_checked: u64,
}

impl Default for HealthStatus {
    fn default() -> Self {
        Self {
            status: "unconfigured".to_string(),
            latency_ms: None,
            last_checked: 0,
        }
    }
}

#[tauri::command]
async fn check_provider_health(state: State<'_, AppState>) -> Result<ProviderHealth, String> {
    let config = state.config.lock().unwrap().clone();
    let auth = state.auth_status.lock().unwrap().clone();
    let proxy_running = state.proxy_status.lock().unwrap().running;
    
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    
    // If proxy isn't running, all providers are offline
    if !proxy_running {
        return Ok(ProviderHealth {
            claude: HealthStatus { status: "offline".to_string(), latency_ms: None, last_checked: timestamp },
            openai: HealthStatus { status: "offline".to_string(), latency_ms: None, last_checked: timestamp },
            gemini: HealthStatus { status: "offline".to_string(), latency_ms: None, last_checked: timestamp },
            qwen: HealthStatus { status: "offline".to_string(), latency_ms: None, last_checked: timestamp },
            iflow: HealthStatus { status: "offline".to_string(), latency_ms: None, last_checked: timestamp },
            vertex: HealthStatus { status: "offline".to_string(), latency_ms: None, last_checked: timestamp },
            antigravity: HealthStatus { status: "offline".to_string(), latency_ms: None, last_checked: timestamp },
        });
    }
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    
    let endpoint = format!("http://localhost:{}/v1/models", config.port);
    
    // Check proxy health by requesting models endpoint
    let start = std::time::Instant::now();
    let response = client.get(&endpoint)
        .header("Authorization", "Bearer proxypal-local")
        .send()
        .await;
    let latency = start.elapsed().as_millis() as u64;
    
    let proxy_healthy = response.map(|r| r.status().is_success()).unwrap_or(false);
    
    Ok(ProviderHealth {
        claude: if auth.claude > 0 && proxy_healthy {
            HealthStatus { status: "healthy".to_string(), latency_ms: Some(latency), last_checked: timestamp }
        } else if auth.claude > 0 {
            HealthStatus { status: "degraded".to_string(), latency_ms: None, last_checked: timestamp }
        } else {
            HealthStatus { status: "unconfigured".to_string(), latency_ms: None, last_checked: timestamp }
        },
        openai: if auth.openai > 0 && proxy_healthy {
            HealthStatus { status: "healthy".to_string(), latency_ms: Some(latency), last_checked: timestamp }
        } else if auth.openai > 0 {
            HealthStatus { status: "degraded".to_string(), latency_ms: None, last_checked: timestamp }
        } else {
            HealthStatus { status: "unconfigured".to_string(), latency_ms: None, last_checked: timestamp }
        },
        gemini: if auth.gemini > 0 && proxy_healthy {
            HealthStatus { status: "healthy".to_string(), latency_ms: Some(latency), last_checked: timestamp }
        } else if auth.gemini > 0 {
            HealthStatus { status: "degraded".to_string(), latency_ms: None, last_checked: timestamp }
        } else {
            HealthStatus { status: "unconfigured".to_string(), latency_ms: None, last_checked: timestamp }
        },
        qwen: if auth.qwen > 0 && proxy_healthy {
            HealthStatus { status: "healthy".to_string(), latency_ms: Some(latency), last_checked: timestamp }
        } else if auth.qwen > 0 {
            HealthStatus { status: "degraded".to_string(), latency_ms: None, last_checked: timestamp }
        } else {
            HealthStatus { status: "unconfigured".to_string(), latency_ms: None, last_checked: timestamp }
        },
        iflow: if auth.iflow > 0 && proxy_healthy {
            HealthStatus { status: "healthy".to_string(), latency_ms: Some(latency), last_checked: timestamp }
        } else if auth.iflow > 0 {
            HealthStatus { status: "degraded".to_string(), latency_ms: None, last_checked: timestamp }
        } else {
            HealthStatus { status: "unconfigured".to_string(), latency_ms: None, last_checked: timestamp }
        },
        vertex: if auth.vertex > 0 && proxy_healthy {
            HealthStatus { status: "healthy".to_string(), latency_ms: Some(latency), last_checked: timestamp }
        } else if auth.vertex > 0 {
            HealthStatus { status: "degraded".to_string(), latency_ms: None, last_checked: timestamp }
        } else {
            HealthStatus { status: "unconfigured".to_string(), latency_ms: None, last_checked: timestamp }
        },
        antigravity: if auth.antigravity > 0 && proxy_healthy {
            HealthStatus { status: "healthy".to_string(), latency_ms: Some(latency), last_checked: timestamp }
        } else if auth.antigravity > 0 {
            HealthStatus { status: "degraded".to_string(), latency_ms: None, last_checked: timestamp }
        } else {
            HealthStatus { status: "unconfigured".to_string(), latency_ms: None, last_checked: timestamp }
        },
    })
}

// Test agent connection by making a simple API call through the proxy
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTestResult {
    pub success: bool,
    pub message: String,
    pub latency_ms: Option<u64>,
}

#[tauri::command]
async fn test_agent_connection(state: State<'_, AppState>, agent_id: String) -> Result<AgentTestResult, String> {
    let config = state.config.lock().unwrap().clone();
    let proxy_running = state.proxy_status.lock().unwrap().running;
    
    if !proxy_running {
        return Ok(AgentTestResult {
            success: false,
            message: "Proxy is not running".to_string(),
            latency_ms: None,
        });
    }
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    
    // Use /v1/models endpoint for testing - lightweight and doesn't consume tokens
    let endpoint = format!("http://localhost:{}/v1/models", config.port);
    
    let start = std::time::Instant::now();
    let response = client.get(&endpoint)
        .header("Authorization", "Bearer proxypal-local")
        .send()
        .await;
    let latency = start.elapsed().as_millis() as u64;
    
    match response {
        Ok(resp) => {
            if resp.status().is_success() {
                Ok(AgentTestResult {
                    success: true,
                    message: format!("Connection successful! {} is ready to use.", agent_id),
                    latency_ms: Some(latency),
                })
            } else {
                Ok(AgentTestResult {
                    success: false,
                    message: format!("Proxy returned status {}", resp.status()),
                    latency_ms: Some(latency),
                })
            }
        }
        Err(e) => {
            Ok(AgentTestResult {
                success: false,
                message: format!("Connection failed: {}", e),
                latency_ms: None,
            })
        }
    }
}

// Get available models from CLIProxyAPI /v1/models endpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModel {
    pub id: String,
    pub owned_by: String,
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
        .map(|m| AvailableModel {
            id: m.id,
            owned_by: m.owned_by,
        })
        .collect();
    
    Ok(models)
}

// Test connection to a custom OpenAI-compatible provider
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResult {
    pub success: bool,
    pub message: String,
    pub latency_ms: Option<u64>,
    pub models_found: Option<u32>,
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

// Detected AI coding tool
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedTool {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub config_path: Option<String>,
    pub can_auto_configure: bool,
}

// CLI Agent configuration status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    pub installed: bool,
    pub configured: bool,
    pub config_type: String,  // "env", "file", "both"
    pub config_path: Option<String>,
    pub logo: String,
    pub docs_url: String,
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

// Get model context/output limits based on model ID and provider
// Source: https://models.dev (sst/models.dev repo)
fn get_model_limits(model_id: &str, owned_by: &str) -> (u64, u64) {
    // Return (context_limit, output_limit)
    // First check model_id patterns (handles Antigravity/proxied models like gemini-claude-*)
    let model_lower = model_id.to_lowercase();
    
    // Claude models (direct or via Antigravity like gemini-claude-*)
    if model_lower.contains("claude") {
        // Claude 4.5 models: 200K context, 64K output
        // Claude 3.5 haiku: 200K context, 8K output
        if model_lower.contains("3-5-haiku") || model_lower.contains("3-haiku") {
            return (200000, 8192);
        } else {
            // sonnet-4-5, opus-4-5, haiku-4-5, and other Claude 4.x models
            return (200000, 64000);
        }
    }
    
    // Gemini models (but not gemini-claude-* which is handled above)
    if model_lower.contains("gemini") {
        // Gemini 2.5 models: 1M context, 65K output
        return (1048576, 65536);
    }
    
    // GPT/OpenAI models
    if model_lower.contains("gpt") || model_lower.starts_with("o1") || model_lower.starts_with("o3") {
        // o1, o3 reasoning models: 200K context, 100K output
        if model_lower.contains("o3") || model_lower.contains("o1") {
            return (200000, 100000);
        } else {
            // gpt-4o, gpt-4o-mini: 128K context, 16K output
            return (128000, 16384);
        }
    }
    
    // Qwen models
    if model_lower.contains("qwen") {
        // Qwen3 Coder Plus: 1M context
        if model_lower.contains("coder") {
            return (1048576, 65536);
        } else {
            // Qwen3 models: 262K context (max), 65K output
            return (262144, 65536);
        }
    }
    
    // DeepSeek models
    if model_lower.contains("deepseek") {
        // deepseek-reasoner: 128K output, deepseek-chat: 8K output
        if model_lower.contains("reasoner") || model_lower.contains("r1") {
            return (128000, 128000);
        } else {
            return (128000, 8192);
        }
    }
    
    // Fallback to owned_by for any remaining models
    match owned_by {
        "anthropic" => (200000, 64000),
        "google" => (1048576, 65536),
        "openai" => (128000, 16384),
        "qwen" => (262144, 65536),
        "deepseek" => (128000, 8192),
        _ => (128000, 16384) // safe defaults
    }
}

// Get display name for a model
fn get_model_display_name(model_id: &str, owned_by: &str) -> String {
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
    match owned_by {
        "anthropic" => format!("{}", base_name),
        "google" => format!("{}", base_name),
        "openai" => format!("{}", base_name),
        "qwen" => format!("{}", base_name),
        _ => base_name
    }
}

// Configure a CLI agent with ProxyPal
#[tauri::command]
fn configure_cli_agent(state: State<AppState>, agent_id: String, models: Vec<AvailableModel>) -> Result<serde_json::Value, String> {
    let config = state.config.lock().unwrap();
    let port = config.port;
    let endpoint = format!("http://127.0.0.1:{}", port);
    let endpoint_v1 = format!("{}/v1", endpoint);
    let home = dirs::home_dir().ok_or("Could not find home directory")?;

    match agent_id.as_str() {
        "claude-code" => {
            // Generate shell config for Claude Code
            let shell_config = format!(r#"# ProxyPal - Claude Code Configuration
export ANTHROPIC_BASE_URL="{}"
export ANTHROPIC_AUTH_TOKEN="proxypal-local"
# For Claude Code 2.x
export ANTHROPIC_DEFAULT_OPUS_MODEL="claude-opus-4-1-20250805"
export ANTHROPIC_DEFAULT_SONNET_MODEL="claude-sonnet-4-5-20250929"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="claude-3-5-haiku-20241022"
# For Claude Code 1.x
export ANTHROPIC_MODEL="claude-sonnet-4-5-20250929"
export ANTHROPIC_SMALL_FAST_MODEL="claude-3-5-haiku-20241022"
"#, endpoint);

            Ok(serde_json::json!({
                "success": true,
                "configType": "env",
                "shellConfig": shell_config,
                "instructions": "Add the above to your ~/.bashrc, ~/.zshrc, or shell config file, then restart your terminal."
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
                serde_json::json!({
                    "model": m.id,
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
            // OpenCode uses opencode.json config file with custom provider
            // See: https://opencode.ai/docs/providers/#custom-provider
            let config_dir = home.join(".config/opencode");
            std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
            let config_path = config_dir.join("opencode.json");
            
            // Build dynamic models object from available models
            // OpenCode needs model configs with name and limits
            let mut models_obj = serde_json::Map::new();
            for m in &models {
                let (context_limit, output_limit) = get_model_limits(&m.id, &m.owned_by);
                let display_name = get_model_display_name(&m.id, &m.owned_by);
                // Enable reasoning display for models with "-thinking" suffix
                let is_thinking_model = m.id.ends_with("-thinking");
                // For thinking models: budgetTokens = half of output_limit, min output = budgetTokens + buffer
                // This ensures enough room for both thinking and response
                let thinking_budget: u64 = output_limit / 2;  // Use half for thinking
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
                    model_config["reasoning"] = serde_json::json!(true);
                    model_config["options"] = serde_json::json!({
                        "thinking": {
                            "type": "enabled",
                            "budgetTokens": thinking_budget
                        }
                    });
                }
                models_obj.insert(m.id.clone(), model_config);
            }
            
            // Create or update opencode.json with proxypal provider
            let opencode_config = serde_json::json!({
                "$schema": "https://opencode.ai/config.json",
                "provider": {
                    "proxypal": {
                        "npm": "@ai-sdk/anthropic",
                        "name": "ProxyPal (Local Proxy)",
                        "options": {
                            "baseURL": endpoint_v1,
                            "apiKey": "proxypal-local"
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

// API Key types matching Management API schema
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiApiKey {
    pub api_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<std::collections::HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excluded_models: Option<Vec<String>>,
}

// Model mapping with alias and name (used by Claude and OpenAI-compatible providers)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelMapping {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeApiKey {
    pub api_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<std::collections::HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<Vec<ModelMapping>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excluded_models: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexApiKey {
    pub api_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatibleApiKeyEntry {
    pub api_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatibleProvider {
    pub name: String,
    pub base_url: String,
    pub api_key_entries: Vec<OpenAICompatibleApiKeyEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<Vec<ModelMapping>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<std::collections::HashMap<String, String>>,
}

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
        .header("X-Management-Key", "proxypal-mgmt-key")
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
        .header("X-Management-Key", "proxypal-mgmt-key")
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
        .header("X-Management-Key", "proxypal-mgmt-key")
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
        .header("X-Management-Key", "proxypal-mgmt-key")
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
        .header("X-Management-Key", "proxypal-mgmt-key")
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
        .header("X-Management-Key", "proxypal-mgmt-key")
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

// OpenAI-Compatible Providers
#[tauri::command]
async fn get_openai_compatible_providers(state: State<'_, AppState>) -> Result<Vec<OpenAICompatibleProvider>, String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "openai-compatibility");
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", "proxypal-mgmt-key")
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
        .header("X-Management-Key", "proxypal-mgmt-key")
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

// Auth file entry from Management API
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthFile {
    pub id: String,
    pub name: String,
    pub provider: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_message: Option<String>,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub unavailable: bool,
    #[serde(default)]
    pub runtime_only: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modtime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_refresh: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub success_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_count: Option<u64>,
}

// Get all auth files
#[tauri::command]
async fn get_auth_files(state: State<'_, AppState>) -> Result<Vec<AuthFile>, String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "auth-files");
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", "proxypal-mgmt-key")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch auth files: {}", e))?;
    
    if !response.status().is_success() {
        return Ok(Vec::new());
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    
    // Management API returns { "files": [...] } or just an array
    let files_array = if let Some(files) = json.get("files") {
        files.clone()
    } else if json.is_array() {
        json
    } else {
        return Ok(Vec::new());
    };
    
    // Convert snake_case from API to camelCase for frontend
    let json_str = serde_json::to_string(&files_array).map_err(|e| e.to_string())?;
    let converted = json_str
        .replace("\"status_message\"", "\"statusMessage\"")
        .replace("\"runtime_only\"", "\"runtimeOnly\"")
        .replace("\"account_type\"", "\"accountType\"")
        .replace("\"created_at\"", "\"createdAt\"")
        .replace("\"updated_at\"", "\"updatedAt\"")
        .replace("\"last_refresh\"", "\"lastRefresh\"")
        .replace("\"success_count\"", "\"successCount\"")
        .replace("\"failure_count\"", "\"failureCount\"");
    
    serde_json::from_str(&converted).map_err(|e| e.to_string())
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
        .header("X-Management-Key", "proxypal-mgmt-key")
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
    let port = state.config.lock().unwrap().port;
    let url = format!("{}/{}", get_management_url(port, "auth-files"), file_id);
    
    let client = build_management_client();
    let response = client
        .delete(&url)
        .header("X-Management-Key", "proxypal-mgmt-key")
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
async fn toggle_auth_file(state: State<'_, AppState>, file_id: String, disabled: bool) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = format!("{}/{}/disabled", get_management_url(port, "auth-files"), file_id);
    
    let client = build_management_client();
    let response = client
        .put(&url)
        .header("X-Management-Key", "proxypal-mgmt-key")
        .json(&serde_json::json!({ "value": disabled }))
        .send()
        .await
        .map_err(|e| format!("Failed to toggle auth file: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to toggle auth file: {} - {}", status, text));
    }
    
    Ok(())
}

// Download auth file - returns path to temp file
#[tauri::command]
async fn download_auth_file(state: State<'_, AppState>, file_id: String, filename: String) -> Result<String, String> {
    let port = state.config.lock().unwrap().port;
    let url = format!("{}?id={}", get_management_url(port, "auth-files/download"), file_id);
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", "proxypal-mgmt-key")
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
    let url = get_management_url(port, "auth-files");
    
    let client = build_management_client();
    let response = client
        .delete(&url)
        .header("X-Management-Key", "proxypal-mgmt-key")
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
        .header("X-Management-Key", "proxypal-mgmt-key")
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
        .header("X-Management-Key", "proxypal-mgmt-key")
        .json(&serde_json::json!({ "value": value }))
        .send()
        .await
        .map_err(|e| format!("Failed to set max retry interval: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to set max retry interval: {} - {}", status, text));
    }
    
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
        .header("X-Management-Key", "proxypal-mgmt-key")
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
        .header("X-Management-Key", "proxypal-mgmt-key")
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

// Get prioritize model mappings from Management API
#[tauri::command]
async fn get_prioritize_model_mappings(state: State<'_, AppState>) -> Result<bool, String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "ampcode/force-model-mappings");
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", "proxypal-mgmt-key")
        .send()
        .await
        .map_err(|e| format!("Failed to get prioritize model mappings: {}", e))?;
    
    if !response.status().is_success() {
        return Ok(false); // Default to false
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(json.get("force-model-mappings").and_then(|v| v.as_bool()).unwrap_or(false))
}

// Set prioritize model mappings via Management API
#[tauri::command]
async fn set_prioritize_model_mappings(state: State<'_, AppState>, value: bool) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "ampcode/force-model-mappings");
    
    let client = build_management_client();
    let response = client
        .put(&url)
        .header("X-Management-Key", "proxypal-mgmt-key")
        .json(&serde_json::json!({ "value": value }))
        .send()
        .await
        .map_err(|e| format!("Failed to set prioritize model mappings: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to set prioritize model mappings: {} - {}", status, text));
    }
    
    Ok(())
}

// Get OAuth excluded models from Management API
#[tauri::command]
async fn get_oauth_excluded_models(state: State<'_, AppState>) -> Result<std::collections::HashMap<String, Vec<String>>, String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "oauth-excluded-models");
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", "proxypal-mgmt-key")
        .send()
        .await
        .map_err(|e| format!("Failed to get OAuth excluded models: {}", e))?;
    
    if !response.status().is_success() {
        return Ok(std::collections::HashMap::new());
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    
    // Response format: { "oauth-excluded-models": { "gemini": ["model1", "model2"], ... } }
    if let Some(models) = json.get("oauth-excluded-models") {
        if let Some(obj) = models.as_object() {
            let mut result = std::collections::HashMap::new();
            for (key, val) in obj {
                if let Some(arr) = val.as_array() {
                    let models: Vec<String> = arr
                        .iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect();
                    result.insert(key.clone(), models);
                }
            }
            return Ok(result);
        }
    }
    
    Ok(std::collections::HashMap::new())
}

// Set OAuth excluded models for a provider via Management API
#[tauri::command]
async fn set_oauth_excluded_models(
    state: State<'_, AppState>,
    provider: String,
    models: Vec<String>,
) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "oauth-excluded-models");
    
    let client = build_management_client();
    
    // CLIProxyAPI expects: { "provider": "anthropic", "models": ["model1", "model2"] }
    let body = serde_json::json!({
        "provider": provider,
        "models": models
    });
    
    let response = client
        .patch(&url)
        .header("X-Management-Key", "proxypal-mgmt-key")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to set OAuth excluded models: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to set OAuth excluded models: {} - {}", status, text));
    }
    
    Ok(())
}

// Delete OAuth excluded models for a provider via Management API
#[tauri::command]
async fn delete_oauth_excluded_models(
    state: State<'_, AppState>,
    provider: String,
) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = format!("{}?provider={}", get_management_url(port, "oauth-excluded-models"), provider);
    
    let client = build_management_client();
    let response = client
        .delete(&url)
        .header("X-Management-Key", "proxypal-mgmt-key")
        .send()
        .await
        .map_err(|e| format!("Failed to delete OAuth excluded models: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to delete OAuth excluded models: {} - {}", status, text));
    }
    
    Ok(())
}

// Get raw config YAML from Management API
#[tauri::command]
async fn get_config_yaml(state: State<'_, AppState>) -> Result<String, String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "config.yaml");
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", "proxypal-mgmt-key")
        .send()
        .await
        .map_err(|e| format!("Failed to get config YAML: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to get config YAML: {} - {}", status, text));
    }
    
    response.text().await.map_err(|e| e.to_string())
}

// Set raw config YAML via Management API
#[tauri::command]
async fn set_config_yaml(state: State<'_, AppState>, yaml: String) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "config.yaml");
    
    let client = build_management_client();
    let response = client
        .put(&url)
        .header("X-Management-Key", "proxypal-mgmt-key")
        .header("Content-Type", "application/yaml")
        .body(yaml)
        .send()
        .await
        .map_err(|e| format!("Failed to set config YAML: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to set config YAML: {} - {}", status, text));
    }
    
    Ok(())
}

// Get request error logs from Management API
#[tauri::command]
async fn get_request_error_logs(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "request-error-logs");
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", "proxypal-mgmt-key")
        .send()
        .await
        .map_err(|e| format!("Failed to get request error logs: {}", e))?;
    
    if !response.status().is_success() {
        return Ok(Vec::new());
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    
    // Response format: { "files": ["error_2025-01-01.log", ...] }
    if let Some(files) = json.get("files") {
        if let Some(arr) = files.as_array() {
            let result: Vec<String> = arr
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect();
            return Ok(result);
        }
    }
    
    Ok(Vec::new())
}

// Get content of a specific request error log file
#[tauri::command]
async fn get_request_error_log_content(state: State<'_, AppState>, filename: String) -> Result<String, String> {
    let port = state.config.lock().unwrap().port;
    let url = format!("{}/{}", get_management_url(port, "request-error-logs"), filename);
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", "proxypal-mgmt-key")
        .send()
        .await
        .map_err(|e| format!("Failed to get error log content: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to get error log content: {} - {}", status, text));
    }
    
    response.text().await.map_err(|e| e.to_string())
}

// ============================================================================
// Log Viewer Commands
// ============================================================================

// Log entry structure
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
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
        .header("X-Management-Key", "proxypal-mgmt-key")
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
        .header("X-Management-Key", "proxypal-mgmt-key")
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            import_vertex_credential,
            get_config,
            save_config,
            check_provider_health,
            detect_ai_tools,
            configure_continue,
            get_tool_setup_info,
            detect_cli_agents,
            configure_cli_agent,
            get_shell_profile_path,
            append_to_shell_profile,
            get_usage_stats,
            get_request_history,
            add_request_to_history,
            clear_request_history,
            sync_usage_from_proxy,
            test_agent_connection,
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
            get_prioritize_model_mappings,
            set_prioritize_model_mappings,
            get_oauth_excluded_models,
            set_oauth_excluded_models,
            delete_oauth_excluded_models,
            get_config_yaml,
            set_config_yaml,
            get_request_error_logs,
            get_request_error_log_content,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Cleanup: Kill proxy and copilot processes before exit
                if let Some(state) = app_handle.try_state::<AppState>() {
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
            }
        });
}

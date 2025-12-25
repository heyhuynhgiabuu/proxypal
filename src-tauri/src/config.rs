use serde::{Deserialize, Serialize};

use crate::types::{
    AmpModelMapping, AmpOpenAIProvider,
    ClaudeApiKey, GeminiApiKey, CodexApiKey,
    CopilotConfig,
    amp::generate_uuid,
};

/// App configuration persisted to config.json
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
    #[serde(default = "default_logs_max_total_size_mb")]
    pub logs_max_total_size_mb: u32,
    #[serde(default = "default_config_version")]
    pub config_version: u8,
    #[serde(default)]
    pub amp_api_key: String,
    #[serde(default)]
    pub amp_model_mappings: Vec<AmpModelMapping>,
    #[serde(default)]
    pub amp_openai_provider: Option<AmpOpenAIProvider>, // DEPRECATED: Use amp_openai_providers
    #[serde(default)]
    pub amp_openai_providers: Vec<AmpOpenAIProvider>,
    #[serde(default)]
    pub amp_routing_mode: String,
    #[serde(default = "default_routing_strategy")]
    pub routing_strategy: String,
    #[serde(default)]
    pub copilot: CopilotConfig,
    #[serde(default)]
    pub force_model_mappings: bool,
    #[serde(default)]
    pub claude_api_keys: Vec<ClaudeApiKey>,
    #[serde(default)]
    pub gemini_api_keys: Vec<GeminiApiKey>,
    #[serde(default)]
    pub codex_api_keys: Vec<CodexApiKey>,
    #[serde(default)]
    pub thinking_budget_mode: String,
    #[serde(default)]
    pub thinking_budget_custom: u32,
    #[serde(default)]
    pub reasoning_effort_level: String,
    #[serde(default = "default_close_to_tray")]
    pub close_to_tray: bool,
    #[serde(default)]
    pub max_retry_interval: i32,
    #[serde(default = "default_proxy_api_key")]
    pub proxy_api_key: String,
    #[serde(default = "default_management_key")]
    pub management_key: String,
    #[serde(default = "default_quota_view_mode")]
    pub quota_view_mode: String,
    #[serde(default)]
    pub quota_selected_accounts: Vec<String>,
    #[serde(default)]
    pub quota_selected_models: Vec<String>,
    #[serde(default = "default_quota_filters_expanded")]
    pub quota_filters_expanded: bool,
}

fn default_management_key() -> String {
    "proxypal-mgmt-key".to_string()
}

fn default_proxy_api_key() -> String {
    "proxypal-local".to_string()
}

fn default_close_to_tray() -> bool {
    true
}

fn default_usage_stats_enabled() -> bool {
    true
}

fn default_logs_max_total_size_mb() -> u32 {
    100
}

fn default_config_version() -> u8 {
    1
}

fn default_routing_strategy() -> String {
    "round-robin".to_string()
}

fn default_quota_view_mode() -> String {
    "chart".to_string()
}

fn default_quota_filters_expanded() -> bool {
    false
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
            request_logging: true,
            logging_to_file: true,
            logs_max_total_size_mb: 100,
            config_version: 1,
            amp_api_key: String::new(),
            amp_model_mappings: Vec::new(),
            amp_openai_provider: None,
            amp_openai_providers: Vec::new(),
            amp_routing_mode: "mappings".to_string(),
            routing_strategy: "round-robin".to_string(),
            copilot: CopilotConfig::default(),
            force_model_mappings: false,
            claude_api_keys: Vec::new(),
            gemini_api_keys: Vec::new(),
            codex_api_keys: Vec::new(),
            thinking_budget_mode: "medium".to_string(),
            thinking_budget_custom: 16000,
            reasoning_effort_level: "medium".to_string(),
            close_to_tray: true,
            max_retry_interval: 0,
            proxy_api_key: "proxypal-local".to_string(),
            management_key: "proxypal-mgmt-key".to_string(),
            quota_view_mode: "chart".to_string(),
            quota_selected_accounts: Vec::new(),
            quota_selected_models: Vec::new(),
            quota_filters_expanded: false,
        }
    }
}

/// Get the proxypal config directory, creating it if needed
pub fn get_proxypal_config_dir() -> std::path::PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| {
            eprintln!("[ProxyPal] Warning: Could not determine config directory, using current directory");
            std::path::PathBuf::from(".")
        })
        .join("proxypal");
    
    if let Err(e) = std::fs::create_dir_all(&config_dir) {
        eprintln!(
            "[ProxyPal] Error: Failed to create config directory '{}': {}",
            config_dir.display(),
            e
        );
    }
    
    config_dir
}

/// Config file path
pub fn get_config_path() -> std::path::PathBuf {
    get_proxypal_config_dir().join("config.json")
}

/// Auth status file path
pub fn get_auth_path() -> std::path::PathBuf {
    get_proxypal_config_dir().join("auth.json")
}

/// Request history file path
pub fn get_history_path() -> std::path::PathBuf {
    get_proxypal_config_dir().join("history.json")
}

/// Aggregate analytics file path (cumulative stats, never trimmed)
pub fn get_aggregate_path() -> std::path::PathBuf {
    get_proxypal_config_dir().join("aggregate.json")
}

/// Load config from file
pub fn load_config() -> AppConfig {
    let path = get_config_path();
    if path.exists() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(mut config) = serde_json::from_str::<AppConfig>(&data) {
                // Migration: Convert deprecated amp_openai_provider to amp_openai_providers array
                if let Some(old_provider) = config.amp_openai_provider.take() {
                    if config.amp_openai_providers.is_empty() {
                        eprintln!("[ProxyPal] Migrating config from old provider format to array format...");
                        eprintln!("[ProxyPal] Old provider: {} with {} models", old_provider.name, old_provider.models.len());
                        for (i, model) in old_provider.models.iter().enumerate() {
                            eprintln!("[ProxyPal]   Preserving model {}: {}", i, model.name);
                        }
                        let provider_with_id = if old_provider.id.is_empty() {
                            AmpOpenAIProvider {
                                id: generate_uuid(),
                                ..old_provider
                            }
                        } else {
                            old_provider
                        };
                        config.amp_openai_providers.push(provider_with_id);
                        let _ = save_config_to_file(&config);
                        eprintln!("[ProxyPal] Config migration complete");
                    }
                }
                return config;
            }
        }
    }
    AppConfig::default()
}

/// Save config to file
/// Uses atomic write (write to temp file then rename) to prevent corruption
pub fn save_config_to_file(config: &AppConfig) -> Result<(), String> {
    let path = get_config_path();
    let config_dir = path.parent().ok_or("Invalid config path")?;

    // Ensure config directory exists
    if let Err(e) = std::fs::create_dir_all(config_dir) {
        return Err(format!("Failed to create config directory '{}': {}", config_dir.display(), e));
    }

    // Serialize config to JSON
    let data = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    // Write to temporary file first, then rename for atomic write
    let temp_path = path.with_extension("tmp");

    // Try writing to temp file with retry for Windows file locking issues
    let mut last_error = String::new();
    for attempt in 0..3 {
        match std::fs::write(&temp_path, &data) {
            Ok(_) => break,
            Err(e) => {
                last_error = e.to_string();
                if attempt < 2 {
                    eprintln!("[ProxyPal] Save attempt {} failed, retrying: {}", attempt + 1, e);
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
            }
        }
    }

    // Verify temp file was written successfully
    if !temp_path.exists() {
        return Err(format!("Failed to write config to temp file (attempted 3 times): {}", last_error));
    }

    // Atomic rename from temp to actual config file
    std::fs::rename(&temp_path, &path)
        .map_err(|e| format!("Failed to rename temp file to config: {}", e))?;

    eprintln!("[ProxyPal] Config saved successfully to: {:?}", path);

    Ok(())
}

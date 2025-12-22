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
                    }
                }
                return config;
            }
        }
    }
    AppConfig::default()
}

/// Save config to file
pub fn save_config_to_file(config: &AppConfig) -> Result<(), String> {
    let path = get_config_path();
    let data = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

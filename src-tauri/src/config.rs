use serde::{Deserialize, Serialize};
use std::path::Path;

use uuid::Uuid;

use crate::types::{
    amp::generate_uuid, cloudflare::CloudflareConfig, AmpModelMapping, AmpOpenAIProvider,
    ClaudeApiKey, CodexApiKey, CopilotConfig, GeminiApiKey, ModelMapping, OpenAICompatibleProvider,
    SshConfig, VertexApiKey, XaiApiKey,
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
    pub proxy_username: String,
    #[serde(default)]
    pub proxy_password: String,
    #[serde(default)]
    pub use_system_proxy: bool,
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
    /// DEPRECATED: parsed from old config.json for one-time migration only; never written.
    #[serde(default, skip_serializing)]
    pub amp_openai_provider: Option<AmpOpenAIProvider>,
    /// DEPRECATED: parsed from old config.json for one-time migration only; never written.
    #[serde(default, skip_serializing)]
    pub amp_openai_providers: Vec<AmpOpenAIProvider>,
    #[serde(default)]
    pub amp_routing_mode: String,
    #[serde(default = "default_routing_strategy")]
    pub routing_strategy: String,
    #[serde(default)]
    pub copilot: CopilotConfig,
    #[serde(default)]
    pub claude_api_keys: Vec<ClaudeApiKey>,
    #[serde(default)]
    pub gemini_api_keys: Vec<GeminiApiKey>,
    #[serde(default)]
    pub codex_api_keys: Vec<CodexApiKey>,
    #[serde(default)]
    pub xai_api_keys: Vec<XaiApiKey>,
    #[serde(default)]
    pub vertex_api_keys: Vec<VertexApiKey>,
    #[serde(default)]
    pub thinking_budget_mode: String,
    #[serde(default)]
    pub thinking_budget_custom: u32,
    #[serde(default = "default_gemini_thinking_injection")]
    pub gemini_thinking_injection: bool,
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
    #[serde(default)]
    pub commercial_mode: bool,
    #[serde(default = "default_ws_auth")]
    pub ws_auth: bool,
    #[serde(default)]
    pub sidebar_pinned: bool,
    #[serde(default = "default_locale")]
    pub locale: String,
    #[serde(default)]
    pub ssh_configs: Vec<SshConfig>,
    #[serde(default)]
    pub openai_compatible_providers: Vec<OpenAICompatibleProvider>,
    #[serde(default)]
    pub cloudflare_configs: Vec<CloudflareConfig>,
    #[serde(default = "default_disable_control_panel")]
    pub disable_control_panel: bool,
}

fn default_disable_control_panel() -> bool {
    true
}

fn default_management_key() -> String {
    new_management_key()
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

fn default_gemini_thinking_injection() -> bool {
    true
}

fn default_ws_auth() -> bool {
    true
}

fn default_locale() -> String {
    "en".to_string()
}

fn new_management_key() -> String {
    format!("proxypal-{}", Uuid::new_v4())
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            port: 8317,
            auto_start: true,
            launch_at_login: false,
            debug: false,
            proxy_url: String::new(),
            proxy_username: String::new(),
            proxy_password: String::new(),
            use_system_proxy: false,
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
            sidebar_pinned: false,
            routing_strategy: "round-robin".to_string(),
            copilot: CopilotConfig::default(),
            claude_api_keys: Vec::new(),
            gemini_api_keys: Vec::new(),
            codex_api_keys: Vec::new(),
            xai_api_keys: Vec::new(),
            vertex_api_keys: Vec::new(),
            thinking_budget_mode: "medium".to_string(),
            thinking_budget_custom: 16000,
            gemini_thinking_injection: true,
            reasoning_effort_level: "medium".to_string(),
            close_to_tray: true,
            max_retry_interval: 0,
            proxy_api_key: "proxypal-local".to_string(),
            management_key: new_management_key(),
            commercial_mode: false,
            ws_auth: true,
            locale: "en".to_string(),
            ssh_configs: Vec::new(),
            openai_compatible_providers: Vec::new(),
            cloudflare_configs: Vec::new(),
            disable_control_panel: true,
        }
    }
}

/// Get the proxypal config directory, creating it if needed
pub fn get_proxypal_config_dir() -> std::path::PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| {
            eprintln!(
                "[ProxyPal] Warning: Could not determine config directory, using current directory"
            );
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
    load_config_from_path(&get_config_path())
}

fn migrate_config(config: &mut AppConfig) -> bool {
    let mut changed = false;

    // Migrate legacy management key to a unique UUID-backed key
    if config.management_key == "proxypal-mgmt-key" {
        eprintln!("[ProxyPal] Migrating legacy management key to a unique key...");
        config.management_key = new_management_key();
        changed = true;
    }

    // Migrate deprecated single amp_openai_provider to providers array
    if let Some(old_provider) = config.amp_openai_provider.take() {
        if config.amp_openai_providers.is_empty() {
            eprintln!("[ProxyPal] Migrating config from old provider format to array format...");
            eprintln!(
                "[ProxyPal] Old provider: {} with {} models",
                old_provider.name,
                old_provider.models.len()
            );
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
            changed = true;
        }
    }

    // Canonical OpenAI-compatible providers: the rich field is the single source of truth.
    // Migrate legacy flat `amp_openai_providers` -> rich `openai_compatible_providers` once.
    if config.openai_compatible_providers.is_empty() && !config.amp_openai_providers.is_empty() {
        eprintln!(
            "[ProxyPal] Migrating {} OpenAI-compatible provider(s) to canonical rich format",
            config.amp_openai_providers.len()
        );
        config.openai_compatible_providers = config
            .amp_openai_providers
            .iter()
            .map(|p| OpenAICompatibleProvider {
                name: p.name.clone(),
                base_url: p.base_url.clone(),
                api_key_entries: vec![crate::types::api_keys::OpenAICompatibleApiKeyEntry {
                    api_key: p.api_key.clone(),
                    proxy_url: None,
                }],
                models: Some(
                    p.models
                        .iter()
                        .map(|m| ModelMapping {
                            name: m.name.clone(),
                            alias: if m.alias.is_empty() { None } else { Some(m.alias.clone()) },
                        })
                        .collect(),
                ),
                headers: None,
                prefix: None,
            })
            .collect();
        changed = true;
    }

    if changed {
        eprintln!("[ProxyPal] Config migration complete");
    }

    changed
}

fn load_config_from_path(path: &Path) -> AppConfig {
    if !path.exists() {
        return AppConfig::default();
    }

    let data = match std::fs::read_to_string(path) {
        Ok(data) => data,
        Err(e) => {
            eprintln!(
                "[ProxyPal] Failed to read config file '{}': {}. Falling back to defaults.",
                path.display(),
                e
            );
            return AppConfig::default();
        }
    };

    let mut config = match serde_json::from_str::<AppConfig>(&data) {
        Ok(config) => config,
        Err(e) => {
            eprintln!(
                "[ProxyPal] Failed to parse config file '{}': {}. Falling back to defaults.",
                path.display(),
                e
            );
            return AppConfig::default();
        }
    };

    if migrate_config(&mut config) {
        let _ = save_config_to_path(path, &config);
    }

    config
}

/// Save config to file
/// Uses atomic write (write to temp file then rename) to prevent corruption
pub fn save_config_to_file(config: &AppConfig) -> Result<(), String> {
    save_config_to_path(&get_config_path(), config)
}

pub(crate) fn save_config_to_path(path: &Path, config: &AppConfig) -> Result<(), String> {
    let config_dir = path.parent().ok_or("Invalid config path")?;

    // Ensure config directory exists
    if let Err(e) = std::fs::create_dir_all(config_dir) {
        return Err(format!(
            "Failed to create config directory '{}': {}",
            config_dir.display(),
            e
        ));
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
                    eprintln!(
                        "[ProxyPal] Save attempt {} failed, retrying: {}",
                        attempt + 1,
                        e
                    );
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
            }
        }
    }

    // Verify temp file was written successfully
    if !temp_path.exists() {
        return Err(format!(
            "Failed to write config to temp file (attempted 3 times): {}",
            last_error
        ));
    }

    // Atomic rename from temp to actual config file
    std::fs::rename(&temp_path, path)
        .map_err(|e| format!("Failed to rename temp file to config: {}", e))?;

    eprintln!("[ProxyPal] Config saved successfully to: {:?}", path);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_dir(prefix: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("proxypal-{}-{}", prefix, generate_uuid()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn load_config_from_missing_file_returns_defaults() {
        let dir = test_dir("config-missing");
        let path = dir.join("config.json");

        let loaded = load_config_from_path(&path);

        assert_eq!(loaded.port, AppConfig::default().port);
        assert_eq!(
            loaded.routing_strategy,
            AppConfig::default().routing_strategy
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn load_config_from_invalid_json_returns_defaults() {
        let dir = test_dir("config-invalid");
        let path = dir.join("config.json");
        fs::write(&path, "{ invalid json").unwrap();

        let loaded = load_config_from_path(&path);

        assert_eq!(loaded.port, AppConfig::default().port);
        assert_eq!(
            loaded.routing_strategy,
            AppConfig::default().routing_strategy
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn default_management_key_is_unique_and_not_the_legacy_key() {
        let first = AppConfig::default().management_key;
        let second = AppConfig::default().management_key;

        assert_ne!(first, "proxypal-mgmt-key");
        assert_ne!(first, second);
    }

    #[test]
    fn load_config_replaces_legacy_management_key() {
        let dir = test_dir("config-management-key");
        let path = dir.join("config.json");
        let mut legacy_config = AppConfig::default();
        legacy_config.management_key = "proxypal-mgmt-key".to_string();
        fs::write(&path, serde_json::to_string(&legacy_config).unwrap()).unwrap();

        let loaded = load_config_from_path(&path);

        assert_ne!(loaded.management_key, "proxypal-mgmt-key");
        assert!(loaded.management_key.starts_with("proxypal-"));
        assert!(fs::read_to_string(&path)
            .unwrap()
            .contains(&loaded.management_key));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn load_config_migrates_deprecated_openai_provider() {
        let dir = test_dir("config-migrate");
        let path = dir.join("config.json");

        let legacy_json = r#"{
  "port": 8317,
  "autoStart": true,
  "launchAtLogin": false,
  "ampOpenaiProvider": {
    "id": "",
    "name": "Legacy",
    "apiKey": "test-key",
    "baseUrl": "https://api.openai.com/v1",
    "models": [
      { "name": "gpt-4.1", "enabled": true }
    ],
    "enabled": true
  },
  "ampOpenaiProviders": []
}"#;

        fs::write(&path, legacy_json).unwrap();
        let loaded = load_config_from_path(&path);

        // Single -> array -> rich migration chain: the legacy provider lands in rich.
        assert_eq!(loaded.openai_compatible_providers.len(), 1);
        assert_eq!(loaded.openai_compatible_providers[0].name, "Legacy");
        assert!(!loaded.amp_openai_providers[0].id.is_empty());
        assert!(loaded.amp_openai_provider.is_none());

        // Flat fields are never written back to disk after migration.
        let persisted = fs::read_to_string(&path).unwrap();
        assert!(!persisted.contains("ampOpenaiProviders"));
        assert!(persisted.contains("openaiCompatibleProviders"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn restart_persists_rich_multi_key_and_prefix() {
        let dir = test_dir("config-rich-roundtrip");
        let path = dir.join("config.json");

        let provider = OpenAICompatibleProvider {
            name: "Custom".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key_entries: vec![
                crate::types::api_keys::OpenAICompatibleApiKeyEntry {
                    api_key: "key-1".to_string(),
                    proxy_url: None,
                },
                crate::types::api_keys::OpenAICompatibleApiKeyEntry {
                    api_key: "key-2".to_string(),
                    proxy_url: Some("https://proxy.local".to_string()),
                },
                crate::types::api_keys::OpenAICompatibleApiKeyEntry {
                    api_key: "key-3".to_string(),
                    proxy_url: None,
                },
            ],
            models: None,
            headers: None,
            prefix: Some("myprefix".to_string()),
        };

        let mut config = AppConfig::default();
        config.openai_compatible_providers = vec![provider];
        save_config_to_path(&path, &config).unwrap();

        let loaded = load_config_from_path(&path);

        assert_eq!(loaded.openai_compatible_providers.len(), 1);
        let p = &loaded.openai_compatible_providers[0];
        assert_eq!(p.api_key_entries.len(), 3);
        assert_eq!(p.api_key_entries[1].api_key, "key-2");
        assert_eq!(p.api_key_entries[1].proxy_url.as_deref(), Some("https://proxy.local"));
        assert_eq!(p.prefix.as_deref(), Some("myprefix"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn migration_amp_to_rich_on_load() {
        let dir = test_dir("config-amp-to-rich");
        let path = dir.join("config.json");

        // Emulate an old config.json: flat field on disk, no rich field.
        let legacy_json = r#"{
  "port": 8317,
  "autoStart": true,
  "launchAtLogin": false,
  "ampOpenaiProviders": [
    {
      "id": "amp-1",
      "name": "OpenRouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "sk-or",
      "models": [
        { "name": "m1", "alias": "a1" }
      ]
    }
  ]
}"#;
        fs::write(&path, legacy_json).unwrap();

        let loaded = load_config_from_path(&path);
        assert_eq!(loaded.openai_compatible_providers.len(), 1);
        let p = &loaded.openai_compatible_providers[0];
        assert_eq!(p.name, "OpenRouter");
        assert_eq!(p.api_key_entries.len(), 1);
        assert_eq!(p.api_key_entries[0].api_key, "sk-or");
        assert_eq!(p.models.as_ref().unwrap().len(), 1);
        assert_eq!(p.models.as_ref().unwrap()[0].alias.as_deref(), Some("a1"));

        // Idempotent: second load does not double.
        let loaded2 = load_config_from_path(&path);
        assert_eq!(loaded2.openai_compatible_providers.len(), 1);

        // After migration the flat fields are never written back to disk.
        save_config_to_path(&path, &loaded).unwrap();
        let persisted = fs::read_to_string(&path).unwrap();
        assert!(!persisted.contains("ampOpenaiProviders"));
        assert!(persisted.contains("openaiCompatibleProviders"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn save_never_writes_flat_fields() {
        let dir = test_dir("config-no-flat-write");
        let path = dir.join("config.json");

        // Simulate an old config.json that still has flat fields on disk.
        let legacy_json = r#"{
  "port": 8317,
  "autoStart": true,
  "launchAtLogin": false,
  "ampOpenaiProviders": [
    {
      "id": "amp-1",
      "name": "Legacy",
      "baseUrl": "https://api.legacy.com/v1",
      "apiKey": "sk-legacy",
      "models": []
    }
  ]
}"#;
        fs::write(&path, legacy_json).unwrap();
        let loaded = load_config_from_path(&path);

        // Migration lifted the flat provider into rich.
        assert_eq!(loaded.openai_compatible_providers.len(), 1);
        assert_eq!(loaded.openai_compatible_providers[0].name, "Legacy");
        assert_eq!(
            loaded.openai_compatible_providers[0].api_key_entries[0].api_key,
            "sk-legacy"
        );

        // Saving never writes the flat fields back.
        save_config_to_path(&path, &loaded).unwrap();
        let persisted = fs::read_to_string(&path).unwrap();
        assert!(!persisted.contains("ampOpenaiProviders"));
        assert!(!persisted.contains("ampOpenaiProvider"));
        assert!(persisted.contains("openaiCompatibleProviders"));

        let _ = fs::remove_dir_all(dir);
    }
}

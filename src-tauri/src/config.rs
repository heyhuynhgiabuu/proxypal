use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::RwLock;

use uuid::Uuid;

use crate::types::{
    amp::generate_uuid, cloudflare::CloudflareConfig, AmpModelMapping, AmpOpenAIProvider,
    ClaudeApiKey, CodexApiKey, CopilotConfig, GeminiApiKey, SshConfig, VertexApiKey, XaiApiKey,
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
    #[serde(default)]
    pub max_retry_credentials: u32,
    #[serde(default)]
    pub disable_cooling: bool,
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

/// The management key that predates per-install keys. Treated as "no key".
const LEGACY_MANAGEMENT_KEY: &str = "proxypal-mgmt-key";

/// Process-wide holder for the management key.
///
/// The key written into the generated proxy YAML and the key sent on every
/// `X-Management-Key` header must be the same value, or CLIProxyAPI rejects the
/// request with `401 invalid management key` and bans the caller after five
/// tries. Every code path below can otherwise mint a fresh `Uuid` — a missing
/// file, a missing field, a parse error, a read error — so both sides read from
/// one store instead of re-deriving the key from disk per request.
pub(crate) struct KeyStore(RwLock<Option<String>>);

impl KeyStore {
    pub(crate) const fn new() -> Self {
        Self(RwLock::new(None))
    }

    /// Return the held key, adopting `candidate` only if nothing is held yet.
    ///
    /// First writer wins: concurrent first loads converge on one value, and a
    /// key already in use is never swapped out from under a running sidecar.
    pub(crate) fn resolve(&self, candidate: Option<&str>) -> String {
        if let Some(existing) = self.read().as_ref() {
            return existing.clone();
        }
        // Re-check under the write lock; another thread may have won the race.
        let mut slot = self.0.write().unwrap_or_else(|p| p.into_inner());
        if let Some(existing) = slot.as_ref() {
            return existing.clone();
        }
        let key = match candidate {
            Some(c) if !c.trim().is_empty() && c != LEGACY_MANAGEMENT_KEY => c.to_string(),
            _ => new_management_key(),
        };
        *slot = Some(key.clone());
        key
    }

    /// Replace the held key. Used when the user edits it in Settings.
    pub(crate) fn set(&self, key: String) {
        *self.0.write().unwrap_or_else(|p| p.into_inner()) = Some(key);
    }

    fn read(&self) -> std::sync::RwLockReadGuard<'_, Option<String>> {
        self.0.read().unwrap_or_else(|p| p.into_inner())
    }
}

static MANAGEMENT_KEY: KeyStore = KeyStore::new();

/// The management key for this process — the single source used for both the
/// generated proxy YAML and every management request header.
///
/// If nothing is held yet this seeds from the persisted config rather than
/// minting on the spot, so a caller that runs before startup's `load_config()`
/// cannot mint a throwaway key and have it overwrite the user's stored one.
/// Costs at most one read for the life of the process.
pub fn management_key() -> String {
    if let Some(existing) = MANAGEMENT_KEY.read().as_ref() {
        return existing.clone();
    }
    load_config().management_key
}

/// Reconcile a config coming from the UI with the key this process signs with.
///
/// A deliberate, non-empty change is adopted so the headers follow the value the
/// sidecar is restarted with. A blank or legacy value is replaced with the key
/// already in use, so a round-tripped config cannot silently rotate it.
pub fn reconcile_management_key(config: &mut AppConfig) {
    reconcile_management_key_with(config, &MANAGEMENT_KEY);
}

fn reconcile_management_key_with(config: &mut AppConfig, store: &KeyStore) {
    let incoming = config.management_key.trim();
    if incoming.is_empty() || incoming == LEGACY_MANAGEMENT_KEY {
        config.management_key = store.resolve(None);
    } else {
        let incoming = incoming.to_string();
        store.set(incoming.clone());
        config.management_key = incoming;
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
            max_retry_credentials: 0,
            disable_cooling: false,
            proxy_api_key: "proxypal-local".to_string(),
            management_key: new_management_key(),
            commercial_mode: false,
            ws_auth: true,
            locale: "en".to_string(),
            ssh_configs: Vec::new(),
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

    // Legacy management keys are handled in `KeyStore::resolve`, which treats
    // LEGACY_MANAGEMENT_KEY as "no key" so a unique one is minted and persisted.
    // Doing it there keeps one owner for the key across every load path.

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

    if changed {
        eprintln!("[ProxyPal] Config migration complete");
    }

    changed
}

fn load_config_from_path(path: &Path) -> AppConfig {
    load_config_from_path_with(path, &MANAGEMENT_KEY)
}

/// Load config, guaranteeing the returned `management_key` is the one `store`
/// holds for this process, and persisting it when the file can be rewritten
/// safely.
///
/// `store` is a parameter so tests can exercise the fallbacks in isolation
/// rather than sharing the process-wide key.
fn load_config_from_path_with(path: &Path, store: &KeyStore) -> AppConfig {
    let existed = path.exists();

    let data = if existed {
        match std::fs::read_to_string(path) {
            Ok(data) => Some(data),
            Err(e) => {
                eprintln!(
                    "[ProxyPal] Failed to read config file '{}': {}. Falling back to defaults.",
                    path.display(),
                    e
                );
                None
            }
        }
    } else {
        None
    };

    // Probe the raw JSON separately: `#[serde(default = "default_management_key")]`
    // mints a fresh UUID for an absent field, which is indistinguishable from a
    // real one once deserialized.
    let stored_key = data.as_deref().and_then(|d| {
        serde_json::from_str::<serde_json::Value>(d)
            .ok()
            .and_then(|v| {
                v.get("managementKey")
                    .and_then(|k| k.as_str())
                    .map(str::to_string)
            })
    });

    let mut parsed_cleanly = false;
    let mut config = match data.as_deref().map(serde_json::from_str::<AppConfig>) {
        Some(Ok(config)) => {
            parsed_cleanly = true;
            config
        }
        Some(Err(e)) => {
            eprintln!(
                "[ProxyPal] Failed to parse config file '{}': {}. Falling back to defaults.",
                path.display(),
                e
            );
            AppConfig::default()
        }
        None => AppConfig::default(),
    };

    let resolved = store.resolve(stored_key.as_deref());
    let key_changed = config.management_key != resolved;
    config.management_key = resolved;

    let migrated = migrate_config(&mut config);

    // Rewrite only when the file is absent or parsed cleanly. A malformed or
    // unreadable file is left alone — it may still hold recoverable settings,
    // and the key is stable for this process regardless.
    let writable = !existed || parsed_cleanly;
    if writable && (!existed || key_changed || migrated) {
        if let Err(e) = save_config_to_path(path, &config) {
            eprintln!(
                "[ProxyPal] Failed to persist config '{}': {}. \
                 The management key is stable for this session but will not survive a restart.",
                path.display(),
                e
            );
        }
    } else if !writable {
        eprintln!(
            "[ProxyPal] Leaving unreadable config '{}' untouched. \
             Using a session-local management key; fix or remove the file to persist one.",
            path.display()
        );
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

    // Write to temporary file first, then rename for atomic write.
    // The temp name is unique per write so concurrent savers cannot land on the
    // same scratch file and interleave each other's bytes.
    let temp_path = path.with_extension(format!("tmp-{}", Uuid::new_v4()));

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
    fn a_key_edited_in_settings_becomes_the_process_key() {
        // Issue #89: the sidecar is restarted with the new key, so the headers
        // must follow or every management call 401s afterwards.
        let store = KeyStore::new();
        store.set("proxypal-old".to_string());
        let mut config = AppConfig {
            management_key: "proxypal-user-chose-this".to_string(),
            ..AppConfig::default()
        };

        reconcile_management_key_with(&mut config, &store);

        assert_eq!(config.management_key, "proxypal-user-chose-this");
        assert_eq!(store.resolve(None), "proxypal-user-chose-this");
    }

    #[test]
    fn a_blank_key_from_the_ui_keeps_the_key_in_use() {
        let store = KeyStore::new();
        store.set("proxypal-in-use".to_string());
        let mut config = AppConfig {
            management_key: "   ".to_string(),
            ..AppConfig::default()
        };

        reconcile_management_key_with(&mut config, &store);

        assert_eq!(
            config.management_key, "proxypal-in-use",
            "a round-tripped config missing the key must not rotate it"
        );
    }

    #[test]
    fn existing_config_without_management_key_gets_one_persisted() {
        let dir = test_dir("config-no-key");
        let path = dir.join("config.json");
        // A realistic upgrade path: an old config that predates `managementKey`.
        fs::write(
            &path,
            r#"{"port":8317,"autoStart":true,"launchAtLogin":false,"locale":"fr"}"#,
        )
        .unwrap();
        let store = KeyStore::new();

        let first = load_config_from_path_with(&path, &store);
        let second = load_config_from_path_with(&path, &store);

        assert!(!first.management_key.is_empty());
        assert_eq!(
            first.management_key, second.management_key,
            "a config lacking managementKey must have one written, not regenerated per load"
        );
        let on_disk: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            on_disk.get("managementKey").and_then(|v| v.as_str()),
            Some(first.management_key.as_str()),
            "the key must be written back to disk"
        );
        assert_eq!(
            on_disk.get("locale").and_then(|v| v.as_str()),
            Some("fr"),
            "unrelated settings must be preserved when backfilling the key"
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn malformed_config_still_yields_one_stable_key_and_keeps_the_file() {
        let dir = test_dir("config-malformed");
        let path = dir.join("config.json");
        fs::write(&path, "{ not valid json").unwrap();
        let store = KeyStore::new();

        let first = load_config_from_path_with(&path, &store);
        let second = load_config_from_path_with(&path, &store);

        assert_eq!(
            first.management_key, second.management_key,
            "a malformed config must not produce a different key on every load"
        );
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "{ not valid json",
            "a malformed config must not be clobbered — it may be user-recoverable"
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn unreadable_config_still_yields_one_stable_key() {
        let dir = test_dir("config-unreadable");
        let path = dir.join("config.json");
        fs::write(&path, "{}").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
        }
        let store = KeyStore::new();

        let first = load_config_from_path_with(&path, &store);
        let second = load_config_from_path_with(&path, &store);

        assert_eq!(
            first.management_key, second.management_key,
            "an unreadable config must not produce a different key on every load"
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o644));
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn persistence_failure_is_reported_not_swallowed() {
        let dir = test_dir("config-readonly");
        let sub = dir.join("locked");
        fs::create_dir_all(&sub).unwrap();
        let path = sub.join("config.json");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&sub, fs::Permissions::from_mode(0o500)).unwrap();
        }

        let result = save_config_to_path(&path, &AppConfig::default());

        #[cfg(unix)]
        assert!(
            result.is_err(),
            "an unwritable config directory must surface an error, not silently succeed"
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&sub, fs::Permissions::from_mode(0o700));
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn concurrent_first_loads_converge_on_a_single_key() {
        let dir = test_dir("config-concurrent");
        let path = dir.join("config.json");
        let store = std::sync::Arc::new(KeyStore::new());

        let keys: Vec<String> = std::thread::scope(|s| {
            let handles: Vec<_> = (0..8)
                .map(|_| {
                    let p = path.clone();
                    let st = std::sync::Arc::clone(&store);
                    s.spawn(move || load_config_from_path_with(&p, &st).management_key)
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });

        let distinct: std::collections::HashSet<&String> = keys.iter().collect();
        assert_eq!(
            distinct.len(),
            1,
            "concurrent first loads must agree on one key, got {:?}",
            distinct
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn management_key_survives_a_restart() {
        let dir = test_dir("config-restart");
        let path = dir.join("config.json");

        // First "run" of the app.
        let first = load_config_from_path_with(&path, &KeyStore::new()).management_key;
        // A later run starts with an empty store, as a fresh process would.
        let second = load_config_from_path_with(&path, &KeyStore::new()).management_key;

        assert_eq!(
            first, second,
            "the persisted key must be adopted on restart, not regenerated"
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_key_already_in_the_store_is_not_replaced_by_disk() {
        let store = KeyStore::new();
        store.set("proxypal-in-use".to_string());

        let dir = test_dir("config-store-wins");
        let path = dir.join("config.json");
        fs::write(
            &path,
            r#"{"port":8317,"autoStart":true,"launchAtLogin":false,"managementKey":"proxypal-on-disk"}"#,
        )
        .unwrap();

        let loaded = load_config_from_path_with(&path, &store);

        assert_eq!(
            loaded.management_key, "proxypal-in-use",
            "the running sidecar's key must win; swapping it mid-process would break every request"
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn load_config_from_missing_file_persists_a_stable_management_key() {
        let dir = test_dir("config-missing-persist");
        let path = dir.join("config.json");

        let first = load_config_from_path(&path);
        assert!(
            path.exists(),
            "defaults must be persisted on first load so the generated key is stable"
        );

        let second = load_config_from_path(&path);
        assert_eq!(
            first.management_key, second.management_key,
            "management key must not change between loads; the key written to \
             proxy-config.yaml has to match the one sent in X-Management-Key"
        );
        assert_eq!(first.proxy_api_key, second.proxy_api_key);

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

        assert_eq!(loaded.amp_openai_providers.len(), 1);
        assert_eq!(loaded.amp_openai_providers[0].name, "Legacy");
        assert!(!loaded.amp_openai_providers[0].id.is_empty());
        assert!(loaded.amp_openai_provider.is_none());

        let persisted = fs::read_to_string(&path).unwrap();
        assert!(persisted.contains("ampOpenaiProviders"));

        let _ = fs::remove_dir_all(dir);
    }
}

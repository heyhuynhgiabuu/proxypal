//! Configuration commands for Tauri IPC.

#[cfg(test)]
use crate::config::save_config_to_path;
use crate::config::{save_config_to_file, AppConfig};
use crate::state::AppState;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

#[tauri::command]
pub fn get_config(state: State<AppState>) -> AppConfig {
    let config = state.config.lock().unwrap().clone();
    eprintln!(
        "[ProxyPal Debug] Loading {} custom providers",
        config.amp_openai_providers.len()
    );
    for (i, provider) in config.amp_openai_providers.iter().enumerate() {
        eprintln!(
            "[ProxyPal Debug] Provider {}: {} with {} models",
            i,
            provider.name,
            provider.models.len()
        );
        for (j, model) in provider.models.iter().enumerate() {
            eprintln!("[ProxyPal Debug]   Model {}: {}", j, model.name);
        }
    }
    config
}

#[tauri::command]
pub fn save_config(state: State<AppState>, config: AppConfig) -> Result<(), String> {
    // Debug: Log provider models before save
    eprintln!(
        "[ProxyPal Debug] Saving {} custom providers",
        config.amp_openai_providers.len()
    );
    for (i, provider) in config.amp_openai_providers.iter().enumerate() {
        eprintln!(
            "[ProxyPal Debug] Provider {}: {} with {} models",
            i,
            provider.name,
            provider.models.len()
        );
        for (j, model) in provider.models.iter().enumerate() {
            eprintln!("[ProxyPal Debug]   Model {}: {}", j, model.name);
        }
    }

    persist_config(&config)?;

    let mut current_config = state.config.lock().unwrap();
    *current_config = config.clone();

    eprintln!("[ProxyPal Debug] Config saved successfully");
    Ok(())
}

fn proxy_config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("proxypal")
        .join("proxy-config.yaml")
}

fn persist_config(config: &AppConfig) -> Result<(), String> {
    save_config_to_file(config)?;
    update_proxy_config_yaml(config)
}

#[cfg(test)]
fn persist_config_at_paths(
    config: &AppConfig,
    app_config_path: &Path,
    proxy_yaml_path: &Path,
) -> Result<(), String> {
    save_config_to_path(app_config_path, config)?;
    update_proxy_config_yaml_at_path(config, proxy_yaml_path)
}

fn update_proxy_config_yaml(app_config: &AppConfig) -> Result<(), String> {
    let proxy_config_path = proxy_config_path();
    update_proxy_config_yaml_at_path(app_config, &proxy_config_path)
}

fn update_proxy_config_yaml_at_path(
    app_config: &AppConfig,
    proxy_config_path: &Path,
) -> Result<(), String> {
    if let Some(config_dir) = proxy_config_path.parent() {
        std::fs::create_dir_all(config_dir)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;
    }

    // Read existing config or start with default
    let mut existing_yaml = if proxy_config_path.exists() {
        std::fs::read_to_string(proxy_config_path)
            .map_err(|e| format!("Failed to read proxy config: {}", e))?
    } else {
        "routing:\n  strategy: \"round-robin\"\n".to_string()
    };

    existing_yaml = set_routing_strategy(&existing_yaml, &app_config.routing_strategy);

    std::fs::write(proxy_config_path, existing_yaml)
        .map_err(|e| format!("Failed to write proxy config: {}", e))
}

fn set_routing_strategy(existing_yaml: &str, strategy: &str) -> String {
    let mut lines: Vec<String> = existing_yaml.lines().map(|line| line.to_string()).collect();

    let routing_idx = lines
        .iter()
        .position(|line| line.trim() == "routing:" || line.trim_start().starts_with("routing:"));

    if let Some(routing_idx) = routing_idx {
        let mut idx = routing_idx + 1;
        while idx < lines.len() {
            let line = &lines[idx];
            let trimmed = line.trim_start();
            let indentation = line.len().saturating_sub(trimmed.len());

            if indentation < 2 || trimmed.is_empty() {
                break;
            }

            if trimmed.starts_with("strategy:") {
                lines[idx] = format!("  strategy: \"{}\"", strategy);
                return lines.join("\n") + "\n";
            }

            idx += 1;
        }

        lines.insert(routing_idx + 1, format!("  strategy: \"{}\"", strategy));
        return lines.join("\n") + "\n";
    }

    let mut output = existing_yaml.trim_end().to_string();
    if !output.is_empty() {
        output.push('\n');
    }
    output.push_str(&format!("routing:\n  strategy: \"{}\"\n", strategy));
    output
}

#[tauri::command]
pub fn get_config_yaml() -> Result<String, String> {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("proxypal");

    // Read the main generated config
    let config_path = config_dir.join("proxy-config.yaml");
    if config_path.exists() {
        return fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config YAML: {}", e));
    }

    // Config doesn't exist yet
    Ok("# Configuration will be generated when proxy starts.\n".to_string())
}

#[tauri::command]
pub fn save_config_yaml(yaml: String) -> Result<(), String> {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("proxypal");
    fs::create_dir_all(&config_dir).map_err(|e| format!("Failed to create config dir: {}", e))?;

    // Save directly to main config file
    // Note: This will be overwritten on next proxy restart
    let config_path = config_dir.join("proxy-config.yaml");
    fs::write(&config_path, yaml).map_err(|e| format!("Failed to save config YAML: {}", e))
}

#[tauri::command]
pub fn reload_config(state: State<AppState>) -> Result<AppConfig, String> {
    // Reload config from disk
    let fresh_config = crate::config::load_config();

    // Update the in-memory state
    let mut current_config = state.config.lock().unwrap();
    *current_config = fresh_config.clone();

    eprintln!("[ProxyPal Debug] Config reloaded from disk");
    Ok(fresh_config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::amp::generate_uuid;

    fn test_dir(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("proxypal-{}-{}", prefix, generate_uuid()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn update_proxy_config_yaml_sets_routing_strategy() {
        let dir = test_dir("yaml-routing");
        let yaml_path = dir.join("proxy-config.yaml");
        fs::write(&yaml_path, "routing:\n  strategy: \"round-robin\"\n").unwrap();

        let mut app_config = AppConfig::default();
        app_config.routing_strategy = "least-connections".to_string();
        update_proxy_config_yaml_at_path(&app_config, &yaml_path).unwrap();

        let content = fs::read_to_string(&yaml_path).unwrap();
        assert!(content.contains("strategy: \"least-connections\""));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn update_proxy_config_yaml_only_updates_routing_block() {
        let dir = test_dir("yaml-routing-scope");
        let yaml_path = dir.join("proxy-config.yaml");
        fs::write(
            &yaml_path,
            "providers:\n  strategy: \"sticky\"\nrouting:\n  strategy: \"round-robin\"\n",
        )
        .unwrap();

        let mut app_config = AppConfig::default();
        app_config.routing_strategy = "least-connections".to_string();
        update_proxy_config_yaml_at_path(&app_config, &yaml_path).unwrap();

        let content = fs::read_to_string(&yaml_path).unwrap();
        assert!(content.contains("providers:\n  strategy: \"sticky\""));
        assert!(content.contains("routing:\n  strategy: \"least-connections\""));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn persist_config_at_paths_writes_json_and_yaml() {
        let dir = test_dir("persist-config");
        let json_path = dir.join("config.json");
        let yaml_path = dir.join("proxy-config.yaml");

        let mut app_config = AppConfig::default();
        app_config.routing_strategy = "random".to_string();

        persist_config_at_paths(&app_config, &json_path, &yaml_path).unwrap();

        let config_json = fs::read_to_string(&json_path).unwrap();
        assert!(config_json.contains("\"routingStrategy\": \"random\""));

        let config_yaml = fs::read_to_string(&yaml_path).unwrap();
        assert!(config_yaml.contains("strategy: \"random\""));

        let _ = fs::remove_dir_all(dir);
    }
}

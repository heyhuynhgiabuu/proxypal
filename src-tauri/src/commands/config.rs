//! Configuration commands for Tauri IPC.

use std::fs;
use tauri::State;
use crate::config::{AppConfig, save_config_to_file};
use crate::state::AppState;

#[tauri::command]
pub fn get_config(state: State<AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_config(state: State<AppState>, config: AppConfig) -> Result<(), String> {
    let mut current_config = state.config.lock().unwrap();
    *current_config = config.clone();
    
    // Also update proxy-config.yaml with routing strategy
    update_proxy_config_yaml(&config)?;
    
    save_config_to_file(&config)
}

fn update_proxy_config_yaml(app_config: &AppConfig) -> Result<(), String> {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("proxypal");
    
    std::fs::create_dir_all(&config_dir).map_err(|e| format!("Failed to create config dir: {}", e))?;
    
    let proxy_config_path = config_dir.join("proxy-config.yaml");
    
    // Read existing config or start with default
    let mut existing_yaml = if proxy_config_path.exists() {
        std::fs::read_to_string(&proxy_config_path)
            .map_err(|e| format!("Failed to read proxy config: {}", e))?
    } else {
        String::new()
    };
    
    // Update routing strategy
    let routing_line = format!("  strategy: \"{}\"", app_config.routing_strategy);
    
    if existing_yaml.contains("routing:") {
        // Replace existing routing strategy
        existing_yaml = regex::Regex::new(r#"  strategy: "[^"]*""#)
            .map_err(|e| format!("Failed to compile regex: {}", e))?
            .replace(&existing_yaml, &routing_line)
            .to_string();
    } else if !existing_yaml.is_empty() {
        // Append routing section if config exists but no routing
        existing_yaml.push_str(&format!("\nrouting:\n  strategy: \"{}\"\n", app_config.routing_strategy));
    }
    
    std::fs::write(&proxy_config_path, existing_yaml)
        .map_err(|e| format!("Failed to write proxy config: {}", e))
    
}

#[tauri::command]
pub fn get_config_yaml() -> Result<String, String> {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("proxypal");
    let proxy_config_path = config_dir.join("proxy-config.yaml");
    
    if !proxy_config_path.exists() {
        return Ok(String::new());
    }
    
    fs::read_to_string(&proxy_config_path)
        .map_err(|e| format!("Failed to read config YAML: {}", e))
}

#[tauri::command]
pub fn save_config_yaml(yaml: String) -> Result<(), String> {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("proxypal");
    fs::create_dir_all(&config_dir).map_err(|e| format!("Failed to create config dir: {}", e))?;
    
    let proxy_config_path = config_dir.join("proxy-config.yaml");
    fs::write(&proxy_config_path, yaml)
        .map_err(|e| format!("Failed to save config YAML: {}", e))
}

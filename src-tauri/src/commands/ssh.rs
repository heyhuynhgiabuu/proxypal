use tauri::{AppHandle, State, command};
use crate::ssh_manager::SshManager;
use crate::config::{save_config_to_file, load_config};
use crate::types::ssh::SshConfig;

#[command]
pub async fn get_ssh_configs() -> Result<Vec<SshConfig>, String> {
    let config = load_config();
    Ok(config.ssh_configs)
}

#[command]
pub async fn save_ssh_config(ssh_config: SshConfig) -> Result<Vec<SshConfig>, String> {
    let mut current_config = load_config();
    
    if let Some(idx) = current_config.ssh_configs.iter().position(|c| c.id == ssh_config.id) {
        current_config.ssh_configs[idx] = ssh_config;
    } else {
        current_config.ssh_configs.push(ssh_config);
    }
    
    save_config_to_file(&current_config)?;
    Ok(current_config.ssh_configs)
}

#[command]
pub async fn delete_ssh_config(_app: AppHandle, state: State<'_, SshManager>, id: String) -> Result<Vec<SshConfig>, String> {
    let mut current_config = load_config();
    
    // Stop if running
    state.disconnect(&id);
    
    current_config.ssh_configs.retain(|c| c.id != id);
    save_config_to_file(&current_config)?;
    Ok(current_config.ssh_configs)
}

#[command]
pub async fn set_ssh_connection(
    app: AppHandle,
    state: State<'_, SshManager>,
    id: String,
    enable: bool
) -> Result<(), String> {
    let mut config = load_config();
    if let Some(c) = config.ssh_configs.iter_mut().find(|c| c.id == id) {
        c.enabled = enable;
        let target_config = c.clone();
        
        // Save persistent state
        save_config_to_file(&config)?;
        
        if enable {
            state.connect(app, target_config);
        } else {
            state.disconnect(&id);
        }
        Ok(())
    } else {
        Err("Config not found".to_string())
    }
}

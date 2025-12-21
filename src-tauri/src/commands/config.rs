//! Configuration commands for Tauri IPC.

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
    save_config_to_file(&config)
}

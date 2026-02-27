//! Settings and runtime configuration commands.

use crate::config::save_config_to_file;
use crate::state::AppState;
use crate::types::{ReasoningEffortSettings, ThinkingBudgetSettings};
use crate::{build_management_client, get_management_key, get_management_url};
use tauri::State;

// ============================================
// Claude Code Settings (from ~/.claude/settings.json)
// ============================================

#[tauri::command]
pub async fn get_claude_code_settings() -> Result<crate::types::agents::ClaudeCodeSettings, String> {
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
        haiku_model: env
            .and_then(|e| e.get("ANTHROPIC_DEFAULT_HAIKU_MODEL"))
            .and_then(|v| v.as_str())
            .map(String::from),
        opus_model: env
            .and_then(|e| e.get("ANTHROPIC_DEFAULT_OPUS_MODEL"))
            .and_then(|v| v.as_str())
            .map(String::from),
        sonnet_model: env
            .and_then(|e| e.get("ANTHROPIC_DEFAULT_SONNET_MODEL"))
            .and_then(|v| v.as_str())
            .map(String::from),
        base_url: env
            .and_then(|e| e.get("ANTHROPIC_BASE_URL"))
            .and_then(|v| v.as_str())
            .map(String::from),
        auth_token: env
            .and_then(|e| e.get("ANTHROPIC_AUTH_TOKEN"))
            .and_then(|v| v.as_str())
            .map(String::from),
    })
}

#[tauri::command]
pub async fn get_thinking_budget_settings(
    state: State<'_, AppState>,
) -> Result<ThinkingBudgetSettings, String> {
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
pub async fn set_thinking_budget_settings(
    state: State<'_, AppState>,
    settings: ThinkingBudgetSettings,
) -> Result<(), String> {
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
pub async fn get_reasoning_effort_settings(
    state: State<'_, AppState>,
) -> Result<ReasoningEffortSettings, String> {
    let config = state.config.lock().unwrap();
    let level = if config.reasoning_effort_level.is_empty() {
        "medium".to_string()
    } else {
        config.reasoning_effort_level.clone()
    };
    Ok(ReasoningEffortSettings { level })
}

#[tauri::command]
pub async fn set_reasoning_effort_settings(
    state: State<'_, AppState>,
    settings: ReasoningEffortSettings,
) -> Result<(), String> {
    // Validate level
    let valid_levels = ["none", "low", "medium", "high", "xhigh"];
    if !valid_levels.contains(&settings.level.as_str()) {
        return Err(format!(
            "Invalid reasoning effort level: {}. Must be one of: {:?}",
            settings.level, valid_levels
        ));
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
pub async fn get_close_to_tray(state: State<'_, AppState>) -> Result<bool, String> {
    let config = state.config.lock().unwrap();
    Ok(config.close_to_tray)
}

#[tauri::command]
pub async fn set_close_to_tray(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
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

// ============================================================================
// Management API Settings (Runtime Updates)
// ============================================================================

// Get max retry interval from Management API
#[tauri::command]
pub async fn get_max_retry_interval(state: State<'_, AppState>) -> Result<i32, String> {
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
pub async fn set_max_retry_interval(
    state: State<'_, AppState>,
    value: i32,
) -> Result<(), String> {
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
        return Err(format!(
            "Failed to set max retry interval: {} - {}",
            status, text
        ));
    }

    // Persist to Tauri config so it survives restart
    let mut config = state.config.lock().unwrap();
    config.max_retry_interval = value;
    save_config_to_file(&config).map_err(|e| format!("Failed to save config: {}", e))?;

    Ok(())
}

// Get log size from Management API
#[tauri::command]
pub async fn get_log_size(state: State<'_, AppState>) -> Result<u32, String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "log-size");

    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to get log size: {}", e))?;

    if !response.status().is_success() {
        return Ok(500); // Default to 500 if not set
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(json["log-size"].as_u64().unwrap_or(500) as u32)
}

// Set log size via Management API
#[tauri::command]
pub async fn set_log_size(state: State<'_, AppState>, size: u32) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "log-size");

    let client = build_management_client();
    let response = client
        .put(&url)
        .header("X-Management-Key", &get_management_key())
        .json(&serde_json::json!({ "value": size }))
        .send()
        .await
        .map_err(|e| format!("Failed to set log size: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to set log size: {} - {}", status, text));
    }

    Ok(())
}

// Get WebSocket auth status from Management API
#[tauri::command]
pub async fn get_websocket_auth(state: State<'_, AppState>) -> Result<bool, String> {
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
pub async fn set_websocket_auth(
    state: State<'_, AppState>,
    value: bool,
) -> Result<(), String> {
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

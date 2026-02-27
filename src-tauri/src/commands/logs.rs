//! Log viewer commands and helpers.

use crate::state::AppState;
use crate::types::LogEntry;
use crate::{build_management_client, get_management_key, get_management_url};
use serde::Deserialize;
use tauri::State;

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
pub async fn get_logs(
    state: State<'_, AppState>,
    lines: Option<u32>,
) -> Result<Vec<LogEntry>, String> {
    let port = state.config.lock().unwrap().port;
    let lines_param = lines.unwrap_or(500);
    let url = format!("{}?lines={}", get_management_url(port, "logs"), lines_param);

    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", &get_management_key())
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
pub async fn clear_logs(state: State<'_, AppState>) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "logs");

    let client = build_management_client();
    let response = client
        .delete(&url)
        .header("X-Management-Key", &get_management_key())
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

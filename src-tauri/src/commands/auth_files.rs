//! Auth Files Management - via Management API

use crate::state::AppState;
use crate::types::{self, AuthFile};
use crate::{build_management_client, get_management_key, get_management_url};
use tauri::State;

// Get all auth files
#[tauri::command]
pub async fn get_auth_files(state: State<'_, AppState>) -> Result<Vec<AuthFile>, String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "auth-files");
    
    // 1. Fetch active files from Management API
    let mut files: Vec<AuthFile> = Vec::new();
    
    // Only try to fetch if proxy is running
    let proxy_running = state.proxy_status.lock().unwrap().running;
    if proxy_running {
        let client = build_management_client();
        match client
            .get(&url)
            .header("X-Management-Key", &get_management_key())
            .send()
            .await 
        {
            Ok(response) => {
                if response.status().is_success() {
                    if let Ok(json) = response.json::<serde_json::Value>().await {
                        let files_array = if let Some(f) = json.get("files") {
                            f.clone()
                        } else if json.is_array() {
                            json
                        } else {
                            serde_json::Value::Array(Vec::new())
                        };
                        
                        // Convert snake_case to camelCase
                        if let Ok(json_str) = serde_json::to_string(&files_array) {
                            let converted = json_str
                                .replace("\"status_message\"", "\"statusMessage\"")
                                .replace("\"runtime_only\"", "\"runtimeOnly\"")
                                .replace("\"account_type\"", "\"accountType\"")
                                .replace("\"created_at\"", "\"createdAt\"")
                                .replace("\"updated_at\"", "\"updatedAt\"")
                                .replace("\"last_refresh\"", "\"lastRefresh\"")
                                .replace("\"success_count\"", "\"successCount\"")
                                .replace("\"failure_count\"", "\"failureCount\"");
                                
                            if let Ok(parsed) = serde_json::from_str::<Vec<AuthFile>>(&converted) {
                                files = parsed;
                            }
                        }
                    }
                }
            },
            Err(_) => {
                // Ignore connection errors if proxy just stopped
            }
        }
    }
    
    // 2. Scan for disabled files (.json.disabled) in auth directory
    let auth_dir = dirs::home_dir()
        .ok_or("Could not find home directory")?
        .join(".cli-proxy-api");
        
    if auth_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&auth_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.ends_with(".json.disabled") {
                        // This is a disabled auth file
                        if let Ok(content) = std::fs::read_to_string(&path) {
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                                // Try to extract provider/email for metadata
                                let provider = json.get("provider")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("unknown")
                                    .to_string();
                                    
                                let dummy_id = name.strip_suffix(".json.disabled").unwrap_or(name).to_string();
                                
                                // Create AuthFile entry for this disabled file
                                let disabled_file = AuthFile {
                                    id: dummy_id.clone(),
                                    name: dummy_id,
                                    provider,
                                    status: "disabled".to_string(),
                                    disabled: true,
                                    unavailable: false,
                                    runtime_only: false,
                                    source: Some("file".to_string()),
                                    path: Some(path.to_string_lossy().to_string()),
                                    size: Some(entry.metadata().map(|m| m.len()).unwrap_or(0)),
                                    modtime: Some(entry.metadata().ok()
                                        .and_then(|m| m.modified().ok())
                                        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
                                        .unwrap_or_default()),
                                    email: None, // Could parse from content if standard format
                                    account_type: None,
                                    account: None,
                                    created_at: None,
                                    updated_at: None,
                                    last_refresh: None,
                                    success_count: None,
                                    failure_count: None,
                                    label: None,
                                    status_message: None,
                                };
                                
                                files.push(disabled_file);
                            }
                        }
                    }
                }
            }
        }
    }
    
    Ok(files)
}

// Upload auth file
#[tauri::command]
pub async fn upload_auth_file(state: State<'_, AppState>, file_path: String, provider: String) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = get_management_url(port, "auth-files");
    
    // Read file content
    let content = std::fs::read(&file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    
    // Get filename from path
    let filename = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("auth.json")
        .to_string();
    
    let client = build_management_client();
    
    // Create multipart form
    let part = reqwest::multipart::Part::bytes(content)
        .file_name(filename.clone())
        .mime_str("application/json")
        .map_err(|e| e.to_string())?;
    
    let form = reqwest::multipart::Form::new()
        .text("provider", provider)
        .text("filename", filename)
        .part("file", part);
    
    let response = client
        .post(&url)
        .header("X-Management-Key", &get_management_key())
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Failed to upload auth file: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to upload auth file: {} - {}", status, text));
    }
    
    Ok(())
}

// Delete auth file
#[tauri::command]
pub async fn delete_auth_file(state: State<'_, AppState>, file_id: String) -> Result<(), String> {
    // Check if it's a disabled file first (file_id matches filename without extension usually)
    let auth_dir = dirs::home_dir()
        .ok_or("Could not find home directory")?
        .join(".cli-proxy-api");
        
    let disabled_path = auth_dir.join(format!("{}.json.disabled", file_id));
    if disabled_path.exists() {
        std::fs::remove_file(disabled_path)
            .map_err(|e| format!("Failed to delete disabled file: {}", e))?;
        return Ok(());
    }

    // Otherwise try to delete via API
    let port = state.config.lock().unwrap().port;
    let url = format!("{}?name={}", get_management_url(port, "auth-files"), file_id);
    
    let client = build_management_client();
    let response = client
        .delete(&url)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to delete auth file: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to delete auth file: {} - {}", status, text));
    }
    
    Ok(())
}

// Toggle auth file enabled/disabled via management API (CLIProxyAPI v6.7.18+)
// Fallback: manually rename file to .json.disabled if API returns 404
#[tauri::command]
pub async fn toggle_auth_file(
	state: State<'_, AppState>,
	file_name: String,
	disabled: bool,
) -> Result<(), String> {
	let port = {
		let config = state.config.lock().unwrap();
		config.port
	};

	// Use the new PATCH endpoint from CLIProxyAPI v6.7.18
	// Endpoint: PATCH /v0/management/auth-files/status
	// Body: { "name": "filename.json", "disabled": true/false }
	let url = get_management_url(port, "auth-files/status");

	let client = build_management_client();
	let response_res = client
		.patch(&url)
		.header("X-Management-Key", &get_management_key())
		.json(&serde_json::json!({
			"name": file_name,
			"disabled": disabled
		}))
		.send()
		.await;

	match response_res {
		Ok(response) if response.status().is_success() => Ok(()),
		Ok(response) if response.status().as_u16() == 404 => {
			// API not found (old version), fallback to manual file renaming
			let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
			let auth_dir = home_dir.join(".cli-proxy-api");

			let current_name = if !disabled {
				format!("{}.disabled", file_name)
			} else {
				file_name.clone()
			};

			let new_name = if disabled {
				format!("{}.disabled", file_name)
			} else {
				file_name.clone()
			};

			let current_path = auth_dir.join(&current_name);
			let new_path = auth_dir.join(&new_name);

			if current_path.exists() {
				std::fs::rename(&current_path, &new_path)
					.map_err(|e| format!("Manual toggle failed: {}", e))?;
				Ok(())
			} else {
				Err(format!("Auth file not found: {:?}", current_path))
			}
		}
		Ok(response) => {
			let status = response.status();
			let error_text = response.text().await.unwrap_or_default();
			Err(format!(
				"Failed to toggle auth file: {} - {}",
				status, error_text
			))
		}
		Err(e) => Err(format!("Failed to toggle auth file: {}", e)),
	}
}

// Download auth file - returns path to temp file
#[tauri::command]
pub async fn download_auth_file(state: State<'_, AppState>, _file_id: String, filename: String) -> Result<String, String> {
    let port = state.config.lock().unwrap().port;
    let url = format!("{}?name={}", get_management_url(port, "auth-files/download"), filename);
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to download auth file: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to download auth file: {} - {}", status, text));
    }
    
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    
    // Save to downloads directory
    let downloads_dir = dirs::download_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default());
    
    let dest_path = downloads_dir.join(&filename);
    std::fs::write(&dest_path, &bytes)
        .map_err(|e| format!("Failed to save file: {}", e))?;
    
    Ok(dest_path.to_string_lossy().to_string())
}

// Delete all auth files
#[tauri::command]
pub async fn delete_all_auth_files(state: State<'_, AppState>) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = format!("{}?all=true", get_management_url(port, "auth-files"));
    
    let client = build_management_client();
    let response = client
        .delete(&url)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to delete all auth files: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to delete all auth files: {} - {}", status, text));
    }
    
    Ok(())
}

// ==========================================================================
// Proxy Auth Status Verification (CLIProxyAPI v6.6.72+)
// ==========================================================================

// Verify auth status from CLIProxyAPI's /api/auth/status endpoint
#[tauri::command]
pub async fn verify_proxy_auth_status(state: State<'_, AppState>) -> Result<types::ProxyAuthStatus, String> {
    let port = state.config.lock().unwrap().port;
    
    // Check if proxy is running first
    let proxy_running = state.proxy_status.lock().unwrap().running;
    if !proxy_running {
        return Ok(types::ProxyAuthStatus::default());
    }
    
    // The new endpoint in CLIProxyAPI v6.6.72+ is /api/auth/status
    let url = format!("http://127.0.0.1:{}/api/auth/status", port);
    
    let client = build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", &get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to verify auth status: {}", e))?;
    
    if !response.status().is_success() {
        // Fallback: endpoint might not exist in older CLIProxyAPI versions
        return Ok(types::ProxyAuthStatus {
            status: "unsupported".to_string(),
            providers: types::ProxyAuthProviders::default(),
        });
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    
    // Convert snake_case to camelCase if needed
    let json_str = serde_json::to_string(&json).map_err(|e| e.to_string())?;
    let converted = json_str
        .replace("\"account_count\"", "\"accounts\"")
        .replace("\"error_message\"", "\"error\"");
    
    serde_json::from_str(&converted).map_err(|e| format!("Failed to parse auth status: {}", e))
}

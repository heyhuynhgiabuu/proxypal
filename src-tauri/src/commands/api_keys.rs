//! API Keys Management - CRUD operations via Management API.

use tauri::State;
use crate::state::AppState;
use crate::config::save_config_to_file;
use crate::types::{GeminiApiKey, ClaudeApiKey, CodexApiKey, VertexApiKey, OpenAICompatibleProvider};

// Convert Management API kebab-case keys to camelCase for frontend
// The Management API returns data wrapped in an object like: { "gemini-api-key": [...] }
// It may also return null for empty lists: { "gemini-api-key": null }
fn convert_api_key_response<T: serde::de::DeserializeOwned>(json: serde_json::Value, wrapper_key: &str) -> Result<Vec<T>, String> {
    // Extract the array from the wrapper object
    let array_value = match &json {
        serde_json::Value::Object(obj) => {
            match obj.get(wrapper_key) {
                Some(serde_json::Value::Array(arr)) => serde_json::Value::Array(arr.clone()),
                Some(serde_json::Value::Null) | None => serde_json::Value::Array(vec![]), // null or missing = empty array
                Some(other) => return Err(format!("Expected array or null for key '{}', got: {:?}", wrapper_key, other)),
            }
        }
        serde_json::Value::Array(_) => json.clone(), // Already an array, use as-is
        serde_json::Value::Null => serde_json::Value::Array(vec![]), // Top-level null = empty array
        _ => return Err(format!("Unexpected response format: expected object with key '{}' or array", wrapper_key)),
    };
    
    // The Management API returns kebab-case, we need to convert
    let json_str = serde_json::to_string(&array_value).map_err(|e| e.to_string())?;
    // Replace kebab-case with camelCase for our structs
    let converted = json_str
        .replace("\"api-key\"", "\"apiKey\"")
        .replace("\"base-url\"", "\"baseUrl\"")
        .replace("\"proxy-url\"", "\"proxyUrl\"")
        .replace("\"excluded-models\"", "\"excludedModels\"")
        .replace("\"api-key-entries\"", "\"apiKeyEntries\"");
    serde_json::from_str(&converted).map_err(|e| e.to_string())
}

// Convert camelCase to kebab-case for Management API
fn convert_to_management_format<T: serde::Serialize>(data: &T) -> Result<serde_json::Value, String> {
    let json_str = serde_json::to_string(data).map_err(|e| e.to_string())?;
    let converted = json_str
        .replace("\"apiKey\"", "\"api-key\"")
        .replace("\"baseUrl\"", "\"base-url\"")
        .replace("\"proxyUrl\"", "\"proxy-url\"")
        .replace("\"excludedModels\"", "\"excluded-models\"")
        .replace("\"apiKeyEntries\"", "\"api-key-entries\"");
    serde_json::from_str(&converted).map_err(|e| e.to_string())
}

// ============================================
// Gemini API Keys
// ============================================

#[tauri::command]
pub async fn get_gemini_api_keys(state: State<'_, AppState>) -> Result<Vec<GeminiApiKey>, String> {
    let port = state.config.lock().unwrap().port;
    let url = crate::get_management_url(port, "gemini-api-key");
    
    let client = crate::build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", &crate::get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Gemini API keys: {}", e))?;
    
    if !response.status().is_success() {
        return Ok(Vec::new());
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    convert_api_key_response(json, "gemini-api-key")
}

#[tauri::command]
pub async fn set_gemini_api_keys(state: State<'_, AppState>, keys: Vec<GeminiApiKey>) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = crate::get_management_url(port, "gemini-api-key");
    
    let client = crate::build_management_client();
    let body = convert_to_management_format(&keys)?;
    
    let response = client
        .put(&url)
        .header("X-Management-Key", &crate::get_management_key())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to set Gemini API keys: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to set Gemini API keys: {} - {}", status, text));
    }
    
    // Persist to ProxyPal config for restart persistence
    {
        let mut config = state.config.lock().unwrap();
        config.gemini_api_keys = keys;
        save_config_to_file(&config)?;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn add_gemini_api_key(state: State<'_, AppState>, key: GeminiApiKey) -> Result<(), String> {
    let mut keys = get_gemini_api_keys(state.clone()).await?;
    keys.push(key);
    set_gemini_api_keys(state, keys).await
}

#[tauri::command]
pub async fn delete_gemini_api_key(state: State<'_, AppState>, index: usize) -> Result<(), String> {
    let mut keys = get_gemini_api_keys(state.clone()).await?;
    if index >= keys.len() {
        return Err("Index out of bounds".to_string());
    }
    keys.remove(index);
    set_gemini_api_keys(state, keys).await
}

// ============================================
// Claude API Keys
// ============================================

#[tauri::command]
pub async fn get_claude_api_keys(state: State<'_, AppState>) -> Result<Vec<ClaudeApiKey>, String> {
    let port = state.config.lock().unwrap().port;
    let url = crate::get_management_url(port, "claude-api-key");
    
    let client = crate::build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", &crate::get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Claude API keys: {}", e))?;
    
    if !response.status().is_success() {
        return Ok(Vec::new());
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    convert_api_key_response(json, "claude-api-key")
}

#[tauri::command]
pub async fn set_claude_api_keys(state: State<'_, AppState>, keys: Vec<ClaudeApiKey>) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = crate::get_management_url(port, "claude-api-key");
    
    let client = crate::build_management_client();
    let body = convert_to_management_format(&keys)?;
    
    let response = client
        .put(&url)
        .header("X-Management-Key", &crate::get_management_key())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to set Claude API keys: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to set Claude API keys: {} - {}", status, text));
    }
    
    // Persist to ProxyPal config for restart persistence
    {
        let mut config = state.config.lock().unwrap();
        config.claude_api_keys = keys;
        save_config_to_file(&config)?;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn add_claude_api_key(state: State<'_, AppState>, key: ClaudeApiKey) -> Result<(), String> {
    let mut keys = get_claude_api_keys(state.clone()).await?;
    keys.push(key);
    set_claude_api_keys(state, keys).await
}

#[tauri::command]
pub async fn delete_claude_api_key(state: State<'_, AppState>, index: usize) -> Result<(), String> {
    let mut keys = get_claude_api_keys(state.clone()).await?;
    if index >= keys.len() {
        return Err("Index out of bounds".to_string());
    }
    keys.remove(index);
    set_claude_api_keys(state, keys).await
}

// ============================================
// Codex API Keys
// ============================================

#[tauri::command]
pub async fn get_codex_api_keys(state: State<'_, AppState>) -> Result<Vec<CodexApiKey>, String> {
    let port = state.config.lock().unwrap().port;
    let url = crate::get_management_url(port, "codex-api-key");
    
    let client = crate::build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", &crate::get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Codex API keys: {}", e))?;
    
    if !response.status().is_success() {
        return Ok(Vec::new());
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    convert_api_key_response(json, "codex-api-key")
}

#[tauri::command]
pub async fn set_codex_api_keys(state: State<'_, AppState>, keys: Vec<CodexApiKey>) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = crate::get_management_url(port, "codex-api-key");
    
    let client = crate::build_management_client();
    let body = convert_to_management_format(&keys)?;
    
    let response = client
        .put(&url)
        .header("X-Management-Key", &crate::get_management_key())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to set Codex API keys: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to set Codex API keys: {} - {}", status, text));
    }
    
    // Persist to ProxyPal config for restart persistence
    {
        let mut config = state.config.lock().unwrap();
        config.codex_api_keys = keys;
        save_config_to_file(&config)?;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn add_codex_api_key(state: State<'_, AppState>, key: CodexApiKey) -> Result<(), String> {
    let mut keys = get_codex_api_keys(state.clone()).await?;
    keys.push(key);
    set_codex_api_keys(state, keys).await
}

#[tauri::command]
pub async fn delete_codex_api_key(state: State<'_, AppState>, index: usize) -> Result<(), String> {
    let mut keys = get_codex_api_keys(state.clone()).await?;
    if index >= keys.len() {
        return Err("Index out of bounds".to_string());
    }
    keys.remove(index);
    set_codex_api_keys(state, keys).await
}

// ============================================
// Vertex API Keys
// ============================================

#[tauri::command]
pub async fn get_vertex_api_keys(state: State<'_, AppState>) -> Result<Vec<VertexApiKey>, String> {
    let port = state.config.lock().unwrap().port;
    let url = crate::get_management_url(port, "vertex-api-key");
    
    let client = crate::build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", &crate::get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Vertex API keys: {}", e))?;
    
    if !response.status().is_success() {
        return Ok(Vec::new());
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    convert_api_key_response(json, "vertex-api-key")
}

#[tauri::command]
pub async fn set_vertex_api_keys(state: State<'_, AppState>, keys: Vec<VertexApiKey>) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = crate::get_management_url(port, "vertex-api-key");
    
    let client = crate::build_management_client();
    let body = convert_to_management_format(&keys)?;
    
    let response = client
        .put(&url)
        .header("X-Management-Key", &crate::get_management_key())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to set Vertex API keys: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to set Vertex API keys: {} - {}", status, text));
    }
    
    Ok(())
}

#[tauri::command]
pub async fn add_vertex_api_key(state: State<'_, AppState>, key: VertexApiKey) -> Result<(), String> {
    let mut keys = get_vertex_api_keys(state.clone()).await?;
    keys.push(key);
    set_vertex_api_keys(state, keys).await
}

#[tauri::command]
pub async fn delete_vertex_api_key(state: State<'_, AppState>, index: usize) -> Result<(), String> {
    let mut keys = get_vertex_api_keys(state.clone()).await?;
    if index >= keys.len() {
        return Err("Index out of bounds".to_string());
    }
    keys.remove(index);
    set_vertex_api_keys(state, keys).await
}

// ============================================
// OpenAI-Compatible Providers
// ============================================

#[tauri::command]
pub async fn get_openai_compatible_providers(state: State<'_, AppState>) -> Result<Vec<OpenAICompatibleProvider>, String> {
    let port = state.config.lock().unwrap().port;
    let url = crate::get_management_url(port, "openai-compatibility");
    
    let client = crate::build_management_client();
    let response = client
        .get(&url)
        .header("X-Management-Key", &crate::get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch OpenAI-compatible providers: {}", e))?;
    
    if !response.status().is_success() {
        return Ok(Vec::new());
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    convert_api_key_response(json, "openai-compatibility")
}

#[tauri::command]
pub async fn set_openai_compatible_providers(state: State<'_, AppState>, providers: Vec<OpenAICompatibleProvider>) -> Result<(), String> {
    let port = state.config.lock().unwrap().port;
    let url = crate::get_management_url(port, "openai-compatibility");
    
    let client = crate::build_management_client();
    let body = convert_to_management_format(&providers)?;
    
    let response = client
        .put(&url)
        .header("X-Management-Key", &crate::get_management_key())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to set OpenAI-compatible providers: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to set OpenAI-compatible providers: {} - {}", status, text));
    }
    
    // Persist to local config for restart persistence
    {
        let mut config = state.config.lock().unwrap();
        config.amp_openai_providers = providers.iter().map(|p| {
            crate::types::amp::AmpOpenAIProvider {
                id: uuid::Uuid::new_v4().to_string(),
                name: p.name.clone(),
                base_url: p.base_url.clone(),
                api_key: p.api_key_entries.first().map(|e| e.api_key.clone()).unwrap_or_default(),
                models: p.models.as_ref().map(|m| {
                    m.iter().map(|model| crate::types::amp::AmpOpenAIModel {
                        name: model.name.clone(),
                        alias: model.alias.clone().unwrap_or_default(),
                    }).collect()
                }).unwrap_or_default(),
            }
        }).collect();
    }
    let config_to_save = state.config.lock().unwrap().clone();
    crate::config::save_config_to_file(&config_to_save)?;
    
    Ok(())
}

#[tauri::command]
pub async fn add_openai_compatible_provider(state: State<'_, AppState>, provider: OpenAICompatibleProvider) -> Result<(), String> {
    let mut providers = get_openai_compatible_providers(state.clone()).await?;
    providers.push(provider);
    set_openai_compatible_providers(state, providers).await
}

#[tauri::command]
pub async fn delete_openai_compatible_provider(state: State<'_, AppState>, index: usize) -> Result<(), String> {
    let mut providers = get_openai_compatible_providers(state.clone()).await?;
    if index >= providers.len() {
        return Err("Index out of bounds".to_string());
    }
    providers.remove(index);
    set_openai_compatible_providers(state, providers).await
}

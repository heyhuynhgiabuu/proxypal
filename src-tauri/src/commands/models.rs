use crate::state::AppState;
use crate::types::{AvailableModel, ModelDefinition, ProviderTestResult};
use serde::Deserialize;
use tauri::State;

// Internal types for model API responses
#[derive(Debug, Deserialize)]
struct ModelsApiResponse {
    data: Vec<ModelsApiModel>,
}

#[derive(Debug, Deserialize)]
struct ModelsApiModel {
    id: String,
    owned_by: String,
}

#[tauri::command]
pub fn get_gpt_reasoning_models() -> Vec<String> {
    crate::GPT5_BASE_MODELS
        .iter()
        .map(|s| s.to_string())
        .collect()
}

#[tauri::command]
pub async fn get_available_models(
    state: State<'_, AppState>,
) -> Result<Vec<AvailableModel>, String> {
    let config = state.config.lock().unwrap().clone();
    let proxy_running = state.proxy_status.lock().unwrap().running;

    if !proxy_running {
        return Ok(vec![]);
    }

    // Get auth status to determine model sources
    let auth_status = state.auth_status.lock().unwrap().clone();
    let has_vertex = auth_status.vertex > 0;
    let has_gemini_api = !config.gemini_api_keys.is_empty();
    let has_copilot = config.copilot.enabled;
    let has_openai = auth_status.openai > 0;

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let endpoint = format!("http://localhost:{}/v1/models", config.port);

    let response = match client
        .get(&endpoint)
        .header("Authorization", format!("Bearer {}", config.proxy_api_key))
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(e) => {
            // Connection error - proxy might have crashed
            // Update state to reflect proxy is not running
            {
                let mut status = state.proxy_status.lock().unwrap();
                status.running = false;
            }
            return Err(format!(
                "Proxy not responding. Please restart the proxy. ({})",
                e
            ));
        }
    };

    if !response.status().is_success() {
        return Err(format!("API returned status {}", response.status()));
    }

    let api_response: ModelsApiResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse models response: {}", e))?;

    let models: Vec<AvailableModel> = api_response
        .data
        .into_iter()
        .map(|m| {
            // Determine source based on owned_by and auth status
            let source = match m.owned_by.as_str() {
                "google" => {
                    // Google models can come from Vertex AI or Gemini API
                    if has_vertex && !has_gemini_api {
                        "vertex".to_string()
                    } else if has_gemini_api && !has_vertex {
                        "gemini-api".to_string()
                    } else if has_vertex && has_gemini_api {
                        "vertex+gemini-api".to_string() // Both sources available
                    } else {
                        "google".to_string() // Fallback
                    }
                }
                "anthropic" => {
                    if !config.claude_api_keys.is_empty() {
                        "api-key".to_string()
                    } else {
                        "oauth".to_string()
                    }
                }
                "openai" => {
                    // Priority: API key > OpenAI OAuth > Copilot fallback
                    // Copilot models already have owned_by "github-copilot",
                    // so owned_by "openai" means direct OpenAI access
                    if !config.codex_api_keys.is_empty() {
                        "api-key".to_string()
                    } else if has_openai {
                        "oauth".to_string()
                    } else if has_copilot {
                        "copilot".to_string() // Fallback: routed through Copilot
                    } else {
                        "oauth".to_string()
                    }
                }
                // GitHub Copilot models (owned_by from CLIProxyAPI)
                "github-copilot" | "copilot" => "copilot".to_string(),
                owner => owner.to_string(),
            };

            AvailableModel {
                id: m.id,
                owned_by: m.owned_by,
                source,
            }
        })
        .collect();

    Ok(models)
}

#[tauri::command]
pub async fn test_provider_connection(
    model_id: String,
    state: State<'_, AppState>,
) -> Result<ProviderTestResult, String> {
    let (port, api_key) = {
        let config = state.config.lock().unwrap();
        (config.port, config.proxy_api_key.clone())
    };

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let endpoint = format!("http://localhost:{}/v1/chat/completions", port);

    let payload = serde_json::json!({
        "model": model_id,
        "messages": [
            {
                "role": "user",
                "content": "Say 'OK'"
            }
        ],
        "max_tokens": 5
    });

    let start = std::time::Instant::now();
    let response = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&payload)
        .send()
        .await;

    let latency = start.elapsed().as_millis() as u64;

    match response {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                Ok(ProviderTestResult {
                    success: true,
                    message: "Connection successful!".to_string(),
                    latency_ms: Some(latency),
                    models_found: None,
                })
            } else {
                let error_text = resp
                    .text()
                    .await
                    .unwrap_or_else(|_| "Unknown error".to_string());
                Ok(ProviderTestResult {
                    success: false,
                    message: format!("Error {}: {}", status, error_text),
                    latency_ms: Some(latency),
                    models_found: None,
                })
            }
        }
        Err(e) => Ok(ProviderTestResult {
            success: false,
            message: format!("Connection failed: {}", e),
            latency_ms: Some(latency),
            models_found: None,
        }),
    }
}

#[tauri::command]
pub async fn test_openai_provider(
    base_url: String,
    api_key: String,
) -> Result<ProviderTestResult, String> {
    if base_url.is_empty() || api_key.is_empty() {
        return Ok(ProviderTestResult {
            success: false,
            message: "Base URL and API key are required".to_string(),
            latency_ms: None,
            models_found: None,
        });
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    // Normalize base URL - remove trailing slash
    let base_url = base_url.trim_end_matches('/');
    let is_minimax_provider =
        base_url.contains("api.minimax.io") || base_url.contains("api.minimaxi.com");

    // Try multiple endpoint patterns since providers have varying API structures:
    // 1. {baseUrl}/models - for providers where user specifies full path (e.g., .../v1 or .../v4)
    // 2. {baseUrl}/v1/models - for providers where user specifies root URL
    let endpoints = vec![
        format!("{}/models", base_url),
        format!("{}/v1/models", base_url),
    ];

    let start = std::time::Instant::now();

    for endpoint in &endpoints {
        let response = client
            .get(endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await;
        let latency = start.elapsed().as_millis() as u64;

        match response {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    // Try to count models
                    let models_count = if let Ok(json) = resp.json::<serde_json::Value>().await {
                        json.get("data")
                            .and_then(|d| d.as_array())
                            .map(|arr| arr.len() as u32)
                    } else {
                        None
                    };

                    return Ok(ProviderTestResult {
                        success: true,
                        message: format!("Connection successful! ({}ms)", latency),
                        latency_ms: Some(latency),
                        models_found: models_count,
                    });
                } else if status.as_u16() == 401 || status.as_u16() == 403 {
                    return Ok(ProviderTestResult {
                        success: false,
                        message: "Authentication failed - check your API key".to_string(),
                        latency_ms: Some(latency),
                        models_found: None,
                    });
                }
                // For 404, try the next endpoint pattern
            }
            Err(e) => {
                // For connection errors, return immediately
                if e.is_timeout() {
                    return Ok(ProviderTestResult {
                        success: false,
                        message: "Connection timed out - check your base URL".to_string(),
                        latency_ms: Some(start.elapsed().as_millis() as u64),
                        models_found: None,
                    });
                } else if e.is_connect() {
                    return Ok(ProviderTestResult {
                        success: false,
                        message: "Could not connect - check your base URL".to_string(),
                        latency_ms: Some(start.elapsed().as_millis() as u64),
                        models_found: None,
                    });
                }
            }
        }
    }

    if is_minimax_provider {
        return test_minimax_chat_completion(&client, base_url, &api_key, start).await;
    }

    // All endpoints failed with 404 or similar
    let latency = start.elapsed().as_millis() as u64;
    Ok(ProviderTestResult {
        success: false,
        message:
            "Provider returned 404 Not Found - check your base URL (tried /models and /v1/models)"
                .to_string(),
        latency_ms: Some(latency),
        models_found: None,
    })
}

async fn test_minimax_chat_completion(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
    start: std::time::Instant,
) -> Result<ProviderTestResult, String> {
    let endpoint = format!("{}/chat/completions", base_url);
    let payload = serde_json::json!({
        "model": "MiniMax-M2.7",
        "messages": [{ "role": "user", "content": "Say OK" }],
        "max_tokens": 5
    });

    let response = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&payload)
        .send()
        .await;
    let latency = start.elapsed().as_millis() as u64;

    match response {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                Ok(ProviderTestResult {
                    success: true,
                    message: format!("Connection successful! MiniMax does not expose /models, so chat completion was tested instead. ({}ms)", latency),
                    latency_ms: Some(latency),
                    models_found: None,
                })
            } else if status.as_u16() == 401 || status.as_u16() == 403 {
                Ok(ProviderTestResult {
                    success: false,
                    message: "Authentication failed - check your API key".to_string(),
                    latency_ms: Some(latency),
                    models_found: None,
                })
            } else {
                let error_text = resp
                    .text()
                    .await
                    .unwrap_or_else(|_| "Unknown error".to_string());
                Ok(ProviderTestResult {
                    success: false,
                    message: format!("MiniMax /models endpoint is unavailable and chat completion test failed ({}): {}", status, error_text),
                    latency_ms: Some(latency),
                    models_found: None,
                })
            }
        }
        Err(e) => Ok(ProviderTestResult {
            success: false,
            message: format!("MiniMax chat completion test failed: {}", e),
            latency_ms: Some(latency),
            models_found: None,
        }),
    }
}

// Fetch models from all configured OpenAI-compatible providers
#[tauri::command]
pub async fn fetch_openai_compatible_models(
    state: State<'_, AppState>,
) -> Result<Vec<crate::types::OpenAICompatibleProviderModels>, String> {
    // Get all configured OpenAI-compatible providers
    let providers =
        crate::commands::api_keys::get_openai_compatible_providers(state.clone()).await?;

    if providers.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();

    for provider in providers {
        let base_url = provider.base_url.trim_end_matches('/');
        let api_key = provider
            .api_key_entries
            .first()
            .map(|e| e.api_key.clone())
            .unwrap_or_default();

        if api_key.is_empty() {
            results.push(crate::types::OpenAICompatibleProviderModels {
                provider_name: provider.name.clone(),
                base_url: provider.base_url.clone(),
                models: Vec::new(),
                error: Some("No API key configured".to_string()),
            });
            continue;
        }

        // Try multiple endpoint patterns
        let endpoints = vec![
            format!("{}/models", base_url),
            format!("{}/v1/models", base_url),
        ];

        let mut found_models = false;

        for endpoint in &endpoints {
            let response = client
                .get(endpoint)
                .header("Authorization", format!("Bearer {}", api_key))
                .send()
                .await;

            match response {
                Ok(resp) if resp.status().is_success() => {
                    if let Ok(json) = resp.json::<serde_json::Value>().await {
                        let models: Vec<crate::types::OpenAICompatibleModel> = json
                            .get("data")
                            .and_then(|d| d.as_array())
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|m| {
                                        let id = m.get("id")?.as_str()?.to_string();
                                        Some(crate::types::OpenAICompatibleModel {
                                            id,
                                            owned_by: m
                                                .get("owned_by")
                                                .and_then(|v| v.as_str())
                                                .map(String::from),
                                            created: m.get("created").and_then(|v| v.as_i64()),
                                        })
                                    })
                                    .collect()
                            })
                            .unwrap_or_default();

                        results.push(crate::types::OpenAICompatibleProviderModels {
                            provider_name: provider.name.clone(),
                            base_url: provider.base_url.clone(),
                            models,
                            error: None,
                        });
                        found_models = true;
                        break;
                    }
                }
                Ok(resp) if resp.status().as_u16() == 401 || resp.status().as_u16() == 403 => {
                    results.push(crate::types::OpenAICompatibleProviderModels {
                        provider_name: provider.name.clone(),
                        base_url: provider.base_url.clone(),
                        models: Vec::new(),
                        error: Some("Authentication failed".to_string()),
                    });
                    found_models = true;
                    break;
                }
                _ => continue, // Try next endpoint
            }
        }

        if !found_models {
            results.push(crate::types::OpenAICompatibleProviderModels {
                provider_name: provider.name.clone(),
                base_url: provider.base_url.clone(),
                models: Vec::new(),
                error: Some("Could not fetch models - endpoint not found".to_string()),
            });
        }
    }

    Ok(results)
}

// Get model context and output limits
pub(crate) fn get_model_limits(model_id: &str, owned_by: &str, source: &str) -> (u64, u64) {
    // Return (context_limit, output_limit)
    // First check model_id patterns (handles Antigravity Claude models like claude-opus-4-5-thinking)
    let model_lower = model_id.to_lowercase();

    // Claude models (direct or via Antigravity)
    if model_lower.contains("claude") {
        // Claude 4.5 models: 200K context, 64K output
        // Claude 3.5 haiku: 200K context, 8K output
        if model_lower.contains("3-5-haiku") || model_lower.contains("3-haiku") {
            return (200000, 8192);
        } else {
            // sonnet-4-5, opus-4-5, haiku-4-5, and other Claude 4.x models
            return (200000, 64000);
        }
    }

    // Gemini models
    if model_lower.contains("gemini") {
        // Gemini 2.5 models: 1M context, 65K output
        return (1000000, 65536);
    }

    // GPT/OpenAI models
    if model_lower.contains("gpt") || model_lower.starts_with("o1") || model_lower.starts_with("o3")
    {
        // o1, o3 reasoning models: 200K context, 100K output
        if model_lower.contains("o3") || model_lower.contains("o1") {
            return (200000, 100000);
        } else if model_lower.contains("gpt-5") || model_lower.contains("gpt5") {
            // GPT-5.4/5.5 series: 400K context, varying output
            if model_lower.contains("5.4-nano") || model_lower.contains("5-nano") {
                // GPT-5.4 nano / GPT-5 nano: smallest, cheapest
                if source == "copilot" {
                    return (128000, 16384);
                } else {
                    return (400000, 16384);
                }
            } else if model_lower.contains("5.4-mini") {
                // GPT-5.4 mini: fast coding model
                if source == "copilot" {
                    return (128000, 32768);
                } else {
                    return (400000, 32768);
                }
            } else if model_lower.contains("5.6-terra")
                || model_lower.contains("5.6-luna")
                || model_lower.contains("5.6-sol")
            {
                // CLIProxyAPI's GPT-5.6 variants expose a 372K context and 128K output.
                return (372000, 128000);
            } else if model_lower.contains("5.4") || model_lower.contains("5.5") {
                // GPT-5.4/5.5 full and fast aliases: 400K context, 128K output
                if source == "copilot" {
                    return (128000, 128000);
                } else {
                    return (400000, 128000);
                }
            }
            // GPT-5 / GPT-5.x base models
            if source == "copilot" {
                return (128000, 32768);
            } else {
                return (400000, 32768);
            }
        } else {
            // gpt-4o, gpt-4o-mini, gpt-4.1: 128K context, 16K output
            return (128000, 16384);
        }
    }

    // Qwen models
    if model_lower.contains("qwen") {
        // Qwen3 Coder Plus: 1M context
        if model_lower.contains("coder") {
            return (1000000, 65536);
        } else {
            // Qwen3 models: 262K context (max), 65K output
            return (262144, 65536);
        }
    }

    // DeepSeek models
    if model_lower.contains("deepseek") {
        // deepseek-reasoner: 128K output, deepseek-chat: 8K output
        if model_lower.contains("reasoner") || model_lower.contains("r1") {
            return (128000, 128000);
        } else {
            return (128000, 8192);
        }
    }

    // MiniMax models (via iFlow)
    if model_lower.contains("minimax") {
        return (1000000, 65536);
    }

    // GLM models (via iFlow)
    if model_lower.starts_with("glm-") {
        if model_lower.starts_with("glm-5") {
            // GLM-5: larger context and output
            return (128000, 131072);
        }
        return (128000, 16384);
    }

    // Kimi models (via iFlow)
    if model_lower.starts_with("kimi-") {
        if model_lower.contains("k2.5") {
            // Kimi K2.5: multimodal agentic model with larger output
            return (128000, 65536);
        }
        return (128000, 32768);
    }

    // iFlow-specific models (tstars, iflow-rome)
    if model_lower.starts_with("tstars") || model_lower.starts_with("iflow-") {
        return (128000, 16384);
    }

    // Fallback to owned_by for any remaining models
    match owned_by {
        "anthropic" => (200000, 64000),
        "google" => (1000000, 65536),
        "openai" => (128000, 16384),
        "qwen" => (262144, 65536),
        "deepseek" => (128000, 8192),
        "iflow" => (128000, 16384),
        _ => (128000, 16384), // safe defaults
    }
}

// Get display name for a model
pub(crate) fn get_model_display_name(model_id: &str, owned_by: &str, source: &str) -> String {
    // Convert model ID to human-readable name
    let base_name = model_id
        .replace("-", " ")
        .replace(".", " ")
        .split_whitespace()
        .map(|word| {
            let mut chars: Vec<char> = word.chars().collect();
            if !chars.is_empty() {
                chars[0] = chars[0].to_uppercase().next().unwrap_or(chars[0]);
            }
            chars.into_iter().collect::<String>()
        })
        .collect::<Vec<String>>()
        .join(" ");

    // Add provider prefix for clarity
    let name = match owned_by {
        "copilot" | "github-copilot" => format!("Copilot {}", base_name),
        "anthropic" => base_name.to_string(),
        "google" => base_name.to_string(),
        "openai" => base_name.to_string(),
        "qwen" => base_name.to_string(),
        _ => base_name,
    };

    // Add source indicator for Vertex AI and other special sources
    match source {
        "vertex" => format!("{} [Vertex]", name),
        "vertex+gemini-api" => format!("{} [Vertex+API]", name),
        "copilot" => format!("{} [Copilot]", name),
        _ => name,
    }
}

#[tauri::command]
pub async fn set_claude_code_model(model_type: String, model_name: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let config_dir = home.join(".claude");
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let config_path = config_dir.join("settings.json");

    // Read existing config or create new
    let mut json: serde_json::Value = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Ensure env object exists
    if json.get("env").is_none() {
        json["env"] = serde_json::json!({});
    }

    // Map model_type to env var name
    let env_key = match model_type.as_str() {
        "haiku" => "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "opus" => "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "sonnet" => "ANTHROPIC_DEFAULT_SONNET_MODEL",
        _ => return Err(format!("Unknown model type: {}", model_type)),
    };

    // Update the model
    if let Some(env) = json.get_mut("env").and_then(|e| e.as_object_mut()) {
        env.insert(env_key.to_string(), serde_json::Value::String(model_name));
    }

    // Write back
    let config_str = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, config_str).map_err(|e| e.to_string())?;

    Ok(())
}

/// Fetch static model definitions (display names, context length, modalities,
/// thinking support) for a channel from the CLIProxyAPI registry.
/// Channels: claude, gemini, vertex, aistudio, codex, kimi, antigravity, xai.
/// Returns an empty list when the proxy is not running.
#[tauri::command]
pub async fn get_model_definitions(
    state: State<'_, AppState>,
    channel: String,
) -> Result<Vec<ModelDefinition>, String> {
    let config = state.config.lock().unwrap().clone();
    let proxy_running = state.proxy_status.lock().unwrap().running;
    if !proxy_running {
        return Ok(vec![]);
    }

    let url = crate::get_management_url(config.port, &format!("model-definitions/{}", channel));
    let response = crate::build_management_client()
        .get(&url)
        .header("X-Management-Key", crate::get_management_key())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch model definitions: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Model definitions API returned status {}",
            response.status()
        ));
    }

    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse model definitions response: {}", e))?;

    let models = payload
        .get("models")
        .cloned()
        .unwrap_or_else(|| serde_json::Value::Array(Vec::new()));
    serde_json::from_value(models).map_err(|e| format!("Failed to parse model definitions: {}", e))
}

#[cfg(test)]
mod tests {
    use super::{get_model_limits, ModelDefinition};

    #[test]
    fn gpt_5_6_models_use_sidecar_limits() {
        for model in ["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol"] {
            assert_eq!(
                get_model_limits(model, "openai", "oauth"),
                (372_000, 128_000),
                "unexpected limits for {model}"
            );
        }
    }

    #[test]
    fn parses_model_definitions_payload() {
        // Fixture captured from the live 7.2.131 sidecar registry (claude channel)
        let json = r#"{"channel":"claude","models":[{"id":"claude-haiku-4-5-20251001","object":"model","created":1759276800,"owned_by":"anthropic","type":"claude","display_name":"Claude 4.5 Haiku","context_length":200000,"max_completion_tokens":64000,"supportedInputModalities":["text","image"],"supportedOutputModalities":["text"],"thinking":{"min":1024,"max":128000,"zero_allowed":true,"levels":["low","medium","high","max"]}}]}"#;
        let payload: serde_json::Value = serde_json::from_str(json).unwrap();
        let models: Vec<ModelDefinition> =
            serde_json::from_value(payload.get("models").unwrap().clone()).unwrap();

        assert_eq!(models.len(), 1);
        let m = &models[0];
        assert_eq!(m.id, "claude-haiku-4-5-20251001");
        assert_eq!(m.display_name.as_deref(), Some("Claude 4.5 Haiku"));
        assert_eq!(m.context_length, Some(200_000));
        assert_eq!(m.supported_input_modalities, vec!["text", "image"]);
        assert_eq!(m.supported_output_modalities, vec!["text"]);
        let thinking = m.thinking.as_ref().unwrap();
        assert_eq!(thinking.min, Some(1024));
        assert!(thinking.zero_allowed);
        assert_eq!(thinking.levels, vec!["low", "medium", "high", "max"]);
    }

    #[test]
    fn missing_optional_definition_fields_default() {
        let json = r#"{"models":[{"id":"grok-imagine-2","owned_by":"xai"}]}"#;
        let payload: serde_json::Value = serde_json::from_str(json).unwrap();
        let models: Vec<ModelDefinition> =
            serde_json::from_value(payload.get("models").unwrap().clone()).unwrap();

        let m = &models[0];
        assert_eq!(m.display_name, None);
        assert_eq!(m.context_length, None);
        assert!(m.supported_input_modalities.is_empty());
        assert!(m.thinking.is_none());
        assert!(!m.supports_web_search);
    }

    #[test]
    fn model_definitions_serialize_camel_case_for_frontend() {
        // The sidecar speaks snake_case; Tauri commands must speak camelCase
        // to match the TS ModelDefinition interface. Regression guard: the
        // frontend enrichment reads displayName/contextLength/etc.
        let json = r#"{"models":[{"id":"claude-haiku-4-5-20251001","owned_by":"anthropic","display_name":"Claude 4.5 Haiku","context_length":200000,"max_completion_tokens":64000,"supportedInputModalities":["text","image"],"supports_web_search":false,"thinking":{"min":1024,"max":128000,"zero_allowed":true,"levels":["low","high"]}}]}"#;
        let payload: serde_json::Value = serde_json::from_str(json).unwrap();
        let models: Vec<ModelDefinition> =
            serde_json::from_value(payload.get("models").unwrap().clone()).unwrap();
        let out = serde_json::to_value(&models[0]).unwrap();

        assert_eq!(out["displayName"], "Claude 4.5 Haiku");
        assert_eq!(out["contextLength"], 200_000);
        assert_eq!(out["maxCompletionTokens"], 64_000);
        assert_eq!(out["ownedBy"], "anthropic");
        assert_eq!(
            out["supportedInputModalities"],
            serde_json::json!(["text", "image"])
        );
        assert_eq!(out["supportsWebSearch"], false);
        assert_eq!(out["thinking"]["zeroAllowed"], true);
        assert!(
            out.get("display_name").is_none(),
            "snake_case key leaked to frontend"
        );
        assert!(
            out.get("context_length").is_none(),
            "snake_case key leaked to frontend"
        );
    }
}

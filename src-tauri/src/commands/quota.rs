//! Quota management - fetch quota/usage for all providers.

use tauri::{Emitter, State};
use crate::state::AppState;
use crate::types::{AuthStatus, ProviderTestResult};

// Helper function to refresh Antigravity OAuth token
async fn refresh_antigravity_token(client: &reqwest::Client, refresh_token: &str) -> Result<String, String> {
    let token_url = "https://oauth2.googleapis.com/token";
    
    // Antigravity OAuth credentials (from CLIProxyAPI)
    let client_id = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
    let client_secret = "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";
    
    let params = [
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];
    
    let response = client
        .post(token_url)
        .form(&params)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Token refresh failed ({}): {}", status, body));
    }
    
    let token_response: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;
    
    token_response
        .get("access_token")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "No access_token in refresh response".to_string())
}

// Fetch Antigravity quota for all authenticated accounts
#[tauri::command]
pub async fn fetch_antigravity_quota() -> Result<Vec<crate::types::AntigravityQuotaResult>, String> {
    use crate::types::{AntigravityQuotaResult, ModelQuota, AntigravityModelsResponse};
    
    let auth_dir = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".cli-proxy-api");
    
    if !auth_dir.exists() {
        return Ok(vec![]);
    }
    
    let mut results: Vec<AntigravityQuotaResult> = Vec::new();
    let client = reqwest::Client::new();
    
    // Scan for Antigravity auth files
    if let Ok(entries) = std::fs::read_dir(&auth_dir) {
        for entry in entries.flatten() {
            let filename = entry.file_name().to_string_lossy().to_lowercase();
            let file_path = entry.path();
            
            if filename.starts_with("antigravity-") && filename.ends_with(".json") {
                // Extract email from filename: antigravity-{email}.json
                let email = filename
                    .trim_start_matches("antigravity-")
                    .trim_end_matches(".json")
                    .to_string();
                
                // Read and parse auth file
                let content = match std::fs::read_to_string(&file_path) {
                    Ok(c) => c,
                    Err(e) => {
                        results.push(AntigravityQuotaResult {
                            account_email: email,
                            quotas: vec![],
                            fetched_at: chrono::Local::now().to_rfc3339(),
                            error: Some(format!("Failed to read auth file: {}", e)),
                        });
                        continue;
                    }
                };
                
                let mut auth_json: serde_json::Value = match serde_json::from_str(&content) {
                    Ok(v) => v,
                    Err(e) => {
                        results.push(AntigravityQuotaResult {
                            account_email: email,
                            quotas: vec![],
                            fetched_at: chrono::Local::now().to_rfc3339(),
                            error: Some(format!("Invalid JSON: {}", e)),
                        });
                        continue;
                    }
                };
                
                // Check if token is expired and refresh if needed
                let expired_str = auth_json.get("expired").and_then(|e| e.as_str());
                let refresh_token = auth_json.get("refresh_token").and_then(|r| r.as_str()).map(|s| s.to_string());
                
                let mut access_token = auth_json
                    .get("access_token")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string());
                
                // Check if token is expired
                let is_expired = if let Some(exp) = expired_str {
                    chrono::DateTime::parse_from_rfc3339(exp)
                        .map(|dt| dt < chrono::Local::now())
                        .unwrap_or(true)
                } else {
                    true // Assume expired if no expiry field
                };
                
                // Refresh token if expired
                if is_expired {
                    if let Some(ref rt) = refresh_token {
                        match refresh_antigravity_token(&client, rt).await {
                            Ok(new_token) => {
                                // Update auth file with new token
                                if let Some(obj) = auth_json.as_object_mut() {
                                    obj.insert("access_token".to_string(), serde_json::Value::String(new_token.clone()));
                                    // Update expiry (1 hour from now)
                                    let new_expiry = (chrono::Local::now() + chrono::Duration::hours(1)).to_rfc3339();
                                    obj.insert("expired".to_string(), serde_json::Value::String(new_expiry));
                                    
                                    // Save updated auth file
                                    if let Ok(updated_content) = serde_json::to_string(&auth_json) {
                                        let _ = std::fs::write(&file_path, updated_content);
                                    }
                                }
                                access_token = Some(new_token);
                            }
                            Err(e) => {
                                results.push(AntigravityQuotaResult {
                                    account_email: email,
                                    quotas: vec![],
                                    fetched_at: chrono::Local::now().to_rfc3339(),
                                    error: Some(format!("Token refresh failed: {}", e)),
                                });
                                continue;
                            }
                        }
                    } else {
                        results.push(AntigravityQuotaResult {
                            account_email: email,
                            quotas: vec![],
                            fetched_at: chrono::Local::now().to_rfc3339(),
                            error: Some("Token expired and no refresh_token available".to_string()),
                        });
                        continue;
                    }
                }
                
                let access_token = match access_token {
                    Some(t) => t,
                    None => {
                        results.push(AntigravityQuotaResult {
                            account_email: email,
                            quotas: vec![],
                            fetched_at: chrono::Local::now().to_rfc3339(),
                            error: Some("No access_token found in auth file".to_string()),
                        });
                        continue;
                    }
                };

                let project_id = match auth_json.get("project_id").and_then(|p| p.as_str()) {
                    Some(p) => p.to_string(),
                    None => {
                        results.push(AntigravityQuotaResult {
                            account_email: email,
                            quotas: vec![],
                            fetched_at: chrono::Local::now().to_rfc3339(),
                            error: Some("No project_id found in auth file".to_string()),
                        });
                        continue;
                    }
                };
                
                // Fetch quota from Google API - try multiple endpoints with fallback
                let base_urls = [
                    "https://daily-cloudcode-pa.googleapis.com",
                    "https://daily-cloudcode-pa.sandbox.googleapis.com",
                    "https://cloudcode-pa.googleapis.com",
                ];
                
                let mut last_error: Option<String> = None;
                let mut quotas_result: Option<Vec<ModelQuota>> = None;
                
                'url_loop: for base_url in base_urls {
                    let api_url = format!("{}/v1internal:fetchAvailableModels", base_url);
                    let response = client
                        .post(&api_url)
                        .header("Authorization", format!("Bearer {}", access_token))
                        .header("Content-Type", "application/json")
                        .header("User-Agent", "antigravity/1.104.0 darwin/arm64")
                        .body(format!("{{\"project\": \"{}\"}}", project_id))
                        .timeout(std::time::Duration::from_secs(10))
                        .send()
                        .await;
                
                    match response {
                        Ok(resp) => {
                            if resp.status() == 403 {
                                last_error = Some("Account forbidden (possibly banned or token expired)".to_string());
                                break 'url_loop; // Don't retry on 403
                            }
                            
                            if resp.status() == 404 {
                                last_error = Some(format!("API error: {} (trying next endpoint)", resp.status()));
                                continue 'url_loop; // Try next URL
                            }
                            
                            if !resp.status().is_success() {
                                last_error = Some(format!("API error: {}", resp.status()));
                                continue 'url_loop; // Try next URL
                            }
                            
                            let body: AntigravityModelsResponse = match resp.json().await {
                                Ok(b) => b,
                                Err(e) => {
                                    last_error = Some(format!("Failed to parse response: {}", e));
                                    continue 'url_loop;
                                }
                            };
                            
                            // Parse models and extract quota info (HashMap format)
                            let mut quotas: Vec<ModelQuota> = Vec::new();
                            
                             if let Some(models) = body.models {
                                 for (model_name, model_info) in models {
                                     if let Some(quota_info) = model_info.quota_info {
                                         // Include all models with quota_info, defaulting to 0% for those without remaining_fraction
                                         let remaining_percent = quota_info.remaining_fraction
                                             .map(|r| r * 100.0)
                                             .unwrap_or(0.0);

                                          // Map model names to display names
                                          let display_name = match model_name.as_str() {
                                              "gemini-2.5-pro" => "Gemini 2.5 Pro",
                                              "gemini-2.5-flash" => "Gemini 2.5 Flash",
                                              "gemini-2.0-flash" => "Gemini 2.0 Flash",
                                              "gemini-2.0-flash-lite" => "Gemini 2.0 Flash Lite",
                                              "gemini-exp-1206" => "Gemini Exp",
                                              // Gemini 3.x models (from Antigravity API)
                                              "gemini-3-pro-high" | "3-pro-high" => "Gemini 3 Pro High",
                                              "gemini-3-pro-low" | "3-pro-low" => "Gemini 3 Pro Low",
                                              "gemini-3-flash" | "3-flash" => "Gemini 3 Flash",
                                              "gemini-3-pro-image" => "Gemini 3 Pro Image",
                                              // Gemini 3.x models (from Google/Vertex API)
                                              "gemini-3-pro-preview" => "Gemini 3 Pro",
                                              "gemini-3-flash-preview" => "Gemini 3 Flash",
                                              "gemini-3.1-pro-high" => "Gemini 3.1 Pro High",
                                              "gemini-3.1-pro-low" => "Gemini 3.1 Pro Low",
                                              // Claude models via Antigravity
                                              "claude-sonnet-4-5" | "claude-sonnet-4-5-thinking" => "Claude Sonnet 4.5",
                                              "claude-opus-4-5" | "claude-opus-4-5-thinking" => "Claude Opus 4.5",
                                              "claude-haiku-4-5" => "Claude Haiku 4.5",
                                              "claude-4-6-sonnet" | "claude-sonnet-4-6" => "Claude Sonnet 4.6",
                                               "claude-4-6-opus" | "claude-opus-4-6" | "claude-opus-4-6-thinking" => "Claude Opus 4.6",
                                              // Imagen
                                              "imagen-3.0-generate-002" | "imagen-3" => "Imagen 3",
                                              // Chat models
                                              "chat_20706" => "Chat 20706",
                                              "chat_23310" => "Chat 23310",
                                              _ => &model_name,
                                          }.to_string();

                                         quotas.push(ModelQuota {
                                             model: model_name,
                                             display_name,
                                             remaining_percent,
                                             reset_time: quota_info.reset_time,
                                         });
                                     }
                                 }
                             }
                            
                            // Sort by model name for consistent display
                            quotas.sort_by(|a, b| a.display_name.cmp(&b.display_name));
                            quotas_result = Some(quotas);
                            break 'url_loop; // Success, stop trying
                        }
                        Err(e) => {
                            last_error = Some(format!("Network error: {}", e));
                            continue 'url_loop; // Try next URL
                        }
                    }
                }
                
                // Push result based on whether we succeeded
                if let Some(quotas) = quotas_result {
                    results.push(AntigravityQuotaResult {
                        account_email: email,
                        quotas,
                        fetched_at: chrono::Local::now().to_rfc3339(),
                        error: None,
                    });
                } else {
                    results.push(AntigravityQuotaResult {
                        account_email: email,
                        quotas: vec![],
                        fetched_at: chrono::Local::now().to_rfc3339(),
                        error: last_error.or(Some("All API endpoints failed".to_string())),
                    });
                }
            }
        }
    }
    
    Ok(results)
}

// Helper: HTTP GET with retry and exponential backoff
// Retries on: timeout, connection errors, 5xx, 429
// Does NOT retry on: client errors (4xx except 429)
async fn fetch_with_retry(
    client: &reqwest::Client,
    url: &str,
    headers: Vec<(&str, String)>,
    max_retries: u32,
) -> Result<reqwest::Response, String> {
    let mut last_err = String::new();
    for attempt in 0..=max_retries {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(500 * (1 << (attempt - 1)))).await;
        }
        let mut req = client.get(url);
        for (key, value) in &headers {
            req = req.header(*key, value.as_str());
        }
        match req.send().await {
            Ok(resp) if resp.status().is_server_error() || resp.status().as_u16() == 429 => {
                last_err = format!("Server error: {}", resp.status());
                continue;
            }
            Ok(resp) => return Ok(resp),
            Err(e) if e.is_timeout() || e.is_connect() => {
                last_err = format!("{}", e);
                continue;
            }
            Err(e) => return Err(format!("{}", e)),
        }
    }
    Err(format!("All {} attempts failed, last error: {}", max_retries + 1, last_err))
}

// Fetch Codex/ChatGPT quota and usage for all authenticated accounts
// Uses the ChatGPT internal API: https://chatgpt.com/backend-api/wham/usage
#[tauri::command]
pub async fn fetch_codex_quota() -> Result<Vec<crate::types::CodexQuotaResult>, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let auth_dir = home.join(".cli-proxy-api");
    
    if !auth_dir.exists() {
        return Ok(vec![]);
    }
    
    // Find all codex-*.json files
    let entries = std::fs::read_dir(&auth_dir)
        .map_err(|e| format!("Failed to read auth directory: {}", e))?;
    
    // Phase 1: Collect credentials (sequential, fast I/O)
    struct CodexCred {
        email: String,
        access_token: String,
        account_id: Option<String>,
    }
    let mut credentials: Vec<CodexCred> = Vec::new();
    let mut error_results: Vec<crate::types::CodexQuotaResult> = Vec::new();
    
    for entry in entries.flatten() {
        let filename = entry.file_name().to_string_lossy().to_string();
        if filename.starts_with("codex-") && filename.ends_with(".json") {
            let file_path = entry.path();
            
            let content = match std::fs::read_to_string(&file_path) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Failed to read codex credential file: {}", e);
                    continue;
                }
            };
            
            let cred: serde_json::Value = match serde_json::from_str(&content) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("Failed to parse codex credential file: {}", e);
                    continue;
                }
            };
            
            let email = cred["email"].as_str().unwrap_or("unknown").to_string();
            match cred["access_token"].as_str() {
                Some(t) => {
                    credentials.push(CodexCred {
                        email,
                        access_token: t.to_string(),
                        account_id: cred["account_id"].as_str().map(|s| s.to_string()),
                    });
                }
                None => {
                    error_results.push(crate::types::CodexQuotaResult {
                        account_email: email,
                        plan_type: "unknown".to_string(),
                        primary_used_percent: 0.0,
                        primary_reset_at: None,
                        secondary_used_percent: 0.0,
                        secondary_reset_at: None,
                        has_credits: false,
                        credits_balance: None,
                        credits_unlimited: false,
                        fetched_at: chrono::Local::now().to_rfc3339(),
                        error: Some("No access token found".to_string()),
                    });
                }
            };
        }
    }
    
    // Phase 2: Fetch quotas in parallel with timeout
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default();
    
    let mut handles = Vec::new();
    for cred in credentials {
        let client = client.clone();
        handles.push(tokio::spawn(async move {
            let url = "https://chatgpt.com/backend-api/wham/usage";
            
            let mut headers = vec![
                ("Authorization", format!("Bearer {}", cred.access_token)),
                ("Accept", "application/json".to_string()),
                ("User-Agent", "ProxyPal".to_string()),
            ];
            if let Some(acct_id) = &cred.account_id {
                headers.push(("ChatGPT-Account-Id", acct_id.clone()));
            }
            
            let response = fetch_with_retry(&client, url, headers, 2).await;
            
            match response {
                Ok(resp) => {
                    if resp.status().is_success() {
                        let body: serde_json::Value = resp.json().await.unwrap_or_default();
                        
                        let plan_type = body["plan_type"].as_str().unwrap_or("unknown").to_string();
                        
                        let rate_limit = &body["rate_limit"];
                        let primary = &rate_limit["primary_window"];
                        let secondary = &rate_limit["secondary_window"];
                        
                        let primary_used_percent = primary["used_percent"].as_f64().unwrap_or(0.0);
                        let primary_reset_at = primary["reset_at"].as_i64();
                        let secondary_used_percent = secondary["used_percent"].as_f64().unwrap_or(0.0);
                        let secondary_reset_at = secondary["reset_at"].as_i64();
                        
                        let credits = &body["credits"];
                        let has_credits = credits["has_credits"].as_bool().unwrap_or(false);
                        let credits_balance = credits["balance"].as_f64();
                        let credits_unlimited = credits["unlimited"].as_bool().unwrap_or(false);
                        
                        crate::types::CodexQuotaResult {
                            account_email: cred.email,
                            plan_type,
                            primary_used_percent,
                            primary_reset_at,
                            secondary_used_percent,
                            secondary_reset_at,
                            has_credits,
                            credits_balance,
                            credits_unlimited,
                            fetched_at: chrono::Local::now().to_rfc3339(),
                            error: None,
                        }
                    } else {
                        let status = resp.status();
                        let error_body = resp.text().await.unwrap_or_default();
                        crate::types::CodexQuotaResult {
                            account_email: cred.email,
                            plan_type: "unknown".to_string(),
                            primary_used_percent: 0.0,
                            primary_reset_at: None,
                            secondary_used_percent: 0.0,
                            secondary_reset_at: None,
                            has_credits: false,
                            credits_balance: None,
                            credits_unlimited: false,
                            fetched_at: chrono::Local::now().to_rfc3339(),
                            error: Some(format!("API error {}: {}", status, error_body)),
                        }
                    }
                }
                Err(e) => {
                    crate::types::CodexQuotaResult {
                        account_email: cred.email,
                        plan_type: "unknown".to_string(),
                        primary_used_percent: 0.0,
                        primary_reset_at: None,
                        secondary_used_percent: 0.0,
                        secondary_reset_at: None,
                        has_credits: false,
                        credits_balance: None,
                        credits_unlimited: false,
                        fetched_at: chrono::Local::now().to_rfc3339(),
                        error: Some(format!("Request failed: {}", e)),
                    }
                }
            }
        }));
    }
    
    // Phase 3: Collect results
    let mut results = error_results;
    for handle in handles {
        match handle.await {
            Ok(result) => results.push(result),
            Err(e) => eprintln!("Codex quota task panicked: {}", e),
        }
    }
    
    Ok(results)
}

// Fetch Copilot/GitHub quota for all authenticated accounts
// Uses the GitHub internal API: https://api.github.com/copilot_internal/user
// Supports credentials from:
// - copilot-api: ~/.local/share/copilot-api/github_token (plain text)
// - cli-proxy-api: ~/.cli-proxy-api/copilot-*.json
#[tauri::command]
pub async fn fetch_copilot_quota() -> Result<Vec<crate::types::CopilotQuotaResult>, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    
    // Phase 1: Collect all tokens (sequential, fast I/O)
    struct CopilotCred {
        token: String,
        login: String,
    }
    let mut credentials: Vec<CopilotCred> = Vec::new();
    let mut error_results: Vec<crate::types::CopilotQuotaResult> = Vec::new();
    
    // Check for copilot-api token (plain text file)
    let copilot_api_token_path = home.join(".local/share/copilot-api/github_token");
    if copilot_api_token_path.exists() {
        match std::fs::read_to_string(&copilot_api_token_path) {
            Ok(t) => {
                let token = t.trim().to_string();
                if !token.is_empty() {
                    credentials.push(CopilotCred { token, login: "copilot-api".to_string() });
                }
            }
            Err(e) => {
                error_results.push(crate::types::CopilotQuotaResult {
                    account_login: "copilot-api".to_string(),
                    plan: "unknown".to_string(),
                    premium_interactions_percent: 0.0,
                    chat_percent: 0.0,
                    fetched_at: chrono::Local::now().to_rfc3339(),
                    error: Some(format!("Failed to read token: {}", e)),
                });
            }
        }
    }
    
    // Check for cli-proxy-api copilot credentials
    let auth_dir = home.join(".cli-proxy-api");
    if auth_dir.exists() {
        let entries = std::fs::read_dir(&auth_dir)
            .map_err(|e| format!("Failed to read auth directory: {}", e))?;
        
        for entry in entries.flatten() {
            let filename = entry.file_name().to_string_lossy().to_string();
            if filename.starts_with("copilot-") && filename.ends_with(".json") {
                let file_path = entry.path();
                
                let content = match std::fs::read_to_string(&file_path) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                
                let cred: serde_json::Value = match serde_json::from_str(&content) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                
                let login = cred["login"].as_str()
                    .or_else(|| cred["user"].as_str())
                    .unwrap_or("unknown").to_string();
                
                if let Some(token) = cred["access_token"].as_str()
                    .or_else(|| cred["token"].as_str()) {
                    credentials.push(CopilotCred { token: token.to_string(), login });
                }
            }
        }
    }
    
    // Phase 2: Fetch all quotas in parallel
    let mut handles = Vec::new();
    for cred in credentials {
        handles.push(tokio::spawn(async move {
            fetch_copilot_quota_with_token(&cred.token, &cred.login).await
        }));
    }
    
    // Phase 3: Collect results
    let mut results = error_results;
    for handle in handles {
        match handle.await {
            Ok(result) => results.push(result),
            Err(e) => eprintln!("Copilot quota task panicked: {}", e),
        }
    }
    
    Ok(results)
}

// Helper function to fetch Copilot quota with a given token
async fn fetch_copilot_quota_with_token(token: &str, login: &str) -> crate::types::CopilotQuotaResult {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default();
    let url = "https://api.github.com/copilot_internal/user";
    
    let headers = vec![
        ("Authorization", format!("token {}", token)),
        ("Accept", "application/json".to_string()),
        ("User-Agent", "ProxyPal/1.0".to_string()),
        ("Editor-Version", "vscode/1.91.1".to_string()),
        ("Editor-Plugin-Version", "copilot-chat/0.26.7".to_string()),
        ("X-Github-Api-Version", "2025-04-01".to_string()),
    ];
    
    let response = fetch_with_retry(&client, url, headers, 2).await;
    
    match response {
        Ok(resp) => {
            if resp.status().is_success() {
                let body: serde_json::Value = resp.json().await.unwrap_or_default();
                
                // Parse the Copilot user response
                // Expected format from copilot-api:
                // {
                //   "copilot_plan": "individual",
                //   "quota_snapshots": {
                //     "premium_interactions": { "percent_remaining": 90.0 },
                //     "chat": { "percent_remaining": 100.0, "unlimited": true }
                //   }
                // }
                
                let plan = body["copilot_plan"].as_str()
                    .or_else(|| body["copilotPlan"].as_str())
                    .unwrap_or("unknown").to_string();
                
                let quota_snapshots = body.get("quota_snapshots")
                    .or_else(|| body.get("quotaSnapshots"));
                
                let (premium_percent, chat_percent) = if let Some(snapshots) = quota_snapshots {
                    let premium = snapshots.get("premium_interactions")
                        .or_else(|| snapshots.get("premiumInteractions"));
                    let chat = snapshots.get("chat");
                    
                    let premium_pct = premium
                        .and_then(|p| p.get("percent_remaining").or_else(|| p.get("percentRemaining")))
                        .and_then(|v| v.as_f64())
                        .unwrap_or(100.0);
                    
                    let chat_pct = chat
                        .and_then(|c| c.get("percent_remaining").or_else(|| c.get("percentRemaining")))
                        .and_then(|v| v.as_f64())
                        .unwrap_or(100.0);
                    
                    (premium_pct, chat_pct)
                } else {
                    (100.0, 100.0)
                };
                
                crate::types::CopilotQuotaResult {
                    account_login: login.to_string(),
                    plan,
                    premium_interactions_percent: premium_percent,
                    chat_percent,
                    fetched_at: chrono::Local::now().to_rfc3339(),
                    error: None,
                }
            } else {
                let status = resp.status();
                let error_body = resp.text().await.unwrap_or_default();
                crate::types::CopilotQuotaResult {
                    account_login: login.to_string(),
                    plan: "unknown".to_string(),
                    premium_interactions_percent: 0.0,
                    chat_percent: 0.0,
                    fetched_at: chrono::Local::now().to_rfc3339(),
                    error: Some(format!("API error {}: {}", status, error_body)),
                }
            }
        }
        Err(e) => {
            crate::types::CopilotQuotaResult {
                account_login: login.to_string(),
                plan: "unknown".to_string(),
                premium_interactions_percent: 0.0,
                chat_percent: 0.0,
                fetched_at: chrono::Local::now().to_rfc3339(),
                error: Some(format!("Request failed: {}", e)),
            }
        }
    }
}

#[tauri::command]
pub async fn fetch_kiro_quota() -> Result<Vec<crate::types::quota::KiroQuotaResult>, String> {
    use std::process::Command;
    use std::path::PathBuf;
    use regex::Regex;

    // Find kiro-cli binary - GUI apps don't inherit user's shell PATH
    // So we check common installation locations
    fn find_kiro_cli() -> Option<PathBuf> {
        let candidates: Vec<PathBuf> = vec![
            // User's local bin (most common for kiro-cli)
            dirs::home_dir().map(|h| h.join(".local/bin/kiro-cli")),
            // Homebrew paths
            Some(PathBuf::from("/opt/homebrew/bin/kiro-cli")),
            Some(PathBuf::from("/usr/local/bin/kiro-cli")),
            // System paths
            Some(PathBuf::from("/usr/bin/kiro-cli")),
        ].into_iter().flatten().collect();

        for path in candidates {
            if path.exists() {
                return Some(path);
            }
        }
        
        // Fallback: try PATH (works if launched from terminal)
        if let Ok(output) = Command::new("which").arg("kiro-cli").output() {
            if output.status.success() {
                let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path_str.is_empty() {
                    return Some(PathBuf::from(path_str));
                }
            }
        }
        
        None
    }

    let kiro_cli_path = match find_kiro_cli() {
        Some(path) => path,
        None => {
            // CLI not installed
            return Ok(vec![crate::types::quota::KiroQuotaResult {
                account_email: "Kiro Subscription".to_string(),
                plan: "CLI Not Found".to_string(),
                total_credits: 0.0,
                used_credits: 0.0,
                used_percent: 0.0,
                bonus_credits_used: 0.0,
                bonus_credits_total: 0.0,
                bonus_credits_expires_days: None,
                resets_on: None,
                fetched_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                error: Some("kiro-cli not found. Install it to enable quota tracking.".to_string()),
            }]);
        }
    };

    // Run kiro-cli chat --no-interactive "/usage"
    let output = Command::new(&kiro_cli_path)
        .args(&["chat", "--no-interactive", "/usage"])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            // kiro-cli writes output to stderr, not stdout
            let output_text = String::from_utf8_lossy(&out.stderr);
            // Strip ANSI escape sequences (colors, etc)
            let re_ansi = Regex::new(r"\x1B\[[0-9;]*[mK]").unwrap();
            let clean_text = re_ansi.replace_all(&output_text, "");

            let mut result = crate::types::quota::KiroQuotaResult {
                account_email: "Kiro Account".to_string(),
                plan: "Unknown".to_string(),
                total_credits: 0.0,
                used_credits: 0.0,
                used_percent: 0.0,
                bonus_credits_used: 0.0,
                bonus_credits_total: 0.0,
                bonus_credits_expires_days: None,
                resets_on: None,
                fetched_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                error: None,
            };

            // Parse Plan: Look for KIRO FREE or KIRO PRO anywhere in the text
            let re_plan = Regex::new(r"KIRO\s+(FREE|PRO|ENTERPRISE)").unwrap();
            if let Some(cap) = re_plan.captures(&clean_text) {
                result.plan = format!("KIRO {}", &cap[1]);
            }

            // Parse Credits: (12.50 of 50 covered in plan)
            let re_credits = Regex::new(r"\((\d+\.?\d*)\s+of\s+(\d+)\s+covered").unwrap();
            if let Some(cap) = re_credits.captures(&clean_text) {
                let used: f64 = cap[1].parse().unwrap_or(0.0);
                let total: f64 = cap[2].parse().unwrap_or(0.0);
                result.used_credits = used;
                result.total_credits = total;
                if total > 0.0 {
                    result.used_percent = (used / total) * 100.0;
                }
            }

            // Parse bonus credits
            let re_bonus = Regex::new(r"Bonus credits:\s*(\d+\.?\d*)/(\d+)").unwrap();
            if let Some(cap) = re_bonus.captures(&clean_text) {
                result.bonus_credits_used = cap[1].parse().unwrap_or(0.0);
                result.bonus_credits_total = cap[2].parse().unwrap_or(0.0);
            }

            // Parse bonus credits expiration: "expires in 22 days"
            let re_bonus_expires = Regex::new(r"expires in (\d+) days").unwrap();
            if let Some(cap) = re_bonus_expires.captures(&clean_text) {
                result.bonus_credits_expires_days = cap[1].parse().ok();
            }

            // Parse reset date: "resets on 03/01"
            let re_resets_on = Regex::new(r"resets on (\d{2}/\d{2})").unwrap();
            if let Some(cap) = re_resets_on.captures(&clean_text) {
                result.resets_on = Some(cap[1].to_string());
            }

            Ok(vec![result])
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            Ok(vec![crate::types::quota::KiroQuotaResult {
                account_email: "Kiro Subscription".to_string(),
                plan: "Error".to_string(),
                total_credits: 0.0,
                used_credits: 0.0,
                used_percent: 0.0,
                bonus_credits_used: 0.0,
                bonus_credits_total: 0.0,
                bonus_credits_expires_days: None,
                resets_on: None,
                fetched_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                error: Some(format!("kiro-cli failed: {}", stderr)),
            }])
        }
        Err(e) => {
            // Execution error (permission denied, etc.)
            Ok(vec![crate::types::quota::KiroQuotaResult {
                account_email: "Kiro Subscription".to_string(),
                plan: "Error".to_string(),
                total_credits: 0.0,
                used_credits: 0.0,
                used_percent: 0.0,
                bonus_credits_used: 0.0,
                bonus_credits_total: 0.0,
                bonus_credits_expires_days: None,
                resets_on: None,
                fetched_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                error: Some(format!("Failed to run kiro-cli: {}", e)),
            }])
        }
    }
}

// Fetch Claude/Anthropic quota for all authenticated accounts
// Uses the Anthropic OAuth API: https://api.anthropic.com/api/oauth/usage

#[tauri::command]
pub async fn fetch_claude_quota() -> Result<Vec<crate::types::quota::ClaudeQuotaResult>, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    
    let mut results: Vec<crate::types::ClaudeQuotaResult> = Vec::new();
    
    // Check for Claude credentials in ~/.claude/.credentials.json
    let claude_creds_path = home.join(".claude").join(".credentials.json");
    
    if claude_creds_path.exists() {
        let content = match std::fs::read_to_string(&claude_creds_path) {
            Ok(c) => c,
            Err(e) => {
                return Ok(vec![crate::types::ClaudeQuotaResult {
                    account_email: "unknown".to_string(),
                    plan: "unknown".to_string(),
                    five_hour_percent: 0.0,
                    five_hour_reset_at: None,
                    seven_day_percent: 0.0,
                    seven_day_reset_at: None,
                    extra_usage_spend: None,
                    extra_usage_limit: None,
                    fetched_at: chrono::Local::now().to_rfc3339(),
                    error: Some(format!("Failed to read credentials: {}", e)),
                }]);
            }
        };
        
        let cred: serde_json::Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(e) => {
                return Ok(vec![crate::types::ClaudeQuotaResult {
                    account_email: "unknown".to_string(),
                    plan: "unknown".to_string(),
                    five_hour_percent: 0.0,
                    five_hour_reset_at: None,
                    seven_day_percent: 0.0,
                    seven_day_reset_at: None,
                    extra_usage_spend: None,
                    extra_usage_limit: None,
                    fetched_at: chrono::Local::now().to_rfc3339(),
                    error: Some(format!("Failed to parse credentials: {}", e)),
                }]);
            }
        };
        
        let email = cred["email"].as_str()
            .or_else(|| cred["accountEmail"].as_str())
            .unwrap_or("unknown").to_string();
        
        let access_token = match cred["accessToken"].as_str()
            .or_else(|| cred["access_token"].as_str()) {
            Some(t) => t,
            None => {
                return Ok(vec![crate::types::ClaudeQuotaResult {
                    account_email: email,
                    plan: "unknown".to_string(),
                    five_hour_percent: 0.0,
                    five_hour_reset_at: None,
                    seven_day_percent: 0.0,
                    seven_day_reset_at: None,
                    extra_usage_spend: None,
                    extra_usage_limit: None,
                    fetched_at: chrono::Local::now().to_rfc3339(),
                    error: Some("No access token found".to_string()),
                }]);
            }
        };
        
        // Fetch usage from Anthropic OAuth API
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap_or_default();
        let url = "https://api.anthropic.com/api/oauth/usage";
        
        let headers = vec![
            ("Authorization", format!("Bearer {}", access_token)),
            ("Accept", "application/json".to_string()),
            ("User-Agent", "ProxyPal/1.0".to_string()),
            ("anthropic-beta", "oauth-2025-04-20".to_string()),
        ];
        
        let response = fetch_with_retry(&client, url, headers, 2).await;
        
        match response {
            Ok(resp) => {
                if resp.status().is_success() {
                    let body: serde_json::Value = resp.json().await.unwrap_or_default();
                    
                    // Parse the Claude usage response
                    // Expected format:
                    // {
                    //   "rate_limit_tier": "pro",
                    //   "five_hour": { "used": 34, "limit": 100, "reset_at": 1737561600 },
                    //   "seven_day": { "used": 12, "limit": 100, "reset_at": 1738166400 },
                    //   "extra_usage": { "spend": 5.0, "limit": 200.0 }
                    // }
                    
                    let plan = body["rate_limit_tier"].as_str()
                        .or_else(|| body["plan"].as_str())
                        .unwrap_or("unknown").to_string();
                    
                    let five_hour = &body["five_hour"];
                    let seven_day = &body["seven_day"];
                    let extra_usage = &body["extra_usage"];
                    
                    // Calculate percent used
                    let five_hour_used = five_hour["used"].as_f64().unwrap_or(0.0);
                    let five_hour_limit = five_hour["limit"].as_f64().unwrap_or(100.0);
                    let five_hour_percent = if five_hour_limit > 0.0 {
                        (five_hour_used / five_hour_limit) * 100.0
                    } else {
                        0.0
                    };
                    let five_hour_reset_at = five_hour["reset_at"].as_i64();
                    
                    let seven_day_used = seven_day["used"].as_f64().unwrap_or(0.0);
                    let seven_day_limit = seven_day["limit"].as_f64().unwrap_or(100.0);
                    let seven_day_percent = if seven_day_limit > 0.0 {
                        (seven_day_used / seven_day_limit) * 100.0
                    } else {
                        0.0
                    };
                    let seven_day_reset_at = seven_day["reset_at"].as_i64();
                    
                    let extra_usage_spend = extra_usage["spend"].as_f64();
                    let extra_usage_limit = extra_usage["limit"].as_f64();
                    
                    results.push(crate::types::ClaudeQuotaResult {
                        account_email: email,
                        plan,
                        five_hour_percent,
                        five_hour_reset_at,
                        seven_day_percent,
                        seven_day_reset_at,
                        extra_usage_spend,
                        extra_usage_limit,
                        fetched_at: chrono::Local::now().to_rfc3339(),
                        error: None,
                    });
                } else {
                    let status = resp.status();
                    let error_body = resp.text().await.unwrap_or_default();
                    results.push(crate::types::ClaudeQuotaResult {
                        account_email: email,
                        plan: "unknown".to_string(),
                        five_hour_percent: 0.0,
                        five_hour_reset_at: None,
                        seven_day_percent: 0.0,
                        seven_day_reset_at: None,
                        extra_usage_spend: None,
                        extra_usage_limit: None,
                        fetched_at: chrono::Local::now().to_rfc3339(),
                        error: Some(format!("API error {}: {}", status, error_body)),
                    });
                }
            }
            Err(e) => {
                results.push(crate::types::ClaudeQuotaResult {
                    account_email: email,
                    plan: "unknown".to_string(),
                    five_hour_percent: 0.0,
                    five_hour_reset_at: None,
                    seven_day_percent: 0.0,
                    seven_day_reset_at: None,
                    extra_usage_spend: None,
                    extra_usage_limit: None,
                    fetched_at: chrono::Local::now().to_rfc3339(),
                    error: Some(format!("Request failed: {}", e)),
                });
            }
        }
    }
    
    Ok(results)
}

// Import Vertex service account credential (JSON file)
#[tauri::command]
pub async fn import_vertex_credential(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    file_path: String,
) -> Result<AuthStatus, String> {
    // Read the service account JSON file
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    
    // Parse to validate it's valid JSON with required fields
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    
    // Check for required service account fields
    let project_id = json["project_id"]
        .as_str()
        .ok_or("Missing 'project_id' field in service account JSON")?;
    
    if json["type"].as_str() != Some("service_account") {
        return Err("Invalid service account: 'type' must be 'service_account'".to_string());
    }
    
    // Copy to CLIProxyAPI auth directory
    let auth_dir = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".cli-proxy-api");
    
    std::fs::create_dir_all(&auth_dir).map_err(|e| e.to_string())?;
    
    let dest_path = auth_dir.join(format!("vertex-{}.json", project_id));
    std::fs::write(&dest_path, &content)
        .map_err(|e| format!("Failed to save credential: {}", e))?;
    
    // Update auth status (increment count)
    let mut auth = state.auth_status.lock().unwrap();
    auth.vertex += 1;
    
    // Save to file
    crate::save_auth_to_file(&auth)?;
    
    // Emit auth status update
    let _ = app.emit("auth-status-changed", auth.clone());
    
    Ok(auth.clone())
}

/// Test Kiro connection by delegating to `fetch_kiro_quota`.
/// This runs `kiro-cli chat --no-interactive "/usage"` and interprets the result
/// as a simple success/failure signal for the UI.
#[tauri::command]
pub async fn test_kiro_connection() -> Result<ProviderTestResult, String> {
    let start = std::time::Instant::now();
    let quota_result = fetch_kiro_quota().await;
    let latency = start.elapsed().as_millis() as u64;

    match quota_result {
        Ok(results) => {
            if results.is_empty() {
                return Ok(ProviderTestResult {
                    success: false,
                    message: "No response from kiro-cli /usage".to_string(),
                    latency_ms: Some(latency),
                    models_found: None,
                });
            }

            let first = &results[0];

            if let Some(err) = &first.error {
                Ok(ProviderTestResult {
                    success: false,
                    message: format!("kiro-cli error: {}", err),
                    latency_ms: Some(latency),
                    models_found: None,
                })
            } else {
                Ok(ProviderTestResult {
                    success: true,
                    message: format!("Kiro CLI reachable. Plan: {}", first.plan),
                    latency_ms: Some(latency),
                    models_found: None,
                })
            }
        }
        Err(e) => Ok(ProviderTestResult {
            success: false,
            message: format!("Failed to run kiro-cli: {}", e),
            latency_ms: Some(latency),
            models_found: None,
        }),
    }
}

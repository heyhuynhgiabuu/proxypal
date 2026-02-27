//! Provider health check commands.

use tauri::State;

use crate::state::AppState;
use crate::types::{ProviderHealth, HealthStatus};

#[tauri::command]
pub async fn check_provider_health(state: State<'_, AppState>) -> Result<ProviderHealth, String> {
    let (port, proxy_running, proxy_api_key) = {
        let config = state.config.lock().unwrap();
        let status = state.proxy_status.lock().unwrap();
        (config.port, status.running, config.proxy_api_key.clone())
    };
    
    let auth_status = state.auth_status.lock().unwrap().clone();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    
    // If proxy is not running, all providers are offline
    if !proxy_running {
        let offline_status = HealthStatus {
            status: "offline".to_string(),
            latency_ms: None,
            last_checked: now,
        };
        return Ok(ProviderHealth {
            claude: offline_status.clone(),
            openai: offline_status.clone(),
            gemini: offline_status.clone(),
            qwen: offline_status.clone(),
            iflow: offline_status.clone(),
            vertex: offline_status.clone(),
            kiro: offline_status.clone(),
            antigravity: offline_status,
        });
    }
    
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    
    // Check health for each provider based on auth status
    // Note: We use a single /v1/models call since the proxy handles routing
    // For now, if the proxy is responsive, all configured providers are healthy
    let models_url = format!("http://127.0.0.1:{}/v1/models", port);
    let start = std::time::Instant::now();
    let (proxy_healthy, latency) = match client
        .get(&models_url)
        .header("Authorization", format!("Bearer {}", proxy_api_key))
        .send()
        .await
    {
        Ok(response) => {
            let latency = start.elapsed().as_millis() as u64;
            (response.status().is_success(), Some(latency))
        }
        Err(_) => (false, None),
    };
    
    // Build health status for each provider
    let make_status = |is_configured: bool| -> HealthStatus {
        if !is_configured {
            HealthStatus {
                status: "unconfigured".to_string(),
                latency_ms: None,
                last_checked: now,
            }
        } else if !proxy_healthy {
            HealthStatus {
                status: "offline".to_string(),
                latency_ms: latency,
                last_checked: now,
            }
        } else {
            let is_degraded = latency.map(|l| l > 2000).unwrap_or(false);
            HealthStatus {
                status: if is_degraded { "degraded" } else { "healthy" }.to_string(),
                latency_ms: latency,
                last_checked: now,
            }
        }
    };
    
    Ok(ProviderHealth {
        claude: make_status(auth_status.claude > 0),
        openai: make_status(auth_status.openai > 0),
        gemini: make_status(auth_status.gemini > 0),
        qwen: make_status(auth_status.qwen > 0),
        iflow: make_status(auth_status.iflow > 0),
        vertex: make_status(auth_status.vertex > 0),
        kiro: make_status(auth_status.kiro > 0),
        antigravity: make_status(auth_status.antigravity > 0),
    })
}

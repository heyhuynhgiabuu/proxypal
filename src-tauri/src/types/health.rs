use serde::{Deserialize, Serialize};

// Provider health status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderHealth {
    pub claude: HealthStatus,
    pub openai: HealthStatus,
    pub gemini: HealthStatus,
    pub qwen: HealthStatus,
    pub iflow: HealthStatus,
    pub vertex: HealthStatus,
    pub antigravity: HealthStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    pub status: String,
    pub latency_ms: Option<u64>,
    pub last_checked: u64,
}

impl Default for HealthStatus {
    fn default() -> Self {
        Self {
            status: "unconfigured".to_string(),
            latency_ms: None,
            last_checked: 0,
        }
    }
}

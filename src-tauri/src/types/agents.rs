use serde::{Deserialize, Serialize};

// Detected AI coding tool
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedTool {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub config_path: Option<String>,
    pub can_auto_configure: bool,
}

// CLI Agent configuration status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    pub installed: bool,
    pub configured: bool,
    pub config_type: String,
    pub config_path: Option<String>,
    pub logo: String,
    pub docs_url: String,
}

// Test agent connection by making a simple API call through the proxy
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTestResult {
    pub success: bool,
    pub message: String,
    pub latency_ms: Option<u64>,
}

// Claude Code settings struct
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeSettings {
    pub haiku_model: Option<String>,
    pub opus_model: Option<String>,
    pub sonnet_model: Option<String>,
    pub base_url: Option<String>,
    pub auth_token: Option<String>,
}

use serde::{Deserialize, Serialize};

// Get available models from CLIProxyAPI /v1/models endpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModel {
    pub id: String,
    pub owned_by: String,
    /// Source of the model: "gemini-api", "vertex", "copilot", "api-key", "oauth", etc.
    /// Used to distinguish between different authentication sources for the same provider
    #[serde(default)]
    pub source: String,
}

// Test connection to a custom OpenAI-compatible provider
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResult {
    pub success: bool,
    pub message: String,
    pub latency_ms: Option<u64>,
    pub models_found: Option<u32>,
}

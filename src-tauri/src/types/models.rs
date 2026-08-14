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

// Models fetched from an OpenAI-compatible provider
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatibleProviderModels {
    pub provider_name: String,
    pub base_url: String,
    pub models: Vec<OpenAICompatibleModel>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatibleModel {
    pub id: String,
    #[serde(default)]
    pub owned_by: Option<String>,
    #[serde(default)]
    pub created: Option<i64>,
}

// Static model definitions from CLIProxyAPI /v0/management/model-definitions/:channel
// Wire format mixes snake_case (display_name, context_length) and camelCase
// (supportedInputModalities), so renames are explicit per field.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDefinition {
    pub id: String,
    #[serde(default)]
    pub object: String,
    #[serde(default)]
    pub created: i64,
    #[serde(default, rename(serialize = "ownedBy", deserialize = "owned_by"))]
    pub owned_by: String,
    #[serde(rename = "type", default)]
    pub model_type: String,
    #[serde(
        default,
        rename(serialize = "displayName", deserialize = "display_name")
    )]
    pub display_name: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(
        default,
        rename(serialize = "contextLength", deserialize = "context_length")
    )]
    pub context_length: Option<i64>,
    #[serde(
        default,
        rename(
            serialize = "maxCompletionTokens",
            deserialize = "max_completion_tokens"
        )
    )]
    pub max_completion_tokens: Option<i64>,
    #[serde(default, rename = "supportedInputModalities")]
    pub supported_input_modalities: Vec<String>,
    #[serde(default, rename = "supportedOutputModalities")]
    pub supported_output_modalities: Vec<String>,
    #[serde(
        default,
        rename(serialize = "supportsWebSearch", deserialize = "supports_web_search")
    )]
    pub supports_web_search: bool,
    #[serde(default)]
    pub thinking: Option<ThinkingDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThinkingDefinition {
    #[serde(default)]
    pub min: Option<i64>,
    #[serde(default)]
    pub max: Option<i64>,
    #[serde(
        default,
        rename(serialize = "zeroAllowed", deserialize = "zero_allowed")
    )]
    pub zero_allowed: bool,
    #[serde(default)]
    pub levels: Vec<String>,
}

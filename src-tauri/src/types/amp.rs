use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmpModelMapping {
    pub from: String,
    pub to: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AmpOpenAIModel {
    pub name: String,
    #[serde(default)]
    pub alias: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AmpOpenAIProvider {
    #[serde(default = "generate_uuid")]
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    #[serde(default)]
    pub models: Vec<AmpOpenAIModel>,
}

pub(crate) fn generate_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

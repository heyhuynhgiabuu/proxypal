use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_copilot_port")]
    pub port: u16,
    #[serde(default)]
    pub account_type: String,
    #[serde(default)]
    pub github_token: String,
    #[serde(default)]
    pub rate_limit: Option<u16>,
    #[serde(default)]
    pub rate_limit_wait: bool,
}

fn default_copilot_port() -> u16 {
    4141
}

impl Default for CopilotConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 4141,
            account_type: "individual".to_string(),
            github_token: String::new(),
            rate_limit: None,
            rate_limit_wait: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotStatus {
    pub running: bool,
    pub port: u16,
    pub endpoint: String,
    pub authenticated: bool,
}

impl Default for CopilotStatus {
    fn default() -> Self {
        Self {
            running: false,
            port: 4141,
            endpoint: "http://localhost:4141".to_string(),
            authenticated: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotApiDetection {
    pub installed: bool,
    pub version: Option<String>,
    pub copilot_bin: Option<String>,
    pub npx_bin: Option<String>,
    pub npm_bin: Option<String>,
    pub node_bin: Option<String>,
    pub node_version: Option<String>,
    pub bunx_bin: Option<String>,
    pub node_available: bool,
    pub checked_node_paths: Vec<String>,
    pub checked_copilot_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotApiInstallResult {
    pub success: bool,
    pub message: String,
    pub version: Option<String>,
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyStatus {
    pub running: bool,
    pub port: u16,
    pub endpoint: String,
}

impl Default for ProxyStatus {
    fn default() -> Self {
        Self {
            running: false,
            port: 8317,
            endpoint: "http://localhost:8317/v1".to_string(),
        }
    }
}

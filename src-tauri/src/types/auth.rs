use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthStatus {
    pub claude: u32,
    pub openai: u32,
    pub gemini: u32,
    pub qwen: u32,
    pub iflow: u32,
    pub vertex: u32,
    pub antigravity: u32,
}

impl Default for AuthStatus {
    fn default() -> Self {
        Self {
            claude: 0,
            openai: 0,
            gemini: 0,
            qwen: 0,
            iflow: 0,
            vertex: 0,
            antigravity: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthState {
    pub provider: String,
    pub state: String,
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingBudgetSettings {
    pub mode: String,
    pub custom_budget: u32,
}

impl Default for ThinkingBudgetSettings {
    fn default() -> Self {
        Self {
            mode: "medium".to_string(),
            custom_budget: 16000,
        }
    }
}

impl ThinkingBudgetSettings {
    pub fn get_budget_tokens(&self) -> u32 {
        match self.mode.as_str() {
            "low" => 2048,
            "medium" => 8192,
            "high" => 32768,
            "custom" => self.custom_budget,
            _ => 8192,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasoningEffortSettings {
    pub level: String,
}

impl Default for ReasoningEffortSettings {
    fn default() -> Self {
        Self {
            level: "medium".to_string(),
        }
    }
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestLog {
    pub id: String,
    pub timestamp: u64,
    pub provider: String,
    pub model: String,
    pub method: String,
    pub path: String,
    pub status: u16,
    pub duration_ms: u64,
    pub tokens_in: Option<u32>,
    pub tokens_out: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageStats {
    pub total_requests: u64,
    pub success_count: u64,
    pub failure_count: u64,
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub requests_today: u64,
    pub tokens_today: u64,
    #[serde(default)]
    pub models: Vec<ModelUsage>,
    #[serde(default)]
    pub requests_by_day: Vec<TimeSeriesPoint>,
    #[serde(default)]
    pub tokens_by_day: Vec<TimeSeriesPoint>,
    #[serde(default)]
    pub requests_by_hour: Vec<TimeSeriesPoint>,
    #[serde(default)]
    pub tokens_by_hour: Vec<TimeSeriesPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeSeriesPoint {
    pub label: String,
    pub value: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    pub requests: u64,
    pub tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RequestHistory {
    pub requests: Vec<RequestLog>,
    pub total_tokens_in: u64,
    pub total_tokens_out: u64,
    pub total_cost_usd: f64,
    #[serde(default)]
    pub tokens_by_day: Vec<TimeSeriesPoint>,
    #[serde(default)]
    pub tokens_by_hour: Vec<TimeSeriesPoint>,
}

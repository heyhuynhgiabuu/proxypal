//! Request history and aggregate I/O helpers.

use crate::config::{get_aggregate_path, get_history_path};
use crate::types::{Aggregate, ModelStats, RequestHistory, RequestLog, TimeSeriesPoint};

// Load request history from file
pub(crate) fn load_request_history() -> RequestHistory {
    let path = get_history_path();
    if path.exists() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(mut history) = serde_json::from_str::<RequestHistory>(&data) {
                // Recalculate totals from saved requests if counters are missing
                // This handles migration from old format
                if history.total_request_count == 0 && !history.requests.is_empty() {
                    history.total_request_count = history.requests.len() as u64;
                }
                if history.total_success_count == 0 && !history.requests.is_empty() {
                    history.total_success_count =
                        history.requests.iter().filter(|r| r.status < 400).count() as u64;
                }
                return history;
            }
        }
    }
    RequestHistory::default()
}

// Save request history to file (keep last 500 requests)
pub(crate) fn save_request_history(history: &RequestHistory) -> Result<(), String> {
    let path = get_history_path();
    let mut trimmed = history.clone();
    // Keep only last 500 requests in the array for UI display
    // But preserve totalRequestCount and totalSuccessCount (cumulative across all history)
    if trimmed.requests.len() > 500 {
        trimmed.requests = trimmed.requests.split_off(trimmed.requests.len() - 500);
    }
    let data = serde_json::to_string_pretty(&trimmed).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

pub(crate) fn load_aggregate() -> Aggregate {
    let path = get_aggregate_path();
    if path.exists() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(agg) = serde_json::from_str(&data) {
                return agg;
            }
        }
    }
    Aggregate::default()
}

pub(crate) fn save_aggregate(agg: &Aggregate) -> Result<(), String> {
    let path = get_aggregate_path();
    let temp_path = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(agg).map_err(|e| e.to_string())?;
    std::fs::write(&temp_path, data).map_err(|e| e.to_string())?;
    std::fs::rename(&temp_path, &path).map_err(|e| e.to_string())
}

pub(crate) fn update_timeseries(series: &mut Vec<TimeSeriesPoint>, label: &str, increment: u64) {
    if let Some(point) = series.iter_mut().find(|p| p.label == label) {
        point.value += increment;
    } else {
        series.push(TimeSeriesPoint {
            label: label.to_string(),
            value: increment,
        });
    }
}

pub(crate) fn update_model_stats(agg: &mut Aggregate, req: &RequestLog) {
    let model = if req.model.is_empty() || req.model == "unknown" {
        "unknown".to_string()
    } else {
        req.model.clone()
    };

    let entry = agg
        .model_stats
        .entry(model)
        .or_insert(ModelStats::default());
    entry.requests += 1;
    if req.status < 400 {
        entry.success_count += 1;
    }
    entry.tokens += (req.tokens_in.unwrap_or(0) + req.tokens_out.unwrap_or(0)) as u64;
    entry.input_tokens += req.tokens_in.unwrap_or(0) as u64;
    entry.output_tokens += req.tokens_out.unwrap_or(0) as u64;
    entry.cached_tokens += req.tokens_cached.unwrap_or(0) as u64;
}

pub(crate) fn update_provider_stats(agg: &mut Aggregate, req: &RequestLog) {
    let provider = if req.provider.is_empty() || req.provider == "unknown" {
        "unknown".to_string()
    } else {
        req.provider.clone()
    };

    let entry = agg
        .provider_stats
        .entry(provider)
        .or_insert(ModelStats::default());
    entry.requests += 1;
    if req.status < 400 {
        entry.success_count += 1;
    }
    entry.tokens += (req.tokens_in.unwrap_or(0) + req.tokens_out.unwrap_or(0)) as u64;
}

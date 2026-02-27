//! Usage & Analytics commands.
//!
//! Extracted from lib.rs — handles usage statistics, request history,
//! and syncing usage data from the CLIProxyAPI management API.

use crate::helpers::history::{load_aggregate, load_request_history, save_aggregate, save_request_history};
use crate::state::AppState;
use crate::types::{
    ModelStats, ModelUsage, ProviderUsage, RequestHistory, RequestLog, TimeSeriesPoint, UsageStats,
};
use crate::utils::estimate_request_cost;
use tauri::State;

// Live usage data from Go backend
#[allow(dead_code)] // Fields deserialized from JSON, used indirectly
struct LiveUsageData {
    total_tokens: u64,
    input_tokens: u64,
    output_tokens: u64,
    cached_tokens: u64,
    model_tokens: std::collections::HashMap<String, u64>,
    model_token_breakdown: std::collections::HashMap<String, (u64, u64, u64)>, // (input, output, cached)
    tokens_by_hour: Vec<TimeSeriesPoint>,
}

// Fetch live usage stats from Go backend (blocking version for sync context)
fn fetch_live_usage_stats_blocking(port: u16) -> Option<LiveUsageData> {
    let url = format!("http://127.0.0.1:{}/v0/management/usage", port);
    let client = reqwest::blocking::Client::new();

    let response = client
        .get(&url)
        .header("X-Management-Key", &crate::get_management_key())
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .ok()?;

    let json: serde_json::Value = response.json().ok()?;

    // Parse the response structure:
    // { "usage": { "total_tokens": N, "apis": { "api-name": { "models": { "model": { "total_tokens": N, "details": [...] } } } } } }
    let usage = json.get("usage")?;

    let total_tokens = usage.get("total_tokens")?.as_u64().unwrap_or(0);

    // Extract input/output/cached tokens from the detailed data
    let mut input_tokens = 0u64;
    let mut output_tokens = 0u64;
    let mut cached_tokens = 0u64;
    let mut model_tokens: std::collections::HashMap<String, u64> =
        std::collections::HashMap::new();
    let mut model_token_breakdown: std::collections::HashMap<String, (u64, u64, u64)> =
        std::collections::HashMap::new();

    if let Some(apis) = usage.get("apis").and_then(|v| v.as_object()) {
        for (_api_name, api_data) in apis {
            if let Some(models) = api_data.get("models").and_then(|v| v.as_object()) {
                for (model_name, model_data) in models {
                    let model_total = model_data
                        .get("total_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    *model_tokens.entry(model_name.clone()).or_insert(0) += model_total;

                    // Sum up input/output/cached from details per model
                    let mut model_input = 0u64;
                    let mut model_output = 0u64;
                    let mut model_cached = 0u64;

                    if let Some(details) = model_data.get("details").and_then(|v| v.as_array()) {
                        for detail in details {
                            if let Some(tokens) = detail.get("tokens") {
                                let inp = tokens
                                    .get("input_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0);
                                let out = tokens
                                    .get("output_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0);
                                let cached = tokens
                                    .get("cached_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0);

                                input_tokens += inp;
                                output_tokens += out;
                                cached_tokens += cached;

                                model_input += inp;
                                model_output += out;
                                model_cached += cached;
                            }
                        }
                    }

                    // Store per-model breakdown
                    let entry = model_token_breakdown
                        .entry(model_name.clone())
                        .or_insert((0, 0, 0));
                    entry.0 += model_input;
                    entry.1 += model_output;
                    entry.2 += model_cached;
                }
            }
        }
    }

    Some(LiveUsageData {
        total_tokens,
        input_tokens,
        output_tokens,
        cached_tokens,
        model_tokens,
        model_token_breakdown,
        tokens_by_hour: {
            // Parse tokens_by_hour from Go backend: { "HH": value, ... }
            let mut result = Vec::new();
            if let Some(tbh) = usage
                .get("tokens_by_hour")
                .and_then(|v| v.as_object())
            {
                let today = chrono::Local::now().format("%Y-%m-%d").to_string();
                for (hour, value) in tbh {
                    if let Some(v) = value.as_u64() {
                        // Convert "HH" format to "YYYY-MM-DDTHH" format
                        let label = format!("{}T{}", today, hour);
                        result.push(TimeSeriesPoint { label, value: v });
                    }
                }
                result.sort_by(|a, b| a.label.cmp(&b.label));
            }
            result
        },
    })
}

// Blocking version of sync_usage_from_proxy for use in sync contexts
fn sync_usage_from_proxy_blocking(port: u16) {
    let url = format!("http://127.0.0.1:{}/v0/management/usage", port);
    let client = reqwest::blocking::Client::new();

    let response = match client
        .get(&url)
        .header("X-Management-Key", &crate::get_management_key())
        .timeout(std::time::Duration::from_secs(5))
        .send()
    {
        Ok(r) => r,
        Err(_) => return,
    };

    if !response.status().is_success() {
        return;
    }

    let body: serde_json::Value = match response.json() {
        Ok(j) => j,
        Err(_) => return,
    };

    let usage = match body.get("usage") {
        Some(u) => u,
        None => return,
    };

    // Parse time-series data from CLIProxyAPI
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    // Parse tokens_by_day
    let mut tokens_by_day: Vec<TimeSeriesPoint> = Vec::new();
    if let Some(tbd) = usage.get("tokens_by_day").and_then(|v| v.as_object()) {
        for (day, value) in tbd {
            if let Some(v) = value.as_u64() {
                tokens_by_day.push(TimeSeriesPoint {
                    label: day.clone(),
                    value: v,
                });
            }
        }
        tokens_by_day.sort_by(|a, b| a.label.cmp(&b.label));
    }

    // Parse tokens_by_hour with normalized format
    let mut tokens_by_hour: Vec<TimeSeriesPoint> = Vec::new();
    if let Some(tbh) = usage.get("tokens_by_hour").and_then(|v| v.as_object()) {
        for (hour, value) in tbh {
            if let Some(v) = value.as_u64() {
                let label = if hour.len() == 2 {
                    format!("{}T{}", today, hour)
                } else {
                    hour.clone()
                };
                tokens_by_hour.push(TimeSeriesPoint { label, value: v });
            }
        }
        tokens_by_hour.sort_by(|a, b| a.label.cmp(&b.label));
    }

    // Parse requests_by_day
    let mut requests_by_day: Vec<TimeSeriesPoint> = Vec::new();
    if let Some(rbd) = usage.get("requests_by_day").and_then(|v| v.as_object()) {
        for (day, value) in rbd {
            if let Some(v) = value.as_u64() {
                requests_by_day.push(TimeSeriesPoint {
                    label: day.clone(),
                    value: v,
                });
            }
        }
        requests_by_day.sort_by(|a, b| a.label.cmp(&b.label));
    }

    // Parse requests_by_hour with normalized format
    let mut requests_by_hour: Vec<TimeSeriesPoint> = Vec::new();
    if let Some(rbh) = usage.get("requests_by_hour").and_then(|v| v.as_object()) {
        for (hour, value) in rbh {
            if let Some(v) = value.as_u64() {
                let label = if hour.len() == 2 {
                    format!("{}T{}", today, hour)
                } else {
                    hour.clone()
                };
                requests_by_hour.push(TimeSeriesPoint { label, value: v });
            }
        }
        requests_by_hour.sort_by(|a, b| a.label.cmp(&b.label));
    }

    // Parse model stats and totals
    let mut total_requests: u64 = 0;
    let mut model_stats: std::collections::HashMap<String, ModelStats> =
        std::collections::HashMap::new();

    if let Some(apis) = usage.get("apis").and_then(|v| v.as_object()) {
        for (_api_name, api_data) in apis {
            if let Some(models) = api_data.get("models").and_then(|v| v.as_object()) {
                for (model_name, model_data) in models {
                    let model_requests = model_data
                        .get("total_requests")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let model_tokens = model_data
                        .get("total_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);

                    total_requests += model_requests;

                    let stats = model_stats
                        .entry(model_name.clone())
                        .or_insert_with(Default::default);
                    stats.requests += model_requests;
                    stats.tokens += model_tokens;
                    stats.success_count += model_requests;

                    // Parse token breakdown from details
                    if let Some(details) = model_data.get("details").and_then(|v| v.as_array()) {
                        for detail in details {
                            if let Some(tokens) = detail.get("tokens") {
                                stats.input_tokens += tokens
                                    .get("input_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0);
                                stats.output_tokens += tokens
                                    .get("output_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0);
                                stats.cached_tokens += tokens
                                    .get("cached_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0);
                            }
                        }
                    }
                }
            }
        }
    }

    // Update aggregate
    let mut agg = load_aggregate();

    // Merge time-series data
    for point in &tokens_by_day {
        if let Some(existing) = agg.tokens_by_day.iter_mut().find(|p| p.label == point.label) {
            existing.value = point.value;
        } else {
            agg.tokens_by_day.push(point.clone());
        }
    }
    agg.tokens_by_day.sort_by(|a, b| a.label.cmp(&b.label));

    for point in &tokens_by_hour {
        if let Some(existing) = agg
            .tokens_by_hour
            .iter_mut()
            .find(|p| p.label == point.label)
        {
            existing.value = point.value;
        } else {
            agg.tokens_by_hour.push(point.clone());
        }
    }
    agg.tokens_by_hour.sort_by(|a, b| a.label.cmp(&b.label));
    if agg.tokens_by_hour.len() > 168 {
        agg.tokens_by_hour = agg
            .tokens_by_hour
            .split_off(agg.tokens_by_hour.len() - 168);
    }

    for point in &requests_by_day {
        if let Some(existing) = agg
            .requests_by_day
            .iter_mut()
            .find(|p| p.label == point.label)
        {
            existing.value = point.value;
        } else {
            agg.requests_by_day.push(point.clone());
        }
    }
    agg.requests_by_day
        .sort_by(|a, b| a.label.cmp(&b.label));

    for point in &requests_by_hour {
        if let Some(existing) = agg
            .requests_by_hour
            .iter_mut()
            .find(|p| p.label == point.label)
        {
            existing.value = point.value;
        } else {
            agg.requests_by_hour.push(point.clone());
        }
    }
    agg.requests_by_hour
        .sort_by(|a, b| a.label.cmp(&b.label));
    if agg.requests_by_hour.len() > 168 {
        agg.requests_by_hour = agg
            .requests_by_hour
            .split_off(agg.requests_by_hour.len() - 168);
    }

    // Update model stats
    for (model_name, stats) in model_stats {
        let agg_stats = agg
            .model_stats
            .entry(model_name)
            .or_insert_with(Default::default);
        agg_stats.requests = stats.requests;
        agg_stats.success_count = stats.success_count;
        agg_stats.tokens = stats.tokens;
        agg_stats.input_tokens = stats.input_tokens;
        agg_stats.output_tokens = stats.output_tokens;
        agg_stats.cached_tokens = stats.cached_tokens;
    }

    // Update totals
    if total_requests > agg.total_requests {
        agg.total_requests = total_requests;
    }
    let synced_success: u64 = agg.model_stats.values().map(|s| s.success_count).sum();
    if synced_success > agg.total_success_count {
        agg.total_success_count = synced_success;
    }

    let _ = save_aggregate(&agg);
}

// Compute usage statistics - fetches live data from Go backend when proxy is running
#[tauri::command]
pub fn get_usage_stats(state: State<'_, AppState>) -> Result<UsageStats, String> {
    // Get proxy status
    let (is_running, port) = {
        let status = state.proxy_status.lock().unwrap();
        (status.running, status.port)
    };

    // Sync from proxy first if running (this updates aggregate with latest data from CLIProxyAPI)
    if is_running {
        sync_usage_from_proxy_blocking(port);
    }

    // Now load the updated aggregate and history
    let agg = load_aggregate();
    let history = load_request_history();

    // Try to fetch live data from Go backend if proxy is running
    // Live data provides per-model breakdowns for the current session
    let live_data = if is_running {
        fetch_live_usage_stats_blocking(port)
    } else {
        None
    };

    // Use aggregate as the source of truth for all-time totals (preserved across restarts).
    // Live data only supplements per-model breakdowns for the current session.
    let total_tokens = agg.total_tokens_in + agg.total_tokens_out;
    let input_tokens = agg.total_tokens_in;
    let output_tokens = agg.total_tokens_out;
    let cached_tokens = agg.total_tokens_cached;
    let (model_tokens, model_token_breakdown): (std::collections::HashMap<String, u64>, std::collections::HashMap<String, (u64, u64, u64)>) = if let Some(ref live) = live_data {
        (
            live.model_tokens.clone(),
            live.model_token_breakdown.clone(),
        )
    } else {
        // Build model token breakdown from aggregate stats
        let agg_model_tokens: std::collections::HashMap<String, u64> = agg
            .model_stats
            .iter()
            .map(|(k, v)| (k.clone(), v.tokens))
            .collect();
        let agg_model_breakdown: std::collections::HashMap<String, (u64, u64, u64)> = agg
            .model_stats
            .iter()
            .map(|(k, v)| (k.clone(), (v.input_tokens, v.output_tokens, v.cached_tokens)))
            .collect();
        (agg_model_tokens, agg_model_breakdown)
    };

    // If no data yet, return defaults
    if agg.total_requests == 0 && history.requests.is_empty() {
        return Ok(UsageStats::default());
    }

    // Use aggregate as primary source of truth for all-time stats
    let total_requests = agg.total_requests;
    let success_count = agg.total_success_count;
    let failure_count = agg.total_failure_count;

    // Calculate today's stats from aggregate time-series
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let requests_today = agg
        .requests_by_day
        .iter()
        .find(|p| p.label == today)
        .map(|p| p.value)
        .unwrap_or(0);

    // Get today's tokens from live data or aggregate
    let tokens_today = if let Some(ref live) = live_data {
        live.total_tokens // Use live total as "today" since it's current session
    } else {
        agg.tokens_by_day
            .iter()
            .find(|p| p.label == today)
            .map(|p| p.value)
            .unwrap_or(0)
    };

    // Build model stats - merge aggregate with live token data
    let mut models: Vec<ModelUsage> = agg
        .model_stats
        .iter()
        .filter(|(model, _)| *model != "unknown" && !model.is_empty())
        .map(|(model, stats)| {
            let tokens = model_tokens.get(model).copied().unwrap_or(stats.tokens);
            let (input, output, cached) = model_token_breakdown
                .get(model)
                .copied()
                .unwrap_or((0, 0, 0));
            ModelUsage {
                model: model.clone(),
                requests: stats.requests,
                tokens,
                input_tokens: input,
                output_tokens: output,
                cached_tokens: cached,
            }
        })
        .collect();

    // Add any models from live data that aren't in aggregate
    for (model, tokens) in &model_tokens {
        if !models.iter().any(|m| &m.model == model) && model != "unknown" && !model.is_empty() {
            let (input, output, cached) = model_token_breakdown
                .get(model)
                .copied()
                .unwrap_or((0, 0, 0));
            models.push(ModelUsage {
                model: model.clone(),
                requests: 0, // Will be updated from aggregate
                tokens: *tokens,
                input_tokens: input,
                output_tokens: output,
                cached_tokens: cached,
            });
        }
    }
    models.sort_by(|a, b| b.requests.cmp(&a.requests));

    // Build provider stats from aggregate
    let mut providers: Vec<ProviderUsage> = agg
        .provider_stats
        .iter()
        .filter(|(provider, _)| *provider != "unknown" && !provider.is_empty())
        .map(|(provider, stats)| ProviderUsage {
            provider: provider.clone(),
            requests: stats.requests,
            tokens: stats.tokens,
        })
        .collect();
    providers.sort_by(|a, b| b.requests.cmp(&a.requests));

    // Use aggregate time-series, fall back to history if empty
    let mut requests_by_day = agg.requests_by_day.clone();
    if requests_by_day.is_empty() && !history.requests.is_empty() {
        // Build from history requests
        let mut map: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
        for req in &history.requests {
            if let Some(dt) = chrono::DateTime::from_timestamp_millis(req.timestamp as i64) {
                let day = dt.format("%Y-%m-%d").to_string();
                *map.entry(day).or_insert(0) += 1;
            }
        }
        let mut points: Vec<TimeSeriesPoint> = map
            .into_iter()
            .map(|(label, value)| TimeSeriesPoint { label, value })
            .collect();
        points.sort_by(|a, b| a.label.cmp(&b.label));
        // Keep last 14 days
        if points.len() > 14 {
            points = points.split_off(points.len() - 14);
        }
        requests_by_day = points;
    } else if requests_by_day.len() > 14 {
        requests_by_day = requests_by_day.split_off(requests_by_day.len() - 14);
    }

    let mut tokens_by_day = agg.tokens_by_day.clone();
    if tokens_by_day.is_empty() {
        tokens_by_day = history.tokens_by_day.clone();
    }
    if tokens_by_day.len() > 14 {
        tokens_by_day = tokens_by_day.split_off(tokens_by_day.len() - 14);
    }

    // Use aggregate hourly data (persisted across sessions), fall back to history if empty
    let mut requests_by_hour: Vec<TimeSeriesPoint> = if !agg.requests_by_hour.is_empty() {
        agg.requests_by_hour.clone()
    } else {
        // Build from history as fallback for existing data
        let mut requests_by_hour_map: std::collections::HashMap<String, u64> =
            std::collections::HashMap::new();
        for req in &history.requests {
            if let Some(dt) = chrono::DateTime::from_timestamp_millis(req.timestamp as i64) {
                let hour_label = dt.format("%Y-%m-%dT%H").to_string();
                *requests_by_hour_map.entry(hour_label).or_insert(0) += 1;
            }
        }
        requests_by_hour_map
            .into_iter()
            .map(|(label, value)| TimeSeriesPoint { label, value })
            .collect()
    };
    requests_by_hour.sort_by(|a, b| a.label.cmp(&b.label));
    // Keep last 168 hours (7 days) for Activity Patterns heatmap
    if requests_by_hour.len() > 168 {
        requests_by_hour = requests_by_hour.split_off(requests_by_hour.len() - 168);
    }

    // Use aggregate hourly tokens data, fall back to live data or history
    let mut tokens_by_hour: Vec<TimeSeriesPoint> = if !agg.tokens_by_hour.is_empty() {
        agg.tokens_by_hour.clone()
    } else if let Some(ref live) = live_data {
        if !live.tokens_by_hour.is_empty() {
            live.tokens_by_hour.clone()
        } else {
            // Build from history as fallback
            let mut tokens_by_hour_map: std::collections::HashMap<String, u64> =
                std::collections::HashMap::new();
            for req in &history.requests {
                if let Some(dt) = chrono::DateTime::from_timestamp_millis(req.timestamp as i64) {
                    let hour_label = dt.format("%Y-%m-%dT%H").to_string();
                    let tokens =
                        (req.tokens_in.unwrap_or(0) + req.tokens_out.unwrap_or(0)) as u64;
                    *tokens_by_hour_map.entry(hour_label).or_insert(0) += tokens;
                }
            }
            tokens_by_hour_map
                .into_iter()
                .map(|(label, value)| TimeSeriesPoint { label, value })
                .collect()
        }
    } else {
        vec![]
    };
    tokens_by_hour.sort_by(|a, b| a.label.cmp(&b.label));
    if tokens_by_hour.len() > 168 {
        tokens_by_hour = tokens_by_hour.split_off(tokens_by_hour.len() - 168);
    }

    Ok(UsageStats {
        total_requests,
        success_count,
        failure_count,
        total_tokens,
        input_tokens,
        output_tokens,
        cached_tokens,
        requests_today,
        tokens_today,
        models,
        providers,
        requests_by_day,
        tokens_by_day,
        requests_by_hour,
        tokens_by_hour,
    })
}

// Get request history
#[tauri::command]
pub fn get_request_history() -> RequestHistory {
    load_request_history()
}

// Add a request to history (called when request-log event is emitted)
// Returns only the added request to minimize data transfer (memory optimization)
#[tauri::command]
pub fn add_request_to_history(request: RequestLog) -> Result<RequestLog, String> {
    let mut history = load_request_history();

    // Calculate cost for this request
    let tokens_in = request.tokens_in.unwrap_or(0);
    let tokens_out = request.tokens_out.unwrap_or(0);
    let cost = estimate_request_cost(&request.model, tokens_in, tokens_out);
    let tokens_cached = request.tokens_cached.unwrap_or(0);

    // Update totals
    history.total_tokens_in += tokens_in as u64;
    history.total_tokens_out += tokens_out as u64;
    history.total_tokens_cached += tokens_cached as u64;
    history.total_cost_usd += cost;

    // Add request (with deduplication check)
    // Check if request with same ID already exists to prevent duplicates
    let request_clone = request.clone();
    if !history.requests.iter().any(|r| r.id == request.id) {
        history.requests.push(request);

        // Trim to prevent unbounded growth (keep last 500 requests)
        const MAX_HISTORY_SIZE: usize = 500;
        if history.requests.len() > MAX_HISTORY_SIZE {
            let excess = history.requests.len() - MAX_HISTORY_SIZE;
            history.requests.drain(0..excess);
        }
    }

    // Save
    save_request_history(&history)?;

    // Return only the added request, not the full history
    Ok(request_clone)
}

// Clear request history
#[tauri::command]
pub fn clear_request_history() -> Result<(), String> {
    let history = RequestHistory::default();
    save_request_history(&history)
}

// Sync usage statistics from CLIProxyAPI's Management API
// This fetches real token counts that aren't available in GIN logs
#[tauri::command]
pub async fn sync_usage_from_proxy(state: State<'_, AppState>) -> Result<RequestHistory, String> {
    let port = {
        let config = state.config.lock().unwrap();
        config.port
    };

    let client = crate::build_management_client();
    let usage_url = format!("http://127.0.0.1:{}/v0/management/usage", port);

    let response = client
        .get(&usage_url)
        .header("X-Management-Key", &crate::get_management_key())
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch usage: {}. Is the proxy running?", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Usage API returned status: {}",
            response.status()
        ));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse usage response: {}", e))?;

    // Extract token totals from CLIProxyAPI's usage response
    let usage = body
        .get("usage")
        .ok_or("Missing 'usage' field in response")?;

    // Calculate input/output token split from APIs data
    let mut total_input: u64 = 0;
    let mut total_output: u64 = 0;
    let mut total_cached: u64 = 0;
    let mut model_stats: std::collections::HashMap<String, (u64, u64, u64, u64)> =
        std::collections::HashMap::new(); // (requests, input, output, cached)

    if let Some(apis) = usage.get("apis").and_then(|v| v.as_object()) {
        for (_api_path, api_data) in apis {
            if let Some(models) = api_data.get("models").and_then(|v| v.as_object()) {
                for (model_name, model_data) in models {
                    if let Some(details) = model_data.get("details").and_then(|v| v.as_array()) {
                        for detail in details {
                            if let Some(tokens) = detail.get("tokens") {
                                let input = tokens
                                    .get("input_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0);
                                let output = tokens
                                    .get("output_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0);
                                let cached = tokens
                                    .get("cached_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0);
                                total_input += input;
                                total_output += output;
                                total_cached += cached;

                                let entry = model_stats
                                    .entry(model_name.clone())
                                    .or_insert((0, 0, 0, 0));
                                entry.0 += 1; // request count
                                entry.1 += input;
                                entry.2 += output;
                                entry.3 += cached;
                            }
                        }
                    }
                }
            }
        }
    }

    // Calculate cost based on real token data
    let mut total_cost: f64 = 0.0;
    for (model_name, (_, input, output, _cached)) in &model_stats {
        total_cost += estimate_request_cost(model_name, *input as u32, *output as u32);
    }

    // Extract time-series data from CLIProxyAPI response
    let mut tokens_by_day: Vec<TimeSeriesPoint> = Vec::new();
    let mut tokens_by_hour: Vec<TimeSeriesPoint> = Vec::new();
    let mut requests_by_day: Vec<TimeSeriesPoint> = Vec::new();
    let mut requests_by_hour: Vec<TimeSeriesPoint> = Vec::new();

    if let Some(tbd) = usage
        .get("tokens_by_day")
        .and_then(|v| v.as_object())
    {
        for (day, value) in tbd {
            if let Some(v) = value.as_u64() {
                tokens_by_day.push(TimeSeriesPoint {
                    label: day.clone(),
                    value: v,
                });
            }
        }
        tokens_by_day.sort_by(|a, b| a.label.cmp(&b.label));
        if tokens_by_day.len() > 14 {
            tokens_by_day = tokens_by_day.split_off(tokens_by_day.len() - 14);
        }
    }

    if let Some(tbh) = usage
        .get("tokens_by_hour")
        .and_then(|v| v.as_object())
    {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        for (hour, value) in tbh {
            if let Some(v) = value.as_u64() {
                // Normalize to YYYY-MM-DDTHH format if only HH is provided
                let label = if hour.len() == 2 {
                    format!("{}T{}", today, hour)
                } else {
                    hour.clone()
                };
                tokens_by_hour.push(TimeSeriesPoint { label, value: v });
            }
        }
        tokens_by_hour.sort_by(|a, b| a.label.cmp(&b.label));
        // Keep last 168 hours (7 days worth)
        if tokens_by_hour.len() > 168 {
            tokens_by_hour = tokens_by_hour.split_off(tokens_by_hour.len() - 168);
        }
    }

    // Parse requests_by_day from proxy (source of truth)
    if let Some(rbd) = usage
        .get("requests_by_day")
        .and_then(|v| v.as_object())
    {
        for (day, value) in rbd {
            if let Some(v) = value.as_u64() {
                requests_by_day.push(TimeSeriesPoint {
                    label: day.clone(),
                    value: v,
                });
            }
        }
        requests_by_day.sort_by(|a, b| a.label.cmp(&b.label));
        if requests_by_day.len() > 14 {
            requests_by_day = requests_by_day.split_off(requests_by_day.len() - 14);
        }
    }

    // Parse requests_by_hour from proxy (source of truth for Activity Patterns heatmap)
    if let Some(rbh) = usage
        .get("requests_by_hour")
        .and_then(|v| v.as_object())
    {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        for (hour, value) in rbh {
            if let Some(v) = value.as_u64() {
                // Normalize to YYYY-MM-DDTHH format if only HH is provided
                let label = if hour.len() == 2 {
                    format!("{}T{}", today, hour)
                } else {
                    hour.clone()
                };
                requests_by_hour.push(TimeSeriesPoint { label, value: v });
            }
        }
        requests_by_hour.sort_by(|a, b| a.label.cmp(&b.label));
        // Keep last 168 hours (7 days worth)
        if requests_by_hour.len() > 168 {
            requests_by_hour = requests_by_hour.split_off(requests_by_hour.len() - 168);
        }
    }

    // Update local history with synced data - use max() to never lose all-time data
    // The proxy reports cumulative session totals which reset on restart,
    // so we must never let a fresh session zero out persisted all-time data.
    let mut history = load_request_history();
    history.total_tokens_in = history.total_tokens_in.max(total_input);
    history.total_tokens_out = history.total_tokens_out.max(total_output);
    history.total_tokens_cached = history.total_tokens_cached.max(total_cached);
    history.total_cost_usd = if total_cost > history.total_cost_usd {
        total_cost
    } else {
        history.total_cost_usd
    };
    history.tokens_by_day = tokens_by_day.clone();
    history.tokens_by_hour = tokens_by_hour.clone();

    // Save updated history
    save_request_history(&history)?;

    // Also update aggregate with token data from proxy - use max() to preserve all-time
    let mut agg = load_aggregate();
    agg.total_tokens_in = agg.total_tokens_in.max(total_input);
    agg.total_tokens_out = agg.total_tokens_out.max(total_output);
    agg.total_cost_usd = if total_cost > agg.total_cost_usd {
        total_cost
    } else {
        agg.total_cost_usd
    };
    // Merge tokens_by_day into aggregate (proxy is source of truth for tokens)
    for point in &tokens_by_day {
        if let Some(existing) = agg
            .tokens_by_day
            .iter_mut()
            .find(|p| p.label == point.label)
        {
            existing.value = point.value; // Update with proxy value
        } else {
            agg.tokens_by_day.push(point.clone());
        }
    }
    agg.tokens_by_day.sort_by(|a, b| a.label.cmp(&b.label));

    // Merge requests_by_day into aggregate (proxy is source of truth for requests)
    for point in &requests_by_day {
        if let Some(existing) = agg
            .requests_by_day
            .iter_mut()
            .find(|p| p.label == point.label)
        {
            existing.value = point.value; // Update with proxy value
        } else {
            agg.requests_by_day.push(point.clone());
        }
    }
    agg.requests_by_day
        .sort_by(|a, b| a.label.cmp(&b.label));

    // Merge requests_by_hour into aggregate (for Activity Patterns heatmap)
    for point in &requests_by_hour {
        if let Some(existing) = agg
            .requests_by_hour
            .iter_mut()
            .find(|p| p.label == point.label)
        {
            existing.value = point.value; // Update with proxy value
        } else {
            agg.requests_by_hour.push(point.clone());
        }
    }
    agg.requests_by_hour
        .sort_by(|a, b| a.label.cmp(&b.label));
    // Trim to last 168 hours (7 days)
    if agg.requests_by_hour.len() > 168 {
        agg.requests_by_hour = agg
            .requests_by_hour
            .split_off(agg.requests_by_hour.len() - 168);
    }

    // Merge tokens_by_hour into aggregate
    for point in &tokens_by_hour {
        if let Some(existing) = agg
            .tokens_by_hour
            .iter_mut()
            .find(|p| p.label == point.label)
        {
            existing.value = point.value; // Update with proxy value
        } else {
            agg.tokens_by_hour.push(point.clone());
        }
    }
    agg.tokens_by_hour.sort_by(|a, b| a.label.cmp(&b.label));
    // Trim to last 168 hours (7 days)
    if agg.tokens_by_hour.len() > 168 {
        agg.tokens_by_hour = agg
            .tokens_by_hour
            .split_off(agg.tokens_by_hour.len() - 168);
    }

    // Update total_requests from proxy data if available
    if !requests_by_day.is_empty() {
        let proxy_total: u64 = requests_by_day.iter().map(|p| p.value).sum();
        if proxy_total > agg.total_requests {
            agg.total_requests = proxy_total;
        }
    }

    // Sync model_stats from proxy (source of truth for per-model request/token counts)
    if let Some(apis) = usage.get("apis").and_then(|v| v.as_object()) {
        for (_provider, provider_data) in apis {
            if let Some(models) = provider_data.get("models").and_then(|v| v.as_object()) {
                for (model_name, model_data) in models {
                    let total_requests = model_data
                        .get("total_requests")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let total_tokens = model_data
                        .get("total_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);

                    // Sum up token details from the model's request history
                    let mut input_tokens: u64 = 0;
                    let mut output_tokens: u64 = 0;
                    let mut cached_tokens: u64 = 0;

                    if let Some(details) = model_data.get("details").and_then(|v| v.as_array()) {
                        for detail in details {
                            if let Some(tokens) =
                                detail.get("tokens").and_then(|v| v.as_object())
                            {
                                input_tokens += tokens
                                    .get("input_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0);
                                output_tokens += tokens
                                    .get("output_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0);
                                cached_tokens += tokens
                                    .get("cached_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0);
                            }
                        }
                    }

                    // Update or insert model stats
                    let stats = agg
                        .model_stats
                        .entry(model_name.clone())
                        .or_insert_with(Default::default);
                    stats.requests = total_requests;
                    stats.success_count = total_requests; // Assume all synced requests succeeded
                    stats.tokens = total_tokens;
                    stats.input_tokens = input_tokens;
                    stats.output_tokens = output_tokens;
                    stats.cached_tokens = cached_tokens;
                }
            }
        }
    }

    // Update total_success_count from synced model stats (proxy only tracks successful requests)
    let synced_success: u64 = agg.model_stats.values().map(|s| s.success_count).sum();
    if synced_success > agg.total_success_count {
        agg.total_success_count = synced_success;
    }
    // Update total_tokens_cached in aggregate
    agg.total_tokens_cached = total_cached;

    let _ = save_aggregate(&agg);

    Ok(history)
}

// Export usage statistics from CLIProxyAPI for backup
#[tauri::command]
pub async fn export_usage_stats(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let port = {
        let config = state.config.lock().unwrap();
        config.port
    };

    let client = crate::build_management_client();
    let export_url = format!("http://127.0.0.1:{}/v0/management/usage/export", port);

    let response = client
        .get(&export_url)
        .header("X-Management-Key", &crate::get_management_key())
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Failed to export usage: {}. Is the proxy running?", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Export API returned status: {}",
            response.status()
        ));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse export response: {}", e))?;

    Ok(body)
}

// Import usage statistics into CLIProxyAPI from backup
#[tauri::command]
pub async fn import_usage_stats(
    state: State<'_, AppState>,
    data: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let port = {
        let config = state.config.lock().unwrap();
        config.port
    };

    let client = crate::build_management_client();
    let import_url = format!("http://127.0.0.1:{}/v0/management/usage/import", port);

    let response = client
        .post(&import_url)
        .header("X-Management-Key", &crate::get_management_key())
        .header("Content-Type", "application/json")
        .json(&data)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Failed to import usage: {}. Is the proxy running?", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Import API returned status: {} - {}",
            status, body
        ));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse import response: {}", e))?;

    Ok(body)
}

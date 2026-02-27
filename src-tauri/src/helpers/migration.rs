//! Config migration helpers.

use crate::config::get_aggregate_path;
use crate::helpers::history::{
    load_request_history, save_aggregate, update_model_stats, update_provider_stats,
    update_timeseries,
};
use crate::types::Aggregate;

/// Migrate from old single-file format to split storage
/// Called once on app startup
pub(crate) fn migrate_to_split_storage() {
    let agg_path = get_aggregate_path();

    // Skip if aggregate already exists
    if agg_path.exists() {
        return;
    }

    let history = load_request_history();

    // Skip if no history to migrate
    if history.requests.is_empty() {
        return;
    }

    eprintln!("[Migration] Building aggregate.json from existing history...");

    let mut agg = Aggregate::default();

    // Count totals from requests
    agg.total_requests = history.requests.len() as u64;
    agg.total_success_count = history.requests.iter().filter(|r| r.status < 400).count() as u64;
    agg.total_failure_count = agg.total_requests - agg.total_success_count;

    // Use existing token totals from history
    agg.total_tokens_in = history.total_tokens_in;
    agg.total_tokens_out = history.total_tokens_out;
    agg.total_cost_usd = history.total_cost_usd;

    // Build time-series from requests
    for req in &history.requests {
        if let Some(dt) = chrono::DateTime::from_timestamp_millis(req.timestamp as i64) {
            let day = dt.format("%Y-%m-%d").to_string();
            update_timeseries(&mut agg.requests_by_day, &day, 1);
            let tokens = (req.tokens_in.unwrap_or(0) + req.tokens_out.unwrap_or(0)) as u64;
            update_timeseries(&mut agg.tokens_by_day, &day, tokens);
        }

        // Build model/provider stats
        update_model_stats(&mut agg, req);
        update_provider_stats(&mut agg, req);
    }

    // Also use existing time-series from history if available
    if !history.tokens_by_day.is_empty() && agg.tokens_by_day.is_empty() {
        agg.tokens_by_day = history.tokens_by_day.clone();
    }

    // Sort time-series by date
    agg.requests_by_day.sort_by(|a, b| a.label.cmp(&b.label));
    agg.tokens_by_day.sort_by(|a, b| a.label.cmp(&b.label));

    // Save the new aggregate file
    match save_aggregate(&agg) {
        Ok(_) => eprintln!(
            "[Migration] Success! Created aggregate.json with {} requests",
            agg.total_requests
        ),
        Err(e) => eprintln!("[Migration] Failed to save aggregate: {}", e),
    }
}

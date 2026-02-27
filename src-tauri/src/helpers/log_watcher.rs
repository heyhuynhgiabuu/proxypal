//! Log parsing and file-watching helpers extracted from lib.rs.

use regex::Regex;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use tauri::Emitter;

use crate::helpers::history::{
    load_aggregate, load_request_history, save_aggregate, save_request_history, update_model_stats,
    update_provider_stats, update_timeseries,
};
use crate::types::RequestLog;
use crate::utils::{
    detect_provider_from_model, detect_provider_from_path, extract_model_from_path,
};

// Parse duration string to milliseconds
fn parse_duration(duration_str: &str) -> u64 {
    if duration_str.ends_with("ms") {
        duration_str.trim_end_matches("ms").parse().unwrap_or(0)
    } else if duration_str.ends_with('s') {
        let secs: f64 = duration_str.trim_end_matches('s').parse().unwrap_or(0.0);
        (secs * 1000.0) as u64
    } else {
        0
    }
}

// Extract timestamp from log line
// Format: 2025-12-24 15:14:21 or similar at the start of line
fn extract_timestamp_from_line(line: &str) -> Option<u64> {
    lazy_static::lazy_static! {
        static ref TS_REGEX: Regex = Regex::new(
            r#"(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})"#
        ).unwrap();
    }

    if let Some(caps) = TS_REGEX.captures(line) {
        let date_str = caps.get(1)?.as_str();
        let time_str = caps.get(2)?.as_str();
        let datetime_str = format!("{} {}", date_str, time_str);
        return chrono::NaiveDateTime::parse_from_str(&datetime_str, "%Y-%m-%d %H:%M:%S")
            .ok()
            .map(|dt| {
                dt.and_local_timezone(chrono::Local)
                    .earliest()
                    .unwrap_or_else(|| chrono::Local::now())
                    .timestamp_millis() as u64
            });
    }
    None
}

// Parse a GIN log line and extract request information
// Format: [GIN] 2025/12/04 - 20:51:48 | 200 | 6.656s | ::1 | POST "/api/provider/anthropic/v1/messages"
// Also handles new format: | request_id | 200 | 6.656s | ip | POST "/path"
fn parse_gin_log_line(
    line: &str,
    request_counter: &AtomicU64,
    model_cache: &std::sync::RwLock<std::collections::HashMap<String, String>>,
) -> Option<RequestLog> {
    // Check for model info in DEBUG lines and cache it
    // Format: | f803bb77 | Use OAuth user@email.com for model claude-opus-4-5-thinking
    if line.contains("for model ") {
        lazy_static::lazy_static! {
            static ref MODEL_REGEX: Regex = Regex::new(
                r#"\|\s+([a-f0-9]{8})\s+\|.*for model\s+(\S+)"#
            ).unwrap();
        }
        if let Some(caps) = MODEL_REGEX.captures(line) {
            let request_id = caps.get(1)?.as_str().to_string();
            let model = caps.get(2)?.as_str().to_string();
            if let Ok(mut cache) = model_cache.write() {
                cache.insert(request_id, model);
                // Keep cache size reasonable
                if cache.len() > 1000 {
                    let keys: Vec<String> = cache.keys().take(500).cloned().collect();
                    for key in keys {
                        cache.remove(&key);
                    }
                }
            }
        }
        return None;
    }

    // Only process GIN request logs or new format logs with request ID
    let is_gin_log = line.contains("[GIN]");
    let is_new_format = !is_gin_log && (line.contains("| POST") || line.contains("| GET"));

    if !is_gin_log && !is_new_format {
        return None;
    }

    // Skip management/internal routes we don't want to track
    if line.contains("/v0/management/")
        || line.contains("/v1/models")
        || line.contains("?uploadThread")
        || line.contains("?getCreditsByRequestId")
        || line.contains("?threadDisplayCostInfo")
        || line.contains("/api/internal")
        || line.contains("/api/telemetry")
        || line.contains("/api/otel")
    {
        return None;
    }

    // Only track actual API calls (chat completions, messages, etc.)
    let is_trackable = line.contains("/chat/completions")
        || line.contains("/v1/messages")
        || line.contains("/completions")
        || line.contains("/v1beta")
        || line.contains(":generateContent")
        || line.contains(":streamGenerateContent");

    if !is_trackable {
        return None;
    }

    // Try new format first: | request_id | status | duration | ip | METHOD "path"
    // Example: | f803bb77 | 200 | 12.453s | 127.0.0.1 | POST "/v1/messages"
    lazy_static::lazy_static! {
        static ref NEW_FORMAT_REGEX: Regex = Regex::new(
            r#"\|\s+([a-f0-9]{8}|-{8})\s+\|\s+(\d+)\s+\|\s+([^\s]+)\s+\|\s+[^\s]+\s+\|\s+(\w+)\s+\"([^\"]+)\""#
        ).unwrap();
        static ref GIN_REGEX: Regex = Regex::new(
            r#"\[GIN\]\s+(\d{4}/\d{2}/\d{2})\s+-\s+(\d{2}:\d{2}:\d{2})\s+\|\s+(\d+)\s+\|\s+([^\s]+)\s+\|\s+[^\s]+\s+\|\s+(\w+)\s+\"([^\"]+)\"(?:\s+\|\s+model=(\S+))?"#
        ).unwrap();
    }

    // Try new format
    if let Some(captures) = NEW_FORMAT_REGEX.captures(line) {
        let request_id = captures.get(1)?.as_str().to_string();
        let status: u16 = captures.get(2)?.as_str().parse().ok()?;
        let duration_str = captures.get(3)?.as_str();
        let method = captures.get(4)?.as_str().to_string();
        let path = captures.get(5)?.as_str().to_string();

        // Get timestamp from the beginning of the line if present
        let timestamp = extract_timestamp_from_line(line).unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64
        });

        // Parse duration to milliseconds
        let duration_ms = parse_duration(duration_str);

        // Look up model from cache using request_id, or fall back to path extraction
        let model = if request_id != "--------" {
            model_cache
                .read()
                .ok()
                .and_then(|cache| cache.get(&request_id).cloned())
                .or_else(|| extract_model_from_path(&path))
                .unwrap_or_else(|| "unknown".to_string())
        } else {
            extract_model_from_path(&path).unwrap_or_else(|| "unknown".to_string())
        };

        // Determine provider from model first (more accurate), fallback to path-based detection
        let model_provider = detect_provider_from_model(&model);
        let provider = if model_provider != "unknown" {
            model_provider
        } else {
            detect_provider_from_path(&path).unwrap_or_else(|| "unknown".to_string())
        };

        // Generate unique ID
        let count = request_counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let id = format!("req_{}_{}", timestamp, count);

        return Some(RequestLog {
            id,
            timestamp,
            provider,
            model,
            method,
            path,
            status,
            duration_ms,
            tokens_in: None,
            tokens_out: None,
            tokens_cached: None,
        });
    }

    // Fall back to GIN format
    let captures = GIN_REGEX.captures(line)?;

    let date_str = captures.get(1)?.as_str(); // 2025/12/04
    let time_str = captures.get(2)?.as_str(); // 20:51:48
    let status: u16 = captures.get(3)?.as_str().parse().ok()?;
    let duration_str = captures.get(4)?.as_str(); // 6.656s or 65ms
    let method = captures.get(5)?.as_str().to_string();
    let path = captures.get(6)?.as_str().to_string();

    // Parse timestamp
    let datetime_str = format!("{} {}", date_str.replace('/', "-"), time_str);
    let timestamp = chrono::NaiveDateTime::parse_from_str(&datetime_str, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|dt| {
            dt.and_local_timezone(chrono::Local)
                .earliest()
                .unwrap_or_else(|| chrono::Local::now())
                .timestamp_millis() as u64
        })
        .unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64
        });

    // Parse duration to milliseconds
    let duration_ms = parse_duration(duration_str);

    // Extract model from log line (group 7) or fall back to path extraction for Gemini
    let model = captures
        .get(7)
        .map(|m| m.as_str().to_string())
        .or_else(|| extract_model_from_path(&path))
        .unwrap_or_else(|| "unknown".to_string());

    // Determine provider from model first (more accurate), fallback to path-based detection
    let model_provider = detect_provider_from_model(&model);
    let provider = if model_provider != "unknown" {
        model_provider
    } else {
        detect_provider_from_path(&path).unwrap_or_else(|| "unknown".to_string())
    };

    let id = request_counter.fetch_add(1, Ordering::SeqCst);
    // Use timestamp + counter for unique ID (survives app restarts)
    let unique_id = format!("req_{}_{}", timestamp, id);

    Some(RequestLog {
        id: unique_id,
        timestamp,
        provider,
        model,
        method,
        path,
        status,
        duration_ms,
        tokens_in: None,     // Not available from GIN logs
        tokens_out: None,    // Not available from GIN logs
        tokens_cached: None, // Not available from GIN logs
    })
}

// Start watching the proxy log file for new entries
pub(crate) fn start_log_watcher(
    app_handle: tauri::AppHandle,
    log_path: std::path::PathBuf,
    running: Arc<AtomicBool>,
    request_counter: Arc<AtomicU64>,
) {
    std::thread::spawn(move || {
        // Model cache to associate request IDs with model names from DEBUG lines
        let model_cache: std::sync::RwLock<std::collections::HashMap<String, String>> =
            std::sync::RwLock::new(std::collections::HashMap::new());

        // Wait for log file to exist
        let mut attempts = 0;
        while !log_path.exists() && attempts < 30 {
            std::thread::sleep(std::time::Duration::from_millis(500));
            attempts += 1;
        }

        if !log_path.exists() {
            eprintln!("[LogWatcher] Log file not found: {:?}", log_path);
            return;
        }

        // Open file and seek to end (only watch new entries)
        let file = match std::fs::File::open(&log_path) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("[LogWatcher] Failed to open log file: {}", e);
                return;
            }
        };

        let mut reader = BufReader::new(file);
        // Seek to end to only process new lines
        if let Err(e) = reader.seek(SeekFrom::End(0)) {
            eprintln!("[LogWatcher] Failed to seek to end: {}", e);
            return;
        }

        // Track file position
        let mut last_pos = reader.stream_position().unwrap_or(0);

        println!("[LogWatcher] Started watching: {:?}", log_path);

        // Poll for new content (more reliable than notify for log files)
        while running.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(500));

            // Check if file has grown
            let current_size = std::fs::metadata(&log_path)
                .map(|m| m.len())
                .unwrap_or(last_pos);

            if current_size <= last_pos {
                // File might have been rotated (new file smaller than old position)
                if current_size < last_pos {
                    last_pos = 0;
                    // Reopen the file — rotation typically renames old file and creates new one
                    match std::fs::File::open(&log_path) {
                        Ok(new_file) => {
                            reader = BufReader::new(new_file);
                        }
                        Err(e) => {
                            eprintln!("[LogWatcher] Failed to reopen after rotation: {}", e);
                            continue;
                        }
                    }
                }
                continue;
            }

            // Read new lines
            let mut line = String::new();
            while reader.read_line(&mut line).unwrap_or(0) > 0 {
                if let Some(request_log) = parse_gin_log_line(&line, &request_counter, &model_cache)
                {
                    // Emit to frontend for live display
                    let _ = app_handle.emit("request-log", request_log.clone());

                    // Persist to history (without token data for now)
                    let mut history = load_request_history();

                    // Check for duplicate by timestamp and path
                    let is_duplicate = history.requests.iter().any(|r| {
                        r.timestamp == request_log.timestamp && r.path == request_log.path
                    });

                    if !is_duplicate {
                        // Load aggregate for cumulative stats
                        let mut agg = load_aggregate();

                        // Update aggregate counters
                        agg.total_requests += 1;
                        if request_log.status < 400 {
                            agg.total_success_count += 1;
                        } else {
                            agg.total_failure_count += 1;
                        }
                        agg.total_tokens_in += request_log.tokens_in.unwrap_or(0) as u64;
                        agg.total_tokens_out += request_log.tokens_out.unwrap_or(0) as u64;
                        agg.total_tokens_cached += request_log.tokens_cached.unwrap_or(0) as u64;

                        // Update time-series (today's date and current hour)
                        let now = chrono::Local::now();
                        let today = now.format("%Y-%m-%d").to_string();
                        let hour_label = now.format("%Y-%m-%dT%H").to_string();

                        // Update daily data
                        update_timeseries(&mut agg.requests_by_day, &today, 1);
                        let tokens = (request_log.tokens_in.unwrap_or(0)
                            + request_log.tokens_out.unwrap_or(0))
                            as u64;
                        update_timeseries(&mut agg.tokens_by_day, &today, tokens);

                        // Update hourly data (for Activity Patterns heatmap)
                        update_timeseries(&mut agg.requests_by_hour, &hour_label, 1);
                        update_timeseries(&mut agg.tokens_by_hour, &hour_label, tokens);

                        // Trim hourly data to keep last 7 days worth (168 hours)
                        const MAX_HOURLY_POINTS: usize = 168;
                        if agg.requests_by_hour.len() > MAX_HOURLY_POINTS {
                            agg.requests_by_hour = agg
                                .requests_by_hour
                                .split_off(agg.requests_by_hour.len() - MAX_HOURLY_POINTS);
                        }
                        if agg.tokens_by_hour.len() > MAX_HOURLY_POINTS {
                            agg.tokens_by_hour = agg
                                .tokens_by_hour
                                .split_off(agg.tokens_by_hour.len() - MAX_HOURLY_POINTS);
                        }

                        // Update model/provider stats
                        update_model_stats(&mut agg, &request_log);
                        update_provider_stats(&mut agg, &request_log);

                        // Update history (keep only last 500 for UI display)
                        history.requests.push(request_log);
                        if history.requests.len() > 500 {
                            history.requests =
                                history.requests.split_off(history.requests.len() - 500);
                        }

                        // Save both files
                        if let Err(e) = save_request_history(&history) {
                            eprintln!("[LogWatcher] Failed to save history: {}", e);
                        }
                        if let Err(e) = save_aggregate(&agg) {
                            eprintln!("[LogWatcher] Failed to save aggregate: {}", e);
                        }
                    }
                }
                line.clear();
            }

            last_pos = reader.stream_position().unwrap_or(last_pos);
        }

        println!("[LogWatcher] Stopped watching");
    });
}

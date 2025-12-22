# Split Storage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split request history into two files - one for recent logs (500 max), one for cumulative analytics (never trimmed) - so success rate displays correctly.

**Architecture:** Two JSON files in config directory. `history.json` keeps last 500 requests for UI display. `aggregate.json` tracks all-time totals, time-series, and per-model/provider stats. Updated atomically on each request. Migration from old format on first run.

**Tech Stack:** Rust (Tauri backend), SolidJS (frontend), serde_json (serialization)

**Reference:** See `DESIGN_SPLIT_STORAGE.md` for full design spec.

---

## Phase 1: Core Backend (Tasks 1-6)

### Task 1: Add Aggregate Types

**Files:**

- Modify: `src-tauri/src/types/usage.rs`

**Step 1: Add ModelStats struct**

Add after `ProviderUsage` struct (around line 64):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelStats {
    pub requests: u64,
    pub success_count: u64,
    pub tokens: u64,
}
```

**Step 2: Add Aggregate struct**

Add after `ModelStats`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Aggregate {
    pub created_at: u64,
    pub total_requests: u64,
    pub total_success_count: u64,
    pub total_failure_count: u64,
    pub total_tokens_in: u64,
    pub total_tokens_out: u64,
    pub total_cost_usd: f64,
    #[serde(default)]
    pub requests_by_day: Vec<TimeSeriesPoint>,
    #[serde(default)]
    pub tokens_by_day: Vec<TimeSeriesPoint>,
    #[serde(default)]
    pub model_stats: std::collections::HashMap<String, ModelStats>,
    #[serde(default)]
    pub provider_stats: std::collections::HashMap<String, ModelStats>,
}

impl Default for Aggregate {
    fn default() -> Self {
        Self {
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            total_requests: 0,
            total_success_count: 0,
            total_failure_count: 0,
            total_tokens_in: 0,
            total_tokens_out: 0,
            total_cost_usd: 0.0,
            requests_by_day: vec![],
            tokens_by_day: vec![],
            model_stats: std::collections::HashMap::new(),
            provider_stats: std::collections::HashMap::new(),
        }
    }
}
```

**Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors

**Step 4: Commit**

```bash
git add src-tauri/src/types/usage.rs
git commit -m "feat: add Aggregate struct for cumulative analytics"
```

---

### Task 2: Add Config Path Function

**Files:**

- Modify: `src-tauri/src/config.rs`

**Step 1: Add get_aggregate_path function**

Add after `get_history_path()` function (around line 160):

```rust
/// Aggregate analytics file path (cumulative stats, never trimmed)
pub fn get_aggregate_path() -> std::path::PathBuf {
    get_proxypal_config_dir().join("aggregate.json")
}
```

**Step 2: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors

**Step 3: Commit**

```bash
git add src-tauri/src/config.rs
git commit -m "feat: add get_aggregate_path config function"
```

---

### Task 3: Add Aggregate File Operations

**Files:**

- Modify: `src-tauri/src/lib.rs`

**Step 1: Add import for Aggregate type**

At top of file, find the existing import from types/usage and add Aggregate:

```rust
use crate::types::usage::{
    Aggregate, ModelStats, ModelUsage, ProviderUsage, RequestHistory, RequestLog,
    TimeSeriesPoint, UsageStats,
};
```

**Step 2: Add import for get_aggregate_path**

Find the import from config module and add get_aggregate_path:

```rust
use crate::config::{get_aggregate_path, get_auth_path, get_history_path, load_config, save_config_to_file};
```

**Step 3: Add load_aggregate function**

Add after `load_request_history()` function (around line 61):

```rust
fn load_aggregate() -> Aggregate {
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
```

**Step 4: Add save_aggregate function**

Add after `load_aggregate()`:

```rust
fn save_aggregate(agg: &Aggregate) -> Result<(), String> {
    let path = get_aggregate_path();
    let temp_path = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(agg).map_err(|e| e.to_string())?;
    std::fs::write(&temp_path, data).map_err(|e| e.to_string())?;
    std::fs::rename(&temp_path, &path).map_err(|e| e.to_string())
}
```

**Step 5: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors (warnings about unused functions OK for now)

**Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add load/save functions for aggregate.json"
```

---

### Task 4: Add Helper Functions for Aggregate Updates

**Files:**

- Modify: `src-tauri/src/lib.rs`

**Step 1: Add update_timeseries helper**

Add after `save_aggregate()`:

```rust
fn update_timeseries(series: &mut Vec<TimeSeriesPoint>, label: &str, increment: u64) {
    if let Some(point) = series.iter_mut().find(|p| p.label == label) {
        point.value += increment;
    } else {
        series.push(TimeSeriesPoint {
            label: label.to_string(),
            value: increment,
        });
    }
}
```

**Step 2: Add update_model_stats helper**

Add after `update_timeseries()`:

```rust
fn update_model_stats(agg: &mut Aggregate, req: &RequestLog) {
    let model = if req.model.is_empty() || req.model == "unknown" {
        "unknown".to_string()
    } else {
        req.model.clone()
    };

    let entry = agg.model_stats.entry(model).or_insert(ModelStats::default());
    entry.requests += 1;
    if req.status < 400 {
        entry.success_count += 1;
    }
    entry.tokens += (req.tokens_in.unwrap_or(0) + req.tokens_out.unwrap_or(0)) as u64;
}
```

**Step 3: Add update_provider_stats helper**

Add after `update_model_stats()`:

```rust
fn update_provider_stats(agg: &mut Aggregate, req: &RequestLog) {
    let provider = if req.provider.is_empty() || req.provider == "unknown" {
        "unknown".to_string()
    } else {
        req.provider.clone()
    };

    let entry = agg.provider_stats.entry(provider).or_insert(ModelStats::default());
    entry.requests += 1;
    if req.status < 400 {
        entry.success_count += 1;
    }
    entry.tokens += (req.tokens_in.unwrap_or(0) + req.tokens_out.unwrap_or(0)) as u64;
}
```

**Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors

**Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add helper functions for aggregate updates"
```

---

### Task 5: Update Log Watcher to Use Split Storage

**Files:**

- Modify: `src-tauri/src/lib.rs`

**Step 1: Find the log watcher duplicate check block**

Look for this code block in `start_log_watcher()` function (around line 270-290):

```rust
if !is_duplicate {
    history.total_request_count += 1;  // Track actual total
    if request_log.status < 400 {
        history.total_success_count += 1;  // Track successful requests
    }
    history.requests.push(request_log);

    // Keep only last 500 requests
    if history.requests.len() > 500 {
        history.requests = history.requests.split_off(history.requests.len() - 500);
    }

    if let Err(e) = save_request_history(&history) {
        eprintln!("[LogWatcher] Failed to save history: {}", e);
    }
}
```

**Step 2: Replace with split storage logic**

Replace the entire `if !is_duplicate { ... }` block with:

```rust
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

    // Update time-series (today's date)
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    update_timeseries(&mut agg.requests_by_day, &today, 1);
    let tokens = (request_log.tokens_in.unwrap_or(0) + request_log.tokens_out.unwrap_or(0)) as u64;
    update_timeseries(&mut agg.tokens_by_day, &today, tokens);

    // Update model/provider stats
    update_model_stats(&mut agg, &request_log);
    update_provider_stats(&mut agg, &request_log);

    // Update history (keep only last 500 for UI display)
    history.requests.push(request_log);
    if history.requests.len() > 500 {
        history.requests = history.requests.split_off(history.requests.len() - 500);
    }

    // Save both files
    if let Err(e) = save_request_history(&history) {
        eprintln!("[LogWatcher] Failed to save history: {}", e);
    }
    if let Err(e) = save_aggregate(&agg) {
        eprintln!("[LogWatcher] Failed to save aggregate: {}", e);
    }
}
```

**Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors

**Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: update log watcher to use split storage"
```

---

### Task 6: Update get_usage_stats to Use Aggregate

**Files:**

- Modify: `src-tauri/src/lib.rs`

**Step 1: Find the get_usage_stats function**

Look for `fn get_usage_stats() -> UsageStats` (around line 1760).

**Step 2: Replace entire function body**

Replace the entire function with:

```rust
#[tauri::command]
fn get_usage_stats() -> UsageStats {
    let agg = load_aggregate();
    let history = load_request_history();

    // If no data yet, return defaults
    if agg.total_requests == 0 && history.requests.is_empty() {
        return UsageStats::default();
    }

    // If aggregate is empty but history has data, this is migration case
    // Build aggregate from history
    let (total_requests, success_count, failure_count) = if agg.total_requests > 0 {
        (agg.total_requests, agg.total_success_count, agg.total_failure_count)
    } else {
        let total = history.requests.len() as u64;
        let success = history.requests.iter().filter(|r| r.status < 400).count() as u64;
        (total, success, total - success)
    };

    // Use aggregate tokens if available, else from history
    let (input_tokens, output_tokens) = if agg.total_tokens_in > 0 || agg.total_tokens_out > 0 {
        (agg.total_tokens_in, agg.total_tokens_out)
    } else {
        (history.total_tokens_in, history.total_tokens_out)
    };
    let total_tokens = input_tokens + output_tokens;

    // Calculate today's stats from aggregate time-series
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let requests_today = agg.requests_by_day.iter()
        .find(|p| p.label == today)
        .map(|p| p.value)
        .unwrap_or(0);
    let tokens_today = agg.tokens_by_day.iter()
        .find(|p| p.label == today)
        .map(|p| p.value)
        .unwrap_or(0);

    // Build model stats from aggregate
    let mut models: Vec<ModelUsage> = agg.model_stats.iter()
        .filter(|(model, _)| *model != "unknown" && !model.is_empty())
        .map(|(model, stats)| ModelUsage {
            model: model.clone(),
            requests: stats.requests,
            tokens: stats.tokens,
        })
        .collect();
    models.sort_by(|a, b| b.requests.cmp(&a.requests));

    // Build provider stats from aggregate
    let mut providers: Vec<ProviderUsage> = agg.provider_stats.iter()
        .filter(|(provider, _)| *provider != "unknown" && !provider.is_empty())
        .map(|(provider, stats)| ProviderUsage {
            provider: provider.clone(),
            requests: stats.requests,
            tokens: stats.tokens,
        })
        .collect();
    providers.sort_by(|a, b| b.requests.cmp(&a.requests));

    // Use aggregate time-series, fall back to history if empty
    let requests_by_day = if !agg.requests_by_day.is_empty() {
        agg.requests_by_day.clone()
    } else {
        // Build from history requests
        let mut map: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
        for req in &history.requests {
            let day = chrono::DateTime::from_timestamp_millis(req.timestamp as i64)
                .map(|dt| dt.format("%Y-%m-%d").to_string())
                .unwrap_or_default();
            *map.entry(day).or_insert(0) += 1;
        }
        let mut points: Vec<TimeSeriesPoint> = map.into_iter()
            .map(|(label, value)| TimeSeriesPoint { label, value })
            .collect();
        points.sort_by(|a, b| a.label.cmp(&b.label));
        points
    };

    let tokens_by_day = if !agg.tokens_by_day.is_empty() {
        agg.tokens_by_day.clone()
    } else {
        history.tokens_by_day.clone()
    };

    // Build hourly data from history (recent only)
    let mut requests_by_hour_map: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    let mut tokens_by_hour_map: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    for req in &history.requests {
        if let Some(dt) = chrono::DateTime::from_timestamp_millis(req.timestamp as i64) {
            let hour_label = dt.format("%Y-%m-%dT%H").to_string();
            *requests_by_hour_map.entry(hour_label.clone()).or_insert(0) += 1;
            let tokens = (req.tokens_in.unwrap_or(0) + req.tokens_out.unwrap_or(0)) as u64;
            *tokens_by_hour_map.entry(hour_label).or_insert(0) += tokens;
        }
    }

    let mut requests_by_hour: Vec<TimeSeriesPoint> = requests_by_hour_map.into_iter()
        .map(|(label, value)| TimeSeriesPoint { label, value })
        .collect();
    requests_by_hour.sort_by(|a, b| a.label.cmp(&b.label));

    let mut tokens_by_hour: Vec<TimeSeriesPoint> = tokens_by_hour_map.into_iter()
        .map(|(label, value)| TimeSeriesPoint { label, value })
        .collect();
    tokens_by_hour.sort_by(|a, b| a.label.cmp(&b.label));

    UsageStats {
        total_requests,
        success_count,
        failure_count,
        total_tokens,
        input_tokens,
        output_tokens,
        requests_today,
        tokens_today,
        models,
        providers,
        requests_by_day,
        tokens_by_day,
        requests_by_hour,
        tokens_by_hour,
    }
}
```

**Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors

**Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: update get_usage_stats to use aggregate data"
```

---

## Phase 2: Migration (Tasks 7-8)

### Task 7: Add Migration Function

**Files:**

- Modify: `src-tauri/src/lib.rs`

**Step 1: Add migrate_to_split_storage function**

Add after `save_aggregate()` function:

```rust
/// Migrate from old single-file format to split storage
/// Called once on app startup
fn migrate_to_split_storage() {
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
    agg.total_success_count = history.requests.iter()
        .filter(|r| r.status < 400)
        .count() as u64;
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
        Ok(_) => eprintln!("[Migration] Success! Created aggregate.json with {} requests", agg.total_requests),
        Err(e) => eprintln!("[Migration] Failed to save aggregate: {}", e),
    }
}
```

**Step 2: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors

**Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add migration function for split storage"
```

---

### Task 8: Call Migration on App Startup

**Files:**

- Modify: `src-tauri/src/lib.rs`

**Step 1: Find the run() function**

Look for `pub fn run()` (near end of file, around line 5100).

**Step 2: Add migration call at start of run()**

Find the beginning of the function body and add after the first few lines (before tauri::Builder):

```rust
pub fn run() {
    // Migrate old format to split storage on first run
    migrate_to_split_storage();

    // ... rest of existing code
```

**Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors

**Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: call migration on app startup"
```

---

## Phase 3: Frontend TypeScript (Task 9)

### Task 9: Verify Frontend Types Match

**Files:**

- Review: `src/lib/tauri.ts`

**Step 1: Check UsageStats interface**

Open `src/lib/tauri.ts` and verify the `UsageStats` interface matches the Rust struct. It should already have:

- `totalRequests`, `successCount`, `failureCount`
- `totalTokens`, `inputTokens`, `outputTokens`
- `requestsToday`, `tokensToday`
- `models`, `providers`
- `requestsByDay`, `tokensByDay`, `requestsByHour`, `tokensByHour`

**Step 2: Verify TypeScript compilation**

Run: `pnpm tsc --noEmit`
Expected: No errors

**Step 3: No commit needed if no changes**

---

## Phase 4: Integration Test (Task 10)

### Task 10: Manual Verification

**Step 1: Build and run the app**

Run: `pnpm tauri dev`
Expected: App launches without errors

**Step 2: Check migration happened**

Run: `ls -la ~/Library/Application\ Support/proxypal/`
Expected: Both `history.json` and `aggregate.json` exist

**Step 3: Check aggregate.json content**

Run: `cat ~/Library/Application\ Support/proxypal/aggregate.json | head -20`
Expected: Shows `totalRequests`, `totalSuccessCount` with correct values

**Step 4: Verify Analytics page**

1. Open ProxyPal
2. Go to Analytics page
3. Check success rate shows correct percentage (93%, not 3875%)
4. Check Total Requests shows correct count

**Step 5: Make a new request**

1. Use any AI tool through proxy
2. Check both files updated:
   - `history.json` has new request
   - `aggregate.json` has incremented counters

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete split storage implementation

- Add Aggregate struct for cumulative analytics
- Split history.json (500 requests) from aggregate.json (all-time stats)
- Auto-migrate old format on first run
- Success rate now calculated from accurate totals

Fixes: success rate showing 3875% instead of 93%"
```

---

## Summary

| Task | Description               | Files          | Est. Time |
| ---- | ------------------------- | -------------- | --------- |
| 1    | Add Aggregate types       | types/usage.rs | 5 min     |
| 2    | Add config path           | config.rs      | 2 min     |
| 3    | Add file operations       | lib.rs         | 5 min     |
| 4    | Add helper functions      | lib.rs         | 5 min     |
| 5    | Update log watcher        | lib.rs         | 10 min    |
| 6    | Update get_usage_stats    | lib.rs         | 15 min    |
| 7    | Add migration function    | lib.rs         | 10 min    |
| 8    | Call migration on startup | lib.rs         | 2 min     |
| 9    | Verify frontend types     | tauri.ts       | 2 min     |
| 10   | Manual verification       | N/A            | 10 min    |

**Total:** ~66 minutes

---

## Next Phase (Data Management UI)

After Phase 1 is complete and verified, Phase 2 adds:

- Export CSV/JSON commands
- Clear history command
- Reset analytics command
- Settings page UI component

See `DESIGN_SPLIT_STORAGE.md` sections 5-6 for Phase 2 details.

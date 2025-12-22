# Design: Split Storage Architecture for Request History & Analytics

**Date:** 2025-12-22  
**Status:** Approved  
**Effort:** 12-17 hours

---

## 1. Problem Statement

Current system stores all request data in a single `history.json` file:

- Keeps only last 500 requests (trims older ones)
- Tracks cumulative stats but loses accuracy when trimmed
- Users can't control what data to keep/clear
- No way to export historical analytics
- File grows unbounded if trim logic is removed

**Solution:** Split storage into two files—one for recent logs, one for aggregate analytics.

---

## 2. Architecture Overview

### File Structure

**Location:** `~/.config/proxypal/` (macOS) or platform equivalent

**`history.json`** (Recent request logs - UI display)

```json
{
  "requests": [
    {
      "id": "req_1766394932000_1",
      "timestamp": 1766394932000,
      "provider": "claude",
      "model": "claude-3-opus",
      "method": "POST",
      "path": "/v1/messages",
      "status": 200,
      "durationMs": 1234,
      "tokensIn": 500,
      "tokensOut": 300
    }
    // ... up to 500 most recent requests
  ],
  "totalTokensIn": 0,
  "totalTokensOut": 0,
  "totalCostUsd": 0.0
}
```

**`aggregate.json`** (Cumulative analytics - never trimmed)

```json
{
  "createdAt": 1666380000000,
  "totalRequests": 5847,
  "totalSuccessCount": 5420,
  "totalFailureCount": 427,
  "totalTokensIn": 125000000,
  "totalTokensOut": 85000000,
  "totalCostUsd": 128.45,
  "requestsByDay": [
    { "label": "2025-12-01", "value": 150 },
    { "label": "2025-12-02", "value": 200 },
    { "label": "2025-12-22", "value": 187 }
  ],
  "tokensByDay": [
    { "label": "2025-12-01", "value": 5000000 },
    { "label": "2025-12-02", "value": 6000000 },
    { "label": "2025-12-22", "value": 5500000 }
  ],
  "modelStats": {
    "claude-3-opus": {
      "requests": 1200,
      "successCount": 1180,
      "tokens": 45000000
    },
    "gpt-4": {
      "requests": 800,
      "successCount": 750,
      "tokens": 30000000
    }
  },
  "providerStats": {
    "anthropic": {
      "requests": 1200,
      "successCount": 1180,
      "tokens": 45000000
    },
    "openai": {
      "requests": 800,
      "successCount": 750,
      "tokens": 30000000
    }
  }
}
```

### File Sizes

- `history.json`: ~140KB (500 requests × ~280 bytes each)
- `aggregate.json`: ~10KB (metadata + time-series + model/provider stats)
- **Total:** ~150KB (vs potential 100MB+ with unbounded growth)

---

## 3. Data Flow

### On Every New Request

1. **Load `aggregate.json`** (or create if missing)
2. **Update aggregate counters:**
   - `totalRequests += 1`
   - If status < 400: `totalSuccessCount += 1`, else `totalFailureCount += 1`
   - `totalTokensIn += tokens_in`
   - `totalTokensOut += tokens_out`
3. **Update time-series:**
   - Find today's entry in `requestsByDay` → increment value
   - Find today's entry in `tokensByDay` → increment value
   - If not found, create new entry
4. **Update model/provider stats:**
   - Find provider in `providerStats` → increment counters
   - Find model in `modelStats` → increment counters
   - If not found, create new entry
5. **Load `history.json`**, push new request
6. **Trim if needed:** Keep only last 500 requests
7. **Atomic save:** Write both files (temp file → rename pattern)

### On Load (`get_usage_stats()`)

1. **Load `aggregate.json`** → Primary source for all-time stats
2. **Load `history.json`** → Used for recent request display
3. **Return merged result:**
   - All-time: `totalRequests`, `totalSuccessCount` from aggregate
   - Time-series: `requestsByDay`, `tokensByDay` from aggregate
   - Model/Provider: from aggregate
   - Recent requests: last 500 from history
4. **If aggregate missing:** Rebuild from history requests (migration path)

### On User Action

| Action              | Clears                  | Preserves                   |
| ------------------- | ----------------------- | --------------------------- |
| Clear History       | `history.json` requests | `aggregate.json` (all-time) |
| Reset Analytics     | `aggregate.json`        | Nothing                     |
| Export CSV (recent) | Nothing                 | Both files                  |
| Export JSON (agg)   | Nothing                 | Both files                  |

---

## 4. Rust Backend Implementation

### New Types (types/usage.rs)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStats {
    pub requests: u64,
    pub success_count: u64,
    pub tokens: u64,
}

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

### New Config Functions (config.rs)

```rust
pub fn get_aggregate_path() -> std::path::PathBuf {
    get_proxypal_config_dir().join("aggregate.json")
}

pub fn get_history_path() -> std::path::PathBuf {
    get_proxypal_config_dir().join("history.json")
}
```

### New File Operations (lib.rs)

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

fn save_aggregate(agg: &Aggregate) -> Result<(), String> {
    let path = get_aggregate_path();
    let temp_path = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(agg).map_err(|e| e.to_string())?;
    std::fs::write(&temp_path, data).map_err(|e| e.to_string())?;
    std::fs::rename(&temp_path, &path).map_err(|e| e.to_string())
}

fn save_both_atomic(history: &RequestHistory, agg: &Aggregate) -> Result<(), String> {
    // Save to temp files first
    let hist_path = get_history_path();
    let agg_path = get_aggregate_path();
    let hist_temp = hist_path.with_extension("json.tmp");
    let agg_temp = agg_path.with_extension("json.tmp");

    // Write both
    let hist_data = serde_json::to_string_pretty(history).map_err(|e| e.to_string())?;
    std::fs::write(&hist_temp, hist_data).map_err(|e| e.to_string())?;

    let agg_data = serde_json::to_string_pretty(agg).map_err(|e| e.to_string())?;
    std::fs::write(&agg_temp, agg_data).map_err(|e| e.to_string())?;

    // Rename both (atomic)
    std::fs::rename(&hist_temp, &hist_path).map_err(|e| e.to_string())?;
    std::fs::rename(&agg_temp, &agg_path).map_err(|e| e.to_string())?;

    Ok(())
}
```

### Update Log Watcher

In `start_log_watcher()`, replace the save logic:

```rust
if !is_duplicate {
    // Update both history and aggregate
    let mut agg = load_aggregate();

    // Update aggregate
    agg.total_requests += 1;
    if request_log.status < 400 {
        agg.total_success_count += 1;
    } else {
        agg.total_failure_count += 1;
    }
    agg.total_tokens_in += (request_log.tokens_in.unwrap_or(0) as u64);
    agg.total_tokens_out += (request_log.tokens_out.unwrap_or(0) as u64);

    // Update time-series (today's date)
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    update_or_create_timeseries(&mut agg.requests_by_day, &today, 1);
    update_or_create_timeseries(&mut agg.tokens_by_day, &today,
        (request_log.tokens_in.unwrap_or(0) + request_log.tokens_out.unwrap_or(0)) as u64);

    // Update model/provider stats
    update_model_stats(&mut agg, &request_log);
    update_provider_stats(&mut agg, &request_log);

    // Update history
    history.requests.push(request_log);
    if history.requests.len() > 500 {
        history.requests = history.requests.split_off(history.requests.len() - 500);
    }

    // Save atomically
    if let Err(e) = save_both_atomic(&history, &agg) {
        eprintln!("[LogWatcher] Failed to save: {}", e);
    }
}
```

### Update get_usage_stats()

```rust
#[tauri::command]
fn get_usage_stats() -> UsageStats {
    let agg = load_aggregate();
    let history = load_request_history();

    if agg.total_requests == 0 {
        return UsageStats::default();
    }

    UsageStats {
        total_requests: agg.total_requests,
        success_count: agg.total_success_count,
        failure_count: agg.total_failure_count,
        total_tokens: agg.total_tokens_in + agg.total_tokens_out,
        input_tokens: agg.total_tokens_in,
        output_tokens: agg.total_tokens_out,
        requests_today: calculate_today_value(&agg.requests_by_day),
        tokens_today: calculate_today_value(&agg.tokens_by_day),
        models: agg.model_stats.into_iter()
            .map(|(model, stats)| ModelUsage {
                model,
                requests: stats.requests,
                tokens: stats.tokens,
            })
            .collect(),
        providers: agg.provider_stats.into_iter()
            .map(|(provider, stats)| ProviderUsage {
                provider,
                requests: stats.requests,
                tokens: stats.tokens,
            })
            .collect(),
        requests_by_day: agg.requests_by_day,
        tokens_by_day: agg.tokens_by_day,
        requests_by_hour: vec![], // Calculate from history if needed
        tokens_by_hour: vec![],    // Calculate from history if needed
    }
}
```

---

## 5. Frontend UI Implementation

### Settings Page - Data Management Section

**Location:** `src/pages/Settings.tsx` → New "Data Management" section

**New Component:** `src/components/DataManagement.tsx`

```typescript
interface DataManagementProps {
  onDataCleared?: () => void;
  onAnalyticsReset?: () => void;
}

export function DataManagement(props: DataManagementProps) {
  const [stats, setStats] = createSignal<UsageStats | null>(null);

  // On mount, load stats
  onMount(async () => {
    const data = await getUsageStats();
    setStats(data);
  });

  // Functions for export/clear/reset
  const handleExportCSV = async () => { /* ... */ };
  const handleExportJSON = async () => { /* ... */ };
  const handleClearHistory = async () => { /* ... */ };
  const handleResetAnalytics = async () => { /* ... */ };

  return (
    <div class="space-y-6">
      {/* Request History Section */}
      <div class="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
        <h3 class="text-lg font-semibold mb-4">Request History</h3>
        <div class="space-y-3 mb-4">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            500 requests tracked
          </p>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            Date range: [oldest] to [newest]
          </p>
        </div>
        <div class="flex gap-2">
          <button
            onClick={handleExportCSV}
            class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            📥 Export as CSV
          </button>
          <button
            onClick={handleClearHistory}
            class="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
          >
            🗑️ Clear History
          </button>
        </div>
      </div>

      {/* All-Time Analytics Section */}
      <div class="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
        <h3 class="text-lg font-semibold mb-4">All-Time Analytics</h3>
        <Show when={stats()}>
          {(s) => (
            <>
              <div class="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <p class="text-sm text-gray-600 dark:text-gray-400">Total Requests</p>
                  <p class="text-2xl font-bold">{s().total_requests}</p>
                </div>
                <div>
                  <p class="text-sm text-gray-600 dark:text-gray-400">Success Rate</p>
                  <p class="text-2xl font-bold">
                    {((s().success_count / s().total_requests) * 100).toFixed(1)}%
                  </p>
                </div>
                <div>
                  <p class="text-sm text-gray-600 dark:text-gray-400">Tokens Used</p>
                  <p class="text-2xl font-bold">{formatTokens(s().total_tokens)}</p>
                </div>
                <div>
                  <p class="text-sm text-gray-600 dark:text-gray-400">Tracked Since</p>
                  <p class="text-sm font-semibold">Oct 15, 2025</p>
                </div>
              </div>
            </>
          )}
        </Show>
        <div class="flex gap-2">
          <button class="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600">
            📊 View Details
          </button>
          <button
            onClick={handleExportJSON}
            class="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
          >
            📤 Export JSON
          </button>
          <button
            onClick={handleResetAnalytics}
            class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            🔄 Reset Analytics
          </button>
        </div>
      </div>
    </div>
  );
}
```

### New Tauri Commands

Add to `src-tauri/src/lib.rs`:

```rust
#[tauri::command]
fn export_history_as_csv() -> Result<String, String> {
    let history = load_request_history();
    let mut csv = String::from("timestamp,provider,model,status,durationMs,tokensIn,tokensOut\n");

    for req in &history.requests {
        csv.push_str(&format!(
            "{},{},{},{},{},{},{}\n",
            req.timestamp,
            req.provider,
            req.model,
            req.status,
            req.duration_ms,
            req.tokens_in.unwrap_or(0),
            req.tokens_out.unwrap_or(0)
        ));
    }

    // Save to Downloads
    let downloads = dirs::download_dir().ok_or("Could not find Downloads")?;
    let filename = format!("proxypal-requests-{}.csv",
        chrono::Local::now().format("%Y-%m-%d_%H-%M-%S"));
    let path = downloads.join(&filename);
    std::fs::write(&path, csv).map_err(|e| e.to_string())?;

    Ok(filename)
}

#[tauri::command]
fn export_aggregate_as_json() -> Result<String, String> {
    let agg = load_aggregate();
    let json = serde_json::to_string_pretty(&agg).map_err(|e| e.to_string())?;

    let downloads = dirs::download_dir().ok_or("Could not find Downloads")?;
    let filename = format!("proxypal-aggregate-{}.json",
        chrono::Local::now().format("%Y-%m-%d_%H-%M-%S"));
    let path = downloads.join(&filename);
    std::fs::write(&path, json).map_err(|e| e.to_string())?;

    Ok(filename)
}

#[tauri::command]
fn clear_request_history() -> Result<(), String> {
    let mut history = load_request_history();
    history.requests.clear();
    save_request_history(&history)
}

#[tauri::command]
fn reset_aggregate_stats() -> Result<(), String> {
    let path = get_aggregate_path();
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

---

## 6. Migration & Backwards Compatibility

### On App Startup (lib.rs)

```rust
fn migrate_old_format() {
    let history = load_request_history();

    // If history has requests but aggregate doesn't exist, migrate
    if !history.requests.is_empty() && !get_aggregate_path().exists() {
        eprintln!("[Migration] Building aggregate from old history...");

        let mut agg = Aggregate::default();

        // Count from requests
        agg.total_requests = history.requests.len() as u64;
        agg.total_success_count = history.requests.iter()
            .filter(|r| r.status < 400).count() as u64;
        agg.total_failure_count = agg.total_requests - agg.total_success_count;

        // Use existing totals
        agg.total_tokens_in = history.total_tokens_in;
        agg.total_tokens_out = history.total_tokens_out;
        agg.total_cost_usd = history.total_cost_usd;

        // Save
        if let Err(e) = save_aggregate(&agg) {
            eprintln!("[Migration] Failed: {}", e);
        } else {
            eprintln!("[Migration] Success");
        }
    }
}

// Call in run() before starting app
pub fn run() {
    migrate_old_format();
    // ... rest of startup
}
```

---

## 7. Error Handling

| Scenario                   | Action                                                                         |
| -------------------------- | ------------------------------------------------------------------------------ |
| `aggregate.json` corrupted | Rebuild from history. Log warning.                                             |
| `history.json` corrupted   | Load aggregate only. Show empty request list. Log error.                       |
| Both missing               | Start fresh with defaults.                                                     |
| Partial write (crash)      | Atomic writes prevent this. Worst case: temp file stays, next write cleans it. |
| Permission denied on write | Log error. Continue with in-memory data. Show warning toast.                   |
| Disk full                  | Log error on save. Show "Storage full" warning.                                |

---

## 8. Testing Checklist

**Unit Tests (Rust)**

- [ ] Load empty aggregate → returns defaults
- [ ] Save + load roundtrip → data intact
- [ ] Migration from old format → aggregate built correctly
- [ ] Atomic writes → no partial state
- [ ] Time-series update → correct date grouping
- [ ] Model/provider stats → correct counting

**Integration Tests**

- [ ] Fresh install → both files created
- [ ] Old user upgrade → aggregate built, history preserved
- [ ] New request → both files updated
- [ ] Clear history → requests cleared, aggregate preserved
- [ ] Reset analytics → aggregate cleared, history preserved
- [ ] Concurrent access → no race conditions (test with file locks)

**UI Tests (Frontend)**

- [ ] Export CSV → file created with correct data
- [ ] Export JSON → file created with correct schema
- [ ] Clear history → confirmation modal works, stats preserved
- [ ] Reset analytics → confirmation modal works, history preserved
- [ ] Toast notifications → appear on success/error

**Manual Tests**

- [ ] Install fresh → stats accumulate correctly
- [ ] Upgrade from v0.2.2 → migration succeeds silently
- [ ] Simulate file corruption → app recovers gracefully
- [ ] Export files → match expected format
- [ ] Storage limits → app stays performant with large files

---

## 9. Success Criteria

✅ Accurate all-time analytics regardless of request log trimming  
✅ Users can export and clear history independently  
✅ File sizes stay bounded (~150KB total)  
✅ Seamless migration from old format  
✅ No data loss on upgrade  
✅ All-time stats show "Tracked since [date]"

---

## 10. Implementation Order

1. **Add types & config functions** (types/usage.rs, config.rs)
2. **Add file operations** (load_aggregate, save_aggregate, save_both_atomic)
3. **Update log watcher** (aggregate updates on every request)
4. **Update get_usage_stats()** (load from aggregate)
5. **Add migration logic** (old format → new split format)
6. **Add Tauri commands** (export, clear, reset)
7. **Build UI component** (DataManagement.tsx)
8. **Add to Settings page** (Settings.tsx)
9. **Test all scenarios**
10. **Document in CHANGELOG**

# Unified Reasoning Level Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two reasoning widgets (Thinking Budget + Reasoning Effort) with ONE "Reasoning level" selector driving reasoning for Claude, Gemini, OpenAI-compatible providers, and opencode/codex agents from the single `reasoning_effort_level` field.

**Architecture:** `reasoning_effort_level` (exists) becomes the only reasoning field; `thinking_budget_mode`/`thinking_budget_custom` are removed with one-time migration. `proxy.rs` derives claude `budget_tokens`, gemini `thinkingLevel`, and a NEW `protocol: "openai"` override rule with `reasoning_effort` from that level (verified working against CLIProxyAPI v7.2.95 with a `max_tokens: 7` marker test). Frontend merges the two settings cards into one.

**Tech Stack:** Rust (serde migration, YAML string generation), SolidJS + TS (settings card, i18n), CLIProxyAPI level↔budget map (verified in repo source: none=0, low=1024, medium=8192, high=24576, xhigh=32768).

## Global Constraints

- CLIProxyAPI level→budget map (from `internal/thinking/convert.go`): none=0, low=1024, medium=8192, high=24576, xhigh=32768. Budget values in YAML MUST use these.
- The openai-compat payload rule MUST use `protocol: "openai"` and snake_case `reasoning_effort` (verified in `openai_compat_executor_compact_test.go`).
- `gemini_thinking_injection` toggle stays (separate concern).
- `cargo test` after each Rust task; `pnpm tsc --noEmit` after each TS task.
- i18n keys must stay consistent across en/vi/zh-CN (TS enforces).

---

### Task 1: Rust — config schema, migration, remove thinking-budget commands

**Files:**

- Modify: `src-tauri/src/config.rs` (fields ~72-74, Default ~185-188, `migrate_config`)
- Modify: `src-tauri/src/commands/settings.rs` (delete 2 commands)
- Modify: `src-tauri/src/lib.rs` (~479-480, unregister)

**Interfaces:**

- Consumes: `reasoning_effort_level: String` (already in `AppConfig`)
- Produces: `AppConfig` without `thinking_budget_mode`/`thinking_budget_custom`; migration maps old values → `reasoning_effort_level`

- [ ] **Step 1: Remove fields from `AppConfig` and `Default`**

In `src-tauri/src/config.rs`, delete:

```rust
    pub thinking_budget_mode: String,
    #[serde(default)]
    pub thinking_budget_custom: u32,
```

and in the `Default` impl delete:

```rust
            thinking_budget_mode: "medium".to_string(),
            thinking_budget_custom: 16000,
```

(Keep `reasoning_effort_level: "medium".to_string()` and `gemini_thinking_injection`.)

- [ ] **Step 2: Add migration in `migrate_config`**

In `src-tauri/src/config.rs` `migrate_config`, add BEFORE the `changed` return (after the amp→rich block):

```rust
    // Migrate legacy thinking budget (Claude) to the unified reasoning level.
    // CLIProxyAPI level->budget map: none=0, low=1024, medium=8192, high=24576, xhigh=32768.
    // Old budgets: low=2048 (-> low), medium=8192 (-> medium), high=32768 (-> xhigh).
    // ponytail: legacy "custom" maps by old thresholds; 2048/8192/32768 semantics
    // shifted slightly (old high 32768 == new xhigh). Acceptable one-time approximation.
    if !config.thinking_budget_mode.is_empty() && config.reasoning_effort_level.is_empty() {
        let level = match config.thinking_budget_mode.as_str() {
            "low" => "low".to_string(),
            "high" => "xhigh".to_string(), // old high = 32768 == xhigh
            "custom" => {
                let custom = if config.thinking_budget_custom == 0 {
                    8192
                } else {
                    config.thinking_budget_custom
                };
                match custom {
                    0..=1024 => "low".to_string(),
                    1025..=8192 => "medium".to_string(),
                    8193..=24576 => "high".to_string(),
                    _ => "xhigh".to_string(),
                }
            }
            _ => "medium".to_string(), // "medium" or anything unknown
        };
        eprintln!("[ProxyPal] Migrating thinking budget to reasoning level: {}", level);
        config.reasoning_effort_level = level;
        changed = true;
    }
```

Note: the `thinking_budget_mode` field must still be parsed from old JSON — since we removed the struct fields, add them back with `skip_serializing` (same pattern as `amp_openai_providers`):

```rust
    /// DEPRECATED: parsed from old config.json for one-time migration only; never written.
    #[serde(default, skip_serializing)]
    pub thinking_budget_mode: String,
    /// DEPRECATED: parsed from old config.json for one-time migration only; never written.
    #[serde(default, skip_serializing)]
    pub thinking_budget_custom: u32,
```

- [ ] **Step 3: Delete thinking-budget commands**

In `src-tauri/src/commands/settings.rs`, delete `get_thinking_budget_settings` and `set_thinking_budget_settings` (the whole block from `// ============================================` "Thinking Budget Settings" comment through the end of `set_thinking_budget_settings`). Keep the `ReasoningEffortSettings` struct and its two commands.

- [ ] **Step 4: Unregister commands in `lib.rs`**

In `src-tauri/src/lib.rs`, delete:

```rust
            // Thinking Budget Settings
            commands::settings::get_thinking_budget_settings,
            commands::settings::set_thinking_budget_settings,
```

- [ ] **Step 5: Add migration test**

In `src-tauri/src/config.rs` `mod tests`, add:

```rust
    #[test]
    fn migrates_thinking_budget_to_reasoning_level() {
        let dir = test_dir("config-budget-to-level");
        let path = dir.join("config.json");

        // Old config with thinking budget, no reasoning level.
        let legacy_json = r#"{
  "port": 8317,
  "autoStart": true,
  "launchAtLogin": false,
  "thinkingBudgetMode": "high",
  "thinkingBudgetCustom": 16000
}"#;
        fs::write(&path, legacy_json).unwrap();
        let loaded = load_config_from_path(&path);
        assert_eq!(loaded.reasoning_effort_level, "xhigh");
        // Flat legacy fields never written back.
        let persisted = fs::read_to_string(&path).unwrap();
        assert!(!persisted.contains("thinkingBudget"));

        // custom mapping: 500 -> low, 40000 -> xhigh
        let legacy_json = r#"{
  "port": 8317,
  "autoStart": true,
  "launchAtLogin": false,
  "thinkingBudgetMode": "custom",
  "thinkingBudgetCustom": 500
}"#;
        fs::write(&path, legacy_json).unwrap();
        let loaded = load_config_from_path(&path);
        assert_eq!(loaded.reasoning_effort_level, "low");

        let legacy_json = r#"{
  "port": 8317,
  "autoStart": true,
  "launchAtLogin": false,
  "thinkingBudgetMode": "custom",
  "thinkingBudgetCustom": 40000
}"#;
        fs::write(&path, legacy_json).unwrap();
        let loaded = load_config_from_path(&path);
        assert_eq!(loaded.reasoning_effort_level, "xhigh");

        let _ = fs::remove_dir_all(dir);
    }
```

Wait — check migration trigger: `!config.thinking_budget_mode.is_empty() && config.reasoning_effort_level.is_empty()`. The Default sets `reasoning_effort_level: "medium"`, so `AppConfig::default()` has it non-empty. But old JSON has NO `reasoningEffortLevel` key → serde default `""`? Check the struct: `#[serde(default)] pub reasoning_effort_level: String` — Default for String is `""`, so old JSON → empty → migration triggers. Default impl's `"medium"` only applies to `AppConfig::default()` (new files). Good.

- [ ] **Step 6: Run tests**

Run: `cd src-tauri && cargo test`
Expected: all pass, including the new migration test.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/config.rs src-tauri/src/commands/settings.rs src-tauri/src/lib.rs
git commit -m "refactor: replace thinking budget with unified reasoning level (migration)"
```

---

### Task 2: Rust — YAML generation from reasoning level

**Files:**

- Modify: `src-tauri/src/commands/proxy.rs` (`resolve_thinking_budget`, `build_payload_section`, `build_gemini_override_section`, `build_proxy_config_yaml` ~65-80)

**Interfaces:**

- Consumes: `config.reasoning_effort_level: String`
- Produces: `build_payload_section(config) -> String` with claude budget rules, gemini override, and openai-compat override rule

- [ ] **Step 1: Replace `resolve_thinking_budget` with level helpers**

Delete `resolve_thinking_budget(config) -> (u32, &str)` (lines ~469-488). Add:

```rust
/// CLIProxyAPI level->budget map (internal/thinking/convert.go).
fn level_to_budget(level: &str) -> u32 {
    match level {
        "none" => 0,
        "low" => 1024,
        "medium" => 8192,
        "high" => 24576,
        "xhigh" => 32768,
        _ => 8192,
    }
}

/// Gemini thinking level names differ from the effort levels.
fn level_to_gemini(level: &str) -> &'static str {
    match level {
        "none" | "low" => "low",
        "medium" => "medium",
        "high" | "xhigh" => "high",
        _ => "medium",
    }
}
```

- [ ] **Step 2: Rewrite `build_payload_section`**

Replace the function (lines ~490-557) with a level-driven version. Keep the existing claude model lists (claude-sonnet-4-5 group + claude-opus-4-5/4-6 group) and the gemini override rules, but:

- Signature: `fn build_payload_section(config: &AppConfig) -> String`
- Budget: `let budget = level_to_budget(&config.reasoning_effort_level);`
- Claude default rules use `budget` in both `params` spots.
- Gemini override: `if config.gemini_thinking_injection { build_gemini_override_section(level_to_gemini(&config.reasoning_effort_level)) } else { String::new() }` — NOTE: `build_gemini_override_section` currently emits `  override:` as its first line and appends a trailing blank line. Verify against the format! template: the template ends with `{}` for the override section. Keep the structure identical, just change the level argument.
- The openai-compat rule MUST be emitted ALWAYS (independent of the gemini toggle):

```rust
/// `override:` section for OpenAI-compatible providers. Emitted unconditionally.
/// The `*` glob matches any model; `protocol: "openai"` restricts to OpenAI-compat
/// executors only (verified in CLIProxyAPI `matchModelPattern` + protocol gate).
fn build_openai_compat_reasoning_rules(level: &str) -> String {
    format!(
        r#"    # All OpenAI-compatible provider models - reasoning effort
    - models:
        - name: "*"
          protocol: "openai"
      params:
        reasoning_effort: "{}"
"#,
        level
    )
}
```

- In `build_payload_section`, assemble the `{}` slot as:

```rust
    let override_section = {
        let gemini_part = if config.gemini_thinking_injection {
            build_gemini_override_section(level_to_gemini(&config.reasoning_effort_level))
        } else {
            String::new()
        };
        if gemini_part.is_empty() {
            format!("  override:\n{}", build_openai_compat_reasoning_rules(&config.reasoning_effort_level))
        } else {
            format!("{}{}", gemini_part, build_openai_compat_reasoning_rules(&config.reasoning_effort_level))
        }
    };
```

This keeps a single `override:` key (duplicate-key YAML error otherwise — verified in logs:
`mapping key "override" already defined`) while emitting the openai rule regardless of the
gemini toggle.

- [ ] **Step 3: Update `build_proxy_config_yaml` call site**

At line ~78-79, replace:

```rust
    let (thinking_budget, thinking_mode_display) = resolve_thinking_budget(config);
    let payload_section = build_payload_section(config, thinking_budget, thinking_mode_display);
```

with:

```rust
    let payload_section = build_payload_section(config);
```

- [ ] **Step 4: Update existing test + add new tests**

In `mod tests` of `proxy.rs`:

- `build_proxy_config_yaml_forces_high_thinking_for_gemini_3_6_flash_high`: keep the assertion that the gemini-3.6 override exists, but the test config must now set `reasoning_effort_level: "high"` (it currently sets thinking_budget_mode — update the config construction).
- Add:

```rust
    #[test]
    fn yaml_emits_openai_compat_reasoning_effort_from_level() {
        let config = crate::config::AppConfig::default(); // medium
        let config_dir = std::path::PathBuf::from("/tmp/proxypal-test-openai-reasoning");
        let auth_dir = std::path::PathBuf::from("/tmp/.cli-proxy-api-test");
        let yaml = build_proxy_config_yaml(&config, &config_dir, &auth_dir, "").unwrap();
        assert!(yaml.contains("protocol: \"openai\""));
        assert!(yaml.contains("reasoning_effort: \"medium\""));
    }

    #[test]
    fn yaml_derives_claude_budget_from_level() {
        let mut config = crate::config::AppConfig::default();
        config.reasoning_effort_level = "xhigh".to_string();
        let config_dir = std::path::PathBuf::from("/tmp/proxypal-test-claude-budget");
        let auth_dir = std::path::PathBuf::from("/tmp/.cli-proxy-api-test");
        let yaml = build_proxy_config_yaml(&config, &config_dir, &auth_dir, "").unwrap();
        assert!(yaml.contains("\"thinking.budget_tokens\": 32768"));
    }
```

- [ ] **Step 5: Run tests**

Run: `cd src-tauri && cargo test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/proxy.rs
git commit -m "feat: emit reasoning_effort for OpenAI-compat providers + unified level in YAML"
```

---

### Task 3: TypeScript — remove thinking-budget bindings

**Files:**

- Modify: `src/lib/tauri/settings.ts` (delete `ThinkingBudgetSettings` + 2 fns)
- Modify: `src/lib/tauri/utils.ts` (delete `getThinkingBudgetTokens`)
- Modify: `src/lib/tauri/index.ts` if it re-exports them (check)

**Interfaces:**

- Consumes: nothing new
- Produces: only `ReasoningEffortLevel`, `getReasoningEffortSettings`, `setReasoningEffortSettings` remain

- [ ] **Step 1: Edit `settings.ts`**

Delete:

```ts
export interface ThinkingBudgetSettings {
  mode: "low" | "medium" | "high" | "custom";
  customBudget: number;
}

export async function getThinkingBudgetSettings(): Promise<ThinkingBudgetSettings> {
  return invoke("get_thinking_budget_settings");
}

export async function setThinkingBudgetSettings(settings: ThinkingBudgetSettings): Promise<void> {
  return invoke("set_thinking_budget_settings", { settings });
}
```

- [ ] **Step 2: Edit `utils.ts`**

Delete the `getThinkingBudgetTokens` function and the `ThinkingBudgetSettings` import. Check if anything else in utils.ts uses it.

- [ ] **Step 3: Check re-exports**

Run: `grep -rn "getThinkingBudgetSettings\|ThinkingBudgetSettings\|getThinkingBudgetTokens" src/ | grep -v "\.test\."`
Expected: only `ThinkingReasoningSettings.tsx` remains (fixed in Task 4).

- [ ] **Step 4: Commit**

```bash
git add src/lib/tauri/settings.ts src/lib/tauri/utils.ts
git commit -m "refactor(ts): drop thinking-budget bindings"
```

---

### Task 4: Frontend — one Reasoning level card + i18n

**Files:**

- Rewrite: `src/components/settings/ThinkingReasoningSettings.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/vi.ts`, `src/i18n/zh-CN.ts`

**Interfaces:**

- Consumes: `getReasoningEffortSettings`, `setReasoningEffortSettings`, `ReasoningEffortLevel` from `../../lib/tauri`; `getConfig`/`saveConfig` (Gemini toggle)
- Produces: single card with level select + Gemini injection switch

- [ ] **Step 1: Rewrite the component**

Replace the whole file. Remove: `getThinkingBudgetSettings`, `setThinkingBudgetSettings`, `getThinkingBudgetTokens` imports; `thinkingBudgetMode`, `thinkingBudgetCustom`, `savingThinkingBudget` signals; `saveThinkingBudget`. Remove the entire Thinking Budget card JSX (the first `<div class="space-y-4">` block with `settings.thinkingBudget.title`). Keep:

- `geminiThinkingInjection` signal + `saveGeminiThinkingInjection` (unchanged logic)
- `reasoningEffortLevel` signal + `saveReasoningEffort` (unchanged logic)
- The reasoning card: update the description to mention Claude, Gemini, OpenAI-compatible providers and agents. Keep the select (none/low/medium/high/xhigh), the current-value display, Apply button, and the per-request suffix note.
- Layout: one card titled with `settings.reasoning.title`, description updated, then the level select, then a divider with the Gemini injection switch below it (inside the same card, like the old Thinking Budget card had the switch at its bottom).

- [ ] **Step 2: Update i18n**

In `en.ts` (and mirror in `vi.ts`, `zh-CN.ts`):

- Update `settings.reasoning.descriptionPrefix`/`descriptionSuffix` to mention OpenAI-compatible providers (check current text first).
- Remove `settings.thinkingBudget.*` keys that are now unused EXCEPT `geminiInjection.*` (keep `settings.thinkingBudget.geminiInjection.label/description` — but they're nested under `thinkingBudget`; if removing the parent block is awkward, keep the whole `thinkingBudget` section key but only with `geminiInjection`). Simplest safe move: keep the `thinkingBudget` key object containing only `geminiInjection`, and delete the other keys. Verify with tsc.

- [ ] **Step 3: Type check**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/ThinkingReasoningSettings.tsx src/i18n/en.ts src/i18n/vi.ts src/i18n/zh-CN.ts
git commit -m "feat(settings): unified reasoning level card (Claude/Gemini/OpenAI-compat/agents)"
```

---

### Task 5: End-to-end verification

**Files:** none

- [ ] **Step 1: Full test suite**

Run: `cd src-tauri && cargo check && cargo test` → all green. `pnpm tsc --noEmit` → clean.

- [ ] **Step 2: Manual dev checklist**

Run: `pnpm tauri dev`

1. Settings → one "Reasoning level" card; select high → Apply → restart app → level persists (`config.json` has `reasoningEffortLevel: "high"`, no `thinkingBudget*` keys).
2. `proxy-config.yaml`: claude default rules have `thinking.budget_tokens: 24576` (high); gemini override rules present; `override` contains `- name: "*"` + `protocol: "openai"` + `reasoning_effort: "high"`.
3. curl through proxy: `glm-5.2:cloud` (ollama) — model responds; reasoning field length differs between low/high with `max_tokens: 500`. `z-ai/glm-5.2` (nvidia) — responds (may be slow).
4. Level `none` → YAML budget 0, `reasoning_effort: "none"`; restart and confirm.
5. opencode/codex agent config still gets `reasoning_effort` (check `~/.codex/config.toml` if present).
6. Existing nvidia/tokenrouter/ollama providers still listed in API Keys and proxied.

- [ ] **Step 3: Cleanup test YAML leftovers**

The manual payload test earlier may have left `proxy-config.yaml.bak-test` — it's in the app-support dir, not the repo; nothing to commit. Verify `git status` shows only intended files.

---

### Task 6: Commit plan/spec updates

- [ ] **Step 1: Verify spec/plan committed**

Run: `git status --short` — spec (already committed), plan (commit now):

```bash
git add docs/superpowers/plans/2026-08-04-unified-reasoning-level.md
git commit -m "docs: implementation plan for unified reasoning level"
```

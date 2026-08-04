# Design: Unified Reasoning Level (one widget instead of Thinking Budget + Reasoning Effort)

Date: 2026-08-04
Status: Approved
Supersedes: the two-widget settings block (Thinking Budget for Claude/Gemini + Reasoning Effort for GPT/Codex).

## Problem

ProxyPal has two separate reasoning settings that control the same underlying concept —
"how much should the model think":

1. **Thinking Budget** (Antigravity Claude): writes `payload.default` rules with
   `thinking.budget_tokens` (2048/8192/32768/custom) for claude-protocol models.
2. **Reasoning Effort** (GPT/Codex): writes `reasoning_effort` into opencode/codex agent
   configs. It is NOT applied to the proxy.

Additionally, OpenAI-compatible providers (kimi, glm, ollama, nvidia via custom
providers) have NO reasoning control at all — verified empirically:
`reasoning_effort` in payload `override` rules for `protocol: "openai"` DOES reach the
upstream (tested with `max_tokens: 7` marker → `completion_tokens: 7`), but ProxyPal
generates no such rules.

CLIProxyAPI (router-for-me/CLIProxyAPI, verified in source at v7.2.95) already
converts between the two vocabularies bidirectionally:

```go
// internal/thinking/convert.go
"none":    0,      "low":  1024,   "medium": 8192,
"high":    24576,  "xhigh": 32768, "max":    128000
// thresholds: 0→none, 1-512→minimal, 513-1024→low, 1025-8192→medium,
//             8193-24576→high, 24577+→xhigh
```

and translates `reasoning_effort` → `thinking.budget_tokens` when converting
OpenAI→Claude (`internal/translator/openai/claude/openai_claude_request.go:65-99`).

## Goal

Replace the two widgets with ONE "Reasoning level" selector (none/low/medium/high/xhigh)
that drives reasoning for ALL model families:
- Claude/Antigravity (budget_tokens, via level→budget conversion)
- Gemini 3 (generationConfig.thinkingConfig.thinkingLevel)
- OpenAI-compatible providers (reasoning_effort, new — previously impossible)
- opencode/codex agents (reasoning_effort, unchanged)

## Section 1 — Config schema (Rust)

### `src-tauri/src/config.rs`

- Keep `reasoning_effort_level: String` (default `"medium"`) as the ONLY reasoning field.
- Remove `thinking_budget_mode` and `thinking_budget_custom` from `AppConfig` and its
  `Default` impl.
- Keep `gemini_thinking_injection: bool` (separate toggle, not a level).
- Migration in `migrate_config` (one-time, `changed = true`):
  - `thinking_budget_mode: "low"` → `reasoning_effort_level = "low"`
  - `"medium"` → `"medium"`
  - `"high"` → `"high"`
  - `"custom"` → nearest level by new thresholds using `thinking_budget_custom`:
    `<1025 → "low"`, `1025-24576 → "medium"`, `>24576 → "high"`
    (fallback `"medium"` when custom is 0/absent)
  - delete the migrated fields from the struct (they are parsed via serde default,
    never serialized — same pattern as `amp_openai_providers`).
- `commands/settings.rs`: delete `get_thinking_budget_settings`/`set_thinking_budget_settings`.
  Keep `get_reasoning_effort_settings`/`set_reasoning_effort_settings` unchanged.
- `lib.rs`: unregister the two deleted commands.

### TS bindings (`src/lib/tauri/settings.ts` or wherever they live)

- Remove `getThinkingBudgetSettings`, `setThinkingBudgetSettings`, `getThinkingBudgetTokens`
  and the `ThinkingBudgetSettings` type; remove their imports in
  `ThinkingReasoningSettings.tsx`.
- Keep `getReasoningEffortSettings`, `setReasoningEffortSettings`, `ReasoningEffortLevel`.

## Section 2 — YAML generation (`src-tauri/src/commands/proxy.rs`)

Replace `build_payload_section(config, thinking_budget, thinking_mode_display)` with a
level-driven builder. Level → values (mirrors CLIProxyAPI `convert.go`):

```rust
fn level_to_budget(level: &str) -> u32 {
    match level {
        "none" => 0,
        "low" => 1024,
        "medium" => 8192,
        "high" => 24576,
        "xhigh" => 32768,
        _ => 8192, // default/unknown → medium
    }
}

fn level_to_gemini(level: &str) -> &str {
    match level {
        "none" | "low" => "low",
        "medium" => "medium",
        "high" | "xhigh" => "high",
        _ => "medium",
    }
}
```

Generated YAML (still one `payload:` block):

```yaml
# Reasoning level: high
payload:
  default:
    # Claude/Antigravity models — thinking budget derived from reasoning level
    - models:
        - name: "claude-sonnet-4-5"
          protocol: "claude"
        - name: "claude-sonnet-4-5-thinking"
          protocol: "claude"
        - name: "gemini-claude-sonnet-4-5"
          protocol: "claude"
        - name: "gemini-claude-sonnet-4-5-thinking"
          protocol: "claude"
      params:
        "thinking.budget_tokens": 24576
    - models:
        - name: "claude-opus-4-5"
          protocol: "claude"
        - name: "claude-opus-4-5-thinking"
          protocol: "claude"
        - name: "gemini-claude-opus-4-5"
          protocol: "claude"
        - name: "gemini-claude-opus-4-5-thinking"
          protocol: "claude"
        - name: "claude-opus-4-6"
          protocol: "claude"
        - name: "claude-opus-4-6-thinking"
          protocol: "claude"
        - name: "gemini-claude-opus-4-6"
          protocol: "claude"
        - name: "gemini-claude-opus-4-6-thinking"
          protocol: "claude"
      params:
        "thinking.budget_tokens": 24576
  override:
    # Gemini 3 models — thinking level
    - models:
        - name: "gemini-3-pro-preview*"
      params:
        generationConfig.thinkingConfig.thinkingLevel: "high"
    - models:
        - name: "gemini-3-flash-preview*"
      params:
        generationConfig.thinkingConfig.thinkingLevel: "high"
    - models:
        - name: "gemini-3.1-pro-high*"
      params:
        generationConfig.thinkingConfig.thinkingLevel: "high"
    - models:
        - name: "gemini-3.1-pro-low*"
      params:
        generationConfig.thinkingConfig.thinkingLevel: "low"
    - models:
        - name: "gemini-3.1-flash-*"
      params:
        generationConfig.thinkingConfig.thinkingLevel: "high"
    - models:
        - name: "gemini-3.5-flash-*"
      params:
        generationConfig.thinkingConfig.thinkingLevel: "high"
    - models:
        - name: "gemini-3.6-flash-*"
      params:
        generationConfig.thinkingConfig.thinkingLevel: "high"
    # All OpenAI-compatible provider models — reasoning_effort (new)
    - models:
        - name: "*"
          protocol: "openai"
      params:
        reasoning_effort: "high"
```

Details:
- The `default` claude rules keep their existing model lists; only the budget value
  becomes `level_to_budget(level)`. When level is `"none"`, budget 0 disables thinking
  (matches CLIProxyAPI `ConvertLevelToBudget("none") → 0`).
- The Gemini override rules keep their per-model `thinkingLevel` values (they already
  encode per-tier intent: `gemini-3.1-pro-low*` stays `low`); the NEW generic
  `name: "*" protocol: "openai"` rule uses `reasoning_effort: <level>`.
- The `*` glob matches any model; `protocol: "openai"` restricts the rule to
  OpenAI-compat executors only (`openai_compat_executor.go` passes `to.String()="openai"`).
  Claude/Gemini/Codex flows are unaffected. Verified: `matchModelPattern("*", m) == true`
  and protocol gate `strings.EqualFold(ep, protocol)`.
- Keep `build_gemini_override_section` but drive its thinking level from the new level
  mapping when `gemini_thinking_injection` is enabled (current behavior: 2048→low,
  8192→medium, else high; new: `level_to_gemini(level)`), else emit no gemini override.
- `resolve_thinking_budget` is deleted; `build_proxy_config_yaml` calls the new builder
  with `&config.reasoning_effort_level`.

## Section 3 — Frontend: one widget

### `src/components/settings/ThinkingReasoningSettings.tsx`

Merge the two blocks into ONE "Reasoning level" card:

- Single select: none / low / medium / high / xhigh (existing `ReasoningEffortLevel`
  values, existing i18n keys `settings.level.*` — reuse `noneDisabled`, `low1024`,
  `medium8192Approx`, `high24576`, `extraHigh32768`; verify labels match new budget
  semantics and update the `en.ts`/`vi.ts`/`zh-CN.ts` strings if they say "tokens").
- Description updated: applies to Claude, Gemini, OpenAI-compatible providers and
  opencode/codex agents. Per-request override note (model suffix `gpt-5(high)`)
  stays.
- Keep the Gemini thinking injection Switch (separate concern).
- Remove the Thinking Budget card markup, `thinkingBudgetMode/custom` signals,
  `saveThinkingBudget`, `getThinkingBudgetSettings` import.

### i18n

- `settings.thinkingBudget.*` keys: remove or keep unused? Remove the ones only used by
  the deleted card (`title`, `description`, `budgetLevel`, `customTokenBudget`,
  `customRange`, `current`, `tokens`, `apply`). Keep `geminiInjection.*` and
  `settings.reasoning.*`. Update `settings.reasoning.descriptionPrefix/Suffix` to
  mention OpenAI-compatible providers.
- Do this in `en.ts`, `vi.ts`, `zh-CN.ts` consistently (TS type-check enforces keys).

## Section 4 — Tests

### Rust (`src-tauri/src/commands/proxy.rs` tests)

- Update `build_proxy_config_yaml_forces_high_thinking_for_gemini_3_6_flash_high` —
  Gemini section still emitted, but now driven by `reasoning_effort_level`.
- New: `yaml_emits_openai_compat_reasoning_effort_from_level` —
  config with `reasoning_effort_level: "high"` → YAML contains
  `protocol: "openai"` rule with `reasoning_effort: "high"`; with `"none"` →
  `reasoning_effort: "none"`.
- New: `yaml_derives_claude_budget_from_level` — `"medium"` → `thinking.budget_tokens: 8192`;
  `"xhigh"` → 32768; `"none"` → 0.

### Rust (`src-tauri/src/config.rs` tests)

- New: `migrates_thinking_budget_to_reasoning_level` — old JSON with
  `thinkingBudgetMode: "high"` + `thinkingBudgetCustom: 16000` → load →
  `reasoning_effort_level == "high"`; `"custom"` + `custom: 40000` → `"xhigh"` is NOT
  produced (mapping caps at "high") — assert `"high"`; `"custom"` + `custom: 500` → `"low"`.
- Existing reasoning-effort tests (agents) must still pass unchanged.

### TypeScript

- `pnpm tsc --noEmit` clean after removing the thinking-budget bindings.

## Section 5 — Manual verification checklist

1. Launch dev. Settings → one "Reasoning level" card, selector persists across restart.
2. `proxy-config.yaml` contains: claude `default` rules with budget from level;
   `override` gemini rules; `override` `protocol: "openai"` rule with `reasoning_effort`.
3. curl through proxy (`z-ai/glm-5.2` on nvidia, `glm-5.2:cloud` on ollama):
   - `reasoning_effort` visible effect on ollama glm (reasoning field length changes
     between low/high; content completes with enough max_tokens).
   - kimi via tokenrouter still fails upstream (quota) — expected, not a regression.
4. Claude/Antigravity: with level `none`, `thinking.budget_tokens: 0` in YAML; with
   `high`, 24576.
5. opencode/codex agent config still receives `reasoning_effort` from the same field.
6. Dock/tray regression unchanged (not touched by this change).

## Out of scope

- Per-provider reasoning override (single global level only; per-request model
  suffixes `(low/high)` already exist).
- Exposing the CLIProxyAPI `max`/`minimal`/`auto` levels (UI keeps the five known
  levels; values are passed through as-is so power users can still hand-edit YAML).
- Removing `gemini_thinking_injection` (independent toggle, still meaningful).

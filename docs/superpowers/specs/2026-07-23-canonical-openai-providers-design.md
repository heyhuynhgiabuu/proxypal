# Canonical OpenAI-Compatible Providers + Tray Quit

**Date:** 2026-07-23
**Supersedes:** PR #231, PR #233 (closed in favor of one combined PR)
**Status:** Approved (design phase)

## Problem

Two bugs plus one architectural defect, plus a tray/UX gap, plus an upstream
lag. The owner of `heyhuynhgiabuu/proxypal` requested changes on both open PRs
because the API-key persistence fix created **two competing persisted sources**
for the same OpenAI-compatible providers.

### Bug A — Persistence layer (`api_keys.rs`)
`set_openai_compatible_providers()` converted `OpenAICompatibleProvider`
(rich: `api_key_entries[]`, `prefix`, `headers`, per-key `proxy_url`) into the
legacy `AmpOpenAIProvider` (single `api_key`, no prefix). Only the first key
survived; the rest and the prefix were dropped on restart.

### Bug B — YAML generator (`proxy.rs`)
The proxy YAML is regenerated from `config.json` on restart. Four builders
omitted `prefix`: `build_openai_compat_section`, `build_claude_api_key_section`,
`build_gemini_api_key_section`, `build_codex_api_key_section`.

### Defect C — Two competing persisted representations (review blocker)
`set_openai_compatible_providers` writes **both** `openai_compatible_providers`
(rich) and `amp_openai_providers` (flat), while `build_openai_compat_section`
prefers the rich field whenever non-empty. The existing **Settings UI** edits
only `ampOpenaiProviders`. Therefore, once the API Keys page populates the rich
field, later Settings edits/additions/deletions are ignored by generated proxy
config, and can be overwritten later. Data loss.

### Tray gap D
On macOS, closing the window hides to tray (Dock icon gone, Mission Control
hidden) but the only way to quit is the tray menu's "Quit ProxyPal". This
already exists and works (`app.exit(0)` + `ExitRequested` cleanup of
proxy/copilot/SSH). No code change needed; the gap is discoverability and
**proof** the Dock/black-window fix is real.

### Upstream lag E
Local `main` is v0.4.47; upstream released v0.4.48 (adds Gemini 3.6 flash-high
override + a test in `proxy.rs`, touches `proxy.rs` away from our edits →
trivial conflict expected).

## Goal

One canonical persisted representation for OpenAI-compatible providers — the
`openai_compatible_providers` rich field — so that both the API Keys page and
the Settings page read and write through it, matching the already-clean xAI
pattern (`xai_api_keys`: single field, single write path, prefix/headers live
on each entry). Plus restart regression tests, a manual Dock checklist, and a
clean combined PR on top of upstream v0.4.48.

## Non-goals

- No new tray menu item (Quit already works). No new Settings UI fields for
  prefix/headers — Settings keeps its simple single-key form; editing via
  Settings writes a rich entry with one `api_key_entry` and no prefix.
- No live management-API push from Settings (Settings keeps the
  `save_config`→persist→regenerate-YAML path; API Keys keeps the
  management-API push path). Both converge on the same persisted field.

## Architecture

```
              ┌─────────────────────────────────────────────┐
              │      openai_compatible_providers (RICH)      │ ← CANONICAL
              │   the only field proxy.rs and tests read     │
              └─────────────────────────────────────────────┘
                  ▲                              ▲
                  │ writes                       │ writes
        ┌─────────┴────────┐           ┌─────────┴──────────┐
        │  API Keys page    │           │  Settings page      │
        │  set_openai_      │           │  save_config: maps │
        │  compatible_      │           │  amp form → rich   │
        │  providers()      │           │  (one entry, no    │
        │  (mgmt API +      │           │  prefix)           │
        │   persist rich)   │           │                    │
        └───────────────────┘           └────────────────────┘

 amp_openai_providers (LEGACY): only read once on load to migrate → rich,
                               then never written again. Kept in the struct
                               so old config.json files keep parsing.
```

The rich field is the single source of truth. xAI already works this way;
this PR makes OpenAI-compatible behave identically.

## Components & changes

### 1. `src-tauri/src/commands/api_keys.rs` — NO change (already a derived mirror)
The existing `set_openai_compatible_providers` derives `amp_openai_providers` from
the rich list it just wrote — i.e. amp is a **derived flat mirror**, not an
independent source. That derivation is correct and must stay: it keeps the
Settings UI (which reads `ampOpenaiProviders`) fresh within the same session
after an API Keys edit. The real defect is only in the **Settings write path**
(`save_config`), addressed in §4 below.

### 2. `src-tauri/src/commands/proxy.rs` — generator reads rich only
- `build_openai_compat_section`: delete the `else` fallback branch that reads
  `amp_openai_providers`. Read `openai_compatible_providers` exclusively.
- `build_claude_api_key_section`, `build_gemini_api_key_section`,
  `build_codex_api_key_section`: emit `prefix` (already done in current code —
  keep, these are part of Bug B and already shipped in the cherry-picked
  commit; verify they survive the v0.4.48 rebase).

### 3. `src-tauri/src/config.rs` — migration on load (amp → rich, once)
In `migrate_config`, after the existing `amp_openai_provider` → `amp_openai_providers`
migration:
- If `openai_compatible_providers` is empty and `amp_openai_providers` is
  non-empty: map each `AmpOpenAIProvider` → `OpenAICompatibleProvider`
  (`api_key_entries: [{ api_key }]`, no prefix/headers, models mapped). Set
  `openai_compatible_providers`. Mark `changed = true`.
- Then set `amp_openai_providers` to the flattened view of rich so the Settings
  UI (which still reads `ampOpenaiProviders` until the frontend switch) shows
  the right list and so the persisted file is internally consistent during the
  transition. The Settings UI keeps reading `ampOpenaiProviders`, so this flat
  mirror is permanent, not transitional (see Components §5).

A single helper `fn amp_to_rich(amp: &[AmpOpenAIProvider]) -> Vec<OpenAICompatibleProvider>`
and `fn rich_to_amp(rich: &[OpenAICompatibleProvider]) -> Vec<AmpOpenAIProvider>`
(local to `config.rs` or `types/amp.rs`) make both directions explicit and
unit-testable. This IS the "explicit synchronization at every write path" the
owner asked for, concentrated in one place.

### 4. `src-tauri/src/commands/config.rs` — Settings write path lifts amp → rich (root cause fix)
**This is the core fix Defect C.** `save_config` currently persists whatever
`amp_openai_providers` the Settings UI sent and never touches rich, so rich goes
stale and the generator ignores Settings edits. Fix: before `persist_config`, if
the incoming config has `openai_compatible_providers` empty (the signal the
frontend sends, see §5) and `amp_openai_providers` non-empty:
- For each `AmpOpenAIProvider`, look up a matching existing in-state rich entry
  by `(name, base_url)`. If matched, keep that rich entry but **replace its
  `api_key_entries`** with `[{ api_key: amp.api_key }]` — this preserves the
  rich-only fields (`prefix`, `headers`, extra keys above the first, per-key
  `proxy_url`) that the Settings UI cannot edit. If not matched, create a new
  rich entry via `amp_to_rich` (single key, no prefix). Rich entries with no
  amp match are dropped (the Settings intent is authoritative for the set).
- Then set `amp_openai_providers = rich_to_amp(rich)` so the flat mirror is
  faithful to the lifted rich.
Reconciliation by `(name, base_url)` is a heuristic with a known ceiling: two
providers with the same name+baseUrl would collide. Mark it `ponytail:` in the
code. The UI already dedupes by name, so this is acceptable.

### 5. Frontend — `src/components/settings/OpenAIProviderSettings.tsx`
`saveOpenAIProvider` / `deleteOpenAIProvider` continue to mutate `ampOpenaiProviders`
and call `saveConfig(newConfig)`. **Required single-line change:** in
`OpenAIProviderSettings.tsx`, when building `newConfig`, set
`openaiCompatibleProviders: []` explicitly. This guarantees the Rust `save_config`
normalizer's "amp populated, rich empty" branch triggers predictably, so Settings
edits always land in the canonical rich field. Without this clear, the
Settings-held config object may carry a stale rich field from a prior API Keys
edit, and the normalizer would treat rich as authoritative and ignore the
Settings edit — reintroducing Defect C. The diff is one line per save/delete
handler; the rest of Settings is unchanged.

### 6. Read sites for model routing — `src/pages/Settings.tsx`, `src/components/settings/AdvancedSettings.tsx`
These read `ampOpenaiProviders` to list model aliases for routing. They keep
working because `migrate_config` repopulates `ampOpenai_providers` as the
flattened mirror of rich on load. No change needed unless we choose to migrate
these reads to rich in the same PR (deferred — out of scope unless trivial).

### 7. Tray — `src-tauri/src/lib.rs` — no code change
`setup_tray` already builds the menu with `Toggle Proxy` / `Open Dashboard` /
`Quit ProxyPal`; the `quit` handler calls `app.exit(0)`; `ExitRequested` kills
the proxy, copilot, and SSH. `show_main_window` / `hide_main_window` already
use Tauri native `set_dock_visibility` / `app.show()` / `app.hide()`. This PR
validates the existing fix with a **manual checklist** (below), not code.

## Testing

### Rust unit tests (cargo) — required, automated
Add to `src-tauri/src/commands/proxy.rs` and `src-tauri/src/config.rs` test
modules, following the existing `build_proxy_config_yaml_includes_xai_api_key_entries`
pattern:

1. **`restart_persists_rich_multi_key_and_prefix`** — build an `AppConfig` with
   an `OpenAICompatibleProvider` that has 3 `api_key_entries` and a `prefix`.
   `save_config_to_file` to a temp path, `load_config_from_path` it back.
   Assert 3 entries survive, prefix survives. (Bug A regression.)
2. **`settings_write_lands_in_canonical_field`** — build an `AppConfig` with
   `amp_openai_providers` populated and `openai_compatible_providers` empty (the
   Settings case). Run the normalization function. Assert
   `openai_compatible_providers` is now populated and matches amp. (Defect C
   regression — the core of the review.)
3. **`generator_emits_all_keys_and_prefix`** — build an `AppConfig` with a rich
   provider (2 entries + prefix) and call `build_proxy_config_yaml`. Assert the
   YAML contains both `api-key:` lines and a `prefix:` line. (Bug B regression.)
4. **`migration_amp_to_rich_on_load`** — write a config.json containing only
   `ampOpenaiProviders` (old app format), `openaiCompatibleProviders` absent.
   `load_config_from_path`. Assert `openai_compatible_providers` is populated
   from amp and `amp_openai_providers` matches the flattened mirror. Run it
   again on the saved file — assert idempotent (second load does not double).
5. Keep the existing xAI test passing unmodified as the reference for the
   pattern.

These are pure, headless, fast, and cover both the API Keys and Settings flows
across a restart — exactly what the owner asked for.

### Manual Dock/black-window checklist — required, reproducible
Checked by the user locally before push, recorded verbatim in the PR body:

- [ ] Start app, open window. Dock icon visible. Window paints (not black).
- [ ] Click the red close button. Window hides, Dock icon disappears, app
      vanishes from Mission Control and ⌘ Tab switcher.
- [ ] Click the tray icon. Window reopens, **not black**, paints correctly.
- [ ] Repeat open→close→open 5 times. Window never renders black.
- [ ] Right-click tray → "Quit ProxyPal". App exits; no `cli-proxy-api` or
      `copilot-api` process remains (`pkill -f cli-proxy-api` returns nothing,
      `pkill -f copilot-api` returns nothing).
- [ ] Disable "close to tray" in Settings. Close window with red button. App
      fully quits (same process check).

An automated macOS GUI test is out of scope — no headless macOS display in CI
and the WindowManager/Dock APIs are not unit-testable. The checklist is the
"reproducible validation evidence" the owner requested.

## Local build & test before push

Before any push or PR:

1. `pnpm tsc --noEmit` — frontend type check (the `AppConfig` shape and
   `openaiCompatibleProviders` optional field must still type-check).
2. `cd src-tauri && cargo test` — run new + existing unit tests, all green.
3. `cd src-tauri && cargo check` — backend compiles.
4. `pnpm tauri dev` — launch locally so the user can run the manual Dock
   checklist with a working app and verify keys persist across restart via
   App > Quit and relaunch.

Only after the user confirms the checklist passes do we push.

## Logistics

1. `git fetch upstream` (done; upstream at v0.4.48).
2. New branch `fix/canonical-openai-providers` from `upstream/main`.
3. `git cherry-pick 2f71ca3` (prefix persistence) and `git cherry-pick 4e4dc07`
   (Dock fix). Resolve the expected trivial conflict in `proxy.rs` (Gemini 3.6
   override region vs. our prefix builders — disjoint hunks).
4. Apply the canonical refactor + tests as new commit(s) on top.
5. Push branch to `origin` (the `izzzzzi/proxypal` fork).
6. Open one PR to `heyhuynhgiabuu/proxypal:main` with body:
   > Supersedes #231 and #233. Addresses review feedback: single canonical
   > representation for OpenAI-compatible providers (rich field only, xAI
   > pattern). Adds restart regression tests for both API Keys and Settings
   > flows. macOS Dock/black-window fix validated with a manual checklist (no
   > headless macOS GUI in CI). Built on v0.4.48.
7. Close #231 and #233 with a comment linking the new PR.

## Risks

- **Reconciliation by `(name, base_url)`** in `save_config` could mis-merge if a
  user has two providers with the same name+baseUrl but different keys. Low
  risk (UI would treat them as one anyway); document the keying in a code
  comment. `ponytail:` the heuristic.
- Settings UI continuing to read `ampOpenaiProviders` only works because load
  repopulates the flat mirror. If a future change stops repopulating it,
  Settings breaks silently — guard with the migration test #4.
- Cherry-pick conflict in `proxy.rs` is expected to be trivial; if it is not,
  stop and re-evaluate rather than force.

# Plan: Canonical OpenAI-Compatible Providers (executing spec)

Source spec: `docs/superpowers/specs/2026-07-23-canonical-openai-providers-design.md`
Branch: `fix/canonical-openai-providers` (off `upstream/main` v0.4.48 + 2 cherry-picks)

## Done

- [x] Branch off `upstream/main` (41f0f94, v0.4.48)
- [x] `git cherry-pick 2f71ca3` (prefix/multi-key persistence) — clean
- [x] `git cherry-pick 4e4dc07` (macOS tray Dock/black-window) — clean

## Code edits (literal per spec)

### 1. `src-tauri/src/commands/proxy.rs` — `build_openai_compat_section`

- Delete the `else { amp_openai_providers fallback }` branch.
- Read `openai_compatible_providers` exclusively. Rich is canonical.

### 2. `src-tauri/src/config.rs` — migration + flat mirror helpers

- Add `amp_to_rich(&[AmpOpenAIProvider]) -> Vec<OpenAICompatibleProvider>`.
- Add `rich_to_amp(&[OpenAICompatibleProvider], existing: &[AmpOpenAIProvider]) -> Vec<AmpOpenAIProvider>`
  — preserves existing `id` by `(name, base_url)` match (idempotent, no UUID churn).
- In `migrate_config`, after existing single→array migration:
  - if `openai_compatible_providers` empty && `amp_openai_providers` nonempty →
    `openai_compatible_providers = amp_to_rich(amp)`, `changed = true`.
  - Always (every load, no `changed`): `amp_openai_providers = rich_to_amp(rich, existing_amp)`
    so the flat mirror the Settings UI reads stays faithful to canonical rich.

### 3. `src-tauri/src/commands/config.rs` — `save_config` lifts amp → rich (Defect C root fix)

- Add pure `lift_amp_to_rich(config: &mut AppConfig, current_rich: &[OpenAICompatibleProvider])`.
- In `save_config`, before `persist_config`: call `lift_amp_to_rich(&mut config, &state.config.lock().unwrap().openai_compatible_providers)`.
- Lift logic (spec §4 resolved): if incoming `openai_compatible_providers` empty &&
  `amp_openai_providers` nonempty (the Settings signal):
  - For each amp: match in `current_rich` by `(name, base_url)`. Matched → update
    first entry's `api_key` to `amp.api_key`, keep extras/prefix/headers/models.
    Not matched → new rich via `amp_to_rich([amp])`.
  - Drop rich entries with no amp match (Settings is authoritative for the provider set).
  - Then `amp_openai_providers = rich_to_amp(new_rich, incoming.amp)` (faithful flat mirror).
- `ponytail:` comment on `(name, base_url)` heuristic ceiling (collides on dup name+url;
  UI dedupes by name → acceptable; upgrade path = explicit stable id).

### 4. `src/components/settings/OpenAIProviderSettings.tsx`

- `saveOpenAIProvider` + `deleteOpenAIProvider`: set `openaiCompatibleProviders: []`
  explicitly in `newConfig` so the Rust normalizer's Settings branch triggers.

### 5. Tests

- `proxy.rs`: `generator_emits_all_keys_and_prefix` — rich provider (2 entries + prefix),
  `build_proxy_config_yaml` → yaml has both `api-key:` lines + `prefix:` line.
- `config.rs`: `restart_persists_rich_multi_key_and_prefix` — save→load round-trip keeps
  3 entries + prefix (Bug A regression).
- `config.rs`: `settings_write_lands_in_canonical_field` — amp populated, rich empty →
  `lift_amp_to_rich` → rich populated, matches amp.
- `config.rs`: `migration_amp_to_rich_on_load` — old json only `ampOpenaiProviders` →
  load → rich populated, amp == flat mirror; reload idempotent (no doubling).

## Verify before push

1. `cd src-tauri && cargo check && cargo test`
2. `pnpm tsc --noEmit`
3. `pnpm tauri dev` → user runs manual Dock/black-window checklist (spec Testing §).

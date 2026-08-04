# Design: Single Source of Truth for OpenAI-Compatible Providers (Settings migration + flat removal)

Date: 2026-08-04
Status: Approved
Supersedes the mirror-based reconciliation in `d29aaa4` (canonical field, flat mirror kept for Settings UI).

## Problem

After `d29aaa4`, `openai_compatible_providers` (rich) is the canonical persisted field, but the
legacy flat `amp_openai_providers` still lives in `AppConfig` as a derived mirror:

- `rich_to_amp` repopulates it on every config load (Settings UI reads it)
- `lift_amp_to_rich` reconciles it on every `save_config` (Settings UI writes it)
- `api_keys.rs` writes both fields on every API Keys save

Two representations of the same data = drift risk, dead code, and a permanent two-write-path
architecture. Settings UI is the only remaining consumer of the flat format.

## Goal

Exactly one persisted representation (`openai_compatible_providers`). Settings page is migrated to
the rich format. Legacy flat fields are read-only migration inputs: parsed from old config.json but
never serialized again.

## Section 1 — Rust: single source of truth

### `src-tauri/src/config.rs`

- Mark `amp_openai_provider` and `amp_openai_providers` as `#[serde(default, skip_serializing)]`:
  old config.json still parses, but the fields never appear in saved output.
- `migrate_config` keeps the existing amp→rich one-time migration (already covered by
  `migration_amp_to_rich_on_load`). The `rich_to_amp` mirror step is deleted — nothing reads the
  flat mirror anymore.
- Delete the `rich_to_amp` helper (dead once the mirror is gone) and the `amp_to_rich` helper:
  its mapping logic is inlined directly into the amp→rich branch of `migrate_config`, keeping the
  migration self-contained. `AmpOpenAIProvider`/`AmpOpenAIModel` types stay in `types/amp.rs`
  (used by the migration).

### `src-tauri/src/commands/config.rs`

- Delete `lift_amp_to_rich`. `save_config` persists the incoming config as-is; the Settings page now
  sends rich data directly.

### `src-tauri/src/commands/api_keys.rs`

- `set_openai_compatible_providers`: remove the flat-mirror write. Only
  `config.openai_compatible_providers = normalized_providers.clone()` remains.

### `src-tauri/src/config.rs` tests

- Keep `restart_persists_rich_multi_key_and_prefix` (unchanged).
- Keep `migration_amp_to_rich_on_load`; extend: after load, serializing the config yields NO
  `ampOpenaiProviders`/`ampOpenaiProvider` keys.
- Add `save_never_writes_flat_fields`: config populated from legacy fields → serialize → assert
  only `openaiCompatibleProviders` present (round-trip through legacy JSON first).
- Delete `settings_write_lands_in_canonical_field` (lift no longer exists).

## Section 2 — Frontend: Settings on rich

### `src/lib/tauri/config.ts`

- Remove `ampOpenaiProvider?` and `ampOpenaiProviders` from `AppConfig`.
- Add `openaiCompatibleProviders: OpenAICompatibleProvider[]` (required, matches store default).
- Remove unused `AmpOpenAIProvider` import.

### `src/lib/tauri/models.ts`

- Delete `AmpOpenAIModel`/`AmpOpenAIProvider` interfaces if nothing else imports them (verify with
  `pnpm tsc --noEmit`); otherwise leave.

### `src/stores/app.ts`

- Default config: `ampOpenaiProviders: []` → `openaiCompatibleProviders: []`.

### `src/components/settings/OpenAIProviderSettings.tsx`

Full migration to rich format:

- Table reads `config().openaiCompatibleProviders`. Columns: Name / Base URL / Key count / Prefix /
  Models / Actions.
- Modal form: Name, Base URL, API Keys (bulk textarea, one key per line, live count — same pattern
  as `OpenAICompatibleTab.tsx`), Prefix (optional), Model Aliases (unchanged).
- Edit state: `editingIndex: number | null` (rich has no stable id; index matches the API Keys tab
  pattern). No `crypto.randomUUID()`.
- Save/delete: mutate `openaiCompatibleProviders` array directly; DELETE the
  `openaiCompatibleProviders: []` hack from `d29aaa4` (no longer needed) and the
  `ampOpenaiProviders` key.
- Model type: `models ?? []` (rich `models` is optional).

### Read-only consumers

- `src/components/settings/AdvancedSettings.tsx` (~line 265) and `src/pages/Settings.tsx`
  (~line 147): read `config().openaiCompatibleProviders` instead of `ampOpenaiProviders`;
  normalize `models ?? []`.

### API Keys tab

- Untouched: `OpenAICompatibleTab.tsx` already operates on rich via management API.

## Known duplication — RESOLVED 2026-08-04

The Settings section was a degraded duplicate of the API Keys OpenAI Compatible tab.
Deleted: `OpenAIProviderSettings.tsx` + its render in `Settings.tsx`. API Keys tab is the
single management surface. `AdvancedSettings`/`Settings` read-only model consumers keep
reading `openaiCompatibleProviders` (unchanged).

## Startup race (found during verification) — FIXED 2026-08-04

`Sidebar.tsx` createEffect persisted `sidebarPinned` during `initialize()` while the config
signal was still the empty default, overwriting `openaiCompatibleProviders` on disk. The
`lift_amp_to_rich` merge previously masked it; the single-source refactor exposed it.
Fix: early-return from the effect while `isLoading()`.

## Section 3 — Testing & verification

- `cargo test`: all config/proxy tests green (55+ existing, updated + new ones above).
- `pnpm tsc --noEmit`: clean (types change across 5 files).
- Manual dev checklist:
  1. Migration: existing config.json (with `ampOpenaiProviders`, e.g. current machine state) →
     launch → providers visible in API Keys → after restart JSON contains no `ampOpenai*` keys.
  2. API Keys flow: existing nvidia provider (5 keys + prefix) → restart → unchanged.
  3. Startup race: restart twice; `config.json` keeps `openaiCompatibleProviders` intact both
     times (no empty overwrite from Sidebar).
  4. Dock/tray regression (already merged): close-to-tray hides Dock icon; restore paints
     without black window.

## Out of scope

- Adding a stable `id` to the rich format (index-based editing is sufficient; schema change
  deferred until a real need — `ponytail:` ceiling, upgrade path = explicit id field).
- Migrating other providers (Claude/Gemini/Codex prefix emission — already done in `022c490`).

# ProxyPal v0.4.48

**Release status:** Pending publication

## Gemini reliability

- Adds Antigravity support for `gemini-3.6-flash-high`, including fixed high-thinking configuration, OpenCode reasoning/multimodal capabilities, and quota labeling.
- Replaces the unavailable Gemini CLI OAuth flow with clear API Keys setup guidance, avoiding the sidecar’s 404 management endpoint.

## CLIProxyAPI v7.2.95

- Updates the pinned mainline sidecar from v7.2.93 to v7.2.95 across local development, CI, and release builds.
- Includes upstream OpenAI translator tool-handling optimization, improved xAI token counting, Claude input-token estimation, and Codex Alpha Search routing.

---

# ProxyPal v0.4.47

**Released:** 2026-07-21

## CLIProxyAPI v7.2.93

- Updates the pinned CLIProxyAPI sidecar from v7.2.61 to v7.2.93 across local development, CI, and release builds.
- Verifies the macOS ARM sidecar download against its upstream SHA-256 checksum and exercises the authenticated management API smoke test.
- Replaces Auth Files JSON string rewriting with typed decoding that accepts both camelCase and CLIProxyAPI snake_case fields.

## GPT-5.6 and xAI

- Adds GPT-5.6 Terra, Luna, and Sol model aliases, including their GPT-5.6-only `max` and `ultra` reasoning variants.
- Adds native xAI API-key management for Grok: configure a key, endpoint, and optional prefix in the API Keys page; configuration persists across proxy restarts.

## Deferred upstream interfaces

- CLIProxyAPI v7.2.93 does not expose model display names, cache-write tokens, service tiers, or active WebSocket sessions through a stable management API. ProxyPal retains its local model-name heuristic and existing usage analytics until those interfaces are available.

---

# ProxyPal v0.4.46

**Released:** 2026-07-10

## Release automation

- Allows release builds to proceed when optional Apple signing and notarization credentials are unavailable.
- macOS artifacts produced without those credentials are unsigned and not notarized; do not represent them as trusted/notarized builds.

---

# ProxyPal v0.4.44

**Released:** 2026-07-10

## Build and localization fixes

- Fixes the CI formatting gate for release files.
- Completes localized confirmation text for destructive usage-history imports.

---

# ProxyPal v0.4.43

**Released:** 2026-07-10

## Sidecar Upgrade: CLIProxyAPI v7.2.7 → v7.2.61

- Updates the pinned CLIProxyAPI sidecar to v7.2.61 and verifies downloads against upstream SHA-256 checksums.
- Replaces removed aggregated usage endpoints with the documented usage queue, persisted by a supervised local collector.
- Binds sidecar management to loopback, generates a per-install management secret, and enables WebSocket authentication by default.
- Adds a sidecar management smoke test to CI and release builds across macOS ARM/Intel, Windows x64, and Linux x64.

## Security and release hardening

- Adds a restrictive Tauri content security policy.
- Removes the bundled sidecar binary from Git; release builds download the pinned, verified artifact.
- Adds an auditable release-gate runbook for clean-install, OAuth, upgrade, rollback, signing, and artifact verification.

## Upgrade notes

- Existing installations with the legacy management key are migrated to a unique local key on load.
- Usage-history imports replace local history and now require confirmation.
- OAuth and provider behavior must be verified with real accounts before publishing; see `docs/runbooks/release-gates.md`.

---

# ProxyPal v0.4.42

**Released:** 2026-06-16

## Sidecar Upgrade: CLIProxyAPI v7.1.75 → v7.2.7

This release upgrades the bundled CLIProxyAPI sidecar from **v7.1.75** (June 13) to **v7.2.7** (June 16).

### Why v7.2.x

CLIProxyAPI v7.2.x adds websocket passthrough for Codex and XAI, improved streaming/tool-call normalization, community plugin store sources, and log cursor APIs. ProxyPal's backend relies on the sidecar for streaming proxy traffic, so staying on v7.1.x left those fixes behind.

### Breaking upstream change handled

CLIProxyAPI **v7.2.0 removed Amp integration** (`feat!: remove amp integration support`). ProxyPal removed all Amp-specific UI, agent auto-config, YAML generation, and management API calls that depended on the removed `ampcode` module.

Custom OpenAI-compatible providers (`ampOpenaiProviders` in config) are unchanged.

### Sidecar version pinning

Sidecar downloads are now pinned via `scripts/sidecar-version` (currently `7.2.7`) instead of always fetching GitHub `releases/latest`. Override with `CLIPROXYAPI_VERSION` when needed.

### Highlights (v7.1.76 → v7.2.7)

- **v7.2.3–4:** Codex/XAI websocket passthrough and transcript compaction
- **v7.2.2:** Community plugin store sources, OpenAI video support
- **v7.2.6:** Management log cursor APIs (ProxyPal still uses `GET /v0/management/logs?lines=N`)
- **v7.2.7:** Web search domain sanitization, Claude `tool_result` normalization

### Removed in ProxyPal

- Amp CLI Integration settings panel
- Amp CLI agent auto-configuration
- `ampcode` block in generated proxy YAML
- Force model mappings management API (`/v0/management/ampcode/force-model-mappings`)

Legacy Amp fields in `config.json` are ignored but preserved for deserialization.

### Compatibility

Existing ProxyPal IPC endpoints (`/v1/models`, `/api/auth/status`, `/v0/management/auth-files`, usage sync) remain stable. Smoke-test OAuth providers, proxy start/stop, log viewer, and usage sync after upgrading.

---

# ProxyPal v0.4.41

**Released:** 2026-06-13

## Sidecar Upgrade: CLIProxyAPI v7.1.47 → v7.1.75

This release upgrades the bundled CLIProxyAPI sidecar from **v7.1.47** (June 6) to **v7.1.75** (June 13), picking up 28 upstream releases.

### Highlights (v7.1.48 → v7.1.75)

**Plugin system (v7.1.69 → v7.1.75):**

- **Plugin store** — new `/v0/management/plugin-store/*` endpoints for fetching and installing community plugins from latest GitHub releases (v7.1.69, v7.1.72)
- **Plugin delete endpoint** — new API to remove installed plugins (v7.1.75)
- **Plugin install timeout** — bounded plugin installation with timeout handling (v7.1.75)
- **Plugin unload handling** — preserves plugin config across updates (v7.1.70)
- **Plugin registry version optional** — `version` field in plugin manifests is now optional (v7.1.72)
- **CORS plugin support header** — exposes `X-CPA-SUPPORT-PLUGIN` header for cross-origin clients (v7.1.73)
- **Saved plugin config exposure** — `GET /v0/management/plugins/config` returns stored config (v7.1.72)

**HTML/JSON sanitization (v7.1.70):**

- New sanitization utilities integrated across plugins and APIs to prevent injection in plugin output

**Auto-updater (v7.1.66):**

- Refactored skip logic with unit tests for `autoUpdateSkipReason` — safer update decisions

**Antigravity (v7.1.74):**

- **Claude WebSearch bridged to native `googleSearch`** — Anthropic-format web search tool calls are now translated to Antigravity's native `googleSearch` tool, improving tool-call fidelity

**Translator (v7.1.75):**

- **Mid-conversation system messages consolidated** into initial system content for OpenAI/Codex responses — cleaner request payloads

**Translator (v7.1.69):**

- Usage token details now include cache input/output aggregation fields for finer-grained usage reporting

**Stability (v7.1.48 → v7.1.65):**

- 18 patch releases with internal model registry, antigravity executor, and management API fixes (sparse changelogs; recommend production smoke test)

### Compatibility

- All ProxyPal IPC endpoints (`/v1/models`, `/api/auth/status`, `/v0/management/auth-files`, usage sync) are stable across the v7.1.47 → v7.1.75 gap — **no code changes required**.
- New plugin store endpoints are not surfaced in the ProxyPal UI; they remain available in the sidecar's built-in management web UI for advanced users.

---

# ProxyPal v0.4.40

**Released:** 2026-06-06

## Sidecar Upgrade: CLIProxyAPI v7.1.44 → v7.1.47

This release upgrades the bundled CLIProxyAPI sidecar from **v7.1.44** (June 3) to **v7.1.47** (June 6), picking up 3 upstream releases with pluginhost capabilities, safemode example server, and file-backed request/response logging.

This is a sidecar-only bump — no ProxyPal UI or API surface changes.

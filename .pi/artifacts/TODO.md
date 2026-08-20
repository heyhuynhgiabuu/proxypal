### 2026-07-10 - publish origin v0.4.45 unsigned release candidate
status: waiting-alt-auth | updated: 2026-07-10

- [x] Isolated the v0.4.43 CI failure to formatting/lint violations and fixed them in v0.4.44.
- [x] Changed the macOS signing gate to permit explicitly unsigned builds when Apple credentials are unavailable.
- [x] Created and pushed annotated tag v0.4.45 to origin at 5c2caccc.
- [x] Mirrored `origin/main` to `alt/main` at `ce16e851` after access was granted.

### 2026-07-10 - restore Polime dashboard promotion
status: waiting-ci | updated: 2026-07-10

- [x] Restored the exact Polime card, asset, and localized copy removed after `166d3873`; independent review and TypeScript/Rust checks passed.
- [x] Force-moved `v0.4.45` to `eed45935`, which triggered release workflow 29106867037.

### 2026-07-10 - repair release CI and publish v0.4.46
status: waiting-ci | updated: 2026-07-10

- [x] Fixed the reported format:check failure by formatting the restored Polime banner and i18n entries; local format, lint, TypeScript, Rust, and independent review passed.
- [x] Bumped all version sources to v0.4.46, pushed commit `ce16e851`, and published annotated tag `v0.4.46`; workflow 29107432582 is queued.

### 2026-08-09 - confirm ProxyPal work for latest CLIProxyAPI
status: done | updated: 2026-08-09

- [x] Reconfirmed v7.2.125 as the latest stable CLIProxyAPI release and ProxyPal's current pin.
- [x] Separated required compatibility work (already complete) from optional frontend/backend feature adoption.
- [x] Recorded an evidence-backed recommendation and remaining cross-platform/manual-flow test limits.

### 2026-08-09 - prepare ProxyPal v0.4.49 follow-ups
status: done | updated: 2026-08-10

#### Spec

- Goal: prepare a locally verified v0.4.49 release candidate that exposes weighted round-robin, strengthens sidecar management smoke coverage, and generates release notes from the bundled sidecar tag.
- Non-goals: do not push, tag, trigger GitHub Actions, publish a release, add dependencies, or expose CLIProxyAPI Home/plugin controls.

- [x] Added failing coverage for weighted routing labels and pinned release-note lookup, then observed both turn green.
- [x] Expanded sidecar smoke checks for stable configuration, logging, auth-files, and authenticated error contracts; provider OAuth flows and the upstream `log-size` 404 fallback remain manual to avoid external side effects.
- [x] Added weighted round-robin to the routing selector and all locale catalogs.
- [x] Made release-note metadata resolve and verify the pinned CLIProxyAPI tag.
- [x] Synchronized ProxyPal v0.4.49 version and release-note sources.
- [x] Ran required checks, inspected the complete diff, and obtained a clean independent review with no merge-blocking findings.

### 2026-08-10 - harden v0.4.49 release publication gates
status: done | updated: 2026-08-10

- [x] Addressed independent-review findings on release permissions, draft/public ordering, fixed release identity, tag validation, and fail-closed artifact/notification behavior.
- [x] Re-ran required checks and obtained a clean independent review of the final release workflow.

### 2026-08-10 - make Discord notifications non-blocking
status: done | updated: 2026-08-10

- [x] Keep invalid or unavailable Discord webhooks from failing successful CI or release workflows.

### 2026-08-18 - publish ProxyPal v0.4.51
status: done | updated: 2026-08-20

- [x] Local gates green (tsc, lint 0, format, vitest 11/11, cargo check/test 57/57, fmt) before push.
- [x] Pinned sidecar 7.2.135 (bcdc1b28) + release tag-identity hardening (4229e66f) on main; CI 32110093040 success (15m20s), CI 32110833685 success (23m42s).
- [x] Prepared v0.4.51 (23108c1e): bumped package.json/Cargo.toml/Cargo.lock/tauri.conf.json, RELEASE_NOTES Pending→Released 2026-08-18.
- [x] Annotated tag v0.4.51 at 23108c1e pushed; release workflow 32110838872 success 42m8s (preflight 10s + 4 platform builds + changelog + publish + Discord).
- [x] Draft published correctly tagged v0.4.51 with 16 assets (including latest.json) — hardening verified, no untagged retarget needed. Marked Latest.
- [x] Upstream delta checked: latest CLIProxyAPI v7.2.137 (2026-08-19) is 2 ahead of pinned 7.2.135; 7.2.136/137 are fixes (Gemini/Claude/Antigravity, no registry break) — hold for next release.

### 2026-08-18 - prep sidecar 7.2.135 pin + release tag-identity hardening
status: done | updated: 2026-08-18

- [x] Pinned sidecar 7.2.135 (sidecar-version + ci.yml + release.yml); checksum-verified download, smoke PASS, updater tests 18/18; committed bcdc1b28.
- [x] Publish job now verifies/retargets release tag identity before draft=false, failing closed if the tag ref is missing; committed 4229e66f; YAML validated.
- [x] Pushed main; CI run 32110093040 success (15m20s).

### 2026-08-14 - per-credential request-retry override + retry knobs
status: done | updated: 2026-08-14

- [x] requestRetry on 5 credential types (Rust+TS), YAML emission in 5 section builders, kebab/camel converters both directions, AppConfig serde-defaulted maxRetryCredentials/disableCooling + Default impl.
- [x] UI: retry input in 5 key add-forms, Max Retry Credentials input + Disable Cooling toggle in ProxySettings, i18n en/vi/zh-CN.
- [x] 3 new Rust tests; verified cargo test 57/57, fmt, check, tsc, lint 0, format, vitest 11/11; independent review merge-ready.
- [x] Committed as 7f25cde4.

### 2026-08-14 - expose model-definitions registry in ModelsWidget
status: done | updated: 2026-08-14

- [x] Added get_model_definitions command + serde types (asymmetric renames: parse sidecar snake_case, serialize camelCase) + 3 unit tests (parse fixture, sparse defaults, camelCase round-trip guard).
- [x] TS binding + ModelsWidget enrichment (displayName/context/thinking/modalities) + ModelCard modality badges.
- [x] Independent review: 1 blocking finding (snake→camel serialization mismatch) fixed with asymmetric renames + round-trip regression test.
- [x] Verified: cargo test 54/54, cargo fmt clean, cargo check, tsc, lint 0, format, vitest 11/11.
- [x] Committed as a53a6b10 (sidecar 7.2.131), 4c436cca (solid-js 1.9.14), 63a6d21f (model registry feature).

- Goal: surface CLIProxyAPI 7.2.131 static model registry (display names, context length, thinking, modalities) in Settings → Available Models, replacing ID-string heuristics.
- Scope: new Rust command get_model_definitions + types; frontend binding; ModelsWidget enrichment; ModelCard modality badges. No AppConfig schema change.
- Non-goals: per-credential retry override (needs AppConfig schema sign-off), request-scoped proxy override (SDK-only), i18n changes.

### 2026-08-14 - bump CLIProxyAPI sidecar to 7.2.131 and solid-js to 1.9.14
status: done | updated: 2026-08-14

- [x] Updated pinned sidecar to 7.2.131 across scripts/sidecar-version, ci.yml, and release.yml; checksum-verified binary installed and smoke tests passed.
- [x] Bumped solid-js 1.9.11 → 1.9.14; tsc clean, 11/11 vitest tests pass, lockfile diff is pure re-resolution.

- Goal: refresh the pinned CLIProxyAPI sidecar from 7.2.125 to 7.2.131 (6 patch releases: SSE termination, DeepSeek key rotation, perf) and bump solid-js 1.9.11 → 1.9.14 within v1.
- Non-goals: no Solid 2.0 migration (blocked on Kobalte alpha/i18n next), no version bump/release, no dependency additions.

### 2026-08-10 - publish ProxyPal v0.4.49
status: done | updated: 2026-08-10

- [x] Retarget the existing v0.4.49 tag to the verified release commit and trigger GitHub release automation.
- [x] Verify generated changelog, updater notes, platform assets, and published release state.

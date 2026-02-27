# ProxyPal

Tauri v2 desktop app — proxy API management with SolidJS frontend and Rust backend.

## Stack

- **Frontend:** SolidJS 1.9 + TypeScript 5.6 + Tailwind CSS 3 + Kobalte UI
- **Backend:** Rust (Tauri v2, 10 plugins: dialog, fs, updater, deep-link, etc.)
- **Build:** Vite 6 + Tauri CLI | **Test:** Vitest 4 | **PM:** pnpm
- **Charts:** ECharts 6 + Chart.js 4 | **i18n:** @solid-primitives/i18n

## Structure

```
src/                        # SolidJS frontend
  components/               # UI components (22+), charts/, ui/
  pages/                    # Dashboard, Analytics, ApiKeys, Settings, etc.
  stores/                   # Reactive stores (app, requests, theme, toast)
  i18n/                     # Internationalization (locale, catalog)
  lib/                      # Utilities (tauri bindings, quotaCache)
src-tauri/src/              # Rust backend
  commands/                 # Tauri commands (proxy, cloudflare, ssh, config)
  types/                    # Shared type definitions (16 modules)
  lib.rs                    # Main library entry
  config.rs, state.rs       # App config and state management
```

## Commands

```bash
pnpm tauri dev              # Dev (frontend + backend)
pnpm tsc --noEmit           # Type check (frontend)
pnpm check:ts               # Fast type check (uses tsgo when available, falls back to tsc)
pnpm check:parallel         # Parallel: type check + lint + format
cd src-tauri && cargo check # Type check (backend)
pnpm test                   # Vitest (10 tests, 3 files)
pnpm build                  # Vite build (frontend only)
```

## Code Style

```tsx
// SolidJS: interface above component, splitProps, `class` not `className`
interface ProviderCardProps {
  name: string;
  provider: Provider;
  connected: number;
  onConnect: (provider: Provider) => Promise<void>;
}
export function ProviderCard(props: ProviderCardProps) {
  const [loading, setLoading] = createSignal(false);
  // ...
}
```

```rust
// Rust: Result<T, String>, State<AppState>, #[serde(rename_all = "camelCase")]
#[tauri::command]
pub fn save_config(state: State<AppState>, config: AppConfig) -> Result<(), String> {
    let mut current_config = state.config.lock().unwrap();
    *current_config = config;
    Ok(())
}
```

## Boundaries

- **Always:** Run `pnpm tsc --noEmit` + `cd src-tauri && cargo check` before done. Preserve Tailwind card/badge patterns.
- **Ask first:** New dependencies. Modifying `AppConfig` schema. Changing CLIProxyAPI lifecycle.
- **Never:** Commit secrets/`.env`. Blocking IO in async Rust without `spawn_blocking`. Edit `dist/` or `target/`.

## Gotchas

- `lib.rs` is 332KB — navigate with LSP, don't read fully
- Vite build warns about chunk size (>500KB) — expected
- Both `bun.lock` and `pnpm-lock.yaml` exist — use pnpm

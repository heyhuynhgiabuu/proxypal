# ProxyPal Development Guidelines

## Commands

- **Dev**: `pnpm dev` (Vite) or `pnpm tauri dev` (Tauri app)
- **Build**: `pnpm build` or `pnpm tauri build`
- **Type check**: `pnpm tsc --noEmit`
- **Rust check**: `cd src-tauri && cargo check`

## Code Style

### TypeScript (Frontend - SolidJS)

- Use functional components with arrow functions for handlers
- Props interfaces: `interface ComponentProps { ... }` directly above component
- Imports: external libs → internal aliases (`../lib`, `../stores`) → relative (`./ui`)
- Use `type` imports for type-only: `import type { Provider } from "../lib/tauri"`
- Signals: `const [value, setValue] = createSignal(initial)`
- Tailwind for styling; use `class` not `className`

### Rust (Backend - Tauri)

- Structs: derive `Serialize, Deserialize` for IPC types
- Use `#[tauri::command]` for exposed functions
- State: wrap in `Mutex<T>`, access via `State<AppState>`
- camelCase for JSON fields via `#[serde(rename = "camelCase")]`
- Error handling: return `Result<T, String>` from commands

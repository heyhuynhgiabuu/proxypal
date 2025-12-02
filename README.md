# ProxyPal

A desktop app that lets you use your AI subscriptions (Claude, ChatGPT, Gemini) with any coding tool. Wraps [CLIProxyAPI](https://github.com/nexon33/CLIProxyAPI) with a clean UI for managing connections and tracking usage.

## Features

- **One-click OAuth** - Connect Claude, ChatGPT, Gemini, and more
- **Works with any tool** - Cursor, Windsurf, Continue, Claude Code, OpenCode, etc.
- **Track savings** - See how much you're saving vs API costs
- **Request history** - Monitor all AI requests through the proxy
- **Auto-configure** - Detects installed CLI agents and configures them automatically

## Quick Start

1. Download the latest release for your platform
2. Start the proxy (toggle in header)
3. Connect your AI account(s)
4. Configure your coding tool to use `http://localhost:9090/v1`

## Development

```bash
# Install dependencies
pnpm install

# Run in development
pnpm tauri dev

# Build for production
pnpm tauri build
```

## Tech Stack

- **Frontend**: SolidJS + TypeScript + Tailwind CSS
- **Backend**: Rust + Tauri v2
- **Proxy**: CLIProxyAPI (bundled)

## License

MIT

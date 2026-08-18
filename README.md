# ProxyPal

Use your AI subscriptions (Claude, ChatGPT, Gemini, GitHub Copilot) with any coding tool. Native desktop app wrapping [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI).

[![Release](https://img.shields.io/github/v/release/heyhuynhgiabuu/proxypal?style=flat-square)](https://github.com/heyhuynhgiabuu/proxypal/releases)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/heyhuynhgiabuu/proxypal/total?style=flat-square)](https://github.com/heyhuynhgiabuu/proxypal/releases)

![ProxyPal Dashboard](src/assets/dashboard.png)

## Why ProxyPal?

You're paying for Claude, ChatGPT, or GitHub Copilot. Why can't you use them in your favorite coding tool?

ProxyPal bridges that gap. One proxy, all your AI subscriptions, any client.

## Features

- **Multiple AI Providers** - Connect Claude, ChatGPT, Gemini, Qwen, iFlow, Vertex AI, and custom OpenAI-compatible endpoints
- **GitHub Copilot Bridge** - Use Copilot models via OpenAI-compatible API
- **Antigravity Support** - Access thinking models through Antigravity proxy
- **Works Everywhere** - Cursor, Cline, Continue, Claude Code, OpenCode, and any OpenAI-compatible client
- **Usage Analytics** - Track requests, tokens, success rates, and estimated savings
- **Request Monitoring** - View all API requests with response times and status codes
- **Auto-Configure** - Detects installed CLI agents and sets them up automatically

## Quick Start

1. Download from [Releases](https://github.com/heyhuynhgiabuu/proxypal/releases)
2. Launch ProxyPal and start the proxy
3. Connect your AI accounts (OAuth or auth files)
4. Point your coding tool to `http://localhost:8317/v1`

### macOS Users

The app is not signed with an Apple Developer certificate yet. If macOS blocks the app:

```bash
xattr -cr /Applications/ProxyPal.app
```

## Supported Platforms

| Platform | Architecture          | Status |
| -------- | --------------------- | ------ |
| macOS    | Apple Silicon (ARM64) | ✅     |
| macOS    | Intel (x64)           | ✅     |
| Windows  | x64                   | ✅     |
| Linux    | x64 (.deb)            | ✅     |

## Supported Clients

Works with Cursor, Claude Code, OpenCode, Cline, Continue, GitHub Copilot, and any OpenAI-compatible client.

## Development

```bash
pnpm install
pnpm tauri dev
```

### Checks

```bash
pnpm check:ts        # tsgo when installed, otherwise tsc --noEmit
pnpm check:parallel  # check:ts + lint + format:check (parallel)
cd src-tauri && cargo check
```

Optional tsgo setup:

```bash
pnpm add -D @typescript/native-preview
```

Optional VS Code setting:

```json
{
  "typescript.experimental.useTsgo": true
}
```

**Tech Stack**: SolidJS + TypeScript + Tailwind (frontend), Rust + Tauri v2 (backend), CLIProxyAPI (proxy)

## Contributing

1. **One feature per PR** - Keep changes focused
2. **Clean commits** - No unrelated changes
3. **Test your changes** - Run `pnpm tauri dev` and verify
4. **Follow existing patterns** - Check similar implementations

### Adding a New Agent

- Add detection logic in `src-tauri/src/lib.rs`
- Add logo to `public/logos/` (use `currentColor` for dark mode)
- Update agents array in relevant components
- Test auto-configuration flow

## Support

If ProxyPal saves you time, consider [buying me a coffee](https://buymeacoffee.com/heyhuynhgiabuu).

## License

MIT

---

## Star History

[![Star History Chart](https://star-history.dera.page/svg?repos=heyhuynhgiabuu/proxypal&type=Date)](https://star-history.dera.page/#heyhuynhgiabuu/proxypal&Date)

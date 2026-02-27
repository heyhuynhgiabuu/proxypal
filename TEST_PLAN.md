# ProxyPal Testing Plan - Recent Fixes

## Recent Changes Summary

### 1. Welcome Page OAuth Flow (Commit fa4f58b)

**Files Changed:** `src/pages/Welcome.tsx`, `src/components/ProviderCard.tsx`

**What it does:**

- When user clicks "Connect" on Welcome page, it now:
  1. Auto-starts proxy if not running
  2. Shows OAuth completion toast
  3. Polls OAuth status every 1 second for up to 2 minutes
  4. Updates auth status on success
  5. Shows loading spinner on the provider card during entire flow

**Manual Test Checklist:**

- [ ] Fresh install - Welcome page shows on first load
- [ ] Click "Connect" on Claude provider
  - [ ] Proxy auto-starts (shows "Starting proxy..." toast)
  - [ ] Browser opens OAuth flow
  - [ ] Connect button shows loading spinner
  - [ ] After OAuth completes, shows success toast
  - [ ] Auth status updates (Claude shows as connected)
  - [ ] "Continue to Dashboard" button appears
- [ ] Repeat for other providers (OpenAI, Gemini, Qwen, iFlow, Vertex, Antigravity)
- [ ] Test timeout: Don't complete OAuth, wait 2 minutes
  - [ ] Should show "Connection timeout" error after 120 seconds

**Code Verification:**

- ✅ `setConnecting(provider)` sets which provider is currently auth-ing
- ✅ `pollOAuthStatus(oauthState)` polls server every 1000ms
- ✅ Max 120 attempts = 120 seconds timeout
- ✅ `refreshAuthStatus()` fetches updated auth status from server
- ✅ `setConnecting(null)` clears loading state on success
- ✅ `ProviderCard` accepts `connecting` prop and shows loading state

### 2. Provider Disconnect Deletes Credentials (Commit c7cda6a)

**Files Changed:** `src-tauri/src/lib.rs`

**What it does:**

- When user disconnects a provider, it now deletes the credential files from `~/.cli-proxy-api/`
- This prevents the refreshAuthStatus() from re-detecting the provider as connected

**Manual Test Checklist:**

- [ ] Connect a provider (e.g., Claude)
- [ ] In Dashboard > Settings, click disconnect button for Claude
  - [ ] Should show disconnect confirmation
  - [ ] After confirmation, shows success toast
  - [ ] Provider card shows as disconnected
- [ ] Verify files were deleted:
  - [ ] Run: `ls ~/.cli-proxy-api/`
  - [ ] Should NOT have `claude-*.json` files
- [ ] Restart app and check
  - [ ] Provider should still show as disconnected
  - [ ] Proves file deletion was persistent

**Code Verification:**

- ✅ Checks `~/.cli-proxy-api/` directory exists
- ✅ Matches provider-specific prefixes (claude-, openai-codex-, gemini-, etc.)
- ✅ Only deletes `.json` files
- ✅ Errors logged but don't break disconnect
- ✅ Updates auth status after deletion
- ✅ Called before setting auth status to false

### 3. CLI Agent Detection Works in Production (Commit c7cda6a)

**Files Changed:** `src-tauri/src/lib.rs`

**What it does:**

- Old code used `which` shell command - doesn't work in sandboxed macOS apps
- New code checks common installation paths directly:
  - `/opt/homebrew/bin` (Homebrew ARM)
  - `/usr/local/bin` (Homebrew Intel)
  - `/usr/bin` (System)
  - `~/.cargo/bin` (Rust)
  - `~/.npm-global/bin` (npm)
  - `~/.local/bin` (System)
  - `~/go/bin` (Go)
  - `~/.bun/bin` (Bun)
  - `~/.nvm/versions/node/*/bin` (Node via NVM - scanned dynamically)

**Manual Test Checklist (Development):**

- [ ] Run `pnpm tauri dev`
- [ ] Go to Dashboard > Agent Setup
  - [ ] Check which agents show as "installed"
  - [ ] Manually verify against installed binaries:
    - [ ] `which claude` should match detection
    - [ ] `which gemini` should match detection
    - [ ] `which opencode` should match detection
    - [ ] etc.
- [ ] Test with missing agent
  - [ ] Uninstall one CLI agent (e.g., remove claude binary)
  - [ ] Restart app
  - [ ] Should show as "not installed"

**Manual Test Checklist (Production Build):**

- [ ] Build app: `pnpm tauri build`
- [ ] Open .app from dist/
- [ ] Go to Dashboard > Agent Setup
  - [ ] Should show same agents as dev
  - [ ] Installed agents should be detected correctly
  - [ ] NOT showing "not installed" for agents that are installed is a regression

**Code Verification:**

- ✅ Checks all common paths
- ✅ Dynamically scans NVM versions
- ✅ Returns false if file doesn't exist
- ✅ Returns true if binary exists anywhere in the paths

## Testing Environment

### Prerequisites

```bash
cd /Users/huynhgiabuu/dev/projects/proxypal

# Install dependencies
pnpm install

# Verify builds
pnpm tsc --noEmit
cd src-tauri && cargo check
```

### Development Testing

```bash
# Start dev server
pnpm tauri dev

# Verify in browser dev tools - no console errors during OAuth flow
```

### Production Testing

```bash
# Build for macOS
pnpm tauri build

# Output: src-tauri/target/release/bundle/macos/ProxyPal.app
# Open and test features
```

## Regression Tests

After testing the above, verify no regressions:

- [ ] Dashboard loads without errors
- [ ] Settings page accessible
- [ ] Log viewer shows logs
- [ ] Analytics page shows charts
- [ ] API keys page works
- [ ] Auth files page works
- [ ] Proxy start/stop works
- [ ] Health indicator updates correctly
- [ ] Toast notifications work properly

## Success Criteria

All tests should pass before marking as complete:

- [x] Code compiles (TypeScript + Rust)
- [x] No unused variables/imports
- [ ] OAuth flow works end-to-end
- [ ] Disconnect removes credential files
- [ ] CLI agents detected in production
- [ ] No regressions in other features

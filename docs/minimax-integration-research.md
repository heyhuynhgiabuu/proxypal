# MiniMax Provider Integration Research

**Date:** 2025-12-16
**Issue:** #24
**Status:** Research Phase

## Overview

MiniMax.io is a Chinese AI platform providing various AI capabilities including text-to-speech, image generation, and LLM APIs. User requested integration of MiniMax audio API (https://www.minimax.io/audio) into ProxyPal.

## Current ProxyPal Architecture

### Provider System

ProxyPal is a desktop app wrapping **CLIProxyAPI** (GitHub: router-for-me/CLIProxyAPI), which handles the actual proxy logic.

**Current Supported Providers:**
- Claude (OAuth)
- OpenAI/Codex (OAuth)
- Gemini (OAuth + API Key)
- Qwen (OAuth)
- iFlow (OAuth)
- Vertex AI (Service Account JSON)
- Antigravity (OAuth)
- Custom OpenAI-compatible endpoints (API Key)

### Architecture Components

#### 1. CLIProxyAPI (Backend - Go)
Located: `src-tauri/CLIProxyAPI/`

**Key Components:**
- **Executors** (`internal/runtime/executor/*.go`): Handle provider-specific API calls
  - Each provider has dedicated executor (e.g., `claude_executor.go`, `gemini_executor.go`)
  - Implements `auth.ProviderExecutor` interface
  - Methods: `Execute()`, `ExecuteStream()`, `PrepareRequest()`, `Refresh()`

- **SDK** (`sdk/`): Extensible framework for custom providers
  - `sdk/cliproxy/executor/types.go`: Core executor interfaces
  - `sdk/translator`: Request/response schema transformations
  - `examples/custom-provider/main.go`: Reference implementation

**Executor Interface:**
```go
type ProviderExecutor interface {
    Identifier() string
    PrepareRequest(req *http.Request, a *Auth) error
    Execute(ctx context.Context, a *Auth, req Request, opts Options) (Response, error)
    ExecuteStream(ctx context.Context, a *Auth, req Request, opts Options) (<-chan StreamChunk, error)
    Refresh(ctx context.Context, a *Auth) (*Auth, error)
}
```

**Translation System:**
- Converts between OpenAI/Gemini/Claude formats and provider formats
- Registered via `sdktr.Register(sourceFormat, targetFormat, requestTransform, responseTransform)`

#### 2. ProxyPal Frontend (TypeScript/SolidJS)
Located: `src/`

**Key Files:**
- `src/lib/tauri.ts`: Provider type definitions, Tauri API bindings
  - `Provider` type: union of provider names
  - `AuthStatus`: account counts per provider
  - OAuth functions: `openOAuth()`, `completeOAuth()`

- `src/components/ProviderCard.tsx`: Provider UI card component
- `src/pages/Settings.tsx`: Provider configuration UI

**Provider Type Definition:**
```typescript
export type Provider =
  | "claude"
  | "openai"
  | "gemini"
  | "qwen"
  | "iflow"
  | "vertex"
  | "antigravity";
```

#### 3. Tauri Bridge (Rust)
Located: `src-tauri/src/lib.rs`

**Structures:**
- `AuthStatus`: Tracks connected account count per provider
- Commands: `open_oauth()`, `complete_oauth()`, `disconnect_provider()`, `import_vertex_credential()`

## MiniMax API Research Challenges

### Documentation Access Issues

**Attempted URLs:**
- `https://www.minimax.io/audio` - 403 Forbidden
- `https://platform.minimaxi.com/document/introduction` - No rendered content
- `https://platform.minimaxi.com/document/V2%20MaaS%20Text%20to%20Speech%20Pro` - No rendered content
- `https://platform.minimaxi.com/document/V2%20MaaS%20Text%20to%20Speech%20Basic` - No rendered content

**Findings:**
- MiniMax platform uses dynamic JavaScript rendering
- Documentation not accessible via static web scraping
- No public GitHub repositories with API examples found
- Official docs likely require account access

### Known Information (General Knowledge)

**MiniMax Platform:**
- Chinese AI company
- Provides: Text-to-Speech (TTS), Image Generation, LLM APIs
- Platform URLs: `minimax.io`, `minimaxi.com`, `platform.minimaxi.com`
- Likely uses API key authentication (common for Chinese AI platforms)

**Expected API Pattern (Based on similar platforms):**
```
Endpoint: https://api.minimax.chat/v1/text_to_speech
Authentication: Bearer token or API Key header
Request: JSON with text, voice parameters
Response: Audio file URL or binary data
```

## Integration Approach Options

### Option 1: OpenAI-Compatible Proxy (If Available)

**IF** MiniMax provides OpenAI-compatible endpoints:
- Use existing `openai_compat_executor.go` in CLIProxyAPI
- Add MiniMax as custom provider in ProxyPal settings
- Minimal code changes needed

**Pros:**
- Fastest integration
- Reuses existing code
- No new executor needed

**Cons:**
- Requires MiniMax to support OpenAI format
- Limited to standard chat/completion API patterns
- May not expose audio-specific features

### Option 2: Custom Provider Executor (Audio-Specific)

**Steps:**
1. Create `minimax_executor.go` in CLIProxyAPI
2. Implement MiniMax-specific authentication
3. Handle audio API endpoints
4. Add translator for MiniMax request/response formats
5. Update ProxyPal frontend to add MiniMax provider

**File Changes Required:**

**CLIProxyAPI (Go):**
- `internal/runtime/executor/minimax_executor.go` (new)
  - Implement `ProviderExecutor` interface
  - Handle text-to-speech API calls
  - Manage audio response streaming

- `sdk/translator/minimax.go` (new)
  - Register format conversions
  - Convert OpenAI TTS format → MiniMax format

- `internal/config/config.go`
  - Add MiniMax auth fields

**ProxyPal (TypeScript/Rust):**
- `src/lib/tauri.ts`
  - Add `"minimax"` to `Provider` type
  - Add `minimax: number` to `AuthStatus`

- `src-tauri/src/lib.rs`
  - Add `minimax: u32` to `AuthStatus` struct
  - Add MiniMax OAuth/API key handling commands

- `src/pages/Settings.tsx`
  - Add MiniMax provider card

**Pros:**
- Full control over API integration
- Can expose audio-specific features
- Better error handling

**Cons:**
- More development effort
- Requires complete API documentation
- Need to maintain custom code

### Option 3: Hybrid Approach

Implement MiniMax as custom provider using CLIProxyAPI's SDK example pattern:
- Create standalone executor following `examples/custom-provider/main.go`
- Keep it separate from core CLIProxyAPI codebase
- ProxyPal can embed it as plugin

**Pros:**
- Modular and maintainable
- Doesn't touch core CLIProxyAPI
- Easier to update independently

**Cons:**
- More complex architecture
- Plugin system may need development

## Critical Blockers

### 1. **MiniMax API Documentation Access**

**Required Information:**
- API base URL
- Authentication method (API key? OAuth? Token?)
- Request/response format
- Rate limits
- Audio format options (voice models, output formats)
- Error codes and handling

**Next Steps:**
- Request documentation access from user (they may have MiniMax account)
- Check if user can provide:
  - API credentials for testing
  - API documentation screenshots/PDFs
  - Example curl commands
  - Official SDK (if available)

### 2. **Audio API vs Standard LLM API**

**Key Questions:**
- Does MiniMax audio API follow standard LLM chat format?
- Is it text-to-speech only, or also speech-to-text?
- How are audio responses handled? (URLs, base64, streaming?)
- Does it integrate with chat completions or separate endpoint?

**Impact on Integration:**
- If separate audio endpoint → needs custom executor
- If chat-compatible → can extend existing chat handlers
- Streaming audio → needs special response handling

### 3. **ProxyPal Use Case Alignment**

**Current ProxyPal Focus:**
- Bridges LLM chat APIs (Claude, GPT, Gemini)
- OpenAI-compatible endpoint exposure
- Used by coding assistants (Cursor, Continue, etc.)

**MiniMax Audio Integration:**
- Audio generation may not fit standard chat flow
- Coding assistants typically don't use TTS
- May need separate audio endpoint or mode

**Questions:**
- How will users access MiniMax audio through ProxyPal?
- Should it expose as OpenAI TTS-compatible endpoint?
- Is this for personal use or broader feature?

## Recommendations

### Immediate Actions

1. **Request Information from User** (Issue #24 commenter)
   - Ask if they have MiniMax account/API access
   - Request API documentation or examples
   - Clarify specific use case (TTS? STT? Both?)
   - Ask about desired integration method

2. **Access MiniMax Documentation**
   - User should export/screenshot API docs
   - Get example API requests/responses
   - Understand authentication flow

3. **Prototype Decision**
   - If docs show OpenAI compatibility → Option 1
   - If custom audio API → Option 2
   - If complex plugin need → Option 3

### Implementation Phases (Once Docs Available)

**Phase 1: Research & Design (1-2 days)**
- Analyze MiniMax API structure
- Design executor architecture
- Plan authentication flow
- Define request/response formats

**Phase 2: Backend Implementation (3-5 days)**
- Implement MiniMax executor in CLIProxyAPI
- Add authentication handling
- Create translator for format conversion
- Write tests with sample data

**Phase 3: Frontend Integration (2-3 days)**
- Update TypeScript types
- Add Rust Tauri commands
- Create UI for MiniMax provider
- Add settings management

**Phase 4: Testing & Documentation (2-3 days)**
- End-to-end testing
- Audio streaming validation
- User documentation
- Error handling refinement

**Total Estimate:** 7-13 days (depends on API complexity)

## Unresolved Questions

1. **API Documentation**: Where to access complete MiniMax API docs?
2. **Authentication**: What auth method does MiniMax use?
3. **Audio Format**: How is audio data transmitted/received?
4. **Rate Limits**: What are the API limits?
5. **Use Case**: How will ProxyPal users access MiniMax audio features?
6. **OpenAI Compatibility**: Does MiniMax support OpenAI TTS format?
7. **Pricing**: Is MiniMax free tier available for testing?
8. **Regional Access**: Is MiniMax API accessible outside China?

## References

- **CLIProxyAPI Repo**: https://github.com/router-for-me/CLIProxyAPI
- **SDK Documentation**: `src-tauri/CLIProxyAPI/docs/sdk-advanced.md`
- **Custom Provider Example**: `src-tauri/CLIProxyAPI/examples/custom-provider/main.go`
- **MiniMax Platform**: https://platform.minimaxi.com
- **Issue #24**: https://github.com/heyhuynhgiabuu/proxypal/issues/24

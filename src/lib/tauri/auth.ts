import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// OAuth management
export type Provider =
  | "claude"
  | "openai"
  | "gemini"
  | "qwen"
  | "iflow"
  | "vertex"
  | "kiro"
  | "antigravity"
  | "kimi";

export async function openOAuth(provider: Provider): Promise<string> {
  return invoke("open_oauth", { provider });
}

export interface OAuthUrlResponse {
  state: string;
  url: string;
}

export interface DeviceCodeResponse {
  expiresIn: number;
  interval: number;
  state: string;
  userCode: string;
  verificationUri: string;
}

export async function getOAuthUrl(provider: Provider): Promise<OAuthUrlResponse> {
  return invoke("get_oauth_url", { provider });
}

export async function getDeviceCode(provider: Provider): Promise<DeviceCodeResponse> {
  return invoke("get_device_code", { provider });
}

export async function pollOAuthStatus(oauthState: string): Promise<boolean> {
  return invoke("poll_oauth_status", { oauthState });
}

export async function completeOAuth(provider: Provider, code: string): Promise<AuthStatus> {
  return invoke("complete_oauth", { code, provider });
}

export async function disconnectProvider(provider: Provider): Promise<AuthStatus> {
  return invoke("disconnect_provider", { provider });
}

export async function importVertexCredential(filePath: string): Promise<AuthStatus> {
  return invoke("import_vertex_credential", { filePath });
}

export interface AuthStatus {
  antigravity: number;
  claude: number;
  gemini: number;
  iflow: number;
  kimi: number;
  kiro: number;
  openai: number;
  qwen: number;
  vertex: number;
}

export async function getAuthStatus(): Promise<AuthStatus> {
  return invoke("get_auth_status");
}

export async function refreshAuthStatus(): Promise<AuthStatus> {
  return invoke("refresh_auth_status");
}

// Event listeners
export interface OAuthCallback {
  code: string;
  provider: Provider;
}

export async function onAuthStatusChanged(
  callback: (status: AuthStatus) => void,
): Promise<UnlistenFn> {
  return listen<AuthStatus>("auth-status-changed", (event) => {
    callback(event.payload);
  });
}

export async function onOAuthCallback(
  callback: (data: OAuthCallback) => void,
): Promise<UnlistenFn> {
  return listen<OAuthCallback>("oauth-callback", (event) => {
    callback(event.payload);
  });
}

// ==========================================================================
// Proxy Auth Status Verification (CLIProxyAPI v6.6.72+)
// ==========================================================================

// Detailed auth status from CLIProxyAPI's /api/auth/status endpoint
export interface ProxyAuthProviderStatus {
  account?: string;
  accounts?: number;
  authenticated: boolean;
  error?: string;
}

export interface ProxyAuthProviders {
  antigravity?: ProxyAuthProviderStatus;
  claude?: ProxyAuthProviderStatus;
  copilot?: ProxyAuthProviderStatus;
  gemini?: ProxyAuthProviderStatus;
  iflow?: ProxyAuthProviderStatus;
  openai?: ProxyAuthProviderStatus;
  qwen?: ProxyAuthProviderStatus;
  vertex?: ProxyAuthProviderStatus;
}

export interface ProxyAuthStatus {
  providers: ProxyAuthProviders;
  status: string; // "ok", "error", "unknown", "unsupported"
}

// Verify auth status from CLIProxyAPI (v6.6.72+)
export async function verifyProxyAuthStatus(): Promise<ProxyAuthStatus> {
  return invoke("verify_proxy_auth_status");
}

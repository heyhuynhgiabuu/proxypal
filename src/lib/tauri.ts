import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Proxy management
export async function startProxy(): Promise<ProxyStatus> {
  return invoke("start_proxy");
}

export async function stopProxy(): Promise<ProxyStatus> {
  return invoke("stop_proxy");
}

export interface ProxyStatus {
  running: boolean;
  port: number;
  endpoint: string;
}

export async function getProxyStatus(): Promise<ProxyStatus> {
  return invoke("get_proxy_status");
}

// OAuth management
export type Provider = "claude" | "openai" | "gemini" | "qwen";

export async function openOAuth(provider: Provider): Promise<string> {
  return invoke("open_oauth", { provider });
}

export async function pollOAuthStatus(oauthState: string): Promise<boolean> {
  return invoke("poll_oauth_status", { oauthState });
}

export async function completeOAuth(
  provider: Provider,
  code: string,
): Promise<AuthStatus> {
  return invoke("complete_oauth", { provider, code });
}

export async function disconnectProvider(
  provider: Provider,
): Promise<AuthStatus> {
  return invoke("disconnect_provider", { provider });
}

export interface AuthStatus {
  claude: boolean;
  openai: boolean;
  gemini: boolean;
  qwen: boolean;
}

export async function getAuthStatus(): Promise<AuthStatus> {
  return invoke("get_auth_status");
}

export async function refreshAuthStatus(): Promise<AuthStatus> {
  return invoke("refresh_auth_status");
}

// Config
export interface AppConfig {
  port: number;
  autoStart: boolean;
  launchAtLogin: boolean;
}

export async function getConfig(): Promise<AppConfig> {
  return invoke("get_config");
}

export async function saveConfig(config: AppConfig): Promise<void> {
  return invoke("save_config", { config });
}

// Event listeners
export interface OAuthCallback {
  provider: Provider;
  code: string;
}

export async function onProxyStatusChanged(
  callback: (status: ProxyStatus) => void,
): Promise<UnlistenFn> {
  return listen<ProxyStatus>("proxy-status-changed", (event) => {
    callback(event.payload);
  });
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

export async function onTrayToggleProxy(
  callback: (shouldStart: boolean) => void,
): Promise<UnlistenFn> {
  return listen<boolean>("tray-toggle-proxy", (event) => {
    callback(event.payload);
  });
}

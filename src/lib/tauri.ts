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
export type Provider =
  | "claude"
  | "openai"
  | "gemini"
  | "qwen"
  | "iflow"
  | "vertex"
  | "antigravity";

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

export async function importVertexCredential(
  filePath: string,
): Promise<AuthStatus> {
  return invoke("import_vertex_credential", { filePath });
}

export interface AuthStatus {
  claude: boolean;
  openai: boolean;
  gemini: boolean;
  qwen: boolean;
  iflow: boolean;
  vertex: boolean;
  antigravity: boolean;
}

export async function getAuthStatus(): Promise<AuthStatus> {
  return invoke("get_auth_status");
}

export async function refreshAuthStatus(): Promise<AuthStatus> {
  return invoke("refresh_auth_status");
}

// Amp model mapping for routing requests to different models
export interface AmpModelMapping {
  from: string;
  to: string;
}

// Config
export interface AppConfig {
  port: number;
  autoStart: boolean;
  launchAtLogin: boolean;
  debug: boolean;
  proxyUrl: string;
  requestRetry: number;
  quotaSwitchProject: boolean;
  quotaSwitchPreviewModel: boolean;
  usageStatsEnabled: boolean;
  requestLogging: boolean;
  loggingToFile: boolean;
  ampApiKey: string;
  ampModelMappings: AmpModelMapping[];
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

// System notifications
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export async function showSystemNotification(
  title: string,
  body?: string,
): Promise<void> {
  let permissionGranted = await isPermissionGranted();

  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === "granted";
  }

  if (permissionGranted) {
    sendNotification({ title, body });
  }
}

// Request log for live monitoring
export interface RequestLog {
  id: string;
  timestamp: number;
  provider: string;
  model: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  tokensIn?: number;
  tokensOut?: number;
}

export async function onRequestLog(
  callback: (log: RequestLog) => void,
): Promise<UnlistenFn> {
  return listen<RequestLog>("request-log", (event) => {
    callback(event.payload);
  });
}

// Provider health check
export interface HealthStatus {
  status: "healthy" | "degraded" | "offline" | "unconfigured";
  latencyMs?: number;
  lastChecked: number;
}

export interface ProviderHealth {
  claude: HealthStatus;
  openai: HealthStatus;
  gemini: HealthStatus;
  qwen: HealthStatus;
  iflow: HealthStatus;
  vertex: HealthStatus;
  antigravity: HealthStatus;
}

export async function checkProviderHealth(): Promise<ProviderHealth> {
  return invoke("check_provider_health");
}

// AI Tool Detection & Setup
export interface DetectedTool {
  id: string;
  name: string;
  installed: boolean;
  configPath?: string;
  canAutoConfigure: boolean;
}

export async function detectAiTools(): Promise<DetectedTool[]> {
  return invoke("detect_ai_tools");
}

export async function configureContinue(): Promise<string> {
  return invoke("configure_continue");
}

export interface ToolSetupStep {
  title: string;
  description: string;
  copyable?: string;
}

export interface ToolSetupInfo {
  name: string;
  logo: string;
  canAutoConfigure: boolean;
  note?: string;
  steps: ToolSetupStep[];
  manualConfig?: string;
  endpoint?: string;
}

export async function getToolSetupInfo(toolId: string): Promise<ToolSetupInfo> {
  return invoke("get_tool_setup_info", { toolId });
}

// CLI Agent Types and Functions
export interface AgentStatus {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  configured: boolean;
  configType: "env" | "file" | "both";
  configPath?: string;
  logo: string;
  docsUrl: string;
}

export interface AgentConfigResult {
  success: boolean;
  configType: "env" | "file" | "both" | "config";
  configPath?: string;
  authPath?: string;
  shellConfig?: string;
  instructions: string;
  modelsConfigured?: number;
}

export async function detectCliAgents(): Promise<AgentStatus[]> {
  return invoke("detect_cli_agents");
}

export async function configureCliAgent(
  agentId: string,
  models: AvailableModel[],
): Promise<AgentConfigResult> {
  return invoke("configure_cli_agent", { agentId, models });
}

export async function getShellProfilePath(): Promise<string> {
  return invoke("get_shell_profile_path");
}

export async function appendToShellProfile(content: string): Promise<string> {
  return invoke("append_to_shell_profile", { content });
}

// Usage Statistics
export interface TimeSeriesPoint {
  label: string;
  value: number;
}

export interface ModelUsage {
  model: string;
  requests: number;
  tokens: number;
}

export interface UsageStats {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  requestsToday: number;
  tokensToday: number;
  models: ModelUsage[];
  requestsByDay: TimeSeriesPoint[];
  tokensByDay: TimeSeriesPoint[];
  requestsByHour: TimeSeriesPoint[];
  tokensByHour: TimeSeriesPoint[];
}

export async function getUsageStats(): Promise<UsageStats> {
  // get_usage_stats now computes from local history, no longer needs proxy running
  return invoke("get_usage_stats");
}

// Request History (persisted)
export interface RequestHistory {
  requests: RequestLog[];
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
}

export async function getRequestHistory(): Promise<RequestHistory> {
  return invoke("get_request_history");
}

export async function addRequestToHistory(
  request: RequestLog,
): Promise<RequestHistory> {
  return invoke("add_request_to_history", { request });
}

export async function clearRequestHistory(): Promise<void> {
  return invoke("clear_request_history");
}

// Test agent connection
export interface AgentTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

export async function testAgentConnection(
  agentId: string,
): Promise<AgentTestResult> {
  return invoke("test_agent_connection", { agentId });
}

// ============================================
// API Keys Management
// ============================================

// Gemini API Key structure
export interface GeminiApiKey {
  apiKey: string;
  baseUrl?: string;
  proxyUrl?: string;
  headers?: Record<string, string>;
  excludedModels?: string[];
}

// Claude API Key structure
export interface ClaudeApiKey {
  apiKey: string;
  baseUrl?: string;
  proxyUrl?: string;
  headers?: Record<string, string>;
  models?: string[];
  excludedModels?: string[];
}

// Codex API Key structure
export interface CodexApiKey {
  apiKey: string;
  baseUrl?: string;
  proxyUrl?: string;
  headers?: Record<string, string>;
}

// OpenAI-Compatible Provider structure
export interface OpenAICompatibleProvider {
  name: string;
  baseUrl: string;
  apiKeyEntries: Array<{
    apiKey: string;
    proxyUrl?: string;
  }>;
  models?: Array<{
    name: string;
    alias?: string;
  }>;
  headers?: Record<string, string>;
}

// API Keys response wrapper
export interface ApiKeysResponse<T> {
  keys: T[];
}

// Gemini API Keys
export async function getGeminiApiKeys(): Promise<GeminiApiKey[]> {
  return invoke("get_gemini_api_keys");
}

export async function setGeminiApiKeys(keys: GeminiApiKey[]): Promise<void> {
  return invoke("set_gemini_api_keys", { keys });
}

export async function addGeminiApiKey(key: GeminiApiKey): Promise<void> {
  return invoke("add_gemini_api_key", { key });
}

export async function deleteGeminiApiKey(index: number): Promise<void> {
  return invoke("delete_gemini_api_key", { index });
}

// Claude API Keys
export async function getClaudeApiKeys(): Promise<ClaudeApiKey[]> {
  return invoke("get_claude_api_keys");
}

export async function setClaudeApiKeys(keys: ClaudeApiKey[]): Promise<void> {
  return invoke("set_claude_api_keys", { keys });
}

export async function addClaudeApiKey(key: ClaudeApiKey): Promise<void> {
  return invoke("add_claude_api_key", { key });
}

export async function deleteClaudeApiKey(index: number): Promise<void> {
  return invoke("delete_claude_api_key", { index });
}

// Codex API Keys
export async function getCodexApiKeys(): Promise<CodexApiKey[]> {
  return invoke("get_codex_api_keys");
}

export async function setCodexApiKeys(keys: CodexApiKey[]): Promise<void> {
  return invoke("set_codex_api_keys", { keys });
}

export async function addCodexApiKey(key: CodexApiKey): Promise<void> {
  return invoke("add_codex_api_key", { key });
}

export async function deleteCodexApiKey(index: number): Promise<void> {
  return invoke("delete_codex_api_key", { index });
}

// OpenAI-Compatible Providers
export async function getOpenAICompatibleProviders(): Promise<
  OpenAICompatibleProvider[]
> {
  return invoke("get_openai_compatible_providers");
}

export async function setOpenAICompatibleProviders(
  providers: OpenAICompatibleProvider[],
): Promise<void> {
  return invoke("set_openai_compatible_providers", { providers });
}

export async function addOpenAICompatibleProvider(
  provider: OpenAICompatibleProvider,
): Promise<void> {
  return invoke("add_openai_compatible_provider", { provider });
}

export async function deleteOpenAICompatibleProvider(
  index: number,
): Promise<void> {
  return invoke("delete_openai_compatible_provider", { index });
}

// ============================================
// Auth Files Management
// ============================================

// Auth file entry from Management API
export interface AuthFile {
  id: string;
  name: string;
  provider: string;
  label?: string;
  status: "ready" | "error" | "disabled";
  statusMessage?: string;
  disabled: boolean;
  unavailable: boolean;
  runtimeOnly: boolean;
  source?: "file" | "memory";
  path?: string;
  size?: number;
  modtime?: string;
  email?: string;
  accountType?: string;
  account?: string;
  createdAt?: string;
  updatedAt?: string;
  lastRefresh?: string;
  successCount?: number;
  failureCount?: number;
}

export async function getAuthFiles(): Promise<AuthFile[]> {
  return invoke("get_auth_files");
}

export async function uploadAuthFile(
  filePath: string,
  provider: string,
): Promise<void> {
  return invoke("upload_auth_file", { filePath, provider });
}

export async function deleteAuthFile(fileId: string): Promise<void> {
  return invoke("delete_auth_file", { fileId });
}

export async function toggleAuthFile(
  fileId: string,
  disabled: boolean,
): Promise<void> {
  return invoke("toggle_auth_file", { fileId, disabled });
}

export async function downloadAuthFile(
  fileId: string,
  filename: string,
): Promise<string> {
  return invoke("download_auth_file", { fileId, filename });
}

export async function deleteAllAuthFiles(): Promise<void> {
  return invoke("delete_all_auth_files");
}

// ============================================================================
// Log Viewer
// ============================================================================

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export async function getLogs(lines?: number): Promise<LogEntry[]> {
  return invoke("get_logs", { lines });
}

export async function clearLogs(): Promise<void> {
  return invoke("clear_logs");
}

// ============================================================================
// Available Models (from /v1/models endpoint)
// ============================================================================

export interface AvailableModel {
  id: string;
  ownedBy: string; // "google", "openai", "qwen", "anthropic", etc.
}

export interface GroupedModels {
  provider: string; // Display name: "Gemini", "OpenAI/Codex", "Qwen", etc.
  models: string[];
}

export async function getAvailableModels(): Promise<AvailableModel[]> {
  return invoke("get_available_models");
}

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
  claude: number;
  openai: number;
  gemini: number;
  qwen: number;
  iflow: number;
  vertex: number;
  antigravity: number;
}

export async function getAuthStatus(): Promise<AuthStatus> {
  return invoke("get_auth_status");
}

export async function refreshAuthStatus(): Promise<AuthStatus> {
  return invoke("refresh_auth_status");
}

// Amp model mapping for routing requests to different models (simple mode)
export interface AmpModelMapping {
  from: string;
  to: string;
  enabled?: boolean; // Whether this mapping is active
}

// Predefined Amp model slots with friendly names
export interface AmpModelSlot {
  id: string;
  name: string; // Friendly display name: "Smart", "Rush", "Oracle"
  fromModel: string; // Actual Amp model identifier
  fromLabel: string; // Friendly label for the source model
}

// Default Amp model slots (these are the models Amp CLI uses)
// Based on actual Amp CLI logs (~/.cache/amp/logs/cli.log) and ampcode.com/models
// IMPORTANT: Model names must match EXACTLY what Amp sends in requests
export const AMP_MODEL_SLOTS: AmpModelSlot[] = [
  // Claude Opus 4.5 - used by Smart agent (default main agent)
  {
    id: "opus-4-5",
    name: "Smart",
    fromModel: "claude-opus-4-5-20251101", // Opus 4.5 (200K context)
    fromLabel: "Claude Opus 4.5 (200K)",
  },
  // Claude Sonnet 4.5 - used by Librarian subagent
  {
    id: "sonnet-4-5",
    name: "Librarian",
    fromModel: "claude-sonnet-4-5-20250929", // Sonnet 4.5 (1M context)
    fromLabel: "Claude Sonnet 4.5 (1M)",
  },
  // Claude Haiku 4.5 - used by Rush agent and Search subagent
  {
    id: "haiku-4-5",
    name: "Rush / Search",
    fromModel: "claude-haiku-4-5-20251001", // Haiku 4.5
    fromLabel: "Claude Haiku 4.5",
  },
  // GPT-5.1 - used by Oracle agent
  {
    id: "oracle",
    name: "Oracle",
    fromModel: "gpt-5.1",
    fromLabel: "GPT-5.1",
  },
  // Gemini models for Review and Handoff
  {
    id: "review",
    name: "Review",
    fromModel: "gemini-2.5-flash-lite",
    fromLabel: "Gemini 2.5 Flash-Lite",
  },
  {
    id: "handoff",
    name: "Handoff",
    fromModel: "gemini-2.5-flash",
    fromLabel: "Gemini 2.5 Flash",
  },
];

// Common model aliases that Amp might use (without date suffix)
// These map to the full model identifiers
export const AMP_MODEL_ALIASES: Record<string, string> = {
  "claude-opus-4.5": "claude-opus-4-5-20251101",
  "claude-opus-4-5": "claude-opus-4-5-20251101",
  "claude-haiku-4.5": "claude-haiku-4-5-20251001",
  "claude-haiku-4-5": "claude-haiku-4-5-20251001",
  "claude-sonnet-4.5": "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-5": "claude-sonnet-4-5-20250929",
};

// Complete list of GitHub Copilot models available via copilot-api
// These are exposed as copilot-{model} aliases in CLIProxyAPI
export const COPILOT_MODELS = {
  // OpenAI GPT models
  openai: [
    { id: "copilot-gpt-4.1", name: "GPT-4.1", status: "GA" },
    { id: "copilot-gpt-5", name: "GPT-5", status: "GA" },
    { id: "copilot-gpt-5-mini", name: "GPT-5 Mini", status: "GA" },
    { id: "copilot-gpt-5-codex", name: "GPT-5 Codex", status: "Preview" },
    { id: "copilot-gpt-5.1", name: "GPT-5.1", status: "Preview" },
    { id: "copilot-gpt-5.1-codex", name: "GPT-5.1 Codex", status: "Preview" },
    {
      id: "copilot-gpt-5.1-codex-mini",
      name: "GPT-5.1 Codex Mini",
      status: "Preview",
    },
    // Legacy models
    { id: "copilot-gpt-4o", name: "GPT-4o", status: "Legacy" },
    { id: "copilot-gpt-4", name: "GPT-4", status: "Legacy" },
    { id: "copilot-gpt-4-turbo", name: "GPT-4 Turbo", status: "Legacy" },
    { id: "copilot-o1", name: "O1", status: "Legacy" },
    { id: "copilot-o1-mini", name: "O1 Mini", status: "Legacy" },
  ],
  // Anthropic Claude models
  claude: [
    { id: "copilot-claude-haiku-4.5", name: "Claude Haiku 4.5", status: "GA" },
    { id: "copilot-claude-opus-4.1", name: "Claude Opus 4.1", status: "GA" },
    { id: "copilot-claude-sonnet-4", name: "Claude Sonnet 4", status: "GA" },
    {
      id: "copilot-claude-sonnet-4.5",
      name: "Claude Sonnet 4.5",
      status: "GA",
    },
    {
      id: "copilot-claude-opus-4.5",
      name: "Claude Opus 4.5",
      status: "Preview",
    },
  ],
  // Google Gemini models
  gemini: [
    { id: "copilot-gemini-2.5-pro", name: "Gemini 2.5 Pro", status: "GA" },
    { id: "copilot-gemini-3-pro", name: "Gemini 3 Pro", status: "Preview" },
  ],
  // Other models
  other: [
    {
      id: "copilot-grok-code-fast-1",
      name: "Grok Code Fast 1 (xAI)",
      status: "GA",
    },
    {
      id: "copilot-raptor-mini",
      name: "Raptor Mini (Fine-tuned)",
      status: "Preview",
    },
  ],
};

// OpenAI-compatible model for Amp routing
export interface AmpOpenAIModel {
  name: string;
  alias: string;
}

// OpenAI-compatible provider configuration for Amp
export interface AmpOpenAIProvider {
  id: string; // Unique identifier (UUID)
  name: string;
  baseUrl: string;
  apiKey: string;
  models: AmpOpenAIModel[];
}

// GitHub Copilot configuration (via copilot-api)
export interface CopilotConfig {
  enabled: boolean;
  port: number;
  accountType: string; // "individual", "business", "enterprise"
  githubToken: string;
  rateLimit?: number;
  rateLimitWait: boolean;
}

// Copilot status
export interface CopilotStatus {
  running: boolean;
  port: number;
  endpoint: string;
  authenticated: boolean;
}

// Copilot API detection result
export interface CopilotApiDetection {
  installed: boolean;
  version?: string;
  copilotBin?: string; // Path to copilot-api binary (if installed)
  npxBin?: string; // Path to npx binary (for fallback)
  npmBin?: string; // Path to npm binary (for installs)
  nodeBin?: string; // Path to node binary actually used
  nodeAvailable: boolean;
  checkedNodePaths: string[];
  checkedCopilotPaths: string[];
}

// Copilot API install result
export interface CopilotApiInstallResult {
  success: boolean;
  message: string;
  version?: string;
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
  ampOpenaiProvider?: AmpOpenAIProvider; // Deprecated: for migration only
  ampOpenaiProviders: AmpOpenAIProvider[]; // Array of custom providers
  ampRoutingMode: string; // "mappings" or "openai"
  copilot: CopilotConfig;
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

// ============================================
// Copilot API Management (via copilot-api)
// ============================================

export async function getCopilotStatus(): Promise<CopilotStatus> {
  return invoke("get_copilot_status");
}

export async function startCopilot(): Promise<CopilotStatus> {
  return invoke("start_copilot");
}

export async function stopCopilot(): Promise<CopilotStatus> {
  return invoke("stop_copilot");
}

export async function checkCopilotHealth(): Promise<CopilotStatus> {
  return invoke("check_copilot_health");
}

export async function detectCopilotApi(): Promise<CopilotApiDetection> {
  return invoke("detect_copilot_api");
}

export async function installCopilotApi(): Promise<CopilotApiInstallResult> {
  return invoke("install_copilot_api");
}

export async function onCopilotStatusChanged(
  callback: (status: CopilotStatus) => void,
): Promise<UnlistenFn> {
  return listen<CopilotStatus>("copilot-status-changed", (event) => {
    callback(event.payload);
  });
}

export async function onCopilotAuthRequired(
  callback: (message: string) => void,
): Promise<UnlistenFn> {
  return listen<string>("copilot-auth-required", (event) => {
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
  configType: "env" | "file" | "both" | "config";
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

// Sync usage statistics from CLIProxyAPI (fetches real token counts)
export async function syncUsageFromProxy(): Promise<RequestHistory> {
  return invoke("sync_usage_from_proxy");
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

// Test OpenAI-compatible provider connection
export interface ProviderTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
  modelsFound?: number;
}

export async function testOpenAIProvider(
  baseUrl: string,
  apiKey: string,
): Promise<ProviderTestResult> {
  return invoke("test_openai_provider", { baseUrl, apiKey });
}

// ============================================
// API Keys Management
// ============================================

// Model mapping with alias and name (used by Claude and OpenAI-compatible providers)
export interface ModelMapping {
  name: string;
  alias?: string;
}

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
  models?: ModelMapping[];
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
  models?: ModelMapping[];
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

// ============================================================================
// Management API Settings (Runtime Updates)
// ============================================================================

// Max Retry Interval - controls backoff timing for retries
export async function getMaxRetryInterval(): Promise<number> {
  return invoke("get_max_retry_interval");
}

export async function setMaxRetryInterval(value: number): Promise<void> {
  return invoke("set_max_retry_interval", { value });
}

// WebSocket Auth - toggle WebSocket authentication requirement
export async function getWebsocketAuth(): Promise<boolean> {
  return invoke("get_websocket_auth");
}

export async function setWebsocketAuth(value: boolean): Promise<void> {
  return invoke("set_websocket_auth", { value });
}

// Prioritize Model Mappings - model mappings take precedence over local API keys
export async function getPrioritizeModelMappings(): Promise<boolean> {
  return invoke("get_prioritize_model_mappings");
}

export async function setPrioritizeModelMappings(
  value: boolean,
): Promise<void> {
  return invoke("set_prioritize_model_mappings", { value });
}

// OAuth Excluded Models - block specific models per OAuth provider
export type OAuthExcludedModels = Record<string, string[]>;

export async function getOAuthExcludedModels(): Promise<OAuthExcludedModels> {
  return invoke("get_oauth_excluded_models");
}

export async function setOAuthExcludedModels(
  provider: string,
  models: string[],
): Promise<void> {
  return invoke("set_oauth_excluded_models", { provider, models });
}

export async function deleteOAuthExcludedModels(
  provider: string,
): Promise<void> {
  return invoke("delete_oauth_excluded_models", { provider });
}

// Raw Config YAML - for power users
export async function getConfigYaml(): Promise<string> {
  return invoke("get_config_yaml");
}

export async function setConfigYaml(yaml: string): Promise<void> {
  return invoke("set_config_yaml", { yaml });
}

// Request Error Logs - view error-specific logs
export async function getRequestErrorLogs(): Promise<string[]> {
  return invoke("get_request_error_logs");
}

export async function getRequestErrorLogContent(
  filename: string,
): Promise<string> {
  return invoke("get_request_error_log_content", { filename });
}

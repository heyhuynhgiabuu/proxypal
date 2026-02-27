import { invoke } from "@tauri-apps/api/core";

// ============================================
// Thinking Budget Settings
// ============================================

export interface ThinkingBudgetSettings {
  customBudget: number;
  mode: "low" | "medium" | "high" | "custom";
}

export async function getThinkingBudgetSettings(): Promise<ThinkingBudgetSettings> {
  return invoke("get_thinking_budget_settings");
}

export async function setThinkingBudgetSettings(settings: ThinkingBudgetSettings): Promise<void> {
  return invoke("set_thinking_budget_settings", { settings });
}

// ============================================
// Reasoning Effort Settings (GPT/Codex models)
// ============================================

export type ReasoningEffortLevel = "none" | "low" | "medium" | "high" | "xhigh";

export interface ReasoningEffortSettings {
  level: ReasoningEffortLevel;
}

export async function getReasoningEffortSettings(): Promise<ReasoningEffortSettings> {
  return invoke("get_reasoning_effort_settings");
}

export async function setReasoningEffortSettings(settings: ReasoningEffortSettings): Promise<void> {
  return invoke("set_reasoning_effort_settings", { settings });
}

// ============================================
// Close to Tray Setting
// ============================================

export async function getCloseToTray(): Promise<boolean> {
  return invoke("get_close_to_tray");
}

export async function setCloseToTray(enabled: boolean): Promise<void> {
  return invoke("set_close_to_tray", { enabled });
}

// ============================================
// Management API Settings (Runtime Updates)
// ============================================

// Max Retry Interval - controls backoff timing for retries
export async function getMaxRetryInterval(): Promise<number> {
  return invoke("get_max_retry_interval");
}

export async function setMaxRetryInterval(value: number): Promise<void> {
  return invoke("set_max_retry_interval", { value });
}

// Log Size - controls how many log entries are retained in memory
export async function getLogSize(): Promise<number> {
  return invoke("get_log_size");
}

export async function setLogSize(size: number): Promise<void> {
  return invoke("set_log_size", { size });
}

// WebSocket Auth - toggle WebSocket authentication requirement
export async function getWebsocketAuth(): Promise<boolean> {
  return invoke("get_websocket_auth");
}

export async function setWebsocketAuth(value: boolean): Promise<void> {
  return invoke("set_websocket_auth", { value });
}

// Force Model Mappings - model mappings take precedence over local API keys
export async function getForceModelMappings(): Promise<boolean> {
  return invoke("get_force_model_mappings");
}

export async function setForceModelMappings(value: boolean): Promise<void> {
  return invoke("set_force_model_mappings", { value });
}

// OAuth Excluded Models - block specific models per OAuth provider
export type OAuthExcludedModels = Record<string, string[]>;

export async function getOAuthExcludedModels(): Promise<OAuthExcludedModels> {
  return invoke("get_oauth_excluded_models");
}

export async function setOAuthExcludedModels(provider: string, models: string[]): Promise<void> {
  return invoke("set_oauth_excluded_models", { models, provider });
}

export async function deleteOAuthExcludedModels(provider: string): Promise<void> {
  return invoke("delete_oauth_excluded_models", { provider });
}

// Claude Code Settings
export interface ClaudeCodeSettings {
  authToken: string | null;
  baseUrl: string | null;
  haikuModel: string | null;
  opusModel: string | null;
  sonnetModel: string | null;
}

export async function getClaudeCodeSettings(): Promise<ClaudeCodeSettings> {
  return invoke("get_claude_code_settings");
}

export async function setClaudeCodeModel(modelType: string, modelName: string): Promise<void> {
  return invoke("set_claude_code_model", { modelName, modelType });
}

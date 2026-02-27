import { invoke } from "@tauri-apps/api/core";

import type { CloudflareConfig } from "./cloudflare";
import type { AmpModelMapping, AmpOpenAIProvider, CopilotConfig } from "./models";
import type { SshConfig } from "./ssh";

// Config
export interface AppConfig {
  ampApiKey: string;
  ampModelMappings: AmpModelMapping[];
  ampOpenaiProvider?: AmpOpenAIProvider; // Deprecated: for migration only
  ampOpenaiProviders: AmpOpenAIProvider[]; // Array of custom providers
  ampRoutingMode: string; // "mappings" or "openai"
  autoStart: boolean;
  cloudflareConfigs?: CloudflareConfig[];
  commercialMode?: boolean; // Disable request logging for lower memory usage
  copilot: CopilotConfig;
  debug: boolean;
  disableControlPanel?: boolean; // Hide CLIProxyAPI's web management UI
  forceModelMappings: boolean; // Force model mappings to take precedence over local API keys
  geminiThinkingInjection?: boolean; // Inject thinking config for Gemini 3 models
  launchAtLogin: boolean;
  locale?: string;
  loggingToFile: boolean;
  logsMaxTotalSizeMb: number;
  managementKey?: string; // Management API key for internal proxy calls
  port: number;
  proxyApiKey?: string; // API key for client authentication
  proxyPassword?: string;
  proxyUrl: string;
  proxyUsername?: string;
  quotaSwitchPreviewModel: boolean;
  quotaSwitchProject: boolean;
  requestLogging: boolean;
  requestRetry: number;
  routingStrategy: string; // "round-robin", "fill-first", "sequential"
  sidebarPinned?: boolean;
  sshConfigs?: SshConfig[];
  usageStatsEnabled: boolean;
  useSystemProxy?: boolean;
  wsAuth?: boolean; // Require authentication for WebSocket connections
}

export async function getConfig(): Promise<AppConfig> {
  return invoke("get_config");
}

export async function saveConfig(config: AppConfig): Promise<void> {
  return invoke("save_config", { config });
}

export async function reloadConfig(): Promise<AppConfig> {
  return invoke("reload_config");
}

// Raw Config YAML - for power users
export async function getConfigYaml(): Promise<string> {
  return invoke("get_config_yaml");
}

export async function setConfigYaml(yaml: string): Promise<void> {
  return invoke("save_config_yaml", { yaml });
}

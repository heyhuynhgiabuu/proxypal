import { invoke } from "@tauri-apps/api/core";

import type { OpenAICompatibleProvider, XaiApiKey } from "./api-keys";
import type { CloudflareConfig } from "./cloudflare";
import type { AmpOpenAIProvider, CopilotConfig } from "./models";
import type { SshConfig } from "./ssh";

// Config
export interface AppConfig {
  /** @deprecated Legacy Amp CLI fields retained for config.json compatibility */
  ampApiKey?: string;
  /** @deprecated Legacy Amp CLI fields retained for config.json compatibility */
  ampModelMappings?: Array<{
    alias: string;
    enabled?: boolean;
    fork?: boolean;
    name: string;
  }>;
  ampOpenaiProvider?: AmpOpenAIProvider;
  ampOpenaiProviders: AmpOpenAIProvider[];
  /** @deprecated Legacy Amp CLI fields retained for config.json compatibility */
  ampRoutingMode?: string;
  autoStart: boolean;
  cloudflareConfigs?: CloudflareConfig[];
  openaiCompatibleProviders?: OpenAICompatibleProvider[];
  commercialMode?: boolean;
  copilot: CopilotConfig;
  debug: boolean;
  disableControlPanel?: boolean;
  geminiThinkingInjection?: boolean;
  launchAtLogin: boolean;
  locale?: string;
  loggingToFile: boolean;
  logsMaxTotalSizeMb: number;
  managementKey?: string;
  port: number;
  proxyApiKey?: string;
  proxyPassword?: string;
  proxyUrl: string;
  proxyUsername?: string;
  quotaSwitchPreviewModel: boolean;
  quotaSwitchProject: boolean;
  requestLogging: boolean;
  requestRetry: number;
  routingStrategy: string;
  sidebarPinned?: boolean;
  sshConfigs?: SshConfig[];
  usageStatsEnabled: boolean;
  useSystemProxy?: boolean;
  wsAuth?: boolean;
  xaiApiKeys?: XaiApiKey[];
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

export async function getConfigYaml(): Promise<string> {
  return invoke("get_config_yaml");
}

export async function setConfigYaml(yaml: string): Promise<void> {
  return invoke("save_config_yaml", { yaml });
}

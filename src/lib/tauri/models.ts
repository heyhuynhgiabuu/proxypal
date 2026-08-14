import { invoke } from "@tauri-apps/api/core";

// GPT Reasoning Models (single source of truth from backend)
export async function getGptReasoningModels(): Promise<string[]> {
  return invoke("get_gpt_reasoning_models");
}

// OpenAI-compatible model aliases for custom providers
export interface AmpOpenAIModel {
  alias: string;
  name: string;
}

// OpenAI-compatible provider configuration
export interface AmpOpenAIProvider {
  apiKey: string;
  baseUrl: string;
  id: string;
  models: AmpOpenAIModel[];
  name: string;
}

// GitHub Copilot configuration (via copilot-api)
export interface CopilotConfig {
  accountType: string; // "individual", "business", "enterprise"
  enabled: boolean;
  githubToken: string;
  port: number;
  rateLimit?: number;
  rateLimitWait: boolean;
}

export interface AvailableModel {
  id: string;
  ownedBy: string; // "google", "openai", "qwen", "anthropic", etc.
  source: string; // "vertex", "gemini-api", "copilot", "oauth", "api-key", etc.
}

export interface GroupedModels {
  models: string[];
  provider: string; // Display name: "Gemini", "OpenAI/Codex", "Qwen", etc.
}

// OpenAI-compatible provider models
export interface OpenAICompatibleModel {
  created?: number;
  id: string;
  ownedBy?: string;
}

export interface OpenAICompatibleProviderModels {
  baseUrl: string;
  error?: string;
  models: OpenAICompatibleModel[];
  providerName: string;
}

export async function getAvailableModels(): Promise<AvailableModel[]> {
  return invoke("get_available_models");
}

// Static model definitions from the CLIProxyAPI registry
// (GET /v0/management/model-definitions/:channel)
export interface ModelDefinition {
  contextLength?: number;
  displayName?: string;
  id: string;
  maxCompletionTokens?: number;
  name?: string;
  object?: string;
  ownedBy?: string;
  supportedInputModalities?: string[];
  supportedOutputModalities?: string[];
  supportsWebSearch?: boolean;
  thinking?: {
    levels?: string[];
    max?: number;
    min?: number;
    zeroAllowed?: boolean;
  };
  type?: string;
}

export async function getModelDefinitions(channel: string): Promise<ModelDefinition[]> {
  return invoke("get_model_definitions", { channel });
}

export async function fetchOpenaiCompatibleModels(): Promise<OpenAICompatibleProviderModels[]> {
  return invoke("fetch_openai_compatible_models");
}

import { invoke } from "@tauri-apps/api/core";

// GPT Reasoning Models (single source of truth from backend)
export async function getGptReasoningModels(): Promise<string[]> {
  return invoke("get_gpt_reasoning_models");
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

export async function fetchOpenaiCompatibleModels(): Promise<OpenAICompatibleProviderModels[]> {
  return invoke("fetch_openai_compatible_models");
}

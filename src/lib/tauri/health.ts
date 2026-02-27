import { invoke } from "@tauri-apps/api/core";

// Provider health check
export interface HealthStatus {
  lastChecked: number;
  latencyMs?: number;
  status: "healthy" | "degraded" | "offline" | "unconfigured";
}

export interface ProviderHealth {
  antigravity: HealthStatus;
  claude: HealthStatus;
  gemini: HealthStatus;
  iflow: HealthStatus;
  kimi: HealthStatus;
  kiro: HealthStatus;
  openai: HealthStatus;
  qwen: HealthStatus;
  vertex: HealthStatus;
}

export async function checkProviderHealth(): Promise<ProviderHealth> {
  return invoke("check_provider_health");
}

// Test OpenAI-compatible provider connection
export interface ProviderTestResult {
  latencyMs?: number;
  message: string;
  modelsFound?: number;
  success: boolean;
}

export async function testOpenAIProvider(
  baseUrl: string,
  apiKey: string,
): Promise<ProviderTestResult> {
  return invoke("test_openai_provider", { apiKey, baseUrl });
}

export async function testProviderConnection(modelId: string): Promise<ProviderTestResult> {
  return invoke("test_provider_connection", { modelId });
}

/** Test Kiro connection via kiro-cli chat --no-interactive "/usage". */
export async function testKiroConnection(): Promise<ProviderTestResult> {
  return invoke("test_kiro_connection");
}

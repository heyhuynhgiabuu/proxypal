import { invoke } from "@tauri-apps/api/core";

import type { AvailableModel } from "./models";

// CLI Agent Types and Functions
export interface AgentStatus {
  configPath?: string;
  configType: "env" | "file" | "both" | "config";
  configured: boolean;
  description: string;
  docsUrl: string;
  id: string;
  installed: boolean;
  logo: string;
  name: string;
}

export interface AgentConfigResult {
  authPath?: string;
  configPath?: string;
  configType: "env" | "file" | "both" | "config";
  instructions: string;
  modelsConfigured?: number;
  shellConfig?: string;
  success: boolean;
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

// Test agent connection
export interface AgentTestResult {
  latencyMs?: number;
  message: string;
  success: boolean;
}

export async function testAgentConnection(agentId: string): Promise<AgentTestResult> {
  return invoke("test_agent_connection", { agentId });
}

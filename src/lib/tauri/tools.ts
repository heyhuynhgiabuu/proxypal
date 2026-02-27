import { invoke } from "@tauri-apps/api/core";

// AI Tool Detection & Setup
export interface DetectedTool {
  canAutoConfigure: boolean;
  configPath?: string;
  id: string;
  installed: boolean;
  name: string;
}

export async function detectAiTools(): Promise<DetectedTool[]> {
  return invoke("detect_ai_tools");
}

export async function configureContinue(): Promise<string> {
  return invoke("configure_continue");
}

export interface ToolSetupStep {
  copyable?: string;
  description: string;
  title: string;
}

export interface ToolSetupInfo {
  canAutoConfigure: boolean;
  endpoint?: string;
  logo: string;
  manualConfig?: string;
  name: string;
  note?: string;
  steps: ToolSetupStep[];
}

export async function getToolSetupInfo(toolId: string): Promise<ToolSetupInfo> {
  return invoke("get_tool_setup_info", { toolId });
}

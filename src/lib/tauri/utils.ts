import { invoke } from "@tauri-apps/api/core";

import type { ThinkingBudgetSettings } from "./settings";

export async function openUrlInBrowser(url: string): Promise<void> {
  return invoke("open_url_in_browser", { url });
}

// Helper to get actual token count from settings
export function getThinkingBudgetTokens(settings: ThinkingBudgetSettings): number {
  switch (settings.mode) {
    case "low":
      return 2048;
    case "medium":
      return 8192;
    case "high":
      return 32_768;
    case "custom":
      return settings.customBudget;
    default:
      return 8192;
  }
}

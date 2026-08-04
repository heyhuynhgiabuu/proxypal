import { invoke } from "@tauri-apps/api/core";

export async function openUrlInBrowser(url: string): Promise<void> {
  return invoke("open_url_in_browser", { url });
}

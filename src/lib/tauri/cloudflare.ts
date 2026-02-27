import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ============================================================================
// Cloudflare Tunnel
// ============================================================================

export interface CloudflareConfig {
  enabled: boolean;
  id: string;
  localPort: number;
  name: string;
  tunnelToken: string;
}

export interface CloudflareStatusUpdate {
  id: string;
  message?: string;
  status: string;
  url?: string;
}

export async function getCloudflareConfigs(): Promise<CloudflareConfig[]> {
  return invoke("get_cloudflare_configs");
}

export async function saveCloudflareConfig(
  cfConfig: CloudflareConfig,
): Promise<CloudflareConfig[]> {
  return invoke("save_cloudflare_config", { cfConfig });
}

export async function deleteCloudflareConfig(id: string): Promise<CloudflareConfig[]> {
  return invoke("delete_cloudflare_config", { id });
}

export async function setCloudflareConnection(id: string, enable: boolean): Promise<void> {
  return invoke("set_cloudflare_connection", { enable, id });
}

export async function onCloudflareStatusChanged(
  callback: (status: CloudflareStatusUpdate) => void,
): Promise<UnlistenFn> {
  return listen<CloudflareStatusUpdate>("cloudflare-status-changed", (event) => {
    callback(event.payload);
  });
}

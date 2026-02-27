import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Proxy management
export interface ProxyStatus {
  endpoint: string;
  port: number;
  running: boolean;
}

export async function startProxy(): Promise<ProxyStatus> {
  return invoke("start_proxy");
}

export async function stopProxy(): Promise<ProxyStatus> {
  return invoke("stop_proxy");
}

export async function getProxyStatus(): Promise<ProxyStatus> {
  return invoke("get_proxy_status");
}

export async function onProxyStatusChanged(
  callback: (status: ProxyStatus) => void,
): Promise<UnlistenFn> {
  return listen<ProxyStatus>("proxy-status-changed", (event) => {
    callback(event.payload);
  });
}

export async function onTrayToggleProxy(
  callback: (shouldStart: boolean) => void,
): Promise<UnlistenFn> {
  return listen<boolean>("tray-toggle-proxy", (event) => {
    callback(event.payload);
  });
}

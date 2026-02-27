import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ============================================
// SSH Management
// ============================================

export interface SshConfig {
  enabled: boolean;
  host: string;
  id: string;
  keyFile?: string;
  localPort: number;
  password?: string;
  port: number;
  remotePort: number;
  username: string;
}

export interface SshStatusUpdate {
  id: string;
  message?: string;
  status: "connected" | "disconnected" | "error" | "reconnecting" | "connecting";
}

export async function getSshConfigs(): Promise<SshConfig[]> {
  return invoke("get_ssh_configs");
}

export async function saveSshConfig(config: SshConfig): Promise<SshConfig[]> {
  return invoke("save_ssh_config", { sshConfig: config });
}

export async function deleteSshConfig(id: string): Promise<SshConfig[]> {
  return invoke("delete_ssh_config", { id });
}

export async function setSshConnection(id: string, enable: boolean): Promise<void> {
  return invoke("set_ssh_connection", { enable, id });
}

export async function onSshStatusChanged(
  callback: (status: SshStatusUpdate) => void,
): Promise<UnlistenFn> {
  return listen<SshStatusUpdate>("ssh-status-changed", (event) => {
    callback(event.payload);
  });
}

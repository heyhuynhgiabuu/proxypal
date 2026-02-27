import { invoke } from "@tauri-apps/api/core";

// Auth file entry from Management API
export interface AuthFile {
  account?: string;
  accountType?: string;
  createdAt?: string;
  disabled: boolean;
  email?: string;
  failureCount?: number;
  id: string;
  label?: string;
  lastRefresh?: string;
  modtime?: string;
  name: string;
  path?: string;
  provider: string;
  runtimeOnly: boolean;
  size?: number;
  source?: "file" | "memory";
  status: "ready" | "error" | "disabled";
  statusMessage?: string;
  successCount?: number;
  unavailable: boolean;
  updatedAt?: string;
}

export async function getAuthFiles(): Promise<AuthFile[]> {
  return invoke("get_auth_files");
}

export async function uploadAuthFile(filePath: string, provider: string): Promise<void> {
  return invoke("upload_auth_file", { filePath, provider });
}

export async function deleteAuthFile(fileId: string): Promise<void> {
  return invoke("delete_auth_file", { fileId });
}

export async function toggleAuthFile(fileName: string, disabled: boolean): Promise<void> {
  return invoke("toggle_auth_file", { disabled, fileName });
}

export async function downloadAuthFile(fileId: string, filename: string): Promise<string> {
  return invoke("download_auth_file", { fileId, filename });
}

export async function deleteAllAuthFiles(): Promise<void> {
  return invoke("delete_all_auth_files");
}

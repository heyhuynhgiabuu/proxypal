import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Request log for live monitoring
export interface RequestLog {
  durationMs: number;
  id: string;
  method: string;
  model: string;
  path: string;
  provider: string;
  status: number;
  timestamp: number;
  tokensIn?: number;
  tokensOut?: number;
}

export async function onRequestLog(callback: (log: RequestLog) => void): Promise<UnlistenFn> {
  return listen<RequestLog>("request-log", (event) => {
    callback(event.payload);
  });
}

// ==========================================================================
// Log Viewer
// ==========================================================================

export interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
}

export async function getLogs(lines?: number): Promise<LogEntry[]> {
  return invoke("get_logs", { lines });
}

export async function clearLogs(): Promise<void> {
  return invoke("clear_logs");
}

// Request Error Logs - view error-specific logs
export async function getRequestErrorLogs(): Promise<string[]> {
  return invoke("get_request_error_logs");
}

export async function getRequestErrorLogContent(filename: string): Promise<string> {
  return invoke("get_request_error_log_content", { filename });
}

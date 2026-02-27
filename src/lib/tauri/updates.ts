import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

// ============================================================================
// App Updates (OTA via Tauri Updater Plugin)
// ============================================================================

export interface UpdateInfo {
  available: boolean;
  body?: string;
  currentVersion?: string;
  date?: string;
  version?: string;
}

export interface UpdateProgress {
  chunkLength?: number;
  contentLength?: number;
  event: "Started" | "Progress" | "Finished";
}

// Check for available updates
export async function checkForUpdates(): Promise<UpdateInfo> {
  try {
    const currentVersion = await getVersion();
    const update = await check();
    if (update) {
      return {
        available: true,
        body: update.body,
        currentVersion: currentVersion,
        date: update.date,
        version: update.version,
      };
    }
    return { available: false, currentVersion: currentVersion };
  } catch (error) {
    console.error("Failed to check for updates:", error);
    throw error;
  }
}

// Download and install update with progress callback
export async function downloadAndInstallUpdate(
  onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
  const update = await check();
  if (!update) {
    throw new Error("No update available");
  }

  // Stop proxy BEFORE download/install to release cliproxyapi binary (required on Windows)
  try {
    await invoke("stop_proxy");
    // Wait for process to fully terminate (Windows needs more time)
    await new Promise((resolve) => setTimeout(resolve, 1500));
  } catch {
    // Ignore errors, proxy might not be running
  }

  await update.downloadAndInstall((event) => {
    if (onProgress) {
      if (event.event === "Started") {
        onProgress({
          contentLength: event.data.contentLength ?? undefined,
          event: "Started",
        });
      } else if (event.event === "Progress") {
        onProgress({
          chunkLength: event.data.chunkLength,
          event: "Progress",
        });
      } else if (event.event === "Finished") {
        onProgress({ event: "Finished" });
      }
    }
  });

  // Explicitly relaunch after install completes
  await relaunch();
}

// Relaunch the app after update
export async function relaunchApp(): Promise<void> {
  await relaunch();
}

// Check if auto-updater is supported on this platform/install type
export interface UpdaterSupport {
  reason: string;
  supported: boolean;
}

export async function isUpdaterSupported(): Promise<UpdaterSupport> {
  return invoke<UpdaterSupport>("is_updater_supported");
}

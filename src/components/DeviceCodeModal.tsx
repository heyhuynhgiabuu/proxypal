import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { useI18n } from "../i18n";
import { pollOAuthStatus, refreshAuthStatus } from "../lib/tauri/auth";
import { toastStore } from "../stores/toast";

import type { DeviceCodeResponse, Provider } from "../lib/tauri/auth";

const providerLogos: Record<string, string> = {
  openai: "/logos/codex.svg",
  qwen: "/logos/qwen.webp",
};

interface DeviceCodeModalProps {
  deviceCode: DeviceCodeResponse | null;
  onCancel: () => void;
  onSuccess: () => void;
  provider: Provider | null;
  providerName: string;
}

export function DeviceCodeModal(props: DeviceCodeModalProps) {
  const { t } = useI18n();
  const [polling, setPolling] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [timeLeft, setTimeLeft] = createSignal(0);

  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let countdownTimer: ReturnType<typeof setInterval> | undefined;

  const copyUserCode = async () => {
    const code = props.deviceCode?.userCode;
    if (!code) {
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toastStore.success(t("common.copied") || "Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toastStore.error("Failed to copy");
    }
  };

  const startPolling = () => {
    const dc = props.deviceCode;
    if (!dc) {
      return;
    }

    setPolling(true);
    setTimeLeft(dc.expiresIn);

    // Open verification URL
    window.open(dc.verificationUri, "_blank");

    // Countdown timer
    countdownTimer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          stopPolling();
          toastStore.error("Device code expired. Please try again.");
          props.onCancel();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Poll for auth completion
    const interval = Math.max(dc.interval, 3) * 1000;
    pollTimer = setInterval(async () => {
      try {
        const completed = await pollOAuthStatus(dc.state);
        if (completed) {
          stopPolling();
          // Wait for credential file to be written
          await new Promise((r) => setTimeout(r, 500));
          let retries = 3;
          while (retries > 0) {
            try {
              await refreshAuthStatus();
              break;
            } catch {
              retries--;
              if (retries > 0) {
                await new Promise((r) => setTimeout(r, 500));
              }
            }
          }
          toastStore.success(`${props.providerName} connected via device code`);
          props.onSuccess();
        }
      } catch {
        // Silently retry — server may not be ready
      }
    }, interval);
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    if (countdownTimer) {
      clearInterval(countdownTimer);
    }
    pollTimer = undefined;
    countdownTimer = undefined;
    setPolling(false);
  };

  // Auto-start polling when modal opens with device code
  createEffect(() => {
    if (props.deviceCode && props.provider) {
      startPolling();
    }
  });

  onCleanup(stopPolling);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <Show when={props.provider && props.deviceCode}>
      {/* Backdrop */}
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div class="mx-4 w-full max-w-sm overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
          {/* Header */}
          <div class="flex items-center gap-3 border-b border-gray-100 px-6 py-4 dark:border-gray-700">
            <Show when={props.provider && providerLogos[props.provider!]}>
              <img
                alt={props.providerName}
                class="h-8 w-8 rounded-lg"
                src={providerLogos[props.provider!]}
              />
            </Show>
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Device Code Login</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">{props.providerName}</p>
            </div>
          </div>

          {/* Body */}
          <div class="space-y-4 px-6 py-5">
            {/* User Code */}
            <div class="text-center">
              <p class="mb-2 text-sm text-gray-600 dark:text-gray-400">
                Enter this code on the authorization page:
              </p>
              <button
                class="group mx-auto flex items-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-6 py-3 font-mono text-2xl font-bold tracking-widest text-gray-900 transition-colors hover:border-blue-400 hover:bg-blue-50 dark:border-gray-600 dark:text-white dark:hover:border-blue-500 dark:hover:bg-blue-900/20"
                onClick={copyUserCode}
                title="Click to copy"
                type="button"
              >
                {props.deviceCode?.userCode || "----"}
                <svg
                  class="h-4 w-4 text-gray-400 transition-colors group-hover:text-blue-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
              </button>
              <Show when={copied()}>
                <p class="mt-1 text-xs text-green-600 dark:text-green-400">Copied!</p>
              </Show>
            </div>

            {/* Verification URL */}
            <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-700/50">
              <p class="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                Authorization URL
              </p>
              <a
                class="break-all text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                href={props.deviceCode?.verificationUri}
                rel="noopener noreferrer"
                target="_blank"
              >
                {props.deviceCode?.verificationUri}
              </a>
            </div>

            {/* Status */}
            <Show when={polling()}>
              <div class="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-900/20">
                <div class="flex items-center gap-2">
                  <div class="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                  <span class="text-sm text-amber-700 dark:text-amber-400">
                    Waiting for authorization...
                  </span>
                </div>
                <span class="font-mono text-xs text-amber-600 dark:text-amber-500">
                  {formatTime(timeLeft())}
                </span>
              </div>
            </Show>
          </div>

          {/* Footer */}
          <div class="flex justify-end border-t border-gray-100 px-6 py-3 dark:border-gray-700">
            <button
              class="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              onClick={() => {
                stopPolling();
                props.onCancel();
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

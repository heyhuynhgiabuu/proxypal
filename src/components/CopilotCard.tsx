import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { useI18n } from "../i18n";
import {
  checkCopilotHealth,
  detectCopilotApi,
  getConfig,
  getCopilotStatus,
  onCopilotAuthRequired,
  onCopilotStatusChanged,
  saveConfig,
  startCopilot,
  stopCopilot,
} from "../lib/tauri";
import { toastStore } from "../stores/toast";
import { Button } from "./ui";
import { Switch } from "./ui/Switch";

import type { CopilotApiDetection, CopilotConfig, CopilotStatus } from "../lib/tauri";

interface CopilotCardProps {
  config: CopilotConfig;
  onConfigChange: (config: CopilotConfig) => void;
  proxyRunning: boolean;
}

export function CopilotCard(props: CopilotCardProps) {
  const { t } = useI18n();
  const [status, setStatus] = createSignal<CopilotStatus>({
    authenticated: false,
    endpoint: "http://localhost:4141",
    port: 4141,
    running: false,
  });
  const [starting, setStarting] = createSignal(false);
  const [stopping, setStopping] = createSignal(false);
  const [authMessage, setAuthMessage] = createSignal<string | null>(null);
  const [startError, setStartError] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal(false);
  const [apiDetection, setApiDetection] = createSignal<CopilotApiDetection | null>(null);

  onMount(async () => {
    // Load initial status
    try {
      const initialStatus = await getCopilotStatus();
      setStatus(initialStatus);

      // If enabled but not running, check health (maybe it's running externally)
      if (props.config.enabled && !initialStatus.running) {
        const healthStatus = await checkCopilotHealth();
        setStatus(healthStatus);
      }
    } catch (error) {
      console.error("Failed to get copilot status:", error);
    }

    // Detect if copilot-api is installed
    try {
      const detection = await detectCopilotApi();
      setApiDetection(detection);
    } catch (error) {
      console.error("Failed to detect copilot-api:", error);
    }

    // Subscribe to status changes
    const unlistenStatus = await onCopilotStatusChanged((newStatus) => {
      setStatus(newStatus);
    });

    // Subscribe to auth required events
    const unlistenAuth = await onCopilotAuthRequired((message) => {
      setAuthMessage(message);
      // Extract the URL from the message if present
      const urlMatch = message.match(/https:\/\/github\.com\/login\/device/);
      if (urlMatch) {
        toastStore.info(
          t("copilot.toasts.githubAuthenticationRequired"),
          t("copilot.toasts.checkTerminalForDeviceCode"),
        );
      }
    });

    // Poll for health status when running but not authenticated
    const healthPollInterval = setInterval(async () => {
      const currentStatus = status();
      if (currentStatus.running && !currentStatus.authenticated) {
        try {
          const healthStatus = await checkCopilotHealth();
          setStatus(healthStatus);
        } catch (error) {
          console.error("Health check failed:", error);
        }
      }
    }, 2000);

    onCleanup(() => {
      unlistenStatus();
      unlistenAuth();
      clearInterval(healthPollInterval);
    });
  });

  const handleToggleEnabled = async (enabled: boolean) => {
    const newConfig = { ...props.config, enabled };
    props.onConfigChange(newConfig);

    // Save to backend
    try {
      const fullConfig = await getConfig();
      await saveConfig({ ...fullConfig, copilot: newConfig });

      if (enabled && props.proxyRunning) {
        // Auto-start copilot when enabled
        await handleStart();
      } else if (!enabled && status().running) {
        // Auto-stop copilot when disabled
        await handleStop();
      }
    } catch (error) {
      console.error("Failed to save copilot config:", error);
      toastStore.error(t("copilot.toasts.failedToSaveSettings"), String(error));
    }
  };

  const handleStart = async () => {
    if (starting() || status().running) {
      return;
    }
    setStarting(true);
    setAuthMessage(null);
    setStartError(null);

    try {
      const newStatus = await startCopilot();
      setStatus(newStatus);

      if (newStatus.authenticated) {
        toastStore.success(
          t("copilot.toasts.githubCopilotConnected"),
          t("copilot.toasts.modelsNowAvailableThroughProxy"),
        );
      } else {
        toastStore.info(
          t("copilot.toasts.copilotStarting"),
          t("copilot.toasts.completeGithubAuthenticationIfPrompted"),
        );
      }
    } catch (error) {
      console.error("Failed to start copilot:", error);
      const errorMsg = String(error);
      setStartError(errorMsg);
      toastStore.error(t("copilot.toasts.failedToStartCopilot"), errorMsg);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (stopping() || !status().running) {
      return;
    }
    setStopping(true);

    try {
      const newStatus = await stopCopilot();
      setStatus(newStatus);
      toastStore.info(t("copilot.toasts.copilotStopped"));
    } catch (error) {
      console.error("Failed to stop copilot:", error);
      toastStore.error(t("copilot.toasts.failedToStopCopilot"), String(error));
    } finally {
      setStopping(false);
    }
  };

  const handleOpenGitHubAuth = () => {
    window.open("https://github.com/login/device", "_blank");
  };

  const isConnected = () => status().running && status().authenticated;
  const isRunningNotAuth = () => status().running && !status().authenticated;

  return (
    <div class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      {/* Header */}
      <div class="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700">
        <div class="flex items-center gap-3">
          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-blue-600">
            <img
              alt="GitHub Copilot"
              class="h-5 w-5 text-white"
              src="/logos/copilot.svg"
              style={{ filter: "brightness(0) invert(1)" }}
            />
          </div>
          <div>
            <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">
              GitHub Copilot
            </span>
            <p class="text-xs text-gray-500 dark:text-gray-400">{t("copilot.subtitle")}</p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          {/* Status indicator */}
          <Show when={props.config.enabled}>
            <div class="flex items-center gap-1.5">
              <div
                class={`h-2 w-2 rounded-full ${
                  isConnected()
                    ? "bg-green-500"
                    : isRunningNotAuth()
                      ? "animate-pulse bg-amber-500"
                      : status().running
                        ? "bg-blue-500"
                        : "bg-gray-400"
                }`}
              />
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {isConnected()
                  ? t("copilot.status.connected")
                  : isRunningNotAuth()
                    ? t("copilot.status.authenticating")
                    : status().running
                      ? t("copilot.status.running")
                      : t("copilot.status.offline")}
              </span>
            </div>
          </Show>
          <Switch
            checked={props.config.enabled}
            label={t("copilot.actions.enable")}
            onChange={handleToggleEnabled}
          />
        </div>
      </div>

      {/* Content - shown when enabled */}
      <Show when={props.config.enabled}>
        <div class="space-y-4 p-4">
          {/* Auth message */}
          <Show when={authMessage() && !status().authenticated}>
            <div class="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
              <div class="flex items-start gap-3">
                <svg
                  class="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
                <div class="flex-1">
                  <p class="text-sm font-medium text-amber-800 dark:text-amber-200">
                    {t("copilot.githubAuthenticationRequired")}
                  </p>
                  <p class="mt-1 text-xs text-amber-700 dark:text-amber-300">
                    {t("copilot.authHelpDescription")}
                  </p>
                  <Button class="mt-2" onClick={handleOpenGitHubAuth} size="sm" variant="secondary">
                    <svg class="mr-1.5 h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                    </svg>
                    {t("copilot.actions.openGithubAuthentication")}
                  </Button>
                </div>
              </div>
            </div>
          </Show>

          {/* Start error message */}
          <Show when={startError() && !status().running}>
            <div class="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
              <div class="flex items-start gap-3">
                <svg
                  class="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
                <div class="flex-1">
                  <p class="text-sm font-medium text-red-800 dark:text-red-200">
                    {t("copilot.failedToStartCopilot")}
                  </p>
                  <p class="mt-1 whitespace-pre-wrap text-xs text-red-700 dark:text-red-300">
                    {startError()}
                  </p>
                  <div class="mt-2 rounded bg-red-100 p-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
                    <p class="font-medium">{t("copilot.quickFixRunManually")}</p>
                    <code class="mt-1 block font-mono text-red-800 dark:text-red-200">
                      bunx copilot-api start --port 4141
                    </code>
                  </div>
                  <p class="mt-2 text-xs text-red-600 dark:text-red-400">
                    Go to{" "}
                    <a
                      class="font-medium underline hover:text-red-800 dark:hover:text-red-200"
                      href="#settings"
                      onClick={(e) => {
                        e.preventDefault();
                        // Navigate to settings providers tab
                        window.dispatchEvent(
                          new CustomEvent("navigate-to-settings", {
                            detail: { tab: "providers" },
                          }),
                        );
                      }}
                    >
                      {t("copilot.settingsCopilotApiDetection")}
                    </a>{" "}
                    {t("copilot.forMoreDetails")}
                  </p>
                </div>
              </div>
            </div>
          </Show>

          {/* Connected state */}
          <Show when={isConnected()}>
            <div class="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
              <div class="flex items-center gap-2 text-green-700 dark:text-green-300">
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M5 13l4 4L19 7"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
                <span class="text-sm font-medium">{t("copilot.githubCopilotConnectedInline")}</span>
              </div>
              <p class="mt-1 text-xs text-green-600 dark:text-green-400">
                {t("copilot.availableModelsDescription")}
              </p>
            </div>
          </Show>

          {/* Actions */}
          <div class="flex items-center gap-2">
            <Show when={!status().running}>
              <Button
                disabled={starting() || !props.proxyRunning}
                onClick={handleStart}
                size="sm"
                variant="primary"
              >
                {starting() ? (
                  <span class="flex items-center gap-1.5">
                    <svg class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle
                        class="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        stroke-width="4"
                      />
                      <path
                        class="opacity-75"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        fill="currentColor"
                      />
                    </svg>
                    {t("copilot.actions.starting")}
                  </span>
                ) : (
                  t("copilot.actions.startCopilot")
                )}
              </Button>
            </Show>
            <Show when={status().running}>
              <Button disabled={stopping()} onClick={handleStop} size="sm" variant="secondary">
                {stopping() ? t("copilot.actions.stopping") : t("copilot.actions.stop")}
              </Button>
            </Show>
            <button
              class="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
              onClick={() => setExpanded(!expanded())}
              title={t("copilot.actions.advancedSettings")}
            >
              <svg
                class={`h-4 w-4 transition-transform ${expanded() ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M19 9l-7 7-7-7"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </svg>
            </button>
          </div>

          {/* Proxy not running warning */}
          <Show when={!props.proxyRunning}>
            <p class="text-xs text-amber-600 dark:text-amber-400">
              {t("copilot.startProxyFirstToUseCopilot")}
            </p>
          </Show>

          {/* Installation status */}
          <Show when={apiDetection()}>
            {(detection) => (
              <Show when={!detection().nodeAvailable}>
                <div class="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                  <div class="flex items-center gap-2 text-red-700 dark:text-red-300">
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                      />
                    </svg>
                    <span class="text-sm font-medium">{t("copilot.nodeJsRequired")}</span>
                  </div>
                  <p class="mt-1 text-xs text-red-600 dark:text-red-400">
                    {t("copilot.installNodeJsFrom")}{" "}
                    <a
                      class="underline hover:no-underline"
                      href="https://nodejs.org"
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      nodejs.org
                    </a>
                  </p>
                </div>
              </Show>
            )}
          </Show>

          <Show when={apiDetection()?.installed}>
            <div class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <svg
                class="h-3.5 w-3.5 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M5 13l4 4L19 7"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </svg>
              <span>
                copilot-api
                {apiDetection()?.version ? ` v${apiDetection()?.version}` : ""}{" "}
                {t("copilot.installed")}
              </span>
            </div>
          </Show>

          {/* Advanced settings */}
          <Show when={expanded()}>
            <div class="space-y-3 border-t border-gray-100 pt-3 dark:border-gray-700">
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  {t("copilot.port")}
                </label>
                <input
                  class="w-24 rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  onInput={(e) =>
                    props.onConfigChange({
                      ...props.config,
                      port: Number.parseInt(e.currentTarget.value) || 4141,
                    })
                  }
                  type="number"
                  value={props.config.port}
                />
              </div>
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  {t("copilot.accountType")}
                </label>
                <select
                  class="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  onChange={(e) =>
                    props.onConfigChange({
                      ...props.config,
                      accountType: e.currentTarget.value,
                    })
                  }
                  value={props.config.accountType}
                >
                  <option value="individual">{t("copilot.accountTypes.individual")}</option>
                  <option value="business">{t("copilot.accountTypes.business")}</option>
                  <option value="enterprise">{t("copilot.accountTypes.enterprise")}</option>
                </select>
              </div>
              <div class="flex items-center justify-between">
                <div>
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                    {t("copilot.rateLimitWait")}
                  </label>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    {t("copilot.rateLimitWaitDescription")}
                  </p>
                </div>
                <Switch
                  checked={props.config.rateLimitWait}
                  onChange={(checked) =>
                    props.onConfigChange({
                      ...props.config,
                      rateLimitWait: checked,
                    })
                  }
                />
              </div>
            </div>
          </Show>
        </div>
      </Show>

      {/* Collapsed state when disabled */}
      <Show when={!props.config.enabled}>
        <div class="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
          {t("copilot.enableHint")}
        </div>
      </Show>
    </div>
  );
}

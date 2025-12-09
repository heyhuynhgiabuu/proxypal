import { createSignal, Show, onMount, onCleanup } from "solid-js";
import { Button } from "./ui";
import { Switch } from "./ui/Switch";
import type {
  CopilotConfig,
  CopilotStatus,
  CopilotApiDetection,
} from "../lib/tauri";
import {
  getCopilotStatus,
  startCopilot,
  stopCopilot,
  checkCopilotHealth,
  onCopilotStatusChanged,
  onCopilotAuthRequired,
  saveConfig,
  getConfig,
  detectCopilotApi,
} from "../lib/tauri";
import { toastStore } from "../stores/toast";

interface CopilotCardProps {
  config: CopilotConfig;
  onConfigChange: (config: CopilotConfig) => void;
  proxyRunning: boolean;
}

export function CopilotCard(props: CopilotCardProps) {
  const [status, setStatus] = createSignal<CopilotStatus>({
    running: false,
    port: 4141,
    endpoint: "http://localhost:4141",
    authenticated: false,
  });
  const [starting, setStarting] = createSignal(false);
  const [stopping, setStopping] = createSignal(false);
  const [authMessage, setAuthMessage] = createSignal<string | null>(null);
  const [startError, setStartError] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal(false);
  const [apiDetection, setApiDetection] =
    createSignal<CopilotApiDetection | null>(null);

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
    } catch (err) {
      console.error("Failed to get copilot status:", err);
    }

    // Detect if copilot-api is installed
    try {
      const detection = await detectCopilotApi();
      setApiDetection(detection);
    } catch (err) {
      console.error("Failed to detect copilot-api:", err);
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
          "GitHub Authentication Required",
          "Check the terminal for your device code, then visit github.com/login/device",
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
        } catch (err) {
          console.error("Health check failed:", err);
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
    } catch (err) {
      console.error("Failed to save copilot config:", err);
      toastStore.error("Failed to save settings", String(err));
    }
  };

  const handleStart = async () => {
    if (starting() || status().running) return;
    setStarting(true);
    setAuthMessage(null);
    setStartError(null);

    try {
      const newStatus = await startCopilot();
      setStatus(newStatus);

      if (newStatus.authenticated) {
        toastStore.success(
          "GitHub Copilot Connected",
          "Models are now available through the proxy",
        );
      } else {
        toastStore.info(
          "Copilot Starting...",
          "Complete GitHub authentication if prompted",
        );
      }
    } catch (err) {
      console.error("Failed to start copilot:", err);
      const errorMsg = String(err);
      setStartError(errorMsg);
      toastStore.error("Failed to start Copilot", errorMsg);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (stopping() || !status().running) return;
    setStopping(true);

    try {
      const newStatus = await stopCopilot();
      setStatus(newStatus);
      toastStore.info("Copilot Stopped");
    } catch (err) {
      console.error("Failed to stop copilot:", err);
      toastStore.error("Failed to stop Copilot", String(err));
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
    <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      {/* Header */}
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
            <img
              src="/logos/copilot.svg"
              alt="GitHub Copilot"
              class="w-5 h-5 text-white"
              style={{ filter: "brightness(0) invert(1)" }}
            />
          </div>
          <div>
            <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">
              GitHub Copilot
            </span>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              Free AI models via Copilot subscription
            </p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          {/* Status indicator */}
          <Show when={props.config.enabled}>
            <div class="flex items-center gap-1.5">
              <div
                class={`w-2 h-2 rounded-full ${
                  isConnected()
                    ? "bg-green-500"
                    : isRunningNotAuth()
                      ? "bg-amber-500 animate-pulse"
                      : status().running
                        ? "bg-blue-500"
                        : "bg-gray-400"
                }`}
              />
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {isConnected()
                  ? "Connected"
                  : isRunningNotAuth()
                    ? "Authenticating..."
                    : status().running
                      ? "Running"
                      : "Offline"}
              </span>
            </div>
          </Show>
          <Switch
            checked={props.config.enabled}
            onChange={handleToggleEnabled}
            label="Enable"
          />
        </div>
      </div>

      {/* Content - shown when enabled */}
      <Show when={props.config.enabled}>
        <div class="p-4 space-y-4">
          {/* Auth message */}
          <Show when={authMessage() && !status().authenticated}>
            <div class="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <div class="flex items-start gap-3">
                <svg
                  class="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <div class="flex-1">
                  <p class="text-sm font-medium text-amber-800 dark:text-amber-200">
                    GitHub Authentication Required
                  </p>
                  <p class="text-xs text-amber-700 dark:text-amber-300 mt-1">
                    Check the terminal for your device code, then click below to
                    authenticate.
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleOpenGitHubAuth}
                    class="mt-2"
                  >
                    <svg
                      class="w-4 h-4 mr-1.5"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                    </svg>
                    Open GitHub Authentication
                  </Button>
                </div>
              </div>
            </div>
          </Show>

          {/* Start error message */}
          <Show when={startError() && !status().running}>
            <div class="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <div class="flex items-start gap-3">
                <svg
                  class="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div class="flex-1">
                  <p class="text-sm font-medium text-red-800 dark:text-red-200">
                    Failed to Start Copilot
                  </p>
                  <p class="text-xs text-red-700 dark:text-red-300 mt-1 whitespace-pre-wrap">
                    {startError()}
                  </p>
                  <p class="text-xs text-red-600 dark:text-red-400 mt-2">
                    Go to{" "}
                    <a
                      href="#settings"
                      onClick={(e) => {
                        e.preventDefault();
                        // Navigate to settings - this will be handled by the parent
                        window.dispatchEvent(
                          new CustomEvent("navigate-to-settings"),
                        );
                      }}
                      class="underline font-medium hover:text-red-800 dark:hover:text-red-200"
                    >
                      Settings → Copilot API Detection
                    </a>{" "}
                    for more details.
                  </p>
                </div>
              </div>
            </div>
          </Show>

          {/* Connected state */}
          <Show when={isConnected()}>
            <div class="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <div class="flex items-center gap-2 text-green-700 dark:text-green-300">
                <svg
                  class="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span class="text-sm font-medium">
                  GitHub Copilot is connected
                </span>
              </div>
              <p class="mt-1 text-xs text-green-600 dark:text-green-400">
                Available models: GPT-4o, Claude Sonnet 4, Claude Opus 4.5, and
                more
              </p>
            </div>
          </Show>

          {/* Actions */}
          <div class="flex items-center gap-2">
            <Show when={!status().running}>
              <Button
                size="sm"
                variant="primary"
                onClick={handleStart}
                disabled={starting() || !props.proxyRunning}
              >
                {starting() ? (
                  <span class="flex items-center gap-1.5">
                    <svg
                      class="w-3 h-3 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
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
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Starting...
                  </span>
                ) : (
                  "Start Copilot"
                )}
              </Button>
            </Show>
            <Show when={status().running}>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleStop}
                disabled={stopping()}
              >
                {stopping() ? "Stopping..." : "Stop"}
              </Button>
            </Show>
            <button
              onClick={() => setExpanded(!expanded())}
              class="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Advanced settings"
            >
              <svg
                class={`w-4 h-4 transition-transform ${expanded() ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          </div>

          {/* Proxy not running warning */}
          <Show when={!props.proxyRunning}>
            <p class="text-xs text-amber-600 dark:text-amber-400">
              Start the proxy first to use Copilot
            </p>
          </Show>

          {/* Installation status */}
          <Show when={apiDetection()}>
            {(detection) => (
              <Show when={!detection().nodeAvailable}>
                <div class="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <div class="flex items-center gap-2 text-red-700 dark:text-red-300">
                    <svg
                      class="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                    <span class="text-sm font-medium">Node.js Required</span>
                  </div>
                  <p class="mt-1 text-xs text-red-600 dark:text-red-400">
                    Install Node.js from{" "}
                    <a
                      href="https://nodejs.org"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="underline hover:no-underline"
                    >
                      nodejs.org
                    </a>
                  </p>
                </div>
              </Show>
            )}
          </Show>

          <Show
            when={apiDetection()?.nodeAvailable && !apiDetection()?.installed}
          >
            <div class="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <div class="flex items-start gap-3">
                <svg
                  class="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div class="flex-1">
                  <p class="text-sm font-medium text-blue-800 dark:text-blue-200">
                    Optional: Install Copilot API globally
                  </p>
                  <p class="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    For faster startup, run this command in your terminal:
                  </p>
                  <div class="mt-2 flex items-center gap-2">
                    <code class="flex-1 px-2 py-1.5 text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 rounded font-mono">
                      npm install -g copilot-api
                    </code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(
                          "npm install -g copilot-api",
                        );
                        toastStore.success("Copied to clipboard");
                      }}
                      class="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded"
                      title="Copy to clipboard"
                    >
                      <svg
                        class="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    </button>
                  </div>
                  <p class="text-xs text-blue-600 dark:text-blue-400 mt-2">
                    Without this, copilot-api will be downloaded on each start
                    (slower).
                  </p>
                </div>
              </div>
            </div>
          </Show>

          <Show when={apiDetection()?.installed}>
            <div class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <svg
                class="w-3.5 h-3.5 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <span>
                copilot-api
                {apiDetection()?.version
                  ? ` v${apiDetection()?.version}`
                  : ""}{" "}
                installed
              </span>
            </div>
          </Show>

          {/* Advanced settings */}
          <Show when={expanded()}>
            <div class="pt-3 border-t border-gray-100 dark:border-gray-700 space-y-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Port
                </label>
                <input
                  type="number"
                  value={props.config.port}
                  onInput={(e) =>
                    props.onConfigChange({
                      ...props.config,
                      port: parseInt(e.currentTarget.value) || 4141,
                    })
                  }
                  class="w-24 px-2 py-1 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Account Type
                </label>
                <select
                  value={props.config.accountType}
                  onChange={(e) =>
                    props.onConfigChange({
                      ...props.config,
                      accountType: e.currentTarget.value,
                    })
                  }
                  class="w-full px-2 py-1 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  <option value="individual">Individual</option>
                  <option value="business">Business</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div class="flex items-center justify-between">
                <div>
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Rate Limit Wait
                  </label>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    Wait instead of error on rate limit
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
          Enable to access GPT-4, Claude, and other models through your GitHub
          Copilot subscription
        </div>
      </Show>
    </div>
  );
}

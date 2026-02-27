import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import {
  checkProviderHealth,
  type HealthStatus,
  type Provider,
  type ProviderHealth,
} from "../lib/tauri";
import { appStore } from "../stores/app";

const statusConfig = {
  degraded: {
    color: "bg-amber-500",
    label: "Degraded",
    textColor: "text-amber-600 dark:text-amber-400",
  },
  healthy: {
    color: "bg-green-500",
    label: "Healthy",
    textColor: "text-green-600 dark:text-green-400",
  },
  offline: {
    color: "bg-red-500",
    label: "Offline",
    textColor: "text-red-600 dark:text-red-400",
  },
  unconfigured: {
    color: "bg-gray-400",
    label: "Not configured",
    textColor: "text-gray-500 dark:text-gray-400",
  },
};

interface HealthIndicatorProps {
  provider: Provider;
  showLabel?: boolean;
}

export function HealthIndicator(props: HealthIndicatorProps) {
  const { proxyStatus } = appStore;
  const [health, setHealth] = createSignal<HealthStatus | null>(null);
  const [checking, setChecking] = createSignal(false);

  const checkHealth = async () => {
    if (checking()) {
      return;
    }
    setChecking(true);
    try {
      const result = await checkProviderHealth();
      setHealth(result[props.provider]);
    } catch (error) {
      console.error("Failed to check health:", error);
      setHealth({ lastChecked: Date.now() / 1000, status: "offline" });
    } finally {
      setChecking(false);
    }
  };

  // Check health on mount and when proxy status changes
  // Throttle to once per 60 seconds to avoid spamming /v1/models
  createEffect(() => {
    if (proxyStatus().running) {
      // Delay initial check to stagger requests from multiple instances
      const initialDelay = Math.random() * 5000; // 0-5 second random delay
      const timeout = setTimeout(() => {
        checkHealth();
      }, initialDelay);

      // Check every 60 seconds (reduced from 30 to cut spam)
      const interval = setInterval(checkHealth, 60_000);
      onCleanup(() => {
        clearTimeout(timeout);
        clearInterval(interval);
      });
    } else {
      setHealth({ lastChecked: Date.now() / 1000, status: "offline" });
    }
  });

  const status = () => health()?.status || "unconfigured";
  const config = () => statusConfig[status()];

  return (
    <div
      class="flex items-center gap-1.5"
      title={`${config().label}${health()?.latencyMs ? ` (${health()!.latencyMs}ms)` : ""}`}
    >
      <div
        class={`h-2 w-2 rounded-full ${config().color} ${status() === "healthy" ? "animate-pulse" : ""} ${checking() ? "opacity-50" : ""}`}
      />
      <Show when={props.showLabel}>
        <span class={`text-xs ${config().textColor}`}>
          {config().label}
          <Show when={health()?.latencyMs}>
            <span class="ml-1 text-gray-400">({health()!.latencyMs}ms)</span>
          </Show>
        </span>
      </Show>
    </div>
  );
}

// Full health panel showing all providers
export function HealthPanel() {
  const { authStatus, proxyStatus } = appStore;
  const [health, setHealth] = createSignal<ProviderHealth | null>(null);
  const [lastChecked, setLastChecked] = createSignal<Date | null>(null);

  const checkHealth = async () => {
    try {
      const result = await checkProviderHealth();
      setHealth(result);
      setLastChecked(new Date());
    } catch (error) {
      console.error("Failed to check health:", error);
    }
  };

  createEffect(() => {
    if (proxyStatus().running) {
      checkHealth();
      // Check every 60 seconds (reduced from 30 to cut spam)
      const interval = setInterval(checkHealth, 60_000);
      onCleanup(() => clearInterval(interval));
    }
  });

  const providers = [
    { connected: authStatus().claude, id: "claude" as const, name: "Claude" },
    { connected: authStatus().openai, id: "openai" as const, name: "ChatGPT" },
    { connected: authStatus().gemini, id: "gemini" as const, name: "Gemini" },
    { connected: authStatus().qwen, id: "qwen" as const, name: "Qwen" },
    { connected: authStatus().iflow, id: "iflow" as const, name: "iFlow" },
    { connected: authStatus().kiro, id: "kiro" as const, name: "Kiro" },
    {
      connected: authStatus().vertex,
      id: "vertex" as const,
      name: "Vertex AI",
    },
    {
      connected: authStatus().antigravity,
      id: "antigravity" as const,
      name: "Antigravity",
    },
  ];

  const connectedProviders = () => providers.filter((p) => p.connected);

  return (
    <Show when={connectedProviders().length > 0}>
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Provider Status
          </span>
          <button
            class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            onClick={checkHealth}
            title="Refresh health status"
          >
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
          </button>
        </div>

        <div class="space-y-1.5">
          {connectedProviders().map((provider) => {
            const providerHealth = () => health()?.[provider.id];
            const status = () => providerHealth()?.status || "unconfigured";
            const cfg = () => statusConfig[status()];

            return (
              <div class="flex items-center justify-between py-1">
                <span class="text-sm text-gray-700 dark:text-gray-300">{provider.name}</span>
                <div class="flex items-center gap-2">
                  <Show when={providerHealth()?.latencyMs}>
                    <span class="text-xs text-gray-400">{providerHealth()!.latencyMs}ms</span>
                  </Show>
                  <div
                    class={`h-2 w-2 rounded-full ${cfg().color} ${status() === "healthy" ? "animate-pulse" : ""}`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <Show when={lastChecked()}>
          <p class="mt-2 text-xs text-gray-400">
            Last checked: {lastChecked()!.toLocaleTimeString()}
          </p>
        </Show>
      </div>
    </Show>
  );
}

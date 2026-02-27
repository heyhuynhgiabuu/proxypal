import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useI18n } from "../i18n";
import { clearRequestHistory, onRequestLog } from "../lib/tauri";
import { appStore } from "../stores/app";
import { requestStore } from "../stores/requests";

const MAX_DISPLAY = 50;

const providerColors: Record<string, string> = {
  antigravity: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
  claude: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  deepseek: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  gemini: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  iflow: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  openai: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  pending: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
  qwen: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  unknown: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  vertex: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
};

const statusColors: Record<number, string> = {
  200: "text-green-600 dark:text-green-400",
  400: "text-amber-600 dark:text-amber-400",
  401: "text-red-600 dark:text-red-400",
  500: "text-red-600 dark:text-red-400",
};

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDate(
  timestamp: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return t("requestMonitor.today");
  } else if (date.toDateString() === yesterday.toDateString()) {
    return t("requestMonitor.yesterday");
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number): string {
  if (cost < 0.01) {
    return "<$0.01";
  }
  return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

export function RequestMonitor() {
  const { t } = useI18n();
  const { proxyStatus } = appStore;
  // Use centralized store instead of local state
  const history = requestStore.history;
  const [expanded, setExpanded] = createSignal(false);
  const [loading, setLoading] = createSignal(true);

  // Debounce timer for high-frequency events
  let debounceTimer: number | undefined;

  // Load history on mount
  onMount(async () => {
    try {
      await requestStore.loadHistory();
    } catch (error) {
      console.error("Failed to load request history:", error);
    } finally {
      setLoading(false);
    }

    // Listen for new requests with debouncing
    const unlisten = await onRequestLog(async (log) => {
      // Clear previous timer
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      // Debounce: wait 100ms before processing
      debounceTimer = window.setTimeout(async () => {
        try {
          await requestStore.addRequest(log);
        } catch (error) {
          console.error("Failed to save request to history:", error);
        }
      }, 100);
    });

    onCleanup(() => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      unlisten();
    });
  });

  const handleClear = async () => {
    try {
      await clearRequestHistory();
      requestStore.clearHistory();
    } catch (error) {
      console.error("Failed to clear history:", error);
    }
  };

  // Get requests in reverse chronological order (newest first)
  const displayRequests = () => {
    return [...history().requests].reverse().slice(0, MAX_DISPLAY);
  };

  const requestCount = () => history().requests.length;
  const hasRequests = () => requestCount() > 0;

  return (
    <div class="overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
      {/* Header */}
      <button
        class="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
        onClick={() => setExpanded(!expanded())}
      >
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2">
            <div
              class={`h-2 w-2 rounded-full ${proxyStatus().running ? "animate-pulse bg-green-500" : "bg-gray-400"}`}
            />
            <span class="text-sm font-medium text-gray-900 dark:text-gray-100">
              {t("requestMonitor.requestHistory")}
            </span>
          </div>
          <Show when={hasRequests()}>
            <span class="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
              {requestCount()}
            </span>
          </Show>
        </div>
        <div class="flex items-center gap-2">
          {/* Quick stats */}
          <Show when={hasRequests()}>
            <div class="mr-2 hidden items-center gap-3 text-xs text-gray-500 dark:text-gray-400 sm:flex">
              <span class="flex items-center gap-1">
                <span class="font-medium text-green-600 dark:text-green-400">
                  {formatCost(history().totalCostUsd)}
                </span>
                <span>{t("requestMonitor.saved")}</span>
              </span>
              <span class="text-gray-300 dark:text-gray-600">|</span>
              <span>
                {formatTokens(history().totalTokensIn + history().totalTokensOut)}{" "}
                {t("requestMonitor.tokens")}
              </span>
            </div>
            <button
              class="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-300"
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
            >
              {t("requestMonitor.clear")}
            </button>
          </Show>
          <svg
            class={`h-4 w-4 text-gray-500 transition-transform ${expanded() ? "rotate-180" : ""}`}
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
        </div>
      </button>

      {/* Expanded content */}
      <Show when={expanded()}>
        <div class="border-t border-gray-200 dark:border-gray-700">
          {/* Stats bar when has requests */}
          <Show when={hasRequests()}>
            <div class="border-b border-gray-200 bg-gradient-to-r from-green-50 to-emerald-50 px-4 py-2 dark:border-gray-700 dark:from-green-900/20 dark:to-emerald-900/20 sm:hidden">
              <div class="flex items-center justify-between text-xs">
                <span class="text-gray-600 dark:text-gray-400">
                  {t("requestMonitor.estimatedSavings")}:{" "}
                  <span class="font-semibold text-green-600 dark:text-green-400">
                    {formatCost(history().totalCostUsd)}
                  </span>
                </span>
                <span class="text-gray-500 dark:text-gray-400">
                  {formatTokens(history().totalTokensIn + history().totalTokensOut)}{" "}
                  {t("requestMonitor.tokens")}
                </span>
              </div>
            </div>
          </Show>

          <Show
            fallback={
              <div class="px-4 py-8 text-center">
                <Show when={loading()}>
                  <div class="flex items-center justify-center gap-2 text-gray-500">
                    <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
                    <span class="text-sm">{t("requestMonitor.loadingHistory")}</span>
                  </div>
                </Show>
                <Show when={!loading()}>
                  <Show
                    fallback={
                      <div class="text-gray-500 dark:text-gray-400">
                        <svg
                          class="mx-auto mb-2 h-8 w-8 opacity-50"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="1.5"
                          />
                        </svg>
                        <p class="text-sm font-medium">{t("requestMonitor.proxyOffline")}</p>
                        <p class="mt-1 text-xs text-gray-400">
                          {t("requestMonitor.startProxyToTrack")}
                        </p>
                      </div>
                    }
                    when={proxyStatus().running}
                  >
                    <div class="text-gray-500 dark:text-gray-400">
                      <svg
                        class="mx-auto mb-2 h-8 w-8 opacity-50"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="1.5"
                        />
                      </svg>
                      <p class="text-sm font-medium">{t("requestMonitor.waitingForRequests")}</p>
                      <p class="mx-auto mt-1 max-w-xs text-xs text-gray-400">
                        {t("requestMonitor.waitingDescription")}
                      </p>
                      <div class="mt-3 flex items-center justify-center gap-2">
                        <div class="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                        <span class="text-xs text-green-600 dark:text-green-400">
                          {t("requestMonitor.proxyListeningOnPort", {
                            port: proxyStatus().port,
                          })}
                        </span>
                      </div>
                    </div>
                  </Show>
                </Show>
              </div>
            }
            when={!loading() && hasRequests()}
          >
            <div class="max-h-72 overflow-y-auto">
              <For each={displayRequests()}>
                {(log, index) => (
                  <div
                    class={`flex items-center gap-3 px-4 py-2 text-sm ${
                      index() % 2 === 0
                        ? "bg-white dark:bg-gray-900/50"
                        : "bg-gray-50 dark:bg-gray-800/30"
                    }`}
                  >
                    {/* Timestamp */}
                    <div class="flex w-16 flex-shrink-0 flex-col items-end">
                      <span class="text-[10px] text-gray-400 dark:text-gray-500">
                        {formatDate(log.timestamp, t)}
                      </span>
                      <span class="font-mono text-xs text-gray-500 dark:text-gray-400">
                        {formatTime(log.timestamp)}
                      </span>
                    </div>

                    {/* Provider badge */}
                    <span
                      class={`rounded px-1.5 py-0.5 text-xs font-medium ${providerColors[log.provider] || providerColors.unknown}`}
                    >
                      {log.provider}
                    </span>

                    {/* Model */}
                    <span class="flex-1 truncate font-mono text-xs text-gray-600 dark:text-gray-400">
                      {log.model || "—"}
                    </span>

                    {/* Tokens */}
                    <Show when={log.tokensIn || log.tokensOut}>
                      <span class="hidden font-mono text-xs text-gray-400 dark:text-gray-500 sm:block">
                        {formatTokens((log.tokensIn || 0) + (log.tokensOut || 0))}
                      </span>
                    </Show>

                    {/* Status */}
                    <span
                      class={`font-mono text-xs font-semibold ${statusColors[log.status] || "text-gray-500"}`}
                    >
                      {log.status}
                    </span>

                    {/* Duration */}
                    <span class="w-14 text-right font-mono text-xs text-gray-500 dark:text-gray-400">
                      {formatDuration(log.durationMs)}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// Compact version for embedding in other components
export function RequestMonitorCompact() {
  const { t } = useI18n();
  const { proxyStatus } = appStore;
  // Use centralized store
  const history = requestStore.history;

  onMount(async () => {
    // Load history if not already loaded
    if (history().requests.length === 0) {
      await requestStore.loadHistory();
    }
  });

  const latestLog = () => {
    const reqs = history().requests;
    return reqs.length > 0 ? reqs.at(-1) : null;
  };

  return (
    <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
      <Show
        fallback={<span class="text-gray-400">{t("requestMonitor.proxyOfflineCompact")}</span>}
        when={proxyStatus().running}
      >
        <div class="flex items-center gap-1.5">
          <div class="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
          <span>
            {t("requestMonitor.requestsCount", {
              count: history().requests.length,
            })}
          </span>
        </div>
        <Show when={history().totalCostUsd > 0}>
          <span class="text-gray-400">|</span>
          <span class="font-medium text-green-600 dark:text-green-400">
            {t("requestMonitor.costSaved", {
              cost: formatCost(history().totalCostUsd),
            })}
          </span>
        </Show>
        <Show when={latestLog()}>
          <span class="text-gray-400">|</span>
          <span>
            {t("requestMonitor.last")} {latestLog()!.provider} (
            {formatDuration(latestLog()!.durationMs)})
          </span>
        </Show>
      </Show>
    </div>
  );
}

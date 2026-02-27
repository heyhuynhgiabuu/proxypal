import { createSignal, createEffect, onCleanup, Show, For } from "solid-js";
import { getUsageStats, type UsageStats } from "../lib/tauri";
import { appStore } from "../stores/app";

function formatUptime(startTime: number | null): string {
  if (!startTime) {
    return "—";
  }

  const now = Date.now();
  const diff = Math.floor((now - startTime) / 1000);

  if (diff < 60) {
    return `${diff}s`;
  }
  if (diff < 3600) {
    return `${Math.floor(diff / 60)}m`;
  }
  if (diff < 86_400) {
    const hours = Math.floor(diff / 3600);
    const mins = Math.floor((diff % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
  const days = Math.floor(diff / 86_400);
  const hours = Math.floor((diff % 86_400) / 3600);
  return `${days}d ${hours}h`;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  }
  return num.toLocaleString();
}

function formatTokens(num: number): string {
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(2) + "M";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toLocaleString();
}

// Animated counter component
function AnimatedNumber(props: { format?: (n: number) => string; value: number }) {
  const [displayValue, setDisplayValue] = createSignal(0);
  const format = () => props.format || formatNumber;

  createEffect(() => {
    const target = props.value;
    const current = displayValue();

    if (current === target) {
      return;
    }

    // Animate over 500ms
    const duration = 500;
    const startTime = Date.now();
    const startValue = current;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const newValue = Math.round(startValue + (target - startValue) * eased);

      setDisplayValue(newValue);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  });

  return <span class="tabular-nums">{format()(displayValue())}</span>;
}

export function UsageSummary() {
  const { proxyStartTime, proxyStatus } = appStore;
  const [uptime, setUptime] = createSignal(formatUptime(proxyStartTime()));
  const [stats, setStats] = createSignal<UsageStats | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [expanded, setExpanded] = createSignal(false);

  // Fetch usage stats
  const fetchStats = async () => {
    try {
      const data = await getUsageStats();
      setStats(data);
    } catch (error) {
      console.error("Failed to fetch usage stats:", error);
    } finally {
      setLoading(false);
    }
  };

  // Update uptime every second when proxy is running
  createEffect(() => {
    if (!proxyStatus().running) {
      setUptime("—");
      return;
    }

    // Update immediately
    setUptime(formatUptime(proxyStartTime()));

    const interval = setInterval(() => {
      setUptime(formatUptime(proxyStartTime()));
    }, 1000);
    onCleanup(() => clearInterval(interval));
  });

  // Fetch stats on mount - works regardless of proxy state now
  createEffect(() => {
    fetchStats();
  });

  const successRate = () => {
    const s = stats();
    if (!s || s.totalRequests === 0) {
      return 100;
    }
    return Math.round((s.successCount / s.totalRequests) * 100);
  };

  const hasStats = () => {
    const s = stats();
    return s && s.totalRequests > 0;
  };

  return (
    <div class="space-y-3">
      {/* Primary Stats Row */}
      <div class="grid grid-cols-4 gap-2 sm:gap-3">
        {/* Proxy Status */}
        <div class="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50 sm:p-4">
          <div class="mb-1 flex items-center gap-1.5">
            <div
              class={`h-2 w-2 rounded-full transition-colors ${proxyStatus().running ? "animate-pulse bg-green-500" : "bg-gray-400"}`}
            />
            <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 sm:text-xs">
              Status
            </span>
          </div>
          <p class="text-sm font-semibold text-gray-900 dark:text-gray-100 sm:text-lg">
            {proxyStatus().running ? "Running" : "Stopped"}
          </p>
        </div>

        {/* Uptime */}
        <div class="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50 sm:p-4">
          <div class="mb-1 flex items-center gap-1.5">
            <svg
              class="h-2.5 w-2.5 text-gray-400 sm:h-3 sm:w-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
            <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 sm:text-xs">
              Uptime
            </span>
          </div>
          <p class="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100 sm:text-lg">
            {uptime()}
          </p>
        </div>

        {/* Requests Today */}
        <div class="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50 sm:p-4">
          <div class="mb-1 flex items-center gap-1.5">
            <svg
              class="h-2.5 w-2.5 text-gray-400 sm:h-3 sm:w-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M13 10V3L4 14h7v7l9-11h-7z"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
            <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 sm:text-xs">
              Today
            </span>
          </div>
          <Show
            fallback={<div class="h-6 w-12 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />}
            when={!loading()}
          >
            <p class="text-sm font-semibold text-gray-900 dark:text-gray-100 sm:text-lg">
              <AnimatedNumber value={stats()?.requestsToday || 0} />
              <span class="ml-0.5 text-xs font-normal text-gray-500">req</span>
            </p>
          </Show>
        </div>

        {/* Tokens Today */}
        <div class="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50 sm:p-4">
          <div class="mb-1 flex items-center gap-1.5">
            <svg
              class="h-2.5 w-2.5 text-gray-400 sm:h-3 sm:w-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
            <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 sm:text-xs">
              Tokens
            </span>
          </div>
          <Show
            fallback={<div class="h-6 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />}
            when={!loading()}
          >
            <p class="text-sm font-semibold text-gray-900 dark:text-gray-100 sm:text-lg">
              <AnimatedNumber format={formatTokens} value={stats()?.tokensToday || 0} />
            </p>
          </Show>
        </div>
      </div>

      {/* Expandable Details */}
      <Show when={hasStats()}>
        <button
          class="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm transition-colors hover:bg-gray-100 dark:border-gray-700/50 dark:bg-gray-800/30 dark:hover:bg-gray-800/50"
          onClick={() => setExpanded(!expanded())}
        >
          <span class="font-medium text-gray-600 dark:text-gray-400">
            {expanded() ? "Hide details" : "Show usage details"}
          </span>
          <svg
            class={`h-4 w-4 text-gray-400 transition-transform duration-200 ${expanded() ? "rotate-180" : ""}`}
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

        <Show when={expanded()}>
          <div class="animate-slide-down space-y-3">
            {/* All-time Stats */}
            <div class="grid grid-cols-3 gap-2 sm:gap-3">
              {/* Total Requests */}
              <div class="rounded-lg border border-blue-100 bg-blue-50 p-3 dark:border-blue-800/50 dark:bg-blue-900/20">
                <div class="mb-1 text-[10px] font-medium uppercase tracking-wider text-blue-600 dark:text-blue-400 sm:text-xs">
                  Total Requests
                </div>
                <div class="text-lg font-bold text-blue-700 dark:text-blue-300 sm:text-xl">
                  <AnimatedNumber value={stats()?.totalRequests || 0} />
                </div>
                <div class="mt-1 flex items-center gap-2">
                  <span class="text-[10px] text-green-600 dark:text-green-400">
                    ✓ {formatNumber(stats()?.successCount || 0)}
                  </span>
                  <Show when={(stats()?.failureCount || 0) > 0}>
                    <span class="text-[10px] text-red-500">
                      ✗ {formatNumber(stats()?.failureCount || 0)}
                    </span>
                  </Show>
                </div>
              </div>

              {/* Total Tokens */}
              <div class="rounded-lg border border-purple-100 bg-purple-50 p-3 dark:border-purple-800/50 dark:bg-purple-900/20">
                <div class="mb-1 text-[10px] font-medium uppercase tracking-wider text-purple-600 dark:text-purple-400 sm:text-xs">
                  Total Tokens
                </div>
                <div class="text-lg font-bold text-purple-700 dark:text-purple-300 sm:text-xl">
                  <AnimatedNumber format={formatTokens} value={stats()?.totalTokens || 0} />
                </div>
                <div class="mt-1 flex items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400">
                  <span>↓ {formatTokens(stats()?.inputTokens || 0)}</span>
                  <span>↑ {formatTokens(stats()?.outputTokens || 0)}</span>
                </div>
              </div>

              {/* Success Rate */}
              <div class="rounded-lg border border-green-100 bg-green-50 p-3 dark:border-green-800/50 dark:bg-green-900/20">
                <div class="mb-1 text-[10px] font-medium uppercase tracking-wider text-green-600 dark:text-green-400 sm:text-xs">
                  Success Rate
                </div>
                <div class="text-lg font-bold text-green-700 dark:text-green-300 sm:text-xl">
                  {successRate()}%
                </div>
                <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-green-200 dark:bg-green-800">
                  <div
                    class="h-full rounded-full bg-green-500 transition-all duration-500 dark:bg-green-400"
                    style={{ width: `${successRate()}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Model Breakdown */}
            <Show when={stats()?.models && stats()!.models.length > 0}>
              <div class="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700/50 dark:bg-gray-800/30">
                <div class="mb-2 text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-400">
                  Models Used
                </div>
                <div class="space-y-2">
                  <For each={stats()?.models.slice(0, 5)}>
                    {(model) => {
                      const maxRequests = Math.max(
                        ...(stats()?.models.map((m) => m.requests) || [1]),
                      );
                      const percentage = (model.requests / maxRequests) * 100;

                      return (
                        <div class="flex items-center gap-2">
                          <div
                            class="w-24 truncate font-mono text-xs text-gray-700 dark:text-gray-300 sm:w-32"
                            title={model.model}
                          >
                            {model.model}
                          </div>
                          <div class="h-2 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                            <div
                              class="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all duration-500"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                          <div class="w-16 text-right text-xs tabular-nums text-gray-500 dark:text-gray-400">
                            {formatNumber(model.requests)} req
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </Show>

      {/* Empty state when no usage yet */}
      <Show when={!loading() && !hasStats()}>
        <div class="rounded-lg border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-4 text-center dark:border-blue-800/50 dark:from-blue-900/20 dark:to-indigo-900/20">
          <div class="mb-2 flex items-center justify-center gap-2">
            <div class="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            <p class="text-sm font-medium text-blue-700 dark:text-blue-300">
              {proxyStatus().running ? "Ready to track usage" : "No usage data yet"}
            </p>
          </div>
          <p class="text-xs text-blue-600/70 dark:text-blue-400/70">
            Stats will appear here as you use your AI tools through the proxy
          </p>
        </div>
      </Show>
    </div>
  );
}

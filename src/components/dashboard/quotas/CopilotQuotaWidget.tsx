import { createSignal, For, onMount, Show } from "solid-js";
import { useI18n } from "../../../i18n";
import { getCachedOrFetch } from "../../../lib/quotaCache";
import { type CopilotQuotaResult, fetchCopilotQuota } from "../../../lib/tauri";

// Copilot Quota Widget - shows premium interactions and chat quotas for GitHub Copilot
export function CopilotQuotaWidget() {
  const { t } = useI18n();
  const [quotaData, setQuotaData] = createSignal<CopilotQuotaResult[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal(false);

  const loadQuota = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const results = await getCachedOrFetch("copilot", fetchCopilotQuota, forceRefresh);
      setQuotaData(results);
    } catch (error) {
      setError(String(error));
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    // Always try to load - copilot-api doesn't need OAuth
    loadQuota();
  });

  const getUsageColor = (percent: number, inverted = false) => {
    const value = inverted ? 100 - percent : percent;
    if (value >= 90) {
      return "text-red-600 dark:text-red-400";
    }
    if (value >= 70) {
      return "text-yellow-600 dark:text-yellow-400";
    }
    return "text-green-600 dark:text-green-400";
  };

  const getProgressColor = (percent: number, inverted = false) => {
    const value = inverted ? 100 - percent : percent;
    if (value >= 90) {
      return "bg-red-500";
    }
    if (value >= 70) {
      return "bg-yellow-500";
    }
    return "bg-green-500";
  };

  return (
    <div class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      {/* Header */}
      <div
        class="flex w-full cursor-pointer items-center justify-between border-b border-gray-100 px-4 py-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
        onClick={() => setExpanded(!expanded())}
      >
        <div class="flex items-center gap-2">
          <img alt="GitHub" class="h-5 w-5 rounded" src="/logos/github.svg" />
          <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("dashboard.quota.githubCopilotTitle")}
          </span>
          <Show when={quotaData().length > 0}>
            <span class="text-xs text-gray-500 dark:text-gray-400">
              {t("dashboard.antigravity.accountsCount", {
                count: quotaData().length,
              })}
            </span>
          </Show>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50 dark:hover:text-gray-300"
            disabled={loading()}
            onClick={(e) => {
              e.stopPropagation();
              loadQuota(true);
            }}
            title={t("dashboard.quota.refresh")}
          >
            <svg
              class={`h-4 w-4 ${loading() ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
          </button>
          <svg
            class={`h-4 w-4 text-gray-400 transition-transform ${expanded() ? "rotate-180" : ""}`}
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
      </div>

      <Show when={expanded()}>
        <div class="space-y-4 p-4">
          <Show when={loading() && quotaData().length === 0}>
            <div class="flex items-center justify-center py-4 text-gray-500">
              <svg class="mr-2 h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
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
              {t("dashboard.quota.loadingQuota")}
            </div>
          </Show>

          <Show when={error()}>
            <div class="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
              <p class="text-sm text-red-700 dark:text-red-300">{error()}</p>
            </div>
          </Show>

          <For each={quotaData()}>
            {(account) => (
              <div class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                <div class="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-700/50">
                  <div class="flex items-center gap-2">
                    <h4 class="truncate text-sm font-medium text-gray-700 dark:text-gray-300">
                      {account.accountLogin}
                    </h4>
                    <span class="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                      {account.plan}
                    </span>
                  </div>
                  <Show when={account.error}>
                    <span class="text-[10px] font-medium text-red-500">
                      {t("dashboard.quota.apiError")}
                    </span>
                  </Show>
                </div>
                <div class="space-y-3 bg-white p-3 dark:bg-gray-800">
                  {/* Premium Interactions (remaining %) */}
                  <div>
                    <div class="mb-1 flex items-center justify-between">
                      <span class="text-xs text-gray-500">
                        {t("dashboard.quota.premiumInteractions")}
                      </span>
                      <span
                        class={`text-xs font-medium ${getUsageColor(account.premiumInteractionsPercent, true)}`}
                      >
                        {t("dashboard.quota.percentUsed", {
                          count: (100 - account.premiumInteractionsPercent).toFixed(0),
                        })}
                      </span>
                    </div>
                    <div class="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                      <div
                        class={`h-full ${getProgressColor(account.premiumInteractionsPercent, true)} transition-all`}
                        style={{
                          width: `${Math.min(100 - account.premiumInteractionsPercent, 100)}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Chat (remaining %) */}
                  <div>
                    <div class="mb-1 flex items-center justify-between">
                      <span class="text-xs text-gray-500">{t("dashboard.quota.chat")}</span>
                      <span
                        class={`text-xs font-medium ${getUsageColor(account.chatPercent, true)}`}
                      >
                        {t("dashboard.quota.percentUsed", {
                          count: (100 - account.chatPercent).toFixed(0),
                        })}
                      </span>
                    </div>
                    <div class="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                      <div
                        class={`h-full ${getProgressColor(account.chatPercent, true)} transition-all`}
                        style={{
                          width: `${Math.min(100 - account.chatPercent, 100)}%`,
                        }}
                      />
                    </div>
                  </div>

                  <Show when={account.error}>
                    <p class="rounded bg-red-50 p-1.5 text-[10px] text-red-500 dark:bg-red-900/20">
                      {account.error}
                    </p>
                  </Show>
                </div>
              </div>
            )}
          </For>

          <Show when={!loading() && quotaData().length === 0 && !error()}>
            <p class="py-2 text-center text-sm text-gray-500">
              {t("dashboard.quota.noCopilotAccounts")}
            </p>
          </Show>
        </div>
      </Show>
    </div>
  );
}

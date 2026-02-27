import { createSignal, For, onMount, Show } from "solid-js";
import { useI18n } from "../../../i18n";
import { getCachedOrFetch } from "../../../lib/quotaCache";
import { fetchKiroQuota, type KiroQuotaResult } from "../../../lib/tauri";

// Kiro Quota Widget - shows agentic AI credits for Kiro accounts
export function KiroQuotaWidget() {
  const { t } = useI18n();
  const [quotaData, setQuotaData] = createSignal<KiroQuotaResult[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);

  const loadQuota = async (forceRefresh = false) => {
    setLoading(true);
    try {
      const results = await getCachedOrFetch("kiro", fetchKiroQuota, forceRefresh);
      setQuotaData(results);
    } catch (error) {
      console.error("Failed to fetch Kiro quota:", error);
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    loadQuota();
  });

  return (
    <div class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      {/* Header - same pattern as Antigravity / Claude Quota */}
      <div
        class="flex w-full cursor-pointer items-center justify-between border-b border-gray-100 px-4 py-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
        onClick={() => setExpanded(!expanded())}
      >
        <div class="flex items-center gap-2">
          <img alt="Kiro" class="h-5 w-5 rounded" src="/logos/kiro.svg" />
          <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("dashboard.kiro.title")}
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
            type="button"
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
            <div class="flex items-center justify-center py-4 text-gray-500 dark:text-gray-400">
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
              Loading quota...
            </div>
          </Show>

          <For each={quotaData()}>
            {(quota) => (
              <div class="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700/50 dark:bg-gray-900/50">
                {/* Account Header */}
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-medium text-gray-900 dark:text-gray-100">
                      {quota.accountEmail}
                    </span>
                    <span class="rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
                      {quota.plan}
                    </span>
                  </div>
                </div>

                {/* Plan Credits */}
                <Show when={quota.totalCredits > 0}>
                  <div class="space-y-1">
                    <div class="flex items-center justify-between">
                      <span class="text-xs text-gray-500 dark:text-gray-400">Plan Credits</span>
                      <div class="flex items-center gap-2">
                        <Show when={quota.resetsOn}>
                          <span class="text-[10px] text-brand-600 dark:text-brand-400">
                            Resets {quota.resetsOn}
                          </span>
                        </Show>
                        <span class="text-xs font-medium text-gray-900 dark:text-gray-100">
                          {quota.usedCredits.toFixed(2)} / {quota.totalCredits} used
                        </span>
                      </div>
                    </div>
                    <div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                      <div
                        class="h-full bg-brand-500 transition-all duration-300"
                        style={{ width: `${quota.usedPercent}%` }}
                      />
                    </div>
                  </div>
                </Show>

                {/* Bonus Credits */}
                <Show when={quota.bonusCreditsTotal > 0}>
                  <div class="space-y-1">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-1.5">
                        <svg
                          class="h-3.5 w-3.5 text-amber-500"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            clip-rule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                            fill-rule="evenodd"
                          />
                        </svg>
                        <span class="text-xs text-gray-500 dark:text-gray-400">Bonus Credits</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <Show when={quota.bonusCreditsExpiresDays}>
                          <span class="text-[10px] text-amber-600 dark:text-amber-400">
                            Expires in {quota.bonusCreditsExpiresDays} days
                          </span>
                        </Show>
                        <span class="text-xs font-medium text-gray-900 dark:text-gray-100">
                          {quota.bonusCreditsUsed.toFixed(2)} / {quota.bonusCreditsTotal} used
                        </span>
                      </div>
                    </div>
                    <div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                      <div
                        class="h-full bg-amber-500 transition-all duration-300"
                        style={{
                          width: `${(quota.bonusCreditsUsed / quota.bonusCreditsTotal) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </Show>

                {/* No Data / Error State */}
                <Show
                  fallback={
                    <div class="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                      <svg
                        class="h-4 w-4 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                        />
                      </svg>
                      <span>{quota.error || "Manual check required on app.kiro.dev"}</span>
                    </div>
                  }
                  when={quota.totalCredits > 0 || quota.bonusCreditsTotal > 0}
                >
                  {null}
                </Show>
              </div>
            )}
          </For>

          <Show when={!loading() && quotaData().length === 0}>
            <div class="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
              No Kiro quota data. Install kiro-cli and sign in, or check app.kiro.dev.
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

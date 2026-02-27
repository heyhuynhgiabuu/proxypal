import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js";
import { useI18n } from "../../../i18n";
import { getCachedOrFetch } from "../../../lib/quotaCache";
import { type AntigravityQuotaResult, fetchAntigravityQuota } from "../../../lib/tauri";
import { BarChart } from "../../charts/BarChart";

interface QuotaWidgetProps {
  authStatus: { antigravity: number };
}

// Antigravity Quota Widget - shows remaining quota for each model with chart/list views
export function QuotaWidget(props: QuotaWidgetProps) {
  const { t } = useI18n();
  const [quotaData, setQuotaData] = createSignal<AntigravityQuotaResult[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal(false);

  // View mode and filters from localStorage
  const [viewMode, setViewMode] = createSignal<"chart" | "list">("chart");
  const [selectedAccounts, setSelectedAccounts] = createSignal<Set<string>>(new Set());
  const [selectedModels, setSelectedModels] = createSignal<Set<string>>(new Set());
  const [filtersExpanded, setFiltersExpanded] = createSignal(false);

  const loadQuota = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const results = await getCachedOrFetch("antigravity", fetchAntigravityQuota, forceRefresh);
      setQuotaData(results);
    } catch (error) {
      setError(String(error));
    } finally {
      setLoading(false);
    }
  };

  // Load quota and config when component mounts
  onMount(() => {
    // Load UI preferences from localStorage
    const savedViewMode = localStorage.getItem("proxypal-quota-view-mode");
    const savedAccounts = localStorage.getItem("proxypal-quota-selected-accounts");
    const savedModels = localStorage.getItem("proxypal-quota-selected-models");
    const savedFiltersExpanded = localStorage.getItem("proxypal-quota-filters-expanded");

    if (savedViewMode) {
      setViewMode(savedViewMode as "chart" | "list");
    }
    if (savedAccounts) {
      try {
        setSelectedAccounts(new Set(JSON.parse(savedAccounts) as string[]));
      } catch {
        /* ignore */
      }
    }
    if (savedModels) {
      try {
        setSelectedModels(new Set(JSON.parse(savedModels) as string[]));
      } catch {
        /* ignore */
      }
    }
    if (savedFiltersExpanded) {
      setFiltersExpanded(savedFiltersExpanded === "true");
    }

    if (props.authStatus.antigravity > 0) {
      loadQuota();
    }
  });

  // Debounced localStorage save
  let saveTimer: number | undefined;
  createEffect(() => {
    const mode = viewMode();
    const accounts = Array.from(selectedAccounts());
    const models = Array.from(selectedModels());
    const filtersExp = filtersExpanded();

    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      localStorage.setItem("proxypal-quota-view-mode", mode);
      localStorage.setItem("proxypal-quota-selected-accounts", JSON.stringify(accounts));
      localStorage.setItem("proxypal-quota-selected-models", JSON.stringify(models));
      localStorage.setItem("proxypal-quota-filters-expanded", String(filtersExp));
    }, 300);
  });

  // Available accounts/models from quota data
  const availableAccounts = createMemo(() => quotaData().map((q) => q.accountEmail));

  const availableModels = createMemo(() => {
    const models = new Set<string>();
    quotaData().forEach((account) => {
      account.quotas.forEach((quota) => models.add(quota.displayName));
    });
    return Array.from(models).sort();
  });

  // Group models by category/prefix for cleaner filter UI
  const groupedModels = createMemo(() => {
    const models = availableModels();
    const groups: Record<string, string[]> = {};

    for (const model of models) {
      let category = "Other";
      const lowerModel = model.toLowerCase();

      if (lowerModel.startsWith("claude") || lowerModel.includes("claude")) {
        category = "Claude";
      } else if (lowerModel.startsWith("gemini") || lowerModel.includes("gemini")) {
        category = "Gemini";
      } else if (lowerModel.startsWith("gpt") || lowerModel.includes("gpt")) {
        category = "GPT";
      } else if (lowerModel.startsWith("chat_")) {
        category = "Chat";
      } else if (lowerModel.includes("thinking")) {
        category = "Thinking";
      }

      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(model);
    }

    // Sort categories and return as array of [category, models]
    const order = ["Claude", "Gemini", "GPT", "Chat", "Thinking", "Other"];
    return order
      .filter((cat) => groups[cat] && groups[cat].length > 0)
      .map((cat) => ({ category: cat, models: groups[cat].sort() }));
  });

  // Calculate dynamic chart height based on number of models
  const getChartHeight = (modelCount: number) => {
    const baseHeight = 48; // base height in pixels
    const heightPerModel = 28; // height per model row
    const minHeight = 120;
    const maxHeight = 400;
    return Math.min(maxHeight, Math.max(minHeight, baseHeight + modelCount * heightPerModel));
  };

  // Filtered quota data
  const filteredQuotaData = createMemo(() => {
    let data = quotaData();

    // Filter by selected accounts
    if (selectedAccounts().size > 0) {
      data = data.filter((q) => selectedAccounts().has(q.accountEmail));
    }

    // Filter by selected models
    if (selectedModels().size > 0) {
      data = data
        .map((account) => ({
          ...account,
          quotas: account.quotas.filter((q) => selectedModels().has(q.displayName)),
        }))
        .filter((account) => account.quotas.length > 0);
    }

    return data;
  });

  // Low quota warning (any model < 30%)
  const hasLowQuota = createMemo(() =>
    filteredQuotaData().some((account) => account.quotas.some((q) => q.remainingPercent < 30)),
  );

  // Get color based on remaining percentage
  const getQuotaColor = (percent: number) => {
    if (percent >= 70) {
      return "bg-green-500";
    }
    if (percent >= 30) {
      return "bg-yellow-500";
    }
    return "bg-red-500";
  };

  const getQuotaTextColor = (percent: number) => {
    if (percent >= 70) {
      return "text-green-600 dark:text-green-400";
    }
    if (percent >= 30) {
      return "text-yellow-600 dark:text-yellow-400";
    }
    return "text-red-600 dark:text-red-400";
  };

  // Don't show if no antigravity accounts
  if (props.authStatus.antigravity === 0) {
    return null;
  }

  return (
    <div class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      {/* Header */}
      <div
        class="flex w-full cursor-pointer items-center justify-between border-b border-gray-100 px-4 py-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
        onClick={() => setExpanded(!expanded())}
      >
        <div class="flex items-center gap-2">
          <img alt="Antigravity" class="h-5 w-5 rounded" src="/logos/antigravity.webp" />
          <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("dashboard.antigravity.title")}
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
        {/* Filter Controls */}
        <div class="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
          <button
            class="flex w-full items-center justify-between px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700/50"
            onClick={() => setFiltersExpanded(!filtersExpanded())}
          >
            <span class="text-xs font-medium text-gray-600 dark:text-gray-400">
              {t("dashboard.antigravity.filtersAndView")}
            </span>
            <svg
              class={`h-3 w-3 text-gray-400 transition-transform ${filtersExpanded() ? "rotate-180" : ""}`}
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

          <Show when={filtersExpanded()}>
            <div class="space-y-3 px-4 py-3">
              {/* View Mode Toggle */}
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-600 dark:text-gray-400">
                  {t("dashboard.antigravity.view")}:
                </span>
                <button
                  class={`rounded px-3 py-1 text-xs ${viewMode() === "chart" ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300"}`}
                  onClick={() => setViewMode("chart")}
                >
                  {t("dashboard.antigravity.chart")}
                </button>
                <button
                  class={`rounded px-3 py-1 text-xs ${viewMode() === "list" ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300"}`}
                  onClick={() => setViewMode("list")}
                >
                  {t("dashboard.antigravity.list")}
                </button>
              </div>

              {/* Account Filter */}
              <Show when={availableAccounts().length > 1}>
                <div>
                  <p class="mb-1 text-xs text-gray-500 dark:text-gray-400">
                    {t("dashboard.antigravity.accounts")}:
                  </p>
                  <div class="flex flex-wrap gap-1">
                    <For each={availableAccounts()}>
                      {(account) => (
                        <label class="flex cursor-pointer items-center gap-1 text-xs">
                          <input
                            checked={selectedAccounts().has(account)}
                            class="h-3 w-3 rounded border-gray-300"
                            onChange={(e) => {
                              const newSet = new Set(selectedAccounts());
                              if (e.currentTarget.checked) {
                                newSet.add(account);
                              } else {
                                newSet.delete(account);
                              }
                              setSelectedAccounts(newSet);
                            }}
                            type="checkbox"
                          />
                          <span class="max-w-[150px] truncate text-gray-700 dark:text-gray-300">
                            {account}
                          </span>
                        </label>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              {/* Model Filter - Grouped by Category */}
              <Show when={groupedModels().length > 0}>
                <div>
                  <div class="mb-2 flex items-center justify-between">
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      {t("dashboard.antigravity.models")}:
                    </p>
                    <span class="text-[10px] text-gray-400">
                      {selectedModels().size > 0
                        ? t("dashboard.antigravity.selectedCount", {
                            count: selectedModels().size,
                          })
                        : t("dashboard.antigravity.all")}
                    </span>
                  </div>
                  <div class="max-h-48 space-y-2 overflow-y-auto pr-1">
                    <For each={groupedModels()}>
                      {(group) => (
                        <div class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-600">
                          <div class="flex items-center justify-between bg-gray-100 px-2 py-1.5 dark:bg-gray-700/50">
                            <span class="text-xs font-medium text-gray-700 dark:text-gray-300">
                              {group.category}
                            </span>
                            <button
                              class="text-[10px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                              onClick={() => {
                                const newSet = new Set(selectedModels());
                                const allSelected = group.models.every((m) => newSet.has(m));
                                if (allSelected) {
                                  group.models.forEach((m) => newSet.delete(m));
                                } else {
                                  group.models.forEach((m) => newSet.add(m));
                                }
                                setSelectedModels(newSet);
                              }}
                            >
                              {group.models.every((m) => selectedModels().has(m))
                                ? t("dashboard.antigravity.deselectAll")
                                : t("dashboard.antigravity.selectAll")}
                            </button>
                          </div>
                          <div class="grid grid-cols-2 gap-1 p-2">
                            <For each={group.models}>
                              {(model) => (
                                <label class="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                  <input
                                    checked={selectedModels().has(model)}
                                    class="h-3 w-3 flex-shrink-0 rounded border-gray-300"
                                    onChange={(e) => {
                                      const newSet = new Set(selectedModels());
                                      if (e.currentTarget.checked) {
                                        newSet.add(model);
                                      } else {
                                        newSet.delete(model);
                                      }
                                      setSelectedModels(newSet);
                                    }}
                                    type="checkbox"
                                  />
                                  <span
                                    class="truncate text-gray-700 dark:text-gray-300"
                                    title={model}
                                  >
                                    {model.replace(/^(claude-|gemini-|gpt-|chat_)/, "")}
                                  </span>
                                </label>
                              )}
                            </For>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              {/* Quick Filters */}
              <div class="flex gap-2 border-t border-gray-200 pt-2 dark:border-gray-700">
                <button
                  class="rounded bg-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                  onClick={() => {
                    setSelectedAccounts(new Set<string>());
                    setSelectedModels(new Set<string>());
                  }}
                >
                  {t("dashboard.antigravity.showAll")}
                </button>
                <button
                  class="rounded bg-yellow-500 px-2 py-1 text-xs text-white hover:bg-yellow-600"
                  onClick={() => {
                    const lowModels = new Set<string>();
                    quotaData().forEach((account) => {
                      account.quotas.forEach((quota) => {
                        if (quota.remainingPercent < 50) {
                          lowModels.add(quota.displayName);
                        }
                      });
                    });
                    setSelectedModels(lowModels);
                  }}
                >
                  {t("dashboard.antigravity.lowQuotaUnder50")}
                </button>
              </div>
            </div>
          </Show>
        </div>

        {/* Low Quota Warning */}
        <Show when={hasLowQuota()}>
          <div class="mx-4 mt-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-900/20">
            <div class="flex items-center gap-2">
              <svg
                class="h-4 w-4 text-yellow-600 dark:text-yellow-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  fill-rule="evenodd"
                />
              </svg>
              <span class="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                {t("dashboard.antigravity.lowQuotaAlert")}
              </span>
            </div>
            <p class="mt-1 text-xs text-yellow-700 dark:text-yellow-400">
              {t("dashboard.antigravity.lowQuotaDescription")}
            </p>
          </div>
        </Show>

        {/* Content Area */}
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
              Loading quota...
            </div>
          </Show>

          <Show when={error()}>
            <div class="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
              <p class="text-sm text-red-700 dark:text-red-300">{error()}</p>
            </div>
          </Show>

          {/* Chart View */}
          <Show when={viewMode() === "chart" && filteredQuotaData().length > 0}>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <For each={filteredQuotaData()}>
                {(account) => (
                  <div class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                    <div class="border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-700/50">
                      <h4 class="truncate text-sm font-medium text-gray-700 dark:text-gray-300">
                        {account.accountEmail}
                      </h4>
                      <p class="text-xs text-gray-500 dark:text-gray-400">
                        {account.quotas.length} models
                      </p>
                    </div>
                    <div class="bg-white p-3 dark:bg-gray-800">
                      <BarChart
                        colorByValue={true}
                        data={account.quotas.map((q) => ({
                          name: q.displayName.replace(/^(gemini-|claude-|gpt-)/i, ""),
                          resetTime: q.resetTime,
                          value: q.remainingPercent,
                        }))}
                        horizontal={true}
                        style={{
                          height: `${getChartHeight(account.quotas.length)}px`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* List View */}
          <Show when={viewMode() === "list" && filteredQuotaData().length > 0}>
            <For each={filteredQuotaData()}>
              {(account, index) => {
                const [accountExpanded, setAccountExpanded] = createSignal(index() === 0);
                return (
                  <div class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                    <button
                      class="flex w-full items-center justify-between bg-gray-50 px-3 py-2 transition-colors hover:bg-gray-100 dark:bg-gray-700/50 dark:hover:bg-gray-700"
                      onClick={() => setAccountExpanded(!accountExpanded())}
                    >
                      <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {account.accountEmail}
                      </span>
                      <div class="flex items-center gap-2">
                        <Show when={account.error}>
                          <span class="text-xs text-red-500">{account.error}</span>
                        </Show>
                        <Show when={!account.error}>
                          <span class="text-xs text-gray-500">{account.quotas.length} models</span>
                        </Show>
                        <svg
                          class={`h-4 w-4 text-gray-400 transition-transform ${accountExpanded() ? "rotate-180" : ""}`}
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

                    <Show when={accountExpanded() && !account.error && account.quotas.length > 0}>
                      <div class="space-y-2 bg-white p-3 dark:bg-gray-800">
                        <For each={account.quotas}>
                          {(quota) => (
                            <div class="space-y-1">
                              <div class="flex items-center justify-between text-xs">
                                <span class="text-gray-600 dark:text-gray-400">
                                  {quota.displayName}
                                </span>
                                <span class={getQuotaTextColor(quota.remainingPercent)}>
                                  {quota.remainingPercent.toFixed(0)}%
                                </span>
                              </div>
                              <div class="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                                <div
                                  class={`h-full ${getQuotaColor(quota.remainingPercent)} transition-all duration-300`}
                                  style={{
                                    width: `${Math.min(100, quota.remainingPercent)}%`,
                                  }}
                                />
                              </div>
                              <Show when={quota.resetTime}>
                                <p class="text-[10px] text-gray-400">
                                  Resets: {new Date(quota.resetTime!).toLocaleString()}
                                </p>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>

                    <Show when={accountExpanded() && !account.error && account.quotas.length === 0}>
                      <div class="bg-white p-3 dark:bg-gray-800">
                        <p class="text-xs text-gray-500">No quota data available</p>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </Show>

          <Show when={!loading() && filteredQuotaData().length === 0 && !error()}>
            <p class="py-2 text-center text-sm text-gray-500">
              {quotaData().length === 0
                ? t("dashboard.antigravity.noAccountsFound")
                : t("dashboard.antigravity.noMatchingQuotaData")}
            </p>
          </Show>
        </div>
      </Show>
    </div>
  );
}

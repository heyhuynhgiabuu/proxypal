import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { Chart, registerables } from "chart.js";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  DonutChart,
  type DonutChartData,
  GaugeChart,
  HeatmapChart,
  type HeatmapData,
} from "../components/charts";
import { useI18n } from "../i18n";
import { exportUsageStats, getUsageStats, importUsageStats, type UsageStats } from "../lib/tauri";
import { toastStore } from "../stores/toast";

// Register Chart.js components
Chart.register(...registerables);

type TimeRange = "hour" | "day";
type DatePreset = "24h" | "7d" | "14d" | "30d" | "all";

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

function formatLabel(label: string, range: TimeRange): string {
  if (range === "hour") {
    // Format: "2025-12-02T14" -> "14:00"
    const parts = label.split("T");
    if (parts.length === 2) {
      return `${parts[1]}:00`;
    }
    return label;
  }
  // Format: "2025-12-02" -> "Dec 2"
  try {
    const date = new Date(label);
    return date.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  } catch {
    return label;
  }
}

function formatTimeAgo(
  timestamp: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) {
    return t("analytics.time.justNow");
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return t("analytics.time.minutesAgo", { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("analytics.time.hoursAgo", { count: hours });
  }
  const days = Math.floor(hours / 24);
  return t("analytics.time.daysAgo", { count: days });
}

// Simple mini bar chart for model breakdown
function MiniBarChart(props: { color: string; max: number; value: number }) {
  const percentage = () => (props.max > 0 ? (props.value / props.max) * 100 : 0);
  return (
    <div class="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
      <div
        class={`h-full rounded-full transition-all duration-500 ${props.color}`}
        style={{ width: `${percentage()}%` }}
      />
    </div>
  );
}

// Chart.js wrapper component for SolidJS - uses accessor functions for reactivity
function LineChart(props: {
  color: string;
  fillColor: string;
  getData: () => number[];
  getLabels: () => string[];
  label: string;
}) {
  let canvasRef: HTMLCanvasElement | undefined;
  let chartInstance: Chart | null = null;

  const isDark = () => document.documentElement.classList.contains("dark");

  const createChart = () => {
    if (!canvasRef) {
      return;
    }

    // Destroy existing chart
    if (chartInstance) {
      chartInstance.destroy();
    }

    const textColor = isDark() ? "#9CA3AF" : "#6B7280";
    const gridColor = isDark() ? "rgba(75, 85, 99, 0.3)" : "rgba(209, 213, 219, 0.5)";

    const labels = props.getLabels().slice(-50);
    const data = props.getData().slice(-50);

    chartInstance = new Chart(canvasRef, {
      data: {
        datasets: [
          {
            backgroundColor: props.fillColor,
            borderColor: props.color,
            data,
            fill: true,
            label: props.label,
            pointHoverRadius: 6,
            pointRadius: 4,
            tension: 0.4,
          },
        ],
        labels,
      },
      options: {
        animation: {
          duration: 300,
        },
        interaction: {
          axis: "x",
          intersect: false,
          mode: "nearest",
        },
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: isDark() ? "#1F2937" : "#FFFFFF",
            bodyColor: isDark() ? "#D1D5DB" : "#4B5563",
            borderColor: isDark() ? "#374151" : "#E5E7EB",
            borderWidth: 1,
            cornerRadius: 8,
            intersect: false,
            mode: "index",
            padding: 12,
            titleColor: isDark() ? "#F3F4F6" : "#111827",
          },
        },
        responsive: true,
        scales: {
          x: {
            grid: {
              color: gridColor,
            },
            ticks: {
              color: textColor,
              maxRotation: 45,
              minRotation: 0,
            },
          },
          y: {
            beginAtZero: true,
            grid: {
              color: gridColor,
            },
            ticks: {
              color: textColor,
            },
          },
        },
      },
      type: "line",
    });
  };

  onMount(() => {
    createChart();
  });

  // Update chart when accessor data changes
  createEffect(() => {
    const labels = props.getLabels().slice(-50);
    const data = props.getData().slice(-50);

    if (chartInstance && labels.length > 0) {
      chartInstance.data.labels = labels;
      chartInstance.data.datasets[0].data = data;
      chartInstance.update("none");
    }
  });

  onCleanup(() => {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    if (canvasRef) {
      const ctx = canvasRef.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.width, canvasRef.height);
      }
      canvasRef.width = 0;
      canvasRef.height = 0;
    }
  });

  return <canvas class="h-full w-full" ref={canvasRef} />;
}

// Summary stat card component
function StatCard(props: {
  colorClass: string;
  icon: "bolt" | "check" | "tokens" | "flow";
  subtitle?: string;
  title: string;
  value: string;
}) {
  const icons = {
    bolt: (
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          d="M13 10V3L4 14h7v7l9-11h-7z"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
        />
      </svg>
    ),
    check: (
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
        />
      </svg>
    ),
    flow: (
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
        />
      </svg>
    ),
    tokens: (
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
        />
      </svg>
    ),
  };

  return (
    <div class={`rounded-xl border p-4 transition-shadow hover:shadow-md ${props.colorClass}`}>
      <div class="mb-2 flex items-center gap-2">
        <span class="opacity-80">{icons[props.icon]}</span>
        <span class="text-xs font-medium uppercase tracking-wider opacity-80">{props.title}</span>
      </div>
      <p class="text-2xl font-bold">{props.value}</p>
      <Show when={props.subtitle}>
        <p class="mt-1 text-xs opacity-70">{props.subtitle}</p>
      </Show>
    </div>
  );
}

export function Analytics() {
  const { t } = useI18n();
  const [stats, setStats] = createSignal<UsageStats | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [timeRange, setTimeRange] = createSignal<TimeRange>("day");
  const [datePreset, setDatePreset] = createSignal<DatePreset>("7d");
  const [refreshing, setRefreshing] = createSignal(false);
  const [lastUpdated, setLastUpdated] = createSignal<number>(Date.now());
  const [privacyMode, setPrivacyMode] = createSignal(false);
  const [exporting, setExporting] = createSignal(false);
  const [importing, setImporting] = createSignal(false);

  const fetchStats = async (showToast = false) => {
    try {
      setRefreshing(true);
      const data = await getUsageStats();
      setStats(data);
      setLastUpdated(Date.now());
    } catch (error) {
      console.error("Failed to fetch analytics:", error);
      if (showToast) {
        toastStore.error("Failed to load analytics", String(error));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Handle date preset change
  const handlePresetChange = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset === "24h") {
      setTimeRange("hour");
    } else {
      setTimeRange("day");
    }
  };

  // Export usage statistics to JSON file
  const handleExport = async () => {
    try {
      setExporting(true);
      const data = await exportUsageStats();

      const filePath = await save({
        defaultPath: `proxypal-usage-${new Date().toISOString().split("T")[0]}.json`,
        filters: [{ extensions: ["json"], name: "JSON" }],
      });

      if (filePath) {
        await writeTextFile(filePath, JSON.stringify(data, null, 2));
      }
    } catch (error) {
      console.error("Failed to export usage stats:", error);
      toastStore.error("Failed to export usage stats", String(error));
    } finally {
      setExporting(false);
    }
  };

  // Import usage statistics from JSON file
  const handleImport = async () => {
    try {
      setImporting(true);
      const filePath = await open({
        filters: [{ extensions: ["json"], name: "JSON" }],
        multiple: false,
      });

      if (filePath) {
        const content = await readTextFile(filePath as string);
        const data = JSON.parse(content);
        await importUsageStats(data);
        // Refresh stats after import
        await fetchStats();
      }
    } catch (error) {
      console.error("Failed to import usage stats:", error);
      toastStore.error("Failed to import usage stats", String(error));
    } finally {
      setImporting(false);
    }
  };

  // Fetch on mount
  onMount(() => {
    fetchStats();
  });

  // Filter data by date preset and fill in missing days/hours with zeros
  const filterByDatePreset = (
    data: { label: string; value: number }[],
    isHourly: boolean = false,
  ): { label: string; value: number }[] => {
    const preset = datePreset();
    if (preset === "all") {
      return data;
    }

    const now = new Date();
    let numDays: number;

    switch (preset) {
      case "24h":
        numDays = 1;
        break;
      case "7d":
        numDays = 7;
        break;
      case "14d":
        numDays = 14;
        break;
      case "30d":
        numDays = 30;
        break;
      default:
        return data;
    }

    // Create a map of existing data points
    const dataMap = new Map<string, number>();
    for (const point of data) {
      dataMap.set(point.label, point.value);
    }

    // Generate all expected time slots and fill with data or zeros
    const result: { label: string; value: number }[] = [];

    if (isHourly && preset === "24h") {
      // For 24h view, generate hourly slots
      for (let i = 23; i >= 0; i--) {
        const slotDate = new Date(now.getTime() - i * 60 * 60 * 1000);
        const year = slotDate.getFullYear();
        const month = String(slotDate.getMonth() + 1).padStart(2, "0");
        const day = String(slotDate.getDate()).padStart(2, "0");
        const hour = String(slotDate.getHours()).padStart(2, "0");
        const label = `${year}-${month}-${day}T${hour}`;
        result.push({ label, value: dataMap.get(label) || 0 });
      }
    } else {
      // For day views, generate daily slots
      for (let i = numDays - 1; i >= 0; i--) {
        const slotDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const year = slotDate.getFullYear();
        const month = String(slotDate.getMonth() + 1).padStart(2, "0");
        const day = String(slotDate.getDate()).padStart(2, "0");
        const label = `${year}-${month}-${day}`;
        result.push({ label, value: dataMap.get(label) || 0 });
      }
    }

    return result;
  };

  // Chart data based on time range and date preset
  const requestsChartData = () => {
    const s = stats();
    if (!s) {
      return { data: [], labels: [] };
    }

    // 24h uses hourly data, others use daily data
    const isHourly = timeRange() === "hour";
    const rawData = isHourly ? s.requestsByHour : s.requestsByDay;
    const filteredData = filterByDatePreset(rawData, isHourly);
    return {
      data: filteredData.map((p) => p.value),
      labels: filteredData.map((p) => formatLabel(p.label, timeRange())),
    };
  };

  const tokensChartData = () => {
    const s = stats();
    if (!s) {
      return { data: [], labels: [] };
    }

    // 24h uses hourly data, others use daily data
    const isHourly = timeRange() === "hour";
    const rawData = isHourly ? s.tokensByHour : s.tokensByDay;
    const filteredData = filterByDatePreset(rawData, isHourly);
    return {
      data: filteredData.map((p) => p.value),
      labels: filteredData.map((p) => formatLabel(p.label, timeRange())),
    };
  };

  const hasChartData = () => {
    const reqData = requestsChartData();
    const tokData = tokensChartData();
    return reqData.data.length > 0 || tokData.data.length > 0;
  };

  const successRate = () => {
    const s = stats();
    if (!s || s.totalRequests === 0) {
      return 100;
    }
    return Math.round((s.successCount / s.totalRequests) * 100);
  };

  const maxModelRequests = () => {
    const s = stats();
    if (!s || s.models.length === 0) {
      return 1;
    }
    return Math.max(...s.models.map((m) => m.requests));
  };

  const presets: { label: string; value: DatePreset }[] = [
    { label: t("analytics.presets.24h"), value: "24h" },
    { label: t("analytics.presets.7d"), value: "7d" },
    { label: t("analytics.presets.14d"), value: "14d" },
    { label: t("analytics.presets.30d"), value: "30d" },
    { label: t("analytics.presets.all"), value: "all" },
  ];

  // Privacy blur class
  const blurClass = () => (privacyMode() ? "blur-sm select-none" : "");

  // Provider donut chart data - now uses model data for more detailed breakdown
  const providerDonutData = createMemo((): DonutChartData[] => {
    const s = stats();
    if (!s) {
      return [];
    }
    return s.models
      .filter((m) => m.model !== "unknown" && m.model !== "")
      .slice(0, 10) // Limit to top 10 for better visualization
      .map((m) => ({
        name: m.model,
        value: m.requests,
      }));
  });

  // Activity heatmap data (simulated from hourly data)
  const heatmapData = createMemo((): HeatmapData[] => {
    const s = stats();
    if (!s) {
      return [];
    }

    // Generate heatmap data from requestsByHour
    // Group by day of week and hour
    const data: HeatmapData[] = [];
    const hourlyData = s.requestsByHour || [];

    for (const point of hourlyData) {
      try {
        // Parse label like "2025-12-02T14"
        const [datePart, hourPart] = point.label.split("T");
        if (!datePart || hourPart === undefined) {
          continue;
        }

        const date = new Date(datePart);
        const dayOfWeek = (date.getDay() + 6) % 7; // Mon=0, Sun=6
        const hour = Number.parseInt(hourPart, 10);

        // Accumulate values for same day+hour
        const existing = data.find((d) => d.day === dayOfWeek && d.hour === hour);
        if (existing) {
          existing.value += point.value;
        } else {
          data.push({ day: dayOfWeek, hour, value: point.value });
        }
      } catch {
        // Skip invalid data points
      }
    }

    // Fill in missing cells with 0
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        if (!data.some((d) => d.day === day && d.hour === hour)) {
          data.push({ day, hour, value: 0 });
        }
      }
    }

    return data;
  });

  // Estimated cost (rough pricing per 1M tokens)
  const estimatedCost = () => {
    const s = stats();
    if (!s) {
      return 0;
    }
    // Average pricing: ~$3/1M input, ~$15/1M output (blended across models)
    const inputCost = (s.inputTokens / 1_000_000) * 3;
    const outputCost = (s.outputTokens / 1_000_000) * 15;
    return inputCost + outputCost;
  };

  const formatCost = (cost: number) => {
    if (cost < 0.01) {
      return t("analytics.lessThanCent");
    }
    if (cost < 1) {
      return `$${cost.toFixed(2)}`;
    }
    return `$${cost.toFixed(2)}`;
  };

  return (
    <div class="min-h-screen bg-white p-4 dark:bg-gray-900 sm:p-6">
      <div class="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 class="text-xl font-bold text-gray-900 dark:text-gray-100 sm:text-2xl">
              {t("analytics.title")}
            </h1>
            <p class="text-sm text-gray-500 dark:text-gray-400">{t("analytics.subtitle")}</p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            {/* Date Presets */}
            <div class="flex items-center rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
              <For each={presets}>
                {(preset) => (
                  <button
                    class={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      datePreset() === preset.value
                        ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                        : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                    }`}
                    onClick={() => handlePresetChange(preset.value)}
                  >
                    {preset.label}
                  </button>
                )}
              </For>
            </div>

            {/* Last Updated */}
            <span class="hidden text-xs text-gray-400 dark:text-gray-500 sm:inline">
              {t("analytics.updated")} {formatTimeAgo(lastUpdated(), t)}
            </span>

            {/* Privacy Toggle */}
            <button
              class={`rounded-lg border p-1.5 transition-colors ${
                privacyMode()
                  ? "border-purple-300 bg-purple-100 text-purple-600 dark:border-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                  : "border-gray-300 bg-white text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
              }`}
              onClick={() => setPrivacyMode(!privacyMode())}
              title={
                privacyMode() ? t("analytics.showSensitiveData") : t("analytics.hideSensitiveData")
              }
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <Show
                  fallback={
                    <path
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                    />
                  }
                  when={privacyMode()}
                >
                  <path
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </Show>
              </svg>
            </button>

            {/* Refresh Button */}
            <button
              class="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              disabled={refreshing()}
              onClick={() => fetchStats(true)}
            >
              <svg
                class={`h-4 w-4 ${refreshing() ? "animate-spin" : ""}`}
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
              <span class="hidden sm:inline">{t("analytics.refresh")}</span>
            </button>

            {/* Export Button */}
            <button
              class="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              disabled={exporting() || !stats() || stats()!.totalRequests === 0}
              onClick={handleExport}
              title={t("analytics.exportUsageStatistics")}
            >
              <svg
                class={`h-4 w-4 ${exporting() ? "animate-pulse" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </svg>
              <span class="hidden sm:inline">{t("analytics.export")}</span>
            </button>

            {/* Import Button */}
            <button
              class="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              disabled={importing()}
              onClick={handleImport}
              title={t("analytics.importUsageStatistics")}
            >
              <svg
                class={`h-4 w-4 ${importing() ? "animate-pulse" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </svg>
              <span class="hidden sm:inline">{t("analytics.import")}</span>
            </button>
          </div>
        </div>

        {/* Empty state - no requests yet */}
        <Show when={!loading() && (!stats() || stats()!.totalRequests === 0)}>
          <div class="rounded-xl border border-gray-200 bg-white py-16 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <svg
              class="mx-auto mb-4 h-16 w-16 text-gray-300 dark:text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
              />
            </svg>
            <h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("analytics.noUsageDataYet")}
            </h3>
            <p class="mb-6 text-gray-500 dark:text-gray-400">{t("analytics.noUsageDescription")}</p>

            {/* Troubleshooting tips */}
            <div class="mx-auto max-w-md rounded-lg border border-gray-200 bg-gray-50 p-4 text-left dark:border-gray-700 dark:bg-gray-900/50">
              <p class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("analytics.troubleshooting.title")}
              </p>
              <ul class="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <li class="flex items-start gap-2">
                  <span class="mt-0.5 text-green-500">✓</span>
                  <span>{t("analytics.troubleshooting.proxyRunning")}</span>
                </li>
                <li class="flex items-start gap-2">
                  <span class="mt-0.5 text-green-500">✓</span>
                  <span>{t("analytics.troubleshooting.providerConnected")}</span>
                </li>
                <li class="flex items-start gap-2">
                  <span class="mt-0.5 text-green-500">✓</span>
                  <span>
                    {t("analytics.troubleshooting.toolConfigured")}{" "}
                    <code class="rounded bg-gray-200 px-1 py-0.5 text-xs dark:bg-gray-700">
                      http://localhost:8317/v1
                    </code>
                  </span>
                </li>
                <li class="flex items-start gap-2">
                  <span class="mt-0.5 text-green-500">✓</span>
                  <span>{t("analytics.troubleshooting.madeRequest")}</span>
                </li>
              </ul>
            </div>
          </div>
        </Show>

        {/* Loading state */}
        <Show when={loading()}>
          <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
            <For each={[1, 2, 3, 4]}>
              {() => <div class="h-24 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700" />}
            </For>
          </div>
          <div class="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700" />
        </Show>

        {/* Stats content */}
        <Show when={!loading() && stats() && stats()!.totalRequests > 0}>
          {/* Overview cards - 3 essential metrics */}
          <div class="grid grid-cols-3 gap-3 sm:gap-4">
            <StatCard
              colorClass="bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800/50 text-blue-700 dark:text-blue-300"
              icon="bolt"
              subtitle={t("dashboard.kpi.requestsToday", {
                count: formatNumber(stats()!.requestsToday),
              })}
              title={t("dashboard.kpi.totalRequests")}
              value={formatNumber(stats()!.totalRequests)}
            />
            <StatCard
              colorClass="bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800/50 text-blue-700 dark:text-blue-300"
              icon="check"
              subtitle={t("dashboard.kpi.failedCount", {
                count: formatNumber(stats()!.failureCount),
              })}
              title={t("dashboard.kpi.successRate")}
              value={`${Math.min(100, successRate())}%`}
            />
            <div class={blurClass()}>
              <StatCard
                colorClass="bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800/50 text-blue-700 dark:text-blue-300"
                icon="bolt"
                subtitle={t("dashboard.kpi.tokensCount", {
                  count: formatTokens(stats()!.totalTokens),
                })}
                title={t("dashboard.kpi.estimatedCost")}
                value={formatCost(estimatedCost())}
              />
            </div>
          </div>

          {/* Charts section - Full width trend chart */}
          <Show when={hasChartData()}>
            <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
              <div class="mb-4 flex items-center gap-2">
                <svg
                  class="h-5 w-5 text-blue-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
                <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {datePreset() === "24h"
                    ? t("analytics.last24Hours")
                    : t("analytics.requestTrends")}
                </h2>
              </div>

              {/* Requests chart - keyed by datePreset to force re-render */}
              <Show keyed when={requestsChartData().data.length > 0}>
                <div class="h-48 sm:h-64">
                  <LineChart
                    color="rgb(59, 130, 246)"
                    fillColor="rgba(59, 130, 246, 0.1)"
                    getData={() => requestsChartData().data}
                    getLabels={() => requestsChartData().labels}
                    label={t("analytics.requests")}
                  />
                </div>
              </Show>

              {/* Tokens chart */}
              <Show when={tokensChartData().data.length > 0}>
                <div class="mt-6 border-t border-gray-100 pt-6 dark:border-gray-700">
                  <div class="mb-4 flex items-center gap-2">
                    <svg
                      class="h-5 w-5 text-blue-500"
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
                    <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {t("analytics.tokenUsage")}
                    </h2>
                  </div>
                  <div class="h-48 sm:h-64">
                    <LineChart
                      color="rgb(59, 130, 246)"
                      fillColor="rgba(59, 130, 246, 0.1)"
                      getData={() => tokensChartData().data}
                      getLabels={() => tokensChartData().labels}
                      label={t("analytics.tokens")}
                    />
                  </div>
                </div>
              </Show>
            </div>
          </Show>

          {/* No chart data state */}
          <Show when={!hasChartData()}>
            <div class="rounded-xl border border-gray-200 bg-white py-12 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <svg
                class="mx-auto mb-3 h-12 w-12 text-gray-300 dark:text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                />
              </svg>
              <p class="text-gray-500 dark:text-gray-400">{t("analytics.noTrendData")}</p>
              <p class="mt-1 text-sm text-gray-400 dark:text-gray-500">
                {t("analytics.chartsWillAppear")}
              </p>
            </div>
          </Show>

          {/* Model breakdown */}
          {/* Only show Model Usage when there are known models (filter out "unknown") */}
          <Show when={stats()!.models.some((m) => m.model !== "unknown" && m.model !== "")}>
            <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
              <div class="mb-4 flex items-center gap-2">
                <svg
                  class="h-5 w-5 text-blue-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                  <path
                    d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
                <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("analytics.modelUsage")}
                </h2>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr class="text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      <th class="pb-3">{t("analytics.model")}</th>
                      <th class="pb-3 text-right">{t("analytics.requests")}</th>
                      <th class="pb-3 text-right">{t("analytics.tokens")}</th>
                      <th class="hidden pb-3 text-right md:table-cell">{t("analytics.in")}</th>
                      <th class="hidden pb-3 text-right md:table-cell">{t("analytics.out")}</th>
                      <th class="hidden pb-3 text-right lg:table-cell">{t("analytics.cache")}</th>
                      <th class="hidden w-32 pb-3 sm:table-cell">{t("analytics.usage")}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
                    <For
                      each={stats()!
                        .models.filter((m) => m.model !== "unknown" && m.model !== "")
                        .slice(0, 10)}
                    >
                      {(model) => (
                        <tr class="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td class="py-3">
                            <span
                              class="block max-w-[200px] truncate font-mono text-sm text-gray-900 dark:text-gray-100"
                              title={model.model}
                            >
                              {model.model}
                            </span>
                          </td>
                          <td class="py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                            {formatNumber(model.requests)}
                          </td>
                          <td class="py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                            {formatTokens(model.tokens)}
                          </td>
                          <td class="hidden py-3 text-right tabular-nums text-gray-600 dark:text-gray-400 md:table-cell">
                            {formatTokens(model.inputTokens)}
                          </td>
                          <td class="hidden py-3 text-right tabular-nums text-gray-600 dark:text-gray-400 md:table-cell">
                            {formatTokens(model.outputTokens)}
                          </td>
                          <td class="hidden py-3 text-right tabular-nums text-gray-600 dark:text-gray-400 lg:table-cell">
                            {formatTokens(model.cachedTokens)}
                          </td>
                          <td class="hidden py-3 sm:table-cell">
                            <MiniBarChart
                              color="bg-gradient-to-r from-brand-400 to-brand-600"
                              max={maxModelRequests()}
                              value={model.requests}
                            />
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
              <Show
                when={
                  stats()!.models.filter((m) => m.model !== "unknown" && m.model !== "").length > 10
                }
              >
                <p class="mt-3 text-center text-xs text-gray-400 dark:text-gray-500">
                  {t("analytics.showingTop10Of")}{" "}
                  {stats()!.models.filter((m) => m.model !== "unknown" && m.model !== "").length}{" "}
                  {t("analytics.models")}
                </p>
              </Show>
            </div>
          </Show>

          {/* Model Breakdown - Donut Chart */}
          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Model Donut Chart */}
            <Show
              fallback={
                <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
                  <div class="mb-4 flex items-center gap-2">
                    <svg
                      class="h-5 w-5 text-blue-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                      />
                      <path
                        d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                      />
                    </svg>
                    <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {t("analytics.modelBreakdown")}
                    </h2>
                  </div>
                  <div class="flex h-64 items-center justify-center text-gray-400 dark:text-gray-500">
                    {t("analytics.noModelData")}
                  </div>
                </div>
              }
              when={providerDonutData().length > 0}
            >
              <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
                <div class="mb-4 flex items-center gap-2">
                  <svg
                    class="h-5 w-5 text-blue-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                    />
                    <path
                      d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                    />
                  </svg>
                  <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {t("analytics.modelBreakdown")}
                  </h2>
                </div>
                <div class="h-64">
                  <DonutChart
                    centerSubtext={t("analytics.requests")}
                    centerText={formatNumber(stats()!.totalRequests)}
                    data={providerDonutData()}
                  />
                </div>
              </div>
            </Show>

            {/* Success Rate Gauge - always show when stats available */}
            <Show when={stats()}>
              <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
                <div class="mb-4 flex items-center gap-2">
                  <svg
                    class="h-5 w-5 text-blue-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                    />
                  </svg>
                  <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {t("dashboard.kpi.successRate")}
                  </h2>
                </div>
                <div class="h-64">
                  <GaugeChart value={successRate()} />
                </div>
              </div>
            </Show>
          </div>

          {/* Activity Heatmap */}
          <Show when={heatmapData().length > 0}>
            <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
              <div class="mb-4 flex items-center gap-2">
                <svg
                  class="h-5 w-5 text-blue-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
                <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("analytics.activityPatterns")}
                </h2>
                <span class="ml-auto text-xs text-gray-500 dark:text-gray-400">
                  {t("analytics.hourByDayOfWeek")}
                </span>
              </div>
              <div class="h-48">
                <HeatmapChart data={heatmapData()} />
              </div>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

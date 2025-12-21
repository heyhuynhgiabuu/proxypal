import { Chart, registerables } from "chart.js";
import {
	createEffect,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { getUsageStats, type UsageStats } from "../lib/tauri";
import { appStore } from "../stores/app";

// Register Chart.js components
Chart.register(...registerables);

type TimeRange = "hour" | "day";
type DatePreset = "24h" | "7d" | "14d" | "30d" | "all";

function formatNumber(num: number): string {
	if (num >= 1_000_000) {
		return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
	}
	if (num >= 1_000) {
		return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
	}
	return num.toLocaleString();
}

function formatTokens(num: number): string {
	if (num >= 1_000_000) {
		return (num / 1_000_000).toFixed(2) + "M";
	}
	if (num >= 1_000) {
		return (num / 1_000).toFixed(1) + "K";
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
		return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
	} catch {
		return label;
	}
}

function formatTimeAgo(timestamp: number): string {
	const seconds = Math.floor((Date.now() - timestamp) / 1000);
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

// Simple mini bar chart for model breakdown
function MiniBarChart(props: { value: number; max: number; color: string }) {
	const percentage = () =>
		props.max > 0 ? (props.value / props.max) * 100 : 0;
	return (
		<div class="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
			<div
				class={`h-full rounded-full transition-all duration-500 ${props.color}`}
				style={{ width: `${percentage()}%` }}
			/>
		</div>
	);
}

// Chart.js wrapper component for SolidJS
function LineChart(props: {
	labels: string[];
	data: number[];
	label: string;
	color: string;
	fillColor: string;
}) {
	let canvasRef: HTMLCanvasElement | undefined;
	let chartInstance: Chart | null = null;

	const isDark = () => document.documentElement.classList.contains("dark");

	const createChart = () => {
		if (!canvasRef) return;

		// Destroy existing chart
		if (chartInstance) {
			chartInstance.destroy();
		}

		const textColor = isDark() ? "#9CA3AF" : "#6B7280";
		const gridColor = isDark()
			? "rgba(75, 85, 99, 0.3)"
			: "rgba(209, 213, 219, 0.5)";

		chartInstance = new Chart(canvasRef, {
			type: "line",
			data: {
				labels: props.labels.slice(-50), // Limit to last 50 points for performance
				datasets: [
					{
						label: props.label,
						data: props.data.slice(-50), // Limit to last 50 points
						borderColor: props.color,
						backgroundColor: props.fillColor,
						fill: true,
						tension: 0.4,
						pointRadius: 4,
						pointHoverRadius: 6,
					},
				],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				parsing: false, // Performance: skip parsing since data is already formatted
				normalized: true, // Performance: data is already normalized
				animation: {
					duration: 300, // Faster animations
				},
				plugins: {
					legend: {
						display: false,
					},
					tooltip: {
						mode: "index",
						intersect: false,
						backgroundColor: isDark() ? "#1F2937" : "#FFFFFF",
						titleColor: isDark() ? "#F3F4F6" : "#111827",
						bodyColor: isDark() ? "#D1D5DB" : "#4B5563",
						borderColor: isDark() ? "#374151" : "#E5E7EB",
						borderWidth: 1,
						padding: 12,
						cornerRadius: 8,
					},
				},
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
				interaction: {
					mode: "nearest",
					axis: "x",
					intersect: false,
				},
			},
		});
	};

	onMount(() => {
		createChart();
	});

	// Update chart when data changes
	createEffect(() => {
		// Access props to track changes
		const labels = props.labels.slice(-50); // Limit to last 50 points
		const data = props.data.slice(-50);
		if (chartInstance && labels && data) {
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
		// Reset canvas to release memory (Windows WebView2 fix)
		if (canvasRef) {
			const ctx = canvasRef.getContext("2d");
			if (ctx) {
				ctx.clearRect(0, 0, canvasRef.width, canvasRef.height);
			}
			canvasRef.width = 0;
			canvasRef.height = 0;
		}
	});

	return <canvas ref={canvasRef} class="w-full h-full" />;
}

// Summary stat card component
function StatCard(props: {
	title: string;
	value: string;
	subtitle?: string;
	icon: "bolt" | "check" | "tokens" | "flow";
	colorClass: string;
}) {
	const icons = {
		bolt: (
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
					d="M13 10V3L4 14h7v7l9-11h-7z"
				/>
			</svg>
		),
		check: (
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
					d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
		),
		tokens: (
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
					d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
				/>
			</svg>
		),
		flow: (
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
					d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
				/>
			</svg>
		),
	};

	return (
		<div
			class={`p-4 rounded-xl border transition-shadow hover:shadow-md ${props.colorClass}`}
		>
			<div class="flex items-center gap-2 mb-2">
				<span class="opacity-80">{icons[props.icon]}</span>
				<span class="text-xs font-medium uppercase tracking-wider opacity-80">
					{props.title}
				</span>
			</div>
			<p class="text-2xl font-bold">{props.value}</p>
			<Show when={props.subtitle}>
				<p class="text-xs opacity-70 mt-1">{props.subtitle}</p>
			</Show>
		</div>
	);
}

export function Analytics() {
	const { setCurrentPage } = appStore;
	const [stats, setStats] = createSignal<UsageStats | null>(null);
	const [loading, setLoading] = createSignal(true);
	const [timeRange, setTimeRange] = createSignal<TimeRange>("day");
	const [datePreset, setDatePreset] = createSignal<DatePreset>("7d");
	const [refreshing, setRefreshing] = createSignal(false);
	const [lastUpdated, setLastUpdated] = createSignal<number>(Date.now());

	const fetchStats = async () => {
		try {
			setRefreshing(true);
			const data = await getUsageStats();
			setStats(data);
			setLastUpdated(Date.now());
		} catch (err) {
			console.error("Failed to fetch analytics:", err);
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

	// Fetch on mount
	onMount(() => {
		fetchStats();
	});

	// Chart data based on time range
	const requestsChartData = () => {
		const s = stats();
		if (!s) return { labels: [], data: [] };
		const rawData = timeRange() === "hour" ? s.requestsByHour : s.requestsByDay;
		return {
			labels: rawData.map((p) => formatLabel(p.label, timeRange())),
			data: rawData.map((p) => p.value),
		};
	};

	const tokensChartData = () => {
		const s = stats();
		if (!s) return { labels: [], data: [] };
		const rawData = timeRange() === "hour" ? s.tokensByHour : s.tokensByDay;
		return {
			labels: rawData.map((p) => formatLabel(p.label, timeRange())),
			data: rawData.map((p) => p.value),
		};
	};

	const hasChartData = () => {
		const reqData = requestsChartData();
		const tokData = tokensChartData();
		return reqData.data.length > 0 || tokData.data.length > 0;
	};

	const successRate = () => {
		const s = stats();
		if (!s || s.totalRequests === 0) return 100;
		return Math.round((s.successCount / s.totalRequests) * 100);
	};

	const maxModelRequests = () => {
		const s = stats();
		if (!s || s.models.length === 0) return 1;
		return Math.max(...s.models.map((m) => m.requests));
	};

	const presets: { label: string; value: DatePreset }[] = [
		{ label: "24H", value: "24h" },
		{ label: "7D", value: "7d" },
		{ label: "14D", value: "14d" },
		{ label: "30D", value: "30d" },
		{ label: "All", value: "all" },
	];

	return (
		<div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-6">
			<div class="max-w-6xl mx-auto space-y-6">
				{/* Header */}
				<div class="flex items-center justify-between flex-wrap gap-3">
					<div class="flex items-center gap-3">
						<button
							onClick={() => setCurrentPage("dashboard")}
							class="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
						>
							<svg
								class="w-5 h-5 text-gray-600 dark:text-gray-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M15 19l-7-7 7-7"
								/>
							</svg>
						</button>
						<div>
							<h1 class="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
								Analytics
							</h1>
							<p class="text-sm text-gray-500 dark:text-gray-400">
								Track usage & insights
							</p>
						</div>
					</div>

					<div class="flex items-center gap-2 flex-wrap">
						{/* Date Presets */}
						<div class="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
							<For each={presets}>
								{(preset) => (
									<button
										onClick={() => handlePresetChange(preset.value)}
										class={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
											datePreset() === preset.value
												? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
												: "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
										}`}
									>
										{preset.label}
									</button>
								)}
							</For>
						</div>

						{/* Last Updated */}
						<span class="text-xs text-gray-400 dark:text-gray-500 hidden sm:inline">
							Updated {formatTimeAgo(lastUpdated())}
						</span>

						{/* Refresh Button */}
						<button
							onClick={fetchStats}
							disabled={refreshing()}
							class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
						>
							<svg
								class={`w-4 h-4 ${refreshing() ? "animate-spin" : ""}`}
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
								/>
							</svg>
							<span class="hidden sm:inline">Refresh</span>
						</button>
					</div>
				</div>

				{/* Empty state - no requests yet */}
				<Show when={!loading() && (!stats() || stats()!.totalRequests === 0)}>
					<div class="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
						<svg
							class="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
							/>
						</svg>
						<h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
							No Usage Data Yet
						</h3>
						<p class="text-gray-500 dark:text-gray-400">
							Analytics will appear after you make requests through the proxy
						</p>
					</div>
				</Show>

				{/* Loading state */}
				<Show when={loading()}>
					<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
						<For each={[1, 2, 3, 4]}>
							{() => (
								<div class="h-24 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse" />
							)}
						</For>
					</div>
					<div class="h-64 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse" />
				</Show>

				{/* Stats content */}
				<Show when={!loading() && stats() && stats()!.totalRequests > 0}>
					{/* Overview cards */}
					<div class="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
						<StatCard
							title="Total Requests"
							value={formatNumber(stats()!.totalRequests)}
							subtitle={`${formatNumber(stats()!.requestsToday)} today`}
							icon="bolt"
							colorClass="bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800/50 text-blue-700 dark:text-blue-300"
						/>
						<StatCard
							title="Success Rate"
							value={`${successRate()}%`}
							subtitle={`${formatNumber(stats()!.successCount)} successful`}
							icon="check"
							colorClass="bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800/50 text-green-700 dark:text-green-300"
						/>
						<StatCard
							title="Total Tokens"
							value={formatTokens(stats()!.totalTokens)}
							subtitle={`${formatTokens(stats()!.inputTokens)} in / ${formatTokens(stats()!.outputTokens)} out`}
							icon="tokens"
							colorClass="bg-purple-50 dark:bg-purple-900/20 border-purple-100 dark:border-purple-800/50 text-purple-700 dark:text-purple-300"
						/>
						<StatCard
							title="Today's Tokens"
							value={formatTokens(stats()!.tokensToday)}
							subtitle={`${formatNumber(stats()!.requestsToday)} requests`}
							icon="flow"
							colorClass="bg-orange-50 dark:bg-orange-900/20 border-orange-100 dark:border-orange-800/50 text-orange-700 dark:text-orange-300"
						/>
					</div>

					{/* Charts section - Full width trend chart */}
					<Show when={hasChartData()}>
						<div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6 shadow-sm">
							<div class="flex items-center gap-2 mb-4">
								<svg
									class="w-5 h-5 text-blue-500"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
									/>
								</svg>
								<h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
									{datePreset() === "24h" ? "Last 24 Hours" : "Request Trends"}
								</h2>
							</div>

							{/* Requests chart */}
							<Show when={requestsChartData().data.length > 0}>
								<div class="h-48 sm:h-64">
									<LineChart
										labels={requestsChartData().labels}
										data={requestsChartData().data}
										label="Requests"
										color="rgb(59, 130, 246)"
										fillColor="rgba(59, 130, 246, 0.1)"
									/>
								</div>
							</Show>

							{/* Tokens chart */}
							<Show when={tokensChartData().data.length > 0}>
								<div class="mt-6 pt-6 border-t border-gray-100 dark:border-gray-700">
									<div class="flex items-center gap-2 mb-4">
										<svg
											class="w-5 h-5 text-purple-500"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
											/>
										</svg>
										<h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
											Token Usage
										</h2>
									</div>
									<div class="h-48 sm:h-64">
										<LineChart
											labels={tokensChartData().labels}
											data={tokensChartData().data}
											label="Tokens"
											color="rgb(168, 85, 247)"
											fillColor="rgba(168, 85, 247, 0.1)"
										/>
									</div>
								</div>
							</Show>
						</div>
					</Show>

					{/* No chart data state */}
					<Show when={!hasChartData()}>
						<div class="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
							<svg
								class="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="1.5"
									d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
								/>
							</svg>
							<p class="text-gray-500 dark:text-gray-400">
								No trend data available yet
							</p>
							<p class="text-sm text-gray-400 dark:text-gray-500 mt-1">
								Charts will appear as you use the proxy
							</p>
						</div>
					</Show>

					{/* Model breakdown */}
					{/* Only show Model Usage when there are known models (filter out "unknown") */}
					<Show
						when={
							stats()!.models.filter(
								(m) => m.model !== "unknown" && m.model !== "",
							).length > 0
						}
					>
						<div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6 shadow-sm">
							<div class="flex items-center gap-2 mb-4">
								<svg
									class="w-5 h-5 text-indigo-500"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
									/>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
									/>
								</svg>
								<h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
									Model Usage
								</h2>
							</div>
							<div class="overflow-x-auto">
								<table class="w-full">
									<thead>
										<tr class="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
											<th class="pb-3">Model</th>
											<th class="pb-3 text-right">Requests</th>
											<th class="pb-3 text-right">Tokens</th>
											<th class="pb-3 w-32 hidden sm:table-cell">Usage</th>
										</tr>
									</thead>
									<tbody class="divide-y divide-gray-100 dark:divide-gray-700">
										<For
											each={stats()!
												.models.filter(
													(m) => m.model !== "unknown" && m.model !== "",
												)
												.slice(0, 10)}
										>
											{(model) => (
												<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer">
													<td class="py-3">
														<span
															class="font-mono text-sm text-gray-900 dark:text-gray-100 truncate block max-w-[200px]"
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
													<td class="py-3 hidden sm:table-cell">
														<MiniBarChart
															value={model.requests}
															max={maxModelRequests()}
															color="bg-gradient-to-r from-brand-400 to-brand-600"
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
									stats()!.models.filter(
										(m) => m.model !== "unknown" && m.model !== "",
									).length > 10
								}
							>
								<p class="text-xs text-gray-400 dark:text-gray-500 mt-3 text-center">
									Showing top 10 of{" "}
									{
										stats()!.models.filter(
											(m) => m.model !== "unknown" && m.model !== "",
										).length
									}{" "}
									models
								</p>
							</Show>
						</div>
					</Show>
				</Show>
			</div>
		</div>
	);
}

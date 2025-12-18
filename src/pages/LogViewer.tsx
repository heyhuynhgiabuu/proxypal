import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { EmptyState } from "../components/EmptyState";
import { Button } from "../components/ui";
import {
	clearLogs,
	getLogs,
	getRequestErrorLogContent,
	getRequestErrorLogs,
	type LogEntry,
} from "../lib/tauri";
import { appStore } from "../stores/app";
import { toastStore } from "../stores/toast";

// Log level colors
const levelColors: Record<string, string> = {
	ERROR: "text-red-500 bg-red-500/10",
	WARN: "text-yellow-500 bg-yellow-500/10",
	INFO: "text-blue-500 bg-blue-500/10",
	DEBUG: "text-gray-500 bg-gray-500/10",
	TRACE: "text-gray-400 bg-gray-400/10",
};

// Performance: limit displayed logs, load more on demand
const INITIAL_LOG_FETCH = 200;
const DISPLAY_CHUNK_SIZE = 100;

type LogTab = "server" | "errors";

export function LogViewerPage() {
	const { setCurrentPage, proxyStatus } = appStore;
	const [activeTab, setActiveTab] = createSignal<LogTab>("server");
	const [logs, setLogs] = createSignal<LogEntry[]>([]);
	const [loading, setLoading] = createSignal(true); // Start true for immediate skeleton
	const [initialLoad, setInitialLoad] = createSignal(true);
	const [autoRefresh, setAutoRefresh] = createSignal(false);
	const [filter, setFilter] = createSignal<string>("all");
	const [search, setSearch] = createSignal("");
	const [showClearConfirm, setShowClearConfirm] = createSignal(false);
	const [displayLimit, setDisplayLimit] = createSignal(DISPLAY_CHUNK_SIZE);

	// Error logs state
	const [errorLogFiles, setErrorLogFiles] = createSignal<string[]>([]);
	const [selectedErrorLog, setSelectedErrorLog] = createSignal<string>("");
	const [errorLogContent, setErrorLogContent] = createSignal<string>("");
	const [loadingErrorLogs, setLoadingErrorLogs] = createSignal(false);

	let refreshInterval: ReturnType<typeof setInterval> | null = null;
	let logContainerRef: HTMLDivElement | undefined;
	let prevRunning = false;

	// Load logs once on mount when proxy is running
	onMount(() => {
		prevRunning = proxyStatus().running;
		if (prevRunning) {
			loadLogs();
		} else {
			// Not running, clear loading state
			setLoading(false);
			setInitialLoad(false);
		}
	});

	// React to proxy status changes (only when running state actually changes)
	createEffect(() => {
		const running = proxyStatus().running;

		// Only load logs when proxy STARTS (transitions from stopped to running)
		if (running && !prevRunning) {
			loadLogs();
		} else if (!running && prevRunning) {
			setLogs([]);
			setLoading(false);
			setInitialLoad(false);
		}
		prevRunning = running;
	});

	// Auto-refresh effect - only when explicitly enabled (30 second interval)
	createEffect(() => {
		// Clean up previous interval
		if (refreshInterval) {
			clearInterval(refreshInterval);
			refreshInterval = null;
		}

		if (autoRefresh() && proxyStatus().running) {
			refreshInterval = setInterval(loadLogs, 30000);
		}
	});

	onCleanup(() => {
		if (refreshInterval) {
			clearInterval(refreshInterval);
		}
	});

	const loadLogs = async () => {
		// Don't block on subsequent loads (allow concurrent refresh indicator)
		const isFirstLoad = initialLoad();
		if (!isFirstLoad && loading()) return;

		setLoading(true);
		try {
			const result = await getLogs(INITIAL_LOG_FETCH);
			setLogs(result);
			setDisplayLimit(DISPLAY_CHUNK_SIZE); // Reset display limit on fresh load
			// Auto-scroll to bottom (use requestAnimationFrame for smoother UX)
			if (logContainerRef) {
				requestAnimationFrame(() => {
					logContainerRef!.scrollTop = logContainerRef!.scrollHeight;
				});
			}
		} catch (err) {
			toastStore.error(`Failed to load logs: ${err}`);
		} finally {
			setLoading(false);
			setInitialLoad(false);
		}
	};

	// Computed: filtered logs with display limit
	const filteredLogs = createMemo(() => {
		let result = logs();

		// Filter by level
		if (filter() !== "all") {
			result = result.filter(
				(log) => log.level.toUpperCase() === filter().toUpperCase(),
			);
		}

		// Filter by search
		const searchTerm = search().toLowerCase();
		if (searchTerm) {
			result = result.filter((log) =>
				log.message.toLowerCase().includes(searchTerm),
			);
		}

		return result;
	});

	// Display limited subset for performance
	const displayedLogs = createMemo(() => {
		const all = filteredLogs();
		const limit = displayLimit();
		// Show most recent logs (end of array), up to limit
		if (all.length <= limit) return all;
		return all.slice(-limit);
	});

	const hasMoreLogs = createMemo(() => filteredLogs().length > displayLimit());

	const loadMoreLogs = () => {
		setDisplayLimit((prev) => prev + DISPLAY_CHUNK_SIZE);
	};

	const handleClear = async () => {
		try {
			await clearLogs();
			setLogs([]);
			setShowClearConfirm(false);
			toastStore.success("Logs cleared");
		} catch (err) {
			toastStore.error(`Failed to clear logs: ${err}`);
		}
	};

	// Error logs handlers
	const loadErrorLogFiles = async () => {
		if (!proxyStatus().running) return;
		// Skip if already loaded (cache)
		if (errorLogFiles().length > 0) return;

		setLoadingErrorLogs(true);
		try {
			const files = await getRequestErrorLogs();
			setErrorLogFiles(files);
			// Select the most recent file by default
			if (files.length > 0 && !selectedErrorLog()) {
				setSelectedErrorLog(files[0]);
				await loadErrorLogContent(files[0]);
			}
		} catch (err) {
			console.error("Failed to load error log files:", err);
		} finally {
			setLoadingErrorLogs(false);
		}
	};

	const loadErrorLogContent = async (filename: string) => {
		if (!filename) return;
		setLoadingErrorLogs(true);
		try {
			const content = await getRequestErrorLogContent(filename);
			setErrorLogContent(content);
		} catch (err) {
			toastStore.error(`Failed to load error log: ${err}`);
			setErrorLogContent("");
		} finally {
			setLoadingErrorLogs(false);
		}
	};

	const handleSelectErrorLog = async (filename: string) => {
		setSelectedErrorLog(filename);
		await loadErrorLogContent(filename);
	};

	// Load error logs when switching to error tab
	createEffect(() => {
		if (activeTab() === "errors" && proxyStatus().running) {
			loadErrorLogFiles();
		}
	});

	const handleDownload = () => {
		const content = logs()
			.map((log) => {
				const ts = log.timestamp ? `${log.timestamp} ` : "";
				return `${ts}[${log.level}] ${log.message}`;
			})
			.join("\n");

		const blob = new Blob([content], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `proxypal-logs-${new Date().toISOString().split("T")[0]}.txt`;
		a.click();
		URL.revokeObjectURL(url);
		toastStore.success("Logs downloaded");
	};

	const logCounts = () => {
		const counts: Record<string, number> = {
			all: logs().length,
			ERROR: 0,
			WARN: 0,
			INFO: 0,
			DEBUG: 0,
		};
		logs().forEach((log) => {
			const level = log.level.toUpperCase();
			if (counts[level] !== undefined) {
				counts[level]++;
			}
		});
		return counts;
	};

	return (
		<div class="min-h-screen flex flex-col">
			{/* Header */}
			<header class="sticky top-0 z-10 px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2 sm:gap-3">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setCurrentPage("settings")}
						>
							<svg
								class="w-5 h-5"
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
						</Button>
						<h1 class="font-bold text-lg text-gray-900 dark:text-gray-100">
							Logs
						</h1>

						{/* Tab switcher */}
						<div class="flex items-center gap-1 ml-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
							<button
								onClick={() => setActiveTab("server")}
								class={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
									activeTab() === "server"
										? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
										: "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
								}`}
							>
								Server
							</button>
							<button
								onClick={() => setActiveTab("errors")}
								class={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
									activeTab() === "errors"
										? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
										: "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
								}`}
							>
								Errors
							</button>
						</div>

						<Show when={loading() || loadingErrorLogs()}>
							<span class="text-xs text-gray-400 ml-2 flex items-center gap-1">
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
								Loading
							</span>
						</Show>
					</div>

					<div class="flex items-center gap-2">
						{/* Auto-refresh toggle - play/pause icon */}
						<button
							onClick={() => setAutoRefresh(!autoRefresh())}
							class={`p-2 rounded-lg transition-colors ${
								autoRefresh()
									? "bg-brand-500/20 text-brand-500"
									: "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
							}`}
							title={
								autoRefresh() ? "Stop auto-refresh" : "Start auto-refresh (30s)"
							}
						>
							<Show
								when={autoRefresh()}
								fallback={
									/* Play icon when OFF */
									<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
										<path d="M8 5v14l11-7z" />
									</svg>
								}
							>
								{/* Pause icon when ON */}
								<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
									<path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
								</svg>
							</Show>
						</button>

						{/* Manual refresh button - circular arrow with spin when loading */}
						<button
							onClick={loadLogs}
							disabled={loading()}
							class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
							title="Refresh now"
						>
							<svg
								class={`w-5 h-5 ${loading() ? "animate-spin" : ""}`}
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
								/>
							</svg>
						</button>

						{/* Download button */}
						<Show when={logs().length > 0}>
							<button
								onClick={handleDownload}
								class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
								title="Download logs"
							>
								<svg
									class="w-5 h-5"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
									/>
								</svg>
							</button>

							{/* Clear button */}
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setShowClearConfirm(true)}
								class="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
							>
								Clear
							</Button>
						</Show>
					</div>
				</div>
			</header>

			{/* Content */}
			<main class="flex-1 flex flex-col overflow-hidden">
				{/* Proxy not running warning */}
				<Show when={!proxyStatus().running}>
					<div class="flex-1 flex items-center justify-center p-4">
						<EmptyState
							icon={
								<svg
									class="w-10 h-10"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="1.5"
										d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
									/>
								</svg>
							}
							title="Proxy Not Running"
							description="Start the proxy server to view logs."
						/>
					</div>
				</Show>

				<Show when={proxyStatus().running}>
					{/* Server Logs Tab */}
					<Show when={activeTab() === "server"}>
						{/* Filters */}
						<div class="px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-gray-800 flex flex-wrap items-center gap-3">
							{/* Level filter tabs */}
							<div class="flex items-center gap-1">
								<For
									each={[
										{ id: "all", label: "All" },
										{ id: "ERROR", label: "Error" },
										{ id: "WARN", label: "Warn" },
										{ id: "INFO", label: "Info" },
										{ id: "DEBUG", label: "Debug" },
									]}
								>
									{(level) => (
										<button
											onClick={() => setFilter(level.id)}
											class={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
												filter() === level.id
													? level.id === "all"
														? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
														: levelColors[level.id] ||
															"bg-gray-200 dark:bg-gray-700"
													: "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
											}`}
										>
											{level.label}
											<Show when={logCounts()[level.id] > 0}>
												<span class="ml-1 opacity-60">
													({logCounts()[level.id]})
												</span>
											</Show>
										</button>
									)}
								</For>
							</div>

							{/* Search */}
							<div class="flex-1 max-w-xs">
								<input
									type="text"
									value={search()}
									onInput={(e) => setSearch(e.currentTarget.value)}
									placeholder="Search logs..."
									class="w-full px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
								/>
							</div>
						</div>

						{/* Log list */}
						<div
							ref={logContainerRef}
							class="flex-1 overflow-y-auto font-mono text-xs bg-gray-50 dark:bg-gray-900"
						>
							{/* Loading skeleton for initial load */}
							<Show when={initialLoad() && loading()}>
								<div class="p-2 space-y-1">
									<For each={Array(12).fill(0)}>
										{() => (
											<div class="flex items-center gap-2 py-1 px-2 animate-pulse">
												<div class="w-36 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
												<div class="w-12 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
												<div class="flex-1 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
											</div>
										)}
									</For>
								</div>
							</Show>

							<Show when={!initialLoad() || !loading()}>
								<Show
									when={filteredLogs().length > 0}
									fallback={
										<div class="flex items-center justify-center h-full">
											<EmptyState
												icon={
													<svg
														class="w-10 h-10"
														fill="none"
														viewBox="0 0 24 24"
														stroke="currentColor"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="1.5"
															d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
														/>
													</svg>
												}
												title="No Logs"
												description={
													search() || filter() !== "all"
														? "No logs match your filters."
														: "Logs will appear here once the proxy handles requests."
												}
											/>
										</div>
									}
								>
									<div class="p-2 space-y-0.5">
										{/* Load more button at top */}
										<Show when={hasMoreLogs()}>
											<div class="text-center py-2">
												<button
													onClick={loadMoreLogs}
													class="text-xs text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 font-medium"
												>
													↑ Load{" "}
													{Math.min(
														DISPLAY_CHUNK_SIZE,
														filteredLogs().length - displayLimit(),
													)}{" "}
													older logs ({filteredLogs().length - displayLimit()}{" "}
													remaining)
												</button>
											</div>
										</Show>
										<For each={displayedLogs()}>
											{(log) => (
												<div class="flex items-start gap-2 py-0.5 px-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded group">
													{/* Timestamp */}
													<Show when={log.timestamp}>
														<span class="text-gray-400 dark:text-gray-500 shrink-0 text-[11px] w-40 tabular-nums">
															{log.timestamp}
														</span>
													</Show>

													{/* Level badge */}
													<span
														class={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 uppercase ${
															levelColors[log.level.toUpperCase()] ||
															"text-gray-500 bg-gray-500/10"
														}`}
													>
														{log.level.substring(0, 5)}
													</span>

													{/* Message */}
													<span class="text-gray-700 dark:text-gray-300 break-words whitespace-pre-wrap flex-1 min-w-0">
														{log.message}
													</span>
												</div>
											)}
										</For>
									</div>
								</Show>
							</Show>
						</div>
					</Show>

					{/* Error Logs Tab */}
					<Show when={activeTab() === "errors"}>
						<div class="flex flex-1 overflow-hidden">
							{/* Error log file list */}
							<div class="w-48 border-r border-gray-200 dark:border-gray-800 overflow-y-auto bg-gray-50 dark:bg-gray-900">
								<div class="p-2 space-y-1">
									<Show
										when={errorLogFiles().length > 0}
										fallback={
											<div class="text-xs text-gray-400 dark:text-gray-500 p-2 text-center">
												{loadingErrorLogs()
													? "Loading..."
													: "No error logs found"}
											</div>
										}
									>
										<For each={errorLogFiles()}>
											{(file) => (
												<button
													onClick={() => handleSelectErrorLog(file)}
													class={`w-full text-left px-2 py-1.5 rounded text-xs font-mono truncate transition-colors ${
														selectedErrorLog() === file
															? "bg-brand-500/20 text-brand-600 dark:text-brand-400"
															: "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
													}`}
													title={file}
												>
													{file}
												</button>
											)}
										</For>
									</Show>
								</div>
							</div>

							{/* Error log content */}
							<div class="flex-1 overflow-y-auto font-mono text-xs bg-gray-50 dark:bg-gray-900">
								<Show
									when={errorLogContent()}
									fallback={
										<div class="flex items-center justify-center h-full">
											<EmptyState
												icon={
													<svg
														class="w-10 h-10"
														fill="none"
														viewBox="0 0 24 24"
														stroke="currentColor"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="1.5"
															d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
														/>
													</svg>
												}
												title={
													loadingErrorLogs()
														? "Loading..."
														: "Select an Error Log"
												}
												description={
													loadingErrorLogs()
														? "Loading error log content..."
														: "Select a log file from the left to view its contents."
												}
											/>
										</div>
									}
								>
									<pre class="p-4 text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
										{errorLogContent()}
									</pre>
								</Show>
							</div>
						</div>
					</Show>
				</Show>
			</main>

			{/* Clear Confirmation Modal */}
			<Show when={showClearConfirm()}>
				<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
					<div class="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full mx-4 border border-gray-200 dark:border-gray-700 shadow-xl">
						<h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
							Clear All Logs?
						</h3>
						<p class="text-gray-600 dark:text-gray-400 mb-6">
							This will permanently delete all {logs().length} log entries. This
							action cannot be undone.
						</p>
						<div class="flex justify-end gap-3">
							<Button
								variant="ghost"
								onClick={() => setShowClearConfirm(false)}
							>
								Cancel
							</Button>
							<Button
								variant="primary"
								onClick={handleClear}
								class="bg-red-500 hover:bg-red-600"
							>
								Clear Logs
							</Button>
						</div>
					</div>
				</div>
			</Show>
		</div>
	);
}

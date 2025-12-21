import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { clearRequestHistory, onRequestLog } from "../lib/tauri";
import { appStore } from "../stores/app";
import { requestStore } from "../stores/requests";

const MAX_DISPLAY = 50;

const providerColors: Record<string, string> = {
	claude:
		"bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
	openai:
		"bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
	gemini: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
	qwen: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
	iflow: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
	vertex:
		"bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
	antigravity:
		"bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
	deepseek: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
	pending: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
	unknown: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};

const statusColors: Record<number, string> = {
	200: "text-green-600 dark:text-green-400",
	400: "text-amber-600 dark:text-amber-400",
	401: "text-red-600 dark:text-red-400",
	500: "text-red-600 dark:text-red-400",
};

function formatTime(timestamp: number): string {
	const date = new Date(timestamp);
	return date.toLocaleTimeString("en-US", {
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function formatDate(timestamp: number): string {
	const date = new Date(timestamp);
	const today = new Date();
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);

	if (date.toDateString() === today.toDateString()) {
		return "Today";
	} else if (date.toDateString() === yesterday.toDateString()) {
		return "Yesterday";
	}
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number): string {
	if (cost < 0.01) return "<$0.01";
	return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
	return tokens.toString();
}

export function RequestMonitor() {
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
		} catch (err) {
			console.error("Failed to load request history:", err);
		} finally {
			setLoading(false);
		}

		// Listen for new requests with debouncing
		const unlisten = await onRequestLog(async (log) => {
			// Clear previous timer
			if (debounceTimer) clearTimeout(debounceTimer);

			// Debounce: wait 100ms before processing
			debounceTimer = window.setTimeout(async () => {
				try {
					await requestStore.addRequest(log);
				} catch (err) {
					console.error("Failed to save request to history:", err);
				}
			}, 100);
		});

		onCleanup(() => {
			if (debounceTimer) clearTimeout(debounceTimer);
			unlisten();
		});
	});

	const handleClear = async () => {
		try {
			await clearRequestHistory();
			requestStore.clearHistory();
		} catch (err) {
			console.error("Failed to clear history:", err);
		}
	};

	// Get requests in reverse chronological order (newest first)
	const displayRequests = () => {
		return [...history().requests].reverse().slice(0, MAX_DISPLAY);
	};

	const requestCount = () => history().requests.length;
	const hasRequests = () => requestCount() > 0;

	return (
		<div class="rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 overflow-hidden">
			{/* Header */}
			<button
				class="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
				onClick={() => setExpanded(!expanded())}
			>
				<div class="flex items-center gap-3">
					<div class="flex items-center gap-2">
						<div
							class={`w-2 h-2 rounded-full ${proxyStatus().running ? "bg-green-500 animate-pulse" : "bg-gray-400"}`}
						/>
						<span class="font-medium text-gray-900 dark:text-gray-100 text-sm">
							Request History
						</span>
					</div>
					<Show when={hasRequests()}>
						<span class="px-2 py-0.5 text-xs font-medium bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400 rounded-full">
							{requestCount()}
						</span>
					</Show>
				</div>
				<div class="flex items-center gap-2">
					{/* Quick stats */}
					<Show when={hasRequests()}>
						<div class="hidden sm:flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mr-2">
							<span class="flex items-center gap-1">
								<span class="text-green-600 dark:text-green-400 font-medium">
									{formatCost(history().totalCostUsd)}
								</span>
								<span>saved</span>
							</span>
							<span class="text-gray-300 dark:text-gray-600">|</span>
							<span>
								{formatTokens(
									history().totalTokensIn + history().totalTokensOut,
								)}{" "}
								tokens
							</span>
						</div>
						<button
							class="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
							onClick={(e) => {
								e.stopPropagation();
								handleClear();
							}}
						>
							Clear
						</button>
					</Show>
					<svg
						class={`w-4 h-4 text-gray-500 transition-transform ${expanded() ? "rotate-180" : ""}`}
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
				</div>
			</button>

			{/* Expanded content */}
			<Show when={expanded()}>
				<div class="border-t border-gray-200 dark:border-gray-700">
					{/* Stats bar when has requests */}
					<Show when={hasRequests()}>
						<div class="px-4 py-2 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-b border-gray-200 dark:border-gray-700 sm:hidden">
							<div class="flex items-center justify-between text-xs">
								<span class="text-gray-600 dark:text-gray-400">
									Est. savings:{" "}
									<span class="font-semibold text-green-600 dark:text-green-400">
										{formatCost(history().totalCostUsd)}
									</span>
								</span>
								<span class="text-gray-500 dark:text-gray-400">
									{formatTokens(
										history().totalTokensIn + history().totalTokensOut,
									)}{" "}
									tokens
								</span>
							</div>
						</div>
					</Show>

					<Show
						when={!loading() && hasRequests()}
						fallback={
							<div class="px-4 py-8 text-center">
								<Show when={loading()}>
									<div class="flex items-center justify-center gap-2 text-gray-500">
										<svg
											class="w-4 h-4 animate-spin"
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
										<span class="text-sm">Loading history...</span>
									</div>
								</Show>
								<Show when={!loading()}>
									<Show
										when={proxyStatus().running}
										fallback={
											<div class="text-gray-500 dark:text-gray-400">
												<svg
													class="w-8 h-8 mx-auto mb-2 opacity-50"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="1.5"
														d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
													/>
												</svg>
												<p class="text-sm font-medium">Proxy is offline</p>
												<p class="text-xs mt-1 text-gray-400">
													Start the proxy to begin tracking requests
												</p>
											</div>
										}
									>
										<div class="text-gray-500 dark:text-gray-400">
											<svg
												class="w-8 h-8 mx-auto mb-2 opacity-50"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="1.5"
													d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
												/>
											</svg>
											<p class="text-sm font-medium">Waiting for requests</p>
											<p class="text-xs mt-1 text-gray-400 max-w-xs mx-auto">
												Open your AI tool (Cursor, Claude Code, etc.) and make a
												request. It will appear here automatically.
											</p>
											<div class="flex items-center justify-center gap-2 mt-3">
												<div class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
												<span class="text-xs text-green-600 dark:text-green-400">
													Proxy listening on port {proxyStatus().port}
												</span>
											</div>
										</div>
									</Show>
								</Show>
							</div>
						}
					>
						<div class="max-h-72 overflow-y-auto">
							<For each={displayRequests()}>
								{(log, index) => (
									<div
										class={`px-4 py-2 flex items-center gap-3 text-sm ${
											index() % 2 === 0
												? "bg-white dark:bg-gray-900/50"
												: "bg-gray-50 dark:bg-gray-800/30"
										}`}
									>
										{/* Timestamp */}
										<div class="flex flex-col items-end w-16 flex-shrink-0">
											<span class="text-[10px] text-gray-400 dark:text-gray-500">
												{formatDate(log.timestamp)}
											</span>
											<span class="text-xs text-gray-500 dark:text-gray-400 font-mono">
												{formatTime(log.timestamp)}
											</span>
										</div>

										{/* Provider badge */}
										<span
											class={`px-1.5 py-0.5 text-xs font-medium rounded ${providerColors[log.provider] || providerColors.unknown}`}
										>
											{log.provider}
										</span>

										{/* Model */}
										<span class="text-gray-600 dark:text-gray-400 text-xs truncate flex-1 font-mono">
											{log.model || "—"}
										</span>

										{/* Tokens */}
										<Show when={log.tokensIn || log.tokensOut}>
											<span class="text-xs text-gray-400 dark:text-gray-500 font-mono hidden sm:block">
												{formatTokens(
													(log.tokensIn || 0) + (log.tokensOut || 0),
												)}
											</span>
										</Show>

										{/* Status */}
										<span
											class={`font-mono text-xs font-semibold ${statusColors[log.status] || "text-gray-500"}`}
										>
											{log.status}
										</span>

										{/* Duration */}
										<span class="text-xs text-gray-500 dark:text-gray-400 font-mono w-14 text-right">
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
		return reqs.length > 0 ? reqs[reqs.length - 1] : null;
	};

	return (
		<div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
			<Show
				when={proxyStatus().running}
				fallback={<span class="text-gray-400">Proxy offline</span>}
			>
				<div class="flex items-center gap-1.5">
					<div class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
					<span>{history().requests.length} requests</span>
				</div>
				<Show when={history().totalCostUsd > 0}>
					<span class="text-gray-400">|</span>
					<span class="text-green-600 dark:text-green-400 font-medium">
						{formatCost(history().totalCostUsd)} saved
					</span>
				</Show>
				<Show when={latestLog()}>
					<span class="text-gray-400">|</span>
					<span>
						Last: {latestLog()!.provider} (
						{formatDuration(latestLog()!.durationMs)})
					</span>
				</Show>
			</Show>
		</div>
	);
}

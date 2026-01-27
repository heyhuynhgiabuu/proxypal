import { open } from "@tauri-apps/plugin-dialog";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { ApiEndpoint } from "../components/ApiEndpoint";
import { openCommandPalette } from "../components/CommandPalette";
import { CopilotCard } from "../components/CopilotCard";
import { BarChart } from "../components/charts/BarChart";
import { HealthIndicator } from "../components/HealthIndicator";
import { OAuthModal } from "../components/OAuthModal";
import { OpenCodeKitBanner } from "../components/OpenCodeKitBanner";
import { StatusIndicator } from "../components/StatusIndicator";
import { Button } from "../components/ui";
import {
	type AgentConfigResult,
	type AntigravityQuotaResult,
	type AvailableModel,
	appendToShellProfile,
	type ClaudeQuotaResult,
	type CodexQuotaResult,
	type CopilotConfig,
	type CopilotQuotaResult,
	detectCliAgents,
	disconnectProvider,
	fetchAntigravityQuota,
	fetchClaudeQuota,
	fetchCodexQuota,
	fetchCopilotQuota,
	getOAuthUrl,
	getUsageStats,
	importVertexCredential,
	type OAuthUrlResponse,
	onRequestLog,
	openUrlInBrowser,
	type Provider,
	pollOAuthStatus,
	refreshAuthStatus,
	startProxy,
	stopProxy,
	syncUsageFromProxy,
	type UsageStats,
} from "../lib/tauri";
import { appStore } from "../stores/app";
import { requestStore } from "../stores/requests";
import { toastStore } from "../stores/toast";

const providers = [
	{ name: "Claude", provider: "claude" as Provider, logo: "/logos/claude.svg" },
	{
		name: "ChatGPT",
		provider: "openai" as Provider,
		logo: "/logos/openai.svg",
	},
	{ name: "Gemini", provider: "gemini" as Provider, logo: "/logos/gemini.svg" },
	{ name: "Qwen", provider: "qwen" as Provider, logo: "/logos/qwen.png" },
	{ name: "iFlow", provider: "iflow" as Provider, logo: "/logos/iflow.svg" },
	{
		name: "Vertex AI",
		provider: "vertex" as Provider,
		logo: "/logos/vertex.svg",
	},
	{
		name: "Antigravity",
		provider: "antigravity" as Provider,
		logo: "/logos/antigravity.webp",
	},
];

// Compact KPI tile - matches Analytics StatCard styling
function KpiTile(props: {
	label: string;
	value: string;
	subtext?: string;
	icon: "bolt" | "check" | "dollar";
	onClick?: () => void;
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
		dollar: (
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
					d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
		),
	};

	return (
		<button
			onClick={props.onClick}
			class={`p-3 rounded-xl border text-left transition-all hover:scale-[1.02] hover:shadow-md bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800/50 text-blue-700 dark:text-blue-300 ${props.onClick ? "cursor-pointer" : "cursor-default"}`}
		>
			<div class="flex items-center gap-1.5 mb-1 opacity-80">
				{icons[props.icon]}
				<span class="text-[10px] font-medium uppercase tracking-wider">
					{props.label}
				</span>
			</div>
			<p class="text-xl font-bold tabular-nums">{props.value}</p>
			<Show when={props.subtext}>
				<p class="text-[10px] opacity-70 mt-0.5">{props.subtext}</p>
			</Show>
		</button>
	);
}

export function DashboardPage() {
	const {
		proxyStatus,
		setProxyStatus,
		authStatus,
		setAuthStatus,
		config,
		setConfig,
		setCurrentPage,
	} = appStore;
	const [toggling, setToggling] = createSignal(false);
	const [connecting, setConnecting] = createSignal<Provider | null>(null);
	const [recentlyConnected, setRecentlyConnected] = createSignal<Set<Provider>>(
		new Set(),
	);
	const [hasConfiguredAgent, setHasConfiguredAgent] = createSignal(false);
	const [refreshingAgents, setRefreshingAgents] = createSignal(false);
	const [configResult, setConfigResult] = createSignal<{
		result: AgentConfigResult;
		agentName: string;
		models?: AvailableModel[];
	} | null>(null);
	// No dismiss state - onboarding stays until setup complete
	// Use centralized store for history
	const history = requestStore.history;
	const [stats, setStats] = createSignal<UsageStats | null>(null);

	// OAuth Modal state
	const [oauthModalProvider, setOauthModalProvider] =
		createSignal<Provider | null>(null);
	const [oauthUrlData, setOauthUrlData] = createSignal<OAuthUrlResponse | null>(
		null,
	);
	const [oauthLoading, setOauthLoading] = createSignal(false);

	const getProviderName = (provider: Provider): string => {
		const found = providers.find((p) => p.provider === provider);
		return found?.name || provider;
	};

	// Copilot config handler
	const handleCopilotConfigChange = (copilotConfig: CopilotConfig) => {
		setConfig({ ...config(), copilot: copilotConfig });
	};

	// Load data on mount
	const loadAgents = async () => {
		if (refreshingAgents()) return;
		setRefreshingAgents(true);
		try {
			const detected = await detectCliAgents();
			setHasConfiguredAgent(detected.some((a) => a.configured));
		} catch (err) {
			console.error("Failed to load agents:", err);
		} finally {
			setRefreshingAgents(false);
		}
	};

	onMount(async () => {
		// Load agents - handle independently to avoid one failure blocking others
		try {
			const agentList = await detectCliAgents();
			setHasConfiguredAgent(agentList.some((a) => a.configured));
		} catch (err) {
			console.error("Failed to detect CLI agents:", err);
		}

		// Load history from centralized store
		try {
			await requestStore.loadHistory();

			// Sync real token data from proxy if running
			if (appStore.proxyStatus().running) {
				try {
					await syncUsageFromProxy();
					await requestStore.loadHistory(); // Reload to get synced data
				} catch (syncErr) {
					console.warn("Failed to sync usage from proxy:", syncErr);
					// Continue with disk-only history
				}
			}
		} catch (err) {
			console.error("Failed to load request history:", err);
		}

		// Load usage stats
		try {
			const usage = await getUsageStats();
			setStats(usage);
		} catch (err) {
			console.error("Failed to load usage stats:", err);
		}

		// Listen for new requests and refresh stats only
		// History is handled by RequestMonitor via centralized store
		const unlisten = await onRequestLog(async () => {
			// Debounce: wait 1 second after request to allow backend to process
			setTimeout(async () => {
				try {
					// Refresh stats only - history is updated by RequestMonitor
					const usage = await getUsageStats();
					setStats(usage);
				} catch (err) {
					console.error("Failed to refresh stats after new request:", err);
				}
			}, 1000);
		});

		// Cleanup listener on unmount
		onCleanup(() => {
			unlisten();
		});
	});

	// Setup complete when: proxy running + provider connected + agent configured
	const isSetupComplete = () =>
		proxyStatus().running && hasAnyProvider() && hasConfiguredAgent();

	// Onboarding shows until setup complete (no dismiss option)

	const toggleProxy = async () => {
		if (toggling()) return;
		setToggling(true);
		try {
			if (proxyStatus().running) {
				const status = await stopProxy();
				setProxyStatus(status);
				toastStore.info("Proxy stopped");
			} else {
				const status = await startProxy();
				setProxyStatus(status);
				toastStore.success("Proxy started", `Listening on port ${status.port}`);
			}
		} catch (error) {
			console.error("Failed to toggle proxy:", error);
			toastStore.error("Failed to toggle proxy", String(error));
		} finally {
			setToggling(false);
		}
	};

	const handleConnect = async (provider: Provider) => {
		if (!proxyStatus().running) {
			toastStore.warning(
				"Start proxy first",
				"The proxy must be running to connect accounts",
			);
			return;
		}

		// Vertex uses service account import, not OAuth
		if (provider === "vertex") {
			setConnecting(provider);
			toastStore.info(
				"Import Vertex service account",
				"Select your service account JSON file",
			);
			try {
				const selected = await open({
					multiple: false,
					filters: [{ name: "JSON", extensions: ["json"] }],
				});
				const selectedPath = Array.isArray(selected) ? selected[0] : selected;
				if (!selectedPath) {
					setConnecting(null);
					toastStore.warning(
						"No file selected",
						"Choose a service account JSON",
					);
					return;
				}
				await importVertexCredential(selectedPath);
				const newAuth = await refreshAuthStatus();
				setAuthStatus(newAuth);
				setConnecting(null);
				setRecentlyConnected((prev) => new Set([...prev, provider]));
				setTimeout(() => {
					setRecentlyConnected((prev) => {
						const next = new Set(prev);
						next.delete(provider);
						return next;
					});
				}, 2000);
				toastStore.success(
					"Vertex connected!",
					"Service account imported successfully",
				);
			} catch (error) {
				console.error("Vertex import failed:", error);
				setConnecting(null);
				toastStore.error("Connection failed", String(error));
			}
			return;
		}

		// For OAuth providers, get the URL first and show modal
		setConnecting(provider);
		try {
			const urlData = await getOAuthUrl(provider);
			setOauthUrlData(urlData);
			setOauthModalProvider(provider);
			setConnecting(null);
		} catch (error) {
			console.error("Failed to get OAuth URL:", error);
			setConnecting(null);
			toastStore.error("Connection failed", String(error));
		}
	};

	const handleStartOAuth = async () => {
		const provider = oauthModalProvider();
		const urlData = oauthUrlData();
		if (!provider || !urlData) return;

		setOauthLoading(true);

		try {
			// Open the browser with the OAuth URL
			await openUrlInBrowser(urlData.url);
			toastStore.info(
				`Connecting to ${getProviderName(provider)}...`,
				"Complete authentication in your browser",
			);

			// Start polling for OAuth completion
			let attempts = 0;
			const maxAttempts = 120;
			const pollInterval = setInterval(async () => {
				attempts++;
				try {
					const completed = await pollOAuthStatus(urlData.state);
					if (completed) {
						clearInterval(pollInterval);
						// Add delay to ensure file is written before scanning
						await new Promise((resolve) => setTimeout(resolve, 500));

						// Get current count for this provider to detect new auth
						const currentAuth = authStatus();
						const currentCount = currentAuth[provider] || 0;

						// Retry refresh up to 3 times with delay if count doesn't increase
						let newAuth = await refreshAuthStatus();
						let retries = 0;
						while ((newAuth[provider] || 0) <= currentCount && retries < 3) {
							await new Promise((resolve) => setTimeout(resolve, 500));
							newAuth = await refreshAuthStatus();
							retries++;
							console.log(
								`Auth refresh retry ${retries}, count: ${newAuth[provider]}`,
							);
						}

						setAuthStatus(newAuth);
						setOauthLoading(false);
						setOauthModalProvider(null);
						setOauthUrlData(null);
						setRecentlyConnected((prev) => new Set([...prev, provider]));
						setTimeout(() => {
							setRecentlyConnected((prev) => {
								const next = new Set(prev);
								next.delete(provider);
								return next;
							});
						}, 2000);
						toastStore.success(
							`${getProviderName(provider)} connected!`,
							"You can now use this provider",
						);
					} else if (attempts >= maxAttempts) {
						clearInterval(pollInterval);
						setOauthLoading(false);
						toastStore.error("Connection timeout", "Please try again");
					}
				} catch (err) {
					console.error("Poll error:", err);
				}
			}, 1000);
			onCleanup(() => clearInterval(pollInterval));
		} catch (error) {
			console.error("Failed to open OAuth:", error);
			setOauthLoading(false);
			toastStore.error("Connection failed", String(error));
		}
	};

	const handleAlreadyAuthorized = async () => {
		const provider = oauthModalProvider();
		const urlData = oauthUrlData();
		if (!provider || !urlData) return;

		setOauthLoading(true);

		// Check if auth is already complete
		try {
			const completed = await pollOAuthStatus(urlData.state);
			if (completed) {
				// Add delay to ensure file is written before scanning
				await new Promise((resolve) => setTimeout(resolve, 500));

				// Get current count for this provider to detect new auth
				const currentAuth = authStatus();
				const currentCount = currentAuth[provider] || 0;

				// Retry refresh up to 3 times with delay if count doesn't increase
				let newAuth = await refreshAuthStatus();
				let retries = 0;
				while ((newAuth[provider] || 0) <= currentCount && retries < 3) {
					await new Promise((resolve) => setTimeout(resolve, 500));
					newAuth = await refreshAuthStatus();
					retries++;
					console.log(
						`Auth refresh retry ${retries}, count: ${newAuth[provider]}`,
					);
				}

				setAuthStatus(newAuth);
				setOauthLoading(false);
				setOauthModalProvider(null);
				setOauthUrlData(null);
				setRecentlyConnected((prev) => new Set([...prev, provider]));
				setTimeout(() => {
					setRecentlyConnected((prev) => {
						const next = new Set(prev);
						next.delete(provider);
						return next;
					});
				}, 2000);
				toastStore.success(
					`${getProviderName(provider)} connected!`,
					"You can now use this provider",
				);
			} else {
				setOauthLoading(false);
				toastStore.warning(
					"Not authorized yet",
					"Please complete authorization in your browser first",
				);
			}
		} catch (err) {
			console.error("Check auth error:", err);
			setOauthLoading(false);
			toastStore.error("Failed to check authorization", String(err));
		}
	};

	const handleCancelOAuth = () => {
		setOauthModalProvider(null);
		setOauthUrlData(null);
		setOauthLoading(false);
	};

	const handleDisconnect = async (provider: Provider) => {
		try {
			await disconnectProvider(provider);
			const newAuth = await refreshAuthStatus();
			setAuthStatus(newAuth);
			toastStore.success(`${provider} disconnected`);
		} catch (error) {
			console.error("Failed to disconnect:", error);
			toastStore.error("Failed to disconnect", String(error));
		}
	};

	const connectedProviders = () =>
		providers.filter((p) => authStatus()[p.provider]);
	const disconnectedProviders = () =>
		providers.filter((p) => !authStatus()[p.provider]);
	const hasAnyProvider = () => connectedProviders().length > 0;

	const handleApplyEnv = async () => {
		const result = configResult();
		if (!result?.result.shellConfig) return;
		try {
			const profilePath = await appendToShellProfile(result.result.shellConfig);
			toastStore.success("Added to shell profile", `Updated ${profilePath}`);
			setConfigResult(null);
			await loadAgents();
		} catch (error) {
			toastStore.error("Failed to update shell profile", String(error));
		}
	};

	// Format helpers
	const formatCost = (n: number) => (n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
	const formatTokens = (n: number) => {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
		return n.toString();
	};

	// Estimated cost calculation (same as Analytics)
	const estimatedCost = () => {
		const s = stats();
		if (!s) return 0;
		// Average pricing: ~$3/1M input, ~$15/1M output (blended across models)
		const inputCost = (s.inputTokens / 1_000_000) * 3;
		const outputCost = (s.outputTokens / 1_000_000) * 15;
		return inputCost + outputCost;
	};

	// Model grouping helpers
	const groupModelsByProvider = (
		models: AvailableModel[],
	): { provider: string; models: string[] }[] => {
		const providerNames: Record<string, string> = {
			google: "Gemini",
			antigravity: "Gemini", // Antigravity uses Gemini models, group together
			openai: "OpenAI/Codex",
			qwen: "Qwen",
			anthropic: "Claude",
			iflow: "iFlow",
			vertex: "Vertex AI",
		};
		const grouped: Record<string, string[]> = {};
		for (const m of models) {
			const provider = providerNames[m.ownedBy] || m.ownedBy;
			if (!grouped[provider]) grouped[provider] = [];
			grouped[provider].push(m.id);
		}
		return Object.entries(grouped)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([provider, models]) => ({ provider, models }));
	};

	const getProviderColor = (provider: string): string => {
		const colors: Record<string, string> = {
			Gemini: "text-blue-600 dark:text-blue-400",
			"OpenAI/Codex": "text-green-600 dark:text-green-400",
			Qwen: "text-purple-600 dark:text-purple-400",
			Claude: "text-orange-600 dark:text-orange-400",
			iFlow: "text-cyan-600 dark:text-cyan-400",
			"Vertex AI": "text-red-600 dark:text-red-400",
		};
		return colors[provider] || "text-gray-600 dark:text-gray-400";
	};

	return (
		<div class="min-h-screen flex flex-col bg-white dark:bg-gray-900">
			{/* Header - Simplified (navigation handled by sidebar) */}
			<header class="sticky top-0 z-10 px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
				<div class="flex items-center justify-between max-w-3xl mx-auto">
					<h1 class="font-semibold text-lg text-gray-900 dark:text-gray-100">
						Dashboard
					</h1>
					<div class="flex items-center gap-3">
						<button
							onClick={openCommandPalette}
							class="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-700 transition-colors"
							title="Command Palette (⌘K)"
						>
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
									d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
								/>
							</svg>
							<kbd class="px-1.5 py-0.5 text-[10px] font-medium bg-gray-200 dark:bg-gray-700 rounded">
								⌘K
							</kbd>
						</button>
						<StatusIndicator
							running={proxyStatus().running}
							onToggle={toggleProxy}
							disabled={toggling()}
						/>
					</div>
				</div>
			</header>

			{/* Main content */}
			<main class="flex-1 p-4 sm:p-6 overflow-y-auto flex flex-col">
				<div class="max-w-3xl mx-auto space-y-4">
					{/* === OpenCodeKit Banner === */}
					<OpenCodeKitBanner />

					{/* === ZONE 1: Onboarding (shows until setup complete) === */}
					<Show when={!isSetupComplete()}>
						<div class="p-4 sm:p-6 rounded-2xl bg-gradient-to-br from-brand-50 to-purple-50 dark:from-brand-900/30 dark:to-purple-900/20 border border-brand-200 dark:border-brand-800/50">
							<div class="mb-4">
								<h2 class="text-lg font-bold text-gray-900 dark:text-gray-100">
									Get Started
								</h2>
								<p class="text-sm text-gray-600 dark:text-gray-400">
									Complete these steps to start saving
								</p>
							</div>
							<div class="space-y-3">
								{/* Step 1: Start Proxy */}
								<div
									class={`flex items-center gap-3 p-3 rounded-xl border ${proxyStatus().running ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800" : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"}`}
								>
									<div
										class={`w-8 h-8 rounded-full flex items-center justify-center ${proxyStatus().running ? "bg-green-500 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-500"}`}
									>
										{proxyStatus().running ? (
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
													d="M5 13l4 4L19 7"
												/>
											</svg>
										) : (
											"1"
										)}
									</div>
									<div class="flex-1">
										<p class="font-medium text-gray-900 dark:text-gray-100">
											Start the proxy
										</p>
										<p class="text-xs text-gray-500 dark:text-gray-400">
											Enable the local proxy server
										</p>
									</div>
									<Show when={!proxyStatus().running}>
										<Button
											size="sm"
											variant="primary"
											onClick={toggleProxy}
											disabled={toggling()}
										>
											{toggling() ? "Starting..." : "Start"}
										</Button>
									</Show>
								</div>
								{/* Step 2: Connect Provider */}
								<div
									class={`flex items-center gap-3 p-3 rounded-xl border ${hasAnyProvider() ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800" : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"}`}
								>
									<div
										class={`w-8 h-8 rounded-full flex items-center justify-center ${hasAnyProvider() ? "bg-green-500 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-500"}`}
									>
										{hasAnyProvider() ? (
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
													d="M5 13l4 4L19 7"
												/>
											</svg>
										) : (
											"2"
										)}
									</div>
									<div class="flex-1">
										<p class="font-medium text-gray-900 dark:text-gray-100">
											Connect a provider
										</p>
										<p class="text-xs text-gray-500 dark:text-gray-400">
											Link Claude, Gemini, or ChatGPT
										</p>
									</div>
									<Show when={!hasAnyProvider() && proxyStatus().running}>
										<Button
											size="sm"
											variant="secondary"
											onClick={() => {
												const first = disconnectedProviders()[0];
												if (first) handleConnect(first.provider);
											}}
										>
											Connect
										</Button>
									</Show>
								</div>
								{/* Step 3: Configure Agent */}
								<div
									class={`flex items-center gap-3 p-3 rounded-xl border ${hasConfiguredAgent() ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800" : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"}`}
								>
									<div
										class={`w-8 h-8 rounded-full flex items-center justify-center ${hasConfiguredAgent() ? "bg-green-500 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-500"}`}
									>
										{hasConfiguredAgent() ? (
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
													d="M5 13l4 4L19 7"
												/>
											</svg>
										) : (
											"3"
										)}
									</div>
									<div class="flex-1">
										<p class="font-medium text-gray-900 dark:text-gray-100">
											Configure an agent
										</p>
										<p class="text-xs text-gray-500 dark:text-gray-400">
											Set up Cursor, Claude Code, etc.
										</p>
									</div>
									<Show when={!hasConfiguredAgent() && hasAnyProvider()}>
										<Button
											size="sm"
											variant="secondary"
											onClick={() => setCurrentPage("settings")}
										>
											Setup
										</Button>
									</Show>
								</div>
							</div>
						</div>
					</Show>

					{/* === ZONE 2: Value Snapshot (KPIs) - 3-card layout matching Analytics === */}
					<Show
						when={
							history().requests.length > 0 ||
							(stats() && stats()!.totalRequests > 0)
						}
					>
						<div class="grid grid-cols-3 gap-3">
							<KpiTile
								label="Total Requests"
								value={formatTokens(
									stats()?.totalRequests || history().requests.length,
								)}
								subtext={`${stats()?.requestsToday || 0} today`}
								icon="bolt"
								onClick={() => setCurrentPage("analytics")}
							/>
							<KpiTile
								label="Success Rate"
								value={`${stats() && stats()!.totalRequests > 0 ? Math.min(100, Math.round((stats()!.successCount / stats()!.totalRequests) * 100)) : 100}%`}
								subtext={`${stats()?.failureCount || 0} failed`}
								icon="check"
								onClick={() => setCurrentPage("analytics")}
							/>
							<KpiTile
								label="Est. Cost"
								value={formatCost(estimatedCost())}
								subtext={`${formatTokens(stats()?.totalTokens || 0)} tokens`}
								icon="dollar"
								onClick={() => setCurrentPage("analytics")}
							/>
						</div>
					</Show>

					{/* === ZONE 3: Providers (Unified Card) === */}
					<div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
						<div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
							<span class="text-sm font-semibold text-gray-900 dark:text-gray-100">
								Providers
							</span>
							<span class="text-xs text-gray-500 dark:text-gray-400">
								{connectedProviders().length} connected
							</span>
						</div>

						{/* Connected providers */}
						<Show when={connectedProviders().length > 0}>
							<div class="p-3 border-b border-gray-100 dark:border-gray-700">
								<div class="flex flex-wrap gap-2">
									<For each={connectedProviders()}>
										{(p) => (
											<div
												class={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${recentlyConnected().has(p.provider) ? "bg-green-100 dark:bg-green-900/40 border-green-400" : "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"} group`}
											>
												<img
													src={p.logo}
													alt={p.name}
													class="w-4 h-4 rounded"
												/>
												<span class="text-sm font-medium text-green-800 dark:text-green-300">
													{p.name}
												</span>
												{/* Account count badge - show when more than 1 account */}
												<Show when={authStatus()[p.provider] > 1}>
													<span class="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-800/50 px-1.5 py-0.5 rounded-full">
														{authStatus()[p.provider]}
													</span>
												</Show>
												<HealthIndicator provider={p.provider} />
												{/* Add another account button */}
												<button
													onClick={() => handleConnect(p.provider)}
													disabled={connecting() !== null}
													class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-green-600 dark:hover:text-green-400 transition-opacity disabled:opacity-30"
													title="Add another account"
												>
													{connecting() === p.provider ? (
														<svg
															class="w-3.5 h-3.5 animate-spin"
															fill="none"
															stroke="currentColor"
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
													) : (
														<svg
															class="w-3.5 h-3.5"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																stroke-width="2"
																d="M12 4v16m8-8H4"
															/>
														</svg>
													)}
												</button>
												{/* Disconnect button */}
												<button
													onClick={() => handleDisconnect(p.provider)}
													class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity -mr-1"
													title="Disconnect all accounts (manage individually in Settings → Auth Files)"
												>
													<svg
														class="w-3.5 h-3.5"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M6 18L18 6M6 6l12 12"
														/>
													</svg>
												</button>
											</div>
										)}
									</For>
								</div>
							</div>
						</Show>

						{/* Add providers */}
						<Show when={disconnectedProviders().length > 0}>
							<div class="p-3">
								<Show when={!proxyStatus().running}>
									<p class="text-xs text-amber-600 dark:text-amber-400 mb-2">
										Start proxy to connect providers
									</p>
								</Show>
								<div class="flex flex-wrap gap-2">
									<For each={disconnectedProviders()}>
										{(p) => (
											<button
												onClick={() => handleConnect(p.provider)}
												disabled={
													!proxyStatus().running || connecting() !== null
												}
												class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 hover:border-brand-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
											>
												<img
													src={p.logo}
													alt={p.name}
													class="w-4 h-4 rounded opacity-60"
												/>
												<span class="text-sm text-gray-600 dark:text-gray-400">
													{p.name}
												</span>
												{connecting() === p.provider ? (
													<svg
														class="w-3 h-3 animate-spin text-gray-400"
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
												) : (
													<svg
														class="w-3 h-3 text-gray-400"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M12 4v16m8-8H4"
														/>
													</svg>
												)}
											</button>
										)}
									</For>
								</div>
							</div>
						</Show>
					</div>

					{/* === ZONE 3.5: Antigravity Quota === */}
					<QuotaWidget authStatus={authStatus()} />

					{/* === ZONE 3.5b: OpenAI/Codex Quota === */}
					<CodexQuotaWidget authStatus={authStatus()} />

					{/* === ZONE 3.5c: Claude Quota === */}
					<ClaudeQuotaWidget />

					{/* === ZONE 3.5d: GitHub Copilot Quota === */}
					<CopilotQuotaWidget />

					{/* === ZONE 3.6: GitHub Copilot Config === */}
					<CopilotCard
						config={config().copilot}
						onConfigChange={handleCopilotConfigChange}
						proxyRunning={proxyStatus().running}
					/>

					{/* === ZONE 4: API Endpoint === */}
					<ApiEndpoint
						endpoint={proxyStatus().endpoint}
						running={proxyStatus().running}
					/>

					{/* Config Modal */}
					<Show when={configResult()}>
						<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in">
							<div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg animate-scale-in">
								<div class="p-6">
									<div class="flex items-center justify-between mb-4">
										<h2 class="text-lg font-bold text-gray-900 dark:text-gray-100">
											{configResult()!.agentName} Configured
										</h2>
										<button
											onClick={() => setConfigResult(null)}
											class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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
													d="M6 18L18 6M6 6l12 12"
												/>
											</svg>
										</button>
									</div>

									<div class="space-y-4">
										<Show when={configResult()!.result.configPath}>
											<div class="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
												<div class="flex items-center gap-2 text-green-700 dark:text-green-300">
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
															d="M5 13l4 4L19 7"
														/>
													</svg>
													<span class="text-sm font-medium">
														Config file created
													</span>
												</div>
												<p class="mt-1 text-xs text-green-600 dark:text-green-400 font-mono break-all">
													{configResult()!.result.configPath}
												</p>
											</div>
										</Show>

										{/* Models configured - grouped by provider */}
										<Show
											when={
												configResult()?.models &&
												(configResult()?.models?.length ?? 0) > 0
											}
										>
											<div class="space-y-2">
												<div class="flex items-center justify-between">
													<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
														Models Configured
													</span>
													<span class="text-xs text-gray-500 dark:text-gray-400">
														{configResult()?.models?.length ?? 0} total
													</span>
												</div>
												<div class="max-h-48 overflow-y-auto space-y-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
													<For
														each={groupModelsByProvider(
															configResult()?.models ?? [],
														)}
													>
														{(group) => (
															<div>
																<div class="flex items-center gap-2 mb-1.5">
																	<span
																		class={`text-xs font-semibold uppercase tracking-wider ${getProviderColor(group.provider)}`}
																	>
																		{group.provider}
																	</span>
																	<span class="text-xs text-gray-400">
																		({group.models.length})
																	</span>
																</div>
																<div class="flex flex-wrap gap-1">
																	<For each={group.models}>
																		{(model) => (
																			<span class="px-2 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
																				{model}
																			</span>
																		)}
																	</For>
																</div>
															</div>
														)}
													</For>
												</div>
											</div>
										</Show>

										<Show when={configResult()!.result.shellConfig}>
											<div class="space-y-2">
												<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
													Environment Variables
												</span>
												<pre class="p-3 rounded-lg bg-gray-100 dark:bg-gray-800 text-xs font-mono text-gray-700 dark:text-gray-300 overflow-x-auto whitespace-pre-wrap">
													{configResult()!.result.shellConfig}
												</pre>
												<Button
													size="sm"
													variant="secondary"
													onClick={handleApplyEnv}
													class="w-full"
												>
													Add to Shell Profile Automatically
												</Button>
											</div>
										</Show>

										<div class="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-green-800">
											<p class="text-sm text-blue-700 dark:text-blue-300">
												{configResult()!.result.instructions}
											</p>
										</div>
									</div>

									<div class="mt-6 flex justify-end">
										<Button
											variant="primary"
											onClick={() => setConfigResult(null)}
										>
											Done
										</Button>
									</div>
								</div>
							</div>
						</div>
					</Show>
				</div>
			</main>

			{/* OAuth Modal */}
			<OAuthModal
				provider={oauthModalProvider()}
				providerName={
					oauthModalProvider() ? getProviderName(oauthModalProvider()!) : ""
				}
				authUrl={oauthUrlData()?.url || ""}
				onStartOAuth={handleStartOAuth}
				onCancel={handleCancelOAuth}
				onAlreadyAuthorized={handleAlreadyAuthorized}
				loading={oauthLoading()}
			/>
		</div>
	);
}

// Antigravity Quota Widget - shows remaining quota for each model with chart/list views
function QuotaWidget(props: { authStatus: { antigravity: number } }) {
	const [quotaData, setQuotaData] = createSignal<AntigravityQuotaResult[]>([]);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [expanded, setExpanded] = createSignal(false);

	// View mode and filters from localStorage
	const [viewMode, setViewMode] = createSignal<"chart" | "list">("chart");
	const [selectedAccounts, setSelectedAccounts] = createSignal<Set<string>>(
		new Set(),
	);
	const [selectedModels, setSelectedModels] = createSignal<Set<string>>(
		new Set(),
	);
	const [filtersExpanded, setFiltersExpanded] = createSignal(false);

	const loadQuota = async () => {
		setLoading(true);
		setError(null);
		try {
			const results = await fetchAntigravityQuota();
			setQuotaData(results);
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	};

	// Load quota and config when component mounts
	onMount(() => {
		// Load UI preferences from localStorage
		const savedViewMode = localStorage.getItem("proxypal-quota-view-mode");
		const savedAccounts = localStorage.getItem(
			"proxypal-quota-selected-accounts",
		);
		const savedModels = localStorage.getItem("proxypal-quota-selected-models");
		const savedFiltersExpanded = localStorage.getItem(
			"proxypal-quota-filters-expanded",
		);

		if (savedViewMode) setViewMode(savedViewMode as "chart" | "list");
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
		if (savedFiltersExpanded)
			setFiltersExpanded(savedFiltersExpanded === "true");

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
			localStorage.setItem(
				"proxypal-quota-selected-accounts",
				JSON.stringify(accounts),
			);
			localStorage.setItem(
				"proxypal-quota-selected-models",
				JSON.stringify(models),
			);
			localStorage.setItem(
				"proxypal-quota-filters-expanded",
				String(filtersExp),
			);
		}, 300);
	});

	// Available accounts/models from quota data
	const availableAccounts = createMemo(() =>
		quotaData().map((q) => q.accountEmail),
	);

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
			} else if (
				lowerModel.startsWith("gemini") ||
				lowerModel.includes("gemini")
			) {
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
		return Math.min(
			maxHeight,
			Math.max(minHeight, baseHeight + modelCount * heightPerModel),
		);
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
					quotas: account.quotas.filter((q) =>
						selectedModels().has(q.displayName),
					),
				}))
				.filter((account) => account.quotas.length > 0);
		}

		return data;
	});

	// Low quota warning (any model < 30%)
	const hasLowQuota = createMemo(() =>
		filteredQuotaData().some((account) =>
			account.quotas.some((q) => q.remainingPercent < 30),
		),
	);

	// Get color based on remaining percentage
	const getQuotaColor = (percent: number) => {
		if (percent >= 70) return "bg-green-500";
		if (percent >= 30) return "bg-yellow-500";
		return "bg-red-500";
	};

	const getQuotaTextColor = (percent: number) => {
		if (percent >= 70) return "text-green-600 dark:text-green-400";
		if (percent >= 30) return "text-yellow-600 dark:text-yellow-400";
		return "text-red-600 dark:text-red-400";
	};

	// Don't show if no antigravity accounts
	if (props.authStatus.antigravity === 0) return null;

	return (
		<div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
			{/* Header */}
			<div
				onClick={() => setExpanded(!expanded())}
				class="w-full flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
			>
				<div class="flex items-center gap-2">
					<img
						src="/logos/antigravity.webp"
						alt="Antigravity"
						class="w-5 h-5 rounded"
					/>
					<span class="text-sm font-semibold text-gray-900 dark:text-gray-100">
						Antigravity Quota
					</span>
					<Show when={quotaData().length > 0}>
						<span class="text-xs text-gray-500 dark:text-gray-400">
							({quotaData().length} account{quotaData().length !== 1 ? "s" : ""}
							)
						</span>
					</Show>
				</div>
				<div class="flex items-center gap-2">
					<button
						onClick={(e) => {
							e.stopPropagation();
							loadQuota();
						}}
						disabled={loading()}
						class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
						title="Refresh quota"
					>
						<svg
							class={`w-4 h-4 ${loading() ? "animate-spin" : ""}`}
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
					</button>
					<svg
						class={`w-4 h-4 text-gray-400 transition-transform ${expanded() ? "rotate-180" : ""}`}
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
			</div>

			<Show when={expanded()}>
				{/* Filter Controls */}
				<div class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
					<button
						onClick={() => setFiltersExpanded(!filtersExpanded())}
						class="w-full px-4 py-2 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700/50"
					>
						<span class="text-xs font-medium text-gray-600 dark:text-gray-400">
							Filters & View
						</span>
						<svg
							class={`w-3 h-3 text-gray-400 transition-transform ${filtersExpanded() ? "rotate-180" : ""}`}
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
					</button>

					<Show when={filtersExpanded()}>
						<div class="px-4 py-3 space-y-3">
							{/* View Mode Toggle */}
							<div class="flex items-center gap-2">
								<span class="text-xs text-gray-600 dark:text-gray-400">
									View:
								</span>
								<button
									onClick={() => setViewMode("chart")}
									class={`px-3 py-1 text-xs rounded ${viewMode() === "chart" ? "bg-blue-500 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"}`}
								>
									Chart
								</button>
								<button
									onClick={() => setViewMode("list")}
									class={`px-3 py-1 text-xs rounded ${viewMode() === "list" ? "bg-blue-500 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"}`}
								>
									List
								</button>
							</div>

							{/* Account Filter */}
							<Show when={availableAccounts().length > 1}>
								<div>
									<p class="text-xs text-gray-500 dark:text-gray-400 mb-1">
										Accounts:
									</p>
									<div class="flex flex-wrap gap-1">
										<For each={availableAccounts()}>
											{(account) => (
												<label class="flex items-center gap-1 text-xs cursor-pointer">
													<input
														type="checkbox"
														checked={selectedAccounts().has(account)}
														onChange={(e) => {
															const newSet = new Set(selectedAccounts());
															if (e.currentTarget.checked) {
																newSet.add(account);
															} else {
																newSet.delete(account);
															}
															setSelectedAccounts(newSet);
														}}
														class="rounded border-gray-300 w-3 h-3"
													/>
													<span class="text-gray-700 dark:text-gray-300 truncate max-w-[150px]">
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
									<div class="flex items-center justify-between mb-2">
										<p class="text-xs text-gray-500 dark:text-gray-400">
											Models:
										</p>
										<span class="text-[10px] text-gray-400">
											{selectedModels().size > 0
												? `${selectedModels().size} selected`
												: "All"}
										</span>
									</div>
									<div class="space-y-2 max-h-48 overflow-y-auto pr-1">
										<For each={groupedModels()}>
											{(group) => (
												<div class="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
													<div class="flex items-center justify-between px-2 py-1.5 bg-gray-100 dark:bg-gray-700/50">
														<span class="text-xs font-medium text-gray-700 dark:text-gray-300">
															{group.category}
														</span>
														<button
															onClick={() => {
																const newSet = new Set(selectedModels());
																const allSelected = group.models.every((m) =>
																	newSet.has(m),
																);
																if (allSelected) {
																	group.models.forEach((m) => newSet.delete(m));
																} else {
																	group.models.forEach((m) => newSet.add(m));
																}
																setSelectedModels(newSet);
															}}
															class="text-[10px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
														>
															{group.models.every((m) =>
																selectedModels().has(m),
															)
																? "Deselect all"
																: "Select all"}
														</button>
													</div>
													<div class="p-2 grid grid-cols-2 gap-1">
														<For each={group.models}>
															{(model) => (
																<label class="flex items-center gap-1.5 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 rounded px-1 py-0.5">
																	<input
																		type="checkbox"
																		checked={selectedModels().has(model)}
																		onChange={(e) => {
																			const newSet = new Set(selectedModels());
																			if (e.currentTarget.checked) {
																				newSet.add(model);
																			} else {
																				newSet.delete(model);
																			}
																			setSelectedModels(newSet);
																		}}
																		class="rounded border-gray-300 w-3 h-3 flex-shrink-0"
																	/>
																	<span
																		class="text-gray-700 dark:text-gray-300 truncate"
																		title={model}
																	>
																		{model.replace(
																			/^(claude-|gemini-|gpt-|chat_)/,
																			"",
																		)}
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
							<div class="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
								<button
									onClick={() => {
										setSelectedAccounts(new Set<string>());
										setSelectedModels(new Set<string>());
									}}
									class="text-xs px-2 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
								>
									Show All
								</button>
								<button
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
									class="text-xs px-2 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-600"
								>
									Low Quota (&lt;50%)
								</button>
							</div>
						</div>
					</Show>
				</div>

				{/* Low Quota Warning */}
				<Show when={hasLowQuota()}>
					<div class="mx-4 mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
						<div class="flex items-center gap-2">
							<svg
								class="w-4 h-4 text-yellow-600 dark:text-yellow-400"
								fill="currentColor"
								viewBox="0 0 20 20"
							>
								<path
									fill-rule="evenodd"
									d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
								/>
							</svg>
							<span class="text-sm font-medium text-yellow-800 dark:text-yellow-300">
								Low Quota Alert
							</span>
						</div>
						<p class="mt-1 text-xs text-yellow-700 dark:text-yellow-400">
							Some models have less than 30% quota remaining
						</p>
					</div>
				</Show>

				{/* Content Area */}
				<div class="p-4 space-y-4">
					<Show when={loading() && quotaData().length === 0}>
						<div class="flex items-center justify-center py-4 text-gray-500">
							<svg
								class="w-5 h-5 animate-spin mr-2"
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
							Loading quota...
						</div>
					</Show>

					<Show when={error()}>
						<div class="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
							<p class="text-sm text-red-700 dark:text-red-300">{error()}</p>
						</div>
					</Show>

					{/* Chart View */}
					<Show when={viewMode() === "chart" && filteredQuotaData().length > 0}>
						<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
							<For each={filteredQuotaData()}>
								{(account) => (
									<div class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
										<div class="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
											<h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
												{account.accountEmail}
											</h4>
											<p class="text-xs text-gray-500 dark:text-gray-400">
												{account.quotas.length} models
											</p>
										</div>
										<div class="p-3 bg-white dark:bg-gray-800">
											<BarChart
												data={account.quotas.map((q) => ({
													name: q.displayName.replace(
														/^(gemini-|claude-|gpt-)/i,
														"",
													),
													value: q.remainingPercent,
													resetTime: q.resetTime,
												}))}
												horizontal={true}
												colorByValue={true}
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
								const [accountExpanded, setAccountExpanded] = createSignal(
									index() === 0,
								);
								return (
									<div class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
										<button
											onClick={() => setAccountExpanded(!accountExpanded())}
											class="w-full flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
										>
											<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
												{account.accountEmail}
											</span>
											<div class="flex items-center gap-2">
												<Show when={account.error}>
													<span class="text-xs text-red-500">
														{account.error}
													</span>
												</Show>
												<Show when={!account.error}>
													<span class="text-xs text-gray-500">
														{account.quotas.length} models
													</span>
												</Show>
												<svg
													class={`w-4 h-4 text-gray-400 transition-transform ${accountExpanded() ? "rotate-180" : ""}`}
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

										<Show
											when={
												accountExpanded() &&
												!account.error &&
												account.quotas.length > 0
											}
										>
											<div class="p-3 space-y-2 bg-white dark:bg-gray-800">
												<For each={account.quotas}>
													{(quota) => (
														<div class="space-y-1">
															<div class="flex items-center justify-between text-xs">
																<span class="text-gray-600 dark:text-gray-400">
																	{quota.displayName}
																</span>
																<span
																	class={getQuotaTextColor(
																		quota.remainingPercent,
																	)}
																>
																	{quota.remainingPercent.toFixed(0)}%
																</span>
															</div>
															<div class="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
																<div
																	class={`h-full ${getQuotaColor(quota.remainingPercent)} transition-all duration-300`}
																	style={{
																		width: `${Math.min(100, quota.remainingPercent)}%`,
																	}}
																/>
															</div>
															<Show when={quota.resetTime}>
																<p class="text-[10px] text-gray-400">
																	Resets:{" "}
																	{new Date(quota.resetTime!).toLocaleString()}
																</p>
															</Show>
														</div>
													)}
												</For>
											</div>
										</Show>

										<Show
											when={
												accountExpanded() &&
												!account.error &&
												account.quotas.length === 0
											}
										>
											<div class="p-3 bg-white dark:bg-gray-800">
												<p class="text-xs text-gray-500">
													No quota data available
												</p>
											</div>
										</Show>
									</div>
								);
							}}
						</For>
					</Show>

					<Show
						when={!loading() && filteredQuotaData().length === 0 && !error()}
					>
						<p class="text-sm text-gray-500 text-center py-2">
							{quotaData().length === 0
								? "No Antigravity accounts found"
								: "No matching quota data"}
						</p>
					</Show>
				</div>
			</Show>
		</div>
	);
}

// Copilot Quota Widget - shows premium interactions and chat quotas for GitHub Copilot
function CopilotQuotaWidget() {
	const [quotaData, setQuotaData] = createSignal<CopilotQuotaResult[]>([]);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [expanded, setExpanded] = createSignal(false);

	const loadQuota = async () => {
		setLoading(true);
		setError(null);
		try {
			const results = await fetchCopilotQuota();
			setQuotaData(results);
		} catch (err) {
			setError(String(err));
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
		if (value >= 90) return "text-red-600 dark:text-red-400";
		if (value >= 70) return "text-yellow-600 dark:text-yellow-400";
		return "text-green-600 dark:text-green-400";
	};

	const getProgressColor = (percent: number, inverted = false) => {
		const value = inverted ? 100 - percent : percent;
		if (value >= 90) return "bg-red-500";
		if (value >= 70) return "bg-yellow-500";
		return "bg-green-500";
	};

	return (
		<div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
			{/* Header */}
			<div
				onClick={() => setExpanded(!expanded())}
				class="w-full flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
			>
				<div class="flex items-center gap-2">
					<img src="/logos/github.svg" alt="GitHub" class="w-5 h-5 rounded" />
					<span class="text-sm font-semibold text-gray-900 dark:text-gray-100">
						GitHub Copilot Quota
					</span>
					<Show when={quotaData().length > 0}>
						<span class="text-xs text-gray-500 dark:text-gray-400">
							({quotaData().length} account{quotaData().length !== 1 ? "s" : ""}
							)
						</span>
					</Show>
				</div>
				<div class="flex items-center gap-2">
					<button
						onClick={(e) => {
							e.stopPropagation();
							loadQuota();
						}}
						disabled={loading()}
						class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
						title="Refresh quota"
					>
						<svg
							class={`w-4 h-4 ${loading() ? "animate-spin" : ""}`}
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
					</button>
					<svg
						class={`w-4 h-4 text-gray-400 transition-transform ${expanded() ? "rotate-180" : ""}`}
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
			</div>

			<Show when={expanded()}>
				<div class="p-4 space-y-4">
					<Show when={loading() && quotaData().length === 0}>
						<div class="flex items-center justify-center py-4 text-gray-500">
							<svg
								class="w-5 h-5 animate-spin mr-2"
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
							Loading quota...
						</div>
					</Show>

					<Show when={error()}>
						<div class="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
							<p class="text-sm text-red-700 dark:text-red-300">{error()}</p>
						</div>
					</Show>

					<For each={quotaData()}>
						{(account) => (
							<div class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
								<div class="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
									<div class="flex items-center gap-2">
										<h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
											{account.accountLogin}
										</h4>
										<span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium uppercase">
											{account.plan}
										</span>
									</div>
									<Show when={account.error}>
										<span class="text-[10px] text-red-500 font-medium">
											API Error
										</span>
									</Show>
								</div>
								<div class="p-3 bg-white dark:bg-gray-800 space-y-3">
									{/* Premium Interactions (remaining %) */}
									<div>
										<div class="flex items-center justify-between mb-1">
											<span class="text-xs text-gray-500">
												Premium Interactions
											</span>
											<span
												class={`text-xs font-medium ${getUsageColor(account.premiumInteractionsPercent, true)}`}
											>
												{(100 - account.premiumInteractionsPercent).toFixed(0)}%
												used
											</span>
										</div>
										<div class="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
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
										<div class="flex items-center justify-between mb-1">
											<span class="text-xs text-gray-500">Chat</span>
											<span
												class={`text-xs font-medium ${getUsageColor(account.chatPercent, true)}`}
											>
												{(100 - account.chatPercent).toFixed(0)}% used
											</span>
										</div>
										<div class="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
											<div
												class={`h-full ${getProgressColor(account.chatPercent, true)} transition-all`}
												style={{
													width: `${Math.min(100 - account.chatPercent, 100)}%`,
												}}
											/>
										</div>
									</div>

									<Show when={account.error}>
										<p class="text-[10px] text-red-500 bg-red-50 dark:bg-red-900/20 p-1.5 rounded">
											{account.error}
										</p>
									</Show>
								</div>
							</div>
						)}
					</For>

					<Show when={!loading() && quotaData().length === 0 && !error()}>
						<p class="text-sm text-gray-500 text-center py-2">
							No Copilot accounts found
						</p>
					</Show>
				</div>
			</Show>
		</div>
	);
}

// Claude Quota Widget - shows session and weekly quotas for Claude accounts
function ClaudeQuotaWidget() {
	const [quotaData, setQuotaData] = createSignal<ClaudeQuotaResult[]>([]);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [expanded, setExpanded] = createSignal(false);

	const loadQuota = async () => {
		setLoading(true);
		setError(null);
		try {
			const results = await fetchClaudeQuota();
			setQuotaData(results);
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	};

	onMount(() => {
		// Always try to load - backend will return empty if no accounts
		loadQuota();
	});

	const formatResetTime = (timestamp?: number) => {
		if (!timestamp) return "Unknown";
		const date = new Date(timestamp * 1000);
		const now = new Date();
		const diff = date.getTime() - now.getTime();
		if (diff <= 0) return "Now";
		const hours = Math.floor(diff / (1000 * 60 * 60));
		const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
		if (hours > 24) {
			const days = Math.floor(hours / 24);
			return `${days}d ${hours % 24}h`;
		}
		if (hours > 0) return `${hours}h ${minutes}m`;
		return `${minutes}m`;
	};

	const getUsageColor = (percent: number) => {
		if (percent >= 90) return "text-red-600 dark:text-red-400";
		if (percent >= 70) return "text-yellow-600 dark:text-yellow-400";
		return "text-green-600 dark:text-green-400";
	};

	const getProgressColor = (percent: number) => {
		if (percent >= 90) return "bg-red-500";
		if (percent >= 70) return "bg-yellow-500";
		return "bg-green-500";
	};

	return (
		<div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
			{/* Header */}
			<div
				onClick={() => setExpanded(!expanded())}
				class="w-full flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
			>
				<div class="flex items-center gap-2">
					<img src="/logos/claude.svg" alt="Claude" class="w-5 h-5 rounded" />
					<span class="text-sm font-semibold text-gray-900 dark:text-gray-100">
						Claude Quota
					</span>
					<Show when={quotaData().length > 0}>
						<span class="text-xs text-gray-500 dark:text-gray-400">
							({quotaData().length} account{quotaData().length !== 1 ? "s" : ""}
							)
						</span>
					</Show>
				</div>
				<div class="flex items-center gap-2">
					<button
						onClick={(e) => {
							e.stopPropagation();
							loadQuota();
						}}
						disabled={loading()}
						class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
						title="Refresh quota"
					>
						<svg
							class={`w-4 h-4 ${loading() ? "animate-spin" : ""}`}
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
					</button>
					<svg
						class={`w-4 h-4 text-gray-400 transition-transform ${expanded() ? "rotate-180" : ""}`}
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
			</div>

			<Show when={expanded()}>
				<div class="p-4 space-y-4">
					<Show when={loading() && quotaData().length === 0}>
						<div class="flex items-center justify-center py-4 text-gray-500">
							<svg
								class="w-5 h-5 animate-spin mr-2"
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
							Loading quota...
						</div>
					</Show>

					<Show when={error()}>
						<div class="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
							<p class="text-sm text-red-700 dark:text-red-300">{error()}</p>
						</div>
					</Show>

					<For each={quotaData()}>
						{(account) => (
							<div class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
								<div class="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
									<div class="flex items-center gap-2">
										<h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
											{account.accountEmail}
										</h4>
										<span class="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 font-medium uppercase">
											{account.plan}
										</span>
									</div>
									<Show when={account.error}>
										<span class="text-[10px] text-red-500 font-medium">
											API Error
										</span>
									</Show>
								</div>
								<div class="p-3 bg-white dark:bg-gray-800 space-y-3">
									{/* 5-Hour Session */}
									<div>
										<div class="flex items-center justify-between mb-1">
											<span class="text-xs text-gray-500">5-Hour Session</span>
											<span
												class={`text-xs font-medium ${getUsageColor(account.fiveHourPercent)}`}
											>
												{account.fiveHourPercent.toFixed(0)}% used
											</span>
										</div>
										<div class="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
											<div
												class={`h-full ${getProgressColor(account.fiveHourPercent)} transition-all`}
												style={{
													width: `${Math.min(account.fiveHourPercent, 100)}%`,
												}}
											/>
										</div>
										<p class="text-[10px] text-gray-400 mt-0.5">
											Resets in {formatResetTime(account.fiveHourResetAt)}
										</p>
									</div>

									{/* 7-Day Weekly */}
									<div>
										<div class="flex items-center justify-between mb-1">
											<span class="text-xs text-gray-500">7-Day Weekly</span>
											<span
												class={`text-xs font-medium ${getUsageColor(account.sevenDayPercent)}`}
											>
												{account.sevenDayPercent.toFixed(0)}% used
											</span>
										</div>
										<div class="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
											<div
												class={`h-full ${getProgressColor(account.sevenDayPercent)} transition-all`}
												style={{
													width: `${Math.min(account.sevenDayPercent, 100)}%`,
												}}
											/>
										</div>
										<p class="text-[10px] text-gray-400 mt-0.5">
											Resets in {formatResetTime(account.sevenDayResetAt)}
										</p>
									</div>

									{/* Extra Usage (for Pro plans) */}
									<Show
										when={
											account.extraUsageSpend !== undefined ||
											account.extraUsageLimit !== undefined
										}
									>
										<div class="pt-2 border-t border-gray-100 dark:border-gray-700">
											<div class="flex items-center justify-between">
												<span class="text-xs text-gray-500">Extra Usage</span>
												<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
													${account.extraUsageSpend?.toFixed(2) ?? "0.00"} / $
													{account.extraUsageLimit?.toFixed(0) ?? "0"}
												</span>
											</div>
										</div>
									</Show>

									<Show when={account.error}>
										<p class="text-[10px] text-red-500 bg-red-50 dark:bg-red-900/20 p-1.5 rounded">
											{account.error}
										</p>
									</Show>
								</div>
							</div>
						)}
					</For>

					<Show when={!loading() && quotaData().length === 0 && !error()}>
						<p class="text-sm text-gray-500 text-center py-2">
							No Claude accounts found
						</p>
					</Show>
				</div>
			</Show>
		</div>
	);
}

// Codex Quota Widget - shows rate limits and credits for OpenAI/Codex accounts
function CodexQuotaWidget(props: { authStatus: { openai: number } }) {
	const [quotaData, setQuotaData] = createSignal<CodexQuotaResult[]>([]);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [expanded, setExpanded] = createSignal(false);

	const loadQuota = async () => {
		setLoading(true);
		setError(null);
		try {
			const results = await fetchCodexQuota();
			setQuotaData(results);
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	};

	onMount(() => {
		if (props.authStatus.openai > 0) {
			loadQuota();
		}
	});

	const formatResetTime = (timestamp?: number) => {
		if (!timestamp) return "Unknown";
		const date = new Date(timestamp * 1000);
		const now = new Date();
		const diff = date.getTime() - now.getTime();
		if (diff <= 0) return "Now";
		const hours = Math.floor(diff / (1000 * 60 * 60));
		const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
		if (hours > 24) {
			const days = Math.floor(hours / 24);
			return `${days}d ${hours % 24}h`;
		}
		if (hours > 0) return `${hours}h ${minutes}m`;
		return `${minutes}m`;
	};

	const getUsageColor = (percent: number) => {
		if (percent >= 90) return "text-red-600 dark:text-red-400";
		if (percent >= 70) return "text-yellow-600 dark:text-yellow-400";
		return "text-green-600 dark:text-green-400";
	};

	const getProgressColor = (percent: number) => {
		if (percent >= 90) return "bg-red-500";
		if (percent >= 70) return "bg-yellow-500";
		return "bg-green-500";
	};

	if (props.authStatus.openai === 0) return null;

	return (
		<div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
			{/* Header */}
			<div
				onClick={() => setExpanded(!expanded())}
				class="w-full flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
			>
				<div class="flex items-center gap-2">
					<img src="/logos/openai.svg" alt="OpenAI" class="w-5 h-5 rounded" />
					<span class="text-sm font-semibold text-gray-900 dark:text-gray-100">
						OpenAI (Codex) Quota
					</span>
					<Show when={quotaData().length > 0}>
						<span class="text-xs text-gray-500 dark:text-gray-400">
							({quotaData().length} account{quotaData().length !== 1 ? "s" : ""}
							)
						</span>
					</Show>
				</div>
				<div class="flex items-center gap-2">
					<button
						onClick={(e) => {
							e.stopPropagation();
							loadQuota();
						}}
						disabled={loading()}
						class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
						title="Refresh quota"
					>
						<svg
							class={`w-4 h-4 ${loading() ? "animate-spin" : ""}`}
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
					</button>
					<svg
						class={`w-4 h-4 text-gray-400 transition-transform ${expanded() ? "rotate-180" : ""}`}
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
			</div>

			<Show when={expanded()}>
				<div class="p-4 space-y-4">
					<Show when={loading() && quotaData().length === 0}>
						<div class="flex items-center justify-center py-4 text-gray-500">
							<svg
								class="w-5 h-5 animate-spin mr-2"
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
							Loading usage...
						</div>
					</Show>

					<Show when={error()}>
						<div class="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
							<p class="text-sm text-red-700 dark:text-red-300">{error()}</p>
						</div>
					</Show>

					<For each={quotaData()}>
						{(account) => (
							<div class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
								<div class="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
									<div class="flex items-center gap-2">
										<h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
											{account.accountEmail}
										</h4>
										<span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium uppercase">
											{account.planType}
										</span>
									</div>
									<Show when={account.error}>
										<span class="text-[10px] text-red-500 font-medium">
											API Error
										</span>
									</Show>
								</div>
								<div class="p-3 bg-white dark:bg-gray-800 space-y-3">
									{/* Primary Rate Limit (3-hour window) */}
									<div>
										<div class="flex items-center justify-between mb-1">
											<span class="text-xs text-gray-500">
												Primary Limit (3h)
											</span>
											<span
												class={`text-xs font-medium ${getUsageColor(account.primaryUsedPercent)}`}
											>
												{account.primaryUsedPercent.toFixed(0)}% used
											</span>
										</div>
										<div class="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
											<div
												class={`h-full ${getProgressColor(account.primaryUsedPercent)} transition-all`}
												style={{
													width: `${Math.min(account.primaryUsedPercent, 100)}%`,
												}}
											/>
										</div>
										<p class="text-[10px] text-gray-400 mt-0.5">
											Resets in {formatResetTime(account.primaryResetAt)}
										</p>
									</div>

									{/* Secondary Rate Limit (weekly window) */}
									<div>
										<div class="flex items-center justify-between mb-1">
											<span class="text-xs text-gray-500">Weekly Limit</span>
											<span
												class={`text-xs font-medium ${getUsageColor(account.secondaryUsedPercent)}`}
											>
												{account.secondaryUsedPercent.toFixed(0)}% used
											</span>
										</div>
										<div class="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
											<div
												class={`h-full ${getProgressColor(account.secondaryUsedPercent)} transition-all`}
												style={{
													width: `${Math.min(account.secondaryUsedPercent, 100)}%`,
												}}
											/>
										</div>
										<p class="text-[10px] text-gray-400 mt-0.5">
											Resets in {formatResetTime(account.secondaryResetAt)}
										</p>
									</div>

									{/* Credits (for Pro plans) */}
									<Show when={account.hasCredits}>
										<div class="pt-2 border-t border-gray-100 dark:border-gray-700">
											<div class="flex items-center justify-between">
												<span class="text-xs text-gray-500">
													Credits Balance
												</span>
												<span class="text-sm font-bold text-green-600 dark:text-green-400">
													{account.creditsUnlimited
														? "Unlimited"
														: account.creditsBalance !== undefined
															? `$${account.creditsBalance.toFixed(2)}`
															: "N/A"}
												</span>
											</div>
										</div>
									</Show>

									<Show when={account.error}>
										<p class="text-[10px] text-red-500 bg-red-50 dark:bg-red-900/20 p-1.5 rounded">
											{account.error}
										</p>
									</Show>
								</div>
							</div>
						)}
					</For>

					<Show when={!loading() && quotaData().length === 0 && !error()}>
						<p class="text-sm text-gray-500 text-center py-2">
							No Codex accounts found in ~/.cli-proxy-api
						</p>
					</Show>
				</div>
			</Show>
		</div>
	);
}

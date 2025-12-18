import { open } from "@tauri-apps/plugin-dialog";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { ApiEndpoint } from "../components/ApiEndpoint";
import { openCommandPalette } from "../components/CommandPalette";
import { CopilotCard } from "../components/CopilotCard";
import { HealthIndicator } from "../components/HealthIndicator";
import { ModelsWidget } from "../components/ModelsWidget";
import { OpenCodeKitBanner } from "../components/OpenCodeKitBanner";
import { StatusIndicator } from "../components/StatusIndicator";
import { ThemeToggleCompact } from "../components/ThemeToggle";
import { Button } from "../components/ui";
import {
	type AgentConfigResult,
	type AgentStatus,
	type AvailableModel,
	appendToShellProfile,
	type CopilotConfig,
	configureCliAgent,
	detectCliAgents,
	disconnectProvider,
	getAvailableModels,
	getRequestHistory,
	getUsageStats,
	importVertexCredential,
	onRequestLog,
	openOAuth,
	type Provider,
	pollOAuthStatus,
	type RequestHistory,
	refreshAuthStatus,
	startProxy,
	stopProxy,
	syncUsageFromProxy,
	testAgentConnection,
	type UsageStats,
} from "../lib/tauri";
import { appStore } from "../stores/app";
import { themeStore } from "../stores/theme";
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

// Compact KPI tile
function KpiTile(props: {
	label: string;
	value: string;
	subtext?: string;
	icon: "dollar" | "requests" | "tokens" | "success";
	color: "green" | "blue" | "purple" | "emerald";
	onClick?: () => void;
}) {
	const colors = {
		green:
			"bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50 text-green-700 dark:text-green-300",
		blue: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50 text-blue-700 dark:text-blue-300",
		purple:
			"bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800/50 text-purple-700 dark:text-purple-300",
		emerald:
			"bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-300",
	};

	const icons = {
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
		requests: (
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
		success: (
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
	};

	return (
		<button
			onClick={props.onClick}
			class={`p-3 rounded-xl border text-left transition-all hover:scale-[1.02] ${colors[props.color]} ${props.onClick ? "cursor-pointer" : "cursor-default"}`}
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

// Mini request feed (last 5)
function MiniRequestFeed(props: {
	requests: RequestHistory["requests"];
	onViewAll: () => void;
}) {
	const recent = () => props.requests.slice(-5).reverse();

	const formatTime = (ts: number) => {
		const date = new Date(ts);
		return date.toLocaleTimeString("en-US", {
			hour: "2-digit",
			minute: "2-digit",
		});
	};

	const formatTokens = (n?: number) => {
		if (!n || n === 0) return null; // Return null to hide when no data
		if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
		return n.toString();
	};

	// Get provider badge color
	const getProviderColor = (provider: string) => {
		switch (provider.toLowerCase()) {
			case "claude":
				return "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400";
			case "openai":
			case "openai-compat":
				return "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400";
			case "gemini":
				return "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400";
			case "qwen":
				return "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400";
			case "deepseek":
				return "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400";
			case "zhipu":
				return "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400";
			case "copilot":
				return "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300";
			default:
				return "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400";
		}
	};

	// Format provider name for display
	const formatProvider = (provider: string) => {
		switch (provider.toLowerCase()) {
			case "claude":
				return "Claude";
			case "openai":
				return "OpenAI";
			case "openai-compat":
				return "OpenAI";
			case "gemini":
				return "Gemini";
			case "qwen":
				return "Qwen";
			case "deepseek":
				return "DeepSeek";
			case "zhipu":
				return "Zhipu";
			case "copilot":
				return "Copilot";
			default:
				return provider.charAt(0).toUpperCase() + provider.slice(1);
		}
	};

	// Format model/endpoint for display
	const formatEndpoint = (req: RequestHistory["requests"][0]) => {
		const model = req.model;
		// If we have a real model name (not placeholder), show it
		if (
			model &&
			model !== "unknown" &&
			model !== "api-request" &&
			!model.includes("/")
		) {
			return model;
		}
		// Otherwise derive from path
		if (req.path.includes("/messages")) {
			return "Chat";
		}
		if (req.path.includes("/chat/completions")) {
			return "Chat";
		}
		if (
			req.path.includes(":generateContent") ||
			req.path.includes(":streamGenerateContent")
		) {
			return "Generate";
		}
		if (req.path.includes("/completions")) {
			return "Complete";
		}
		return "API";
	};

	// Format duration
	const formatDuration = (ms?: number) => {
		if (!ms || ms === 0) return null;
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	};

	return (
		<div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
			<div class="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-700">
				<span class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
					Recent Activity
				</span>
				<button
					onClick={props.onViewAll}
					class="text-xs text-brand-500 hover:text-brand-600 font-medium"
				>
					View all →
				</button>
			</div>
			<Show
				when={recent().length > 0}
				fallback={
					<div class="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
						No requests yet
					</div>
				}
			>
				<div class="divide-y divide-gray-100 dark:divide-gray-700">
					<For each={recent()}>
						{(req) => {
							const tokens = formatTokens(
								(req.tokensIn || 0) + (req.tokensOut || 0),
							);
							const duration = formatDuration(req.durationMs);
							return (
								<div class="px-4 py-2 flex items-center gap-2 text-xs">
									<span class="text-gray-400 dark:text-gray-500 tabular-nums w-12 flex-shrink-0">
										{formatTime(req.timestamp)}
									</span>
									<span
										class={`w-8 text-center px-1 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${req.status < 400 ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"}`}
									>
										{req.status}
									</span>
									<span
										class={`px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${getProviderColor(req.provider)}`}
									>
										{formatProvider(req.provider)}
									</span>
									<span class="text-gray-500 dark:text-gray-400 flex-shrink-0">
										{formatEndpoint(req)}
									</span>
									<span class="flex-1" />
									<Show when={duration}>
										<span class="text-gray-400 dark:text-gray-500 tabular-nums flex-shrink-0">
											{duration}
										</span>
									</Show>
									<Show when={tokens}>
										<span class="text-gray-400 dark:text-gray-500 tabular-nums flex-shrink-0">
											{tokens}
										</span>
									</Show>
								</div>
							);
						}}
					</For>
				</div>
			</Show>
		</div>
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
	const [agents, setAgents] = createSignal<AgentStatus[]>([]);
	const [configuringAgent, setConfiguringAgent] = createSignal<string | null>(
		null,
	);
	const [testingAgent, setTestingAgent] = createSignal<string | null>(null);
	const [refreshingAgents, setRefreshingAgents] = createSignal(false);
	const [configResult, setConfigResult] = createSignal<{
		result: AgentConfigResult;
		agentName: string;
		models?: AvailableModel[];
	} | null>(null);
	// No dismiss state - onboarding stays until setup complete
	const [history, setHistory] = createSignal<RequestHistory>({
		requests: [],
		totalTokensIn: 0,
		totalTokensOut: 0,
		totalCostUsd: 0,
	});
	const [stats, setStats] = createSignal<UsageStats | null>(null);
	const [models, setModels] = createSignal<AvailableModel[]>([]);

	// Copilot config handler
	const handleCopilotConfigChange = (copilotConfig: CopilotConfig) => {
		setConfig({ ...config(), copilot: copilotConfig });
	};

	// Load data on mount
	const loadAgents = async () => {
		if (refreshingAgents()) return; // Prevent multiple simultaneous refreshes
		setRefreshingAgents(true);
		try {
			const detected = await detectCliAgents();
			setAgents(detected);
			setHasConfiguredAgent(detected.some((a) => a.configured));
		} catch (err) {
			console.error("Failed to load agents:", err);
			toastStore.error("Failed to refresh agents", String(err));
		} finally {
			setRefreshingAgents(false);
		}
	};

	onMount(async () => {
		// Load agents - handle independently to avoid one failure blocking others
		try {
			const agentList = await detectCliAgents();
			console.log("Detected CLI agents:", agentList);
			setAgents(agentList);
			setHasConfiguredAgent(agentList.some((a) => a.configured));
		} catch (err) {
			console.error("Failed to detect CLI agents:", err);
		}

		// Load history
		try {
			const hist = await getRequestHistory();
			setHistory(hist);

			// Sync real token data from proxy if running
			if (appStore.proxyStatus().running) {
				try {
					const synced = await syncUsageFromProxy();
					setHistory(synced);
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

		// Load available models if proxy is running
		if (appStore.proxyStatus().running) {
			try {
				const availableModels = await getAvailableModels();
				setModels(availableModels);
			} catch (err) {
				console.error("Failed to load available models:", err);
			}
		}

		// Listen for new requests and refresh data
		const unlisten = await onRequestLog(async () => {
			// Debounce: wait 1 second after request to allow backend to process
			setTimeout(async () => {
				try {
					const hist = await getRequestHistory();
					setHistory(hist);

					// Also sync from proxy if running
					if (appStore.proxyStatus().running) {
						const synced = await syncUsageFromProxy();
						setHistory(synced);
					}

					// Refresh stats
					const usage = await getUsageStats();
					setStats(usage);
				} catch (err) {
					console.error("Failed to refresh after new request:", err);
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

		setConnecting(provider);
		toastStore.info(
			`Connecting to ${provider}...`,
			"Complete authentication in your browser",
		);

		try {
			const oauthState = await openOAuth(provider);
			let attempts = 0;
			const maxAttempts = 120;
			const pollInterval = setInterval(async () => {
				attempts++;
				try {
					const completed = await pollOAuthStatus(oauthState);
					if (completed) {
						clearInterval(pollInterval);
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
							`${provider} connected!`,
							"You can now use this provider",
						);
					} else if (attempts >= maxAttempts) {
						clearInterval(pollInterval);
						setConnecting(null);
						toastStore.error("Connection timeout", "Please try again");
					}
				} catch (err) {
					console.error("Poll error:", err);
				}
			}, 1000);
			onCleanup(() => clearInterval(pollInterval));
		} catch (error) {
			console.error("Failed to start OAuth:", error);
			setConnecting(null);
			toastStore.error("Connection failed", String(error));
		}
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

	// Agent handlers
	const configuredAgents = () => agents().filter((a) => a.configured);

	// Simple timeout helper so UI never hangs indefinitely
	const withTimeout = async <T,>(
		promise: Promise<T>,
		ms: number,
		label: string,
	): Promise<T> => {
		return Promise.race([
			promise,
			new Promise<T>((_, reject) =>
				setTimeout(
					() => reject(new Error(`${label} timed out after ${ms}ms`)),
					ms,
				),
			),
		]);
	};

	const handleConfigureAgent = async (agentId: string) => {
		// Agents that need models from the proxy (they configure with available model list)
		// claude-code also benefits from showing available models in the success modal
		const agentsNeedingModels = ["factory-droid", "opencode", "claude-code"];
		const needsModels = agentsNeedingModels.includes(agentId);

		if (needsModels && !proxyStatus().running) {
			toastStore.warning(
				"Start the proxy first",
				"The proxy must be running to configure this agent",
			);
			return;
		}
		setConfiguringAgent(agentId);
		try {
			// Fetch available models only for agents that need them
			let models: AvailableModel[] = [];
			if (needsModels) {
				models = await withTimeout(
					getAvailableModels(),
					15000,
					"Fetching available models",
				);
				if (models.length === 0) {
					toastStore.warning(
						"No models available",
						"Connect at least one provider to configure agents",
					);
					return;
				}
			}
			const result = await withTimeout(
				configureCliAgent(agentId, models),
				15000,
				"Configuring agent",
			);
			const agent = agents().find((a) => a.id === agentId);
			if (result.success) {
				setConfigResult({
					result,
					agentName: agent?.name || agentId,
					models, // Store models for display in modal
				});
				await withTimeout(loadAgents(), 15000, "Refreshing agents");
				toastStore.success(`${agent?.name || agentId} configured!`);
			}
		} catch (error) {
			console.error("Failed to configure agent:", error);
			toastStore.error("Configuration failed", String(error));
		} finally {
			setConfiguringAgent(null);
		}
	};

	const handleTestAgent = async (agentId: string) => {
		if (!proxyStatus().running) {
			toastStore.warning(
				"Start the proxy first",
				"The proxy must be running to test connections",
			);
			return;
		}
		const agent = agents().find((a) => a.id === agentId);
		setTestingAgent(agentId);
		try {
			const result = await testAgentConnection(agentId);
			if (result.success) {
				const latencyText = result.latencyMs ? ` (${result.latencyMs}ms)` : "";
				toastStore.success(
					`${agent?.name || agentId} connected!`,
					`Connection successful${latencyText}`,
				);
			} else {
				toastStore.error(`${agent?.name || agentId} failed`, result.message);
			}
		} catch (error) {
			console.error("Failed to test agent:", error);
			toastStore.error("Test failed", String(error));
		} finally {
			setTestingAgent(null);
		}
	};

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
	const formatCost = (n: number) => (n < 0.01 ? "$0.00" : `$${n.toFixed(2)}`);
	const formatTokens = (n: number) => {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
		return n.toString();
	};
	const successRate = () => {
		const s = stats();
		if (!s || s.totalRequests === 0) {
			// Fallback to history if stats unavailable
			const total = history().requests.length;
			if (total === 0) return 100;
			const successes = history().requests.filter((r) => r.status < 400).length;
			return Math.round((successes / total) * 100);
		}
		return Math.round((s.successCount / s.totalRequests) * 100);
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
		<div class="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
			{/* Header */}
			<header class="sticky top-0 z-10 px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
				<div class="flex items-center justify-between max-w-3xl mx-auto">
					<div class="flex items-center gap-2 sm:gap-3">
						<img
							src={
								themeStore.resolvedTheme() === "dark"
									? "/proxypal-white.png"
									: "/proxypal-black.png"
							}
							alt="ProxyPal Logo"
							class="w-8 h-8 sm:w-10 sm:h-10 rounded-xl object-contain"
						/>
						<div>
							<h1 class="font-bold text-base sm:text-lg text-gray-900 dark:text-gray-100">
								ProxyPal
							</h1>
							<p class="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">
								AI Proxy Manager
							</p>
						</div>
					</div>
					<div class="flex items-center gap-2 sm:gap-3">
						<button
							onClick={openCommandPalette}
							class="hidden sm:flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-700 transition-colors"
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
						<ThemeToggleCompact />
						<StatusIndicator
							running={proxyStatus().running}
							onToggle={toggleProxy}
							disabled={toggling()}
						/>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setCurrentPage("analytics")}
							title="Analytics"
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
									d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
								/>
							</svg>
						</Button>
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
									d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
								/>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
								/>
							</svg>
						</Button>
					</div>
				</div>
			</header>

			{/* Main content */}
			<main class="flex-1 p-4 sm:p-6 overflow-y-auto">
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

					{/* === ZONE 2: Value Snapshot (KPIs) === */}
					<Show
						when={
							history().requests.length > 0 ||
							(stats() && stats()!.totalRequests > 0)
						}
					>
						<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
							<KpiTile
								label="Saved"
								value={formatCost(history().totalCostUsd)}
								subtext="estimated"
								icon="dollar"
								color="green"
								onClick={() => setCurrentPage("analytics")}
							/>
							<KpiTile
								label="Requests"
								value={formatTokens(history().requests.length)}
								subtext={`${stats()?.requestsToday || 0} today`}
								icon="requests"
								color="blue"
								onClick={() => setCurrentPage("analytics")}
							/>
							<KpiTile
								label="Tokens"
								value={formatTokens(
									(history().totalTokensIn || 0) +
										(history().totalTokensOut || 0),
								)}
								subtext="total"
								icon="tokens"
								color="purple"
								onClick={() => setCurrentPage("analytics")}
							/>
							<KpiTile
								label="Success"
								value={`${successRate()}%`}
								subtext={`${stats()?.failureCount || 0} failed`}
								icon="success"
								color="emerald"
								onClick={() => setCurrentPage("logs")}
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

					{/* === ZONE 3.5: GitHub Copilot === */}
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

					{/* === ZONE 5: Mini Request Feed === */}
					<MiniRequestFeed
						requests={history().requests}
						onViewAll={() => setCurrentPage("logs")}
					/>

					{/* === ZONE 5.5: Available Models === */}
					<ModelsWidget models={models()} loading={!proxyStatus().running} />

					{/* === ZONE 6: CLI Agents (always full detail) === */}
					<div class="space-y-3">
						<div class="flex items-center justify-between">
							<div>
								<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
									CLI Agents
								</h2>
								<p class="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
									{configuredAgents().length} of {agents().length} configured
								</p>
							</div>
							<button
								onClick={loadAgents}
								disabled={refreshingAgents()}
								class="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
								title="Refresh"
							>
								<svg
									class={`w-4 h-4 ${refreshingAgents() ? "animate-spin" : ""}`}
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
						</div>

						<Show when={!proxyStatus().running}>
							<div class="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
								<div class="flex items-center gap-2 text-amber-700 dark:text-amber-300">
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
											d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
										/>
									</svg>
									<span class="text-sm">
										Start the proxy to configure agents
									</span>
								</div>
							</div>
						</Show>

						<Show when={agents().length > 0}>
							<div class="space-y-3">
								<For each={agents()}>
									{(agent) => (
										<div class="p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-brand-500 dark:hover:border-brand-500 transition-all">
											<div class="flex items-start gap-3">
												<img
													src={agent.logo}
													alt={agent.name}
													class="w-10 h-10 rounded-lg"
													onError={(e) => {
														(e.target as HTMLImageElement).src =
															"/logos/openai.svg";
													}}
												/>
												<div class="flex-1 min-w-0">
													<div class="flex items-center gap-2">
														<h3 class="font-semibold text-gray-900 dark:text-gray-100">
															{agent.name}
														</h3>
														<div class="flex items-center gap-1.5">
															<div
																class={`w-2 h-2 rounded-full ${agent.configured ? "bg-green-500" : agent.installed ? "bg-amber-500" : "bg-gray-400"}`}
															/>
															<span class="text-xs text-gray-500 dark:text-gray-400">
																{agent.configured
																	? "Configured"
																	: agent.installed
																		? "Installed"
																		: "Not installed"}
															</span>
														</div>
													</div>
													<p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
														{agent.description}
													</p>
													<div class="flex items-center gap-2 mt-3">
														<Show when={!agent.installed}>
															<a
																href={agent.docsUrl}
																target="_blank"
																rel="noopener noreferrer"
																class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 hover:bg-brand-100 dark:hover:bg-brand-900/30 rounded-lg transition-colors"
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
																		d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
																	/>
																</svg>
																Install
															</a>
														</Show>
														<Show when={agent.installed && !agent.configured}>
															<Button
																size="sm"
																variant="primary"
																onClick={() => handleConfigureAgent(agent.id)}
																disabled={configuringAgent() === agent.id}
															>
																{configuringAgent() === agent.id ? (
																	<span class="flex items-center gap-1.5">
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
																		Configuring...
																	</span>
																) : (
																	"Configure"
																)}
															</Button>
														</Show>
														<Show when={agent.configured}>
															<span class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/30 rounded-full">
																<svg
																	class="w-3 h-3"
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
																Ready
															</span>
															<Button
																size="sm"
																variant="ghost"
																onClick={() => handleConfigureAgent(agent.id)}
																disabled={configuringAgent() === agent.id}
																title="Update configuration with latest models"
															>
																{configuringAgent() === agent.id ? (
																	<svg
																		class="w-3.5 h-3.5 animate-spin"
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
																		class="w-3.5 h-3.5"
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
																)}
															</Button>
															<Button
																size="sm"
																variant="secondary"
																onClick={() => handleTestAgent(agent.id)}
																disabled={testingAgent() === agent.id}
															>
																{testingAgent() === agent.id ? (
																	<span class="flex items-center gap-1.5">
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
																		Testing...
																	</span>
																) : (
																	<span class="flex items-center gap-1.5">
																		<svg
																			class="w-3 h-3"
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
																		Test
																	</span>
																)}
															</Button>
														</Show>
														<a
															href={agent.docsUrl}
															target="_blank"
															rel="noopener noreferrer"
															class="text-xs text-gray-400 hover:text-brand-500 transition-colors"
														>
															Docs
														</a>
													</div>
												</div>
											</div>
										</div>
									)}
								</For>
							</div>
						</Show>
					</div>

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

										<div class="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
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
		</div>
	);
}

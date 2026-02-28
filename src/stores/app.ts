import { createRoot, createSignal, onCleanup } from "solid-js";
import {
	detectSystemLocale,
	normalizeLocale,
	resolveInitialLocale,
} from "../i18n/locale";
import type {
	AppConfig,
	AuthStatus,
	CloudflareStatusUpdate,
	OAuthCallback,
	ProxyStatus,
	SshStatusUpdate,
} from "../lib/tauri";
import {
	completeOAuth,
	getAuthStatus,
	getConfig,
	getProxyStatus,
	migrateAmpModelMappings,
	onAuthStatusChanged,
	onCloudflareStatusChanged,
	onOAuthCallback,
	onProxyStatusChanged,
	onSshStatusChanged,
	onTrayToggleProxy,
	refreshAuthStatus,
	saveConfig,
	showSystemNotification,
	startProxy,
	stopProxy,
	syncUsageFromProxy,
} from "../lib/tauri";

const STARTUP_TIMEOUT_MS = 15000;

type StartupState = "loading" | "ready" | "error";

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	if (typeof error === "string") {
		return error;
	}

	return "Unknown startup error";
}

function withTimeout<T>(
	promise: Promise<T>,
	operation: string,
	timeoutMs = STARTUP_TIMEOUT_MS,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			reject(new Error(`Timed out while trying to ${operation}`));
		}, timeoutMs);

		void promise.then(
			(value) => {
				clearTimeout(timeoutId);
				resolve(value);
			},
			(error) => {
				clearTimeout(timeoutId);
				reject(error);
			},
		);
	});
}

function createAppStore() {
	// Proxy state
	const [proxyStatus, setProxyStatus] = createSignal<ProxyStatus>({
		running: false,
		port: 8317,
		endpoint: "http://localhost:8317/v1",
	});

	// Auth state
	const [authStatus, setAuthStatus] = createSignal<AuthStatus>({
		claude: 0,
		openai: 0,
		gemini: 0,
		qwen: 0,
		iflow: 0,
		vertex: 0,
		kiro: 0,
		antigravity: 0,
		kimi: 0,
	});

	// Config
	const [config, setConfig] = createSignal<AppConfig>({
		port: 8317,
		autoStart: true,
		launchAtLogin: false,
		debug: false,
		proxyUrl: "",
		requestRetry: 0,
		quotaSwitchProject: false,
		quotaSwitchPreviewModel: false,
		usageStatsEnabled: true,
		requestLogging: false,
		loggingToFile: false,
		logsMaxTotalSizeMb: 100,
		sidebarPinned: false,
		ampApiKey: "",
		ampModelMappings: [],
		ampOpenaiProvider: undefined,
		ampOpenaiProviders: [],
		ampRoutingMode: "mappings",
		routingStrategy: "round-robin",
		forceModelMappings: false,
		copilot: {
			enabled: false,
			port: 4141,
			accountType: "individual",
			githubToken: "",
			rateLimit: undefined,
			rateLimitWait: false,
		},
		sshConfigs: [],
		locale: "en",
	});

	// SSH Status
	const [sshStatus, setSshStatus] = createSignal<
		Record<string, SshStatusUpdate>
	>({});

	// Cloudflare Status
	const [cloudflareStatus, setCloudflareStatus] = createSignal<
		Record<string, CloudflareStatusUpdate>
	>({});

	// UI state - Start directly on dashboard
	const [currentPage, setCurrentPage] = createSignal<
		"dashboard" | "settings" | "api-keys" | "auth-files" | "logs" | "analytics"
	>("dashboard");
	const [isLoading, setIsLoading] = createSignal(false);
	const [isInitialized, setIsInitialized] = createSignal(false);
	const [startupState, setStartupState] = createSignal<StartupState>("loading");
	const [startupError, setStartupError] = createSignal<string | null>(null);
	const [sidebarExpanded, setSidebarExpanded] = createSignal(false);
	const [settingsTab, setSettingsTab] = createSignal<string | null>(null);
	let unlistenEvents: (() => void) | null = null;

	// Proxy uptime tracking
	const [proxyStartTime, setProxyStartTime] = createSignal<number | null>(null);

	const clearEventListeners = () => {
		if (unlistenEvents) {
			unlistenEvents();
			unlistenEvents = null;
		}
	};

	onCleanup(() => {
		clearEventListeners();
	});

	// Helper to update proxy status and track uptime
	const updateProxyStatus = (status: ProxyStatus, showNotification = false) => {
		const wasRunning = proxyStatus().running;
		setProxyStatus(status);

		// Track start time when proxy starts
		if (status.running && !wasRunning) {
			setProxyStartTime(Date.now());
			if (showNotification) {
				showSystemNotification("ProxyPal", "Proxy server is now running");
			}
		} else if (!status.running && wasRunning) {
			setProxyStartTime(null);
			if (showNotification) {
				showSystemNotification("ProxyPal", "Proxy server has stopped");
			}
		}
	};

	// Initialize from backend
	const initialize = async () => {
		if (isLoading()) {
			return;
		}

		const pendingUnlisteners: Array<() => void> = [];

		try {
			setIsLoading(true);
			setIsInitialized(false);
			setStartupState("loading");
			setStartupError(null);

			// Load initial state from backend
			const [proxyState, configState] = await Promise.all([
				withTimeout(getProxyStatus(), "load proxy status"),
				withTimeout(getConfig(), "load app config"),
			]);

			updateProxyStatus(proxyState);

			let nextConfig: AppConfig = { ...configState };
			let shouldSave = false;

			const systemLocale = await detectSystemLocale();
			const resolvedLocale = resolveInitialLocale(
				configState.locale,
				systemLocale,
			);
			if (nextConfig.locale !== resolvedLocale) {
				nextConfig = { ...nextConfig, locale: resolvedLocale };
				shouldSave = true;
			}

			// Auto-migrate amp model mappings when slot models change across versions
			if (nextConfig.ampModelMappings?.length) {
				const result = migrateAmpModelMappings(nextConfig.ampModelMappings);
				if (result.migrated) {
					nextConfig = {
						...nextConfig,
						ampModelMappings: result.mappings,
					};
					shouldSave = true;
					console.log(
						"[ProxyPal] Auto-migrated amp model mappings to new slot models",
					);
				}
			}

			setConfig(nextConfig);
			if (shouldSave) {
				await saveConfig(nextConfig);
			}

			// Refresh auth status from CLIProxyAPI's auth directory
			try {
				const authState = await withTimeout(
					refreshAuthStatus(),
					"refresh authentication status",
				);
				setAuthStatus(authState);
			} catch (error) {
				console.warn(
					"Failed to refresh auth status, falling back to saved state",
					error,
				);
				const authState = await withTimeout(
					getAuthStatus(),
					"load saved authentication status",
				);
				setAuthStatus(authState);
			}

			// Setup event listeners
			const unlistenProxy = await withTimeout(
				onProxyStatusChanged((status) => {
					updateProxyStatus(status);
				}),
				"register proxy status listener",
			);
			pendingUnlisteners.push(unlistenProxy);

			const unlistenAuth = await withTimeout(
				onAuthStatusChanged((status) => {
					setAuthStatus(status);
				}),
				"register auth status listener",
			);
			pendingUnlisteners.push(unlistenAuth);

			const unlistenOAuth = await withTimeout(
				onOAuthCallback(async (data: OAuthCallback) => {
					try {
						const newAuthStatus = await completeOAuth(data.provider, data.code);
						setAuthStatus(newAuthStatus);
						setCurrentPage("dashboard");
					} catch (error) {
						console.error("Failed to complete OAuth:", error);
					}
				}),
				"register OAuth callback listener",
			);
			pendingUnlisteners.push(unlistenOAuth);

			const unlistenTray = await withTimeout(
				onTrayToggleProxy(async (shouldStart) => {
					try {
						if (shouldStart) {
							const status = await startProxy();
							updateProxyStatus(status, true);
						} else {
							const status = await stopProxy();
							updateProxyStatus(status, true);
						}
					} catch (error) {
						console.error("Failed to toggle proxy:", error);
					}
				}),
				"register tray toggle listener",
			);
			pendingUnlisteners.push(unlistenTray);

			const unlistenSsh = await withTimeout(
				onSshStatusChanged((status) => {
					setSshStatus((prev) => ({ ...prev, [status.id]: status }));
				}),
				"register SSH status listener",
			);
			pendingUnlisteners.push(unlistenSsh);

			const unlistenCf = await withTimeout(
				onCloudflareStatusChanged((status) => {
					setCloudflareStatus((prev) => ({ ...prev, [status.id]: status }));
				}),
				"register Cloudflare status listener",
			);
			pendingUnlisteners.push(unlistenCf);

			clearEventListeners();
			unlistenEvents = () => {
				for (const unlisten of pendingUnlisteners) {
					unlisten();
				}
			};

			// Auto-start proxy if configured
			if (nextConfig.autoStart) {
				try {
					const status = await withTimeout(startProxy(), "auto-start proxy", 30000);
					updateProxyStatus(status);
				} catch (error) {
					console.error("Failed to auto-start proxy:", error);
				}
			}

			// Sync usage data from CLIProxyAPI on startup
			try {
				await withTimeout(syncUsageFromProxy(), "sync usage on startup", 20000);
			} catch (error) {
				console.error("Failed to sync usage on startup:", error);
			}

			setIsInitialized(true);
			setStartupState("ready");
		} catch (error) {
			for (const unlisten of pendingUnlisteners) {
				try {
					unlisten();
				} catch (unlistenError) {
					console.error("Failed to remove startup listener:", unlistenError);
				}
			}

			const message = toErrorMessage(error);
			setStartupError(message);
			setStartupState("error");
			setIsInitialized(false);
			console.error("Failed to initialize app:", error);
		} finally {
			setIsLoading(false);
		}
	};

	const retryInitialize = async () => {
		await initialize();
	};

	const setLocale = (locale: string) => {
		const normalized = normalizeLocale(locale);
		const newConfig = { ...config(), locale: normalized };
		setConfig(newConfig);
		void saveConfig(newConfig).catch((error) => {
			console.error("Failed to save locale:", error);
		});
	};

	return {
		// Proxy
		proxyStatus,
		setProxyStatus: updateProxyStatus,
		proxyStartTime,

		// Auth
		authStatus,
		setAuthStatus,

		// Config
		config,
		setConfig,
		setLocale,

		// SSH
		sshStatus,
		cloudflareStatus,

		// UI
		currentPage,
		setCurrentPage,
		settingsTab,
		setSettingsTab,
		isLoading,
		setIsLoading,
		isInitialized,
		startupState,
		startupError,
		sidebarExpanded,
		setSidebarExpanded,

		// Actions
		initialize,
		retryInitialize,
	};
}

export const appStore = createRoot(createAppStore);

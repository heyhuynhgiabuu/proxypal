import { createRoot, createSignal, onCleanup } from "solid-js";
import type {
	AppConfig,
	AuthStatus,
	OAuthCallback,
	ProxyStatus,
} from "../lib/tauri";
import {
	completeOAuth,
	getAuthStatus,
	getConfig,
	getProxyStatus,
	onAuthStatusChanged,
	onOAuthCallback,
	onProxyStatusChanged,
	onTrayToggleProxy,
	refreshAuthStatus,
	showSystemNotification,
	startProxy,
	stopProxy,
} from "../lib/tauri";

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
		antigravity: 0,
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
		quotaViewMode: "chart",
		quotaSelectedAccounts: [],
		quotaSelectedModels: [],
		quotaFiltersExpanded: false,
	});

	// UI state
	const [currentPage, setCurrentPage] = createSignal<
		| "welcome"
		| "dashboard"
		| "settings"
		| "api-keys"
		| "auth-files"
		| "logs"
		| "analytics"
	>("welcome");
	const [isLoading, setIsLoading] = createSignal(false);
	const [isInitialized, setIsInitialized] = createSignal(false);
	const [sidebarExpanded, setSidebarExpanded] = createSignal(false);

	// Proxy uptime tracking
	const [proxyStartTime, setProxyStartTime] = createSignal<number | null>(null);

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
		try {
			setIsLoading(true);

			// Load initial state from backend
			const [proxyState, configState] = await Promise.all([
				getProxyStatus(),
				getConfig(),
			]);

			updateProxyStatus(proxyState);
			setConfig(configState);

			// Refresh auth status from CLIProxyAPI's auth directory
			try {
				const authState = await refreshAuthStatus();
				setAuthStatus(authState);

				// Determine initial page based on auth status
				const hasAnyAuth =
					authState.claude ||
					authState.openai ||
					authState.gemini ||
					authState.qwen ||
					authState.iflow ||
					authState.vertex ||
					authState.antigravity;
				if (hasAnyAuth) {
					setCurrentPage("dashboard");
				}
			} catch {
				// Fall back to saved auth status
				const authState = await getAuthStatus();
				setAuthStatus(authState);

				const hasAnyAuth =
					authState.claude ||
					authState.openai ||
					authState.gemini ||
					authState.qwen ||
					authState.iflow ||
					authState.vertex ||
					authState.antigravity;
				if (hasAnyAuth) {
					setCurrentPage("dashboard");
				}
			}

			// Setup event listeners
			const unlistenProxy = await onProxyStatusChanged((status) => {
				updateProxyStatus(status);
			});

			const unlistenAuth = await onAuthStatusChanged((status) => {
				setAuthStatus(status);
			});

			const unlistenOAuth = await onOAuthCallback(
				async (data: OAuthCallback) => {
					// Complete the OAuth flow
					try {
						const newAuthStatus = await completeOAuth(data.provider, data.code);
						setAuthStatus(newAuthStatus);
						// Navigate to dashboard after successful auth
						setCurrentPage("dashboard");
					} catch (error) {
						console.error("Failed to complete OAuth:", error);
					}
				},
			);

			const unlistenTray = await onTrayToggleProxy(async (shouldStart) => {
				try {
					if (shouldStart) {
						const status = await startProxy();
						updateProxyStatus(status, true); // Show notification
					} else {
						const status = await stopProxy();
						updateProxyStatus(status, true); // Show notification
					}
				} catch (error) {
					console.error("Failed to toggle proxy:", error);
				}
			});

			// Auto-start proxy if configured
			if (configState.autoStart) {
				try {
					const status = await startProxy();
					updateProxyStatus(status);
				} catch (error) {
					console.error("Failed to auto-start proxy:", error);
				}
			}

			setIsInitialized(true);

			// Cleanup on unmount
			onCleanup(() => {
				unlistenProxy();
				unlistenAuth();
				unlistenOAuth();
				unlistenTray();
			});
		} catch (error) {
			console.error("Failed to initialize app:", error);
		} finally {
			setIsLoading(false);
		}
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

		// UI
		currentPage,
		setCurrentPage,
		isLoading,
		setIsLoading,
		isInitialized,
		sidebarExpanded,
		setSidebarExpanded,

		// Actions
		initialize,
	};
}

export const appStore = createRoot(createAppStore);

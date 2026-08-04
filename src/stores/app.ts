import { createRoot, createSignal, onCleanup } from "solid-js";
import { detectSystemLocale, normalizeLocale, resolveInitialLocale } from "../i18n/locale";
import {
  getAuthStatus,
  getConfig,
  getProxyStatus,
  onAuthStatusChanged,
  onCloudflareStatusChanged,
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

import type {
  AppConfig,
  AuthStatus,
  CloudflareStatusUpdate,
  ProxyStatus,
  SshStatusUpdate,
} from "../lib/tauri";

function createAppStore() {
  // Proxy state
  const [proxyStatus, setProxyStatus] = createSignal<ProxyStatus>({
    endpoint: "http://localhost:8317/v1",
    port: 8317,
    running: false,
  });

  // Auth state
  const [authStatus, setAuthStatus] = createSignal<AuthStatus>({
    antigravity: 0,
    claude: 0,
    gemini: 0,
    iflow: 0,
    kimi: 0,
    kiro: 0,
    openai: 0,
    qwen: 0,
    vertex: 0,
  });

  // Config
  const [config, setConfig] = createSignal<AppConfig>({
    autoStart: true,
    copilot: {
      accountType: "individual",
      enabled: false,
      githubToken: "",
      port: 4141,
      rateLimit: undefined,
      rateLimitWait: false,
    },
    debug: false,
    launchAtLogin: false,
    locale: "en",
    loggingToFile: false,
    logsMaxTotalSizeMb: 100,
    openaiCompatibleProviders: [],
    port: 8317,
    proxyUrl: "",
    quotaSwitchPreviewModel: false,
    quotaSwitchProject: false,
    requestLogging: false,
    requestRetry: 0,
    routingStrategy: "round-robin",
    sidebarPinned: false,
    sshConfigs: [],
    usageStatsEnabled: true,
  });

  // SSH Status
  const [sshStatus, setSshStatus] = createSignal<Record<string, SshStatusUpdate>>({});

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
  const [sidebarExpanded, setSidebarExpanded] = createSignal(false);
  const [settingsTab, setSettingsTab] = createSignal<string | null>(null);

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
      const [proxyState, configState] = await Promise.all([getProxyStatus(), getConfig()]);

      updateProxyStatus(proxyState);

      let nextConfig: AppConfig = { ...configState };
      let shouldSave = false;

      const systemLocale = await detectSystemLocale();
      const resolvedLocale = resolveInitialLocale(configState.locale, systemLocale);
      if (nextConfig.locale !== resolvedLocale) {
        nextConfig = { ...nextConfig, locale: resolvedLocale };
        shouldSave = true;
      }

      setConfig(nextConfig);
      if (shouldSave) {
        await saveConfig(nextConfig);
      }

      // Refresh auth status from CLIProxyAPI's auth directory
      try {
        const authState = await refreshAuthStatus();
        setAuthStatus(authState);
      } catch {
        // Fall back to saved auth status
        const authState = await getAuthStatus();
        setAuthStatus(authState);
      }

      // Setup event listeners
      const unlistenProxy = await onProxyStatusChanged((status) => {
        updateProxyStatus(status);
      });

      const unlistenAuth = await onAuthStatusChanged((status) => {
        setAuthStatus(status);
      });

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

      const unlistenSsh = await onSshStatusChanged((status) => {
        setSshStatus((prev) => ({ ...prev, [status.id]: status }));
      });

      const unlistenCf = await onCloudflareStatusChanged((status) => {
        setCloudflareStatus((prev) => ({ ...prev, [status.id]: status }));
      });

      onCleanup(() => {
        unlistenSsh();
        unlistenCf();
      });

      // Auto-start proxy if configured
      if (nextConfig.autoStart) {
        try {
          const status = await startProxy();
          updateProxyStatus(status);
        } catch (error) {
          console.error("Failed to auto-start proxy:", error);
        }
      }

      // Sync usage data from CLIProxyAPI on startup
      try {
        await syncUsageFromProxy();
      } catch (error) {
        console.error("Failed to sync usage on startup:", error);
      }

      // Cleanup on unmount
      onCleanup(() => {
        unlistenProxy();
        unlistenAuth();
        unlistenTray();
        unlistenSsh();
      });
    } catch (error) {
      console.error("Failed to initialize app:", error);
    } finally {
      // Always mark initialized so the loading screen clears, even on error
      setIsInitialized(true);
      setIsLoading(false);
    }
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
    proxyStartTime,
    proxyStatus,
    setProxyStatus: updateProxyStatus,

    // Auth
    authStatus,
    setAuthStatus,

    // Config
    config,
    setConfig,
    setLocale,

    // SSH
    cloudflareStatus,
    sshStatus,

    // UI
    currentPage,
    isInitialized,
    isLoading,
    setCurrentPage,
    setIsLoading,
    setSettingsTab,
    setSidebarExpanded,
    settingsTab,
    sidebarExpanded,

    // Actions
    initialize,
  };
}

export const appStore = createRoot(createAppStore);

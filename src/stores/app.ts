import { createSignal, createRoot, onCleanup } from "solid-js";
import type {
  ProxyStatus,
  AuthStatus,
  AppConfig,
  OAuthCallback,
} from "../lib/tauri";
import {
  getProxyStatus,
  getAuthStatus,
  refreshAuthStatus,
  getConfig,
  startProxy,
  stopProxy,
  completeOAuth,
  onProxyStatusChanged,
  onAuthStatusChanged,
  onOAuthCallback,
  onTrayToggleProxy,
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
    claude: false,
    openai: false,
    gemini: false,
    qwen: false,
  });

  // Config
  const [config, setConfig] = createSignal<AppConfig>({
    port: 8317,
    autoStart: true,
    launchAtLogin: false,
  });

  // UI state
  const [currentPage, setCurrentPage] = createSignal<
    "welcome" | "dashboard" | "settings"
  >("welcome");
  const [isLoading, setIsLoading] = createSignal(false);
  const [isInitialized, setIsInitialized] = createSignal(false);

  // Initialize from backend
  const initialize = async () => {
    try {
      setIsLoading(true);

      // Load initial state from backend
      const [proxyState, configState] = await Promise.all([
        getProxyStatus(),
        getConfig(),
      ]);

      setProxyStatus(proxyState);
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
          authState.qwen;
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
          authState.qwen;
        if (hasAnyAuth) {
          setCurrentPage("dashboard");
        }
      }

      // Setup event listeners
      const unlistenProxy = await onProxyStatusChanged((status) => {
        setProxyStatus(status);
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
            setProxyStatus(status);
          } else {
            const status = await stopProxy();
            setProxyStatus(status);
          }
        } catch (error) {
          console.error("Failed to toggle proxy:", error);
        }
      });

      // Auto-start proxy if configured
      if (configState.autoStart) {
        try {
          const status = await startProxy();
          setProxyStatus(status);
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
    setProxyStatus,

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

    // Actions
    initialize,
  };
}

export const appStore = createRoot(createAppStore);

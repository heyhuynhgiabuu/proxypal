import { createSignal, onCleanup } from "solid-js";
import { Button } from "../components/ui";
import { StatusIndicator } from "../components/StatusIndicator";
import { ApiEndpoint } from "../components/ApiEndpoint";
import { SetupModal } from "../components/SetupModal";
import { appStore } from "../stores/app";
import { toastStore } from "../stores/toast";
import {
  startProxy,
  stopProxy,
  openOAuth,
  pollOAuthStatus,
  disconnectProvider,
  refreshAuthStatus,
  type Provider,
} from "../lib/tauri";

type SetupTool = "cursor" | "cline" | "continue" | null;

const providers = [
  { name: "Claude", provider: "claude" as Provider, logo: "/logos/claude.svg" },
  {
    name: "ChatGPT",
    provider: "openai" as Provider,
    logo: "/logos/openai.svg",
  },
  { name: "Gemini", provider: "gemini" as Provider, logo: "/logos/gemini.svg" },
  { name: "Qwen", provider: "qwen" as Provider, logo: "/logos/qwen.png" },
];

const setupTools = [
  { id: "cursor" as const, name: "Cursor", logo: "/logos/cursor.svg" },
  { id: "cline" as const, name: "Cline", logo: "/logos/cline.svg" },
  { id: "continue" as const, name: "Continue", logo: "/logos/continue.svg" },
];

export function DashboardPage() {
  const {
    proxyStatus,
    setProxyStatus,
    authStatus,
    setAuthStatus,
    setCurrentPage,
  } = appStore;
  const [toggling, setToggling] = createSignal(false);
  const [connecting, setConnecting] = createSignal<Provider | null>(null);
  const [setupTool, setSetupTool] = createSignal<SetupTool>(null);

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
    // Need proxy running for OAuth
    if (!proxyStatus().running) {
      toastStore.warning(
        "Start proxy first",
        "The proxy must be running to connect accounts",
      );
      return;
    }

    setConnecting(provider);
    toastStore.info(
      `Connecting to ${provider}...`,
      "Complete authentication in your browser",
    );

    try {
      // Open OAuth flow and get state for polling
      const oauthState = await openOAuth(provider);

      // Poll for completion
      let attempts = 0;
      const maxAttempts = 120; // 2 minutes max
      const pollInterval = setInterval(async () => {
        attempts++;
        try {
          const completed = await pollOAuthStatus(oauthState);
          if (completed) {
            clearInterval(pollInterval);
            // Refresh auth status from CLIProxyAPI's auth directory
            const newAuth = await refreshAuthStatus();
            setAuthStatus(newAuth);
            setConnecting(null);
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

      // Cleanup on component unmount
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

  const connectedProviders = () => {
    const status = authStatus();
    return providers.filter((p) => status[p.provider]);
  };

  const disconnectedProviders = () => {
    const status = authStatus();
    return providers.filter((p) => !status[p.provider]);
  };

  return (
    <div class="min-h-screen flex flex-col">
      {/* Header */}
      <header class="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
              <span class="text-white text-xl">⚡</span>
            </div>
            <div>
              <h1 class="font-bold text-lg text-gray-900 dark:text-gray-100">
                ProxyPal
              </h1>
              <p class="text-xs text-gray-500 dark:text-gray-400">Dashboard</p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <StatusIndicator
              running={proxyStatus().running}
              onToggle={toggleProxy}
              disabled={toggling()}
            />
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
      <main class="flex-1 p-6 overflow-y-auto">
        <div class="max-w-3xl mx-auto space-y-6">
          {/* API Endpoint */}
          <ApiEndpoint
            endpoint={proxyStatus().endpoint}
            running={proxyStatus().running}
          />

          {/* Connected accounts */}
          {connectedProviders().length > 0 && (
            <div>
              <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-3">
                Connected Accounts
              </h2>
              <div class="grid grid-cols-2 gap-3">
                {connectedProviders().map((provider) => (
                  <div class="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 group">
                    <img
                      src={provider.logo}
                      alt={provider.name}
                      class="w-6 h-6 rounded"
                    />
                    <span class="font-medium text-green-800 dark:text-green-300">
                      {provider.name}
                    </span>
                    <div class="ml-auto flex items-center gap-2">
                      <svg
                        class="w-4 h-4 text-green-600"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fill-rule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clip-rule="evenodd"
                        />
                      </svg>
                      <button
                        class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
                        onClick={() => handleDisconnect(provider.provider)}
                        title="Disconnect"
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
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add more accounts */}
          {disconnectedProviders().length > 0 && (
            <div>
              <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-3">
                Add More Accounts
              </h2>
              {!proxyStatus().running && (
                <p class="text-sm text-amber-600 dark:text-amber-400 mb-2">
                  Start the proxy to connect accounts
                </p>
              )}
              <div class="grid grid-cols-2 gap-3">
                {disconnectedProviders().map((provider) => (
                  <button
                    class="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-brand-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => handleConnect(provider.provider)}
                    disabled={!proxyStatus().running || connecting() !== null}
                  >
                    <img
                      src={provider.logo}
                      alt={provider.name}
                      class="w-6 h-6 rounded"
                    />
                    <span class="font-medium text-gray-700 dark:text-gray-300">
                      {provider.name}
                    </span>
                    {connecting() === provider.provider ? (
                      <span class="ml-auto text-xs text-gray-500">
                        Connecting...
                      </span>
                    ) : (
                      <svg
                        class="w-4 h-4 ml-auto text-gray-400"
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
                ))}
              </div>
            </div>
          )}

          {/* Quick setup guides */}
          <div>
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-3">
              Quick Setup
            </h2>
            <div class="grid grid-cols-3 gap-3">
              {setupTools.map((tool) => (
                <button
                  class="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-brand-500 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-all text-center group"
                  onClick={() => setSetupTool(tool.id)}
                >
                  <img
                    src={tool.logo}
                    alt={tool.name}
                    class="w-8 h-8 mx-auto mb-2 rounded group-hover:scale-110 transition-transform"
                  />
                  <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {tool.name}
                  </span>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    View setup
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Setup Modal */}
      <SetupModal
        tool={setupTool()}
        endpoint={proxyStatus().endpoint}
        onClose={() => setSetupTool(null)}
      />
    </div>
  );
}

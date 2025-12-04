import { createSignal, For } from "solid-js";
import { Button, Switch } from "../components/ui";
import { appStore } from "../stores/app";
import { toastStore } from "../stores/toast";
import { saveConfig } from "../lib/tauri";

export function SettingsPage() {
  const { config, setConfig, setCurrentPage, authStatus } = appStore;
  const [saving, setSaving] = createSignal(false);
  const [newMappingFrom, setNewMappingFrom] = createSignal("");
  const [newMappingTo, setNewMappingTo] = createSignal("");

  const handleConfigChange = async (
    key: keyof ReturnType<typeof config>,
    value: boolean | number | string,
  ) => {
    const newConfig = { ...config(), [key]: value };
    setConfig(newConfig);

    // Auto-save config
    setSaving(true);
    try {
      await saveConfig(newConfig);
      toastStore.success("Settings saved");
    } catch (error) {
      console.error("Failed to save config:", error);
      toastStore.error("Failed to save settings", String(error));
    } finally {
      setSaving(false);
    }
  };

  const connectedCount = () => {
    const auth = authStatus();
    return [auth.claude, auth.openai, auth.gemini, auth.qwen].filter(Boolean)
      .length;
  };

  const addModelMapping = async () => {
    const from = newMappingFrom().trim();
    const to = newMappingTo().trim();
    if (!from || !to) {
      toastStore.error("Both 'from' and 'to' model names are required");
      return;
    }
    const currentMappings = config().ampModelMappings || [];
    const newConfig = {
      ...config(),
      ampModelMappings: [...currentMappings, { from, to }],
    };
    setConfig(newConfig);
    setNewMappingFrom("");
    setNewMappingTo("");

    setSaving(true);
    try {
      await saveConfig(newConfig);
      toastStore.success("Model mapping added");
    } catch (error) {
      console.error("Failed to save config:", error);
      toastStore.error("Failed to save settings", String(error));
    } finally {
      setSaving(false);
    }
  };

  const removeModelMapping = async (index: number) => {
    const currentMappings = config().ampModelMappings || [];
    const newMappings = currentMappings.filter((_, i) => i !== index);
    const newConfig = { ...config(), ampModelMappings: newMappings };
    setConfig(newConfig);

    setSaving(true);
    try {
      await saveConfig(newConfig);
      toastStore.success("Model mapping removed");
    } catch (error) {
      console.error("Failed to save config:", error);
      toastStore.error("Failed to save settings", String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="min-h-screen flex flex-col">
      {/* Header */}
      <header class="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-800">
        <div class="flex items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentPage("dashboard")}
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
            Settings
          </h1>
          {saving() && (
            <span class="text-xs text-gray-400 ml-2 flex items-center gap-1">
              <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
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
              Saving
            </span>
          )}
        </div>
      </header>

      {/* Main content */}
      <main class="flex-1 p-4 sm:p-6 overflow-y-auto">
        <div class="max-w-xl mx-auto space-y-4 sm:space-y-6 animate-stagger">
          {/* General settings */}
          <div class="space-y-4">
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              General
            </h2>

            <div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              <Switch
                label="Launch at login"
                description="Start ProxyPal automatically when you log in"
                checked={config().launchAtLogin}
                onChange={(checked) =>
                  handleConfigChange("launchAtLogin", checked)
                }
              />

              <div class="border-t border-gray-200 dark:border-gray-700" />

              <Switch
                label="Auto-start proxy"
                description="Start the proxy server when ProxyPal launches"
                checked={config().autoStart}
                onChange={(checked) => handleConfigChange("autoStart", checked)}
              />
            </div>
          </div>

          {/* Proxy settings */}
          <div class="space-y-4">
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Proxy Configuration
            </h2>

            <div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              <label class="block">
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Port
                </span>
                <input
                  type="number"
                  value={config().port}
                  onInput={(e) =>
                    handleConfigChange(
                      "port",
                      parseInt(e.currentTarget.value) || 8317,
                    )
                  }
                  class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
                  min="1024"
                  max="65535"
                />
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  The port where the proxy server will listen (default: 8317)
                </p>
              </label>

              <div class="border-t border-gray-200 dark:border-gray-700" />

              <label class="block">
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Upstream Proxy URL
                </span>
                <input
                  type="text"
                  value={config().proxyUrl}
                  onInput={(e) =>
                    handleConfigChange("proxyUrl", e.currentTarget.value)
                  }
                  placeholder="socks5://127.0.0.1:1080"
                  class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
                />
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Optional SOCKS5/HTTP proxy for outbound requests (e.g.
                  socks5://host:port)
                </p>
              </label>

              <div class="border-t border-gray-200 dark:border-gray-700" />

              <label class="block">
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Request Retry Count
                </span>
                <input
                  type="number"
                  value={config().requestRetry}
                  onInput={(e) =>
                    handleConfigChange(
                      "requestRetry",
                      Math.max(
                        0,
                        Math.min(10, parseInt(e.currentTarget.value) || 0),
                      ),
                    )
                  }
                  class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
                  min="0"
                  max="10"
                />
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Number of retries on 403, 408, 500, 502, 503, 504 errors
                  (0-10)
                </p>
              </label>
            </div>
          </div>

          {/* Amp CLI Integration */}
          <div class="space-y-4">
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Amp CLI Integration
            </h2>

            <div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              <label class="block">
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Amp API Key
                </span>
                <input
                  type="password"
                  value={config().ampApiKey || ""}
                  onInput={(e) =>
                    handleConfigChange("ampApiKey", e.currentTarget.value)
                  }
                  placeholder="amp_..."
                  class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth font-mono"
                />
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Get your API key from{" "}
                  <a
                    href="https://ampcode.com/settings"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-brand-500 hover:text-brand-600 underline"
                  >
                    ampcode.com/settings
                  </a>
                  . Required for Amp CLI to authenticate through the proxy.
                </p>
              </label>

              <div class="border-t border-gray-200 dark:border-gray-700" />

              {/* Model Mappings */}
              <div class="space-y-3">
                <div>
                  <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Model Mappings
                  </span>
                  <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    Route Amp model requests to different available models
                    (useful when you don't have direct Claude access)
                  </p>
                </div>

                {/* Existing mappings */}
                <For each={config().ampModelMappings || []}>
                  {(mapping, index) => (
                    <div class="flex items-center gap-2 p-2 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                      <div class="flex-1 flex items-center gap-2 text-xs font-mono overflow-hidden">
                        <span
                          class="text-gray-500 dark:text-gray-400 truncate"
                          title={mapping.from}
                        >
                          {mapping.from}
                        </span>
                        <svg
                          class="w-4 h-4 text-gray-400 flex-shrink-0"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M13 7l5 5m0 0l-5 5m5-5H6"
                          />
                        </svg>
                        <span
                          class="text-gray-700 dark:text-gray-300 truncate"
                          title={mapping.to}
                        >
                          {mapping.to}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeModelMapping(index())}
                        class="p-1 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                        title="Remove mapping"
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
                  )}
                </For>

                {/* Add new mapping */}
                <div class="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={newMappingFrom()}
                    onInput={(e) => setNewMappingFrom(e.currentTarget.value)}
                    placeholder="From (e.g. claude-opus-4-5-20251101)"
                    class="flex-1 px-2 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
                  />
                  <input
                    type="text"
                    value={newMappingTo()}
                    onInput={(e) => setNewMappingTo(e.currentTarget.value)}
                    placeholder="To (e.g. gemini-2.0-flash)"
                    class="flex-1 px-2 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={addModelMapping}
                    disabled={
                      !newMappingFrom().trim() || !newMappingTo().trim()
                    }
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
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                  </Button>
                </div>
              </div>

              <p class="text-xs text-gray-400 dark:text-gray-500">
                After changing settings, restart the proxy for changes to take
                effect.
              </p>
            </div>
          </div>

          {/* Advanced Settings */}
          <div class="space-y-4">
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Advanced Settings
            </h2>

            <div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              <Switch
                label="Debug Mode"
                description="Enable verbose logging for troubleshooting"
                checked={config().debug}
                onChange={(checked) => handleConfigChange("debug", checked)}
              />

              <div class="border-t border-gray-200 dark:border-gray-700" />

              <Switch
                label="Usage Statistics"
                description="Track request counts and token usage"
                checked={config().usageStatsEnabled}
                onChange={(checked) =>
                  handleConfigChange("usageStatsEnabled", checked)
                }
              />

              <div class="border-t border-gray-200 dark:border-gray-700" />

              <Switch
                label="Request Logging"
                description="Log all API requests for debugging"
                checked={config().requestLogging}
                onChange={(checked) =>
                  handleConfigChange("requestLogging", checked)
                }
              />

              <div class="border-t border-gray-200 dark:border-gray-700" />

              <Switch
                label="Log to File"
                description="Write logs to rotating files instead of stdout"
                checked={config().loggingToFile}
                onChange={(checked) =>
                  handleConfigChange("loggingToFile", checked)
                }
              />
            </div>
          </div>

          {/* Quota Exceeded Behavior */}
          <div class="space-y-4">
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Quota Exceeded Behavior
            </h2>

            <div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              <Switch
                label="Auto-switch Project"
                description="Automatically switch to another project when quota is exceeded"
                checked={config().quotaSwitchProject}
                onChange={(checked) =>
                  handleConfigChange("quotaSwitchProject", checked)
                }
              />

              <div class="border-t border-gray-200 dark:border-gray-700" />

              <Switch
                label="Switch to Preview Model"
                description="Fall back to preview/beta models when quota is exceeded"
                checked={config().quotaSwitchPreviewModel}
                onChange={(checked) =>
                  handleConfigChange("quotaSwitchPreviewModel", checked)
                }
              />
            </div>
          </div>

          {/* Accounts */}
          <div class="space-y-4">
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Connected Accounts
            </h2>

            <div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {connectedCount()} of 4 providers connected
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Manage your AI provider connections
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage("dashboard")}
                >
                  <svg
                    class="w-4 h-4 mr-1.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                  Manage
                </Button>
              </div>
            </div>
          </div>

          {/* API Keys */}
          <div class="space-y-4">
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              API Keys
            </h2>

            <div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Manage API Keys
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Add Gemini, Claude, Codex, or OpenAI-compatible API keys
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage("api-keys")}
                >
                  <svg
                    class="w-4 h-4 mr-1.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                    />
                  </svg>
                  Configure
                </Button>
              </div>
            </div>
          </div>

          {/* Auth Files */}
          <div class="space-y-4">
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Auth Files
            </h2>

            <div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Manage Auth Files
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Upload, enable, or remove OAuth credential files
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage("auth-files")}
                >
                  <svg
                    class="w-4 h-4 mr-1.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  Manage
                </Button>
              </div>
            </div>
          </div>

          {/* Logs */}
          <div class="space-y-4">
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Logs
            </h2>

            <div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    View Logs
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Live proxy server logs with filtering
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage("logs")}
                >
                  <svg
                    class="w-4 h-4 mr-1.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M4 6h16M4 12h16M4 18h7"
                    />
                  </svg>
                  View
                </Button>
              </div>
            </div>
          </div>

          {/* Analytics */}
          <div class="space-y-4">
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Analytics
            </h2>

            <div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Usage Analytics
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    View request and token usage trends with charts
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage("analytics")}
                >
                  <svg
                    class="w-4 h-4 mr-1.5"
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
                  View
                </Button>
              </div>
            </div>
          </div>

          {/* About */}
          <div class="space-y-4">
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              About
            </h2>

            <div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 text-center">
              <div class="w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mb-3">
                <span class="text-white text-2xl">⚡</span>
              </div>
              <h3 class="font-bold text-gray-900 dark:text-gray-100">
                ProxyPal
              </h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Version 0.1.0
              </p>
              <p class="text-xs text-gray-400 dark:text-gray-500 mt-2">
                Built with Tauri, SolidJS, and TailwindCSS
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

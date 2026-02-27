import { getVersion } from "@tauri-apps/api/app";
import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js";
import { AdvancedSettings } from "../components/settings/AdvancedSettings";
import { AmpSettings } from "../components/settings/AmpSettings";
import { ClaudeCodeSettings } from "../components/settings/ClaudeCodeSettings";
import { CloudflareSettings } from "../components/settings/CloudflareSettings";
import { ModelsSettings } from "../components/settings/ModelsSettings";
import { OpenAIProviderSettings } from "../components/settings/OpenAIProviderSettings";
import { ProvidersSettings } from "../components/settings/ProvidersSettings";
import { ProxySettings } from "../components/settings/ProxySettings";
import { SshSettings } from "../components/settings/SshSettings";
import { ThinkingReasoningSettings } from "../components/settings/ThinkingReasoningSettings";
import { Button, Switch } from "../components/ui";
import { LOCALE_LABELS, LOCALE_OPTIONS, useI18n } from "../i18n";

type SettingsTab = "general" | "providers" | "models" | "advanced" | "ssh" | "cloudflare";

import {
  type AgentConfigResult,
  type AvailableModel,
  appendToShellProfile,
  getAvailableModels,
  getCloseToTray,
  getGptReasoningModels,
  saveConfig,
  setCloseToTray,
  startProxy,
  stopProxy,
} from "../lib/tauri";
import { appStore } from "../stores/app";
import { toastStore } from "../stores/toast";

export function SettingsPage() {
  const { t } = useI18n();
  const { config, setConfig, setSettingsTab, settingsTab } = appStore;
  const [saving, setSaving] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<SettingsTab>("general");
  const [appVersion, setAppVersion] = createSignal("0.0.0");

  // GPT base models fetched from backend (single source of truth)
  const [gptBaseModels, setGptBaseModels] = createSignal<string[]>([]);
  const gptBaseModelSet = createMemo(() => new Set(gptBaseModels()));
  const [availableModels, setAvailableModels] = createSignal<AvailableModel[]>([]);

  // Handle navigation from other components (e.g., CopilotCard)
  createEffect(() => {
    const tab = settingsTab();
    if (
      tab &&
      (tab === "general" ||
        tab === "providers" ||
        tab === "models" ||
        tab === "advanced" ||
        tab === "ssh" ||
        tab === "cloudflare")
    ) {
      setActiveTab(tab);
      setSettingsTab(null); // Clear after use
    }
  });

  // Fetch app version on mount
  onMount(async () => {
    try {
      const version = await getVersion();
      setAppVersion(version);
    } catch (error) {
      console.error("Failed to get app version:", error);
    }

    // Load GPT reasoning models from backend (single source of truth)
    try {
      const gptModels = await getGptReasoningModels();
      setGptBaseModels(gptModels);
    } catch (error) {
      console.error("Failed to load GPT reasoning models:", error);
    }

    // Load models if proxy is running
    if (appStore.proxyStatus().running) {
      try {
        const models = await getAvailableModels();
        setAvailableModels(models);
      } catch (error) {
        console.error("Failed to load models:", error);
      }
    }
  });

  // Handle agent configuration
  const [configResult, setConfigResult] = createSignal<{
    agentName: string;
    result: AgentConfigResult;
  } | null>(null);

  const handleApplyEnv = async () => {
    const result = configResult();
    if (!result?.result.shellConfig) {
      return;
    }

    try {
      const profilePath = await appendToShellProfile(result.result.shellConfig);
      toastStore.success(
        t("settings.toasts.addedToShellProfile"),
        t("settings.toasts.updatedPath", { path: profilePath }),
      );
      setConfigResult(null);
    } catch (error) {
      toastStore.error(t("settings.toasts.failedToUpdateShellProfile"), String(error));
    }
  };

  // Close to tray setting
  const [closeToTray, setCloseToTrayState] = createSignal(true);
  const [savingCloseToTray, setSavingCloseToTray] = createSignal(false);

  // Load close to tray setting on mount
  createEffect(async () => {
    try {
      const enabled = await getCloseToTray();
      setCloseToTrayState(enabled);
    } catch (error) {
      console.error("Failed to fetch close to tray setting:", error);
    }
  });

  // Handler for close to tray change
  const handleCloseToTrayChange = async (enabled: boolean) => {
    setSavingCloseToTray(true);
    try {
      await setCloseToTray(enabled);
      setCloseToTrayState(enabled);
      toastStore.success(
        enabled
          ? t("settings.toasts.windowWillMinimizeToTray")
          : t("settings.toasts.windowWillQuit"),
      );
    } catch (error) {
      console.error("Failed to save close to tray setting:", error);
      toastStore.error(t("settings.toasts.failedToSaveSetting"), String(error));
    } finally {
      setSavingCloseToTray(false);
    }
  };

  // Get list of available target models (from OpenAI providers aliases + real available models)
  const getAvailableTargetModels = () => {
    const customModels: { label: string; value: string }[] = [];

    // Add models from all custom OpenAI providers
    const providers = config().ampOpenaiProviders || [];
    for (const provider of providers) {
      if (provider?.models) {
        for (const model of provider.models) {
          if (model.alias) {
            customModels.push({
              label: `${model.alias} (${provider.name})`,
              value: model.alias,
            });
          } else {
            customModels.push({
              label: `${model.name} (${provider.name})`,
              value: model.name,
            });
          }
        }
      }
    }

    // Static fallback models for when no OAuth accounts are configured
    // These should match the actual models available from each provider
    const fallbackModels = {
      anthropic: [
        // Claude 4.5 models (use aliases for simplicity)
        { label: "claude-opus-4-5", value: "claude-opus-4-5" },
        { label: "claude-sonnet-4-5", value: "claude-sonnet-4-5" },
        { label: "claude-haiku-4-5", value: "claude-haiku-4-5" },
      ],
      copilot: [
        { label: "copilot-gpt-4o", value: "copilot-gpt-4o" },
        { label: "copilot-claude-sonnet-4", value: "copilot-claude-sonnet-4" },
        { label: "copilot-gemini-2.5-pro", value: "copilot-gemini-2.5-pro" },
      ],
      google: [
        // Gemini native models
        { label: "gemini-2.5-pro", value: "gemini-2.5-pro" },
        { label: "gemini-2.5-flash", value: "gemini-2.5-flash" },
        { label: "gemini-2.5-flash-lite", value: "gemini-2.5-flash-lite" },
        { label: "gemini-3-pro-preview", value: "gemini-3-pro-preview" },
        { label: "gemini-3-flash-preview", value: "gemini-3-flash-preview" },
        {
          label: "gemini-3.1-pro-high",
          value: "gemini-3.1-pro-high",
        },
        {
          label: "gemini-3-pro-image-preview",
          value: "gemini-3-pro-image-preview",
        },
        {
          label: "gemini-2.5-computer-use-preview",
          value: "gemini-2.5-computer-use-preview-10-2025",
        },
        // Gemini-Claude (Antigravity) models
        { label: "gemini-claude-opus-4-5", value: "gemini-claude-opus-4-5" },
        {
          label: "gemini-claude-opus-4-5-thinking",
          value: "gemini-claude-opus-4-5-thinking",
        },
        {
          label: "gemini-claude-sonnet-4-5",
          value: "gemini-claude-sonnet-4-5",
        },
        {
          label: "gemini-claude-sonnet-4-5-thinking",
          value: "gemini-claude-sonnet-4-5-thinking",
        },
        // GPT-OSS model
        { label: "gpt-oss-120b-medium", value: "gpt-oss-120b-medium" },
      ],
      iflow: [] as { label: string; value: string }[],
      kimi: [] as { label: string; value: string }[],
      kiro: [
        // Kiro models - Amazon's AI coding assistant
        {
          label: `kiro-auto (${t("common.recommended")})`,
          value: "kiro-auto",
        },
        { label: "kiro-claude-sonnet-4", value: "kiro-claude-sonnet-4" },
        { label: "kiro-claude-sonnet-4-5", value: "kiro-claude-sonnet-4-5" },
        { label: "kiro-claude-opus-4-5", value: "kiro-claude-opus-4-5" },
        { label: "kiro-claude-haiku-4-5", value: "kiro-claude-haiku-4-5" },
      ],
      openai: [
        // GPT-5 series
        { label: "gpt-5", value: "gpt-5" },
        { label: "gpt-5.1", value: "gpt-5.1" },
        { label: "gpt-5.2", value: "gpt-5.2" },
        // GPT-5 Codex models
        { label: "gpt-5-codex", value: "gpt-5-codex" },
        { label: "gpt-5-codex-mini", value: "gpt-5-codex-mini" },
        { label: "gpt-5.1-codex", value: "gpt-5.1-codex" },
        { label: "gpt-5.1-codex-max", value: "gpt-5.1-codex-max" },
        { label: "gpt-5.1-codex-mini", value: "gpt-5.1-codex-mini" },
        { label: "gpt-5.2-codex", value: "gpt-5.2-codex" },
        { label: "gpt-5.3-codex", value: "gpt-5.3-codex" },
        { label: "gpt-5.3-codex-spark", value: "gpt-5.3-codex-spark" },
        // o-series reasoning models
        { label: "o3", value: "o3" },
        { label: "o3-mini", value: "o3-mini" },
        { label: "o4-mini", value: "o4-mini" },
        // GPT-4 series (legacy)
        { label: "gpt-4.1", value: "gpt-4.1" },
        { label: "gpt-4.1-mini", value: "gpt-4.1-mini" },
        { label: "gpt-4o", value: "gpt-4o" },
        { label: "gpt-4o-mini", value: "gpt-4o-mini" },
      ],
      qwen: [
        { label: "qwen3-235b-a22b", value: "qwen3-235b-a22b" },
        { label: "qwq-32b", value: "qwq-32b" },
      ],
    };

    // Group real available models by provider
    const models = availableModels();
    const groupedModels = {
      anthropic: models
        .filter((m) => m.ownedBy === "anthropic")
        .map((m) => ({ label: m.id, value: m.id })),
      google: models
        .filter((m) => m.ownedBy === "google" || m.ownedBy === "antigravity")
        .map((m) => ({ label: m.id, value: m.id })),
      iflow: models.filter((m) => m.ownedBy === "iflow").map((m) => ({ label: m.id, value: m.id })),
      kimi: models
        .filter((m) => m.ownedBy === "kimi" || m.id.startsWith("kimi-"))
        .map((m) => ({ label: m.id, value: m.id })),
      openai: models
        .filter((m) => m.ownedBy === "openai")
        .map((m) => ({ label: m.id, value: m.id })),
      qwen: models.filter((m) => m.ownedBy === "qwen").map((m) => ({ label: m.id, value: m.id })),
      // GitHub Copilot models (via copilot-api) - includes both GPT and Claude models
      copilot: models
        .filter(
          (m) => m.ownedBy === "copilot" || (m.ownedBy === "claude" && m.id.startsWith("copilot-")),
        )
        .map((m) => ({ label: m.id, value: m.id })),
      // Kiro models (Amazon's AI coding assistant)
      kiro: models
        .filter((m) => m.ownedBy === "kiro" || m.id.startsWith("kiro-"))
        .map((m) => ({ label: m.id, value: m.id })),
    };

    // Use real models if available, otherwise fallback to static list
    const builtInModels = {
      anthropic:
        groupedModels.anthropic.length > 0 ? groupedModels.anthropic : fallbackModels.anthropic,
      copilot: groupedModels.copilot.length > 0 ? groupedModels.copilot : fallbackModels.copilot,
      google: groupedModels.google.length > 0 ? groupedModels.google : fallbackModels.google,
      iflow: groupedModels.iflow.length > 0 ? groupedModels.iflow : fallbackModels.iflow,
      kimi: groupedModels.kimi.length > 0 ? groupedModels.kimi : fallbackModels.kimi,
      kiro: groupedModels.kiro.length > 0 ? groupedModels.kiro : fallbackModels.kiro,
      openai: groupedModels.openai.length > 0 ? groupedModels.openai : fallbackModels.openai,
      qwen: groupedModels.qwen.length > 0 ? groupedModels.qwen : fallbackModels.qwen,
    };

    return { builtInModels, customModels };
  };

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

      // If management key changed and proxy is running, restart proxy to apply new key
      if (key === "managementKey" && appStore.proxyStatus().running) {
        toastStore.info(t("settings.toasts.restartingProxyForManagementKey"));
        await stopProxy();
        // Small delay to ensure config file is fully written and flushed
        await new Promise((resolve) => setTimeout(resolve, 500));
        await startProxy();
        toastStore.success(t("settings.toasts.proxyRestartedWithManagementKey"));
      } else {
        toastStore.success(t("settings.toasts.settingsSaved"));
      }
    } catch (error) {
      console.error("Failed to save config:", error);
      toastStore.error(t("settings.toasts.settingsSaveFailed"), String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="flex min-h-screen flex-col">
      {/* Header with Tabs */}
      <header class="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900 sm:px-6 sm:py-4">
        <div class="flex items-center justify-between gap-2 sm:gap-3">
          <div class="flex items-center gap-2 sm:gap-3">
            <h1 class="text-lg font-bold text-gray-900 dark:text-gray-100">
              {t("settings.title")}
            </h1>
            {saving() && (
              <span class="ml-2 flex items-center gap-1 text-xs text-gray-400">
                <svg class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
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
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    fill="currentColor"
                  />
                </svg>
                {t("common.saving")}
              </span>
            )}
          </div>
          {/* Tab Navigation */}
          <div class="flex gap-1">
            <For
              each={[
                {
                  id: "general" as SettingsTab,
                  label: t("settings.tabs.general"),
                },
                {
                  id: "providers" as SettingsTab,
                  label: t("settings.tabs.providers"),
                },
                {
                  id: "models" as SettingsTab,
                  label: t("settings.tabs.models"),
                },
                { id: "ssh" as SettingsTab, label: t("settings.tabs.ssh") },
                {
                  id: "cloudflare" as SettingsTab,
                  label: t("settings.tabs.cloudflare"),
                },
                {
                  id: "advanced" as SettingsTab,
                  label: t("settings.tabs.advanced"),
                },
              ]}
            >
              {(tab) => (
                <button
                  class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
                  classList={{
                    "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400":
                      activeTab() === tab.id,
                    "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800":
                      activeTab() !== tab.id,
                  }}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                >
                  {tab.label}
                </button>
              )}
            </For>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main class="flex-1 overflow-y-auto p-4 sm:p-6">
        <div class="animate-stagger mx-auto max-w-xl space-y-4 sm:space-y-6">
          {/* General settings */}
          <div class="space-y-4" classList={{ hidden: activeTab() !== "general" }}>
            <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
              {t("settings.general")}
            </h2>

            <div class="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
              <Switch
                checked={config().launchAtLogin}
                description={t("settings.launchAtLogin.description")}
                label={t("settings.launchAtLogin.label")}
                onChange={(checked) => handleConfigChange("launchAtLogin", checked)}
              />

              <div class="border-t border-gray-200 dark:border-gray-700" />

              <Switch
                checked={config().autoStart}
                description={t("settings.autoStartProxy.description")}
                label={t("settings.autoStartProxy.label")}
                onChange={(checked) => handleConfigChange("autoStart", checked)}
              />

              <div class="border-t border-gray-200 dark:border-gray-700" />

              <Switch
                checked={closeToTray()}
                description={t("settings.closeToTray.description")}
                disabled={savingCloseToTray()}
                label={t("settings.closeToTray.label")}
                onChange={handleCloseToTrayChange}
              />

              <div class="border-t border-gray-200 dark:border-gray-700" />

              <label class="block">
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("settings.language.label")}
                </span>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t("settings.language.description")}
                </p>
                <select
                  class="transition-smooth mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
                  onChange={(e) => handleConfigChange("locale", e.currentTarget.value)}
                  value={config().locale || "en"}
                >
                  <For each={LOCALE_OPTIONS}>
                    {(locale) => <option value={locale}>{LOCALE_LABELS[locale]}</option>}
                  </For>
                </select>
              </label>
            </div>
          </div>

          {/* Proxy settings */}
          <div class="space-y-4" classList={{ hidden: activeTab() !== "general" }}>
            <ProxySettings
              config={config}
              handleConfigChange={handleConfigChange}
              proxyRunning={appStore.proxyStatus().running}
              saving={saving}
              setConfig={setConfig}
              setSaving={setSaving}
            />
          </div>

          {/* Thinking Budget Settings */}
          <div class="space-y-4" classList={{ hidden: activeTab() !== "general" }}>
            <ThinkingReasoningSettings
              config={config}
              gptBaseModels={gptBaseModels}
              gptBaseModelSet={gptBaseModelSet}
              handleConfigChange={handleConfigChange}
              saving={saving}
              setConfig={setConfig}
              setSaving={setSaving}
            />
          </div>

          {/* Claude Code Settings */}
          <div class="space-y-4" classList={{ hidden: activeTab() !== "general" }}>
            <ClaudeCodeSettings
              config={config}
              getAvailableTargetModels={getAvailableTargetModels}
              handleConfigChange={handleConfigChange}
              saving={saving}
              setConfig={setConfig}
              setSaving={setSaving}
            />
          </div>

          {/* Amp CLI Integration */}
          <div class="space-y-4" classList={{ hidden: activeTab() !== "general" }}>
            <AmpSettings
              config={config}
              getAvailableTargetModels={getAvailableTargetModels}
              gptBaseModels={gptBaseModels}
              gptBaseModelSet={gptBaseModelSet}
              handleConfigChange={handleConfigChange}
              saving={saving}
              setConfig={setConfig}
              setSaving={setSaving}
            />
          </div>

          {/* Custom OpenAI-Compatible Providers */}
          <div class="space-y-4" classList={{ hidden: activeTab() !== "general" }}>
            <OpenAIProviderSettings
              config={config}
              handleConfigChange={handleConfigChange}
              saving={saving}
              setConfig={setConfig}
              setSaving={setSaving}
            />
          </div>

          {/* Advanced Settings */}
          <div classList={{ hidden: activeTab() !== "advanced" }}>
            <AdvancedSettings
              appVersion={appVersion}
              config={config}
              handleConfigChange={handleConfigChange}
              proxyRunning={appStore.proxyStatus().running}
              saving={saving}
              setConfig={setConfig}
              setSaving={setSaving}
            />
          </div>

          {/* Copilot Detection */}
          <div classList={{ hidden: activeTab() !== "providers" }}>
            <ProvidersSettings config={config()} setConfig={setConfig} />
          </div>

          {/* SSH Settings */}
          <div class="space-y-4" classList={{ hidden: activeTab() !== "ssh" }}>
            <SshSettings config={config()} setConfig={setConfig} />
          </div>

          <div classList={{ hidden: activeTab() !== "cloudflare" }}>
            <CloudflareSettings config={config()} setConfig={setConfig} />
          </div>

          <div class="my-6 border-t border-gray-200 dark:border-gray-700" />

          <div classList={{ hidden: activeTab() !== "models" }}>
            <ModelsSettings config={config()} setConfig={setConfig} />
          </div>
        </div>
      </main>
      <Show when={configResult()}>
        {(result) => (
          <div class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div class="animate-scale-in w-full max-w-lg rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
              <div class="p-6">
                <div class="mb-4 flex items-center justify-between">
                  <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {result().agentName} Configured
                  </h2>
                  <button
                    class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    onClick={() => setConfigResult(null)}
                  >
                    <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        d="M6 18L18 6M6 6l12 12"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                      />
                    </svg>
                  </button>
                </div>

                <div class="space-y-4">
                  <Show when={result().result.configPath}>
                    <div class="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
                      <div class="flex items-center gap-2 text-green-700 dark:text-green-300">
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            d="M5 13l4 4L19 7"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                          />
                        </svg>
                        <span class="text-sm font-medium">Config file created</span>
                      </div>
                      <p class="mt-1 break-all font-mono text-xs text-green-600 dark:text-green-400">
                        {result().result.configPath}
                      </p>
                    </div>
                  </Show>

                  <Show when={result().result.shellConfig}>
                    <div class="space-y-2">
                      <div class="flex items-center justify-between">
                        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Environment Variables
                        </span>
                        <button
                          class="text-xs text-brand-500 hover:text-brand-600"
                          onClick={() => {
                            navigator.clipboard.writeText(result().result.shellConfig!);
                            toastStore.success(t("common.copied"));
                          }}
                        >
                          Copy
                        </button>
                      </div>
                      <pre class="overflow-x-auto whitespace-pre-wrap rounded-lg bg-gray-100 p-3 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                        {result().result.shellConfig}
                      </pre>
                      <Button class="w-full" onClick={handleApplyEnv} size="sm" variant="secondary">
                        Add to Shell Profile Automatically
                      </Button>
                    </div>
                  </Show>

                  <Show when={result().result.instructions}>
                    <div class="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                      <p class="text-sm text-blue-700 dark:text-blue-300">
                        {result().result.instructions}
                      </p>
                    </div>
                  </Show>
                </div>

                <div class="mt-6 flex justify-end">
                  <Button onClick={() => setConfigResult(null)} variant="primary">
                    {t("agentSetup.configModal.done")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

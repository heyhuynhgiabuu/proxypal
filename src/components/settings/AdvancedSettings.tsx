import { createEffect, createSignal, For, Show } from "solid-js";
import { useI18n } from "../../i18n";
import {
  checkForUpdates,
  deleteOAuthExcludedModels,
  downloadAndInstallUpdate,
  getAvailableModels,
  getConfigYaml,
  getOAuthExcludedModels,
  getWebsocketAuth,
  isUpdaterSupported,
  setConfigYaml,
  setOAuthExcludedModels,
  setWebsocketAuth,
} from "../../lib/tauri";
import { appStore } from "../../stores/app";
import { themeStore } from "../../stores/theme";
import { toastStore } from "../../stores/toast";
import { Button, Switch } from "../ui";

import type {
  AvailableModel,
  OAuthExcludedModels,
  UpdateInfo,
  UpdateProgress,
  UpdaterSupport,
} from "../../lib/tauri";
import type { SettingsBaseProps } from "./types";

interface AdvancedSettingsProps extends SettingsBaseProps {
  appVersion: () => string;
  proxyRunning: boolean;
}

export function AdvancedSettings(props: AdvancedSettingsProps) {
  const { t } = useI18n();

  // OAuth Excluded Models state
  const [oauthExcludedModels, setOAuthExcludedModelsState] = createSignal<OAuthExcludedModels>({});
  const [loadingExcludedModels, setLoadingExcludedModels] = createSignal(false);
  const [savingExcludedModels, setSavingExcludedModels] = createSignal(false);
  const [newExcludedProvider, setNewExcludedProvider] = createSignal("");
  const [newExcludedModel, setNewExcludedModel] = createSignal("");

  // Raw YAML Config Editor state
  const [yamlConfigExpanded, setYamlConfigExpanded] = createSignal(false);
  const [yamlContent, setYamlContent] = createSignal("");
  const [loadingYaml, setLoadingYaml] = createSignal(false);
  const [savingYaml, setSavingYaml] = createSignal(false);

  // App Updates state
  const [updateInfo, setUpdateInfo] = createSignal<UpdateInfo | null>(null);
  const [checkingForUpdates, setCheckingForUpdates] = createSignal(false);
  const [installingUpdate, setInstallingUpdate] = createSignal(false);
  const [updateProgress, setUpdateProgress] = createSignal<UpdateProgress | null>(null);
  const [updaterSupport, setUpdaterSupport] = createSignal<UpdaterSupport | null>(null);

  // Available models from proxy (real-time)
  const [availableModels, setAvailableModels] = createSignal<AvailableModel[]>([]);

  // Management API runtime settings
  const [websocketAuth, setWebsocketAuthState] = createSignal<boolean>(false);
  const [savingWebsocketAuth, setSavingWebsocketAuth] = createSignal(false);

  // Check updater support on mount
  createEffect(async () => {
    try {
      const support = await isUpdaterSupported();
      setUpdaterSupport(support);
    } catch (error) {
      console.error("Failed to check updater support:", error);
    }
  });

  // Fetch available models and runtime settings when proxy is running
  createEffect(async () => {
    const proxyRunning = appStore.proxyStatus().running;
    if (proxyRunning) {
      try {
        const models = await getAvailableModels();
        setAvailableModels(models);
      } catch (error) {
        console.error("Failed to fetch available models:", error);
        setAvailableModels([]);
      }

      // Fetch OAuth excluded models
      try {
        setLoadingExcludedModels(true);
        const excluded = await getOAuthExcludedModels();
        setOAuthExcludedModelsState(excluded);
      } catch (error) {
        console.error("Failed to fetch OAuth excluded models:", error);
      } finally {
        setLoadingExcludedModels(false);
      }

      try {
        const wsAuth = await getWebsocketAuth();
        setWebsocketAuthState(wsAuth);
      } catch (error) {
        console.error("Failed to fetch WebSocket auth:", error);
      }
    } else {
      setAvailableModels([]);
    }
  });

  const handleWebsocketAuthChange = async (value: boolean) => {
    setSavingWebsocketAuth(true);
    try {
      await setWebsocketAuth(value);
      setWebsocketAuthState(value);
      toastStore.success(
        t("settings.toasts.websocketAuthentication", {
          status: value ? t("settings.toasts.enabled") : t("settings.toasts.disabled"),
        }),
      );
    } catch (error) {
      toastStore.error(t("settings.toasts.failedToUpdateWebsocketAuth"), String(error));
    } finally {
      setSavingWebsocketAuth(false);
    }
  };

  const handleCheckForUpdates = async () => {
    setCheckingForUpdates(true);
    setUpdateInfo(null);
    try {
      const info = await checkForUpdates();
      setUpdateInfo(info);
      if (info.available) {
        toastStore.success(
          t("settings.toasts.updateAvailable", {
            version: info.version || "",
          }),
        );
      } else {
        toastStore.success(t("settings.toasts.latestVersion"));
      }
    } catch (error) {
      console.error("Update check failed:", error);
      toastStore.error(t("settings.toasts.updateCheckFailed"), String(error));
    } finally {
      setCheckingForUpdates(false);
    }
  };

  const handleInstallUpdate = async () => {
    setInstallingUpdate(true);
    setUpdateProgress(null);
    try {
      await downloadAndInstallUpdate((progress) => {
        setUpdateProgress(progress);
      });
    } catch (error) {
      console.error("Update installation failed:", error);
      toastStore.error(t("settings.toasts.updateFailed"), String(error));
      setInstallingUpdate(false);
      setUpdateProgress(null);
    }
  };

  const handleAddExcludedModel = async () => {
    const provider = newExcludedProvider().trim().toLowerCase();
    const model = newExcludedModel().trim();

    if (!provider || !model) {
      toastStore.error(t("settings.toasts.providerAndModelRequired"));
      return;
    }

    setSavingExcludedModels(true);
    try {
      const current = oauthExcludedModels();
      const existing = current[provider] || [];
      if (existing.includes(model)) {
        toastStore.error(t("settings.toasts.modelAlreadyExcluded"));
        return;
      }

      const updated = [...existing, model];
      await setOAuthExcludedModels(provider, updated);
      setOAuthExcludedModelsState({ ...current, [provider]: updated });
      setNewExcludedModel("");
      toastStore.success(
        t("settings.toasts.modelExcludedForProvider", {
          model,
          provider,
        }),
      );
    } catch (error) {
      toastStore.error(t("settings.toasts.failedToAddExcludedModel"), String(error));
    } finally {
      setSavingExcludedModels(false);
    }
  };

  const handleRemoveExcludedModel = async (provider: string, model: string) => {
    setSavingExcludedModels(true);
    try {
      const current = oauthExcludedModels();
      const existing = current[provider] || [];
      const updated = existing.filter((m) => m !== model);

      if (updated.length === 0) {
        await deleteOAuthExcludedModels(provider);
        const newState = { ...current };
        delete newState[provider];
        setOAuthExcludedModelsState(newState);
      } else {
        await setOAuthExcludedModels(provider, updated);
        setOAuthExcludedModelsState({ ...current, [provider]: updated });
      }
      toastStore.success(
        t("settings.toasts.modelRemovedFromProvider", {
          model,
          provider,
        }),
      );
    } catch (error) {
      toastStore.error(t("settings.toasts.failedToRemoveExcludedModel"), String(error));
    } finally {
      setSavingExcludedModels(false);
    }
  };

  const loadYamlConfig = async () => {
    if (!appStore.proxyStatus().running) {
      setYamlContent(t("settings.yaml.proxyNotRunning"));
      return;
    }
    setLoadingYaml(true);
    try {
      const yaml = await getConfigYaml();
      setYamlContent(yaml);
    } catch (error) {
      toastStore.error(t("settings.toasts.failedToLoadConfigYaml"), String(error));
    } finally {
      setLoadingYaml(false);
    }
  };

  const saveYamlConfig = async () => {
    setSavingYaml(true);
    try {
      await setConfigYaml(yamlContent());
      toastStore.success(t("settings.toasts.configYamlSaved"));
    } catch (error) {
      toastStore.error(t("settings.toasts.failedToSaveConfigYaml"), String(error));
    } finally {
      setSavingYaml(false);
    }
  };

  createEffect(() => {
    if (yamlConfigExpanded() && !yamlContent()) {
      loadYamlConfig();
    }
  });

  const getAvailableTargetModels = () => {
    const customModels: { label: string; value: string }[] = [];

    const providers = props.config().ampOpenaiProviders || [];
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

    const fallbackModels = {
      anthropic: [
        { label: "claude-opus-4-5", value: "claude-opus-4-5" },
        { label: "claude-sonnet-4-5", value: "claude-sonnet-4-5" },
        { label: "claude-haiku-4-5", value: "claude-haiku-4-5" },
      ],
      copilot: [
        { label: "copilot-gpt-4o", value: "copilot-gpt-4o" },
        {
          label: "copilot-claude-sonnet-4",
          value: "copilot-claude-sonnet-4",
        },
        {
          label: "copilot-gemini-2.5-pro",
          value: "copilot-gemini-2.5-pro",
        },
      ],
      google: [
        { label: "gemini-2.5-pro", value: "gemini-2.5-pro" },
        { label: "gemini-2.5-flash", value: "gemini-2.5-flash" },
        { label: "gemini-2.5-flash-lite", value: "gemini-2.5-flash-lite" },
        { label: "gemini-3-pro-preview", value: "gemini-3-pro-preview" },
        { label: "gemini-3-flash-preview", value: "gemini-3-flash-preview" },
        { label: "gemini-3.1-pro-high", value: "gemini-3.1-pro-high" },
        {
          label: "gemini-3-pro-image-preview",
          value: "gemini-3-pro-image-preview",
        },
        {
          label: "gemini-2.5-computer-use-preview",
          value: "gemini-2.5-computer-use-preview-10-2025",
        },
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
        { label: "gpt-oss-120b-medium", value: "gpt-oss-120b-medium" },
      ],
      iflow: [] as { label: string; value: string }[],
      kimi: [] as { label: string; value: string }[],
      kiro: [
        {
          label: `kiro-auto (${t("common.recommended")})`,
          value: "kiro-auto",
        },
        {
          label: "kiro-claude-sonnet-4",
          value: "kiro-claude-sonnet-4",
        },
        {
          label: "kiro-claude-sonnet-4-5",
          value: "kiro-claude-sonnet-4-5",
        },
        {
          label: "kiro-claude-opus-4-5",
          value: "kiro-claude-opus-4-5",
        },
        {
          label: "kiro-claude-haiku-4-5",
          value: "kiro-claude-haiku-4-5",
        },
      ],
      openai: [
        { label: "gpt-5", value: "gpt-5" },
        { label: "gpt-5.1", value: "gpt-5.1" },
        { label: "gpt-5.2", value: "gpt-5.2" },
        { label: "gpt-5-codex", value: "gpt-5-codex" },
        { label: "gpt-5-codex-mini", value: "gpt-5-codex-mini" },
        { label: "gpt-5.1-codex", value: "gpt-5.1-codex" },
        { label: "gpt-5.1-codex-max", value: "gpt-5.1-codex-max" },
        { label: "gpt-5.1-codex-mini", value: "gpt-5.1-codex-mini" },
        { label: "gpt-5.2-codex", value: "gpt-5.2-codex" },
        { label: "gpt-5.3-codex", value: "gpt-5.3-codex" },
        { label: "gpt-5.3-codex-spark", value: "gpt-5.3-codex-spark" },
        { label: "o3", value: "o3" },
        { label: "o3-mini", value: "o3-mini" },
        { label: "o4-mini", value: "o4-mini" },
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

    const models = availableModels();
    const groupedModels = {
      anthropic: models
        .filter((m) => m.ownedBy === "anthropic")
        .map((m) => ({ label: m.id, value: m.id })),
      copilot: models
        .filter(
          (m) => m.ownedBy === "copilot" || (m.ownedBy === "claude" && m.id.startsWith("copilot-")),
        )
        .map((m) => ({ label: m.id, value: m.id })),
      google: models
        .filter((m) => m.ownedBy === "google" || m.ownedBy === "antigravity")
        .map((m) => ({ label: m.id, value: m.id })),
      iflow: models.filter((m) => m.ownedBy === "iflow").map((m) => ({ label: m.id, value: m.id })),
      kimi: models
        .filter((m) => m.ownedBy === "kimi" || m.id.startsWith("kimi-"))
        .map((m) => ({ label: m.id, value: m.id })),
      kiro: models
        .filter((m) => m.ownedBy === "kiro" || m.id.startsWith("kiro-"))
        .map((m) => ({ label: m.id, value: m.id })),
      openai: models
        .filter((m) => m.ownedBy === "openai")
        .map((m) => ({ label: m.id, value: m.id })),
      qwen: models.filter((m) => m.ownedBy === "qwen").map((m) => ({ label: m.id, value: m.id })),
    };

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

  return (
    <div class="space-y-4">
      <div class="space-y-4">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          Advanced Settings
        </h2>

        <div class="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
          <Switch
            checked={props.config().debug}
            description="Enable verbose logging for troubleshooting"
            label="Debug Mode"
            onChange={(checked) => props.handleConfigChange("debug", checked)}
          />

          <div class="border-t border-gray-200 dark:border-gray-700" />

          <Switch
            checked={props.config().usageStatsEnabled}
            description="Track request counts and token usage"
            label="Usage Statistics"
            onChange={(checked) => props.handleConfigChange("usageStatsEnabled", checked)}
          />

          <div class="border-t border-gray-200 dark:border-gray-700" />

          <Switch
            checked={props.config().requestLogging}
            description="Log all API requests for debugging"
            label="Request Logging"
            onChange={(checked) => props.handleConfigChange("requestLogging", checked)}
          />

          <div class="border-t border-gray-200 dark:border-gray-700" />

          <Switch
            checked={props.config().commercialMode ?? false}
            description="Disable request logging middleware for lower memory usage (requires restart)"
            label="Commercial Mode"
            onChange={(checked) => props.handleConfigChange("commercialMode", checked)}
          />

          <div class="border-t border-gray-200 dark:border-gray-700" />

          <Switch
            checked={props.config().disableControlPanel ?? true}
            description="Hide CLIProxyAPI's web management UI. Disable to access the control panel at http://localhost:PORT"
            label="Disable Control Panel"
            onChange={(checked) => props.handleConfigChange("disableControlPanel", checked)}
          />

          <div class="border-t border-gray-200 dark:border-gray-700" />

          <Switch
            checked={props.config().loggingToFile}
            description="Write logs to rotating files instead of stdout"
            label="Log to File"
            onChange={(checked) => props.handleConfigChange("loggingToFile", checked)}
          />

          <Show when={props.config().loggingToFile}>
            <div class="flex items-center justify-between">
              <div class="flex-1">
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Max Log Size (MB)
                </span>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  Maximum total size of log files before rotation
                </p>
              </div>
              <input
                class="w-24 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-right text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
                max="1000"
                min="10"
                onChange={(e) =>
                  props.handleConfigChange(
                    "logsMaxTotalSizeMb",
                    Number.parseInt(e.currentTarget.value) || 100,
                  )
                }
                type="number"
                value={props.config().logsMaxTotalSizeMb || 100}
              />
            </div>
          </Show>

          <Show when={props.proxyRunning}>
            <div class="border-t border-gray-200 dark:border-gray-700" />

            <div class="flex items-center justify-between">
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    WebSocket Authentication
                  </span>
                  <Show when={savingWebsocketAuth()}>
                    <svg
                      class="h-4 w-4 animate-spin text-brand-500"
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
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        fill="currentColor"
                      />
                    </svg>
                  </Show>
                </div>
                <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  Require authentication for WebSocket connections. Updates live without restart.
                </p>
              </div>
              <button
                aria-checked={websocketAuth()}
                class={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 ${
                  websocketAuth() ? "bg-brand-600" : "bg-gray-200 dark:bg-gray-700"
                }`}
                disabled={savingWebsocketAuth()}
                onClick={() => handleWebsocketAuthChange(!websocketAuth())}
                role="switch"
                type="button"
              >
                <span
                  aria-hidden="true"
                  class={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    websocketAuth() ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </Show>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          Quota Exceeded Behavior
        </h2>

        <div class="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
          <Switch
            checked={props.config().quotaSwitchProject}
            description="Automatically switch to another project when quota is exceeded"
            label="Auto-switch Project"
            onChange={(checked) => props.handleConfigChange("quotaSwitchProject", checked)}
          />

          <div class="border-t border-gray-200 dark:border-gray-700" />

          <Switch
            checked={props.config().quotaSwitchPreviewModel}
            description="Fall back to preview/beta models when quota is exceeded"
            label="Switch to Preview Model"
            onChange={(checked) => props.handleConfigChange("quotaSwitchPreviewModel", checked)}
          />
        </div>
      </div>

      <Show when={props.proxyRunning}>
        <div class="space-y-4">
          <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
            OAuth Excluded Models
          </h2>

          <div class="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
            <p class="text-xs text-gray-500 dark:text-gray-400">
              Block specific models from being used with OAuth providers. Updates live without
              restart.
            </p>

            <div class="flex gap-2">
              <select
                class="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 [&>option]:bg-white [&>option]:text-gray-900 [&>option]:dark:bg-gray-900 [&>option]:dark:text-gray-100"
                onChange={(e) => setNewExcludedProvider(e.currentTarget.value)}
                value={newExcludedProvider()}
              >
                <option value="">{t("common.selectProvider")}</option>
                <option value="gemini">Gemini</option>
                <option value="claude">Claude</option>
                <option value="qwen">Qwen</option>
                <option value="iflow">iFlow</option>
                <option value="openai">OpenAI</option>
                <option value="copilot">GitHub Copilot</option>
              </select>
              {(() => {
                const mappings = props.config().ampModelMappings || [];
                const mappedModels = mappings
                  .filter((m) => m.enabled !== false && m.alias)
                  .map((m) => m.alias);
                const { builtInModels } = getAvailableTargetModels();

                const getModelsForProvider = () => {
                  const provider = newExcludedProvider();
                  switch (provider) {
                    case "gemini":
                      return builtInModels.google;
                    case "claude":
                      return builtInModels.anthropic;
                    case "openai":
                      return builtInModels.openai;
                    case "qwen":
                      return builtInModels.qwen;
                    case "iflow":
                      return builtInModels.iflow;
                    case "kimi":
                      return builtInModels.kimi;
                    case "copilot":
                      return builtInModels.copilot;
                    case "kiro":
                      return builtInModels.kiro;
                    default:
                      return [];
                  }
                };

                return (
                  <select
                    class="flex-[2] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 [&>optgroup]:bg-white [&>optgroup]:text-gray-900 [&>optgroup]:dark:bg-gray-900 [&>optgroup]:dark:text-gray-100 [&>option]:bg-white [&>option]:text-gray-900 [&>option]:dark:bg-gray-900 [&>option]:dark:text-gray-100"
                    onChange={(e) => setNewExcludedModel(e.currentTarget.value)}
                    value={newExcludedModel()}
                  >
                    <option value="">{t("common.selectModel")}</option>
                    <Show when={mappedModels.length > 0}>
                      <optgroup label="Amp Model Mappings">
                        <For each={[...new Set(mappedModels)]}>
                          {(model) => <option value={model}>{model}</option>}
                        </For>
                      </optgroup>
                    </Show>
                    <Show when={getModelsForProvider().length > 0}>
                      <optgroup label={`${newExcludedProvider() || "Provider"} Models`}>
                        <For each={getModelsForProvider()}>
                          {(model) => <option value={model.value}>{model.label}</option>}
                        </For>
                      </optgroup>
                    </Show>
                  </select>
                );
              })()}
              <Button
                disabled={savingExcludedModels() || !newExcludedProvider() || !newExcludedModel()}
                onClick={handleAddExcludedModel}
                size="sm"
                variant="primary"
              >
                <Show fallback={<span>{t("common.add")}</span>} when={savingExcludedModels()}>
                  <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      fill="currentColor"
                    />
                  </svg>
                </Show>
              </Button>
            </div>

            <Show when={loadingExcludedModels()}>
              <div class="py-4 text-center text-gray-500">{t("common.loading")}</div>
            </Show>

            <Show
              when={!loadingExcludedModels() && Object.keys(oauthExcludedModels()).length === 0}
            >
              <div class="py-4 text-center text-sm text-gray-400 dark:text-gray-500">
                {t("settings.oauthExcluded.noModels")}
              </div>
            </Show>

            <Show when={!loadingExcludedModels() && Object.keys(oauthExcludedModels()).length > 0}>
              <div class="space-y-3">
                <For each={Object.entries(oauthExcludedModels())}>
                  {([provider, models]) => (
                    <div class="space-y-2">
                      <div class="flex items-center gap-2">
                        <span class="text-xs font-medium uppercase text-gray-600 dark:text-gray-400">
                          {provider}
                        </span>
                        <span class="text-xs text-gray-400">({models.length} excluded)</span>
                      </div>
                      <div class="flex flex-wrap gap-2">
                        <For each={models}>
                          {(model) => (
                            <span class="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400">
                              {model}
                              <button
                                class="hover:text-red-900 disabled:opacity-50 dark:hover:text-red-300"
                                disabled={savingExcludedModels()}
                                onClick={() => handleRemoveExcludedModel(provider, model)}
                                title="Remove"
                                type="button"
                              >
                                <svg
                                  class="h-3 w-3"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    d="M6 18L18 6M6 6l12 12"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                  />
                                </svg>
                              </button>
                            </span>
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={props.proxyRunning}>
        <div class="space-y-4">
          <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
            Raw Configuration
          </h2>

          <div class="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
            <button
              class="flex w-full items-center justify-between text-left"
              onClick={() => setYamlConfigExpanded(!yamlConfigExpanded())}
              type="button"
            >
              <div>
                <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  YAML Config Editor
                </p>
                <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  Advanced: Edit the raw CLIProxyAPI configuration
                </p>
              </div>
              <svg
                class={`h-5 w-5 text-gray-400 transition-transform ${
                  yamlConfigExpanded() ? "rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M19 9l-7 7-7-7"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </svg>
            </button>

            <Show when={yamlConfigExpanded()}>
              <div class="mt-4 space-y-3">
                <div class="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">
                  <svg
                    class="h-4 w-4 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                    />
                  </svg>
                  <span>
                    Be careful! Invalid YAML can break the proxy. Changes apply immediately but some
                    may require a restart.
                  </span>
                </div>

                <Show when={loadingYaml()}>
                  <div class="py-8 text-center text-gray-500">Loading configuration...</div>
                </Show>

                <Show when={!loadingYaml()}>
                  <textarea
                    class="transition-smooth h-96 w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
                    onInput={(e) => setYamlContent(e.currentTarget.value)}
                    placeholder="Loading..."
                    spellcheck={false}
                    value={yamlContent()}
                  />

                  <div class="flex items-center justify-between">
                    <Button
                      disabled={loadingYaml()}
                      onClick={loadYamlConfig}
                      size="sm"
                      variant="secondary"
                    >
                      <svg
                        class="mr-1.5 h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                        />
                      </svg>
                      Reload
                    </Button>

                    <Button
                      disabled={savingYaml() || loadingYaml()}
                      onClick={saveYamlConfig}
                      size="sm"
                      variant="primary"
                    >
                      <Show fallback={<span>{t("common.saveChanges")}</span>} when={savingYaml()}>
                        <svg class="mr-1.5 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            fill="currentColor"
                          />
                        </svg>
                        Saving...
                      </Show>
                    </Button>
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      <div class="space-y-4">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          App Updates
        </h2>

        <div class="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
          <div class="flex items-center justify-between">
            <div class="flex-1">
              <p class="text-sm font-medium text-gray-700 dark:text-gray-300">Check for Updates</p>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Download and install new versions automatically
              </p>
            </div>
            <Button
              disabled={checkingForUpdates() || installingUpdate()}
              onClick={handleCheckForUpdates}
              size="sm"
              variant="secondary"
            >
              <Show
                fallback={
                  <>
                    <svg
                      class="mr-1.5 h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                      />
                    </svg>
                    Check
                  </>
                }
                when={checkingForUpdates()}
              >
                <svg class="mr-1.5 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    fill="currentColor"
                  />
                </svg>
                Checking...
              </Show>
            </Button>
          </div>

          <Show when={updateInfo()?.available}>
            <div class="border-t border-gray-200 pt-4 dark:border-gray-700">
              <div class="flex items-start gap-3 rounded-lg border border-brand-200 bg-brand-50 p-3 dark:border-brand-800 dark:bg-brand-900/20">
                <svg
                  class="mt-0.5 h-5 w-5 shrink-0 text-brand-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-brand-700 dark:text-brand-300">
                    Update Available: v{updateInfo()?.version}
                  </p>
                  <p class="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                      />
                    </svg>
                    Please stop the proxy before updating to avoid issues
                  </p>
                  <Show when={updateInfo()?.body}>
                    <p class="mt-1 line-clamp-3 text-xs text-brand-600 dark:text-brand-400">
                      {updateInfo()?.body}
                    </p>
                  </Show>
                  <Show when={updateInfo()?.date}>
                    <p class="mt-1 text-xs text-brand-500 dark:text-brand-500">
                      Released: {updateInfo()?.date}
                    </p>
                  </Show>
                </div>
              </div>

              <div class="mt-3">
                <Show
                  fallback={
                    <div class="text-center">
                      <p class="mb-2 text-xs text-amber-600 dark:text-amber-400">
                        {updaterSupport()?.reason}
                      </p>
                      <a
                        class="inline-flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600"
                        href="https://github.com/heyhuynhgiabuu/proxypal/releases"
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        <svg
                          class="mr-1.5 h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                          />
                        </svg>
                        Download from GitHub
                      </a>
                    </div>
                  }
                  when={updaterSupport()?.supported !== false}
                >
                  <Button
                    class="w-full"
                    disabled={installingUpdate()}
                    onClick={handleInstallUpdate}
                    size="sm"
                    variant="primary"
                  >
                    <Show
                      fallback={
                        <>
                          <svg
                            class="mr-1.5 h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                            />
                          </svg>
                          Download & Install
                        </>
                      }
                      when={installingUpdate()}
                    >
                      <svg class="mr-1.5 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          fill="currentColor"
                        />
                      </svg>
                      {updateProgress()?.event === "Progress" ? "Downloading..." : "Installing..."}
                    </Show>
                  </Button>
                </Show>
              </div>

              <Show when={updateProgress()?.event === "Progress"}>
                <div class="mt-2">
                  <div class="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      class="h-full bg-brand-500 transition-all duration-300"
                      style={{
                        width: `${
                          (updateProgress()?.contentLength ?? 0) > 0
                            ? ((updateProgress()?.chunkLength ?? 0) /
                                (updateProgress()?.contentLength ?? 1)) *
                              100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              </Show>
            </div>
          </Show>

          <Show when={updateInfo() && !updateInfo()?.available}>
            <div class="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
              <svg
                class="h-5 w-5 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M5 13l4 4L19 7"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </svg>
              <p class="text-sm text-green-700 dark:text-green-300">
                You're running the latest version (v
                {updateInfo()?.currentVersion})
              </p>
            </div>
          </Show>
        </div>
      </div>

      <div class="my-6 border-t border-gray-200 dark:border-gray-700" />

      <div class="space-y-4">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          About
        </h2>

        <div class="rounded-xl border border-gray-200 bg-gray-50 p-4 text-center dark:border-gray-700 dark:bg-gray-800/50">
          <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl">
            <img
              alt="ProxyPal Logo"
              class="h-12 w-12 rounded-xl object-contain"
              src={
                themeStore.resolvedTheme() === "dark"
                  ? "/proxypal-white.png"
                  : "/proxypal-black.png"
              }
            />
          </div>
          <h3 class="font-bold text-gray-900 dark:text-gray-100">ProxyPal</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400">Version {props.appVersion()}</p>
          <p class="mt-2 text-xs text-gray-400 dark:text-gray-500">
            Built with love by OpenCodeKit
          </p>
        </div>
      </div>
    </div>
  );
}

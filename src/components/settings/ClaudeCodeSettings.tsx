import { createEffect, createSignal, For, Show, splitProps } from "solid-js";
import { useI18n } from "../../i18n";
import {
  getClaudeCodeSettings,
  setClaudeCodeModel,
  type ClaudeCodeSettings as ClaudeCodeSettingsType,
} from "../../lib/tauri";
import { toastStore } from "../../stores/toast";

import type { SettingsBaseProps } from "./types";

interface ClaudeCodeSettingsProps extends SettingsBaseProps {
  getAvailableTargetModels: () => { builtInModels: object; customModels: object };
}

export function ClaudeCodeSettings(props: ClaudeCodeSettingsProps) {
  const { t } = useI18n();
  const [local] = splitProps(props, ["getAvailableTargetModels"]);

  const [claudeCodeSettings, setClaudeCodeSettings] = createSignal<ClaudeCodeSettingsType>({
    authToken: null,
    baseUrl: null,
    haikuModel: null,
    opusModel: null,
    sonnetModel: null,
  });

  createEffect(async () => {
    try {
      const settings = await getClaudeCodeSettings();
      setClaudeCodeSettings(settings);
    } catch (error) {
      console.error("Failed to fetch Claude Code settings:", error);
    }
  });

  const handleClaudeCodeSettingChange = async (
    modelType: "haikuModel" | "opusModel" | "sonnetModel",
    modelName: string,
  ) => {
    try {
      const backendModelType = modelType.replace("Model", "") as "haiku" | "opus" | "sonnet";
      await setClaudeCodeModel(backendModelType, modelName);
      setClaudeCodeSettings((prev) => ({
        ...prev,
        [modelType]: modelName || null,
      }));
      toastStore.success(t("settings.toasts.claudeCodeModelUpdated"));
    } catch (error) {
      console.error("Failed to save Claude Code setting:", error);
      toastStore.error(t("settings.toasts.failedToSaveSetting"), String(error));
    }
  };

  return (
    <div class="space-y-4">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
        Claude Code Settings
      </h2>

      <div class="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <p class="text-xs text-gray-500 dark:text-gray-400">
          Map Claude Code model slots to available provider models. These settings modify the
          claude_desktop_config.json file.
        </p>

        <div class="space-y-3">
          {(() => {
            const { builtInModels, customModels } = local.getAvailableTargetModels() as {
              builtInModels: {
                anthropic: { label: string; value: string }[];
                copilot: { label: string; value: string }[];
                google: { label: string; value: string }[];
                iflow: { label: string; value: string }[];
                kimi: { label: string; value: string }[];
                kiro: { label: string; value: string }[];
                openai: { label: string; value: string }[];
                qwen: { label: string; value: string }[];
              };
              customModels: { label: string; value: string }[];
            };
            const hasModels =
              customModels.length > 0 ||
              builtInModels.anthropic.length > 0 ||
              builtInModels.google.length > 0 ||
              builtInModels.openai.length > 0 ||
              builtInModels.copilot.length > 0 ||
              builtInModels.kiro.length > 0 ||
              builtInModels.kimi.length > 0;

            if (!hasModels) {
              return (
                <p class="text-sm italic text-gray-500 dark:text-gray-400">
                  No models available. Please authenticate with a provider first.
                </p>
              );
            }

            const ModelSelect = (innerProps: {
              label: string;
              modelType: "haikuModel" | "opusModel" | "sonnetModel";
              value: string | null;
            }) => (
              <label class="block">
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {innerProps.label}
                </span>
                <select
                  class="transition-smooth mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 [&>optgroup]:bg-white [&>optgroup]:text-gray-900 [&>optgroup]:dark:bg-gray-900 [&>optgroup]:dark:text-gray-100 [&>option]:bg-white [&>option]:text-gray-900 [&>option]:dark:bg-gray-900 [&>option]:dark:text-gray-100"
                  onChange={(e) =>
                    handleClaudeCodeSettingChange(innerProps.modelType, e.currentTarget.value)
                  }
                  value={innerProps.value || ""}
                >
                  <option value="">{t("common.selectModel")}</option>
                  <Show when={customModels.length > 0}>
                    <optgroup label="Custom Providers">
                      <For each={customModels}>
                        {(model) => <option value={model.value}>{model.label}</option>}
                      </For>
                    </optgroup>
                  </Show>
                  <Show when={builtInModels.anthropic.length > 0}>
                    <optgroup label="Anthropic">
                      <For each={builtInModels.anthropic}>
                        {(model) => <option value={model.value}>{model.label}</option>}
                      </For>
                    </optgroup>
                  </Show>
                  <Show when={builtInModels.google.length > 0}>
                    <optgroup label="Google">
                      <For each={builtInModels.google}>
                        {(model) => <option value={model.value}>{model.label}</option>}
                      </For>
                    </optgroup>
                  </Show>
                  <Show when={builtInModels.openai.length > 0}>
                    <optgroup label="OpenAI">
                      <For each={builtInModels.openai}>
                        {(model) => <option value={model.value}>{model.label}</option>}
                      </For>
                    </optgroup>
                  </Show>
                  <Show when={builtInModels.copilot.length > 0}>
                    <optgroup label="GitHub Copilot">
                      <For each={builtInModels.copilot}>
                        {(model) => <option value={model.value}>{model.label}</option>}
                      </For>
                    </optgroup>
                  </Show>
                  <Show when={builtInModels.kiro.length > 0}>
                    <optgroup label="Kiro">
                      <For each={builtInModels.kiro}>
                        {(model) => <option value={model.value}>{model.label}</option>}
                      </For>
                    </optgroup>
                  </Show>
                  <Show when={builtInModels.qwen.length > 0}>
                    <optgroup label="Qwen">
                      <For each={builtInModels.qwen}>
                        {(model) => <option value={model.value}>{model.label}</option>}
                      </For>
                    </optgroup>
                  </Show>
                  <Show when={builtInModels.iflow.length > 0}>
                    <optgroup label="iFlow">
                      <For each={builtInModels.iflow}>
                        {(model) => <option value={model.value}>{model.label}</option>}
                      </For>
                    </optgroup>
                  </Show>
                  <Show when={builtInModels.kimi.length > 0}>
                    <optgroup label="Kimi">
                      <For each={builtInModels.kimi}>
                        {(model) => <option value={model.value}>{model.label}</option>}
                      </For>
                    </optgroup>
                  </Show>
                </select>
              </label>
            );

            return (
              <>
                <ModelSelect
                  label="Haiku Model"
                  modelType="haikuModel"
                  value={claudeCodeSettings().haikuModel}
                />
                <ModelSelect
                  label="Sonnet Model"
                  modelType="sonnetModel"
                  value={claudeCodeSettings().sonnetModel}
                />
                <ModelSelect
                  label="Opus Model"
                  modelType="opusModel"
                  value={claudeCodeSettings().opusModel}
                />
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

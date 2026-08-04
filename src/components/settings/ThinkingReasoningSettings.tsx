import { createEffect, createSignal } from "solid-js";
import { useI18n } from "../../i18n";
import {
  getConfig,
  getReasoningEffortSettings,
  saveConfig,
  setReasoningEffortSettings,
  type ReasoningEffortLevel,
} from "../../lib/tauri";
import { toastStore } from "../../stores/toast";
import { Button, Switch } from "../ui";

import type { SettingsBaseProps } from "./types";

type ThinkingReasoningSettingsProps = SettingsBaseProps;

export function ThinkingReasoningSettings(_props: ThinkingReasoningSettingsProps) {
  const { t } = useI18n();

  const [reasoningEffortLevel, setReasoningEffortLevel] =
    createSignal<ReasoningEffortLevel>("medium");
  const [savingReasoningEffort, setSavingReasoningEffort] = createSignal(false);

  const [geminiThinkingInjection, setGeminiThinkingInjection] = createSignal<boolean>(true);
  const [savingGeminiThinking, setSavingGeminiThinking] = createSignal(false);

  createEffect(async () => {
    try {
      const reasoningSettings = await getReasoningEffortSettings();
      setReasoningEffortLevel(reasoningSettings.level);
    } catch (error) {
      console.error("Failed to fetch reasoning effort settings:", error);
    }

    try {
      const config = await getConfig();
      setGeminiThinkingInjection(config.geminiThinkingInjection ?? true);
    } catch (error) {
      console.error("Failed to fetch Gemini thinking injection setting:", error);
    }
  });

  const saveReasoningEffort = async () => {
    setSavingReasoningEffort(true);
    try {
      await setReasoningEffortSettings({
        level: reasoningEffortLevel(),
      });
      toastStore.success(
        t("settings.toasts.reasoningEffortUpdated", {
          level: reasoningEffortLevel(),
        }),
      );
    } catch (error) {
      console.error("Failed to save reasoning effort:", error);
      toastStore.error(t("settings.toasts.failedToSaveReasoningEffort"), String(error));
    } finally {
      setSavingReasoningEffort(false);
    }
  };

  const saveGeminiThinkingInjection = async (enabled: boolean) => {
    setSavingGeminiThinking(true);
    try {
      const currentConfig = await getConfig();
      await saveConfig({ ...currentConfig, geminiThinkingInjection: enabled });
      setGeminiThinkingInjection(enabled);
      toastStore.success(
        t("settings.toasts.geminiThinkingConfigInjection", {
          status: enabled ? t("settings.toasts.enabled") : t("settings.toasts.disabled"),
        }),
      );
    } catch (error) {
      console.error("Failed to save Gemini thinking injection:", error);
      toastStore.error(t("settings.toasts.failedToSaveSetting"), String(error));
    } finally {
      setSavingGeminiThinking(false);
    }
  };

  return (
    <div class="space-y-4">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
        {t("settings.reasoning.title")}
      </h2>

      <div class="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <p class="text-xs text-gray-500 dark:text-gray-400">
          {t("settings.reasoning.descriptionPrefix")}{" "}
          <code class="rounded bg-gray-200 px-1 dark:bg-gray-700">gpt-5(high)</code>
          {t("settings.reasoning.descriptionSuffix")}
        </p>

        <div class="space-y-3">
          <label class="block">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("settings.reasoning.defaultEffortLevel")}
            </span>
            <select
              class="transition-smooth mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 [&>option]:bg-white [&>option]:text-gray-900 [&>option]:dark:bg-gray-900 [&>option]:dark:text-gray-100"
              onChange={(e) =>
                setReasoningEffortLevel(e.currentTarget.value as ReasoningEffortLevel)
              }
              value={reasoningEffortLevel()}
            >
              <option value="none">{t("settings.level.noneDisabled")}</option>
              <option value="low">{t("settings.level.low1024")}</option>
              <option value="medium">{t("settings.level.medium8192Approx")}</option>
              <option value="high">{t("settings.level.high24576")}</option>
              <option value="xhigh">{t("settings.level.extraHigh32768")}</option>
            </select>
          </label>

          <div class="flex items-center justify-between pt-2">
            <span class="text-sm text-gray-600 dark:text-gray-400">
              {t("settings.reasoning.current")}:{" "}
              <span class="font-medium text-brand-600 dark:text-brand-400">
                {reasoningEffortLevel()}
              </span>
            </span>
            <Button
              disabled={savingReasoningEffort()}
              onClick={saveReasoningEffort}
              size="sm"
              variant="primary"
            >
              {savingReasoningEffort() ? t("common.saving") : t("settings.reasoning.apply")}
            </Button>
          </div>

          <div class="flex items-center justify-between border-t border-gray-200 pt-4 dark:border-gray-700">
            <div class="flex-1">
              <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("settings.thinkingBudget.geminiInjection.label")}
              </span>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("settings.thinkingBudget.geminiInjection.description")}
              </p>
            </div>
            <Switch
              checked={geminiThinkingInjection()}
              disabled={savingGeminiThinking()}
              onChange={(checked) => saveGeminiThinkingInjection(checked)}
            />
          </div>

          <p class="mt-3 border-t border-gray-200 pt-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
            <span class="font-medium">{t("settings.reasoning.perRequestOverride")}</span>{" "}
            {t("settings.reasoning.useModelSuffix")} model suffix like{" "}
            <code class="rounded bg-gray-200 px-1 dark:bg-gray-700">gpt-5(high)</code> or{" "}
            <code class="rounded bg-gray-200 px-1 dark:bg-gray-700">gpt-5.2(low)</code>
          </p>
        </div>
      </div>
    </div>
  );
}

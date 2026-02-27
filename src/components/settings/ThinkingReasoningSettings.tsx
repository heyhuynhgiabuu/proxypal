import { createEffect, createSignal, Show, splitProps } from "solid-js";
import { useI18n } from "../../i18n";
import {
  AMP_MODEL_SLOTS,
  getConfig,
  getReasoningEffortSettings,
  getThinkingBudgetSettings,
  getThinkingBudgetTokens,
  saveConfig,
  setReasoningEffortSettings,
  setThinkingBudgetSettings,
  startProxy,
  stopProxy,
  type ReasoningEffortLevel,
  type ThinkingBudgetSettings,
} from "../../lib/tauri";
import { appStore } from "../../stores/app";
import { toastStore } from "../../stores/toast";
import { Button, Switch } from "../ui";

import type { SettingsBaseProps } from "./types";

// GPT reasoning levels (static - these don't change)
const AMP_GPT_REASONING_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

type AmpGptReasoningLevel = (typeof AMP_GPT_REASONING_LEVELS)[number];

const AMP_GPT_SUFFIX_LEVEL_SET = new Set<AmpGptReasoningLevel>(
  AMP_GPT_REASONING_LEVELS.filter((level) => level !== "none") as AmpGptReasoningLevel[],
);

// Known model ID prefixes (e.g., copilot-gpt-5 -> gpt-5)
const KNOWN_MODEL_PREFIXES = ["copilot-"] as const;

const splitModelPrefix = (model: string): { prefix: string; unprefixed: string } => {
  for (const p of KNOWN_MODEL_PREFIXES) {
    if (model.startsWith(p)) {
      return { prefix: p, unprefixed: model.slice(p.length) };
    }
  }
  return { prefix: "", unprefixed: model };
};

// Helper functions that accept model set dynamically
const splitAmpGptReasoningAlias = (alias: string, gptModelSet: Set<string>) => {
  const match = alias.match(/^(.*)\(([^)]+)\)$/);
  if (!match) {
    return { base: alias, level: "none" as AmpGptReasoningLevel };
  }
  const base = match[1];
  const level = match[2] as AmpGptReasoningLevel;
  // Normalize prefix for membership testing
  const { unprefixed } = splitModelPrefix(base);
  // Only treat as reasoning suffix if unprefixed base is a known GPT model AND level is valid
  if (gptModelSet.has(unprefixed) && AMP_GPT_SUFFIX_LEVEL_SET.has(level)) {
    return { base, level };
  }
  // Not a GPT reasoning suffix - return original alias as base
  return { base: alias, level: "none" as AmpGptReasoningLevel };
};

const applyAmpGptReasoningLevel = (
  alias: string,
  level: AmpGptReasoningLevel,
  gptModelSet: Set<string>,
) => {
  const { base } = splitAmpGptReasoningAlias(alias, gptModelSet);
  const { unprefixed } = splitModelPrefix(base);
  // Check unprefixed base against model set
  if (!gptModelSet.has(unprefixed)) {
    return alias;
  }
  if (level === "none") {
    return base;
  }
  return `${base}(${level})`;
};

interface ThinkingReasoningSettingsProps extends SettingsBaseProps {
  gptBaseModels: () => string[];
  gptBaseModelSet: () => Set<string>;
}

export function ThinkingReasoningSettings(props: ThinkingReasoningSettingsProps) {
  const { t } = useI18n();
  const [local] = splitProps(props, [
    "config",
    "setConfig",
    "saving",
    "setSaving",
    "handleConfigChange",
    "gptBaseModels",
    "gptBaseModelSet",
  ]);

  const [thinkingBudgetMode, setThinkingBudgetMode] =
    createSignal<ThinkingBudgetSettings["mode"]>("medium");
  const [thinkingBudgetCustom, setThinkingBudgetCustom] = createSignal(16_000);
  const [savingThinkingBudget, setSavingThinkingBudget] = createSignal(false);

  const [geminiThinkingInjection, setGeminiThinkingInjection] = createSignal<boolean>(true);
  const [savingGeminiThinking, setSavingGeminiThinking] = createSignal(false);

  const [reasoningEffortLevel, setReasoningEffortLevel] =
    createSignal<ReasoningEffortLevel>("medium");
  const [savingReasoningEffort, setSavingReasoningEffort] = createSignal(false);
  const [savingSlotReasoningLevels, setSavingSlotReasoningLevels] = createSignal<Set<string>>(
    new Set(),
  );

  void local;

  createEffect(async () => {
    try {
      const thinkingSettings = await getThinkingBudgetSettings();
      setThinkingBudgetMode(thinkingSettings.mode);
      setThinkingBudgetCustom(thinkingSettings.customBudget);
    } catch (error) {
      console.error("Failed to fetch thinking budget settings:", error);
    }

    try {
      const config = await getConfig();
      setGeminiThinkingInjection(config.geminiThinkingInjection ?? true);
    } catch (error) {
      console.error("Failed to fetch Gemini thinking injection setting:", error);
    }

    try {
      const reasoningSettings = await getReasoningEffortSettings();
      setReasoningEffortLevel(reasoningSettings.level);
    } catch (error) {
      console.error("Failed to fetch reasoning effort settings:", error);
    }
  });

  const saveThinkingBudget = async () => {
    setSavingThinkingBudget(true);
    try {
      await setThinkingBudgetSettings({
        customBudget: thinkingBudgetCustom(),
        mode: thinkingBudgetMode(),
      });
      toastStore.success(
        t("settings.toasts.thinkingBudgetUpdated", {
          tokens: getThinkingBudgetTokens({
            customBudget: thinkingBudgetCustom(),
            mode: thinkingBudgetMode(),
          }),
        }),
      );
    } catch (error) {
      console.error("Failed to save thinking budget:", error);
      toastStore.error(t("settings.toasts.failedToSaveThinkingBudget"), String(error));
    } finally {
      setSavingThinkingBudget(false);
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

  const updateSlotReasoningLevel = async (slotId: string, level: AmpGptReasoningLevel) => {
    if (savingSlotReasoningLevels().has(slotId)) {
      return;
    }

    const modelSet = local.gptBaseModelSet();
    const slot = AMP_MODEL_SLOTS.find((s) => s.id === slotId);
    if (!slot) {
      return;
    }

    const originalMappings = local.config().ampModelMappings || [];
    const originalMapping = originalMappings.find((m) => m.name === slot.fromModel);
    const originalAlias = originalMapping?.alias;

    const computeUpdatedConfig = () => {
      const currentMappings = local.config().ampModelMappings || [];
      const existingMapping = currentMappings.find((m) => m.name === slot.fromModel);
      if (!existingMapping) {
        return null;
      }

      const nextAlias = applyAmpGptReasoningLevel(existingMapping.alias, level, modelSet);

      if (nextAlias === existingMapping.alias) {
        return null;
      }

      const newMappings = currentMappings.map((m) =>
        m.name === slot.fromModel ? { ...m, alias: nextAlias } : m,
      );
      return {
        config: { ...local.config(), ampModelMappings: newMappings },
        newAlias: nextAlias,
      };
    };

    const result = computeUpdatedConfig();
    if (!result) {
      return;
    }

    const { config: initialNewConfig, newAlias } = result;

    local.setConfig(initialNewConfig);
    setSavingSlotReasoningLevels((prev) => new Set(prev).add(slotId));

    try {
      await saveConfig(local.config());
    } catch (error) {
      const currentMappings = local.config().ampModelMappings || [];
      const currentMapping = currentMappings.find((m) => m.name === slot.fromModel);
      if (originalAlias !== undefined && currentMapping?.alias === newAlias) {
        const revertedMappings = currentMappings.map((m) =>
          m.name === slot.fromModel ? { ...m, alias: originalAlias } : m,
        );
        local.setConfig({ ...local.config(), ampModelMappings: revertedMappings });
      }
      toastStore.error(
        t("settings.toasts.failedToUpdateReasoningLevel"),
        error instanceof Error ? error.message : String(error),
      );
      return;
    } finally {
      setSavingSlotReasoningLevels((prev) => {
        const next = new Set(prev);
        next.delete(slotId);
        return next;
      });
    }

    if (appStore.proxyStatus().running) {
      try {
        await stopProxy();
        await new Promise((resolve) => setTimeout(resolve, 300));
        await startProxy();
      } catch (error) {
        toastStore.error(
          t("settings.toasts.reasoningLevelSavedButProxyRestartFailed"),
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  };

  void updateSlotReasoningLevel;

  return (
    <>
      <div class="space-y-4">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          {t("settings.thinkingBudget.title")}
        </h2>

        <div class="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {t("settings.thinkingBudget.description")}
          </p>

          <div class="space-y-3">
            <label class="block">
              <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("settings.thinkingBudget.budgetLevel")}
              </span>
              <select
                class="transition-smooth mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 [&>option]:bg-white [&>option]:text-gray-900 [&>option]:dark:bg-gray-900 [&>option]:dark:text-gray-100"
                onChange={(e) =>
                  setThinkingBudgetMode(e.currentTarget.value as ThinkingBudgetSettings["mode"])
                }
                value={thinkingBudgetMode()}
              >
                <option value="low">{t("settings.level.low2048")}</option>
                <option value="medium">{t("settings.level.medium8192")}</option>
                <option value="high">{t("settings.level.high32768")}</option>
                <option value="custom">{t("settings.level.custom")}</option>
              </select>
            </label>

            <Show when={thinkingBudgetMode() === "custom"}>
              <label class="block">
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("settings.thinkingBudget.customTokenBudget")}
                </span>
                <input
                  class="transition-smooth mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
                  max="200000"
                  min="1024"
                  onInput={(e) =>
                    setThinkingBudgetCustom(
                      Math.max(
                        1024,
                        Math.min(200_000, Number.parseInt(e.currentTarget.value) || 16_000),
                      ),
                    )
                  }
                  type="number"
                  value={thinkingBudgetCustom()}
                />
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t("settings.thinkingBudget.customRange")}
                </p>
              </label>
            </Show>

            <div class="flex items-center justify-between pt-2">
              <span class="text-sm text-gray-600 dark:text-gray-400">
                {t("settings.thinkingBudget.current")}:{" "}
                <span class="font-medium text-brand-600 dark:text-brand-400">
                  {getThinkingBudgetTokens({
                    customBudget: thinkingBudgetCustom(),
                    mode: thinkingBudgetMode(),
                  }).toLocaleString()}{" "}
                  {t("settings.thinkingBudget.tokens")}
                </span>
              </span>
              <Button
                disabled={savingThinkingBudget()}
                onClick={saveThinkingBudget}
                size="sm"
                variant="primary"
              >
                {savingThinkingBudget() ? t("common.saving") : t("settings.thinkingBudget.apply")}
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
          </div>
        </div>
      </div>

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

            <p class="mt-3 border-t border-gray-200 pt-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
              <span class="font-medium">{t("settings.reasoning.perRequestOverride")}</span>{" "}
              {t("settings.reasoning.useModelSuffix")} model suffix like{" "}
              <code class="rounded bg-gray-200 px-1 dark:bg-gray-700">gpt-5(high)</code> or{" "}
              <code class="rounded bg-gray-200 px-1 dark:bg-gray-700">gpt-5.2(low)</code>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

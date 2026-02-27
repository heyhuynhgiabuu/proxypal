import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { useI18n } from "../../i18n";
import {
  AMP_MODEL_SLOTS,
  getForceModelMappings,
  saveConfig,
  setForceModelMappings,
  startProxy,
  stopProxy,
} from "../../lib/tauri";
import { appStore } from "../../stores/app";
import { toastStore } from "../../stores/toast";
import { Button } from "../ui";

import type { AmpModelMapping } from "../../lib/tauri";
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

interface AmpSettingsProps extends SettingsBaseProps {
  getAvailableTargetModels: () => {
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
  gptBaseModels: () => string[];
  gptBaseModelSet: () => Set<string>;
}

export function AmpSettings(props: AmpSettingsProps) {
  const { t } = useI18n();

  // Custom mapping state (for adding new mappings beyond predefined slots)
  const [newMappingFrom, setNewMappingFrom] = createSignal("");
  const [newMappingTo, setNewMappingTo] = createSignal("");

  const [forceModelMappings, setForceModelMappingsState] = createSignal<boolean>(false);
  const [savingForceModelMappings, setSavingForceModelMappings] = createSignal(false);

  // Load forceModelMappings state reactively when proxy becomes running
  createEffect(() => {
    if (appStore.proxyStatus().running) {
      getForceModelMappings()
        .then((value) => setForceModelMappingsState(value))
        .catch(() => {
          // Fallback to false if fetch fails
        });
    }
  });
  const [savingSlotReasoningLevels, setSavingSlotReasoningLevels] = createSignal<Set<string>>(
    new Set(),
  );

  // Compute uniform reasoning level from existing GPT mappings (both slots and custom)
  // Returns: level if uniform, null if mixed, "none" if no GPT mappings
  const uniformGptReasoningLevel = createMemo<AmpGptReasoningLevel | null>(() => {
    const modelSet = props.gptBaseModelSet();
    if (modelSet.size === 0) {
      return "none";
    } // No GPT models available
    const mappings = props.config().ampModelMappings || [];

    // Collect all enabled mappings that target GPT models (both slots and custom)
    const gptMappings = mappings.filter((mapping) => {
      if (mapping.enabled === false) {
        return false;
      }
      const { base } = splitAmpGptReasoningAlias(mapping.alias, modelSet);
      const { unprefixed } = splitModelPrefix(base);
      return modelSet.has(unprefixed);
    });

    if (gptMappings.length === 0) {
      return "none";
    } // No GPT mappings configured

    let uniformLevel: AmpGptReasoningLevel | null = null;
    for (const mapping of gptMappings) {
      const { level } = splitAmpGptReasoningAlias(mapping.alias, modelSet);
      if (uniformLevel === null) {
        uniformLevel = level;
      } else if (uniformLevel !== level) {
        return null; // Mixed levels
      }
    }
    return uniformLevel;
  });

  // Handler for prioritize model mappings toggle
  const handleForceModelMappingsChange = async (value: boolean) => {
    setSavingForceModelMappings(true);
    try {
      await setForceModelMappings(value);
      setForceModelMappingsState(value);
      toastStore.success(
        t("settings.toasts.modelMappingPriority", {
          status: value ? t("settings.toasts.enabled") : t("settings.toasts.disabled"),
        }),
        value
          ? t("settings.toasts.modelMappingsTakePrecedence")
          : t("settings.toasts.localApiKeysTakePrecedence"),
      );
    } catch (error) {
      toastStore.error(t("settings.toasts.failedToUpdateModelMappingPriority"), String(error));
    } finally {
      setSavingForceModelMappings(false);
    }
  };

  // Helper to get mapping for a slot
  const getMappingForSlot = (slotId: string) => {
    const slot = AMP_MODEL_SLOTS.find((s) => s.id === slotId);
    if (!slot) {
      return null;
    }
    const mappings = props.config().ampModelMappings || [];
    return mappings.find((m) => m.name === slot.fromModel);
  };

  // Update mapping for a slot
  const updateSlotMapping = async (
    slotId: string,
    toModel: string,
    enabled: boolean,
    fork?: boolean,
  ) => {
    const slot = AMP_MODEL_SLOTS.find((s) => s.id === slotId);
    if (!slot) {
      return;
    }

    const currentMappings = props.config().ampModelMappings || [];
    // Get existing mapping to preserve fork setting if not explicitly provided
    const existingMapping = currentMappings.find((m) => m.name === slot.fromModel);
    // Remove existing mapping for this slot
    const filteredMappings = currentMappings.filter((m) => m.name !== slot.fromModel);

    // Add new mapping if enabled and has a target
    let newMappings: AmpModelMapping[];
    if (enabled && toModel) {
      newMappings = [
        ...filteredMappings,
        {
          alias: toModel,
          enabled: true,
          fork: fork ?? existingMapping?.fork ?? false,
          name: slot.fromModel,
        },
      ];
    } else {
      newMappings = filteredMappings;
    }

    const newConfig = { ...props.config(), ampModelMappings: newMappings };
    props.setConfig(newConfig);

    props.setSaving(true);
    try {
      await saveConfig(newConfig);
      // Restart proxy to regenerate config YAML with updated mappings
      if (appStore.proxyStatus().running) {
        await stopProxy();
        await new Promise((resolve) => setTimeout(resolve, 300));
        await startProxy();
      }
      toastStore.success(t("settings.toasts.modelMappingUpdated"));
    } catch (error) {
      console.error("Failed to save config:", error);
      toastStore.error(t("settings.toasts.settingsSaveFailed"), String(error));
    } finally {
      props.setSaving(false);
    }
  };

  // Get custom mappings (mappings that are not in predefined slots)
  const getCustomMappings = () => {
    const mappings = props.config().ampModelMappings || [];
    const slotFromModels = new Set(AMP_MODEL_SLOTS.map((s) => s.fromModel));
    return mappings.filter((m) => !slotFromModels.has(m.name));
  };

  // Add a custom mapping
  const addCustomMapping = async () => {
    const from = newMappingFrom().trim();
    const to = newMappingTo().trim();

    if (!from || !to) {
      toastStore.error(t("settings.toasts.fromAndToRequired"));
      return;
    }

    // Check for duplicates
    const existingMappings = props.config().ampModelMappings || [];
    if (existingMappings.some((m) => m.name === from)) {
      toastStore.error(t("settings.toasts.mappingAlreadyExists", { from }));
      return;
    }

    const newMapping: AmpModelMapping = {
      alias: to,
      enabled: true,
      name: from,
    };
    const newMappings = [...existingMappings, newMapping];

    const newConfig = { ...props.config(), ampModelMappings: newMappings };
    props.setConfig(newConfig);

    props.setSaving(true);
    try {
      await saveConfig(newConfig);
      toastStore.success(t("settings.toasts.customMappingAdded"));
      setNewMappingFrom("");
      setNewMappingTo("");
    } catch (error) {
      console.error("Failed to save config:", error);
      toastStore.error(t("settings.toasts.settingsSaveFailed"), String(error));
    } finally {
      props.setSaving(false);
    }
  };

  // Remove a custom mapping
  const removeCustomMapping = async (fromModel: string) => {
    const currentMappings = props.config().ampModelMappings || [];
    const newMappings = currentMappings.filter((m) => m.name !== fromModel);

    const newConfig = { ...props.config(), ampModelMappings: newMappings };
    props.setConfig(newConfig);

    props.setSaving(true);
    try {
      await saveConfig(newConfig);
      toastStore.success(t("settings.toasts.customMappingRemoved"));
    } catch (error) {
      console.error("Failed to save config:", error);
      toastStore.error(t("settings.toasts.settingsSaveFailed"), String(error));
    } finally {
      props.setSaving(false);
    }
  };

  // Update a single slot's reasoning level
  const updateSlotReasoningLevel = async (slotId: string, level: AmpGptReasoningLevel) => {
    // Guard against overlapping saves for the same slot
    if (savingSlotReasoningLevels().has(slotId)) {
      return;
    }

    const modelSet = props.gptBaseModelSet();
    const slot = AMP_MODEL_SLOTS.find((s) => s.id === slotId);
    if (!slot) {
      return;
    }

    // Capture original alias for this slot before any changes
    const originalMappings = props.config().ampModelMappings || [];
    const originalMapping = originalMappings.find((m) => m.name === slot.fromModel);
    const originalAlias = originalMapping?.alias;

    // Helper to compute updated mappings from current config
    const computeUpdatedConfig = () => {
      const currentMappings = props.config().ampModelMappings || [];
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
        config: { ...props.config(), ampModelMappings: newMappings },
        newAlias: nextAlias,
      };
    };

    const result = computeUpdatedConfig();
    if (!result) {
      return;
    }

    const { config: initialNewConfig, newAlias } = result;

    // Update UI immediately to prevent race conditions with rapid changes
    props.setConfig(initialNewConfig);
    setSavingSlotReasoningLevels((prev) => new Set(prev).add(slotId));

    try {
      // Save the CURRENT config state to include any concurrent changes
      await saveConfig(props.config());
    } catch (error) {
      // Revert only if the current alias still matches what we tried to save
      // (i.e., user hasn't made other changes to this slot while save was in flight)
      const currentMappings = props.config().ampModelMappings || [];
      const currentMapping = currentMappings.find((m) => m.name === slot.fromModel);
      if (originalAlias !== undefined && currentMapping?.alias === newAlias) {
        const revertedMappings = currentMappings.map((m) =>
          m.name === slot.fromModel ? { ...m, alias: originalAlias } : m,
        );
        props.setConfig({
          ...props.config(),
          ampModelMappings: revertedMappings,
        });
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

    // Proxy restart is separate - config is already persisted
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

  // Update an existing custom mapping
  const updateCustomMapping = async (
    fromModel: string,
    newToModel: string,
    enabled: boolean,
    fork?: boolean,
  ) => {
    const currentMappings = props.config().ampModelMappings || [];
    const newMappings = currentMappings.map((m) =>
      m.name === fromModel
        ? { ...m, alias: newToModel, enabled, fork: fork ?? m.fork ?? false }
        : m,
    );

    const newConfig = { ...props.config(), ampModelMappings: newMappings };
    props.setConfig(newConfig);

    props.setSaving(true);
    try {
      await saveConfig(newConfig);
      // Restart proxy to regenerate config YAML with updated mappings
      if (appStore.proxyStatus().running) {
        await stopProxy();
        await new Promise((resolve) => setTimeout(resolve, 300));
        await startProxy();
      }
      toastStore.success(t("settings.toasts.mappingUpdated"));
    } catch (error) {
      console.error("Failed to save config:", error);
      toastStore.error(t("settings.toasts.settingsSaveFailed"), String(error));
    } finally {
      props.setSaving(false);
    }
  };

  return (
    <div class="space-y-4">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
        Amp CLI Integration
      </h2>

      <div class="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <label class="block">
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Amp API Key</span>
          <input
            class="transition-smooth mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
            onInput={(e) => props.handleConfigChange("ampApiKey", e.currentTarget.value)}
            placeholder="amp_..."
            type="password"
            value={props.config().ampApiKey || ""}
          />
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Get your API key from{" "}
            <a
              class="text-brand-500 underline hover:text-brand-600"
              href="https://ampcode.com/settings"
              rel="noopener noreferrer"
              target="_blank"
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
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Model Mappings</span>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Route Amp model requests to different providers
            </p>
          </div>

          {/* Prioritize Model Mappings Toggle */}
          <Show when={appStore.proxyStatus().running}>
            <div class="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Prioritize Model Mappings
                  </span>
                  <Show when={savingForceModelMappings()}>
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
                  Force apply mappings. Required for custom models that are not natively recognized
                  by the proxy.
                </p>
              </div>
              <button
                aria-checked={forceModelMappings()}
                class={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 ${
                  forceModelMappings() ? "bg-brand-600" : "bg-gray-200 dark:bg-gray-700"
                }`}
                disabled={savingForceModelMappings()}
                onClick={() => handleForceModelMappingsChange(!forceModelMappings())}
                role="switch"
                type="button"
              >
                <span
                  aria-hidden="true"
                  class={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    forceModelMappings() ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </Show>

          {/* Slot-based mappings */}
          <div class="space-y-2">
            <For each={AMP_MODEL_SLOTS}>
              {(slot) => {
                const mapping = () => getMappingForSlot(slot.id);
                const isEnabled = () => {
                  const m = mapping();
                  return !!m && m.enabled !== false;
                };
                const currentTargetAlias = () => mapping()?.alias || "";
                // Strip reasoning suffix for dropdown matching (base model only)
                const currentTargetBase = () =>
                  splitAmpGptReasoningAlias(currentTargetAlias(), props.gptBaseModelSet()).base ||
                  "";
                // Get current reasoning level for this slot
                const currentReasoningLevel = () =>
                  splitAmpGptReasoningAlias(currentTargetAlias(), props.gptBaseModelSet()).level;
                // Check if current target is a GPT model
                const isGptTarget = () => {
                  const base = currentTargetBase();
                  const { unprefixed } = splitModelPrefix(base);
                  return props.gptBaseModelSet().has(unprefixed);
                };

                return (
                  <div class="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                    {/* Mobile: Stack vertically, Desktop: Single row */}
                    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                      {/* Left side: Checkbox + Slot name */}
                      <div class="flex shrink-0 items-center gap-2">
                        <input
                          checked={isEnabled()}
                          class="h-4 w-4 rounded border-gray-300 bg-gray-100 text-brand-500 focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700 dark:ring-offset-gray-800 dark:focus:ring-brand-600"
                          onChange={(e) => {
                            const checked = e.currentTarget.checked;
                            if (checked) {
                              const { builtInModels, customModels } =
                                props.getAvailableTargetModels();
                              const defaultTarget =
                                customModels[0]?.value ||
                                builtInModels.google[0]?.value ||
                                slot.fromModel;
                              // Use uniform reasoning level for new slots (or "none" if mixed)
                              const effectiveLevel = uniformGptReasoningLevel() ?? "none";
                              updateSlotMapping(
                                slot.id,
                                applyAmpGptReasoningLevel(
                                  defaultTarget,
                                  effectiveLevel,
                                  props.gptBaseModelSet(),
                                ),
                                true,
                              );
                            } else {
                              updateSlotMapping(slot.id, "", false);
                            }
                          }}
                          type="checkbox"
                        />
                        <span class="w-20 text-sm font-medium text-gray-700 dark:text-gray-300">
                          {slot.name}
                        </span>
                      </div>

                      {/* Right side: From -> To mapping */}
                      <div class="flex min-w-0 flex-1 items-center gap-2">
                        {/* From model (readonly) - fixed width, truncate on small screens */}
                        <div
                          class="w-24 shrink-0 truncate rounded-lg border border-gray-200 bg-gray-100 px-2 py-1.5 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 sm:w-28"
                          title={slot.fromLabel}
                        >
                          {slot.fromLabel}
                        </div>

                        {/* Arrow */}
                        <span class="shrink-0 text-xs text-gray-400">→</span>

                        {/* To model (dropdown) */}
                        {(() => {
                          const { builtInModels, customModels } = props.getAvailableTargetModels();
                          return (
                            <select
                              class={`transition-smooth min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 [&>optgroup]:bg-white [&>optgroup]:text-gray-900 [&>optgroup]:dark:bg-gray-900 [&>optgroup]:dark:text-gray-100 [&>option]:bg-white [&>option]:text-gray-900 [&>option]:dark:bg-gray-900 [&>option]:dark:text-gray-100 ${
                                !isEnabled() ? "cursor-not-allowed opacity-50" : ""
                              }`}
                              disabled={!isEnabled()}
                              onChange={(e) => {
                                const newTargetBase = e.currentTarget.value;
                                // Preserve current slot's reasoning level when changing target model
                                const nextAlias = applyAmpGptReasoningLevel(
                                  newTargetBase,
                                  currentReasoningLevel(),
                                  props.gptBaseModelSet(),
                                );
                                updateSlotMapping(slot.id, nextAlias, true);
                              }}
                              value={currentTargetBase()}
                            >
                              <option value="">{t("common.selectTarget")}</option>
                              <Show when={customModels.length > 0}>
                                <optgroup label="Custom Provider">
                                  <For each={customModels}>
                                    {(model) => <option value={model.value}>{model.label}</option>}
                                  </For>
                                </optgroup>
                              </Show>
                              <optgroup label="Anthropic">
                                <For each={builtInModels.anthropic}>
                                  {(model) => <option value={model.value}>{model.label}</option>}
                                </For>
                              </optgroup>
                              <optgroup label="Google">
                                <For each={builtInModels.google}>
                                  {(model) => <option value={model.value}>{model.label}</option>}
                                </For>
                              </optgroup>
                              <optgroup label="OpenAI">
                                <For each={builtInModels.openai}>
                                  {(model) => <option value={model.value}>{model.label}</option>}
                                </For>
                              </optgroup>
                              <optgroup label="Qwen">
                                <For each={builtInModels.qwen}>
                                  {(model) => <option value={model.value}>{model.label}</option>}
                                </For>
                              </optgroup>
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
                            </select>
                          );
                        })()}

                        {/* Fork toggle */}
                        <Show when={isEnabled()}>
                          <button
                            class={`shrink-0 rounded border px-2 py-1 text-xs transition-colors ${
                              mapping()?.fork
                                ? "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                                : "border-gray-300 bg-gray-100 text-gray-500 hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                            }`}
                            onClick={() => {
                              const currentFork = mapping()?.fork ?? false;
                              updateSlotMapping(slot.id, currentTargetAlias(), true, !currentFork);
                            }}
                            title="Fork: Send request to both original and mapped model"
                            type="button"
                          >
                            Fork
                          </button>
                        </Show>

                        {/* Per-slot reasoning dropdown - only show when target is GPT */}
                        <Show when={isEnabled() && isGptTarget()}>
                          <select
                            class={`min-w-[70px] shrink-0 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 dark:border-amber-700/50 dark:bg-amber-900/30 dark:text-amber-300 [&>option]:bg-white [&>option]:text-gray-900 [&>option]:dark:bg-gray-800 [&>option]:dark:text-gray-100 ${savingSlotReasoningLevels().has(slot.id) ? "cursor-not-allowed opacity-50" : ""}`}
                            disabled={savingSlotReasoningLevels().has(slot.id)}
                            onChange={(e) => {
                              const level = e.currentTarget.value as AmpGptReasoningLevel;
                              updateSlotReasoningLevel(slot.id, level);
                            }}
                            title="GPT reasoning level for this slot"
                            value={currentReasoningLevel()}
                          >
                            <option value="none">{t("settings.level.short.none")}</option>
                            <option value="minimal">{t("settings.level.short.min")}</option>
                            <option value="low">{t("settings.level.short.low")}</option>
                            <option value="medium">{t("settings.level.short.med")}</option>
                            <option value="high">{t("settings.level.short.high")}</option>
                            <option value="xhigh">{t("settings.level.short.xhigh")}</option>
                          </select>
                        </Show>
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>

          {/* Custom Mappings Section */}
          <div class="pt-2">
            <p class="mb-2 text-xs text-gray-500 dark:text-gray-400">
              Custom model mappings (for models not in predefined slots)
            </p>

            {/* Existing custom mappings */}
            <For each={getCustomMappings()}>
              {(mapping) => {
                const { builtInModels, customModels } = props.getAvailableTargetModels();
                return (
                  <div class="mb-2 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                      {/* Checkbox */}
                      <div class="flex shrink-0 items-center gap-2">
                        <input
                          checked={mapping.enabled !== false}
                          class="h-4 w-4 rounded border-gray-300 bg-gray-100 text-brand-500 focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700 dark:ring-offset-gray-800 dark:focus:ring-brand-600"
                          onChange={(e) => {
                            updateCustomMapping(
                              mapping.name,
                              mapping.alias,
                              e.currentTarget.checked,
                            );
                          }}
                          type="checkbox"
                        />
                        <span class="text-xs text-gray-500 dark:text-gray-400 sm:hidden">
                          Custom
                        </span>
                      </div>

                      {/* Mapping content */}
                      <div class="flex min-w-0 flex-1 items-center gap-2">
                        {/* From model (readonly) */}
                        <div
                          class="w-28 shrink-0 truncate rounded-lg border border-gray-200 bg-gray-100 px-2 py-1.5 font-mono text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 sm:w-32"
                          title={mapping.name}
                        >
                          {mapping.name}
                        </div>

                        {/* Arrow */}
                        <span class="shrink-0 text-xs text-gray-400">→</span>

                        {/* To model (dropdown) */}
                        <select
                          class={`transition-smooth min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 [&>optgroup]:bg-white [&>optgroup]:text-gray-900 [&>optgroup]:dark:bg-gray-900 [&>optgroup]:dark:text-gray-100 [&>option]:bg-white [&>option]:text-gray-900 [&>option]:dark:bg-gray-900 [&>option]:dark:text-gray-100 ${
                            mapping.enabled === false ? "cursor-not-allowed opacity-50" : ""
                          }`}
                          disabled={mapping.enabled === false}
                          onChange={(e) => {
                            const newTargetBase = e.currentTarget.value;
                            // Preserve current mapping's reasoning level
                            const currentLevel = splitAmpGptReasoningAlias(
                              mapping.alias,
                              props.gptBaseModelSet(),
                            ).level;
                            const nextAlias = applyAmpGptReasoningLevel(
                              newTargetBase,
                              currentLevel,
                              props.gptBaseModelSet(),
                            );
                            updateCustomMapping(mapping.name, nextAlias, mapping.enabled !== false);
                          }}
                          value={
                            splitAmpGptReasoningAlias(mapping.alias, props.gptBaseModelSet()).base
                          }
                        >
                          <option value="">{t("common.selectTarget")}</option>
                          <Show when={customModels.length > 0}>
                            <optgroup label="Custom Provider">
                              <For each={customModels}>
                                {(model) => <option value={model.value}>{model.label}</option>}
                              </For>
                            </optgroup>
                          </Show>
                          <optgroup label="Anthropic">
                            <For each={builtInModels.anthropic}>
                              {(model) => <option value={model.value}>{model.label}</option>}
                            </For>
                          </optgroup>
                          <optgroup label="Google">
                            <For each={builtInModels.google}>
                              {(model) => <option value={model.value}>{model.label}</option>}
                            </For>
                          </optgroup>
                          <optgroup label="OpenAI">
                            <For each={builtInModels.openai}>
                              {(model) => <option value={model.value}>{model.label}</option>}
                            </For>
                          </optgroup>
                          <optgroup label="Qwen">
                            <For each={builtInModels.qwen}>
                              {(model) => <option value={model.value}>{model.label}</option>}
                            </For>
                          </optgroup>
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
                        </select>

                        {/* Fork toggle */}
                        <Show when={mapping.enabled !== false}>
                          <button
                            class={`shrink-0 rounded border px-2 py-1 text-xs transition-colors ${
                              mapping.fork
                                ? "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                                : "border-gray-300 bg-gray-100 text-gray-500 hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                            }`}
                            onClick={() => {
                              updateCustomMapping(
                                mapping.name,
                                mapping.alias,
                                mapping.enabled !== false,
                                !mapping.fork,
                              );
                            }}
                            title="Fork: Send request to both original and mapped model"
                            type="button"
                          >
                            Fork
                          </button>
                        </Show>

                        {/* Delete button */}
                        <button
                          class="shrink-0 p-1.5 text-gray-400 transition-colors hover:text-red-500"
                          onClick={() => removeCustomMapping(mapping.name)}
                          title="Remove mapping"
                          type="button"
                        >
                          <svg
                            class="h-4 w-4"
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
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>

            {/* Add new custom mapping */}
            <div class="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-800">
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <input
                  class="transition-smooth min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 font-mono text-xs focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
                  onInput={(e) => setNewMappingFrom(e.currentTarget.value)}
                  placeholder="From model (e.g. my-custom-model)"
                  type="text"
                  value={newMappingFrom()}
                />
                <span class="hidden shrink-0 text-xs text-gray-400 sm:inline">→</span>
                {(() => {
                  const { builtInModels, customModels } = props.getAvailableTargetModels();
                  return (
                    <select
                      class="transition-smooth min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 [&>optgroup]:bg-white [&>optgroup]:text-gray-900 [&>optgroup]:dark:bg-gray-900 [&>optgroup]:dark:text-gray-100 [&>option]:bg-white [&>option]:text-gray-900 [&>option]:dark:bg-gray-900 [&>option]:dark:text-gray-100"
                      onChange={(e) => setNewMappingTo(e.currentTarget.value)}
                      value={newMappingTo()}
                    >
                      <option value="">{t("common.selectTarget")}</option>
                      <Show when={customModels.length > 0}>
                        <optgroup label="Custom Provider">
                          <For each={customModels}>
                            {(model) => <option value={model.value}>{model.label}</option>}
                          </For>
                        </optgroup>
                      </Show>
                      <optgroup label="Anthropic">
                        <For each={builtInModels.anthropic}>
                          {(model) => <option value={model.value}>{model.label}</option>}
                        </For>
                      </optgroup>
                      <optgroup label="Google">
                        <For each={builtInModels.google}>
                          {(model) => <option value={model.value}>{model.label}</option>}
                        </For>
                      </optgroup>
                      <optgroup label="OpenAI">
                        <For each={builtInModels.openai}>
                          {(model) => <option value={model.value}>{model.label}</option>}
                        </For>
                      </optgroup>
                      <optgroup label="Qwen">
                        <For each={builtInModels.qwen}>
                          {(model) => <option value={model.value}>{model.label}</option>}
                        </For>
                      </optgroup>
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
                    </select>
                  );
                })()}
                <Button
                  class="shrink-0"
                  disabled={!newMappingFrom().trim() || !newMappingTo().trim()}
                  onClick={addCustomMapping}
                  size="sm"
                  variant="secondary"
                >
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      d="M12 4v16m8-8H4"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                    />
                  </svg>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

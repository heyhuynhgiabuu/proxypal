import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { ModelsList } from "./ModelsList";

import type { ModelInfo } from "./ModelCard";

interface ModelsWidgetProps {
  loading?: boolean;
  models: ModelInfo[];
}

interface ProviderGroup {
  color: string;
  displayName: string;
  models: ModelInfo[];
  provider: string;
}

const getProviderDisplayName = (ownedBy: string): string => {
  const names: Record<string, string> = {
    anthropic: "Anthropic",
    antigravity: "Antigravity",
    copilot: "GitHub Copilot",
    google: "Google",
    iflow: "iFlow",
    kimi: "Kimi",
    kiro: "Kiro",
    openai: "OpenAI",
    qwen: "Qwen",
  };
  return names[ownedBy] || ownedBy.charAt(0).toUpperCase() + ownedBy.slice(1);
};

const getProviderColor = (ownedBy: string): string => {
  const colors: Record<string, string> = {
    anthropic: "bg-orange-500",
    antigravity: "bg-indigo-500",
    copilot: "bg-purple-500",
    google: "bg-blue-500",
    iflow: "bg-pink-500",
    kimi: "bg-yellow-500",
    kiro: "bg-teal-500",
    openai: "bg-green-500",
    qwen: "bg-cyan-500",
  };
  return colors[ownedBy] || "bg-gray-500";
};

// Derive provider to fix aliasing issues (e.g., antigravity models aliased to Gemini IDs)
const deriveProvider = (model: ModelInfo): string => {
  const id = model.id.toLowerCase();

  // GitHub Copilot
  if (id.startsWith("github-copilot/")) {
    return "copilot";
  }

  // Antigravity aliases (Claude models via Vertex AI)
  if (id.includes("antigravity") || id.startsWith("antigravity-")) {
    return "antigravity";
  }

  // Default to backend ownedBy
  return model.ownedBy.toLowerCase();
};

export const ModelsWidget: Component<ModelsWidgetProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const [selectedProvider, setSelectedProvider] = createSignal<string | null>(null);

  // Group models by provider (with frontend override)
  const providerGroups = createMemo<ProviderGroup[]>(() => {
    const groups: Record<string, ModelInfo[]> = {};

    for (const model of props.models) {
      const provider = deriveProvider(model);
      if (!groups[provider]) {
        groups[provider] = [];
      }
      groups[provider].push(model);
    }

    return Object.entries(groups)
      .map(([provider, models]) => ({
        color: getProviderColor(provider),
        displayName: getProviderDisplayName(provider),
        models,
        provider,
      }))
      .sort((a, b) => b.models.length - a.models.length);
  });

  const totalModels = () => props.models.length;
  const maxModelsInGroup = () => Math.max(...providerGroups().map((g) => g.models.length), 1);

  return (
    <div class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      {/* Header */}
      <div class="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <svg
              class="h-5 w-5 text-brand-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
            <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Available Models</h3>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium text-gray-500 dark:text-gray-400">
              {totalModels()} total
            </span>
            <button
              class="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
              onClick={() => setExpanded(!expanded())}
              type="button"
            >
              {expanded() ? "Collapse" : "Expand"}
            </button>
          </div>
        </div>
      </div>

      {/* Loading State */}
      <Show when={props.loading}>
        <div class="px-4 py-8 text-center">
          <div class="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading models...</p>
        </div>
      </Show>

      {/* Empty State */}
      <Show when={!props.loading && totalModels() === 0}>
        <div class="px-4 py-8 text-center">
          <svg
            class="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
            />
          </svg>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">No models available</p>
          <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
            Start the proxy and authenticate with providers
          </p>
        </div>
      </Show>

      {/* Provider Bars (Collapsed View) */}
      <Show when={!props.loading && totalModels() > 0 && !expanded()}>
        <div class="space-y-2 px-4 py-3">
          <For each={providerGroups()}>
            {(group) => (
              <button
                class="group w-full"
                onClick={() => {
                  setSelectedProvider(
                    selectedProvider() === group.provider ? null : group.provider,
                  );
                  if (selectedProvider() === group.provider) {
                    setExpanded(true);
                  }
                }}
                type="button"
              >
                <div class="mb-1 flex items-center justify-between">
                  <span class="text-xs font-medium text-gray-700 group-hover:text-brand-600 dark:text-gray-300 dark:group-hover:text-brand-400">
                    {group.displayName}
                  </span>
                  <span class="text-xs text-gray-500 dark:text-gray-400">
                    {group.models.length} models
                  </span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                  <div
                    class={`h-full ${group.color} transition-all group-hover:opacity-80`}
                    style={{
                      width: `${(group.models.length / maxModelsInGroup()) * 100}%`,
                    }}
                  />
                </div>
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Expanded View with Model Lists */}
      <Show when={!props.loading && totalModels() > 0 && expanded()}>
        <div class="max-h-96 space-y-1 overflow-y-auto px-4 py-3">
          <For each={providerGroups()}>
            {(group) => (
              <ModelsList
                compact={true}
                defaultExpanded={
                  selectedProvider() === group.provider || providerGroups().length === 1
                }
                maxVisible={3}
                models={group.models}
                title={group.displayName}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default ModelsWidget;

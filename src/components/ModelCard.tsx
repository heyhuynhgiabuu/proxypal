import { ProviderBadge } from "./ProviderBadge";

import type { Component } from "solid-js";

export interface ModelInfo {
  contextWindow?: string;
  displayName?: string;
  id: string;
  ownedBy: string;
  source: string;
  supportsThinking?: boolean;
}

interface ModelCardProps {
  compact?: boolean;
  model: ModelInfo;
}

// Helper to get human-readable model name
const getDisplayName = (modelId: string): string => {
  return modelId
    .replaceAll("-", " ")
    .replaceAll(".", " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

// Helper to get context window info based on model
const getContextWindow = (modelId: string): string | null => {
  const id = modelId.toLowerCase();
  if (id.includes("gemini-2.5") || id.includes("gemini-3")) {
    return "1M";
  }
  if (id.includes("claude-sonnet-4") || id.includes("claude-3")) {
    return "200K";
  }
  if (id.includes("gpt-4") || id.includes("o1") || id.includes("o3")) {
    return "128K";
  }
  if (id.includes("codex") || id.includes("copilot")) {
    return "128K";
  }
  return null;
};

// Helper to check if model supports thinking
const supportsThinking = (modelId: string): boolean => {
  const id = modelId.toLowerCase();
  return (
    id.includes("sonnet-4") ||
    id.includes("gemini-2.5") ||
    id.includes("gemini-3") ||
    id.includes("o1") ||
    id.includes("o3")
  );
};

export const ModelCard: Component<ModelCardProps> = (props) => {
  const compact = () => props.compact ?? false;
  const displayName = () => props.model.displayName || getDisplayName(props.model.id);
  const contextWindow = () => props.model.contextWindow || getContextWindow(props.model.id);
  const hasThinking = () => props.model.supportsThinking ?? supportsThinking(props.model.id);

  if (compact()) {
    return (
      <div class="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 transition-colors hover:bg-gray-100 dark:bg-gray-800/50 dark:hover:bg-gray-800">
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {props.model.id}
          </span>
        </div>
        <div class="flex flex-shrink-0 items-center gap-2">
          <ProviderBadge size="sm" source={props.model.source} />
        </div>
      </div>
    );
  }

  return (
    <div class="rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-brand-300 dark:border-gray-700 dark:bg-gray-800/50 dark:hover:border-brand-600">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <h4 class="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
            {props.model.id}
          </h4>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{displayName()}</p>
        </div>
        <ProviderBadge size="sm" source={props.model.source} />
      </div>

      <div class="mt-2 flex items-center gap-2">
        {contextWindow() && (
          <span class="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
            {contextWindow()} ctx
          </span>
        )}
        {hasThinking() && (
          <span class="inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            💭 Thinking
          </span>
        )}
      </div>
    </div>
  );
};

export default ModelCard;

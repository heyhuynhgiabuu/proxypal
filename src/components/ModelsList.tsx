import { type Component, createSignal, For, Show } from "solid-js";
import { ModelCard, type ModelInfo } from "./ModelCard";

interface ModelsListProps {
  compact?: boolean;
  defaultExpanded?: boolean;
  maxVisible?: number;
  models: ModelInfo[];
  title?: string;
}

export const ModelsList: Component<ModelsListProps> = (props) => {
  const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? false);
  const [showAll, setShowAll] = createSignal(false);

  const maxVisible = () => props.maxVisible ?? 5;
  const compact = () => props.compact ?? false;
  const title = () => props.title ?? "Available Models";

  const visibleModels = () => {
    if (showAll() || props.models.length <= maxVisible()) {
      return props.models;
    }
    return props.models.slice(0, maxVisible());
  };

  const hasMore = () => props.models.length > maxVisible();
  const remainingCount = () => props.models.length - maxVisible();

  return (
    <div class="w-full">
      {/* Header */}
      <button
        class="flex w-full items-center justify-between rounded-lg px-1 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
        onClick={() => setExpanded(!expanded())}
        type="button"
      >
        <div class="flex items-center gap-2">
          <svg
            class={`h-4 w-4 text-gray-500 transition-transform ${expanded() ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M9 5l7 7-7 7"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{title()}</span>
        </div>
        <span class="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
          {props.models.length}
        </span>
      </button>

      {/* Models List */}
      <Show when={expanded()}>
        <div class="mt-2 space-y-2 pl-6">
          <For each={visibleModels()}>
            {(model) => <ModelCard compact={compact()} model={model} />}
          </For>

          {/* Show More Button */}
          <Show when={hasMore() && !showAll()}>
            <button
              class="w-full py-2 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
              onClick={() => setShowAll(true)}
              type="button"
            >
              Show {remainingCount()} more models...
            </button>
          </Show>

          {/* Show Less Button */}
          <Show when={showAll() && hasMore()}>
            <button
              class="w-full py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              onClick={() => setShowAll(false)}
              type="button"
            >
              Show less
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default ModelsList;

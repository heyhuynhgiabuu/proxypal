import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import type { ModelInfo } from "./ModelCard";
import { ModelsList } from "./ModelsList";

interface ModelsWidgetProps {
	models: ModelInfo[];
	loading?: boolean;
}

interface ProviderGroup {
	provider: string;
	displayName: string;
	models: ModelInfo[];
	color: string;
}

const getProviderDisplayName = (ownedBy: string): string => {
	const names: Record<string, string> = {
		anthropic: "Anthropic",
		google: "Google",
		openai: "OpenAI",
		copilot: "GitHub Copilot",
		qwen: "Qwen",
		iflow: "iFlow",
		antigravity: "Antigravity",
	};
	return names[ownedBy] || ownedBy.charAt(0).toUpperCase() + ownedBy.slice(1);
};

const getProviderColor = (ownedBy: string): string => {
	const colors: Record<string, string> = {
		anthropic: "bg-orange-500",
		google: "bg-blue-500",
		openai: "bg-green-500",
		copilot: "bg-purple-500",
		qwen: "bg-cyan-500",
		iflow: "bg-pink-500",
		antigravity: "bg-indigo-500",
	};
	return colors[ownedBy] || "bg-gray-500";
};

// Derive provider to fix aliasing issues (e.g., antigravity models aliased to Gemini IDs)
const deriveProvider = (model: ModelInfo): string => {
	const id = model.id.toLowerCase();

	// GitHub Copilot
	if (id.startsWith("github-copilot/")) return "copilot";

	// Antigravity aliases (Gemini + Claude hybrids)
	if (id.includes("gemini-claude") || id.startsWith("antigravity-")) {
		return "antigravity";
	}

	// Default to backend ownedBy
	return model.ownedBy.toLowerCase();
};

export const ModelsWidget: Component<ModelsWidgetProps> = (props) => {
	const [expanded, setExpanded] = createSignal(false);
	const [selectedProvider, setSelectedProvider] = createSignal<string | null>(
		null,
	);

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
				provider,
				displayName: getProviderDisplayName(provider),
				models,
				color: getProviderColor(provider),
			}))
			.sort((a, b) => b.models.length - a.models.length);
	});

	const totalModels = () => props.models.length;
	const maxModelsInGroup = () =>
		Math.max(...providerGroups().map((g) => g.models.length), 1);

	return (
		<div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
			{/* Header */}
			<div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<svg
							class="w-5 h-5 text-brand-500"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
							/>
						</svg>
						<h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">
							Available Models
						</h3>
					</div>
					<div class="flex items-center gap-2">
						<span class="text-xs font-medium text-gray-500 dark:text-gray-400">
							{totalModels()} total
						</span>
						<button
							type="button"
							onClick={() => setExpanded(!expanded())}
							class="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium"
						>
							{expanded() ? "Collapse" : "Expand"}
						</button>
					</div>
				</div>
			</div>

			{/* Loading State */}
			<Show when={props.loading}>
				<div class="px-4 py-8 text-center">
					<div class="animate-spin w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full mx-auto" />
					<p class="text-sm text-gray-500 dark:text-gray-400 mt-2">
						Loading models...
					</p>
				</div>
			</Show>

			{/* Empty State */}
			<Show when={!props.loading && totalModels() === 0}>
				<div class="px-4 py-8 text-center">
					<svg
						class="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
						/>
					</svg>
					<p class="text-sm text-gray-500 dark:text-gray-400 mt-2">
						No models available
					</p>
					<p class="text-xs text-gray-400 dark:text-gray-500 mt-1">
						Start the proxy and authenticate with providers
					</p>
				</div>
			</Show>

			{/* Provider Bars (Collapsed View) */}
			<Show when={!props.loading && totalModels() > 0 && !expanded()}>
				<div class="px-4 py-3 space-y-2">
					<For each={providerGroups()}>
						{(group) => (
							<button
								type="button"
								onClick={() => {
									setSelectedProvider(
										selectedProvider() === group.provider
											? null
											: group.provider,
									);
									if (selectedProvider() === group.provider) {
										setExpanded(true);
									}
								}}
								class="w-full group"
							>
								<div class="flex items-center justify-between mb-1">
									<span class="text-xs font-medium text-gray-700 dark:text-gray-300 group-hover:text-brand-600 dark:group-hover:text-brand-400">
										{group.displayName}
									</span>
									<span class="text-xs text-gray-500 dark:text-gray-400">
										{group.models.length} models
									</span>
								</div>
								<div class="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
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
				<div class="px-4 py-3 space-y-1 max-h-96 overflow-y-auto">
					<For each={providerGroups()}>
						{(group) => (
							<ModelsList
								models={group.models}
								title={group.displayName}
								defaultExpanded={
									selectedProvider() === group.provider ||
									providerGroups().length === 1
								}
								compact={true}
								maxVisible={3}
							/>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
};

export default ModelsWidget;

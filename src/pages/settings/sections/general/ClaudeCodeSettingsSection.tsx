import type { Accessor } from "solid-js";
import { For, Show } from "solid-js";

import type { ClaudeCodeSettings } from "../../../../lib/tauri";
import type { SettingsTab } from "../../types";

type ModelOption = { value: string; label: string };
type AvailableTargetModels = {
	customModels: ModelOption[];
	builtInModels: {
		anthropic: ModelOption[];
		google: ModelOption[];
		openai: ModelOption[];
		copilot: ModelOption[];
		qwen: ModelOption[];
		iflow: ModelOption[];
	};
};

export interface ClaudeCodeSettingsSectionProps {
	activeTab: Accessor<SettingsTab>;
	claudeCodeSettings: Accessor<ClaudeCodeSettings>;
	getAvailableTargetModels: () => AvailableTargetModels;
	handleClaudeCodeSettingChange: (
		modelType: "haikuModel" | "opusModel" | "sonnetModel",
		modelName: string,
	) => void | Promise<void>;
}

export function ClaudeCodeSettingsSection(props: ClaudeCodeSettingsSectionProps) {
	const {
		activeTab,
		claudeCodeSettings,
		getAvailableTargetModels,
		handleClaudeCodeSettingChange,
	} = props;

	return (
		<div class="space-y-4" classList={{ hidden: activeTab() !== "general" }}>
			<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
				Claude Code Settings
			</h2>

			<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
				<p class="text-xs text-gray-500 dark:text-gray-400">
					Map Claude Code model slots to available provider models. These
					settings modify the claude_desktop_config.json file.
				</p>

				<div class="space-y-3">
					{(() => {
						const { customModels, builtInModels } = getAvailableTargetModels();
						const hasModels =
							customModels.length > 0 ||
							builtInModels.anthropic.length > 0 ||
							builtInModels.google.length > 0 ||
							builtInModels.openai.length > 0 ||
							builtInModels.copilot.length > 0;

						if (!hasModels) {
							return (
								<p class="text-sm text-gray-500 dark:text-gray-400 italic">
									No models available. Please authenticate with a provider first.
								</p>
							);
						}

						const ModelSelect = (localProps: {
							label: string;
							value: string | null;
							modelType: "haikuModel" | "opusModel" | "sonnetModel";
						}) => (
							<label class="block">
								<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
									{localProps.label}
								</span>
								<select
									value={localProps.value || ""}
									onChange={(e) =>
										handleClaudeCodeSettingChange(
											localProps.modelType,
											e.currentTarget.value,
										)
									}
									class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth [&>option]:bg-white [&>option]:dark:bg-gray-900 [&>option]:text-gray-900 [&>option]:dark:text-gray-100 [&>optgroup]:bg-white [&>optgroup]:dark:bg-gray-900 [&>optgroup]:text-gray-900 [&>optgroup]:dark:text-gray-100"
								>
									<option value="">Select model...</option>
									<Show when={customModels.length > 0}>
										<optgroup label="Custom Providers">
											<For each={customModels}>
												{(model) => (
													<option value={model.value}>{model.label}</option>
												)}
											</For>
										</optgroup>
									</Show>
									<Show when={builtInModels.anthropic.length > 0}>
										<optgroup label="Anthropic">
											<For each={builtInModels.anthropic}>
												{(model) => (
													<option value={model.value}>{model.label}</option>
												)}
											</For>
										</optgroup>
									</Show>
									<Show when={builtInModels.google.length > 0}>
										<optgroup label="Google">
											<For each={builtInModels.google}>
												{(model) => (
													<option value={model.value}>{model.label}</option>
												)}
											</For>
										</optgroup>
									</Show>
									<Show when={builtInModels.openai.length > 0}>
										<optgroup label="OpenAI">
											<For each={builtInModels.openai}>
												{(model) => (
													<option value={model.value}>{model.label}</option>
												)}
											</For>
										</optgroup>
									</Show>
									<Show when={builtInModels.copilot.length > 0}>
										<optgroup label="GitHub Copilot">
											<For each={builtInModels.copilot}>
												{(model) => (
													<option value={model.value}>{model.label}</option>
												)}
											</For>
										</optgroup>
									</Show>
									<Show when={builtInModels.qwen.length > 0}>
										<optgroup label="Qwen">
											<For each={builtInModels.qwen}>
												{(model) => (
													<option value={model.value}>{model.label}</option>
												)}
											</For>
										</optgroup>
									</Show>
									<Show when={builtInModels.iflow.length > 0}>
										<optgroup label="iFlow">
											<For each={builtInModels.iflow}>
												{(model) => (
													<option value={model.value}>{model.label}</option>
												)}
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
									value={claudeCodeSettings().haikuModel}
									modelType="haikuModel"
								/>
								<ModelSelect
									label="Sonnet Model"
									value={claudeCodeSettings().sonnetModel}
									modelType="sonnetModel"
								/>
								<ModelSelect
									label="Opus Model"
									value={claudeCodeSettings().opusModel}
									modelType="opusModel"
								/>
							</>
						);
					})()}
				</div>
			</div>
		</div>
	);
}


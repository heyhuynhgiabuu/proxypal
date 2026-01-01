import type { Accessor, Setter } from "solid-js";
import { For, Show } from "solid-js";

import { Button, Switch } from "../../../components/ui";
import type { AppConfig, OAuthExcludedModels } from "../../../lib/tauri";
import type { SettingsTab } from "../types";

type ModelOption = { value: string; label: string };
type AvailableTargetModels = {
	builtInModels: {
		anthropic: ModelOption[];
		google: ModelOption[];
		openai: ModelOption[];
		qwen: ModelOption[];
		iflow: ModelOption[];
		copilot: ModelOption[];
	};
};

export interface AdvancedSettingsSectionProps {
	activeTab: Accessor<SettingsTab>;
	config: Accessor<AppConfig>;
	handleConfigChange: (
		key: keyof AppConfig,
		value: boolean | number | string,
	) => void | Promise<void>;
	proxyRunning: Accessor<boolean>;

	websocketAuth: Accessor<boolean>;
	savingWebsocketAuth: Accessor<boolean>;
	handleWebsocketAuthChange: (value: boolean) => void | Promise<void>;

	newExcludedProvider: Accessor<string>;
	setNewExcludedProvider: Setter<string>;
	newExcludedModel: Accessor<string>;
	setNewExcludedModel: Setter<string>;
	handleAddExcludedModel: () => void | Promise<void>;
	handleRemoveExcludedModel: (
		provider: string,
		model: string,
	) => void | Promise<void>;
	savingExcludedModels: Accessor<boolean>;
	loadingExcludedModels: Accessor<boolean>;
	oauthExcludedModels: Accessor<OAuthExcludedModels>;

	getAvailableTargetModels: () => AvailableTargetModels;
}

export function AdvancedSettingsSection(props: AdvancedSettingsSectionProps) {
	const {
		activeTab,
		config,
		handleConfigChange,
		proxyRunning,
		websocketAuth,
		savingWebsocketAuth,
		handleWebsocketAuthChange,
		newExcludedProvider,
		setNewExcludedProvider,
		newExcludedModel,
		setNewExcludedModel,
		handleAddExcludedModel,
		handleRemoveExcludedModel,
		savingExcludedModels,
		loadingExcludedModels,
		oauthExcludedModels,
		getAvailableTargetModels,
	} = props;

	return (
		<>
			{/* Advanced Settings */}
			<div class="space-y-4" classList={{ hidden: activeTab() !== "advanced" }}>
				<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
					Advanced Settings
				</h2>

				<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
					<Switch
						label="Debug Mode"
						description="Enable verbose logging for troubleshooting"
						checked={config().debug}
						onChange={(checked) => handleConfigChange("debug", checked)}
					/>

					<div class="border-t border-gray-200 dark:border-gray-700" />

					<Switch
						label="Usage Statistics"
						description="Track request counts and token usage"
						checked={config().usageStatsEnabled}
						onChange={(checked) => handleConfigChange("usageStatsEnabled", checked)}
					/>

					<div class="border-t border-gray-200 dark:border-gray-700" />

					<Switch
						label="Request Logging"
						description="Log all API requests for debugging"
						checked={config().requestLogging}
						onChange={(checked) => handleConfigChange("requestLogging", checked)}
					/>

					<div class="border-t border-gray-200 dark:border-gray-700" />

					<Switch
						label="Commercial Mode"
						description="Disable request logging middleware for lower memory usage (requires restart)"
						checked={config().commercialMode ?? false}
						onChange={(checked) => handleConfigChange("commercialMode", checked)}
					/>

					<div class="border-t border-gray-200 dark:border-gray-700" />

					<Switch
						label="Log to File"
						description="Write logs to rotating files instead of stdout"
						checked={config().loggingToFile}
						onChange={(checked) => handleConfigChange("loggingToFile", checked)}
					/>

					<Show when={config().loggingToFile}>
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
								type="number"
								min="10"
								max="1000"
								value={config().logsMaxTotalSizeMb || 100}
								onChange={(e) =>
									handleConfigChange(
										"logsMaxTotalSizeMb",
										parseInt(e.currentTarget.value) || 100,
									)
								}
								class="w-24 px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-right focus:ring-2 focus:ring-brand-500 focus:border-transparent"
							/>
						</div>
					</Show>

					<Show when={proxyRunning()}>
						<div class="border-t border-gray-200 dark:border-gray-700" />

						<div class="flex items-center justify-between">
							<div class="flex-1">
								<div class="flex items-center gap-2">
									<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
										WebSocket Authentication
									</span>
									<Show when={savingWebsocketAuth()}>
										<svg
											class="w-4 h-4 animate-spin text-brand-500"
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
												fill="currentColor"
												d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
											/>
										</svg>
									</Show>
								</div>
								<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
									Require authentication for WebSocket connections. Updates live
									without restart.
								</p>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={websocketAuth()}
								disabled={savingWebsocketAuth()}
								onClick={() => handleWebsocketAuthChange(!websocketAuth())}
								class={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 ${
									websocketAuth() ? "bg-brand-600" : "bg-gray-200 dark:bg-gray-700"
								}`}
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

			{/* Quota Exceeded Behavior */}
			<div class="space-y-4" classList={{ hidden: activeTab() !== "advanced" }}>
				<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
					Quota Exceeded Behavior
				</h2>

				<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
					<Switch
						label="Auto-switch Project"
						description="Automatically switch to another project when quota is exceeded"
						checked={config().quotaSwitchProject}
						onChange={(checked) => handleConfigChange("quotaSwitchProject", checked)}
					/>

					<div class="border-t border-gray-200 dark:border-gray-700" />

					<Switch
						label="Switch to Preview Model"
						description="Fall back to preview/beta models when quota is exceeded"
						checked={config().quotaSwitchPreviewModel}
						onChange={(checked) =>
							handleConfigChange("quotaSwitchPreviewModel", checked)
						}
					/>
				</div>
			</div>

			{/* OAuth Excluded Models */}
			<Show when={proxyRunning()}>
				<div class="space-y-4" classList={{ hidden: activeTab() !== "advanced" }}>
					<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
						OAuth Excluded Models
					</h2>

					<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
						<p class="text-xs text-gray-500 dark:text-gray-400">
							Block specific models from being used with OAuth providers. Updates
							live without restart.
						</p>

						{/* Add new exclusion form */}
						<div class="flex gap-2">
							<select
								value={newExcludedProvider()}
								onChange={(e) => setNewExcludedProvider(e.currentTarget.value)}
								class="flex-1 px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent [&>option]:bg-white [&>option]:dark:bg-gray-900 [&>option]:text-gray-900 [&>option]:dark:text-gray-100"
							>
								<option value="">Select provider...</option>
								<option value="gemini">Gemini</option>
								<option value="claude">Claude</option>
								<option value="qwen">Qwen</option>
								<option value="iflow">iFlow</option>
								<option value="openai">OpenAI</option>
								<option value="copilot">GitHub Copilot</option>
							</select>

							{/* Model dropdown with mapped models from Amp CLI */}
							{(() => {
								const mappings = config().ampModelMappings || [];
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
										case "copilot":
											return builtInModels.copilot;
										default:
											return [];
									}
								};

								return (
									<select
										value={newExcludedModel()}
										onChange={(e) => setNewExcludedModel(e.currentTarget.value)}
										class="flex-[2] px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent [&>option]:bg-white [&>option]:dark:bg-gray-900 [&>option]:text-gray-900 [&>option]:dark:text-gray-100 [&>optgroup]:bg-white [&>optgroup]:dark:bg-gray-900 [&>optgroup]:text-gray-900 [&>optgroup]:dark:text-gray-100"
									>
										<option value="">Select model...</option>
										<Show when={mappedModels.length > 0}>
											<optgroup label="Amp Model Mappings">
												<For each={[...new Set(mappedModels)]}>
													{(model) => <option value={model}>{model}</option>}
												</For>
											</optgroup>
										</Show>
										<Show when={getModelsForProvider().length > 0}>
											<optgroup
												label={`${newExcludedProvider() || "Provider"} Models`}
											>
												<For each={getModelsForProvider()}>
													{(model) => (
														<option value={model.value}>{model.label}</option>
													)}
												</For>
											</optgroup>
										</Show>
									</select>
								);
							})()}

							<Button
								variant="primary"
								size="sm"
								onClick={handleAddExcludedModel}
								disabled={
									savingExcludedModels() ||
									!newExcludedProvider() ||
									!newExcludedModel()
								}
							>
								<Show when={savingExcludedModels()} fallback={<span>Add</span>}>
									<svg
										class="w-4 h-4 animate-spin"
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
											fill="currentColor"
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
										/>
									</svg>
								</Show>
							</Button>
						</div>

						{/* Current exclusions */}
						<Show when={loadingExcludedModels()}>
							<div class="text-center py-4 text-gray-500">Loading...</div>
						</Show>

						<Show
							when={
								!loadingExcludedModels() &&
								Object.keys(oauthExcludedModels()).length === 0
							}
						>
							<div class="text-center py-4 text-gray-400 dark:text-gray-500 text-sm">
								No models excluded yet
							</div>
						</Show>

						<Show
							when={
								!loadingExcludedModels() &&
								Object.keys(oauthExcludedModels()).length > 0
							}
						>
							<div class="space-y-3">
								<For each={Object.entries(oauthExcludedModels())}>
									{([provider, models]) => (
										<div class="space-y-2">
											<div class="flex items-center gap-2">
												<span class="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">
													{provider}
												</span>
												<span class="text-xs text-gray-400">
													({models.length} excluded)
												</span>
											</div>
											<div class="flex flex-wrap gap-2">
												<For each={models}>
													{(model) => (
														<span class="inline-flex items-center gap-1 px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-md text-xs">
															{model}
															<button
																type="button"
																onClick={() =>
																	handleRemoveExcludedModel(provider, model)
																}
																disabled={savingExcludedModels()}
																class="hover:text-red-900 dark:hover:text-red-300 disabled:opacity-50"
																title="Remove"
															>
																<svg
																	class="w-3 h-3"
																	fill="none"
																	stroke="currentColor"
																	viewBox="0 0 24 24"
																>
																	<path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		stroke-width="2"
																		d="M6 18L18 6M6 6l12 12"
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
		</>
	);
}


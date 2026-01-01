import type { Accessor, Setter } from "solid-js";
import { For, Show } from "solid-js";

import { Button } from "../../../components/ui";

import { AMP_MODEL_SLOTS } from "../../../lib/tauri";
import type {
	AmpModelMapping,
	AmpOpenAIModel,
	AmpOpenAIProvider,
	AppConfig,
	ProviderTestResult,
} from "../../../lib/tauri";

import { OpenAIProviderModal } from "../modals/OpenAIProviderModal";
import type { SettingsTab } from "../types";

type ModelOption = { value: string; label: string };
type AvailableTargetModels = {
	customModels: ModelOption[];
	builtInModels: {
		anthropic: ModelOption[];
		google: ModelOption[];
		openai: ModelOption[];
		qwen: ModelOption[];
		iflow: ModelOption[];
		copilot: ModelOption[];
	};
};

export interface AmpCliIntegrationSectionProps {
	activeTab: Accessor<SettingsTab>;
	config: Accessor<AppConfig>;
	handleConfigChange: (
		key: keyof AppConfig,
		value: boolean | number | string,
	) => void | Promise<void>;
	proxyRunning: Accessor<boolean>;

	savingForceModelMappings: Accessor<boolean>;
	forceModelMappings: Accessor<boolean>;
	handleForceModelMappingsChange: (value: boolean) => void | Promise<void>;

	getMappingForSlot: (slotId: string) => AmpModelMapping | null | undefined;
	updateSlotMapping: (
		slotId: string,
		toModel: string,
		enabled: boolean,
	) => void | Promise<void>;

	getAvailableTargetModels: () => AvailableTargetModels;

	getCustomMappings: () => AmpModelMapping[];
	updateCustomMapping: (
		fromModel: string,
		newToModel: string,
		enabled: boolean,
	) => void | Promise<void>;
	removeCustomMapping: (fromModel: string) => void | Promise<void>;

	newMappingFrom: Accessor<string>;
	setNewMappingFrom: Setter<string>;
	newMappingTo: Accessor<string>;
	setNewMappingTo: Setter<string>;
	addCustomMapping: () => void | Promise<void>;

	deleteOpenAIProvider: (providerId: string) => void | Promise<void>;
	openProviderModal: (provider?: AmpOpenAIProvider) => void;

	providerModalOpen: Accessor<boolean>;
	closeProviderModal: () => void;
	editingProviderId: Accessor<string | null>;
	providerName: Accessor<string>;
	setProviderName: Setter<string>;
	providerBaseUrl: Accessor<string>;
	setProviderBaseUrl: Setter<string>;
	providerApiKey: Accessor<string>;
	setProviderApiKey: Setter<string>;
	providerModels: Accessor<AmpOpenAIModel[]>;
	newModelName: Accessor<string>;
	setNewModelName: Setter<string>;
	newModelAlias: Accessor<string>;
	setNewModelAlias: Setter<string>;
	addProviderModel: () => void;
	removeProviderModel: (index: number) => void;
	testingProvider: Accessor<boolean>;
	providerTestResult: Accessor<ProviderTestResult | null>;
	testProviderConnection: () => void | Promise<void>;
	saveOpenAIProvider: () => void | Promise<void>;
}

export function AmpCliIntegrationSection(props: AmpCliIntegrationSectionProps) {
	const {
		activeTab,
		config,
		handleConfigChange,
		proxyRunning,
		savingForceModelMappings,
		forceModelMappings,
		handleForceModelMappingsChange,
		getMappingForSlot,
		updateSlotMapping,
		getAvailableTargetModels,
		getCustomMappings,
		updateCustomMapping,
		removeCustomMapping,
		newMappingFrom,
		setNewMappingFrom,
		newMappingTo,
		setNewMappingTo,
		addCustomMapping,
		deleteOpenAIProvider,
		openProviderModal,
		providerModalOpen,
		closeProviderModal,
		editingProviderId,
		providerName,
		setProviderName,
		providerBaseUrl,
		setProviderBaseUrl,
		providerApiKey,
		setProviderApiKey,
		providerModels,
		newModelName,
		setNewModelName,
		newModelAlias,
		setNewModelAlias,
		addProviderModel,
		removeProviderModel,
		testingProvider,
		providerTestResult,
		testProviderConnection,
		saveOpenAIProvider,
	} = props;

	return (
		<>
			{/* Amp CLI Integration */}
			<div class="space-y-4" classList={{ hidden: activeTab() !== "general" }}>
				<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
					Amp CLI Integration
				</h2>

				<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
					<label class="block">
						<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
							Amp API Key
						</span>
						<input
							type="password"
							value={config().ampApiKey || ""}
							onInput={(e) =>
								handleConfigChange("ampApiKey", e.currentTarget.value)
							}
							placeholder="amp_..."
							class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth font-mono"
						/>
						<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
							Get your API key from{" "}
							<a
								href="https://ampcode.com/settings"
								target="_blank"
								rel="noopener noreferrer"
								class="text-brand-500 hover:text-brand-600 underline"
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
							<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
								Model Mappings
							</span>
							<p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
								Route Amp model requests to different providers
							</p>
						</div>

						{/* Prioritize Model Mappings Toggle */}
						<Show when={proxyRunning()}>
							<div class="flex items-center justify-between p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
								<div class="flex-1">
									<div class="flex items-center gap-2">
										<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
											Prioritize Model Mappings
										</span>
										<Show when={savingForceModelMappings()}>
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
										Model mappings take precedence over local API keys. Enable to
										route mapped models via OAuth instead of local keys.
									</p>
								</div>
								<button
									type="button"
									role="switch"
									aria-checked={forceModelMappings()}
									disabled={savingForceModelMappings()}
									onClick={() =>
										handleForceModelMappingsChange(!forceModelMappings())
									}
									class={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 ${
										forceModelMappings()
											? "bg-brand-600"
											: "bg-gray-200 dark:bg-gray-700"
									}`}
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
									const isEnabled = () => !!mapping();
									const currentTarget = () => mapping()?.alias || "";

									return (
										<div class="p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
											{/* Mobile: Stack vertically, Desktop: Single row */}
											<div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
												{/* Left side: Checkbox + Slot name */}
												<div class="flex items-center gap-2 shrink-0">
													<input
														type="checkbox"
														checked={isEnabled()}
														onChange={(e) => {
															const checked = e.currentTarget.checked;
															if (checked) {
																const { customModels, builtInModels } =
																	getAvailableTargetModels();
																const defaultTarget =
																	customModels[0]?.value ||
																	builtInModels.google[0]?.value ||
																	slot.fromModel;
																updateSlotMapping(
																	slot.id,
																	defaultTarget,
																	true,
																);
															} else {
																updateSlotMapping(slot.id, "", false);
															}
														}}
														class="w-4 h-4 text-brand-500 bg-gray-100 border-gray-300 rounded focus:ring-brand-500 dark:focus:ring-brand-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
													/>
													<span class="text-sm font-medium text-gray-700 dark:text-gray-300 w-20">
														{slot.name}
													</span>
												</div>

												{/* Right side: From -> To mapping */}
												<div class="flex items-center gap-2 flex-1 min-w-0">
													{/* From model (readonly) - fixed width, truncate on small screens */}
													<div
														class="w-24 sm:w-28 shrink-0 px-2 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-xs text-gray-600 dark:text-gray-400 truncate"
														title={slot.fromLabel}
													>
														{slot.fromLabel}
													</div>

													{/* Arrow */}
													<span class="text-gray-400 text-xs shrink-0">→</span>

													{/* To model (dropdown) */}
													{(() => {
														const { customModels, builtInModels } =
															getAvailableTargetModels();
														return (
															<select
																value={currentTarget()}
																onChange={(e) => {
																	const newTarget = e.currentTarget.value;
																	updateSlotMapping(slot.id, newTarget, true);
																}}
																disabled={!isEnabled()}
																class={`flex-1 min-w-0 px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg text-xs focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth [&>option]:bg-white [&>option]:dark:bg-gray-900 [&>option]:text-gray-900 [&>option]:dark:text-gray-100 [&>optgroup]:bg-white [&>optgroup]:dark:bg-gray-900 [&>optgroup]:text-gray-900 [&>optgroup]:dark:text-gray-100 ${
																	!isEnabled()
																		? "opacity-50 cursor-not-allowed"
																		: ""
																}`}
															>
																<option value="">Select target...</option>
																<Show when={customModels.length > 0}>
																	<optgroup label="Custom Provider">
																		<For each={customModels}>
																			{(model) => (
																				<option value={model.value}>
																					{model.label}
																				</option>
																			)}
																		</For>
																	</optgroup>
																</Show>
																<optgroup label="Anthropic">
																	<For each={builtInModels.anthropic}>
																		{(model) => (
																			<option value={model.value}>
																				{model.label}
																			</option>
																		)}
																	</For>
																</optgroup>
																<optgroup label="Google">
																	<For each={builtInModels.google}>
																		{(model) => (
																			<option value={model.value}>
																				{model.label}
																			</option>
																		)}
																	</For>
																</optgroup>
																<optgroup label="OpenAI">
																	<For each={builtInModels.openai}>
																		{(model) => (
																			<option value={model.value}>
																				{model.label}
																			</option>
																		)}
																	</For>
																</optgroup>
																<optgroup label="Qwen">
																	<For each={builtInModels.qwen}>
																		{(model) => (
																			<option value={model.value}>
																				{model.label}
																			</option>
																		)}
																	</For>
																</optgroup>
																<Show when={builtInModels.iflow.length > 0}>
																	<optgroup label="iFlow">
																		<For each={builtInModels.iflow}>
																			{(model) => (
																				<option value={model.value}>
																					{model.label}
																				</option>
																			)}
																		</For>
																	</optgroup>
																</Show>
																<Show when={builtInModels.copilot.length > 0}>
																	<optgroup label="GitHub Copilot">
																		<For each={builtInModels.copilot}>
																			{(model) => (
																				<option value={model.value}>
																					{model.label}
																				</option>
																			)}
																		</For>
																	</optgroup>
																</Show>
															</select>
														);
													})()}
												</div>
											</div>
										</div>
									);
								}}
							</For>
						</div>

						{/* Custom Mappings Section */}
						<div class="pt-2">
							<p class="text-xs text-gray-500 dark:text-gray-400 mb-2">
								Custom model mappings (for models not in predefined slots)
							</p>

							{/* Existing custom mappings */}
							<For each={getCustomMappings()}>
								{(mapping) => {
									const { customModels, builtInModels } =
										getAvailableTargetModels();
									return (
										<div class="p-3 mb-2 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
											<div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
												{/* Checkbox */}
												<div class="flex items-center gap-2 shrink-0">
													<input
														type="checkbox"
														checked={mapping.enabled !== false}
														onChange={(e) => {
															updateCustomMapping(
																mapping.name,
																mapping.alias,
																e.currentTarget.checked,
															);
														}}
														class="w-4 h-4 text-brand-500 bg-gray-100 border-gray-300 rounded focus:ring-brand-500 dark:focus:ring-brand-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
													/>
													<span class="text-xs text-gray-500 dark:text-gray-400 sm:hidden">
														Custom
													</span>
												</div>

												{/* Mapping content */}
												<div class="flex items-center gap-2 flex-1 min-w-0">
													{/* From model (readonly) */}
													<div
														class="w-28 sm:w-32 shrink-0 px-2 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-xs text-gray-600 dark:text-gray-400 font-mono truncate"
														title={mapping.name}
													>
														{mapping.name}
													</div>

													{/* Arrow */}
													<span class="text-gray-400 text-xs shrink-0">→</span>

													{/* To model (dropdown) */}
													<select
														value={mapping.alias}
														onChange={(e) => {
															updateCustomMapping(
																mapping.name,
																e.currentTarget.value,
																mapping.enabled !== false,
															);
														}}
														disabled={mapping.enabled === false}
														class={`flex-1 min-w-0 px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg text-xs focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth [&>option]:bg-white [&>option]:dark:bg-gray-900 [&>option]:text-gray-900 [&>option]:dark:text-gray-100 [&>optgroup]:bg-white [&>optgroup]:dark:bg-gray-900 [&>optgroup]:text-gray-900 [&>optgroup]:dark:text-gray-100 ${
															mapping.enabled === false
																? "opacity-50 cursor-not-allowed"
																: ""
														}`}
													>
														<option value="">Select target...</option>
														<Show when={customModels.length > 0}>
															<optgroup label="Custom Provider">
																<For each={customModels}>
																	{(model) => (
																		<option value={model.value}>
																			{model.label}
																		</option>
																	)}
																</For>
															</optgroup>
														</Show>
														<optgroup label="Anthropic">
															<For each={builtInModels.anthropic}>
																{(model) => (
																	<option value={model.value}>{model.label}</option>
																)}
															</For>
														</optgroup>
														<optgroup label="Google">
															<For each={builtInModels.google}>
																{(model) => (
																	<option value={model.value}>{model.label}</option>
																)}
															</For>
														</optgroup>
														<optgroup label="OpenAI">
															<For each={builtInModels.openai}>
																{(model) => (
																	<option value={model.value}>{model.label}</option>
																)}
															</For>
														</optgroup>
														<optgroup label="Qwen">
															<For each={builtInModels.qwen}>
																{(model) => (
																	<option value={model.value}>{model.label}</option>
																)}
															</For>
														</optgroup>
														<Show when={builtInModels.iflow.length > 0}>
															<optgroup label="iFlow">
																<For each={builtInModels.iflow}>
																	{(model) => (
																		<option value={model.value}>
																			{model.label}
																		</option>
																	)}
																</For>
															</optgroup>
														</Show>
														<Show when={builtInModels.copilot.length > 0}>
															<optgroup label="GitHub Copilot">
																<For each={builtInModels.copilot}>
																	{(model) => (
																		<option value={model.value}>
																			{model.label}
																		</option>
																	)}
																</For>
															</optgroup>
														</Show>
													</select>

													{/* Delete button */}
													<button
														type="button"
														onClick={() => removeCustomMapping(mapping.name)}
														class="p-1.5 text-gray-400 hover:text-red-500 transition-colors shrink-0"
														title="Remove mapping"
													>
														<svg
															class="w-4 h-4"
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
												</div>
											</div>
										</div>
									);
								}}
							</For>

							{/* Add new custom mapping */}
							<div class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
								<div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
									<input
										type="text"
										value={newMappingFrom()}
										onInput={(e) => setNewMappingFrom(e.currentTarget.value)}
										placeholder="From model (e.g. my-custom-model)"
										class="flex-1 min-w-0 px-2 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
									/>
									<span class="text-gray-400 text-xs shrink-0 hidden sm:inline">
										→
									</span>
									{(() => {
										const { customModels, builtInModels } =
											getAvailableTargetModels();
										return (
											<select
												value={newMappingTo()}
												onChange={(e) => setNewMappingTo(e.currentTarget.value)}
												class="flex-1 min-w-0 px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg text-xs focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth [&>option]:bg-white [&>option]:dark:bg-gray-900 [&>option]:text-gray-900 [&>option]:dark:text-gray-100 [&>optgroup]:bg-white [&>optgroup]:dark:bg-gray-900 [&>optgroup]:text-gray-900 [&>optgroup]:dark:text-gray-100"
											>
												<option value="">Select target...</option>
												<Show when={customModels.length > 0}>
													<optgroup label="Custom Provider">
														<For each={customModels}>
															{(model) => (
																<option value={model.value}>{model.label}</option>
															)}
														</For>
													</optgroup>
												</Show>
												<optgroup label="Anthropic">
													<For each={builtInModels.anthropic}>
														{(model) => (
															<option value={model.value}>{model.label}</option>
														)}
													</For>
												</optgroup>
												<optgroup label="Google">
													<For each={builtInModels.google}>
														{(model) => (
															<option value={model.value}>{model.label}</option>
														)}
													</For>
												</optgroup>
												<optgroup label="OpenAI">
													<For each={builtInModels.openai}>
														{(model) => (
															<option value={model.value}>{model.label}</option>
														)}
													</For>
												</optgroup>
												<optgroup label="Qwen">
													<For each={builtInModels.qwen}>
														{(model) => (
															<option value={model.value}>{model.label}</option>
														)}
													</For>
												</optgroup>
												<Show when={builtInModels.iflow.length > 0}>
													<optgroup label="iFlow">
														<For each={builtInModels.iflow}>
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
											</select>
										);
									})()}
									<Button
										variant="secondary"
										size="sm"
										onClick={addCustomMapping}
										disabled={!newMappingFrom().trim() || !newMappingTo().trim()}
										class="shrink-0"
									>
										<svg
											class="w-4 h-4"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M12 4v16m8-8H4"
											/>
										</svg>
									</Button>
								</div>
							</div>
						</div>
					</div>

					<div class="border-t border-gray-200 dark:border-gray-700" />

					{/* Custom OpenAI-Compatible Providers */}
					<div class="space-y-4">
						<div>
							<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
								Custom OpenAI-Compatible Providers
							</span>
							<p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
								Add external providers (ZenMux, OpenRouter, etc.) for
								additional models
							</p>
						</div>

						{/* Provider Table */}
						<Show when={(config().ampOpenaiProviders || []).length > 0}>
							<div class="overflow-x-auto">
								<table class="w-full text-sm">
									<thead>
										<tr class="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
											<th class="pb-2 font-medium">Name</th>
											<th class="pb-2 font-medium">Base URL</th>
											<th class="pb-2 font-medium">Models</th>
											<th class="pb-2 font-medium w-20">Actions</th>
										</tr>
									</thead>
									<tbody class="divide-y divide-gray-100 dark:divide-gray-800">
										<For each={config().ampOpenaiProviders || []}>
											{(provider) => (
												<tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
													<td class="py-2 pr-2">
														<span class="font-medium text-gray-900 dark:text-gray-100">
															{provider.name}
														</span>
													</td>
													<td class="py-2 pr-2">
														<span
															class="text-xs text-gray-500 dark:text-gray-400 font-mono truncate max-w-[200px] block"
															title={provider.baseUrl}
														>
															{provider.baseUrl}
														</span>
													</td>
													<td class="py-2 pr-2">
														<span class="text-xs text-gray-500 dark:text-gray-400">
															{provider.models?.length || 0} model
															{(provider.models?.length || 0) !== 1 ? "s" : ""}
														</span>
													</td>
													<td class="py-2">
														<div class="flex items-center gap-1">
															<button
																type="button"
																onClick={() => openProviderModal(provider)}
																class="p-1.5 text-gray-400 hover:text-brand-500 transition-colors"
																title="Edit provider"
															>
																<svg
																	class="w-4 h-4"
																	fill="none"
																	stroke="currentColor"
																	viewBox="0 0 24 24"
																>
																	<path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		stroke-width="2"
																		d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
																	/>
																</svg>
															</button>
															<button
																type="button"
																onClick={() => deleteOpenAIProvider(provider.id)}
																class="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
																title="Delete provider"
															>
																<svg
																	class="w-4 h-4"
																	fill="none"
																	stroke="currentColor"
																	viewBox="0 0 24 24"
																>
																	<path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		stroke-width="2"
																		d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
																	/>
																</svg>
															</button>
														</div>
													</td>
												</tr>
											)}
										</For>
									</tbody>
								</table>
							</div>
						</Show>

						{/* Empty state */}
						<Show when={(config().ampOpenaiProviders || []).length === 0}>
							<div class="text-center py-6 text-gray-400 dark:text-gray-500 text-sm">
								No custom providers configured
							</div>
						</Show>

						{/* Add Provider Button */}
						<Button
							variant="secondary"
							size="sm"
							onClick={() => openProviderModal()}
							class="w-full"
						>
							<svg
								class="w-4 h-4 mr-1.5"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 4v16m8-8H4"
								/>
							</svg>
							Add Provider
						</Button>
					</div>

					<OpenAIProviderModal
						providerModalOpen={providerModalOpen}
						closeProviderModal={closeProviderModal}
						editingProviderId={editingProviderId}
						providerName={providerName}
						setProviderName={setProviderName}
						providerBaseUrl={providerBaseUrl}
						setProviderBaseUrl={setProviderBaseUrl}
						providerApiKey={providerApiKey}
						setProviderApiKey={setProviderApiKey}
						providerModels={providerModels}
						newModelName={newModelName}
						setNewModelName={setNewModelName}
						newModelAlias={newModelAlias}
						setNewModelAlias={setNewModelAlias}
						addProviderModel={addProviderModel}
						removeProviderModel={removeProviderModel}
						testingProvider={testingProvider}
						providerTestResult={providerTestResult}
						testProviderConnection={testProviderConnection}
						saveOpenAIProvider={saveOpenAIProvider}
					/>

					<p class="text-xs text-gray-400 dark:text-gray-500">
						After changing settings, restart the proxy for changes to take
						effect.
					</p>
				</div>
			</div>
		</>
	);
}

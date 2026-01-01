import type { Accessor, Setter } from "solid-js";
import { For, Show } from "solid-js";
import { Button } from "../../../components/ui";
import type { AmpOpenAIModel, ProviderTestResult } from "../../../lib/tauri";

export interface OpenAIProviderModalProps {
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

export function OpenAIProviderModal(props: OpenAIProviderModalProps) {
	const {
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
			{/* Provider Modal */}
			<Show when={providerModalOpen()}>
				<div
					class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
					onClick={(e) => {
						if (e.target === e.currentTarget) closeProviderModal();
					}}
				>
					<div
						class="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
						onClick={(e) => e.stopPropagation()}
					>
						<div class="sticky top-0 bg-white dark:bg-gray-900 px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
							<h3 class="font-semibold text-gray-900 dark:text-gray-100">
								{editingProviderId() ? "Edit Provider" : "Add Provider"}
							</h3>
							<button
								type="button"
								onClick={closeProviderModal}
								class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
							>
								<svg
									class="w-5 h-5"
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

						<div class="p-4 space-y-4">
							{/* Provider Name */}
							<label class="block">
								<span class="text-xs font-medium text-gray-600 dark:text-gray-400">
									Provider Name
								</span>
								<input
									type="text"
									value={providerName()}
									onInput={(e) =>
										setProviderName(e.currentTarget.value)
									}
									placeholder="e.g. zenmux, openrouter"
									class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
								/>
							</label>

							{/* Base URL */}
							<label class="block">
								<span class="text-xs font-medium text-gray-600 dark:text-gray-400">
									Base URL
								</span>
								<input
									type="text"
									value={providerBaseUrl()}
									onInput={(e) =>
										setProviderBaseUrl(e.currentTarget.value)
									}
									placeholder="https://api.example.com/v1"
									class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
								/>
							</label>

							{/* API Key */}
							<label class="block">
								<span class="text-xs font-medium text-gray-600 dark:text-gray-400">
									API Key
								</span>
								<input
									type="password"
									value={providerApiKey()}
									onInput={(e) =>
										setProviderApiKey(e.currentTarget.value)
									}
									placeholder="sk-..."
									class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
								/>
							</label>

							{/* Models */}
							<div class="space-y-2">
								<span class="text-xs font-medium text-gray-600 dark:text-gray-400">
									Model Aliases (map proxy model names to provider model
									names)
								</span>

								{/* Existing models */}
								<For each={providerModels()}>
									{(model, index) => (
										<div class="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
											<div class="flex-1 flex items-center gap-2 text-xs font-mono overflow-hidden">
												<span
													class="text-gray-700 dark:text-gray-300 truncate"
													title={model.name}
												>
													{model.name}
												</span>
												<Show when={model.alias}>
													<svg
														class="w-4 h-4 text-gray-400 flex-shrink-0"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M13 7l5 5m0 0l-5 5m5-5H6"
														/>
													</svg>
													<span
														class="text-brand-500 truncate"
														title={model.alias}
													>
														{model.alias}
													</span>
												</Show>
											</div>
											<button
												type="button"
												onClick={() => removeProviderModel(index())}
												class="p-1 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
												title="Remove model"
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
									)}
								</For>

								{/* Add new model */}
								<div class="flex flex-col sm:flex-row gap-2">
									<input
										type="text"
										value={newModelName()}
										onInput={(e) =>
											setNewModelName(e.currentTarget.value)
										}
										placeholder="Provider model (e.g. anthropic/claude-4)"
										class="flex-1 px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
									/>
									<input
										type="text"
										value={newModelAlias()}
										onInput={(e) =>
											setNewModelAlias(e.currentTarget.value)
										}
										placeholder="Alias (e.g. claude-4-20251101)"
										class="flex-1 px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
									/>
									<Button
										variant="secondary"
										size="sm"
										onClick={addProviderModel}
										disabled={!newModelName().trim()}
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

							{/* Test Connection */}
							<div class="flex items-center gap-2">
								<Button
									variant="secondary"
									size="sm"
									onClick={testProviderConnection}
									disabled={
										testingProvider() ||
										!providerBaseUrl().trim() ||
										!providerApiKey().trim()
									}
								>
									{testingProvider() ? (
										<span class="flex items-center gap-1.5">
											<svg
												class="w-3 h-3 animate-spin"
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
											Testing...
										</span>
									) : (
										"Test Connection"
									)}
								</Button>
							</div>

							{/* Test result indicator */}
							<Show when={providerTestResult()}>
								{(result) => (
									<div
										class={`flex items-center gap-2 p-2 rounded-lg text-xs ${result().success
												? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
												: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
											}`}
									>
										<Show
											when={result().success}
											fallback={
												<svg
													class="w-4 h-4 flex-shrink-0"
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
											}
										>
											<svg
												class="w-4 h-4 flex-shrink-0"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M5 13l4 4L19 7"
												/>
											</svg>
										</Show>
										<span>{result().message}</span>
										<Show when={result().modelsFound}>
											<span class="text-gray-500 dark:text-gray-400">
												({result().modelsFound} models)
											</span>
										</Show>
										<Show when={result().latencyMs}>
											<span class="text-gray-500 dark:text-gray-400">
												{result().latencyMs}ms
											</span>
										</Show>
									</div>
								)}
							</Show>
						</div>

						{/* Modal Footer */}
						<div class="sticky bottom-0 bg-white dark:bg-gray-900 px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={closeProviderModal}
							>
								Cancel
							</Button>
							<Button
								variant="primary"
								size="sm"
								onClick={saveOpenAIProvider}
								disabled={
									!providerName().trim() ||
									!providerBaseUrl().trim() ||
									!providerApiKey().trim()
								}
							>
								{editingProviderId() ? "Save Changes" : "Add Provider"}
							</Button>
						</div>
					</div>
				</div>
			</Show>
		</>
	);
}



import type { Accessor, Setter } from "solid-js";
import { Show } from "solid-js";
import { Button } from "../../../components/ui";
import { appStore } from "../../../stores/app";
import type { SettingsTab } from "../types";

export interface YamlConfigEditorSectionProps {
	activeTab: Accessor<SettingsTab>;
	yamlConfigExpanded: Accessor<boolean>;
	setYamlConfigExpanded: Setter<boolean>;
	loadYamlConfig: () => void | Promise<void>;
	loadingYaml: Accessor<boolean>;
	yamlContent: Accessor<string>;
	setYamlContent: Setter<string>;
	saveYamlConfig: () => void | Promise<void>;
	savingYaml: Accessor<boolean>;
}

export function YamlConfigEditorSection(props: YamlConfigEditorSectionProps) {
	const {
		activeTab,
		yamlConfigExpanded,
		setYamlConfigExpanded,
		loadYamlConfig,
		loadingYaml,
		yamlContent,
		setYamlContent,
		saveYamlConfig,
		savingYaml,
	} = props;

	return (
		<>
			{/* Raw YAML Config Editor (Power Users) */}
			<Show when={appStore.proxyStatus().running}>
				<div
					class="space-y-4"
					classList={{ hidden: activeTab() !== "advanced" }}
				>
					<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
						Raw Configuration
					</h2>

					<div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
						<button
							type="button"
							onClick={() => setYamlConfigExpanded(!yamlConfigExpanded())}
							class="w-full flex items-center justify-between text-left"
						>
							<div>
								<p class="text-sm font-medium text-gray-700 dark:text-gray-300">
									YAML Config Editor
								</p>
								<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
									Advanced: Edit the raw CLIProxyAPI configuration
								</p>
							</div>
							<svg
								class={`w-5 h-5 text-gray-400 transition-transform ${yamlConfigExpanded() ? "rotate-180" : ""}`}
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M19 9l-7 7-7-7"
								/>
							</svg>
						</button>

						<Show when={yamlConfigExpanded()}>
							<div class="mt-4 space-y-3">
								<div class="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg">
									<svg
										class="w-4 h-4 shrink-0"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
										/>
									</svg>
									<span>
										Be careful! Invalid YAML can break the proxy. Changes
										apply immediately but some may require a restart.
									</span>
								</div>

								<Show when={loadingYaml()}>
									<div class="text-center py-8 text-gray-500">
										Loading configuration...
									</div>
								</Show>

								<Show when={!loadingYaml()}>
									<textarea
										value={yamlContent()}
										onInput={(e) => setYamlContent(e.currentTarget.value)}
										class="w-full h-96 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth resize-y"
										placeholder="Loading..."
										spellcheck={false}
									/>

									<div class="flex items-center justify-between">
										<Button
											variant="secondary"
											size="sm"
											onClick={loadYamlConfig}
											disabled={loadingYaml()}
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
													d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
												/>
											</svg>
											Reload
										</Button>

										<Button
											variant="primary"
											size="sm"
											onClick={saveYamlConfig}
											disabled={savingYaml() || loadingYaml()}
										>
											<Show
												when={savingYaml()}
												fallback={<span>Save Changes</span>}
											>
												<svg
													class="w-4 h-4 animate-spin mr-1.5"
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
												Saving...
											</Show>
										</Button>
									</div>
								</Show>
							</div>
						</Show>
					</div>
				</div>
			</Show>

		</>
	);
}



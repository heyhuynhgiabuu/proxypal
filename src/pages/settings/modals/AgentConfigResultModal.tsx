import type { Accessor, Setter } from "solid-js";
import { Show } from "solid-js";
import { Button } from "../../../components/ui";
import type { AgentConfigResult } from "../../../lib/tauri";
import { toastStore } from "../../../stores/toast";

interface AgentConfigResultState {
	result: AgentConfigResult;
	agentName: string;
}

export interface AgentConfigResultModalProps {
	configResult: Accessor<AgentConfigResultState | null>;
	setConfigResult: Setter<AgentConfigResultState | null>;
	handleApplyEnv: () => void | Promise<void>;
}

export function AgentConfigResultModal(props: AgentConfigResultModalProps) {
	const { configResult, setConfigResult, handleApplyEnv } = props;
	return (
		<>
			<Show when={configResult()}>
				{(result) => (
					<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in">
						<div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg animate-scale-in">
							<div class="p-6">
								<div class="flex items-center justify-between mb-4">
									<h2 class="text-lg font-bold text-gray-900 dark:text-gray-100">
										{result().agentName} Configured
									</h2>
									<button
										onClick={() => setConfigResult(null)}
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

								<div class="space-y-4">
									<Show when={result().result.configPath}>
										<div class="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
											<div class="flex items-center gap-2 text-green-700 dark:text-green-300">
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
														d="M5 13l4 4L19 7"
													/>
												</svg>
												<span class="text-sm font-medium">
													Config file created
												</span>
											</div>
											<p class="mt-1 text-xs text-green-600 dark:text-green-400 font-mono break-all">
												{result().result.configPath}
											</p>
										</div>
									</Show>

									<Show when={result().result.shellConfig}>
										<div class="space-y-2">
											<div class="flex items-center justify-between">
												<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
													Environment Variables
												</span>
												<button
													onClick={() => {
														navigator.clipboard.writeText(
															result().result.shellConfig!,
														);
														toastStore.success("Copied to clipboard");
													}}
													class="text-xs text-brand-500 hover:text-brand-600"
												>
													Copy
												</button>
											</div>
											<pre class="p-3 rounded-lg bg-gray-100 dark:bg-gray-800 text-xs font-mono text-gray-700 dark:text-gray-300 overflow-x-auto whitespace-pre-wrap">
												{result().result.shellConfig}
											</pre>
											<Button
												size="sm"
												variant="secondary"
												onClick={handleApplyEnv}
												class="w-full"
											>
												Add to Shell Profile Automatically
											</Button>
										</div>
									</Show>

									<Show when={result().result.instructions}>
										<div class="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
											<p class="text-sm text-blue-700 dark:text-blue-300">
												{result().result.instructions}
											</p>
										</div>
									</Show>
								</div>

								<div class="mt-6 flex justify-end">
									<Button
										variant="primary"
										onClick={() => setConfigResult(null)}
									>
										Done
									</Button>
								</div>
							</div>
						</div>
					</div>
				)}
			</Show>
		</>
	);
}



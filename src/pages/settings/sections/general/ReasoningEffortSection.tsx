import type { Accessor, Setter } from "solid-js";

import { Button } from "../../../../components/ui";
import type { ReasoningEffortLevel } from "../../../../lib/tauri";
import type { SettingsTab } from "../../types";

export interface ReasoningEffortSectionProps {
	activeTab: Accessor<SettingsTab>;
	reasoningEffortLevel: Accessor<ReasoningEffortLevel>;
	setReasoningEffortLevel: Setter<ReasoningEffortLevel>;
	saveReasoningEffort: () => void | Promise<void>;
	savingReasoningEffort: Accessor<boolean>;
}

export function ReasoningEffortSection(props: ReasoningEffortSectionProps) {
	const {
		activeTab,
		reasoningEffortLevel,
		setReasoningEffortLevel,
		saveReasoningEffort,
		savingReasoningEffort,
	} = props;

	return (
		<div class="space-y-4" classList={{ hidden: activeTab() !== "general" }}>
			<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
				Reasoning Effort (GPT/Codex Models)
			</h2>

			<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
				<p class="text-xs text-gray-500 dark:text-gray-400">
					Configure default reasoning effort for GPT-5.x models. This setting is
					applied when configuring CLI agents (OpenCode, Factory Droid, etc.)
					and can be overridden per-request using model suffix like{" "}
					<code class="bg-gray-200 dark:bg-gray-700 px-1 rounded">
						gpt-5(high)
					</code>
					.
				</p>

				<div class="space-y-3">
					<label class="block">
						<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
							Default Effort Level
						</span>
						<select
							value={reasoningEffortLevel()}
							onChange={(e) =>
								setReasoningEffortLevel(
									e.currentTarget.value as ReasoningEffortLevel,
								)
							}
							class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth [&>option]:bg-white [&>option]:dark:bg-gray-900 [&>option]:text-gray-900 [&>option]:dark:text-gray-100"
						>
							<option value="none">None (disabled)</option>
							<option value="low">Low (~1,024 tokens)</option>
							<option value="medium">Medium (~8,192 tokens)</option>
							<option value="high">High (~24,576 tokens)</option>
							<option value="xhigh">Extra High (~32,768 tokens)</option>
						</select>
					</label>

					<div class="flex items-center justify-between pt-2">
						<span class="text-sm text-gray-600 dark:text-gray-400">
							Current:{" "}
							<span class="font-medium text-brand-600 dark:text-brand-400">
								{reasoningEffortLevel()}
							</span>
						</span>
						<Button
							variant="primary"
							size="sm"
							onClick={saveReasoningEffort}
							disabled={savingReasoningEffort()}
						>
							{savingReasoningEffort() ? "Saving..." : "Apply"}
						</Button>
					</div>

					<p class="text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
						<span class="font-medium">Per-request override:</span> Use model
						suffix like{" "}
						<code class="bg-gray-200 dark:bg-gray-700 px-1 rounded">
							gpt-5(high)
						</code>{" "}
						or{" "}
						<code class="bg-gray-200 dark:bg-gray-700 px-1 rounded">
							gpt-5.2(low)
						</code>
					</p>
				</div>
			</div>
		</div>
	);
}


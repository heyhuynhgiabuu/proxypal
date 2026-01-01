import type { Accessor, Setter } from "solid-js";
import { Show } from "solid-js";

import { Button } from "../../../../components/ui";
import { getThinkingBudgetTokens } from "../../../../lib/tauri";
import type { ThinkingBudgetSettings } from "../../../../lib/tauri";
import type { SettingsTab } from "../../types";

export interface ThinkingBudgetSectionProps {
	activeTab: Accessor<SettingsTab>;
	thinkingBudgetMode: Accessor<ThinkingBudgetSettings["mode"]>;
	setThinkingBudgetMode: Setter<ThinkingBudgetSettings["mode"]>;
	thinkingBudgetCustom: Accessor<number>;
	setThinkingBudgetCustom: Setter<number>;
	saveThinkingBudget: () => void | Promise<void>;
	savingThinkingBudget: Accessor<boolean>;
}

export function ThinkingBudgetSection(props: ThinkingBudgetSectionProps) {
	const {
		activeTab,
		thinkingBudgetMode,
		setThinkingBudgetMode,
		thinkingBudgetCustom,
		setThinkingBudgetCustom,
		saveThinkingBudget,
		savingThinkingBudget,
	} = props;

	return (
		<div class="space-y-4" classList={{ hidden: activeTab() !== "general" }}>
			<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
				Thinking Budget (Antigravity Claude Models)
			</h2>

			<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
				<p class="text-xs text-gray-500 dark:text-gray-400">
					Configure the thinking/reasoning token budget for Antigravity Claude
					models (claude-sonnet-4-5-thinking, claude-opus-4-5-thinking). This
					applies to both OpenCode and AmpCode CLI agents.
				</p>

				<div class="space-y-3">
					<label class="block">
						<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
							Budget Level
						</span>
						<select
							value={thinkingBudgetMode()}
							onChange={(e) =>
								setThinkingBudgetMode(
									e.currentTarget.value as ThinkingBudgetSettings["mode"],
								)
							}
							class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth [&>option]:bg-white [&>option]:dark:bg-gray-900 [&>option]:text-gray-900 [&>option]:dark:text-gray-100"
						>
							<option value="low">Low (2,048 tokens)</option>
							<option value="medium">Medium (8,192 tokens)</option>
							<option value="high">High (32,768 tokens)</option>
							<option value="custom">Custom</option>
						</select>
					</label>

					<Show when={thinkingBudgetMode() === "custom"}>
						<label class="block">
							<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
								Custom Token Budget
							</span>
							<input
								type="number"
								value={thinkingBudgetCustom()}
								onInput={(e) =>
									setThinkingBudgetCustom(
										Math.max(
											1024,
											Math.min(200000, parseInt(e.currentTarget.value) || 16000),
										),
									)
								}
								class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
								min="1024"
								max="200000"
							/>
							<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
								Range: 1,024 - 200,000 tokens
							</p>
						</label>
					</Show>

					<div class="flex items-center justify-between pt-2">
						<span class="text-sm text-gray-600 dark:text-gray-400">
							Current:{" "}
							<span class="font-medium text-brand-600 dark:text-brand-400">
								{getThinkingBudgetTokens({
									mode: thinkingBudgetMode(),
									customBudget: thinkingBudgetCustom(),
								}).toLocaleString()}{" "}
								tokens
							</span>
						</span>
						<Button
							variant="primary"
							size="sm"
							onClick={saveThinkingBudget}
							disabled={savingThinkingBudget()}
						>
							{savingThinkingBudget() ? "Saving..." : "Apply"}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}


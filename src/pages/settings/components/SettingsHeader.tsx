import type { Accessor, Setter } from "solid-js";
import { For } from "solid-js";

import type { SettingsTab } from "../types";

export interface SettingsHeaderProps {
	appVersion: Accessor<string>;
	saving: Accessor<boolean>;
	tabs: { id: SettingsTab; label: string }[];
	activeTab: Accessor<SettingsTab>;
	setActiveTab: Setter<SettingsTab>;
}

export function SettingsHeader(props: SettingsHeaderProps) {
	const { appVersion, saving, tabs, activeTab, setActiveTab } = props;

	return (
		<header class="sticky top-0 z-10 px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
			<div class="flex items-center justify-between gap-2 sm:gap-3 max-w-6xl mx-auto">
				<div class="flex items-center gap-2 sm:gap-3">
					<h1 class="font-bold text-lg text-gray-900 dark:text-gray-100">
						Settings
					</h1>
					<span class="text-xs text-gray-400">v{appVersion()}</span>
					{saving() && (
						<span class="text-xs text-gray-400 ml-2 flex items-center gap-1">
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
							Saving
						</span>
					)}
				</div>

				{/* Tab Navigation */}
				<div class="flex gap-1 overflow-x-auto -mx-1 px-1 py-1 lg:hidden">
					<For each={tabs}>
						{(tab) => (
							<button
								type="button"
								onClick={() => setActiveTab(tab.id)}
								class="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap flex-none"
								classList={{
									"bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400":
										activeTab() === tab.id,
									"text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800":
										activeTab() !== tab.id,
								}}
							>
								{tab.label}
							</button>
						)}
					</For>
				</div>
			</div>
		</header>
	);
}


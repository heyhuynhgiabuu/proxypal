import type { Accessor, Setter } from "solid-js";
import { For } from "solid-js";

import type { SettingsTab } from "../types";

export interface SettingsSidebarNavProps {
	tabs: { id: SettingsTab; label: string }[];
	activeTab: Accessor<SettingsTab>;
	setActiveTab: Setter<SettingsTab>;
}

export function SettingsSidebarNav(props: SettingsSidebarNavProps) {
	const { tabs, activeTab, setActiveTab } = props;

	return (
		<nav class="hidden lg:flex lg:flex-col gap-1 self-start sticky top-24">
			<For each={tabs}>
				{(tab) => (
					<button
						type="button"
						onClick={() => setActiveTab(tab.id)}
						class="px-3 py-2 text-sm font-medium rounded-lg transition-colors text-left w-full"
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
		</nav>
	);
}


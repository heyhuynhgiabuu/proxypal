import type { Accessor } from "solid-js";

import { Switch } from "../../../../components/ui";
import type { AppConfig } from "../../../../lib/tauri";
import type { SettingsTab } from "../../types";

export interface GeneralSettingsSectionProps {
	activeTab: Accessor<SettingsTab>;
	config: Accessor<AppConfig>;
	handleConfigChange: (
		key: keyof AppConfig,
		value: boolean | number | string,
	) => void | Promise<void>;
	closeToTray: Accessor<boolean>;
	handleCloseToTrayChange: (enabled: boolean) => void | Promise<void>;
	savingCloseToTray: Accessor<boolean>;
}

export function GeneralSettingsSection(props: GeneralSettingsSectionProps) {
	const {
		activeTab,
		config,
		handleConfigChange,
		closeToTray,
		handleCloseToTrayChange,
		savingCloseToTray,
	} = props;

	return (
		<div class="space-y-4" classList={{ hidden: activeTab() !== "general" }}>
			<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
				General
			</h2>

			<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
				<Switch
					label="Launch at login"
					description="Start ProxyPal automatically when you log in"
					checked={config().launchAtLogin}
					onChange={(checked) => handleConfigChange("launchAtLogin", checked)}
				/>

				<div class="border-t border-gray-200 dark:border-gray-700" />

				<Switch
					label="Auto-start proxy"
					description="Start the proxy server when ProxyPal launches"
					checked={config().autoStart}
					onChange={(checked) => handleConfigChange("autoStart", checked)}
				/>

				<div class="border-t border-gray-200 dark:border-gray-700" />

				<Switch
					label="Close to tray"
					description="Minimize to system tray instead of quitting when closing the window"
					checked={closeToTray()}
					onChange={handleCloseToTrayChange}
					disabled={savingCloseToTray()}
				/>
			</div>
		</div>
	);
}


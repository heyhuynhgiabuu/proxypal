import type { Accessor } from "solid-js";

import { themeStore } from "../../../stores/theme";
import type { SettingsTab } from "../types";

export interface AboutSectionProps {
	activeTab: Accessor<SettingsTab>;
	appVersion: Accessor<string>;
}

export function AboutSection(props: AboutSectionProps) {
	const { activeTab, appVersion } = props;

	return (
		<div class="space-y-4" classList={{ hidden: activeTab() !== "advanced" }}>
			<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
				About
			</h2>

			<div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 text-center">
				<div class="w-12 h-12 mx-auto rounded-xl flex items-center justify-center mb-3">
					<img
						src={
							themeStore.resolvedTheme() === "dark"
								? "/proxypal-white.png"
								: "/proxypal-black.png"
						}
						alt="ProxyPal Logo"
						class="w-12 h-12 rounded-xl object-contain"
					/>
				</div>
				<h3 class="font-bold text-gray-900 dark:text-gray-100">ProxyPal</h3>
				<p class="text-sm text-gray-500 dark:text-gray-400">
					Version {appVersion()}
				</p>
				<p class="text-xs text-gray-400 dark:text-gray-500 mt-2">
					Built with love by OpenCodeKit
				</p>
			</div>
		</div>
	);
}


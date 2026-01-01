import type { Accessor, Setter } from "solid-js";
import { Show } from "solid-js";

import type { AppConfig } from "../../../../lib/tauri";
import type { SettingsTab } from "../../types";

export interface ProxyConfigurationSectionProps {
	activeTab: Accessor<SettingsTab>;
	config: Accessor<AppConfig>;
	handleConfigChange: (
		key: keyof AppConfig,
		value: boolean | number | string,
	) => void | Promise<void>;

	showProxyApiKey: Accessor<boolean>;
	setShowProxyApiKey: Setter<boolean>;
	showManagementKey: Accessor<boolean>;
	setShowManagementKey: Setter<boolean>;

	proxyRunning: Accessor<boolean>;
	maxRetryInterval: Accessor<number>;
	savingMaxRetryInterval: Accessor<boolean>;
	handleMaxRetryIntervalChange: (value: number) => void | Promise<void>;
}

export function ProxyConfigurationSection(props: ProxyConfigurationSectionProps) {
	const {
		activeTab,
		config,
		handleConfigChange,
		showProxyApiKey,
		setShowProxyApiKey,
		showManagementKey,
		setShowManagementKey,
		proxyRunning,
		maxRetryInterval,
		savingMaxRetryInterval,
		handleMaxRetryIntervalChange,
	} = props;

	return (
		<div class="space-y-4" classList={{ hidden: activeTab() !== "general" }}>
			<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
				Proxy Configuration
			</h2>

			<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
				<label class="block">
					<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
						Port
					</span>
					<input
						type="number"
						value={config().port}
						onInput={(e) =>
							handleConfigChange(
								"port",
								parseInt(e.currentTarget.value) || 8317,
							)
						}
						class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
						min="1024"
						max="65535"
					/>
					<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
						The port where the proxy server will listen (default: 8317)
					</p>
				</label>

				<div class="border-t border-gray-200 dark:border-gray-700" />

				<label class="block">
					<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
						Upstream Proxy URL
					</span>
					<input
						type="text"
						value={config().proxyUrl}
						onInput={(e) => handleConfigChange("proxyUrl", e.currentTarget.value)}
						placeholder="socks5://127.0.0.1:1080"
						class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
					/>
					<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
						Optional SOCKS5/HTTP proxy for outbound requests (e.g.
						socks5://host:port)
					</p>
				</label>

				<div class="border-t border-gray-200 dark:border-gray-700" />

				<label class="block">
					<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
						Proxy API Key
					</span>
					<div class="relative mt-1">
						<input
							type={showProxyApiKey() ? "text" : "password"}
							value={config().proxyApiKey || "proxypal-local"}
							onInput={(e) =>
								handleConfigChange(
									"proxyApiKey",
									e.currentTarget.value || "proxypal-local",
								)
							}
							placeholder="proxypal-local"
							class="block w-full px-3 py-2 pr-10 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
						/>
						<button
							type="button"
							onClick={() => setShowProxyApiKey(!showProxyApiKey())}
							class="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
						>
							{showProxyApiKey() ? (
								<svg
									class="w-5 h-5"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
									/>
								</svg>
							) : (
								<svg
									class="w-5 h-5"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
									/>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
									/>
								</svg>
							)}
						</button>
					</div>
					<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
						API key for client authentication. Change this if exposing proxy
						publicly.
					</p>
				</label>

				<div class="border-t border-gray-200 dark:border-gray-700" />

				<label class="block">
					<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
						Management API Key
					</span>
					<div class="relative mt-1">
						<input
							type={showManagementKey() ? "text" : "password"}
							value={config().managementKey || "proxypal-mgmt-key"}
							onInput={(e) =>
								handleConfigChange(
									"managementKey",
									e.currentTarget.value || "proxypal-mgmt-key",
								)
							}
							placeholder="proxypal-mgmt-key"
							class="block w-full px-3 py-2 pr-10 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
						/>
						<button
							type="button"
							onClick={() => setShowManagementKey(!showManagementKey())}
							class="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
						>
							{showManagementKey() ? (
								<svg
									class="w-5 h-5"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
									/>
								</svg>
							) : (
								<svg
									class="w-5 h-5"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
									/>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
									/>
								</svg>
							)}
						</button>
					</div>
					<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
						Secret key for internal management API. Change this if exposing proxy
						publicly.
					</p>
					<p class="mt-1 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded">
						⚠️ Changing this key requires a proxy restart to take effect.
					</p>
				</label>

				<div class="border-t border-gray-200 dark:border-gray-700" />

				<label class="block">
					<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
						Request Retry Count
					</span>
					<input
						type="number"
						value={config().requestRetry}
						onInput={(e) =>
							handleConfigChange(
								"requestRetry",
								Math.max(
									0,
									Math.min(10, parseInt(e.currentTarget.value) || 0),
								),
							)
						}
						class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
						min="0"
						max="10"
					/>
					<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
						Number of retries on 403, 408, 500, 502, 503, 504 errors (0-10)
					</p>
				</label>

				<div class="border-t border-gray-200 dark:border-gray-700" />

				<label class="block">
					<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
						Routing Strategy
					</span>
					<select
						value={config().routingStrategy}
						onChange={(e) =>
							handleConfigChange("routingStrategy", e.currentTarget.value)
						}
						class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth [&>option]:bg-white [&>option]:dark:bg-gray-900 [&>option]:text-gray-900 [&>option]:dark:text-gray-100"
					>
						<option value="round-robin">Round Robin (even distribution)</option>
						<option value="fill-first">
							Fill First (use first account until limit)
						</option>
						<option value="sequential">Sequential (ordered)</option>
					</select>
					<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
						How auth accounts are selected for requests
					</p>
				</label>

				<Show when={proxyRunning()}>
					<div class="border-t border-gray-200 dark:border-gray-700" />

					<label class="block">
						<span class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
							Max Retry Interval (seconds)
							<Show when={savingMaxRetryInterval()}>
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
						</span>
						<input
							type="number"
							value={maxRetryInterval()}
							onInput={(e) => {
								const val = Math.max(0, parseInt(e.currentTarget.value) || 0);
								handleMaxRetryIntervalChange(val);
							}}
							disabled={savingMaxRetryInterval()}
							class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth disabled:opacity-50"
							min="0"
						/>
						<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
							Maximum wait time between retries in seconds (0 = no limit). Updates
							live without restart.
						</p>
					</label>
				</Show>
			</div>
		</div>
	);
}


import type { Accessor } from "solid-js";
import { For, Show } from "solid-js";

import { Button } from "../../../components/ui";
import type { CopilotApiDetection } from "../../../lib/tauri";

interface ProvidersTabProps {
	active: boolean;
	copilotDetection: Accessor<CopilotApiDetection | null>;
	detectingCopilot: Accessor<boolean>;
	onRunCopilotDetection: () => void;
	connectedCount: Accessor<number>;
	totalProviders: Accessor<number>;
	onManageAccounts: () => void;
}

export const ProvidersTab = (props: ProvidersTabProps) => (
	<div class="space-y-4 sm:space-y-6" classList={{ hidden: !props.active }}>
		<div class="space-y-4">
			<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
				Copilot API Detection
			</h2>

			<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
				<p class="text-xs text-gray-500 dark:text-gray-400">
					ProxyPal automatically detects and uses copilot-api for GitHub Copilot
					integration. No manual setup required - it works automatically.
				</p>

				<Button
					variant="secondary"
					size="sm"
					onClick={props.onRunCopilotDetection}
					disabled={props.detectingCopilot()}
				>
					{props.detectingCopilot() ? "Detecting..." : "Check System"}
				</Button>

				<Show when={props.copilotDetection()}>
					{(detection) => (
						<div class="space-y-3 text-xs">
							<div class="flex items-center gap-2">
								<span
									class={`w-2 h-2 rounded-full ${detection().nodeAvailable ? "bg-green-500" : "bg-red-500"}`}
								/>
								<span class="font-medium">Node.js:</span>
								<span
									class={
										detection().nodeAvailable
											? "text-green-600 dark:text-green-400"
											: "text-red-600 dark:text-red-400"
									}
								>
									{detection().nodeAvailable
										? detection().nodeBin || "Available"
										: "Not Found"}
								</span>
							</div>

							<div class="flex items-center gap-2">
								<span
									class={`w-2 h-2 rounded-full ${detection().installed ? "bg-green-500" : "bg-blue-500"}`}
								/>
								<span class="font-medium">copilot-api:</span>
								<span
									class={
										detection().installed
											? "text-green-600 dark:text-green-400"
											: "text-blue-600 dark:text-blue-400"
									}
								>
									{detection().installed
										? `Installed${detection().version ? ` (v${detection().version})` : ""}`
										: "Will download automatically"}
								</span>
							</div>

							<Show when={!detection().installed}>
								<div class="text-gray-500 dark:text-gray-400 pl-4">
									copilot-api will be downloaded automatically on first use via
									npx. This is a one-time process and requires internet
									connection.
								</div>
							</Show>

							<Show when={detection().installed && detection().copilotBin}>
								<div class="text-gray-500 dark:text-gray-400 pl-4">
									Path:{" "}
									<code class="bg-gray-200 dark:bg-gray-700 px-1 rounded">
										{detection().copilotBin}
									</code>
								</div>
							</Show>

							<Show when={detection().npxBin}>
								<div class="text-gray-500 dark:text-gray-400 pl-4">
									npx available at{" "}
									<code class="bg-gray-200 dark:bg-gray-700 px-1 rounded">
										{detection().npxBin}
									</code>
								</div>
							</Show>

							<Show when={!detection().nodeAvailable}>
								<div class="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-400">
									<p class="font-medium">Node.js not found</p>
									<p class="mt-1">
										Install Node.js from{" "}
										<a
											href="https://nodejs.org/"
											target="_blank"
											class="underline"
											rel="noopener"
										>
											nodejs.org
										</a>{" "}
										or use a version manager (nvm, volta, fnm).
									</p>
									<Show when={detection().checkedNodePaths.length > 0}>
										<details class="mt-2">
											<summary class="cursor-pointer text-xs">
												Checked paths
											</summary>
											<ul class="mt-1 pl-4 text-xs opacity-75">
												<For each={detection().checkedNodePaths}>
													{(checkedPath) => <li>{checkedPath}</li>}
												</For>
											</ul>
										</details>
									</Show>
								</div>
							</Show>
						</div>
					)}
				</Show>
			</div>
		</div>

		<div class="space-y-4">
			<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
				Connected Accounts
			</h2>

			<div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-700 dark:text-gray-300">
							{props.connectedCount()} of {props.totalProviders()} providers
							connected
						</p>
						<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
							Manage your AI provider connections
						</p>
					</div>
					<Button
						variant="secondary"
						size="sm"
						onClick={props.onManageAccounts}
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
								d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
							/>
						</svg>
						Manage
					</Button>
				</div>
			</div>
		</div>
	</div>
);

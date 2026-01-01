import type { Accessor } from "solid-js";
import { Show } from "solid-js";
import { Button } from "../../../components/ui";
import type { UpdateInfo, UpdateProgress, UpdaterSupport } from "../../../lib/tauri";
import type { SettingsTab } from "../types";

export interface AppUpdatesSectionProps {
	activeTab: Accessor<SettingsTab>;
	updaterSupport: Accessor<UpdaterSupport | null>;
	checkingForUpdates: Accessor<boolean>;
	installingUpdate: Accessor<boolean>;
	updateInfo: Accessor<UpdateInfo | null>;
	updateProgress: Accessor<UpdateProgress | null>;
	handleCheckForUpdates: () => void | Promise<void>;
	handleInstallUpdate: () => void | Promise<void>;
}

export function AppUpdatesSection(props: AppUpdatesSectionProps) {
	const {
		activeTab,
		updaterSupport,
		checkingForUpdates,
		installingUpdate,
		updateInfo,
		updateProgress,
		handleCheckForUpdates,
		handleInstallUpdate,
	} = props;

	return (
		<>
			{/* App Updates */}
			<div
				class="space-y-4"
				classList={{ hidden: activeTab() !== "advanced" }}
			>
				<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
					App Updates
				</h2>

				<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
					<div class="flex items-center justify-between">
						<div class="flex-1">
							<p class="text-sm font-medium text-gray-700 dark:text-gray-300">
								Check for Updates
							</p>
							<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
								Download and install new versions automatically
							</p>
						</div>
						<Button
							variant="secondary"
							size="sm"
							onClick={handleCheckForUpdates}
							disabled={checkingForUpdates() || installingUpdate()}
						>
							<Show
								when={checkingForUpdates()}
								fallback={
									<>
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
										Check
									</>
								}
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
								Checking...
							</Show>
						</Button>
					</div>

					{/* Update available */}
					<Show when={updateInfo()?.available}>
						<div class="border-t border-gray-200 dark:border-gray-700 pt-4">
							<div class="flex items-start gap-3 p-3 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-lg">
								<svg
									class="w-5 h-5 text-brand-500 mt-0.5 shrink-0"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
									/>
								</svg>
								<div class="flex-1 min-w-0">
									<p class="text-sm font-medium text-brand-700 dark:text-brand-300">
										Update Available: v{updateInfo()?.version}
									</p>
									<p class="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
										<svg
											class="w-3.5 h-3.5"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
											/>
										</svg>
										Please stop the proxy before updating to avoid issues
									</p>
									<Show when={updateInfo()?.body}>
										<p class="text-xs text-brand-600 dark:text-brand-400 mt-1 line-clamp-3">
											{updateInfo()?.body}
										</p>
									</Show>
									<Show when={updateInfo()?.date}>
										<p class="text-xs text-brand-500 dark:text-brand-500 mt-1">
											Released: {updateInfo()?.date}
										</p>
									</Show>
								</div>
							</div>

							{/* Install button */}
							<div class="mt-3">
								<Show
									when={updaterSupport()?.supported !== false}
									fallback={
										<div class="text-center">
											<p class="text-xs text-amber-600 dark:text-amber-400 mb-2">
												{updaterSupport()?.reason}
											</p>
											<a
												href="https://github.com/heyhuynhgiabuu/proxypal/releases"
												target="_blank"
												rel="noopener noreferrer"
												class="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-brand-500 hover:bg-brand-600 rounded-lg transition-colors"
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
														d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
													/>
												</svg>
												Download from GitHub
											</a>
										</div>
									}
								>
									<Button
										variant="primary"
										size="sm"
										onClick={handleInstallUpdate}
										disabled={installingUpdate()}
										class="w-full"
									>
										<Show
											when={installingUpdate()}
											fallback={
												<>
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
															d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
														/>
													</svg>
													Download & Install
												</>
											}
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
											{updateProgress()?.event === "Progress"
												? "Downloading..."
												: "Installing..."}
										</Show>
									</Button>
								</Show>
							</div>

							{/* Progress indicator */}
							<Show when={updateProgress()?.event === "Progress"}>
								<div class="mt-2">
									<div class="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
										<div
											class="h-full bg-brand-500 transition-all duration-300"
											style={{
												width: `${(updateProgress()?.contentLength ?? 0) > 0 ? ((updateProgress()?.chunkLength ?? 0) / (updateProgress()?.contentLength ?? 1)) * 100 : 0}%`,
											}}
										/>
									</div>
								</div>
							</Show>
						</div>
					</Show>

					{/* Already up to date */}
					<Show when={updateInfo() && !updateInfo()?.available}>
						<div class="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
							<svg
								class="w-5 h-5 text-green-500"
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
							<p class="text-sm text-green-700 dark:text-green-300">
								You're running the latest version (v
								{updateInfo()?.currentVersion})
							</p>
						</div>
					</Show>
				</div>
			</div>

		</>
	);
}



import { open } from "@tauri-apps/plugin-dialog";
import { createEffect, createSignal, For, Show } from "solid-js";
import { EmptyState } from "../components/EmptyState";
import { Button } from "../components/ui";
import {
	type AuthFile,
	deleteAllAuthFiles,
	deleteAuthFile,
	downloadAuthFile,
	getAuthFiles,
	refreshAuthStatus,
	uploadAuthFile,
} from "../lib/tauri";
import { appStore } from "../stores/app";
import { toastStore } from "../stores/toast";

// Provider color mapping
const providerColors: Record<string, string> = {
	claude: "bg-orange-500/20 text-orange-400 border-orange-500/30",
	gemini: "bg-blue-500/20 text-blue-400 border-blue-500/30",
	codex: "bg-green-500/20 text-green-400 border-green-500/30",
	qwen: "bg-purple-500/20 text-purple-400 border-purple-500/30",
	iflow: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
	vertex: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
	antigravity: "bg-pink-500/20 text-pink-400 border-pink-500/30",
};

// Provider icons
const providerIcons: Record<string, string> = {
	claude: "/logos/claude.svg",
	gemini: "/logos/gemini.svg",
	codex: "/logos/openai.svg",
	qwen: "/logos/qwen.svg",
	iflow: "/logos/iflow.svg",
	vertex: "/logos/vertex.svg",
	antigravity: "/logos/antigravity.webp",
};

export function AuthFilesPage() {
	const { setCurrentPage, proxyStatus } = appStore;
	const [files, setFiles] = createSignal<AuthFile[]>([]);
	const [loading, setLoading] = createSignal(false);
	const [filter, setFilter] = createSignal<string>("all");
	const [showDeleteAllConfirm, setShowDeleteAllConfirm] = createSignal(false);
	const [fileToDelete, setFileToDelete] = createSignal<AuthFile | null>(null);

	// Load auth files on mount and when proxy status changes
	createEffect(() => {
		if (proxyStatus().running) {
			loadFiles();
		} else {
			setFiles([]);
		}
	});

	const loadFiles = async () => {
		setLoading(true);
		try {
			const result = await getAuthFiles();
			setFiles(result);
		} catch (err) {
			toastStore.error(`Failed to load auth files: ${err}`);
		} finally {
			setLoading(false);
		}
	};

	const handleUpload = async () => {
		try {
			const selected = await open({
				multiple: false,
				filters: [{ name: "JSON", extensions: ["json"] }],
			});

			if (selected) {
				// Try to detect provider from filename
				const filename = selected.split("/").pop() || "";
				let provider = "claude"; // default

				if (filename.includes("gemini")) provider = "gemini";
				else if (filename.includes("codex")) provider = "codex";
				else if (filename.includes("qwen")) provider = "qwen";
				else if (filename.includes("iflow")) provider = "iflow";
				else if (filename.includes("vertex")) provider = "vertex";
				else if (filename.includes("antigravity")) provider = "antigravity";

				await uploadAuthFile(selected, provider);
				toastStore.success("Auth file uploaded successfully");
				loadFiles();
			}
		} catch (err) {
			toastStore.error(`Failed to upload file: ${err}`);
		}
	};

	const handleDelete = async (file: AuthFile) => {
		setFileToDelete(file);
	};

	const confirmDelete = async () => {
		const file = fileToDelete();
		if (!file) return;

		try {
			await deleteAuthFile(file.id);
			toastStore.success("Auth file deleted");
			setFileToDelete(null);
			// Refresh both file list and global auth status
			loadFiles();
			const newAuthStatus = await refreshAuthStatus();
			appStore.setAuthStatus(newAuthStatus);
		} catch (err) {
			toastStore.error(`Failed to delete: ${err}`);
		}
	};

	const handleDownload = async (file: AuthFile) => {
		try {
			const path = await downloadAuthFile(file.id, file.name);
			toastStore.success(`Downloaded to ${path}`);
		} catch (err) {
			toastStore.error(`Failed to download: ${err}`);
		}
	};

	const handleDeleteAll = async () => {
		try {
			await deleteAllAuthFiles();
			toastStore.success("All auth files deleted");
			setShowDeleteAllConfirm(false);
			// Refresh both file list and global auth status
			loadFiles();
			const newAuthStatus = await refreshAuthStatus();
			appStore.setAuthStatus(newAuthStatus);
		} catch (err) {
			toastStore.error(`Failed to delete all: ${err}`);
		}
	};

	const filteredFiles = () => {
		const f = filter();
		if (f === "all") return files();
		return files().filter((file) => file.provider.toLowerCase() === f);
	};

	const providers = () => {
		const unique = new Set(files().map((f) => f.provider.toLowerCase()));
		return Array.from(unique).sort();
	};

	const formatSize = (bytes?: number) => {
		if (!bytes) return "-";
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	};

	const formatDate = (dateStr?: string) => {
		if (!dateStr) return "-";
		const date = new Date(dateStr);
		return date.toLocaleDateString() + " " + date.toLocaleTimeString();
	};

	return (
		<div class="min-h-screen flex flex-col">
			{/* Header */}
			<header class="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-800">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2 sm:gap-3">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setCurrentPage("settings")}
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
									d="M15 19l-7-7 7-7"
								/>
							</svg>
						</Button>
						<h1 class="font-bold text-lg text-gray-900 dark:text-gray-100">
							Auth Files
						</h1>
						<Show when={loading()}>
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
								Loading
							</span>
						</Show>
					</div>

					<div class="flex items-center gap-2">
						<Show when={files().length > 0}>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setShowDeleteAllConfirm(true)}
								class="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
							>
								Delete All
							</Button>
						</Show>
						<Button variant="primary" size="sm" onClick={handleUpload}>
							<svg
								class="w-4 h-4 mr-1.5"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 4v16m8-8H4"
								/>
							</svg>
							Upload
						</Button>
					</div>
				</div>
			</header>

			{/* Content */}
			<main class="flex-1 p-4 sm:p-6 overflow-y-auto">
				<div class="max-w-2xl mx-auto">
					{/* Proxy not running warning */}
					<Show when={!proxyStatus().running}>
						<EmptyState
							icon={
								<svg
									class="w-10 h-10"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="1.5"
										d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
									/>
								</svg>
							}
							title="Proxy Not Running"
							description="Start the proxy server to manage auth files via the Management API."
						/>
					</Show>

					<Show when={proxyStatus().running}>
						{/* Filter Tabs */}
						<Show when={files().length > 0}>
							<div class="flex items-center gap-2 mb-4 flex-wrap">
								<button
									onClick={() => setFilter("all")}
									class={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
										filter() === "all"
											? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
											: "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800"
									}`}
								>
									All ({files().length})
								</button>
								<For each={providers()}>
									{(provider) => (
										<button
											onClick={() => setFilter(provider)}
											class={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
												filter() === provider
													? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
													: "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800"
											}`}
										>
											<img
												src={providerIcons[provider] || "/logos/openai.svg"}
												alt={provider}
												class="w-4 h-4"
											/>
											{provider.charAt(0).toUpperCase() + provider.slice(1)} (
											{
												files().filter(
													(f) => f.provider.toLowerCase() === provider,
												).length
											}
											)
										</button>
									)}
								</For>
							</div>
						</Show>

						{/* Empty State */}
						<Show when={files().length === 0 && !loading()}>
							<EmptyState
								icon={
									<svg
										class="w-10 h-10"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="1.5"
											d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
										/>
									</svg>
								}
								title="No Auth Files"
								description="OAuth credentials will appear here after connecting providers, or upload credential files manually."
								action={{
									label: "Upload Auth File",
									onClick: handleUpload,
								}}
							/>
						</Show>

						{/* Files List */}
						<Show when={filteredFiles().length > 0}>
							<div class="space-y-3">
								<For each={filteredFiles()}>
									{(file) => (
										<div
											class={`rounded-xl border p-4 transition-colors ${
												file.disabled
													? "bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700 opacity-60"
													: "bg-white dark:bg-gray-800/50 border-gray-200 dark:border-gray-700"
											}`}
										>
											<div class="flex items-start justify-between gap-4">
												{/* Left: Info */}
												<div class="flex items-start gap-3 min-w-0 flex-1">
													{/* Provider Icon */}
													<div class="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center shrink-0">
														<img
															src={
																providerIcons[file.provider.toLowerCase()] ||
																"/logos/openai.svg"
															}
															alt={file.provider}
															class="w-6 h-6"
														/>
													</div>

													<div class="min-w-0 flex-1">
														<div class="flex items-center gap-2 flex-wrap">
															<span class="font-medium text-gray-900 dark:text-gray-100 truncate">
																{file.name}
															</span>
															<span
																class={`px-2 py-0.5 rounded text-xs font-medium border ${
																	providerColors[file.provider.toLowerCase()] ||
																	"bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-600"
																}`}
															>
																{file.provider}
															</span>
															<Show when={file.status === "error"}>
																<span class="px-2 py-0.5 rounded text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
																	Error
																</span>
															</Show>
															<Show when={file.disabled}>
																<span class="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">
																	Disabled
																</span>
															</Show>
														</div>

														<div class="flex items-center gap-4 mt-1.5 text-sm text-gray-500 dark:text-gray-400">
															<Show when={file.email}>
																<span class="flex items-center gap-1">
																	<svg
																		class="w-3.5 h-3.5"
																		fill="none"
																		viewBox="0 0 24 24"
																		stroke="currentColor"
																	>
																		<path
																			stroke-linecap="round"
																			stroke-linejoin="round"
																			stroke-width="2"
																			d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
																		/>
																	</svg>
																	{file.email}
																</span>
															</Show>
															<Show when={file.size}>
																<span>{formatSize(file.size)}</span>
															</Show>
															<Show when={file.modtime}>
																<span>{formatDate(file.modtime)}</span>
															</Show>
														</div>

														<Show when={file.statusMessage}>
															<div class="mt-2 text-sm text-red-600 dark:text-red-400">
																{file.statusMessage}
															</div>
														</Show>

														{/* Stats */}
														<Show
															when={
																file.successCount !== undefined ||
																file.failureCount !== undefined
															}
														>
															<div class="flex items-center gap-4 mt-2 text-xs">
																<Show when={file.successCount !== undefined}>
																	<span class="text-green-600 dark:text-green-400">
																		{file.successCount} success
																	</span>
																</Show>
																<Show
																	when={
																		file.failureCount !== undefined &&
																		file.failureCount > 0
																	}
																>
																	<span class="text-red-600 dark:text-red-400">
																		{file.failureCount} failed
																	</span>
																</Show>
															</div>
														</Show>
													</div>
												</div>

												{/* Right: Actions */}
												<div class="flex items-center gap-1 shrink-0">
													<button
														onClick={() => handleDownload(file)}
														class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
														title="Download"
													>
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
																d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
															/>
														</svg>
													</button>
													<button
														onClick={() => handleDelete(file)}
														class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
														title="Delete"
													>
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
																d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
															/>
														</svg>
													</button>
												</div>
											</div>
										</div>
									)}
								</For>
							</div>
						</Show>
					</Show>
				</div>
			</main>

			{/* Delete All Confirmation Modal */}
			<Show when={showDeleteAllConfirm()}>
				<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
					<div class="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full mx-4 border border-gray-200 dark:border-gray-700 shadow-xl">
						<h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
							Delete All Auth Files?
						</h3>
						<p class="text-gray-600 dark:text-gray-400 mb-6">
							This will delete all {files().length} auth files. You will need to
							re-authenticate with all providers. This action cannot be undone.
						</p>
						<div class="flex justify-end gap-3">
							<Button
								variant="ghost"
								onClick={() => setShowDeleteAllConfirm(false)}
							>
								Cancel
							</Button>
							<Button
								variant="primary"
								onClick={handleDeleteAll}
								class="bg-red-500 hover:bg-red-600"
							>
								Delete All
							</Button>
						</div>
					</div>
				</div>
			</Show>

			{/* Delete Single File Confirmation Modal */}
			<Show when={fileToDelete()}>
				<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
					<div class="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full mx-4 border border-gray-200 dark:border-gray-700 shadow-xl">
						<h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
							Delete Auth File?
						</h3>
						<p class="text-gray-600 dark:text-gray-400 mb-6">
							Delete{" "}
							<span class="font-medium text-gray-900 dark:text-gray-100">
								{fileToDelete()?.name}
							</span>
							? You will need to re-authenticate with this provider.
						</p>
						<div class="flex justify-end gap-3">
							<Button variant="ghost" onClick={() => setFileToDelete(null)}>
								Cancel
							</Button>
							<Button
								variant="primary"
								onClick={confirmDelete}
								class="bg-red-500 hover:bg-red-600"
							>
								Delete
							</Button>
						</div>
					</div>
				</div>
			</Show>
		</div>
	);
}

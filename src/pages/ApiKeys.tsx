import { createEffect, createSignal, For, Show } from "solid-js";
import { Button } from "../components/ui";
import type {
	ClaudeApiKey,
	CodexApiKey,
	GeminiApiKey,
	OpenAICompatibleProvider,
} from "../lib/tauri";
import {
	getClaudeApiKeys,
	getCodexApiKeys,
	getGeminiApiKeys,
	getOpenAICompatibleProviders,
	setClaudeApiKeys,
	setCodexApiKeys,
	setGeminiApiKeys,
	setOpenAICompatibleProviders,
	testOpenAIProvider,
} from "../lib/tauri";
import { appStore } from "../stores/app";
import { toastStore } from "../stores/toast";

type TabId = "gemini" | "claude" | "codex" | "openai-compatible";

interface Tab {
	id: TabId;
	label: string;
	icon: string;
}

const TABS: Tab[] = [
	{ id: "gemini", label: "Gemini", icon: "/logos/gemini.svg" },
	{ id: "claude", label: "Claude", icon: "/logos/claude.svg" },
	{ id: "codex", label: "Codex", icon: "/logos/openai.svg" },
	{ id: "openai-compatible", label: "OpenAI", icon: "/logos/openai.svg" },
];

export function ApiKeysPage() {
	const { setCurrentPage, proxyStatus } = appStore;
	const [activeTab, setActiveTab] = createSignal<TabId>("gemini");
	const [loading, setLoading] = createSignal(false);

	// State for each provider type
	const [geminiKeys, setGeminiKeys] = createSignal<GeminiApiKey[]>([]);
	const [claudeKeys, setClaudeKeys] = createSignal<ClaudeApiKey[]>([]);
	const [codexKeys, setCodexKeys] = createSignal<CodexApiKey[]>([]);
	const [openaiProviders, setOpenaiProviders] = createSignal<
		OpenAICompatibleProvider[]
	>([]);

	// Form state for adding new keys
	const [showAddForm, setShowAddForm] = createSignal(false);
	const [newGeminiKey, setNewGeminiKey] = createSignal<GeminiApiKey>({
		apiKey: "",
	});
	const [newClaudeKey, setNewClaudeKey] = createSignal<ClaudeApiKey>({
		apiKey: "",
	});
	const [newCodexKey, setNewCodexKey] = createSignal<CodexApiKey>({
		apiKey: "",
	});
	const [newOpenaiProvider, setNewOpenaiProvider] =
		createSignal<OpenAICompatibleProvider>({
			name: "",
			baseUrl: "",
			apiKeyEntries: [{ apiKey: "" }],
		});

	// Test connection state
	const [testingIndex, setTestingIndex] = createSignal<number | null>(null);
	const [testingNewProvider, setTestingNewProvider] = createSignal(false);
	const [testResult, setTestResult] = createSignal<{
		success: boolean;
		message: string;
		modelsFound?: number;
	} | null>(null);

	// Load keys when tab changes or proxy starts
	createEffect(() => {
		if (proxyStatus().running) {
			loadKeys();
		}
	});

	const loadKeys = async () => {
		if (!proxyStatus().running) {
			toastStore.error(
				"Proxy not running",
				"Start the proxy to manage API keys",
			);
			return;
		}

		setLoading(true);
		try {
			const [gemini, claude, codex, openai] = await Promise.all([
				getGeminiApiKeys(),
				getClaudeApiKeys(),
				getCodexApiKeys(),
				getOpenAICompatibleProviders(),
			]);
			setGeminiKeys(gemini);
			setClaudeKeys(claude);
			setCodexKeys(codex);
			setOpenaiProviders(openai);
		} catch (error) {
			console.error("Failed to load API keys:", error);
			toastStore.error("Failed to load API keys", String(error));
		} finally {
			setLoading(false);
		}
	};

	const handleAddGeminiKey = async () => {
		const key = newGeminiKey();
		if (!key.apiKey.trim()) {
			toastStore.error("API key required");
			return;
		}

		setLoading(true);
		try {
			const updated = [...geminiKeys(), key];
			await setGeminiApiKeys(updated);
			setGeminiKeys(updated);
			setNewGeminiKey({ apiKey: "" });
			setShowAddForm(false);
			toastStore.success("Gemini API key added");
		} catch (error) {
			toastStore.error("Failed to add key", String(error));
		} finally {
			setLoading(false);
		}
	};

	const handleDeleteGeminiKey = async (index: number) => {
		setLoading(true);
		try {
			const updated = geminiKeys().filter((_, i) => i !== index);
			await setGeminiApiKeys(updated);
			setGeminiKeys(updated);
			toastStore.success("Gemini API key deleted");
		} catch (error) {
			toastStore.error("Failed to delete key", String(error));
		} finally {
			setLoading(false);
		}
	};

	const handleAddClaudeKey = async () => {
		const key = newClaudeKey();
		if (!key.apiKey.trim()) {
			toastStore.error("API key required");
			return;
		}

		setLoading(true);
		try {
			const updated = [...claudeKeys(), key];
			await setClaudeApiKeys(updated);
			setClaudeKeys(updated);
			setNewClaudeKey({ apiKey: "" });
			setShowAddForm(false);
			toastStore.success("Claude API key added");
		} catch (error) {
			toastStore.error("Failed to add key", String(error));
		} finally {
			setLoading(false);
		}
	};

	const handleDeleteClaudeKey = async (index: number) => {
		setLoading(true);
		try {
			const updated = claudeKeys().filter((_, i) => i !== index);
			await setClaudeApiKeys(updated);
			setClaudeKeys(updated);
			toastStore.success("Claude API key deleted");
		} catch (error) {
			toastStore.error("Failed to delete key", String(error));
		} finally {
			setLoading(false);
		}
	};

	const handleAddCodexKey = async () => {
		const key = newCodexKey();
		if (!key.apiKey.trim()) {
			toastStore.error("API key required");
			return;
		}

		setLoading(true);
		try {
			const updated = [...codexKeys(), key];
			await setCodexApiKeys(updated);
			setCodexKeys(updated);
			setNewCodexKey({ apiKey: "" });
			setShowAddForm(false);
			toastStore.success("Codex API key added");
		} catch (error) {
			toastStore.error("Failed to add key", String(error));
		} finally {
			setLoading(false);
		}
	};

	const handleDeleteCodexKey = async (index: number) => {
		setLoading(true);
		try {
			const updated = codexKeys().filter((_, i) => i !== index);
			await setCodexApiKeys(updated);
			setCodexKeys(updated);
			toastStore.success("Codex API key deleted");
		} catch (error) {
			toastStore.error("Failed to delete key", String(error));
		} finally {
			setLoading(false);
		}
	};

	const handleAddOpenaiProvider = async () => {
		const provider = newOpenaiProvider();
		if (!provider.name.trim() || !provider.baseUrl.trim()) {
			toastStore.error("Name and Base URL required");
			return;
		}
		if (!provider.apiKeyEntries[0]?.apiKey.trim()) {
			toastStore.error("At least one API key required");
			return;
		}

		setLoading(true);
		try {
			const updated = [...openaiProviders(), provider];
			await setOpenAICompatibleProviders(updated);
			setOpenaiProviders(updated);
			setNewOpenaiProvider({
				name: "",
				baseUrl: "",
				apiKeyEntries: [{ apiKey: "" }],
			});
			setShowAddForm(false);
			toastStore.success("OpenAI-compatible provider added");
		} catch (error) {
			toastStore.error("Failed to add provider", String(error));
		} finally {
			setLoading(false);
		}
	};

	const handleDeleteOpenaiProvider = async (index: number) => {
		setLoading(true);
		try {
			const updated = openaiProviders().filter((_, i) => i !== index);
			await setOpenAICompatibleProviders(updated);
			setOpenaiProviders(updated);
			toastStore.success("Provider deleted");
		} catch (error) {
			toastStore.error("Failed to delete provider", String(error));
		} finally {
			setLoading(false);
		}
	};

	// Test OpenAI-compatible provider connection
	const handleTestProvider = async (
		baseUrl: string,
		apiKey: string,
		index?: number,
	) => {
		if (index !== undefined) {
			setTestingIndex(index);
		} else {
			setTestingNewProvider(true);
		}
		setTestResult(null);

		try {
			const result = await testOpenAIProvider(baseUrl, apiKey);
			setTestResult({
				success: result.success,
				message: result.message,
				modelsFound: result.modelsFound ?? undefined,
			});
			if (result.success) {
				toastStore.success(
					"Connection successful",
					result.modelsFound ? `Found ${result.modelsFound} models` : undefined,
				);
			} else {
				toastStore.error("Connection failed", result.message);
			}
		} catch (error) {
			setTestResult({
				success: false,
				message: String(error),
			});
			toastStore.error("Test failed", String(error));
		} finally {
			setTestingIndex(null);
			setTestingNewProvider(false);
		}
	};

	const maskApiKey = (key: string) => {
		if (key.length <= 8) return "****";
		return `${key.slice(0, 4)}...${key.slice(-4)}`;
	};

	return (
		<div class="min-h-screen flex flex-col">
			{/* Header */}
			<header class="sticky top-0 z-10 px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
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
						API Keys
					</h1>
					<Show when={loading()}>
						<span class="text-xs text-gray-400 ml-2 flex items-center gap-1">
							<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
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
			</header>

			{/* Proxy not running warning */}
			<Show when={!proxyStatus().running}>
				<div class="mx-4 sm:mx-6 mt-4 p-4 rounded-xl bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
					<div class="flex items-center gap-3">
						<svg
							class="w-5 h-5 text-yellow-600 dark:text-yellow-400"
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
						<div>
							<p class="text-sm font-medium text-yellow-800 dark:text-yellow-200">
								Proxy not running
							</p>
							<p class="text-xs text-yellow-600 dark:text-yellow-400 mt-0.5">
								Start the proxy server to manage API keys via the Management
								API.
							</p>
						</div>
					</div>
				</div>
			</Show>

			{/* Main content */}
			<main class="flex-1 p-4 sm:p-6 overflow-y-auto">
				<div class="max-w-2xl mx-auto space-y-4 sm:space-y-6">
					{/* Tabs */}
					<div class="flex gap-1 p-1 rounded-xl bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
						<For each={TABS}>
							{(tab) => (
								<button
									class={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
										activeTab() === tab.id
											? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
											: "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
									}`}
									onClick={() => {
										setActiveTab(tab.id);
										setShowAddForm(false);
									}}
								>
									<img src={tab.icon} alt="" class="w-4 h-4" />
									<span class="hidden sm:inline">{tab.label}</span>
								</button>
							)}
						</For>
					</div>

					{/* Info text */}
					<p class="text-xs text-gray-500 dark:text-gray-400">
						Add your own API keys to use alongside OAuth-authenticated accounts.
						These keys are stored in CLIProxyAPI and used for load balancing.
					</p>

					{/* Gemini Tab */}
					<Show when={activeTab() === "gemini"}>
						<div class="space-y-4">
							{/* Existing keys */}
							<Show when={geminiKeys().length > 0}>
								<div class="space-y-2">
									<For each={geminiKeys()}>
										{(key, index) => (
											<div class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
												<div class="flex-1 min-w-0">
													<code class="text-sm font-mono text-gray-700 dark:text-gray-300">
														{maskApiKey(key.apiKey)}
													</code>
													<Show when={key.baseUrl}>
														<p class="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
															{key.baseUrl}
														</p>
													</Show>
												</div>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleDeleteGeminiKey(index())}
												>
													<svg
														class="w-4 h-4 text-red-500"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
														/>
													</svg>
												</Button>
											</div>
										)}
									</For>
								</div>
							</Show>

							{/* Add form */}
							<Show when={showAddForm() && activeTab() === "gemini"}>
								<div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 space-y-3">
									<label class="block">
										<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
											API Key *
										</span>
										<input
											type="password"
											value={newGeminiKey().apiKey}
											onInput={(e) =>
												setNewGeminiKey({
													...newGeminiKey(),
													apiKey: e.currentTarget.value,
												})
											}
											placeholder="AIza..."
											class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
										/>
									</label>
									<label class="block">
										<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
											Base URL (optional)
										</span>
										<input
											type="text"
											value={newGeminiKey().baseUrl || ""}
											onInput={(e) =>
												setNewGeminiKey({
													...newGeminiKey(),
													baseUrl: e.currentTarget.value || undefined,
												})
											}
											placeholder="https://generativelanguage.googleapis.com"
											class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
										/>
									</label>
									<div class="flex gap-2 pt-2">
										<Button
											variant="primary"
											size="sm"
											onClick={handleAddGeminiKey}
											disabled={loading()}
										>
											Add Key
										</Button>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setShowAddForm(false)}
										>
											Cancel
										</Button>
									</div>
								</div>
							</Show>

							{/* Add button */}
							<Show when={!showAddForm()}>
								<Button
									variant="secondary"
									onClick={() => setShowAddForm(true)}
									disabled={!proxyStatus().running}
									class="w-full"
								>
									<svg
										class="w-4 h-4 mr-2"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 4v16m8-8H4"
										/>
									</svg>
									Add Gemini API Key
								</Button>
							</Show>
						</div>
					</Show>

					{/* Claude Tab */}
					<Show when={activeTab() === "claude"}>
						<div class="space-y-4">
							<Show when={claudeKeys().length > 0}>
								<div class="space-y-2">
									<For each={claudeKeys()}>
										{(key, index) => (
											<div class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
												<div class="flex-1 min-w-0">
													<code class="text-sm font-mono text-gray-700 dark:text-gray-300">
														{maskApiKey(key.apiKey)}
													</code>
													<Show when={key.baseUrl}>
														<p class="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
															{key.baseUrl}
														</p>
													</Show>
												</div>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleDeleteClaudeKey(index())}
												>
													<svg
														class="w-4 h-4 text-red-500"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
														/>
													</svg>
												</Button>
											</div>
										)}
									</For>
								</div>
							</Show>

							<Show when={showAddForm() && activeTab() === "claude"}>
								<div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 space-y-3">
									<label class="block">
										<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
											API Key *
										</span>
										<input
											type="password"
											value={newClaudeKey().apiKey}
											onInput={(e) =>
												setNewClaudeKey({
													...newClaudeKey(),
													apiKey: e.currentTarget.value,
												})
											}
											placeholder="sk-ant-..."
											class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
										/>
									</label>
									<label class="block">
										<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
											Base URL (optional)
										</span>
										<input
											type="text"
											value={newClaudeKey().baseUrl || ""}
											onInput={(e) =>
												setNewClaudeKey({
													...newClaudeKey(),
													baseUrl: e.currentTarget.value || undefined,
												})
											}
											placeholder="https://api.anthropic.com"
											class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
										/>
									</label>
									<div class="flex gap-2 pt-2">
										<Button
											variant="primary"
											size="sm"
											onClick={handleAddClaudeKey}
											disabled={loading()}
										>
											Add Key
										</Button>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setShowAddForm(false)}
										>
											Cancel
										</Button>
									</div>
								</div>
							</Show>

							<Show when={!showAddForm()}>
								<Button
									variant="secondary"
									onClick={() => setShowAddForm(true)}
									disabled={!proxyStatus().running}
									class="w-full"
								>
									<svg
										class="w-4 h-4 mr-2"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 4v16m8-8H4"
										/>
									</svg>
									Add Claude API Key
								</Button>
							</Show>
						</div>
					</Show>

					{/* Codex Tab */}
					<Show when={activeTab() === "codex"}>
						<div class="space-y-4">
							<Show when={codexKeys().length > 0}>
								<div class="space-y-2">
									<For each={codexKeys()}>
										{(key, index) => (
											<div class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
												<div class="flex-1 min-w-0">
													<code class="text-sm font-mono text-gray-700 dark:text-gray-300">
														{maskApiKey(key.apiKey)}
													</code>
													<Show when={key.baseUrl}>
														<p class="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
															{key.baseUrl}
														</p>
													</Show>
												</div>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleDeleteCodexKey(index())}
												>
													<svg
														class="w-4 h-4 text-red-500"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
														/>
													</svg>
												</Button>
											</div>
										)}
									</For>
								</div>
							</Show>

							<Show when={showAddForm() && activeTab() === "codex"}>
								<div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 space-y-3">
									<label class="block">
										<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
											API Key *
										</span>
										<input
											type="password"
											value={newCodexKey().apiKey}
											onInput={(e) =>
												setNewCodexKey({
													...newCodexKey(),
													apiKey: e.currentTarget.value,
												})
											}
											placeholder="sk-..."
											class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
										/>
									</label>
									<label class="block">
										<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
											Base URL (optional)
										</span>
										<input
											type="text"
											value={newCodexKey().baseUrl || ""}
											onInput={(e) =>
												setNewCodexKey({
													...newCodexKey(),
													baseUrl: e.currentTarget.value || undefined,
												})
											}
											placeholder="https://api.openai.com"
											class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
										/>
									</label>
									<div class="flex gap-2 pt-2">
										<Button
											variant="primary"
											size="sm"
											onClick={handleAddCodexKey}
											disabled={loading()}
										>
											Add Key
										</Button>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setShowAddForm(false)}
										>
											Cancel
										</Button>
									</div>
								</div>
							</Show>

							<Show when={!showAddForm()}>
								<Button
									variant="secondary"
									onClick={() => setShowAddForm(true)}
									disabled={!proxyStatus().running}
									class="w-full"
								>
									<svg
										class="w-4 h-4 mr-2"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 4v16m8-8H4"
										/>
									</svg>
									Add Codex API Key
								</Button>
							</Show>
						</div>
					</Show>

					{/* OpenAI-Compatible Tab */}
					<Show when={activeTab() === "openai-compatible"}>
						<div class="space-y-4">
							<p class="text-xs text-gray-500 dark:text-gray-400">
								Add OpenAI-compatible providers like OpenRouter, Together AI,
								Groq, etc.
							</p>

							<Show when={openaiProviders().length > 0}>
								<div class="space-y-2">
									<For each={openaiProviders()}>
										{(provider, index) => (
											<div class="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
												<div class="flex items-center justify-between">
													<div class="flex-1 min-w-0">
														<p class="text-sm font-medium text-gray-900 dark:text-gray-100">
															{provider.name}
														</p>
														<p class="text-xs text-gray-500 dark:text-gray-400 truncate">
															{provider.baseUrl}
														</p>
														<p class="text-xs text-gray-400 dark:text-gray-500 mt-1">
															{provider.apiKeyEntries.length} API key(s)
														</p>
													</div>
													<div class="flex items-center gap-1">
														<Button
															variant="ghost"
															size="sm"
															onClick={() =>
																handleTestProvider(
																	provider.baseUrl,
																	provider.apiKeyEntries[0]?.apiKey || "",
																	index(),
																)
															}
															disabled={testingIndex() === index()}
														>
															<Show
																when={testingIndex() === index()}
																fallback={
																	<svg
																		class="w-4 h-4 text-blue-500"
																		fill="none"
																		stroke="currentColor"
																		viewBox="0 0 24 24"
																	>
																		<path
																			stroke-linecap="round"
																			stroke-linejoin="round"
																			stroke-width="2"
																			d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
																		/>
																	</svg>
																}
															>
																<svg
																	class="w-4 h-4 animate-spin text-blue-500"
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
														</Button>
														<Button
															variant="ghost"
															size="sm"
															onClick={() =>
																handleDeleteOpenaiProvider(index())
															}
														>
															<svg
																class="w-4 h-4 text-red-500"
																fill="none"
																stroke="currentColor"
																viewBox="0 0 24 24"
															>
																<path
																	stroke-linecap="round"
																	stroke-linejoin="round"
																	stroke-width="2"
																	d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
																/>
															</svg>
														</Button>
													</div>
												</div>
											</div>
										)}
									</For>
								</div>
							</Show>

							<Show when={showAddForm() && activeTab() === "openai-compatible"}>
								<div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 space-y-3">
									<label class="block">
										<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
											Provider Name *
										</span>
										<input
											type="text"
											value={newOpenaiProvider().name}
											onInput={(e) =>
												setNewOpenaiProvider({
													...newOpenaiProvider(),
													name: e.currentTarget.value,
												})
											}
											placeholder="OpenRouter"
											class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
										/>
									</label>
									<label class="block">
										<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
											Base URL *
										</span>
										<input
											type="text"
											value={newOpenaiProvider().baseUrl}
											onInput={(e) =>
												setNewOpenaiProvider({
													...newOpenaiProvider(),
													baseUrl: e.currentTarget.value,
												})
											}
											placeholder="https://openrouter.ai/api/v1"
											class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
										/>
									</label>
									<label class="block">
										<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
											API Key *
										</span>
										<input
											type="password"
											value={newOpenaiProvider().apiKeyEntries[0]?.apiKey || ""}
											onInput={(e) =>
												setNewOpenaiProvider({
													...newOpenaiProvider(),
													apiKeyEntries: [{ apiKey: e.currentTarget.value }],
												})
											}
											placeholder="sk-or-..."
											class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
										/>
									</label>
									<div class="flex gap-2 pt-2">
										<Button
											variant="primary"
											size="sm"
											onClick={handleAddOpenaiProvider}
											disabled={loading()}
										>
											Add Provider
										</Button>
										<Button
											variant="secondary"
											size="sm"
											onClick={() =>
												handleTestProvider(
													newOpenaiProvider().baseUrl,
													newOpenaiProvider().apiKeyEntries[0]?.apiKey || "",
												)
											}
											disabled={
												testingNewProvider() ||
												!newOpenaiProvider().baseUrl ||
												!newOpenaiProvider().apiKeyEntries[0]?.apiKey
											}
										>
											<Show
												when={testingNewProvider()}
												fallback="Test Connection"
											>
												<svg
													class="w-4 h-4 animate-spin mr-1"
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
												Testing...
											</Show>
										</Button>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setShowAddForm(false)}
										>
											Cancel
										</Button>
									</div>
									<Show when={testResult()}>
										<div
											class={`p-2 rounded-lg text-sm ${testResult()?.success ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300" : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"}`}
										>
											<Show
												when={testResult()?.success}
												fallback={
													<span>
														Connection failed: {testResult()?.message}
													</span>
												}
											>
												<span>
													Connection successful!{" "}
													{testResult()?.modelsFound
														? `Found ${testResult()?.modelsFound} models.`
														: ""}
												</span>
											</Show>
										</div>
									</Show>
								</div>
							</Show>

							<Show when={!showAddForm()}>
								<Button
									variant="secondary"
									onClick={() => setShowAddForm(true)}
									disabled={!proxyStatus().running}
									class="w-full"
								>
									<svg
										class="w-4 h-4 mr-2"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 4v16m8-8H4"
										/>
									</svg>
									Add OpenAI-Compatible Provider
								</Button>
							</Show>
						</div>
					</Show>

					{/* Empty state */}
					<Show
						when={
							proxyStatus().running &&
							!loading() &&
							((activeTab() === "gemini" && geminiKeys().length === 0) ||
								(activeTab() === "claude" && claudeKeys().length === 0) ||
								(activeTab() === "codex" && codexKeys().length === 0) ||
								(activeTab() === "openai-compatible" &&
									openaiProviders().length === 0)) &&
							!showAddForm()
						}
					>
						<div class="text-center py-8 text-gray-500 dark:text-gray-400">
							<svg
								class="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
								/>
							</svg>
							<p class="text-sm">No API keys configured yet</p>
							<p class="text-xs mt-1">
								Click the button above to add your first key
							</p>
						</div>
					</Show>
				</div>
			</main>
		</div>
	);
}

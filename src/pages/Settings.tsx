import { getVersion } from "@tauri-apps/api/app";
import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js";
import { ModelsWidget } from "../components/ModelsWidget";
import { Button, Switch } from "../components/ui";

type SettingsTab = "general" | "providers" | "models" | "advanced" | "ssh";


import type {
	AmpModelMapping,
	AmpOpenAIModel,
	AmpOpenAIProvider,
	ClaudeCodeSettings,
	ProviderTestResult,
	SshConfig,
} from "../lib/tauri";
import { open } from "@tauri-apps/plugin-dialog";

import {
	type AgentConfigResult,
	type AgentStatus,
	AMP_MODEL_SLOTS,
	type AvailableModel,
	appendToShellProfile,
	type CopilotApiDetection,
	checkForUpdates,
	configureCliAgent,
	deleteOAuthExcludedModels,
	detectCliAgents,
	detectCopilotApi,
	downloadAndInstallUpdate,
	getAvailableModels,
	getClaudeCodeSettings,
	getCloseToTray,
	getConfigYaml,
	getForceModelMappings,
	getMaxRetryInterval,
	getOAuthExcludedModels,
	getReasoningEffortSettings,
	getThinkingBudgetSettings,
	getThinkingBudgetTokens,
	getWebsocketAuth,
	isUpdaterSupported,
	type OAuthExcludedModels,
	type ReasoningEffortLevel,
	saveConfig,
	setClaudeCodeModel,
	setCloseToTray,
	setConfigYaml,
	setForceModelMappings,
	setMaxRetryInterval,
	setOAuthExcludedModels,
	setReasoningEffortSettings,
	setThinkingBudgetSettings,
	setWebsocketAuth,
	type ThinkingBudgetSettings,
	testOpenAIProvider,
	type UpdateInfo,
	type UpdateProgress,
	type UpdaterSupport,
	saveSshConfig,
	deleteSshConfig,
	setSshConnection,
} from "../lib/tauri";

import { appStore } from "../stores/app";
import { themeStore } from "../stores/theme";
import { toastStore } from "../stores/toast";

export function SettingsPage() {
	const { config, setConfig, setCurrentPage, authStatus } = appStore;
	const [saving, setSaving] = createSignal(false);
	const [activeTab, setActiveTab] = createSignal<SettingsTab>("general");
	const [appVersion, setAppVersion] = createSignal("0.0.0");
	const [models, setModels] = createSignal<AvailableModel[]>([]);
	const [agents, setAgents] = createSignal<AgentStatus[]>([]);
	const [configuringAgent, setConfiguringAgent] = createSignal<string | null>(
		null,
	);

	// Fetch app version on mount
	onMount(async () => {
		try {
			const version = await getVersion();
			setAppVersion(version);
		} catch (error) {
			console.error("Failed to get app version:", error);
		}

		// Load models if proxy is running
		if (appStore.proxyStatus().running) {
			try {
				const availableModels = await getAvailableModels();
				setModels(availableModels);
			} catch (err) {
				console.error("Failed to load models:", err);
			}
		}

		// Load agents
		try {
			const agentList = await detectCliAgents();
			setAgents(agentList);
		} catch (err) {
			console.error("Failed to load agents:", err);
		}
	});

	// Handle agent configuration
	const [configResult, setConfigResult] = createSignal<{
		result: AgentConfigResult;
		agentName: string;
	} | null>(null);
	const [showProxyApiKey, setShowProxyApiKey] = createSignal(false);
	const [showManagementKey, setShowManagementKey] = createSignal(false);

	const handleConfigureAgent = async (agentId: string) => {
		if (!appStore.proxyStatus().running) {
			toastStore.warning(
				"Start the proxy first",
				"The proxy must be running to configure agents",
			);
			return;
		}
		setConfiguringAgent(agentId);
		try {
			const availableModels = await getAvailableModels();
			const result = await configureCliAgent(agentId, availableModels);
			const agent = agents().find((a) => a.id === agentId);
			if (result.success) {
				setConfigResult({
					result,
					agentName: agent?.name || agentId,
				});
				const refreshed = await detectCliAgents();
				setAgents(refreshed);
				toastStore.success(`${agent?.name || agentId} configured!`);
			}
		} catch (error) {
			console.error("Failed to configure agent:", error);
			toastStore.error("Configuration failed", String(error));
		} finally {
			setConfiguringAgent(null);
		}
	};

	const handleApplyEnv = async () => {
		const result = configResult();
		if (!result?.result.shellConfig) return;

		try {
			const profilePath = await appendToShellProfile(result.result.shellConfig);
			toastStore.success("Added to shell profile", `Updated ${profilePath}`);
			setConfigResult(null);
			const refreshed = await detectCliAgents();
			setAgents(refreshed);
		} catch (error) {
			toastStore.error("Failed to update shell profile", String(error));
		}
	};

	// Provider modal state
	const [providerModalOpen, setProviderModalOpen] = createSignal(false);
	const [editingProviderId, setEditingProviderId] = createSignal<string | null>(
		null,
	);

	// Provider form state (used in modal)
	const [providerName, setProviderName] = createSignal("");
	const [providerBaseUrl, setProviderBaseUrl] = createSignal("");
	const [providerApiKey, setProviderApiKey] = createSignal("");
	const [providerModels, setProviderModels] = createSignal<AmpOpenAIModel[]>(
		[],
	);
	const [newModelName, setNewModelName] = createSignal("");
	const [newModelAlias, setNewModelAlias] = createSignal("");

	// Custom mapping state (for adding new mappings beyond predefined slots)
	const [newMappingFrom, setNewMappingFrom] = createSignal("");
	const [newMappingTo, setNewMappingTo] = createSignal("");

	// Provider test state
	const [testingProvider, setTestingProvider] = createSignal(false);
	const [providerTestResult, setProviderTestResult] =
		createSignal<ProviderTestResult | null>(null);

	// Available models from proxy (real-time)
	const [availableModels, setAvailableModels] = createSignal<AvailableModel[]>(
		[],
	);

	// Thinking Budget settings for Antigravity Claude models
	const [thinkingBudgetMode, setThinkingBudgetMode] =
		createSignal<ThinkingBudgetSettings["mode"]>("medium");
	const [thinkingBudgetCustom, setThinkingBudgetCustom] = createSignal(16000);
	const [savingThinkingBudget, setSavingThinkingBudget] = createSignal(false);

	// Reasoning Effort settings for GPT/Codex models (used in CLI agent configs)
	const [reasoningEffortLevel, setReasoningEffortLevel] =
		createSignal<ReasoningEffortLevel>("medium");
	const [savingReasoningEffort, setSavingReasoningEffort] = createSignal(false);

	// Management API runtime settings
	const [maxRetryInterval, setMaxRetryIntervalState] = createSignal<number>(0);
	const [websocketAuth, setWebsocketAuthState] = createSignal<boolean>(false);
	const [forceModelMappings, setForceModelMappingsState] =
		createSignal<boolean>(false);
	const [savingMaxRetryInterval, setSavingMaxRetryInterval] =
		createSignal(false);
	const [savingWebsocketAuth, setSavingWebsocketAuth] = createSignal(false);
	const [savingForceModelMappings, setSavingForceModelMappings] =
		createSignal(false);

	// OAuth Excluded Models state
	const [oauthExcludedModels, setOAuthExcludedModelsState] =
		createSignal<OAuthExcludedModels>({});
	const [loadingExcludedModels, setLoadingExcludedModels] = createSignal(false);
	const [savingExcludedModels, setSavingExcludedModels] = createSignal(false);
	const [newExcludedProvider, setNewExcludedProvider] = createSignal("");
	const [newExcludedModel, setNewExcludedModel] = createSignal("");

	// Raw YAML Config Editor state
	const [yamlConfigExpanded, setYamlConfigExpanded] = createSignal(false);
	const [yamlContent, setYamlContent] = createSignal("");
	const [loadingYaml, setLoadingYaml] = createSignal(false);
	const [savingYaml, setSavingYaml] = createSignal(false);

	// Copilot Detection state
	const [copilotDetection, setCopilotDetection] =
		createSignal<CopilotApiDetection | null>(null);
	const [detectingCopilot, setDetectingCopilot] = createSignal(false);

	// App Updates state
	const [updateInfo, setUpdateInfo] = createSignal<UpdateInfo | null>(null);
	const [checkingForUpdates, setCheckingForUpdates] = createSignal(false);
	const [installingUpdate, setInstallingUpdate] = createSignal(false);
	const [updateProgress, setUpdateProgress] =
		createSignal<UpdateProgress | null>(null);
	const [updaterSupport, setUpdaterSupport] =
		createSignal<UpdaterSupport | null>(null);

	// Check updater support on mount
	createEffect(async () => {
		try {
			const support = await isUpdaterSupported();
			setUpdaterSupport(support);
		} catch (error) {
			console.error("Failed to check updater support:", error);
		}
	});

	// Close to tray setting
	const [closeToTray, setCloseToTrayState] = createSignal(true);
	const [savingCloseToTray, setSavingCloseToTray] = createSignal(false);

	// Load close to tray setting on mount
	createEffect(async () => {
		try {
			const enabled = await getCloseToTray();
			setCloseToTrayState(enabled);
		} catch (error) {
			console.error("Failed to fetch close to tray setting:", error);
		}
	});

	// Handler for close to tray change
	const handleCloseToTrayChange = async (enabled: boolean) => {
		setSavingCloseToTray(true);
		try {
			await setCloseToTray(enabled);
			setCloseToTrayState(enabled);
			toastStore.success(
				enabled
					? "Window will minimize to tray when closed"
					: "Window will quit when closed",
			);
		} catch (error) {
			console.error("Failed to save close to tray setting:", error);
			toastStore.error(`Failed to save setting: ${error}`);
		} finally {
			setSavingCloseToTray(false);
		}
	};

	// Claude Code settings
	const [claudeCodeSettings, setClaudeCodeSettings] =
		createSignal<ClaudeCodeSettings>({
			haikuModel: null,
			opusModel: null,
			sonnetModel: null,
			baseUrl: null,
			authToken: null,
		});

	// Load Claude Code settings on mount
	createEffect(async () => {
		try {
			const settings = await getClaudeCodeSettings();
			setClaudeCodeSettings(settings);
		} catch (error) {
			console.error("Failed to fetch Claude Code settings:", error);
		}
	});

	// Handler for Claude Code setting changes
	const handleClaudeCodeSettingChange = async (
		modelType: "haikuModel" | "opusModel" | "sonnetModel",
		modelName: string,
	) => {
		try {
			// Map frontend key to backend expected value
			const backendModelType = modelType.replace("Model", "") as
				| "haiku"
				| "opus"
				| "sonnet";
			await setClaudeCodeModel(backendModelType, modelName);
			setClaudeCodeSettings((prev) => ({
				...prev,
				[modelType]: modelName || null,
			}));
			toastStore.success("Claude Code model updated");
		} catch (error) {
			console.error("Failed to save Claude Code setting:", error);
			toastStore.error(`Failed to save setting: ${error}`);
		}
	};

	// SSH State
	const [sshId, setSshId] = createSignal("");
	const [sshHost, setSshHost] = createSignal("");
	const [sshPort, setSshPort] = createSignal(22);
	const [sshUser, setSshUser] = createSignal("");
	const [sshPass, setSshPass] = createSignal("");
	const [sshKey, setSshKey] = createSignal("");
	const [sshRemote, setSshRemote] = createSignal(8317);
	const [sshLocal, setSshLocal] = createSignal(8317);
	const [sshAdding, setSshAdding] = createSignal(false);

	// SSH Handlers
	const handlePickKeyFile = async () => {
		try {
			const file = await open({
				multiple: false,
				filters: [{ name: "All Files", extensions: ["*"] }]
			});
			if (file) setSshKey(file as string);
		} catch (e) {
			console.error(e);
		}
	};

	const handleSaveSsh = async () => {
		if (!sshHost() || !sshUser()) {
			toastStore.error("Host and Username are required");
			return;
		}

		setSshAdding(true);
		try {
			const newConfig: SshConfig = {
				id: sshId() || crypto.randomUUID(),
				host: sshHost(),
				port: sshPort(),
				username: sshUser(),
				password: sshPass() || undefined,
				keyFile: sshKey() || undefined,
				remotePort: sshRemote(),
				localPort: sshLocal(),
				enabled: false,
			};

			const updated = await saveSshConfig(newConfig);
			setConfig(prev => ({ ...prev, sshConfigs: updated }));

			// Reset form
			handleCancelEdit();
			toastStore.success("Connection saved");
		} catch (e) {
			toastStore.error("Failed to save", String(e));
		} finally {
			setSshAdding(false);
		}
	};

	const handleEditSsh = (ssh: SshConfig) => {
		setSshId(ssh.id);
		setSshHost(ssh.host);
		setSshPort(ssh.port);
		setSshUser(ssh.username);
		setSshPass(ssh.password || "");
		setSshKey(ssh.keyFile || "");
		setSshRemote(ssh.remotePort);
		setSshLocal(ssh.localPort);
		// Scroll to form?
	};

	const handleCancelEdit = () => {
		setSshId("");
		setSshHost("");
		setSshPort(22);
		setSshUser("");
		setSshPass("");
		setSshKey("");
		setSshRemote(8317);
		setSshLocal(8317);
	};

	const handleDeleteSsh = async (id: string) => {
		if (!confirm("Delete this connection?")) return;
		try {
			const updated = await deleteSshConfig(id);
			setConfig(prev => ({ ...prev, sshConfigs: updated }));
		} catch (e) {
			toastStore.error("Failed to delete", String(e));
		}
	};

	const handleToggleSsh = async (id: string, enable: boolean) => {
		try {
			await setSshConnection(id, enable);
			// Updating local config to reflect target state immediately for UI responsiveness
			const configs = config().sshConfigs || [];
			const updated = configs.map(c => c.id === id ? { ...c, enabled: enable } : c);
			setConfig(prev => ({ ...prev, sshConfigs: updated }));
		} catch (e) {
			toastStore.error("Failed to toggle", String(e));
		}
	};

	// Check for app updates
	const handleCheckForUpdates = async () => {
		setCheckingForUpdates(true);
		setUpdateInfo(null);
		try {
			const info = await checkForUpdates();
			setUpdateInfo(info);
			if (info.available) {
				toastStore.success(`Update available: v${info.version}`);
			} else {
				toastStore.success("You're on the latest version");
			}
		} catch (error) {
			console.error("Update check failed:", error);
			toastStore.error(`Update check failed: ${error}`);
		} finally {
			setCheckingForUpdates(false);
		}
	};

	// Download and install update
	const handleInstallUpdate = async () => {
		setInstallingUpdate(true);
		setUpdateProgress(null);
		try {
			await downloadAndInstallUpdate((progress) => {
				setUpdateProgress(progress);
			});
			// App will restart, so this won't be reached
		} catch (error) {
			console.error("Update installation failed:", error);
			toastStore.error(`Update failed: ${error}`);
			setInstallingUpdate(false);
			setUpdateProgress(null);
		}
	};

	// Run copilot detection
	const runCopilotDetection = async () => {
		setDetectingCopilot(true);
		try {
			const result = await detectCopilotApi();
			setCopilotDetection(result);
		} catch (error) {
			console.error("Copilot detection failed:", error);
			toastStore.error(`Detection failed: ${error}`);
		} finally {
			setDetectingCopilot(false);
		}
	};

	// Fetch available models and runtime settings when proxy is running
	createEffect(async () => {
		const proxyRunning = appStore.proxyStatus().running;
		if (proxyRunning) {
			try {
				const models = await getAvailableModels();
				setAvailableModels(models);
			} catch (error) {
				console.error("Failed to fetch available models:", error);
				setAvailableModels([]);
			}

			// Fetch runtime settings from Management API
			try {
				const interval = await getMaxRetryInterval();
				setMaxRetryIntervalState(interval);
			} catch (error) {
				console.error("Failed to fetch max retry interval:", error);
			}

			try {
				const wsAuth = await getWebsocketAuth();
				setWebsocketAuthState(wsAuth);
			} catch (error) {
				console.error("Failed to fetch WebSocket auth:", error);
			}

			try {
				const prioritize = await getForceModelMappings();
				setForceModelMappingsState(prioritize);
			} catch (error) {
				console.error("Failed to fetch prioritize model mappings:", error);
			}

			// Fetch thinking budget settings
			try {
				const thinkingSettings = await getThinkingBudgetSettings();
				setThinkingBudgetMode(thinkingSettings.mode);
				setThinkingBudgetCustom(thinkingSettings.customBudget);
			} catch (error) {
				console.error("Failed to fetch thinking budget settings:", error);
			}

			// Fetch reasoning effort settings for GPT/Codex models
			try {
				const reasoningSettings = await getReasoningEffortSettings();
				setReasoningEffortLevel(reasoningSettings.level);
			} catch (error) {
				console.error("Failed to fetch reasoning effort settings:", error);
			}

			// Fetch OAuth excluded models
			try {
				setLoadingExcludedModels(true);
				const excluded = await getOAuthExcludedModels();
				setOAuthExcludedModelsState(excluded);
			} catch (error) {
				console.error("Failed to fetch OAuth excluded models:", error);
			} finally {
				setLoadingExcludedModels(false);
			}
		} else {
			setAvailableModels([]);
		}
	});

	// Handler for max retry interval change
	const handleMaxRetryIntervalChange = async (value: number) => {
		setSavingMaxRetryInterval(true);
		try {
			await setMaxRetryInterval(value);
			setMaxRetryIntervalState(value);
			toastStore.success("Max retry interval updated");
		} catch (error) {
			toastStore.error("Failed to update max retry interval", String(error));
		} finally {
			setSavingMaxRetryInterval(false);
		}
	};

	// Handler for WebSocket auth toggle
	const handleWebsocketAuthChange = async (value: boolean) => {
		setSavingWebsocketAuth(true);
		try {
			await setWebsocketAuth(value);
			setWebsocketAuthState(value);
			toastStore.success(
				`WebSocket authentication ${value ? "enabled" : "disabled"}`,
			);
		} catch (error) {
			toastStore.error("Failed to update WebSocket auth", String(error));
		} finally {
			setSavingWebsocketAuth(false);
		}
	};

	// Handler for prioritize model mappings toggle
	const handleForceModelMappingsChange = async (value: boolean) => {
		setSavingForceModelMappings(true);
		try {
			await setForceModelMappings(value);
			setForceModelMappingsState(value);
			toastStore.success(
				`Model mapping priority ${value ? "enabled" : "disabled"}`,
				value
					? "Model mappings now take precedence over local API keys"
					: "Local API keys now take precedence over model mappings",
			);
		} catch (error) {
			toastStore.error(
				"Failed to update model mapping priority",
				String(error),
			);
		} finally {
			setSavingForceModelMappings(false);
		}
	};

	// Handler for adding excluded model
	const handleAddExcludedModel = async () => {
		const provider = newExcludedProvider().trim().toLowerCase();
		const model = newExcludedModel().trim();

		if (!provider || !model) {
			toastStore.error("Provider and model are required");
			return;
		}

		setSavingExcludedModels(true);
		try {
			const current = oauthExcludedModels();
			const existing = current[provider] || [];
			if (existing.includes(model)) {
				toastStore.error("Model already excluded for this provider");
				return;
			}

			const updated = [...existing, model];
			await setOAuthExcludedModels(provider, updated);
			setOAuthExcludedModelsState({ ...current, [provider]: updated });
			setNewExcludedModel("");
			toastStore.success(`Model "${model}" excluded for ${provider}`);
		} catch (error) {
			toastStore.error("Failed to add excluded model", String(error));
		} finally {
			setSavingExcludedModels(false);
		}
	};

	// Handler for removing excluded model
	const handleRemoveExcludedModel = async (provider: string, model: string) => {
		setSavingExcludedModels(true);
		try {
			const current = oauthExcludedModels();
			const existing = current[provider] || [];
			const updated = existing.filter((m) => m !== model);

			if (updated.length === 0) {
				await deleteOAuthExcludedModels(provider);
				const newState = { ...current };
				delete newState[provider];
				setOAuthExcludedModelsState(newState);
			} else {
				await setOAuthExcludedModels(provider, updated);
				setOAuthExcludedModelsState({ ...current, [provider]: updated });
			}
			toastStore.success(`Model "${model}" removed from ${provider}`);
		} catch (error) {
			toastStore.error("Failed to remove excluded model", String(error));
		} finally {
			setSavingExcludedModels(false);
		}
	};

	// Raw YAML Config handlers
	const loadYamlConfig = async () => {
		if (!appStore.proxyStatus().running) return;
		setLoadingYaml(true);
		try {
			const yaml = await getConfigYaml();
			setYamlContent(yaml);
		} catch (error) {
			toastStore.error("Failed to load config YAML", String(error));
		} finally {
			setLoadingYaml(false);
		}
	};

	const saveYamlConfig = async () => {
		setSavingYaml(true);
		try {
			await setConfigYaml(yamlContent());
			toastStore.success(
				"Config YAML saved. Some changes may require a restart.",
			);
		} catch (error) {
			toastStore.error("Failed to save config YAML", String(error));
		} finally {
			setSavingYaml(false);
		}
	};

	// Load YAML when expanding the editor
	createEffect(() => {
		if (
			yamlConfigExpanded() &&
			appStore.proxyStatus().running &&
			!yamlContent()
		) {
			loadYamlConfig();
		}
	});

	// Test connection to the custom OpenAI provider
	const testProviderConnection = async () => {
		const baseUrl = providerBaseUrl().trim();
		const apiKey = providerApiKey().trim();

		if (!baseUrl || !apiKey) {
			toastStore.error("Base URL and API key are required to test connection");
			return;
		}

		setTestingProvider(true);
		setProviderTestResult(null);

		try {
			const result = await testOpenAIProvider(baseUrl, apiKey);
			setProviderTestResult(result);

			if (result.success) {
				const modelsInfo = result.modelsFound
					? ` Found ${result.modelsFound} models.`
					: "";
				toastStore.success(`Connection successful!${modelsInfo}`);
			} else {
				toastStore.error(result.message);
			}
		} catch (error) {
			const errorMsg = String(error);
			setProviderTestResult({
				success: false,
				message: errorMsg,
			});
			toastStore.error("Connection test failed", errorMsg);
		} finally {
			setTestingProvider(false);
		}
	};

	// Initialize OpenAI provider form for editing
	const openProviderModal = (provider?: AmpOpenAIProvider) => {
		if (provider) {
			setEditingProviderId(provider.id);
			setProviderName(provider.name);
			setProviderBaseUrl(provider.baseUrl);
			setProviderApiKey(provider.apiKey);
			setProviderModels(provider.models || []);
		} else {
			setEditingProviderId(null);
			setProviderName("");
			setProviderBaseUrl("");
			setProviderApiKey("");
			setProviderModels([]);
		}
		setProviderTestResult(null);
		setProviderModalOpen(true);
	};

	const closeProviderModal = () => {
		setProviderModalOpen(false);
		setEditingProviderId(null);
		setProviderName("");
		setProviderBaseUrl("");
		setProviderApiKey("");
		setProviderModels([]);
		setProviderTestResult(null);
	};

	// Helper to get mapping for a slot
	const getMappingForSlot = (slotId: string) => {
		const slot = AMP_MODEL_SLOTS.find((s) => s.id === slotId);
		if (!slot) return null;
		const mappings = config().ampModelMappings || [];
		return mappings.find((m) => m.from === slot.fromModel);
	};

	// Update mapping for a slot
	const updateSlotMapping = async (
		slotId: string,
		toModel: string,
		enabled: boolean,
	) => {
		const slot = AMP_MODEL_SLOTS.find((s) => s.id === slotId);
		if (!slot) return;

		const currentMappings = config().ampModelMappings || [];
		// Remove existing mapping for this slot
		const filteredMappings = currentMappings.filter(
			(m) => m.from !== slot.fromModel,
		);

		// Add new mapping if enabled and has a target
		let newMappings: AmpModelMapping[];
		if (enabled && toModel) {
			newMappings = [
				...filteredMappings,
				{ from: slot.fromModel, to: toModel, enabled: true },
			];
		} else {
			newMappings = filteredMappings;
		}

		const newConfig = { ...config(), ampModelMappings: newMappings };
		setConfig(newConfig);

		setSaving(true);
		try {
			await saveConfig(newConfig);
			toastStore.success("Model mapping updated");
		} catch (error) {
			console.error("Failed to save config:", error);
			toastStore.error("Failed to save settings", String(error));
		} finally {
			setSaving(false);
		}
	};

	// Get custom mappings (mappings that are not in predefined slots)
	const getCustomMappings = () => {
		const mappings = config().ampModelMappings || [];
		const slotFromModels = new Set(AMP_MODEL_SLOTS.map((s) => s.fromModel));
		return mappings.filter((m) => !slotFromModels.has(m.from));
	};

	// Add a custom mapping
	const addCustomMapping = async () => {
		const from = newMappingFrom().trim();
		const to = newMappingTo().trim();

		if (!from || !to) {
			toastStore.error("Both 'from' and 'to' models are required");
			return;
		}

		// Check for duplicates
		const existingMappings = config().ampModelMappings || [];
		if (existingMappings.some((m) => m.from === from)) {
			toastStore.error(`A mapping for '${from}' already exists`);
			return;
		}

		const newMapping: AmpModelMapping = { from, to, enabled: true };
		const newMappings = [...existingMappings, newMapping];

		const newConfig = { ...config(), ampModelMappings: newMappings };
		setConfig(newConfig);

		setSaving(true);
		try {
			await saveConfig(newConfig);
			toastStore.success("Custom mapping added");
			setNewMappingFrom("");
			setNewMappingTo("");
		} catch (error) {
			console.error("Failed to save config:", error);
			toastStore.error("Failed to save settings", String(error));
		} finally {
			setSaving(false);
		}
	};

	// Remove a custom mapping
	const removeCustomMapping = async (fromModel: string) => {
		const currentMappings = config().ampModelMappings || [];
		const newMappings = currentMappings.filter((m) => m.from !== fromModel);

		const newConfig = { ...config(), ampModelMappings: newMappings };
		setConfig(newConfig);

		setSaving(true);
		try {
			await saveConfig(newConfig);
			toastStore.success("Custom mapping removed");
		} catch (error) {
			console.error("Failed to save config:", error);
			toastStore.error("Failed to save settings", String(error));
		} finally {
			setSaving(false);
		}
	};

	// Save thinking budget settings
	const saveThinkingBudget = async () => {
		setSavingThinkingBudget(true);
		try {
			await setThinkingBudgetSettings({
				mode: thinkingBudgetMode(),
				customBudget: thinkingBudgetCustom(),
			});
			toastStore.success(
				`Thinking budget updated to ${getThinkingBudgetTokens({ mode: thinkingBudgetMode(), customBudget: thinkingBudgetCustom() })} tokens`,
			);
		} catch (error) {
			console.error("Failed to save thinking budget:", error);
			toastStore.error("Failed to save thinking budget", String(error));
		} finally {
			setSavingThinkingBudget(false);
		}
	};

	// Save reasoning effort settings for GPT/Codex models
	const saveReasoningEffort = async () => {
		setSavingReasoningEffort(true);
		try {
			await setReasoningEffortSettings({
				level: reasoningEffortLevel(),
			});
			toastStore.success(
				`Reasoning effort updated to "${reasoningEffortLevel()}"`,
			);
		} catch (error) {
			console.error("Failed to save reasoning effort:", error);
			toastStore.error("Failed to save reasoning effort", String(error));
		} finally {
			setSavingReasoningEffort(false);
		}
	};

	// Update an existing custom mapping
	const updateCustomMapping = async (
		fromModel: string,
		newToModel: string,
		enabled: boolean,
	) => {
		const currentMappings = config().ampModelMappings || [];
		const newMappings = currentMappings.map((m) =>
			m.from === fromModel ? { ...m, to: newToModel, enabled } : m,
		);

		const newConfig = { ...config(), ampModelMappings: newMappings };
		setConfig(newConfig);

		setSaving(true);
		try {
			await saveConfig(newConfig);
			toastStore.success("Mapping updated");
		} catch (error) {
			console.error("Failed to save config:", error);
			toastStore.error("Failed to save settings", String(error));
		} finally {
			setSaving(false);
		}
	};

	// Get list of available target models (from OpenAI providers aliases + real available models)
	const getAvailableTargetModels = () => {
		const customModels: { value: string; label: string }[] = [];

		// Add models from all custom OpenAI providers
		const providers = config().ampOpenaiProviders || [];
		for (const provider of providers) {
			if (provider?.models) {
				for (const model of provider.models) {
					if (model.alias) {
						customModels.push({
							value: model.alias,
							label: `${model.alias} (${provider.name})`,
						});
					} else {
						customModels.push({
							value: model.name,
							label: `${model.name} (${provider.name})`,
						});
					}
				}
			}
		}

		// Group real available models by provider
		const models = availableModels();
		const groupedModels = {
			anthropic: models
				.filter((m) => m.ownedBy === "anthropic")
				.map((m) => ({ value: m.id, label: m.id })),
			google: models
				.filter((m) => m.ownedBy === "google" || m.ownedBy === "antigravity")
				.map((m) => ({ value: m.id, label: m.id })),
			openai: models
				.filter((m) => m.ownedBy === "openai")
				.map((m) => ({ value: m.id, label: m.id })),
			qwen: models
				.filter((m) => m.ownedBy === "qwen")
				.map((m) => ({ value: m.id, label: m.id })),
			iflow: models
				.filter((m) => m.ownedBy === "iflow")
				.map((m) => ({ value: m.id, label: m.id })),
			// GitHub Copilot models (via copilot-api) - includes both GPT and Claude models
			copilot: models
				.filter(
					(m) =>
						m.ownedBy === "copilot" ||
						(m.ownedBy === "claude" && m.id.startsWith("copilot-")),
				)
				.map((m) => ({ value: m.id, label: m.id })),
		};

		return { customModels, builtInModels: groupedModels };
	};

	const handleConfigChange = async (
		key: keyof ReturnType<typeof config>,
		value: boolean | number | string,
	) => {
		const newConfig = { ...config(), [key]: value };
		setConfig(newConfig);

		// Auto-save config
		setSaving(true);
		try {
			await saveConfig(newConfig);
			toastStore.success("Settings saved");
		} catch (error) {
			console.error("Failed to save config:", error);
			toastStore.error("Failed to save settings", String(error));
		} finally {
			setSaving(false);
		}
	};

	const connectedCount = () => {
		const auth = authStatus();
		return [
			auth.claude,
			auth.openai,
			auth.gemini,
			auth.antigravity,
			auth.qwen,
			auth.iflow,
			auth.vertex,
		].filter(Boolean).length;
	};

	const addProviderModel = () => {
		const name = newModelName().trim();
		const alias = newModelAlias().trim();
		if (!name) {
			toastStore.error("Model name is required");
			return;
		}
		setProviderModels([...providerModels(), { name, alias }]);
		setNewModelName("");
		setNewModelAlias("");
	};

	const removeProviderModel = (index: number) => {
		setProviderModels(providerModels().filter((_, i) => i !== index));
	};

	const saveOpenAIProvider = async () => {
		const name = providerName().trim();
		const baseUrl = providerBaseUrl().trim();
		const apiKey = providerApiKey().trim();

		if (!name || !baseUrl || !apiKey) {
			toastStore.error("Provider name, base URL, and API key are required");
			return;
		}

		const currentProviders = config().ampOpenaiProviders || [];
		const editId = editingProviderId();

		let newProviders: AmpOpenAIProvider[];
		if (editId) {
			// Update existing provider
			newProviders = currentProviders.map((p) =>
				p.id === editId
					? { id: editId, name, baseUrl, apiKey, models: providerModels() }
					: p,
			);
		} else {
			// Add new provider with generated UUID
			const newProvider: AmpOpenAIProvider = {
				id: crypto.randomUUID(),
				name,
				baseUrl,
				apiKey,
				models: providerModels(),
			};
			newProviders = [...currentProviders, newProvider];
		}

		const newConfig = { ...config(), ampOpenaiProviders: newProviders };
		setConfig(newConfig);

		setSaving(true);
		try {
			await saveConfig(newConfig);
			toastStore.success(editId ? "Provider updated" : "Provider added");
			closeProviderModal();
		} catch (error) {
			console.error("Failed to save config:", error);
			toastStore.error("Failed to save settings", String(error));
		} finally {
			setSaving(false);
		}
	};

	const deleteOpenAIProvider = async (providerId: string) => {
		const currentProviders = config().ampOpenaiProviders || [];
		const newProviders = currentProviders.filter((p) => p.id !== providerId);

		const newConfig = { ...config(), ampOpenaiProviders: newProviders };
		setConfig(newConfig);

		setSaving(true);
		try {
			await saveConfig(newConfig);
			toastStore.success("Provider removed");
		} catch (error) {
			console.error("Failed to save config:", error);
			toastStore.error("Failed to remove provider", String(error));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div class="min-h-screen flex flex-col">
			{/* Header with Tabs */}
			<header class="sticky top-0 z-10 px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
				<div class="flex items-center justify-between gap-2 sm:gap-3">
					<div class="flex items-center gap-2 sm:gap-3">
						<h1 class="font-bold text-lg text-gray-900 dark:text-gray-100">
							Settings
						</h1>
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
					<div class="flex gap-1">
						<For
							each={[
								{ id: "general" as SettingsTab, label: "General" },
								{ id: "providers" as SettingsTab, label: "Providers" },
								{ id: "models" as SettingsTab, label: "Models" },
								{ id: "ssh" as SettingsTab, label: "SSH API" },
								{ id: "advanced" as SettingsTab, label: "Advanced" },
							]}
						>
							{(tab) => (
								<button
									type="button"
									onClick={() => setActiveTab(tab.id)}
									class="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
									classList={{
										"bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400":
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

			{/* Main content */}
			<main class="flex-1 p-4 sm:p-6 overflow-y-auto">
				<div class="max-w-xl mx-auto space-y-4 sm:space-y-6 animate-stagger">
					{/* General settings */}
					<div
						class="space-y-4"
						classList={{ hidden: activeTab() !== "general" }}
					>
						<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
							General
						</h2>

						<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
							<Switch
								label="Launch at login"
								description="Start ProxyPal automatically when you log in"
								checked={config().launchAtLogin}
								onChange={(checked) =>
									handleConfigChange("launchAtLogin", checked)
								}
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

					{/* Proxy settings */}
					<div
						class="space-y-4"
						classList={{ hidden: activeTab() !== "general" }}
					>
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
									onInput={(e) =>
										handleConfigChange("proxyUrl", e.currentTarget.value)
									}
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
									API key for client authentication. Change this if exposing
									proxy publicly.
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
									Secret key for internal management API. Change this if
									exposing proxy publicly.
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
									Number of retries on 403, 408, 500, 502, 503, 504 errors
									(0-10)
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
									<option value="round-robin">
										Round Robin (even distribution)
									</option>
									<option value="fill-first">
										Fill First (use first account until limit)
									</option>
									<option value="sequential">Sequential (ordered)</option>
								</select>
								<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
									How auth accounts are selected for requests
								</p>
							</label>

							<Show when={appStore.proxyStatus().running}>
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
											const val = Math.max(
												0,
												parseInt(e.currentTarget.value) || 0,
											);
											handleMaxRetryIntervalChange(val);
										}}
										disabled={savingMaxRetryInterval()}
										class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth disabled:opacity-50"
										min="0"
									/>
									<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
										Maximum wait time between retries in seconds (0 = no limit).
										Updates live without restart.
									</p>
								</label>
							</Show>
						</div>
					</div>

					{/* Thinking Budget Settings */}
					<div
						class="space-y-4"
						classList={{ hidden: activeTab() !== "general" }}
					>
						<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
							Thinking Budget (Antigravity Claude Models)
						</h2>

						<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
							<p class="text-xs text-gray-500 dark:text-gray-400">
								Configure the thinking/reasoning token budget for Antigravity
								Claude models (gemini-claude-sonnet-4-5,
								gemini-claude-opus-4-5). This applies to both OpenCode and
								AmpCode CLI agents.
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
														Math.min(
															200000,
															parseInt(e.currentTarget.value) || 16000,
														),
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

					{/* Reasoning Effort (GPT/Codex Models) */}
					<div
						class="space-y-4"
						classList={{ hidden: activeTab() !== "general" }}
					>
						<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
							Reasoning Effort (GPT/Codex Models)
						</h2>

						<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
							<p class="text-xs text-gray-500 dark:text-gray-400">
								Configure default reasoning effort for GPT-5.x models. This
								setting is applied when configuring CLI agents (OpenCode,
								Factory Droid, etc.) and can be overridden per-request using
								model suffix like{" "}
								<code class="bg-gray-200 dark:bg-gray-700 px-1 rounded">
									gpt-5(high)
								</code>
								.
							</p>

							<div class="space-y-3">
								<label class="block">
									<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
										Default Effort Level
									</span>
									<select
										value={reasoningEffortLevel()}
										onChange={(e) =>
											setReasoningEffortLevel(
												e.currentTarget.value as ReasoningEffortLevel,
											)
										}
										class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth [&>option]:bg-white [&>option]:dark:bg-gray-900 [&>option]:text-gray-900 [&>option]:dark:text-gray-100"
									>
										<option value="none">None (disabled)</option>
										<option value="low">Low (~1,024 tokens)</option>
										<option value="medium">Medium (~8,192 tokens)</option>
										<option value="high">High (~24,576 tokens)</option>
										<option value="xhigh">Extra High (~32,768 tokens)</option>
									</select>
								</label>

								<div class="flex items-center justify-between pt-2">
									<span class="text-sm text-gray-600 dark:text-gray-400">
										Current:{" "}
										<span class="font-medium text-brand-600 dark:text-brand-400">
											{reasoningEffortLevel()}
										</span>
									</span>
									<Button
										variant="primary"
										size="sm"
										onClick={saveReasoningEffort}
										disabled={savingReasoningEffort()}
									>
										{savingReasoningEffort() ? "Saving..." : "Apply"}
									</Button>
								</div>

								<p class="text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
									<span class="font-medium">Per-request override:</span> Use
									model suffix like{" "}
									<code class="bg-gray-200 dark:bg-gray-700 px-1 rounded">
										gpt-5(high)
									</code>{" "}
									or{" "}
									<code class="bg-gray-200 dark:bg-gray-700 px-1 rounded">
										gpt-5.2(low)
									</code>
								</p>
							</div>
						</div>
					</div>

					{/* Claude Code Settings */}
					<div
						class="space-y-4"
						classList={{ hidden: activeTab() !== "general" }}
					>
						<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
							Claude Code Settings
						</h2>

						<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
							<p class="text-xs text-gray-500 dark:text-gray-400">
								Map Claude Code model slots to available provider models. These
								settings modify the claude_desktop_config.json file.
							</p>

							<div class="space-y-3">
								{(() => {
									const { customModels, builtInModels } =
										getAvailableTargetModels();
									const hasModels =
										customModels.length > 0 ||
										builtInModels.anthropic.length > 0 ||
										builtInModels.google.length > 0 ||
										builtInModels.openai.length > 0 ||
										builtInModels.copilot.length > 0;

									if (!hasModels) {
										return (
											<p class="text-sm text-gray-500 dark:text-gray-400 italic">
												No models available. Please authenticate with a provider
												first.
											</p>
										);
									}

									const ModelSelect = (props: {
										label: string;
										value: string | null;
										modelType: "haikuModel" | "opusModel" | "sonnetModel";
									}) => (
										<label class="block">
											<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
												{props.label}
											</span>
											<select
												value={props.value || ""}
												onChange={(e) =>
													handleClaudeCodeSettingChange(
														props.modelType,
														e.currentTarget.value,
													)
												}
												class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth [&>option]:bg-white [&>option]:dark:bg-gray-900 [&>option]:text-gray-900 [&>option]:dark:text-gray-100 [&>optgroup]:bg-white [&>optgroup]:dark:bg-gray-900 [&>optgroup]:text-gray-900 [&>optgroup]:dark:text-gray-100"
											>
												<option value="">Select model...</option>
												<Show when={customModels.length > 0}>
													<optgroup label="Custom Providers">
														<For each={customModels}>
															{(model) => (
																<option value={model.value}>
																	{model.label}
																</option>
															)}
														</For>
													</optgroup>
												</Show>
												<Show when={builtInModels.anthropic.length > 0}>
													<optgroup label="Anthropic">
														<For each={builtInModels.anthropic}>
															{(model) => (
																<option value={model.value}>
																	{model.label}
																</option>
															)}
														</For>
													</optgroup>
												</Show>
												<Show when={builtInModels.google.length > 0}>
													<optgroup label="Google">
														<For each={builtInModels.google}>
															{(model) => (
																<option value={model.value}>
																	{model.label}
																</option>
															)}
														</For>
													</optgroup>
												</Show>
												<Show when={builtInModels.openai.length > 0}>
													<optgroup label="OpenAI">
														<For each={builtInModels.openai}>
															{(model) => (
																<option value={model.value}>
																	{model.label}
																</option>
															)}
														</For>
													</optgroup>
												</Show>
												<Show when={builtInModels.copilot.length > 0}>
													<optgroup label="GitHub Copilot">
														<For each={builtInModels.copilot}>
															{(model) => (
																<option value={model.value}>
																	{model.label}
																</option>
															)}
														</For>
													</optgroup>
												</Show>
												<Show when={builtInModels.qwen.length > 0}>
													<optgroup label="Qwen">
														<For each={builtInModels.qwen}>
															{(model) => (
																<option value={model.value}>
																	{model.label}
																</option>
															)}
														</For>
													</optgroup>
												</Show>
												<Show when={builtInModels.iflow.length > 0}>
													<optgroup label="iFlow">
														<For each={builtInModels.iflow}>
															{(model) => (
																<option value={model.value}>
																	{model.label}
																</option>
															)}
														</For>
													</optgroup>
												</Show>
											</select>
										</label>
									);

									return (
										<>
											<ModelSelect
												label="Haiku Model"
												value={claudeCodeSettings().haikuModel}
												modelType="haikuModel"
											/>
											<ModelSelect
												label="Sonnet Model"
												value={claudeCodeSettings().sonnetModel}
												modelType="sonnetModel"
											/>
											<ModelSelect
												label="Opus Model"
												value={claudeCodeSettings().opusModel}
												modelType="opusModel"
											/>
										</>
									);
								})()}
							</div>
						</div>
					</div>

					{/* Amp CLI Integration */}
					<div
						class="space-y-4"
						classList={{ hidden: activeTab() !== "general" }}
					>
						<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
							Amp CLI Integration
						</h2>

						<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
							<label class="block">
								<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
									Amp API Key
								</span>
								<input
									type="password"
									value={config().ampApiKey || ""}
									onInput={(e) =>
										handleConfigChange("ampApiKey", e.currentTarget.value)
									}
									placeholder="amp_..."
									class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth font-mono"
								/>
								<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
									Get your API key from{" "}
									<a
										href="https://ampcode.com/settings"
										target="_blank"
										rel="noopener noreferrer"
										class="text-brand-500 hover:text-brand-600 underline"
									>
										ampcode.com/settings
									</a>
									. Required for Amp CLI to authenticate through the proxy.
								</p>
							</label>

							<div class="border-t border-gray-200 dark:border-gray-700" />

							{/* Model Mappings */}
							<div class="space-y-3">
								<div>
									<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
										Model Mappings
									</span>
									<p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
										Route Amp model requests to different providers
									</p>
								</div>

								{/* Prioritize Model Mappings Toggle */}
								<Show when={appStore.proxyStatus().running}>
									<div class="flex items-center justify-between p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
										<div class="flex-1">
											<div class="flex items-center gap-2">
												<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
													Prioritize Model Mappings
												</span>
												<Show when={savingForceModelMappings()}>
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
											</div>
											<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
												Model mappings take precedence over local API keys.
												Enable to route mapped models via OAuth instead of local
												keys.
											</p>
										</div>
										<button
											type="button"
											role="switch"
											aria-checked={forceModelMappings()}
											disabled={savingForceModelMappings()}
											onClick={() =>
												handleForceModelMappingsChange(!forceModelMappings())
											}
											class={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 ${forceModelMappings()
												? "bg-brand-600"
												: "bg-gray-200 dark:bg-gray-700"
												}`}
										>
											<span
												aria-hidden="true"
												class={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${forceModelMappings()
													? "translate-x-5"
													: "translate-x-0"
													}`}
											/>
										</button>
									</div>
								</Show>

								{/* Slot-based mappings */}
								<div class="space-y-2">
									<For each={AMP_MODEL_SLOTS}>
										{(slot) => {
											const mapping = () => getMappingForSlot(slot.id);
											const isEnabled = () => !!mapping();
											const currentTarget = () => mapping()?.to || "";

											return (
												<div class="p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
													{/* Mobile: Stack vertically, Desktop: Single row */}
													<div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
														{/* Left side: Checkbox + Slot name */}
														<div class="flex items-center gap-2 shrink-0">
															<input
																type="checkbox"
																checked={isEnabled()}
																onChange={(e) => {
																	const checked = e.currentTarget.checked;
																	if (checked) {
																		const { customModels, builtInModels } =
																			getAvailableTargetModels();
																		const defaultTarget =
																			customModels[0]?.value ||
																			builtInModels.google[0]?.value ||
																			slot.fromModel;
																		updateSlotMapping(
																			slot.id,
																			defaultTarget,
																			true,
																		);
																	} else {
																		updateSlotMapping(slot.id, "", false);
																	}
																}}
																class="w-4 h-4 text-brand-500 bg-gray-100 border-gray-300 rounded focus:ring-brand-500 dark:focus:ring-brand-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
															/>
															<span class="text-sm font-medium text-gray-700 dark:text-gray-300 w-20">
																{slot.name}
															</span>
														</div>

														{/* Right side: From -> To mapping */}
														<div class="flex items-center gap-2 flex-1 min-w-0">
															{/* From model (readonly) - fixed width, truncate on small screens */}
															<div
																class="w-24 sm:w-28 shrink-0 px-2 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-xs text-gray-600 dark:text-gray-400 truncate"
																title={slot.fromLabel}
															>
																{slot.fromLabel}
															</div>

															{/* Arrow */}
															<span class="text-gray-400 text-xs shrink-0">
																→
															</span>

															{/* To model (dropdown) */}
															{(() => {
																const { customModels, builtInModels } =
																	getAvailableTargetModels();
																return (
																	<select
																		value={currentTarget()}
																		onChange={(e) => {
																			const newTarget = e.currentTarget.value;
																			updateSlotMapping(
																				slot.id,
																				newTarget,
																				true,
																			);
																		}}
																		disabled={!isEnabled()}
																		class={`flex-1 min-w-0 px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg text-xs focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth [&>option]:bg-white [&>option]:dark:bg-gray-900 [&>option]:text-gray-900 [&>option]:dark:text-gray-100 [&>optgroup]:bg-white [&>optgroup]:dark:bg-gray-900 [&>optgroup]:text-gray-900 [&>optgroup]:dark:text-gray-100 ${!isEnabled()
																			? "opacity-50 cursor-not-allowed"
																			: ""
																			}`}
																	>
																		<option value="">Select target...</option>
																		<Show when={customModels.length > 0}>
																			<optgroup label="Custom Provider">
																				<For each={customModels}>
																					{(model) => (
																						<option value={model.value}>
																							{model.label}
																						</option>
																					)}
																				</For>
																			</optgroup>
																		</Show>
																		<optgroup label="Anthropic">
																			<For each={builtInModels.anthropic}>
																				{(model) => (
																					<option value={model.value}>
																						{model.label}
																					</option>
																				)}
																			</For>
																		</optgroup>
																		<optgroup label="Google">
																			<For each={builtInModels.google}>
																				{(model) => (
																					<option value={model.value}>
																						{model.label}
																					</option>
																				)}
																			</For>
																		</optgroup>
																		<optgroup label="OpenAI">
																			<For each={builtInModels.openai}>
																				{(model) => (
																					<option value={model.value}>
																						{model.label}
																					</option>
																				)}
																			</For>
																		</optgroup>
																		<optgroup label="Qwen">
																			<For each={builtInModels.qwen}>
																				{(model) => (
																					<option value={model.value}>
																						{model.label}
																					</option>
																				)}
																			</For>
																		</optgroup>
																		<Show when={builtInModels.iflow.length > 0}>
																			<optgroup label="iFlow">
																				<For each={builtInModels.iflow}>
																					{(model) => (
																						<option value={model.value}>
																							{model.label}
																						</option>
																					)}
																				</For>
																			</optgroup>
																		</Show>
																		<Show
																			when={builtInModels.copilot.length > 0}
																		>
																			<optgroup label="GitHub Copilot">
																				<For each={builtInModels.copilot}>
																					{(model) => (
																						<option value={model.value}>
																							{model.label}
																						</option>
																					)}
																				</For>
																			</optgroup>
																		</Show>
																	</select>
																);
															})()}
														</div>
													</div>
												</div>
											);
										}}
									</For>
								</div>

								{/* Custom Mappings Section */}
								<div class="pt-2">
									<p class="text-xs text-gray-500 dark:text-gray-400 mb-2">
										Custom model mappings (for models not in predefined slots)
									</p>

									{/* Existing custom mappings */}
									<For each={getCustomMappings()}>
										{(mapping) => {
											const { customModels, builtInModels } =
												getAvailableTargetModels();
											return (
												<div class="p-3 mb-2 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
													<div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
														{/* Checkbox */}
														<div class="flex items-center gap-2 shrink-0">
															<input
																type="checkbox"
																checked={mapping.enabled !== false}
																onChange={(e) => {
																	updateCustomMapping(
																		mapping.from,
																		mapping.to,
																		e.currentTarget.checked,
																	);
																}}
																class="w-4 h-4 text-brand-500 bg-gray-100 border-gray-300 rounded focus:ring-brand-500 dark:focus:ring-brand-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
															/>
															<span class="text-xs text-gray-500 dark:text-gray-400 sm:hidden">
																Custom
															</span>
														</div>

														{/* Mapping content */}
														<div class="flex items-center gap-2 flex-1 min-w-0">
															{/* From model (readonly) */}
															<div
																class="w-28 sm:w-32 shrink-0 px-2 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-xs text-gray-600 dark:text-gray-400 font-mono truncate"
																title={mapping.from}
															>
																{mapping.from}
															</div>

															{/* Arrow */}
															<span class="text-gray-400 text-xs shrink-0">
																→
															</span>

															{/* To model (dropdown) */}
															<select
																value={mapping.to}
																onChange={(e) => {
																	updateCustomMapping(
																		mapping.from,
																		e.currentTarget.value,
																		mapping.enabled !== false,
																	);
																}}
																disabled={mapping.enabled === false}
																class={`flex-1 min-w-0 px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg text-xs focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth [&>option]:bg-white [&>option]:dark:bg-gray-900 [&>option]:text-gray-900 [&>option]:dark:text-gray-100 [&>optgroup]:bg-white [&>optgroup]:dark:bg-gray-900 [&>optgroup]:text-gray-900 [&>optgroup]:dark:text-gray-100 ${mapping.enabled === false
																	? "opacity-50 cursor-not-allowed"
																	: ""
																	}`}
															>
																<option value="">Select target...</option>
																<Show when={customModels.length > 0}>
																	<optgroup label="Custom Provider">
																		<For each={customModels}>
																			{(model) => (
																				<option value={model.value}>
																					{model.label}
																				</option>
																			)}
																		</For>
																	</optgroup>
																</Show>
																<optgroup label="Anthropic">
																	<For each={builtInModels.anthropic}>
																		{(model) => (
																			<option value={model.value}>
																				{model.label}
																			</option>
																		)}
																	</For>
																</optgroup>
																<optgroup label="Google">
																	<For each={builtInModels.google}>
																		{(model) => (
																			<option value={model.value}>
																				{model.label}
																			</option>
																		)}
																	</For>
																</optgroup>
																<optgroup label="OpenAI">
																	<For each={builtInModels.openai}>
																		{(model) => (
																			<option value={model.value}>
																				{model.label}
																			</option>
																		)}
																	</For>
																</optgroup>
																<optgroup label="Qwen">
																	<For each={builtInModels.qwen}>
																		{(model) => (
																			<option value={model.value}>
																				{model.label}
																			</option>
																		)}
																	</For>
																</optgroup>
																<Show when={builtInModels.iflow.length > 0}>
																	<optgroup label="iFlow">
																		<For each={builtInModels.iflow}>
																			{(model) => (
																				<option value={model.value}>
																					{model.label}
																				</option>
																			)}
																		</For>
																	</optgroup>
																</Show>
																<Show when={builtInModels.copilot.length > 0}>
																	<optgroup label="GitHub Copilot">
																		<For each={builtInModels.copilot}>
																			{(model) => (
																				<option value={model.value}>
																					{model.label}
																				</option>
																			)}
																		</For>
																	</optgroup>
																</Show>
															</select>

															{/* Delete button */}
															<button
																type="button"
																onClick={() =>
																	removeCustomMapping(mapping.from)
																}
																class="p-1.5 text-gray-400 hover:text-red-500 transition-colors shrink-0"
																title="Remove mapping"
															>
																<svg
																	class="w-4 h-4"
																	fill="none"
																	stroke="currentColor"
																	viewBox="0 0 24 24"
																>
																	<path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		stroke-width="2"
																		d="M6 18L18 6M6 6l12 12"
																	/>
																</svg>
															</button>
														</div>
													</div>
												</div>
											);
										}}
									</For>

									{/* Add new custom mapping */}
									<div class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
										<div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
											<input
												type="text"
												value={newMappingFrom()}
												onInput={(e) =>
													setNewMappingFrom(e.currentTarget.value)
												}
												placeholder="From model (e.g. my-custom-model)"
												class="flex-1 min-w-0 px-2 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
											/>
											<span class="text-gray-400 text-xs shrink-0 hidden sm:inline">
												→
											</span>
											{(() => {
												const { customModels, builtInModels } =
													getAvailableTargetModels();
												return (
													<select
														value={newMappingTo()}
														onChange={(e) =>
															setNewMappingTo(e.currentTarget.value)
														}
														class="flex-1 min-w-0 px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg text-xs focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth [&>option]:bg-white [&>option]:dark:bg-gray-900 [&>option]:text-gray-900 [&>option]:dark:text-gray-100 [&>optgroup]:bg-white [&>optgroup]:dark:bg-gray-900 [&>optgroup]:text-gray-900 [&>optgroup]:dark:text-gray-100"
													>
														<option value="">Select target...</option>
														<Show when={customModels.length > 0}>
															<optgroup label="Custom Provider">
																<For each={customModels}>
																	{(model) => (
																		<option value={model.value}>
																			{model.label}
																		</option>
																	)}
																</For>
															</optgroup>
														</Show>
														<optgroup label="Anthropic">
															<For each={builtInModels.anthropic}>
																{(model) => (
																	<option value={model.value}>
																		{model.label}
																	</option>
																)}
															</For>
														</optgroup>
														<optgroup label="Google">
															<For each={builtInModels.google}>
																{(model) => (
																	<option value={model.value}>
																		{model.label}
																	</option>
																)}
															</For>
														</optgroup>
														<optgroup label="OpenAI">
															<For each={builtInModels.openai}>
																{(model) => (
																	<option value={model.value}>
																		{model.label}
																	</option>
																)}
															</For>
														</optgroup>
														<optgroup label="Qwen">
															<For each={builtInModels.qwen}>
																{(model) => (
																	<option value={model.value}>
																		{model.label}
																	</option>
																)}
															</For>
														</optgroup>
														<Show when={builtInModels.iflow.length > 0}>
															<optgroup label="iFlow">
																<For each={builtInModels.iflow}>
																	{(model) => (
																		<option value={model.value}>
																			{model.label}
																		</option>
																	)}
																</For>
															</optgroup>
														</Show>
														<Show when={builtInModels.copilot.length > 0}>
															<optgroup label="GitHub Copilot">
																<For each={builtInModels.copilot}>
																	{(model) => (
																		<option value={model.value}>
																			{model.label}
																		</option>
																	)}
																</For>
															</optgroup>
														</Show>
													</select>
												);
											})()}
											<Button
												variant="secondary"
												size="sm"
												onClick={addCustomMapping}
												disabled={
													!newMappingFrom().trim() || !newMappingTo().trim()
												}
												class="shrink-0"
											>
												<svg
													class="w-4 h-4"
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
											</Button>
										</div>
									</div>
								</div>
							</div>

							<div class="border-t border-gray-200 dark:border-gray-700" />

							{/* Custom OpenAI-Compatible Providers */}
							<div class="space-y-4">
								<div>
									<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
										Custom OpenAI-Compatible Providers
									</span>
									<p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
										Add external providers (ZenMux, OpenRouter, etc.) for
										additional models
									</p>
								</div>

								{/* Provider Table */}
								<Show when={(config().ampOpenaiProviders || []).length > 0}>
									<div class="overflow-x-auto">
										<table class="w-full text-sm">
											<thead>
												<tr class="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
													<th class="pb-2 font-medium">Name</th>
													<th class="pb-2 font-medium">Base URL</th>
													<th class="pb-2 font-medium">Models</th>
													<th class="pb-2 font-medium w-20">Actions</th>
												</tr>
											</thead>
											<tbody class="divide-y divide-gray-100 dark:divide-gray-800">
												<For each={config().ampOpenaiProviders || []}>
													{(provider) => (
														<tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
															<td class="py-2 pr-2">
																<span class="font-medium text-gray-900 dark:text-gray-100">
																	{provider.name}
																</span>
															</td>
															<td class="py-2 pr-2">
																<span
																	class="text-xs text-gray-500 dark:text-gray-400 font-mono truncate max-w-[200px] block"
																	title={provider.baseUrl}
																>
																	{provider.baseUrl}
																</span>
															</td>
															<td class="py-2 pr-2">
																<span class="text-xs text-gray-500 dark:text-gray-400">
																	{provider.models?.length || 0} model
																	{(provider.models?.length || 0) !== 1
																		? "s"
																		: ""}
																</span>
															</td>
															<td class="py-2">
																<div class="flex items-center gap-1">
																	<button
																		type="button"
																		onClick={() => openProviderModal(provider)}
																		class="p-1.5 text-gray-400 hover:text-brand-500 transition-colors"
																		title="Edit provider"
																	>
																		<svg
																			class="w-4 h-4"
																			fill="none"
																			stroke="currentColor"
																			viewBox="0 0 24 24"
																		>
																			<path
																				stroke-linecap="round"
																				stroke-linejoin="round"
																				stroke-width="2"
																				d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
																			/>
																		</svg>
																	</button>
																	<button
																		type="button"
																		onClick={() =>
																			deleteOpenAIProvider(provider.id)
																		}
																		class="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
																		title="Delete provider"
																	>
																		<svg
																			class="w-4 h-4"
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
																	</button>
																</div>
															</td>
														</tr>
													)}
												</For>
											</tbody>
										</table>
									</div>
								</Show>

								{/* Empty state */}
								<Show when={(config().ampOpenaiProviders || []).length === 0}>
									<div class="text-center py-6 text-gray-400 dark:text-gray-500 text-sm">
										No custom providers configured
									</div>
								</Show>

								{/* Add Provider Button */}
								<Button
									variant="secondary"
									size="sm"
									onClick={() => openProviderModal()}
									class="w-full"
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
											d="M12 4v16m8-8H4"
										/>
									</svg>
									Add Provider
								</Button>
							</div>

							{/* Provider Modal */}
							<Show when={providerModalOpen()}>
								<div
									class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
									onClick={(e) => {
										if (e.target === e.currentTarget) closeProviderModal();
									}}
								>
									<div
										class="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
										onClick={(e) => e.stopPropagation()}
									>
										<div class="sticky top-0 bg-white dark:bg-gray-900 px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
											<h3 class="font-semibold text-gray-900 dark:text-gray-100">
												{editingProviderId() ? "Edit Provider" : "Add Provider"}
											</h3>
											<button
												type="button"
												onClick={closeProviderModal}
												class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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
														d="M6 18L18 6M6 6l12 12"
													/>
												</svg>
											</button>
										</div>

										<div class="p-4 space-y-4">
											{/* Provider Name */}
											<label class="block">
												<span class="text-xs font-medium text-gray-600 dark:text-gray-400">
													Provider Name
												</span>
												<input
													type="text"
													value={providerName()}
													onInput={(e) =>
														setProviderName(e.currentTarget.value)
													}
													placeholder="e.g. zenmux, openrouter"
													class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
												/>
											</label>

											{/* Base URL */}
											<label class="block">
												<span class="text-xs font-medium text-gray-600 dark:text-gray-400">
													Base URL
												</span>
												<input
													type="text"
													value={providerBaseUrl()}
													onInput={(e) =>
														setProviderBaseUrl(e.currentTarget.value)
													}
													placeholder="https://api.example.com/v1"
													class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
												/>
											</label>

											{/* API Key */}
											<label class="block">
												<span class="text-xs font-medium text-gray-600 dark:text-gray-400">
													API Key
												</span>
												<input
													type="password"
													value={providerApiKey()}
													onInput={(e) =>
														setProviderApiKey(e.currentTarget.value)
													}
													placeholder="sk-..."
													class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
												/>
											</label>

											{/* Models */}
											<div class="space-y-2">
												<span class="text-xs font-medium text-gray-600 dark:text-gray-400">
													Model Aliases (map proxy model names to provider model
													names)
												</span>

												{/* Existing models */}
												<For each={providerModels()}>
													{(model, index) => (
														<div class="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
															<div class="flex-1 flex items-center gap-2 text-xs font-mono overflow-hidden">
																<span
																	class="text-gray-700 dark:text-gray-300 truncate"
																	title={model.name}
																>
																	{model.name}
																</span>
																<Show when={model.alias}>
																	<svg
																		class="w-4 h-4 text-gray-400 flex-shrink-0"
																		fill="none"
																		stroke="currentColor"
																		viewBox="0 0 24 24"
																	>
																		<path
																			stroke-linecap="round"
																			stroke-linejoin="round"
																			stroke-width="2"
																			d="M13 7l5 5m0 0l-5 5m5-5H6"
																		/>
																	</svg>
																	<span
																		class="text-brand-500 truncate"
																		title={model.alias}
																	>
																		{model.alias}
																	</span>
																</Show>
															</div>
															<button
																type="button"
																onClick={() => removeProviderModel(index())}
																class="p-1 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
																title="Remove model"
															>
																<svg
																	class="w-4 h-4"
																	fill="none"
																	stroke="currentColor"
																	viewBox="0 0 24 24"
																>
																	<path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		stroke-width="2"
																		d="M6 18L18 6M6 6l12 12"
																	/>
																</svg>
															</button>
														</div>
													)}
												</For>

												{/* Add new model */}
												<div class="flex flex-col sm:flex-row gap-2">
													<input
														type="text"
														value={newModelName()}
														onInput={(e) =>
															setNewModelName(e.currentTarget.value)
														}
														placeholder="Provider model (e.g. anthropic/claude-4)"
														class="flex-1 px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
													/>
													<input
														type="text"
														value={newModelAlias()}
														onInput={(e) =>
															setNewModelAlias(e.currentTarget.value)
														}
														placeholder="Alias (e.g. claude-4-20251101)"
														class="flex-1 px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
													/>
													<Button
														variant="secondary"
														size="sm"
														onClick={addProviderModel}
														disabled={!newModelName().trim()}
													>
														<svg
															class="w-4 h-4"
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
													</Button>
												</div>
											</div>

											{/* Test Connection */}
											<div class="flex items-center gap-2">
												<Button
													variant="secondary"
													size="sm"
													onClick={testProviderConnection}
													disabled={
														testingProvider() ||
														!providerBaseUrl().trim() ||
														!providerApiKey().trim()
													}
												>
													{testingProvider() ? (
														<span class="flex items-center gap-1.5">
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
															Testing...
														</span>
													) : (
														"Test Connection"
													)}
												</Button>
											</div>

											{/* Test result indicator */}
											<Show when={providerTestResult()}>
												{(result) => (
													<div
														class={`flex items-center gap-2 p-2 rounded-lg text-xs ${result().success
															? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
															: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
															}`}
													>
														<Show
															when={result().success}
															fallback={
																<svg
																	class="w-4 h-4 flex-shrink-0"
																	fill="none"
																	stroke="currentColor"
																	viewBox="0 0 24 24"
																>
																	<path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		stroke-width="2"
																		d="M6 18L18 6M6 6l12 12"
																	/>
																</svg>
															}
														>
															<svg
																class="w-4 h-4 flex-shrink-0"
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
														</Show>
														<span>{result().message}</span>
														<Show when={result().modelsFound}>
															<span class="text-gray-500 dark:text-gray-400">
																({result().modelsFound} models)
															</span>
														</Show>
														<Show when={result().latencyMs}>
															<span class="text-gray-500 dark:text-gray-400">
																{result().latencyMs}ms
															</span>
														</Show>
													</div>
												)}
											</Show>
										</div>

										{/* Modal Footer */}
										<div class="sticky bottom-0 bg-white dark:bg-gray-900 px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
											<Button
												variant="ghost"
												size="sm"
												onClick={closeProviderModal}
											>
												Cancel
											</Button>
											<Button
												variant="primary"
												size="sm"
												onClick={saveOpenAIProvider}
												disabled={
													!providerName().trim() ||
													!providerBaseUrl().trim() ||
													!providerApiKey().trim()
												}
											>
												{editingProviderId() ? "Save Changes" : "Add Provider"}
											</Button>
										</div>
									</div>
								</div>
							</Show>

							<p class="text-xs text-gray-400 dark:text-gray-500">
								After changing settings, restart the proxy for changes to take
								effect.
							</p>
						</div>
					</div>

					{/* Advanced Settings */}
					<div
						class="space-y-4"
						classList={{ hidden: activeTab() !== "advanced" }}
					>
						<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
							Advanced Settings
						</h2>

						<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
							<Switch
								label="Debug Mode"
								description="Enable verbose logging for troubleshooting"
								checked={config().debug}
								onChange={(checked) => handleConfigChange("debug", checked)}
							/>

							<div class="border-t border-gray-200 dark:border-gray-700" />

							<Switch
								label="Usage Statistics"
								description="Track request counts and token usage"
								checked={config().usageStatsEnabled}
								onChange={(checked) =>
									handleConfigChange("usageStatsEnabled", checked)
								}
							/>

							<div class="border-t border-gray-200 dark:border-gray-700" />

							<Switch
								label="Request Logging"
								description="Log all API requests for debugging"
								checked={config().requestLogging}
								onChange={(checked) =>
									handleConfigChange("requestLogging", checked)
								}
							/>

							<div class="border-t border-gray-200 dark:border-gray-700" />

							<Switch
								label="Commercial Mode"
								description="Disable request logging middleware for lower memory usage (requires restart)"
								checked={config().commercialMode ?? false}
								onChange={(checked) =>
									handleConfigChange("commercialMode", checked)
								}
							/>

							<div class="border-t border-gray-200 dark:border-gray-700" />

							<Switch
								label="Log to File"
								description="Write logs to rotating files instead of stdout"
								checked={config().loggingToFile}
								onChange={(checked) =>
									handleConfigChange("loggingToFile", checked)
								}
							/>

							<Show when={config().loggingToFile}>
								<div class="flex items-center justify-between">
									<div class="flex-1">
										<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
											Max Log Size (MB)
										</span>
										<p class="text-xs text-gray-500 dark:text-gray-400">
											Maximum total size of log files before rotation
										</p>
									</div>
									<input
										type="number"
										min="10"
										max="1000"
										value={config().logsMaxTotalSizeMb || 100}
										onChange={(e) =>
											handleConfigChange(
												"logsMaxTotalSizeMb",
												parseInt(e.currentTarget.value) || 100,
											)
										}
										class="w-24 px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-right focus:ring-2 focus:ring-brand-500 focus:border-transparent"
									/>
								</div>
							</Show>

							<Show when={appStore.proxyStatus().running}>
								<div class="border-t border-gray-200 dark:border-gray-700" />

								<div class="flex items-center justify-between">
									<div class="flex-1">
										<div class="flex items-center gap-2">
											<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
												WebSocket Authentication
											</span>
											<Show when={savingWebsocketAuth()}>
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
										</div>
										<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
											Require authentication for WebSocket connections. Updates
											live without restart.
										</p>
									</div>
									<button
										type="button"
										role="switch"
										aria-checked={websocketAuth()}
										disabled={savingWebsocketAuth()}
										onClick={() => handleWebsocketAuthChange(!websocketAuth())}
										class={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 ${websocketAuth()
											? "bg-brand-600"
											: "bg-gray-200 dark:bg-gray-700"
											}`}
									>
										<span
											aria-hidden="true"
											class={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${websocketAuth() ? "translate-x-5" : "translate-x-0"
												}`}
										/>
									</button>
								</div>
							</Show>
						</div>
					</div>

					{/* Quota Exceeded Behavior */}
					<div
						class="space-y-4"
						classList={{ hidden: activeTab() !== "advanced" }}
					>
						<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
							Quota Exceeded Behavior
						</h2>

						<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
							<Switch
								label="Auto-switch Project"
								description="Automatically switch to another project when quota is exceeded"
								checked={config().quotaSwitchProject}
								onChange={(checked) =>
									handleConfigChange("quotaSwitchProject", checked)
								}
							/>

							<div class="border-t border-gray-200 dark:border-gray-700" />

							<Switch
								label="Switch to Preview Model"
								description="Fall back to preview/beta models when quota is exceeded"
								checked={config().quotaSwitchPreviewModel}
								onChange={(checked) =>
									handleConfigChange("quotaSwitchPreviewModel", checked)
								}
							/>
						</div>
					</div>

					{/* OAuth Excluded Models */}
					<Show when={appStore.proxyStatus().running}>
						<div
							class="space-y-4"
							classList={{ hidden: activeTab() !== "advanced" }}
						>
							<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
								OAuth Excluded Models
							</h2>

							<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
								<p class="text-xs text-gray-500 dark:text-gray-400">
									Block specific models from being used with OAuth providers.
									Updates live without restart.
								</p>

								{/* Add new exclusion form */}
								<div class="flex gap-2">
									<select
										value={newExcludedProvider()}
										onChange={(e) =>
											setNewExcludedProvider(e.currentTarget.value)
										}
										class="flex-1 px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent [&>option]:bg-white [&>option]:dark:bg-gray-900 [&>option]:text-gray-900 [&>option]:dark:text-gray-100"
									>
										<option value="">Select provider...</option>
										<option value="gemini">Gemini</option>
										<option value="claude">Claude</option>
										<option value="qwen">Qwen</option>
										<option value="iflow">iFlow</option>
										<option value="openai">OpenAI</option>
										<option value="copilot">GitHub Copilot</option>
									</select>
									{/* Model dropdown with mapped models from Amp CLI */}
									{(() => {
										const mappings = config().ampModelMappings || [];
										const mappedModels = mappings
											.filter((m) => m.enabled !== false && m.to)
											.map((m) => m.to);
										const { builtInModels } = getAvailableTargetModels();

										// Get models for selected provider
										const getModelsForProvider = () => {
											const provider = newExcludedProvider();
											switch (provider) {
												case "gemini":
													return builtInModels.google;
												case "claude":
													return builtInModels.anthropic;
												case "openai":
													return builtInModels.openai;
												case "qwen":
													return builtInModels.qwen;
												case "iflow":
													return builtInModels.iflow;
												case "copilot":
													return builtInModels.copilot;
												default:
													return [];
											}
										};

										return (
											<select
												value={newExcludedModel()}
												onChange={(e) =>
													setNewExcludedModel(e.currentTarget.value)
												}
												class="flex-[2] px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent [&>option]:bg-white [&>option]:dark:bg-gray-900 [&>option]:text-gray-900 [&>option]:dark:text-gray-100 [&>optgroup]:bg-white [&>optgroup]:dark:bg-gray-900 [&>optgroup]:text-gray-900 [&>optgroup]:dark:text-gray-100"
											>
												<option value="">Select model...</option>
												{/* Amp Model Mappings (target models) */}
												<Show when={mappedModels.length > 0}>
													<optgroup label="Amp Model Mappings">
														<For each={[...new Set(mappedModels)]}>
															{(model) => (
																<option value={model}>{model}</option>
															)}
														</For>
													</optgroup>
												</Show>
												{/* Provider-specific models */}
												<Show when={getModelsForProvider().length > 0}>
													<optgroup
														label={`${newExcludedProvider() || "Provider"} Models`}
													>
														<For each={getModelsForProvider()}>
															{(model) => (
																<option value={model.value}>
																	{model.label}
																</option>
															)}
														</For>
													</optgroup>
												</Show>
											</select>
										);
									})()}
									<Button
										variant="primary"
										size="sm"
										onClick={handleAddExcludedModel}
										disabled={
											savingExcludedModels() ||
											!newExcludedProvider() ||
											!newExcludedModel()
										}
									>
										<Show
											when={savingExcludedModels()}
											fallback={<span>Add</span>}
										>
											<svg
												class="w-4 h-4 animate-spin"
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
										</Show>
									</Button>
								</div>

								{/* Current exclusions */}
								<Show when={loadingExcludedModels()}>
									<div class="text-center py-4 text-gray-500">Loading...</div>
								</Show>

								<Show
									when={
										!loadingExcludedModels() &&
										Object.keys(oauthExcludedModels()).length === 0
									}
								>
									<div class="text-center py-4 text-gray-400 dark:text-gray-500 text-sm">
										No models excluded yet
									</div>
								</Show>

								<Show
									when={
										!loadingExcludedModels() &&
										Object.keys(oauthExcludedModels()).length > 0
									}
								>
									<div class="space-y-3">
										<For each={Object.entries(oauthExcludedModels())}>
											{([provider, models]) => (
												<div class="space-y-2">
													<div class="flex items-center gap-2">
														<span class="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">
															{provider}
														</span>
														<span class="text-xs text-gray-400">
															({models.length} excluded)
														</span>
													</div>
													<div class="flex flex-wrap gap-2">
														<For each={models}>
															{(model) => (
																<span class="inline-flex items-center gap-1 px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-md text-xs">
																	{model}
																	<button
																		type="button"
																		onClick={() =>
																			handleRemoveExcludedModel(provider, model)
																		}
																		disabled={savingExcludedModels()}
																		class="hover:text-red-900 dark:hover:text-red-300 disabled:opacity-50"
																		title="Remove"
																	>
																		<svg
																			class="w-3 h-3"
																			fill="none"
																			stroke="currentColor"
																			viewBox="0 0 24 24"
																		>
																			<path
																				stroke-linecap="round"
																				stroke-linejoin="round"
																				stroke-width="2"
																				d="M6 18L18 6M6 6l12 12"
																			/>
																		</svg>
																	</button>
																</span>
															)}
														</For>
													</div>
												</div>
											)}
										</For>
									</div>
								</Show>
							</div>
						</div>
					</Show>

					{/* Copilot Detection */}
					<div
						class="space-y-4"
						classList={{ hidden: activeTab() !== "providers" }}
					>
						<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
							Copilot API Detection
						</h2>

						<div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
							<p class="text-xs text-gray-500 dark:text-gray-400">
								ProxyPal automatically detects and uses copilot-api for GitHub
								Copilot integration. No manual setup required - it works
								automatically.
							</p>

							<Button
								variant="secondary"
								size="sm"
								onClick={runCopilotDetection}
								disabled={detectingCopilot()}
							>
								{detectingCopilot() ? "Detecting..." : "Check System"}
							</Button>

							<Show when={copilotDetection()}>
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
												copilot-api will be downloaded automatically on first
												use via npx. This is a one-time process and requires
												internet connection.
											</div>
										</Show>

										<Show
											when={detection().installed && detection().copilotBin}
										>
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
																{(p) => <li>{p}</li>}
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

					{/* Accounts */}
					<div
						class="space-y-4"
						classList={{ hidden: activeTab() !== "providers" }}
					>
						<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
							Connected Accounts
						</h2>

						<div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
							<div class="flex items-center justify-between">
								<div>
									<p class="text-sm font-medium text-gray-700 dark:text-gray-300">
										{connectedCount()} of 4 providers connected
									</p>
									<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
										Manage your AI provider connections
									</p>
								</div>
								<Button
									variant="secondary"
									size="sm"
									onClick={() => setCurrentPage("dashboard")}
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

					{/* SSH Settings */}
					<div
						class="space-y-4"
						classList={{ hidden: activeTab() !== "ssh" }}
					>
						<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
							SSH API Connections
						</h2>
						<p class="text-sm text-gray-500 dark:text-gray-400">
							Securely tunnel your local API (port 8317) to a remote server for shared access.
						</p>

						{/* List */}
						<div class="space-y-3">
							<For each={config().sshConfigs || []}>
								{(ssh: SshConfig) => {
									const statusProps = createMemo(() => {
										const status = appStore.sshStatus()[ssh.id] || { id: ssh.id, status: ssh.enabled ? "connecting" : "disconnected", message: undefined };

										let displayStatus = status.status;
										let displayMessage = status.message;

										if (ssh.enabled) {
											if (!displayStatus || displayStatus === "disconnected") {
												displayStatus = "connecting";
											}
										} else {
											if (displayStatus === "connected" || displayStatus === "connecting") {
												displayStatus = "disconnected";
											}
										}
										return { status: displayStatus, message: displayMessage };
									});

									return (
										<div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
											<div>
												<div class="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
													<span>{ssh.username}@{ssh.host}:{ssh.port}</span>
												</div>
												<div class="text-xs text-gray-500 mt-1">
													Forward: Remote :{ssh.remotePort} &rarr; Local :{ssh.localPort}
												</div>
												<Show when={statusProps().message}>
													<div class={`text-xs mt-1 break-all flex items-start gap-1 ${statusProps().status === 'error' ? 'text-red-500' : 'text-gray-500'
														}`}>
														<span class="opacity-75">&gt;</span>
														<span>{statusProps().message}</span>
													</div>
												</Show>
											</div>
											<div class="flex items-center gap-4">
												<div class="flex items-center gap-2">
													<div class={`w-2.5 h-2.5 rounded-full ${statusProps().status === "connected" ? "bg-green-500" :
														statusProps().status === "error" ? "bg-red-500" :
															statusProps().status === "connecting" || statusProps().status === "reconnecting" ? "bg-orange-500 animate-pulse" :
																"bg-gray-400"
														}`} />
													<span class="text-sm font-medium text-gray-600 dark:text-gray-400 capitalize min-w-[50px]">
														{statusProps().status}
													</span>
												</div>
												<div class="h-6 w-px bg-gray-200 dark:bg-gray-700"></div>
												<Switch
													checked={ssh.enabled}
													onChange={(val) => handleToggleSsh(ssh.id, val)}
												/>
												<button
													class="p-2 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
													title="Edit Connection"
													onClick={() => handleEditSsh(ssh)}
												>
													<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
														<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
													</svg>
												</button>
												<button
													class="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
													title="Delete Connection"
													onClick={() => handleDeleteSsh(ssh.id)}
												>
													<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
														<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
													</svg>
												</button>
											</div>
										</div>
									)
								}}
							</For>
							<Show when={(config().sshConfigs || []).length === 0}>
								<div class="text-center py-8 text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-gray-800/30 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
									No SSH connections configured
								</div>
							</Show>
						</div>

						{/* Add Form */}
						<div class="p-5 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 space-y-4">
							<div class="flex items-center justify-between">
								<h3 class="font-medium text-gray-900 dark:text-gray-100">
									{sshId() ? "Edit Connection" : "Add New Connection"}
								</h3>
								<Show when={sshId()}>
									<button
										onClick={handleCancelEdit}
										class="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
									>
										Cancel Edit
									</button>
								</Show>
							</div>
							<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div class="space-y-1">
									<label class="text-xs font-medium text-gray-500 uppercase">Host / IP</label>
									<input class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
										placeholder="e.g. 192.168.1.1 or vps.example.com"
										value={sshHost()}
										onInput={(e) => setSshHost(e.currentTarget.value)}
									/>
								</div>
								<div class="space-y-1">
									<label class="text-xs font-medium text-gray-500 uppercase">Port</label>
									<input class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
										placeholder="22"
										type="number"
										value={sshPort()}
										onInput={(e) => setSshPort(parseInt(e.currentTarget.value) || 22)}
									/>
								</div>
								<div class="space-y-1">
									<label class="text-xs font-medium text-gray-500 uppercase">Username</label>
									<input class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
										placeholder="root"
										value={sshUser()}
										onInput={(e) => setSshUser(e.currentTarget.value)}
									/>
								</div>
								<div class="space-y-1">
									<label class="text-xs font-medium text-gray-500 uppercase">Password (Not Supported)</label>
									<input class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-sm cursor-not-allowed"
										placeholder="Password auth not supported - Use Key File"
										type="password"
										disabled
										value={sshPass()}
										onInput={(e) => setSshPass(e.currentTarget.value)}
									/>
									<p class="text-[10px] text-orange-500">
										Note: Password authentication is not supported. Please use a Private Key file.
									</p>
								</div>
								<div class="col-span-1 sm:col-span-2 space-y-1">
									<label class="text-xs font-medium text-gray-500 uppercase">Private Key File</label>
									<div class="flex gap-2">
										<input class="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
											placeholder="/path/to/private_key"
											value={sshKey()}
											onInput={(e) => setSshKey(e.currentTarget.value)}
										/>
										<button
											class="px-3 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-sm font-medium rounded-lg transition-colors"
											onClick={handlePickKeyFile}
										>
											Browse
										</button>
									</div>
								</div>
								<div class="space-y-1">
									<label class="text-xs font-medium text-gray-500 uppercase">Remote Port (VPS)</label>
									<input class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
										placeholder="8317"
										type="number"
										value={sshRemote()}
										onInput={(e) => setSshRemote(parseInt(e.currentTarget.value) || 0)}
									/>
									<p class="text-[10px] text-gray-400">Port to open on the remote server</p>
								</div>
								<div class="space-y-1">
									<label class="text-xs font-medium text-gray-500 uppercase">Local Port (This App)</label>
									<input class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
										placeholder="8317"
										type="number"
										value={sshLocal()}
										onInput={(e) => setSshLocal(parseInt(e.currentTarget.value) || 0)}
									/>
									<p class="text-[10px] text-gray-400">Port running locally (default 8317)</p>
								</div>
							</div>
							<div class="pt-2">
								<Button onClick={handleSaveSsh} loading={sshAdding()} variant="primary" class="w-full sm:w-auto">
									{sshId() ? "Update Connection" : "Add Connection"}
								</Button>
							</div>
						</div>
					</div>

					{/* Raw YAML Config Editor (Power Users) */}
					<Show when={appStore.proxyStatus().running}>
						<div
							class="space-y-4"
							classList={{ hidden: activeTab() !== "advanced" }}
						>
							<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
								Raw Configuration
							</h2>

							<div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
								<button
									type="button"
									onClick={() => setYamlConfigExpanded(!yamlConfigExpanded())}
									class="w-full flex items-center justify-between text-left"
								>
									<div>
										<p class="text-sm font-medium text-gray-700 dark:text-gray-300">
											YAML Config Editor
										</p>
										<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
											Advanced: Edit the raw CLIProxyAPI configuration
										</p>
									</div>
									<svg
										class={`w-5 h-5 text-gray-400 transition-transform ${yamlConfigExpanded() ? "rotate-180" : ""}`}
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M19 9l-7 7-7-7"
										/>
									</svg>
								</button>

								<Show when={yamlConfigExpanded()}>
									<div class="mt-4 space-y-3">
										<div class="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg">
											<svg
												class="w-4 h-4 shrink-0"
												fill="none"
												viewBox="0 0 24 24"
												stroke="currentColor"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
												/>
											</svg>
											<span>
												Be careful! Invalid YAML can break the proxy. Changes
												apply immediately but some may require a restart.
											</span>
										</div>

										<Show when={loadingYaml()}>
											<div class="text-center py-8 text-gray-500">
												Loading configuration...
											</div>
										</Show>

										<Show when={!loadingYaml()}>
											<textarea
												value={yamlContent()}
												onInput={(e) => setYamlContent(e.currentTarget.value)}
												class="w-full h-96 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth resize-y"
												placeholder="Loading..."
												spellcheck={false}
											/>

											<div class="flex items-center justify-between">
												<Button
													variant="secondary"
													size="sm"
													onClick={loadYamlConfig}
													disabled={loadingYaml()}
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
															d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
														/>
													</svg>
													Reload
												</Button>

												<Button
													variant="primary"
													size="sm"
													onClick={saveYamlConfig}
													disabled={savingYaml() || loadingYaml()}
												>
													<Show
														when={savingYaml()}
														fallback={<span>Save Changes</span>}
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
														Saving...
													</Show>
												</Button>
											</div>
										</Show>
									</div>
								</Show>
							</div>
						</div>
					</Show>

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

					<div class="border-t border-gray-200 dark:border-gray-700 my-6" />

					{/* Custom OpenAI-Compatible Providers */}
					<div
						class="space-y-4"
						classList={{ hidden: activeTab() !== "models" }}
					>
						<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
							Available Models
						</h2>
						<ModelsWidget
							models={models()}
							loading={!appStore.proxyStatus().running}
						/>
					</div>

					{/* CLI Agents */}
					<div
						class="space-y-4"
						classList={{ hidden: activeTab() !== "models" }}
					>
						<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
							CLI Agents
						</h2>
						<div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
							<For each={agents()}>
								{(agent) => (
									<div class="p-3 flex items-center justify-between">
										<div class="flex items-center gap-3">
											<Show when={agent.logo}>
												<img
													src={agent.logo}
													alt={agent.name}
													class="w-6 h-6 rounded"
												/>
											</Show>
											<div>
												<div class="flex items-center gap-2">
													<span class="font-medium text-sm text-gray-900 dark:text-gray-100">
														{agent.name}
													</span>
													<Show when={agent.configured}>
														<span class="px-1.5 py-0.5 text-[10px] font-medium bg-green-100 dark:bg-green-800 text-green-700 dark:text-green-300 rounded">
															Configured
														</span>
													</Show>
												</div>
												<p class="text-xs text-gray-500 dark:text-gray-400">
													{agent.description}
												</p>
											</div>
										</div>
										<Button
											size="sm"
											variant={agent.configured ? "secondary" : "primary"}
											disabled={configuringAgent() === agent.id}
											onClick={() => handleConfigureAgent(agent.id)}
										>
											<Show
												when={configuringAgent() !== agent.id}
												fallback={
													<svg
														class="w-4 h-4 animate-spin"
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
												}
											>
												{agent.configured ? "Reconfigure" : "Configure"}
											</Show>
										</Button>
									</div>
								)}
							</For>
							<Show when={agents().length === 0}>
								<div class="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
									No CLI agents detected
								</div>
							</Show>
						</div>
					</div>

					{/* About */}
					<div
						class="space-y-4"
						classList={{ hidden: activeTab() !== "advanced" }}
					>
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
							<h3 class="font-bold text-gray-900 dark:text-gray-100">
								ProxyPal
							</h3>
							<p class="text-sm text-gray-500 dark:text-gray-400">
								Version {appVersion()}
							</p>
							<p class="text-xs text-gray-400 dark:text-gray-500 mt-2">
								Built with love by OpenCodeKit
							</p>
						</div>
					</div>
				</div>
			</main>
			<Show when={configResult()}>
				{(result) => (
					<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in">
						<div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg animate-scale-in">
							<div class="p-6">
								<div class="flex items-center justify-between mb-4">
									<h2 class="text-lg font-bold text-gray-900 dark:text-gray-100">
										{result().agentName} Configured
									</h2>
									<button
										onClick={() => setConfigResult(null)}
										class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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
												d="M6 18L18 6M6 6l12 12"
											/>
										</svg>
									</button>
								</div>

								<div class="space-y-4">
									<Show when={result().result.configPath}>
										<div class="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
											<div class="flex items-center gap-2 text-green-700 dark:text-green-300">
												<svg
													class="w-4 h-4"
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
												<span class="text-sm font-medium">
													Config file created
												</span>
											</div>
											<p class="mt-1 text-xs text-green-600 dark:text-green-400 font-mono break-all">
												{result().result.configPath}
											</p>
										</div>
									</Show>

									<Show when={result().result.shellConfig}>
										<div class="space-y-2">
											<div class="flex items-center justify-between">
												<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
													Environment Variables
												</span>
												<button
													onClick={() => {
														navigator.clipboard.writeText(
															result().result.shellConfig!,
														);
														toastStore.success("Copied to clipboard");
													}}
													class="text-xs text-brand-500 hover:text-brand-600"
												>
													Copy
												</button>
											</div>
											<pre class="p-3 rounded-lg bg-gray-100 dark:bg-gray-800 text-xs font-mono text-gray-700 dark:text-gray-300 overflow-x-auto whitespace-pre-wrap">
												{result().result.shellConfig}
											</pre>
											<Button
												size="sm"
												variant="secondary"
												onClick={handleApplyEnv}
												class="w-full"
											>
												Add to Shell Profile Automatically
											</Button>
										</div>
									</Show>

									<Show when={result().result.instructions}>
										<div class="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
											<p class="text-sm text-blue-700 dark:text-blue-300">
												{result().result.instructions}
											</p>
										</div>
									</Show>
								</div>

								<div class="mt-6 flex justify-end">
									<Button
										variant="primary"
										onClick={() => setConfigResult(null)}
									>
										Done
									</Button>
								</div>
							</div>
						</div>
					</div>
				)}
			</Show>
		</div>
	);
}

import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import {
	createEffect,
	createMemo,
	createSignal,
	onMount,
} from "solid-js";

import type {
	AmpModelMapping,
	AmpOpenAIModel,
	AmpOpenAIProvider,
	CloudflareConfig,
	ProviderTestResult,
	SshConfig,
} from "../../lib/tauri";

import {
	type AgentConfigResult,
	type AgentStatus,
	AMP_MODEL_SLOTS,
	type AvailableModel,
	appendToShellProfile,
	type CopilotApiDetection,
	checkForUpdates,
	configureCliAgent,
	deleteCloudflareConfig,
	deleteSshConfig,
	detectCliAgents,
	detectCopilotApi,
	downloadAndInstallUpdate,
	getAvailableModels,
	getConfigYaml,
	isUpdaterSupported,
	saveCloudflareConfig,
	saveConfig,
	saveSshConfig,
	setCloudflareConnection,
	setConfigYaml,
	setSshConnection,
	startProxy,
	stopProxy,
	testOpenAIProvider,
	type UpdateInfo,
	type UpdateProgress,
	type UpdaterSupport,
} from "../../lib/tauri";

import { appStore } from "../../stores/app";
import { toastStore } from "../../stores/toast";
import { ModelsTab } from "./tabs/ModelsTab";
import { ProvidersTab } from "./tabs/ProvidersTab";
import { SshTab } from "./tabs/SshTab";
import { CloudflareTab } from "./tabs/CloudflareTab";
import { AgentConfigResultModal } from "./modals/AgentConfigResultModal";
import { YamlConfigEditorSection } from "./sections/YamlConfigEditorSection";
import { AppUpdatesSection } from "./sections/AppUpdatesSection";
import { AmpCliIntegrationSection } from "./sections/AmpCliIntegrationSection";
import { AdvancedSettingsSection } from "./sections/AdvancedSettingsSection";
import { SettingsHeader } from "./components/SettingsHeader";
import { SettingsSidebarNav } from "./components/SettingsSidebarNav";
import { createClaudeCodeSettings } from "./hooks/createClaudeCodeSettings";
import { createCloseToTraySetting } from "./hooks/createCloseToTraySetting";
import { createProxyRuntimeSettings } from "./hooks/createProxyRuntimeSettings";
import { GeneralSettingsSection } from "./sections/general/GeneralSettingsSection";
import { ProxyConfigurationSection } from "./sections/general/ProxyConfigurationSection";
import { ThinkingBudgetSection } from "./sections/general/ThinkingBudgetSection";
import { ReasoningEffortSection } from "./sections/general/ReasoningEffortSection";
import { ClaudeCodeSettingsSection } from "./sections/general/ClaudeCodeSettingsSection";
import { AboutSection } from "./sections/AboutSection";
import type { SettingsTab } from "./types";

export function SettingsPage() {
	const { config, setConfig, setCurrentPage, authStatus } = appStore;
	const [saving, setSaving] = createSignal(false);
	const [activeTab, setActiveTab] = createSignal<SettingsTab>("general");
	const [appVersion, setAppVersion] = createSignal("0.0.0");
	const tabs: { id: SettingsTab; label: string }[] = [
		{ id: "general", label: "General" },
		{ id: "providers", label: "Providers" },
		{ id: "models", label: "Models" },
		{ id: "ssh", label: "SSH API" },
		{ id: "cloudflare", label: "Cloudflare" },
		{ id: "advanced", label: "Advanced" },
	];
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

	const {
		availableModels,
		maxRetryInterval,
		websocketAuth,
		forceModelMappings,
		savingMaxRetryInterval,
		savingWebsocketAuth,
		savingForceModelMappings,
		handleMaxRetryIntervalChange,
		handleWebsocketAuthChange,
		handleForceModelMappingsChange,
		thinkingBudgetMode,
		setThinkingBudgetMode,
		thinkingBudgetCustom,
		setThinkingBudgetCustom,
		savingThinkingBudget,
		saveThinkingBudget,
		reasoningEffortLevel,
		setReasoningEffortLevel,
		savingReasoningEffort,
		saveReasoningEffort,
		oauthExcludedModels,
		loadingExcludedModels,
		savingExcludedModels,
		newExcludedProvider,
		setNewExcludedProvider,
		newExcludedModel,
		setNewExcludedModel,
		handleAddExcludedModel,
		handleRemoveExcludedModel,
	} = createProxyRuntimeSettings(() => appStore.proxyStatus().running);

	const { closeToTray, savingCloseToTray, handleCloseToTrayChange } =
		createCloseToTraySetting();

	const { claudeCodeSettings, handleClaudeCodeSettingChange } =
		createClaudeCodeSettings();

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

	// Cloudflare State
	const [cfId, setCfId] = createSignal("");
	const [cfName, setCfName] = createSignal("");
	const [cfToken, setCfToken] = createSignal("");
	const [cfLocalPort, setCfLocalPort] = createSignal(8317);
	const [cfAdding, setCfAdding] = createSignal(false);

	// SSH Handlers
	const handlePickKeyFile = async () => {
		try {
			const file = await open({
				multiple: false,
				filters: [{ name: "All Files", extensions: ["*"] }],
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
			setConfig((prev) => ({ ...prev, sshConfigs: updated }));

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
			setConfig((prev) => ({ ...prev, sshConfigs: updated }));
		} catch (e) {
			toastStore.error("Failed to delete", String(e));
		}
	};

	const handleToggleSsh = async (id: string, enable: boolean) => {
		try {
			await setSshConnection(id, enable);
			// Updating local config to reflect target state immediately for UI responsiveness
			const configs = config().sshConfigs || [];
			const updated = configs.map((c) =>
				c.id === id ? { ...c, enabled: enable } : c,
			);
			setConfig((prev) => ({ ...prev, sshConfigs: updated }));
		} catch (e) {
			toastStore.error("Failed to toggle", String(e));
		}
	};

	// Cloudflare Handlers
	const handleSaveCf = async () => {
		if (!cfName() || !cfToken()) {
			toastStore.error("Please fill in name and tunnel token");
			return;
		}
		try {
			const cfConfig: CloudflareConfig = {
				id: cfId() || crypto.randomUUID(),
				name: cfName(),
				tunnelToken: cfToken(),
				localPort: cfLocalPort(),
				enabled: false,
			};
			const updated = await saveCloudflareConfig(cfConfig);
			setConfig((prev) => ({ ...prev, cloudflareConfigs: updated }));
			setCfId("");
			setCfName("");
			setCfToken("");
			setCfLocalPort(8317);
			setCfAdding(false);
			toastStore.success("Cloudflare tunnel saved");
		} catch (e) {
			toastStore.error("Failed to save", String(e));
		}
	};

	const handleDeleteCf = async (id: string) => {
		try {
			const updated = await deleteCloudflareConfig(id);
			setConfig((prev) => ({ ...prev, cloudflareConfigs: updated }));
			toastStore.success("Tunnel deleted");
		} catch (e) {
			toastStore.error("Failed to delete", String(e));
		}
	};

	const handleToggleCf = async (id: string, enable: boolean) => {
		try {
			await setCloudflareConnection(id, enable);
			const configs = config().cloudflareConfigs || [];
			const updated = configs.map((c) =>
				c.id === id ? { ...c, enabled: enable } : c,
			);
			setConfig((prev) => ({ ...prev, cloudflareConfigs: updated }));
		} catch (e) {
			toastStore.error("Failed to toggle", String(e));
		}
	};

	const handleEditCf = (cf: CloudflareConfig) => {
		setCfId(cf.id);
		setCfName(cf.name);
		setCfToken(cf.tunnelToken);
		setCfLocalPort(cf.localPort);
		setCfAdding(true);
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

	// Raw YAML Config handlers
	const loadYamlConfig = async () => {
		if (!appStore.proxyStatus().running) {
			setYamlContent(
				"# Proxy is not running. Start the proxy to load configuration.",
			);
			return;
		}
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
		if (yamlConfigExpanded() && !yamlContent()) {
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
		return mappings.find((m) => m.name === slot.fromModel);
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
			(m) => m.name !== slot.fromModel,
		);

		// Add new mapping if enabled and has a target
		let newMappings: AmpModelMapping[];
		if (enabled && toModel) {
			newMappings = [
				...filteredMappings,
				{ name: slot.fromModel, alias: toModel, enabled: true },
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
		return mappings.filter((m) => !slotFromModels.has(m.name));
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
		if (existingMappings.some((m) => m.name === from)) {
			toastStore.error(`A mapping for '${from}' already exists`);
			return;
		}

		const newMapping: AmpModelMapping = {
			name: from,
			alias: to,
			enabled: true,
		};
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
		const newMappings = currentMappings.filter((m) => m.name !== fromModel);

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

	// Update an existing custom mapping
	const updateCustomMapping = async (
		fromModel: string,
		newToModel: string,
		enabled: boolean,
	) => {
		const currentMappings = config().ampModelMappings || [];
		const newMappings = currentMappings.map((m) =>
			m.name === fromModel ? { ...m, to: newToModel, enabled } : m,
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

			// If management key changed and proxy is running, restart proxy to apply new key
			if (key === "managementKey" && appStore.proxyStatus().running) {
				toastStore.info("Restarting proxy to apply new management key...");
				await stopProxy();
				// Small delay to ensure config file is fully written and flushed
				await new Promise((resolve) => setTimeout(resolve, 500));
				await startProxy();
				toastStore.success("Proxy restarted with new management key");
			} else {
				toastStore.success("Settings saved");
			}
		} catch (error) {
			console.error("Failed to save config:", error);
			toastStore.error("Failed to save settings", String(error));
		} finally {
			setSaving(false);
		}
	};

	const connectedCount = () => {
		return authProviders().filter(Boolean).length;
	};

	const authProviders = createMemo(() => {
		const auth = authStatus();
		return [
			auth.claude,
			auth.openai,
			auth.gemini,
			auth.antigravity,
			auth.qwen,
			auth.iflow,
			auth.vertex,
		];
	});

	const totalProviders = createMemo(() => authProviders().length);

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
			<SettingsHeader
				appVersion={appVersion}
				saving={saving}
				tabs={tabs}
				activeTab={activeTab}
				setActiveTab={setActiveTab}
			/>

			{/* Main content */}
			<main class="flex-1 p-4 sm:p-6 overflow-y-auto">
				<div class="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[220px,1fr] gap-4 sm:gap-6">
					<SettingsSidebarNav
						tabs={tabs}
						activeTab={activeTab}
						setActiveTab={setActiveTab}
					/>

					<div class="space-y-4 sm:space-y-6 animate-stagger">
						<GeneralSettingsSection
							activeTab={activeTab}
							config={config}
							handleConfigChange={handleConfigChange}
							closeToTray={closeToTray}
							handleCloseToTrayChange={handleCloseToTrayChange}
							savingCloseToTray={savingCloseToTray}
						/>
						<ProxyConfigurationSection
							activeTab={activeTab}
							config={config}
							handleConfigChange={handleConfigChange}
							showProxyApiKey={showProxyApiKey}
							setShowProxyApiKey={setShowProxyApiKey}
							showManagementKey={showManagementKey}
							setShowManagementKey={setShowManagementKey}
							proxyRunning={() => appStore.proxyStatus().running}
							maxRetryInterval={maxRetryInterval}
							savingMaxRetryInterval={savingMaxRetryInterval}
							handleMaxRetryIntervalChange={handleMaxRetryIntervalChange}
						/>
						<ThinkingBudgetSection
							activeTab={activeTab}
							thinkingBudgetMode={thinkingBudgetMode}
							setThinkingBudgetMode={setThinkingBudgetMode}
							thinkingBudgetCustom={thinkingBudgetCustom}
							setThinkingBudgetCustom={setThinkingBudgetCustom}
							saveThinkingBudget={saveThinkingBudget}
							savingThinkingBudget={savingThinkingBudget}
						/>
						<ReasoningEffortSection
							activeTab={activeTab}
							reasoningEffortLevel={reasoningEffortLevel}
							setReasoningEffortLevel={setReasoningEffortLevel}
							saveReasoningEffort={saveReasoningEffort}
							savingReasoningEffort={savingReasoningEffort}
						/>
						<ClaudeCodeSettingsSection
							activeTab={activeTab}
							claudeCodeSettings={claudeCodeSettings}
							getAvailableTargetModels={getAvailableTargetModels}
							handleClaudeCodeSettingChange={handleClaudeCodeSettingChange}
						/>
						<AmpCliIntegrationSection
							activeTab={activeTab}
							config={config}
							handleConfigChange={handleConfigChange}
							proxyRunning={() => appStore.proxyStatus().running}
							savingForceModelMappings={savingForceModelMappings}
							forceModelMappings={forceModelMappings}
							handleForceModelMappingsChange={handleForceModelMappingsChange}
							getMappingForSlot={getMappingForSlot}
							updateSlotMapping={updateSlotMapping}
							getAvailableTargetModels={getAvailableTargetModels}
							getCustomMappings={getCustomMappings}
							updateCustomMapping={updateCustomMapping}
							removeCustomMapping={removeCustomMapping}
							newMappingFrom={newMappingFrom}
							setNewMappingFrom={setNewMappingFrom}
							newMappingTo={newMappingTo}
							setNewMappingTo={setNewMappingTo}
							addCustomMapping={addCustomMapping}
							deleteOpenAIProvider={deleteOpenAIProvider}
							openProviderModal={openProviderModal}
							providerModalOpen={providerModalOpen}
							closeProviderModal={closeProviderModal}
							editingProviderId={editingProviderId}
							providerName={providerName}
							setProviderName={setProviderName}
							providerBaseUrl={providerBaseUrl}
							setProviderBaseUrl={setProviderBaseUrl}
							providerApiKey={providerApiKey}
							setProviderApiKey={setProviderApiKey}
							providerModels={providerModels}
							newModelName={newModelName}
							setNewModelName={setNewModelName}
							newModelAlias={newModelAlias}
							setNewModelAlias={setNewModelAlias}
							addProviderModel={addProviderModel}
							removeProviderModel={removeProviderModel}
							testingProvider={testingProvider}
							providerTestResult={providerTestResult}
							testProviderConnection={testProviderConnection}
							saveOpenAIProvider={saveOpenAIProvider}
						/>

						<AdvancedSettingsSection
							activeTab={activeTab}
							config={config}
							handleConfigChange={handleConfigChange}
							proxyRunning={() => appStore.proxyStatus().running}
							websocketAuth={websocketAuth}
							savingWebsocketAuth={savingWebsocketAuth}
							handleWebsocketAuthChange={handleWebsocketAuthChange}
							newExcludedProvider={newExcludedProvider}
							setNewExcludedProvider={setNewExcludedProvider}
							newExcludedModel={newExcludedModel}
							setNewExcludedModel={setNewExcludedModel}
							handleAddExcludedModel={handleAddExcludedModel}
							handleRemoveExcludedModel={handleRemoveExcludedModel}
							savingExcludedModels={savingExcludedModels}
							loadingExcludedModels={loadingExcludedModels}
							oauthExcludedModels={oauthExcludedModels}
							getAvailableTargetModels={getAvailableTargetModels}
						/>
						<ProvidersTab
							active={activeTab() === "providers"}
							copilotDetection={copilotDetection}
							detectingCopilot={detectingCopilot}
							onRunCopilotDetection={runCopilotDetection}
							connectedCount={connectedCount}
							totalProviders={totalProviders}
							onManageAccounts={() => setCurrentPage("dashboard")}
						/>

						<SshTab
							active={activeTab() === "ssh"}
							sshConfigs={() => config().sshConfigs || []}
							sshStatus={appStore.sshStatus}
							onToggle={handleToggleSsh}
							onEdit={handleEditSsh}
							onDelete={handleDeleteSsh}
							sshId={sshId}
							sshHost={sshHost}
							setSshHost={setSshHost}
							sshPort={sshPort}
							setSshPort={setSshPort}
							sshUser={sshUser}
							setSshUser={setSshUser}
							sshPass={sshPass}
							setSshPass={setSshPass}
							sshKey={sshKey}
							setSshKey={setSshKey}
							sshRemote={sshRemote}
							setSshRemote={setSshRemote}
							sshLocal={sshLocal}
							setSshLocal={setSshLocal}
							sshAdding={sshAdding}
							onPickKeyFile={handlePickKeyFile}
							onSave={handleSaveSsh}
							onCancelEdit={handleCancelEdit}
						/>

						<CloudflareTab
							active={activeTab() === "cloudflare"}
							cloudflareConfigs={() => config().cloudflareConfigs || []}
							cloudflareStatus={appStore.cloudflareStatus}
							onToggle={handleToggleCf}
							onEdit={handleEditCf}
							onDelete={handleDeleteCf}
							onSave={handleSaveCf}
							cfAdding={cfAdding}
							setCfAdding={setCfAdding}
							cfId={cfId}
							setCfId={setCfId}
							cfName={cfName}
							setCfName={setCfName}
							cfToken={cfToken}
							setCfToken={setCfToken}
							cfLocalPort={cfLocalPort}
							setCfLocalPort={setCfLocalPort}
						/>

						<YamlConfigEditorSection
							activeTab={activeTab}
							yamlConfigExpanded={yamlConfigExpanded}
							setYamlConfigExpanded={setYamlConfigExpanded}
							loadYamlConfig={loadYamlConfig}
							loadingYaml={loadingYaml}
							yamlContent={yamlContent}
							setYamlContent={setYamlContent}
							saveYamlConfig={saveYamlConfig}
							savingYaml={savingYaml}
						/>
						<AppUpdatesSection
							activeTab={activeTab}
							updaterSupport={updaterSupport}
							checkingForUpdates={checkingForUpdates}
							installingUpdate={installingUpdate}
							updateInfo={updateInfo}
							updateProgress={updateProgress}
							handleCheckForUpdates={handleCheckForUpdates}
							handleInstallUpdate={handleInstallUpdate}
						/>
						<div class="border-t border-gray-200 dark:border-gray-700 my-6" />

						<ModelsTab
							active={activeTab() === "models"}
							models={models}
							agents={agents}
							configuringAgent={configuringAgent}
							onConfigureAgent={handleConfigureAgent}
							proxyRunning={appStore.proxyStatus().running}
						/>

						<AboutSection activeTab={activeTab} appVersion={appVersion} />
					</div>
				</div>
			</main>
			<AgentConfigResultModal
				configResult={configResult}
				setConfigResult={setConfigResult}
				handleApplyEnv={handleApplyEnv}
			/>
		</div>
	);
}

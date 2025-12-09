import { createSignal, For, Show, createEffect } from "solid-js";
import { Button, Switch } from "../components/ui";
import { appStore } from "../stores/app";
import { toastStore } from "../stores/toast";
import {
  saveConfig,
  AMP_MODEL_SLOTS,
  testOpenAIProvider,
  getAvailableModels,
  getMaxRetryInterval,
  setMaxRetryInterval,
  getWebsocketAuth,
  setWebsocketAuth,
  getPrioritizeModelMappings,
  setPrioritizeModelMappings,
  getOAuthExcludedModels,
  setOAuthExcludedModels,
  deleteOAuthExcludedModels,
  getConfigYaml,
  setConfigYaml,
  detectCopilotApi,
  type AvailableModel,
  type OAuthExcludedModels,
  type CopilotApiDetection,
} from "../lib/tauri";
import type {
  AmpOpenAIModel,
  AmpOpenAIProvider,
  AmpModelMapping,
  ProviderTestResult,
} from "../lib/tauri";

export function SettingsPage() {
  const { config, setConfig, setCurrentPage, authStatus } = appStore;
  const [saving, setSaving] = createSignal(false);

  // Custom OpenAI providers section collapsed by default
  const [customProvidersExpanded, setCustomProvidersExpanded] =
    createSignal(false);

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

  // Management API runtime settings
  const [maxRetryInterval, setMaxRetryIntervalState] = createSignal<number>(0);
  const [websocketAuth, setWebsocketAuthState] = createSignal<boolean>(false);
  const [prioritizeModelMappings, setPrioritizeModelMappingsState] =
    createSignal<boolean>(false);
  const [savingMaxRetryInterval, setSavingMaxRetryInterval] =
    createSignal(false);
  const [savingWebsocketAuth, setSavingWebsocketAuth] = createSignal(false);
  const [savingPrioritizeModelMappings, setSavingPrioritizeModelMappings] =
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
  const [copilotDetectionExpanded, setCopilotDetectionExpanded] =
    createSignal(false);

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
        const prioritize = await getPrioritizeModelMappings();
        setPrioritizeModelMappingsState(prioritize);
      } catch (error) {
        console.error("Failed to fetch prioritize model mappings:", error);
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
  const handlePrioritizeModelMappingsChange = async (value: boolean) => {
    setSavingPrioritizeModelMappings(true);
    try {
      await setPrioritizeModelMappings(value);
      setPrioritizeModelMappingsState(value);
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
      setSavingPrioritizeModelMappings(false);
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
    return [auth.claude, auth.openai, auth.gemini, auth.qwen].filter(Boolean)
      .length;
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
      {/* Header */}
      <header class="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-800">
        <div class="flex items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentPage("dashboard")}
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
            Settings
          </h1>
          {saving() && (
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
              Saving
            </span>
          )}
        </div>
      </header>

      {/* Main content */}
      <main class="flex-1 p-4 sm:p-6 overflow-y-auto">
        <div class="max-w-xl mx-auto space-y-4 sm:space-y-6 animate-stagger">
          {/* General settings */}
          <div class="space-y-4">
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
            </div>
          </div>

          {/* Proxy settings */}
          <div class="space-y-4">
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

          {/* Amp CLI Integration */}
          <div class="space-y-4">
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
                        <Show when={savingPrioritizeModelMappings()}>
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
                      aria-checked={prioritizeModelMappings()}
                      disabled={savingPrioritizeModelMappings()}
                      onClick={() =>
                        handlePrioritizeModelMappingsChange(
                          !prioritizeModelMappings(),
                        )
                      }
                      class={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 ${
                        prioritizeModelMappings()
                          ? "bg-brand-600"
                          : "bg-gray-200 dark:bg-gray-700"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        class={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          prioritizeModelMappings()
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
                                    class={`flex-1 min-w-0 px-2 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth ${
                                      !isEnabled()
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
                                class={`flex-1 min-w-0 px-2 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth ${
                                  mapping.enabled === false
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
                            class="flex-1 min-w-0 px-2 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-smooth"
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

              {/* Custom OpenAI-Compatible Providers - Collapsible */}
              <div class="space-y-4">
                <button
                  type="button"
                  onClick={() =>
                    setCustomProvidersExpanded(!customProvidersExpanded())
                  }
                  class="w-full flex items-center justify-between text-left"
                >
                  <div>
                    <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Custom OpenAI-Compatible Providers
                    </span>
                    <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      Add external providers (ZenMux, OpenRouter, etc.) for
                      additional models
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <Show when={(config().ampOpenaiProviders || []).length > 0}>
                      <span class="text-xs bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 px-2 py-0.5 rounded-full">
                        {(config().ampOpenaiProviders || []).length}
                      </span>
                    </Show>
                    <svg
                      class={`w-5 h-5 text-gray-400 transition-transform ${customProvidersExpanded() ? "rotate-180" : ""}`}
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
                  </div>
                </button>

                <Show when={customProvidersExpanded()}>
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
                                      onClick={() =>
                                        openProviderModal(provider)
                                      }
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
                </Show>
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
                            class={`flex items-center gap-2 p-2 rounded-lg text-xs ${
                              result().success
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
          <div class="space-y-4">
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
                label="Log to File"
                description="Write logs to rotating files instead of stdout"
                checked={config().loggingToFile}
                onChange={(checked) =>
                  handleConfigChange("loggingToFile", checked)
                }
              />

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
                    class={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 ${
                      websocketAuth()
                        ? "bg-brand-600"
                        : "bg-gray-200 dark:bg-gray-700"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      class={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        websocketAuth() ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </Show>
            </div>
          </div>

          {/* Quota Exceeded Behavior */}
          <div class="space-y-4">
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
            <div class="space-y-4">
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
                    class="flex-1 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  >
                    <option value="">Select provider...</option>
                    <option value="gemini">Gemini</option>
                    <option value="claude">Claude</option>
                    <option value="qwen">Qwen</option>
                    <option value="iflow">iFlow</option>
                    <option value="openai">OpenAI</option>
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
                        class="flex-[2] px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
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
          <div class="space-y-4">
            <button
              type="button"
              onClick={() =>
                setCopilotDetectionExpanded(!copilotDetectionExpanded())
              }
              class="flex items-center justify-between w-full text-left"
            >
              <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                Copilot API Detection
              </h2>
              <svg
                class={`w-5 h-5 text-gray-400 transition-transform ${copilotDetectionExpanded() ? "rotate-180" : ""}`}
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

            <Show when={copilotDetectionExpanded()}>
              <div class="space-y-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  Check if Node.js and copilot-api are detected on your system.
                  This helps diagnose Copilot startup issues.
                </p>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={runCopilotDetection}
                  disabled={detectingCopilot()}
                >
                  {detectingCopilot() ? "Detecting..." : "Run Detection"}
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
                          class={`w-2 h-2 rounded-full ${detection().installed ? "bg-green-500" : "bg-yellow-500"}`}
                        />
                        <span class="font-medium">copilot-api:</span>
                        <span
                          class={
                            detection().installed
                              ? "text-green-600 dark:text-green-400"
                              : "text-yellow-600 dark:text-yellow-400"
                          }
                        >
                          {detection().installed
                            ? `Installed${detection().version ? ` (v${detection().version})` : ""}`
                            : "Not installed (will use npx)"}
                        </span>
                      </div>

                      <Show when={detection().copilotBin}>
                        <div class="text-gray-500 dark:text-gray-400 pl-4">
                          Path:{" "}
                          <code class="bg-gray-200 dark:bg-gray-700 px-1 rounded">
                            {detection().copilotBin}
                          </code>
                        </div>
                      </Show>

                      <Show when={detection().npxBin}>
                        <div class="text-gray-500 dark:text-gray-400 pl-4">
                          npx:{" "}
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

                      <Show
                        when={
                          detection().nodeAvailable && !detection().installed
                        }
                      >
                        <div class="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-yellow-700 dark:text-yellow-400">
                          <p class="font-medium">
                            copilot-api not installed globally
                          </p>
                          <p class="mt-1">
                            Copilot will work via npx, but for faster startup
                            you can install globally:
                          </p>
                          <code class="block mt-1 bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded text-xs">
                            npm install -g copilot-api
                          </code>
                        </div>
                      </Show>
                    </div>
                  )}
                </Show>
              </div>
            </Show>
          </div>

          {/* Accounts */}
          <div class="space-y-4">
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

          {/* API Keys */}
          <div class="space-y-4">
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              API Keys
            </h2>

            <div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Manage API Keys
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Add Gemini, Claude, Codex, or OpenAI-compatible API keys
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage("api-keys")}
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
                      d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                    />
                  </svg>
                  Configure
                </Button>
              </div>
            </div>
          </div>

          {/* Auth Files */}
          <div class="space-y-4">
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Auth Files
            </h2>

            <div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Manage Auth Files
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Upload, enable, or remove OAuth credential files
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage("auth-files")}
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
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  Manage
                </Button>
              </div>
            </div>
          </div>

          {/* Logs */}
          <div class="space-y-4">
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Logs
            </h2>

            <div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    View Logs
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Live proxy server logs with filtering
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage("logs")}
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
                      d="M4 6h16M4 12h16M4 18h7"
                    />
                  </svg>
                  View
                </Button>
              </div>
            </div>
          </div>

          {/* Analytics */}
          <div class="space-y-4">
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Analytics
            </h2>

            <div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Usage Analytics
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    View request and token usage trends with charts
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage("analytics")}
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
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                    />
                  </svg>
                  View
                </Button>
              </div>
            </div>
          </div>

          {/* Raw YAML Config Editor (Power Users) */}
          <Show when={appStore.proxyStatus().running}>
            <div class="space-y-4">
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

          {/* About */}
          <div class="space-y-4">
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              About
            </h2>

            <div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 text-center">
              <div class="w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mb-3">
                <span class="text-white text-2xl">⚡</span>
              </div>
              <h3 class="font-bold text-gray-900 dark:text-gray-100">
                ProxyPal
              </h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Version 0.1.17
              </p>
              <p class="text-xs text-gray-400 dark:text-gray-500 mt-2">
                Built with love by OpenCodeKit
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

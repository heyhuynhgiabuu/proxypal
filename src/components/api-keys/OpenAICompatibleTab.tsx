import { createEffect, createMemo, createSignal, For, Show, splitProps } from "solid-js";
import { useI18n } from "../../i18n";
import {
  fetchOpenaiCompatibleModels,
  getOpenAICompatibleProviders,
  reloadConfig,
  setOpenAICompatibleProviders,
  testOpenAIProvider,
} from "../../lib/tauri";
import { appStore } from "../../stores/app";
import { toastStore } from "../../stores/toast";
import { Button } from "../ui";

import type { OpenAICompatibleProvider } from "../../lib/tauri";

interface OpenAICompatibleTabProps {
  loading: () => boolean;
  setLoading: (value: boolean) => void;
  setShowAddForm: (value: boolean) => void;
  showAddForm: () => boolean;
}

export function OpenAICompatibleTab(props: OpenAICompatibleTabProps) {
  const [local] = splitProps(props, ["showAddForm", "setShowAddForm", "loading", "setLoading"]);
  const { t } = useI18n();
  const { proxyStatus } = appStore;
  const [openaiProviders, setOpenaiProviders] = createSignal<OpenAICompatibleProvider[]>([]);
  const [editingIndex, setEditingIndex] = createSignal<number | null>(null);
  const [showModelManager, setShowModelManager] = createSignal(false);
  const [managingProviderIndex, setManagingProviderIndex] = createSignal<number | null>(null);
  const [newModelInput, setNewModelInput] = createSignal("");
  const [newOpenaiProvider, setNewOpenaiProvider] = createSignal<OpenAICompatibleProvider>({
    apiKeyEntries: [{ apiKey: "" }],
    baseUrl: "",
    models: [],
    name: "",
  });
  const [testingIndex, setTestingIndex] = createSignal<number | null>(null);
  const [testingNewProvider, setTestingNewProvider] = createSignal(false);
  const [testResult, setTestResult] = createSignal<{
    message: string;
    modelsFound?: number;
    success: boolean;
  } | null>(null);
  const [fetchingModels, setFetchingModels] = createSignal(false);
  const [bulkAddMode, setBulkAddMode] = createSignal(false);
  const [bulkKeysInput, setBulkKeysInput] = createSignal("");

  const loadKeys = async () => {
    if (!proxyStatus().running) {
      return;
    }

    local.setLoading(true);
    try {
      const openai = await getOpenAICompatibleProviders();
      setOpenaiProviders(openai);
    } catch (error) {
      console.error("Failed to load OpenAI-compatible providers:", error);
      toastStore.error(t("apiKeys.toasts.failedToLoadApiKeys"), String(error));
    } finally {
      local.setLoading(false);
    }
  };

  createEffect(() => {
    if (proxyStatus().running) {
      void loadKeys();
    }
  });

  const handleAddOpenaiProvider = async () => {
    const provider = newOpenaiProvider();
    if (!provider.name.trim() || !provider.baseUrl.trim()) {
      toastStore.error(t("apiKeys.toasts.nameAndBaseUrlRequired"));
      return;
    }
    if (!provider.apiKeyEntries[0]?.apiKey.trim()) {
      toastStore.error(t("apiKeys.toasts.atLeastOneApiKeyRequired"));
      return;
    }

    local.setLoading(true);
    try {
      const updated = [...openaiProviders(), provider];
      await setOpenAICompatibleProviders(updated);
      setOpenaiProviders(updated);
      setNewOpenaiProvider({
        apiKeyEntries: [{ apiKey: "" }],
        baseUrl: "",
        name: "",
      });
      local.setShowAddForm(false);
      setBulkAddMode(false);
      setBulkKeysInput("");
      toastStore.success(t("apiKeys.toasts.openAiCompatibleProviderAdded"));
    } catch (error) {
      toastStore.error(t("apiKeys.toasts.failedToAddProvider"), String(error));
    } finally {
      local.setLoading(false);
    }
  };

  const handleDeleteOpenaiProvider = async (index: number) => {
    local.setLoading(true);
    try {
      const updated = openaiProviders().filter((_, i) => i !== index);
      await setOpenAICompatibleProviders(updated);
      setOpenaiProviders(updated);
      toastStore.success(t("apiKeys.toasts.providerDeleted"));
    } catch (error) {
      toastStore.error(t("apiKeys.toasts.failedToDeleteProvider"), String(error));
    } finally {
      local.setLoading(false);
    }
  };

  const handleEditProvider = (index: number) => {
    setEditingIndex(index);
    const provider = openaiProviders()[index];
    setNewOpenaiProvider({
      ...provider,
      apiKeyEntries: [...provider.apiKeyEntries],
    });
    if (provider.apiKeyEntries.length > 1) {
      setBulkAddMode(true);
      setBulkKeysInput(
        provider.apiKeyEntries
          .map((entry) => entry.apiKey)
          .filter((apiKey) => apiKey.trim())
          .join("\n"),
      );
    } else {
      setBulkAddMode(false);
      setBulkKeysInput("");
    }
    local.setShowAddForm(true);
  };

  const handleUpdateProvider = async () => {
    const provider = newOpenaiProvider();
    if (!provider.name.trim() || !provider.baseUrl.trim()) {
      toastStore.error(t("apiKeys.toasts.nameAndBaseUrlRequired"));
      return;
    }
    if (!provider.apiKeyEntries[0]?.apiKey.trim()) {
      toastStore.error(t("apiKeys.toasts.atLeastOneApiKeyRequired"));
      return;
    }

    local.setLoading(true);
    try {
      const index = editingIndex();
      if (index === null) {
        return;
      }

      const updated = openaiProviders().map((p, i) => (i === index ? provider : p));
      await setOpenAICompatibleProviders(updated);
      setOpenaiProviders(updated);
      setNewOpenaiProvider({
        apiKeyEntries: [{ apiKey: "" }],
        baseUrl: "",
        models: [],
        name: "",
      });
      setEditingIndex(null);
      local.setShowAddForm(false);
      setBulkAddMode(false);
      setBulkKeysInput("");
      toastStore.success(t("apiKeys.toasts.providerUpdated"));
    } catch (error) {
      toastStore.error(t("apiKeys.toasts.failedToUpdateProvider"), String(error));
    } finally {
      local.setLoading(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setNewOpenaiProvider({
      apiKeyEntries: [{ apiKey: "" }],
      baseUrl: "",
      models: [],
      name: "",
    });
    local.setShowAddForm(false);
    setBulkAddMode(false);
    setBulkKeysInput("");
  };

  const handleOpenModelManager = (index: number) => {
    setManagingProviderIndex(index);
    setShowModelManager(true);
  };

  const handleAddModel = async () => {
    const model = newModelInput().trim();
    if (!model) {
      return;
    }

    const index = managingProviderIndex();
    if (index === null) {
      return;
    }

    const updated = openaiProviders().map((p, i) => {
      if (i === index) {
        const existingModels = p.models || [];
        const alreadyExists = existingModels.some(
          (existingModel) => existingModel.name === model || existingModel.alias === model,
        );
        if (!alreadyExists) {
          return {
            ...p,
            models: [...existingModels, { name: model }],
          };
        }
      }
      return p;
    });

    local.setLoading(true);
    try {
      await setOpenAICompatibleProviders(updated);
      setOpenaiProviders(updated);
      setNewModelInput("");
      await reloadConfig();
    } catch (error) {
      toastStore.error(t("apiKeys.toasts.failedToAddModel"), String(error));
    } finally {
      local.setLoading(false);
    }
  };

  const handleRemoveModel = async (modelIndex: number) => {
    const providerIndex = managingProviderIndex();
    if (providerIndex === null) {
      return;
    }

    const updated = openaiProviders().map((p, i) => {
      if (i === providerIndex && p.models) {
        return {
          ...p,
          models: p.models.filter((_, index) => index !== modelIndex),
        };
      }
      return p;
    });

    local.setLoading(true);
    try {
      await setOpenAICompatibleProviders(updated);
      setOpenaiProviders(updated);
      toastStore.success(t("apiKeys.toasts.modelRemoved"));
      await reloadConfig();
    } catch (error) {
      toastStore.error(t("apiKeys.toasts.failedToRemoveModel"), String(error));
    } finally {
      local.setLoading(false);
    }
  };

  const handleSaveModels = async () => {
    const index = managingProviderIndex();
    if (index === null) {
      return;
    }

    local.setLoading(true);
    try {
      await setOpenAICompatibleProviders(openaiProviders());
      setShowModelManager(false);
      setManagingProviderIndex(null);
      toastStore.success(t("apiKeys.toasts.modelsSaved"));
      await reloadConfig();
    } catch (error) {
      toastStore.error(t("apiKeys.toasts.failedToSaveModels"), String(error));
    } finally {
      local.setLoading(false);
    }
  };

  const handleFetchModels = async () => {
    const index = managingProviderIndex();
    if (index === null) {
      return;
    }

    setFetchingModels(true);
    try {
      const allProviderModels = await fetchOpenaiCompatibleModels();
      const provider = openaiProviders()[index];
      const providerModels = allProviderModels.find((item) => item.providerName === provider.name);

      if (providerModels?.error) {
        toastStore.error(t("apiKeys.toasts.failedToFetchModels"), providerModels.error);
        return;
      }

      if (!providerModels || providerModels.models.length === 0) {
        toastStore.warning(
          t("apiKeys.toasts.noModelsFound"),
          t("apiKeys.toasts.providerReturnedNoModels"),
        );
        return;
      }

      const existingModelNames = new Set((provider.models || []).map((model) => model.name));
      const newModels = providerModels.models.filter((model) => !existingModelNames.has(model.id));

      if (newModels.length === 0) {
        toastStore.info(
          t("apiKeys.toasts.noNewModels"),
          t("apiKeys.toasts.allFetchedModelsAlreadyExist"),
        );
        return;
      }

      const updated = openaiProviders().map((p, i) => {
        if (i === index) {
          return {
            ...p,
            models: [...(p.models || []), ...newModels.map((model) => ({ name: model.id }))],
          };
        }
        return p;
      });

      await setOpenAICompatibleProviders(updated);
      setOpenaiProviders(updated);
      toastStore.success(
        t("apiKeys.toasts.addedModels", { count: newModels.length }),
        t("apiKeys.toasts.totalModels", {
          count: updated[index].models?.length || 0,
        }),
      );
      await reloadConfig();
    } catch (error) {
      toastStore.error(t("apiKeys.toasts.failedToFetchModels"), String(error));
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTestProvider = async (baseUrl: string, apiKey: string, index?: number) => {
    if (index !== undefined) {
      setTestingIndex(index);
    } else {
      setTestingNewProvider(true);
    }
    setTestResult(null);

    try {
      const result = await testOpenAIProvider(baseUrl, apiKey);
      setTestResult({
        message: result.message,
        modelsFound: result.modelsFound ?? undefined,
        success: result.success,
      });
      if (result.success) {
        toastStore.success(
          t("apiKeys.toasts.connectionSuccessful"),
          result.modelsFound
            ? t("apiKeys.toasts.foundModels", {
                count: result.modelsFound,
              })
            : undefined,
        );
      } else {
        toastStore.error(t("apiKeys.toasts.connectionFailed"), result.message);
      }
    } catch (error) {
      setTestResult({
        message: String(error),
        success: false,
      });
      toastStore.error(t("apiKeys.toasts.testFailed"), String(error));
    } finally {
      setTestingIndex(null);
      setTestingNewProvider(false);
    }
  };

  const showEmptyState = createMemo(
    () =>
      proxyStatus().running &&
      !local.loading() &&
      openaiProviders().length === 0 &&
      !local.showAddForm(),
  );

  return (
    <div class="space-y-4">
      <p class="text-xs text-gray-500 dark:text-gray-400">
        {t("apiKeys.openAiCompatibleDescription")}
      </p>

      <Show when={openaiProviders().length > 0}>
        <div class="space-y-2">
          <For each={openaiProviders()}>
            {(provider, index) => (
              <div class="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                <div class="flex items-center justify-between">
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {provider.name}
                    </p>
                    <p class="truncate text-xs text-gray-500 dark:text-gray-400">
                      {provider.baseUrl}
                    </p>
                    <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      {t("apiKeys.apiKeysCount", {
                        count: provider.apiKeyEntries.length,
                      })}
                    </p>
                  </div>
                  <div class="flex items-center gap-1">
                    <Button
                      disabled={testingIndex() === index()}
                      onClick={() =>
                        handleTestProvider(
                          provider.baseUrl,
                          provider.apiKeyEntries[0]?.apiKey || "",
                          index(),
                        )
                      }
                      size="sm"
                      title={t("apiKeys.actions.testConnection")}
                      variant="ghost"
                    >
                      <Show
                        fallback={
                          <svg
                            class="h-4 w-4 text-blue-500"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                            />
                          </svg>
                        }
                        when={testingIndex() === index()}
                      >
                        <svg
                          class="h-4 w-4 animate-spin text-blue-500"
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
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            fill="currentColor"
                          />
                        </svg>
                      </Show>
                    </Button>
                    <Button
                      onClick={() => handleEditProvider(index())}
                      size="sm"
                      title={t("apiKeys.actions.editProvider")}
                      variant="ghost"
                    >
                      <svg
                        class="h-4 w-4 text-gray-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                        />
                      </svg>
                    </Button>
                    <Button
                      onClick={() => handleOpenModelManager(index())}
                      size="sm"
                      title={t("apiKeys.actions.manageModels")}
                      variant="ghost"
                    >
                      <svg
                        class="h-4 w-4 text-gray-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M4 6h16M4 10h16M4 14h16M4 18h16"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                        />
                      </svg>
                    </Button>
                    <Button
                      onClick={() => handleDeleteOpenaiProvider(index())}
                      size="sm"
                      title={t("apiKeys.actions.deleteProvider")}
                      variant="ghost"
                    >
                      <svg
                        class="h-4 w-4 text-red-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
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

      <Show when={local.showAddForm()}>
        <div class="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
          <label class="block">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("apiKeys.labels.providerNameRequired")}
            </span>
            <input
              class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
              onInput={(e) =>
                setNewOpenaiProvider({
                  ...newOpenaiProvider(),
                  name: e.currentTarget.value,
                })
              }
              placeholder={t("apiKeys.placeholders.providerName")}
              type="text"
              value={newOpenaiProvider().name}
            />
          </label>
          <label class="block">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("apiKeys.labels.baseUrlRequired")}
            </span>
            <input
              class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
              onInput={(e) =>
                setNewOpenaiProvider({
                  ...newOpenaiProvider(),
                  baseUrl: e.currentTarget.value,
                })
              }
              placeholder={t("apiKeys.placeholders.providerBaseUrl")}
              type="text"
              value={newOpenaiProvider().baseUrl}
            />
          </label>
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("apiKeys.labels.apiKeysRequired")}
              </span>
              <button
                class="text-xs text-brand-600 hover:underline dark:text-brand-400"
                onClick={() => {
                  setBulkAddMode(!bulkAddMode());
                  if (!bulkAddMode()) {
                    const existingKeys = newOpenaiProvider()
                      .apiKeyEntries.map((entry) => entry.apiKey)
                      .filter((apiKey) => apiKey.trim())
                      .join("\n");
                    setBulkKeysInput(existingKeys);
                  }
                }}
                type="button"
              >
                {bulkAddMode() ? t("apiKeys.actions.singleKey") : t("apiKeys.actions.bulkAdd")}
              </button>
            </div>

            <Show when={!bulkAddMode()}>
              <input
                class="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
                onInput={(e) =>
                  setNewOpenaiProvider({
                    ...newOpenaiProvider(),
                    apiKeyEntries: [{ apiKey: e.currentTarget.value }],
                  })
                }
                placeholder={t("apiKeys.placeholders.providerApiKey")}
                type="password"
                value={newOpenaiProvider().apiKeyEntries[0]?.apiKey || ""}
              />
            </Show>

            <Show when={bulkAddMode()}>
              <textarea
                class="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
                onInput={(e) => {
                  setBulkKeysInput(e.currentTarget.value);
                  const keys = e.currentTarget.value
                    .split("\n")
                    .map((key) => key.trim())
                    .filter((key) => key.length > 0)
                    .map((apiKey) => ({ apiKey }));
                  setNewOpenaiProvider({
                    ...newOpenaiProvider(),
                    apiKeyEntries: keys.length > 0 ? keys : [{ apiKey: "" }],
                  });
                }}
                placeholder={t("apiKeys.placeholders.bulkApiKeys")}
                rows={5}
                value={bulkKeysInput()}
              />
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {newOpenaiProvider().apiKeyEntries.filter((entry) => entry.apiKey.trim()).length}{" "}
                {t("apiKeys.keysDetected")}
              </p>
            </Show>
          </div>
          <label class="block">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("apiKeys.labels.prefixOptional")}
            </span>
            <input
              class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
              onInput={(e) =>
                setNewOpenaiProvider({
                  ...newOpenaiProvider(),
                  prefix: e.currentTarget.value || undefined,
                })
              }
              placeholder={t("apiKeys.placeholders.providerPrefix")}
              type="text"
              value={newOpenaiProvider().prefix || ""}
            />
          </label>
          <div class="flex gap-2 pt-2">
            <Button
              disabled={local.loading()}
              onClick={editingIndex() !== null ? handleUpdateProvider : handleAddOpenaiProvider}
              size="sm"
              variant="primary"
            >
              {editingIndex() !== null
                ? t("apiKeys.actions.updateProvider")
                : t("apiKeys.actions.addProvider")}
            </Button>
            <Button
              disabled={
                testingNewProvider() ||
                !newOpenaiProvider().baseUrl ||
                !newOpenaiProvider().apiKeyEntries[0]?.apiKey
              }
              onClick={() =>
                handleTestProvider(
                  newOpenaiProvider().baseUrl,
                  newOpenaiProvider().apiKeyEntries[0]?.apiKey || "",
                )
              }
              size="sm"
              variant="secondary"
            >
              <Show fallback={t("apiKeys.actions.testConnection")} when={testingNewProvider()}>
                <svg class="mr-1 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    fill="currentColor"
                  />
                </svg>
                {t("apiKeys.testing")}
              </Show>
            </Button>
            <Button
              onClick={
                editingIndex() !== null ? handleCancelEdit : () => local.setShowAddForm(false)
              }
              size="sm"
              variant="ghost"
            >
              {t("common.cancel")}
            </Button>
          </div>
          <Show when={testResult()}>
            <div
              class={`rounded-lg p-2 text-sm ${testResult()?.success ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300" : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300"}`}
            >
              <Show
                fallback={
                  <span>
                    {t("apiKeys.connectionFailedWithMessage", {
                      message: testResult()?.message || "",
                    })}
                  </span>
                }
                when={testResult()?.success}
              >
                <span>
                  {t("apiKeys.connectionSuccessful")}{" "}
                  {testResult()?.modelsFound
                    ? t("apiKeys.foundModelsWithCount", {
                        count: testResult()?.modelsFound || 0,
                      })
                    : ""}
                </span>
              </Show>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={!local.showAddForm()}>
        <Button
          class="w-full"
          disabled={!proxyStatus().running}
          onClick={() => local.setShowAddForm(true)}
          variant="secondary"
        >
          <svg class="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M12 4v16m8-8H4"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
          {t("apiKeys.actions.addOpenAiCompatibleProvider")}
        </Button>
      </Show>

      <Show when={showModelManager()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div class="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900">
            <div class="flex items-center justify-between">
              <h3 class="font-semibold text-gray-900 dark:text-gray-100">
                {t("apiKeys.actions.manageModels")}
              </h3>
              <Button
                onClick={() => {
                  setShowModelManager(false);
                  setManagingProviderIndex(null);
                }}
                size="sm"
                variant="ghost"
              >
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M6 18L18 6M6 6l12 12"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
              </Button>
            </div>

            <div class="flex gap-2">
              <input
                class="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
                onInput={(e) => setNewModelInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleAddModel();
                  }
                }}
                placeholder={t("apiKeys.placeholders.modelName")}
                type="text"
                value={newModelInput()}
              />
              <Button
                disabled={!newModelInput().trim()}
                onClick={handleAddModel}
                size="sm"
                variant="primary"
              >
                {t("common.add")}
              </Button>
              <Button
                disabled={fetchingModels()}
                onClick={handleFetchModels}
                size="sm"
                title={t("apiKeys.actions.fetchModelsFromProvider")}
                variant="secondary"
              >
                <Show
                  fallback={
                    <>
                      <svg
                        class="mr-1 h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                        />
                      </svg>
                      {t("apiKeys.actions.fetch")}
                    </>
                  }
                  when={fetchingModels()}
                >
                  <svg class="mr-1 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      fill="currentColor"
                    />
                  </svg>
                  {t("apiKeys.fetching")}
                </Show>
              </Button>
            </div>

            <div class="max-h-60 space-y-2 overflow-y-auto">
              <Show
                when={
                  managingProviderIndex() !== null &&
                  (openaiProviders()[managingProviderIndex()!]?.models || []).length > 0
                }
              >
                <For each={openaiProviders()[managingProviderIndex()!]?.models || []}>
                  {(model, index) => (
                    <div class="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800/50">
                      <span class="text-sm text-gray-700 dark:text-gray-300">{model.name}</span>
                      <Button onClick={() => handleRemoveModel(index())} size="sm" variant="ghost">
                        <svg
                          class="h-4 w-4 text-red-500"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M6 18L18 6M6 6l12 12"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                          />
                        </svg>
                      </Button>
                    </div>
                  )}
                </For>
              </Show>
              <Show
                when={
                  managingProviderIndex() !== null &&
                  (openaiProviders()[managingProviderIndex()!]?.models || []).length === 0
                }
              >
                <p class="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  {t("apiKeys.noModelsAddedYet")}
                </p>
              </Show>
            </div>

            <div class="flex justify-end gap-2 pt-2">
              <Button
                onClick={() => {
                  setShowModelManager(false);
                  setManagingProviderIndex(null);
                }}
                size="sm"
                variant="ghost"
              >
                {t("common.cancel")}
              </Button>
              <Button
                disabled={local.loading()}
                onClick={handleSaveModels}
                size="sm"
                variant="primary"
              >
                {t("common.save")}
              </Button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={showEmptyState()}>
        <div class="py-8 text-center text-gray-500 dark:text-gray-400">
          <svg
            class="mx-auto mb-3 h-12 w-12 text-gray-300 dark:text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
          <p class="text-sm">{t("apiKeys.noApiKeysConfiguredYet")}</p>
          <p class="mt-1 text-xs">{t("apiKeys.addFirstKeyHint")}</p>
        </div>
      </Show>
    </div>
  );
}

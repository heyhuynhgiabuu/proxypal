import { createSignal, For, Show } from "solid-js";
import { useI18n } from "../../i18n";
import { saveConfig, testOpenAIProvider } from "../../lib/tauri";
import { toastStore } from "../../stores/toast";
import { Button } from "../ui";

import type { AmpOpenAIModel, AmpOpenAIProvider } from "../../lib/tauri";
import type { SettingsBaseProps } from "./types";

type OpenAIProviderSettingsProps = SettingsBaseProps;

export function OpenAIProviderSettings(props: OpenAIProviderSettingsProps) {
  const { t } = useI18n();

  // Provider modal state
  const [providerModalOpen, setProviderModalOpen] = createSignal(false);
  const [editingProviderId, setEditingProviderId] = createSignal<string | null>(null);

  // Provider form state (used in modal)
  const [providerName, setProviderName] = createSignal("");
  const [providerBaseUrl, setProviderBaseUrl] = createSignal("");
  const [providerApiKey, setProviderApiKey] = createSignal("");
  const [providerModels, setProviderModels] = createSignal<AmpOpenAIModel[]>([]);
  const [newModelName, setNewModelName] = createSignal("");
  const [newModelAlias, setNewModelAlias] = createSignal("");

  // Provider test state
  const [testingProvider, setTestingProvider] = createSignal(false);
  const [providerTestResult, setProviderTestResult] = createSignal<Awaited<
    ReturnType<typeof testOpenAIProvider>
  > | null>(null);

  const addProviderModel = () => {
    const name = newModelName().trim();
    const alias = newModelAlias().trim();
    if (!name) {
      toastStore.error(t("settings.toasts.modelNameRequired"));
      return;
    }
    setProviderModels([...providerModels(), { alias, name }]);
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
      toastStore.error(t("settings.toasts.providerFieldsRequired"));
      return;
    }

    const currentProviders = props.config().ampOpenaiProviders || [];
    const editId = editingProviderId();

    let newProviders: AmpOpenAIProvider[];
    if (editId) {
      // Update existing provider
      newProviders = currentProviders.map((p) =>
        p.id === editId ? { apiKey, baseUrl, id: editId, models: providerModels(), name } : p,
      );
    } else {
      // Add new provider with generated UUID
      const newProvider: AmpOpenAIProvider = {
        apiKey,
        baseUrl,
        id: crypto.randomUUID(),
        models: providerModels(),
        name,
      };
      newProviders = [...currentProviders, newProvider];
    }

    const newConfig = { ...props.config(), ampOpenaiProviders: newProviders };
    props.setConfig(newConfig);

    props.setSaving(true);
    try {
      await saveConfig(newConfig);
      toastStore.success(
        editId ? t("settings.toasts.providerUpdated") : t("settings.toasts.providerAdded"),
      );
      closeProviderModal();
    } catch (error) {
      console.error("Failed to save config:", error);
      toastStore.error(t("settings.toasts.settingsSaveFailed"), String(error));
    } finally {
      props.setSaving(false);
    }
  };

  const deleteOpenAIProvider = async (providerId: string) => {
    const currentProviders = props.config().ampOpenaiProviders || [];
    const newProviders = currentProviders.filter((p) => p.id !== providerId);

    const newConfig = { ...props.config(), ampOpenaiProviders: newProviders };
    props.setConfig(newConfig);

    props.setSaving(true);
    try {
      await saveConfig(newConfig);
      toastStore.success(t("settings.toasts.providerRemoved"));
    } catch (error) {
      console.error("Failed to save config:", error);
      toastStore.error(t("settings.toasts.providerRemoveFailed"), String(error));
    } finally {
      props.setSaving(false);
    }
  };

  // Test connection to the custom OpenAI provider
  const testProviderConnection = async () => {
    const baseUrl = providerBaseUrl().trim();
    const apiKey = providerApiKey().trim();

    if (!baseUrl || !apiKey) {
      toastStore.error(t("settings.toasts.baseUrlAndApiKeyRequiredForTest"));
      return;
    }

    setTestingProvider(true);
    setProviderTestResult(null);

    try {
      const result = await testOpenAIProvider(baseUrl, apiKey);
      setProviderTestResult(result);

      if (result.success) {
        const modelsInfo = result.modelsFound
          ? t("settings.toasts.foundModels", { count: result.modelsFound })
          : "";
        toastStore.success(`${t("settings.toasts.connectionSuccessful")}${modelsInfo}`);
      } else {
        toastStore.error(result.message);
      }
    } catch (error) {
      const errorMsg = String(error);
      setProviderTestResult({
        message: errorMsg,
        success: false,
      });
      toastStore.error(t("settings.toasts.connectionTestFailed"), errorMsg);
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

  return (
    <div class="space-y-4">
      <div>
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
          Custom OpenAI-Compatible Providers
        </span>
        <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          Add external providers (ZenMux, OpenRouter, etc.) for additional models
        </p>
      </div>

      {/* Provider Table */}
      <Show when={(props.config().ampOpenaiProviders || []).length > 0}>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 text-left text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                <th class="pb-2 font-medium">{t("common.name")}</th>
                <th class="pb-2 font-medium">{t("common.baseUrl")}</th>
                <th class="pb-2 font-medium">{t("common.models")}</th>
                <th class="w-20 pb-2 font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <For each={props.config().ampOpenaiProviders || []}>
                {(provider) => (
                  <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td class="py-2 pr-2">
                      <span class="font-medium text-gray-900 dark:text-gray-100">
                        {provider.name}
                      </span>
                    </td>
                    <td class="py-2 pr-2">
                      <span
                        class="block max-w-[200px] truncate font-mono text-xs text-gray-500 dark:text-gray-400"
                        title={provider.baseUrl}
                      >
                        {provider.baseUrl}
                      </span>
                    </td>
                    <td class="py-2 pr-2">
                      <span class="text-xs text-gray-500 dark:text-gray-400">
                        {provider.models?.length || 0} model
                        {(provider.models?.length || 0) !== 1 ? "s" : ""}
                      </span>
                    </td>
                    <td class="py-2">
                      <div class="flex items-center gap-1">
                        <button
                          class="p-1.5 text-gray-400 transition-colors hover:text-brand-500"
                          onClick={() => openProviderModal(provider)}
                          title="Edit provider"
                          type="button"
                        >
                          <svg
                            class="h-4 w-4"
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
                        </button>
                        <button
                          class="p-1.5 text-gray-400 transition-colors hover:text-red-500"
                          onClick={() => deleteOpenAIProvider(provider.id)}
                          title="Delete provider"
                          type="button"
                        >
                          <svg
                            class="h-4 w-4"
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
      <Show when={(props.config().ampOpenaiProviders || []).length === 0}>
        <div class="py-6 text-center text-sm text-gray-400 dark:text-gray-500">
          No custom providers configured
        </div>
      </Show>

      {/* Add Provider Button */}
      <Button class="w-full" onClick={() => openProviderModal()} size="sm" variant="secondary">
        <svg class="mr-1.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            d="M12 4v16m8-8H4"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
          />
        </svg>
        Add Provider
      </Button>

      {/* Provider Modal */}
      <Show when={providerModalOpen()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeProviderModal();
            }
          }}
        >
          <div
            class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
              <h3 class="font-semibold text-gray-900 dark:text-gray-100">
                {editingProviderId() ? "Edit Provider" : "Add Provider"}
              </h3>
              <button
                class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                onClick={closeProviderModal}
                type="button"
              >
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M6 18L18 6M6 6l12 12"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
              </button>
            </div>

            <div class="space-y-4 p-4">
              {/* Provider Name */}
              <label class="block">
                <span class="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Provider Name
                </span>
                <input
                  class="transition-smooth mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800"
                  onInput={(e) => setProviderName(e.currentTarget.value)}
                  placeholder="e.g. zenmux, openrouter"
                  type="text"
                  value={providerName()}
                />
              </label>

              {/* Base URL */}
              <label class="block">
                <span class="text-xs font-medium text-gray-600 dark:text-gray-400">Base URL</span>
                <input
                  class="transition-smooth mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800"
                  onInput={(e) => setProviderBaseUrl(e.currentTarget.value)}
                  placeholder="https://api.example.com/v1"
                  type="text"
                  value={providerBaseUrl()}
                />
              </label>

              {/* API Key */}
              <label class="block">
                <span class="text-xs font-medium text-gray-600 dark:text-gray-400">API Key</span>
                <input
                  class="transition-smooth mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800"
                  onInput={(e) => setProviderApiKey(e.currentTarget.value)}
                  placeholder="sk-..."
                  type="password"
                  value={providerApiKey()}
                />
              </label>

              {/* Models */}
              <div class="space-y-2">
                <span class="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Model Aliases (map proxy model names to provider model names)
                </span>

                {/* Existing models */}
                <For each={providerModels()}>
                  {(model, index) => (
                    <div class="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800">
                      <div class="flex flex-1 items-center gap-2 overflow-hidden font-mono text-xs">
                        <span class="truncate text-gray-700 dark:text-gray-300" title={model.name}>
                          {model.name}
                        </span>
                        <Show when={model.alias}>
                          <svg
                            class="h-4 w-4 flex-shrink-0 text-gray-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M13 7l5 5m0 0l-5 5m5-5H6"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                            />
                          </svg>
                          <span class="truncate text-brand-500" title={model.alias}>
                            {model.alias}
                          </span>
                        </Show>
                      </div>
                      <button
                        class="flex-shrink-0 p-1 text-gray-400 transition-colors hover:text-red-500"
                        onClick={() => removeProviderModel(index())}
                        title="Remove model"
                        type="button"
                      >
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            d="M6 18L18 6M6 6l12 12"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                          />
                        </svg>
                      </button>
                    </div>
                  )}
                </For>

                {/* Add new model */}
                <div class="flex flex-col gap-2 sm:flex-row">
                  <input
                    class="transition-smooth flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 font-mono text-xs focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800"
                    onInput={(e) => setNewModelName(e.currentTarget.value)}
                    placeholder="Provider model (e.g. anthropic/claude-4)"
                    type="text"
                    value={newModelName()}
                  />
                  <input
                    class="transition-smooth flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 font-mono text-xs focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800"
                    onInput={(e) => setNewModelAlias(e.currentTarget.value)}
                    placeholder="Alias (e.g. claude-4-20251101)"
                    type="text"
                    value={newModelAlias()}
                  />
                  <Button
                    disabled={!newModelName().trim()}
                    onClick={addProviderModel}
                    size="sm"
                    variant="secondary"
                  >
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        d="M12 4v16m8-8H4"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                      />
                    </svg>
                  </Button>
                </div>
              </div>

              {/* Test Connection */}
              <div class="flex items-center gap-2">
                <Button
                  disabled={
                    testingProvider() || !providerBaseUrl().trim() || !providerApiKey().trim()
                  }
                  onClick={testProviderConnection}
                  size="sm"
                  variant="secondary"
                >
                  {testingProvider() ? (
                    <span class="flex items-center gap-1.5">
                      <svg class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
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
                    class={`flex items-center gap-2 rounded-lg p-2 text-xs ${
                      result().success
                        ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                        : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                    }`}
                  >
                    <Show
                      fallback={
                        <svg
                          class="h-4 w-4 flex-shrink-0"
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
                      }
                      when={result().success}
                    >
                      <svg
                        class="h-4 w-4 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M5 13l4 4L19 7"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
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
                      <span class="text-gray-500 dark:text-gray-400">{result().latencyMs}ms</span>
                    </Show>
                  </div>
                )}
              </Show>
            </div>

            {/* Modal Footer */}
            <div class="sticky bottom-0 flex justify-end gap-2 border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
              <Button onClick={closeProviderModal} size="sm" variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={
                  !providerName().trim() || !providerBaseUrl().trim() || !providerApiKey().trim()
                }
                onClick={saveOpenAIProvider}
                size="sm"
                variant="primary"
              >
                {editingProviderId() ? "Save Changes" : "Add Provider"}
              </Button>
            </div>
          </div>
        </div>
      </Show>

      <p class="text-xs text-gray-400 dark:text-gray-500">
        After changing settings, restart the proxy for changes to take effect.
      </p>
    </div>
  );
}

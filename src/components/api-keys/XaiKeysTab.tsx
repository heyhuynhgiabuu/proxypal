import { createEffect, createMemo, createSignal, For, Show, splitProps } from "solid-js";
import { useI18n } from "../../i18n";
import { getXaiApiKeys, setXaiApiKeys } from "../../lib/tauri";
import { appStore } from "../../stores/app";
import { toastStore } from "../../stores/toast";
import { Button } from "../ui";

import type { XaiApiKey } from "../../lib/tauri";

interface XaiKeysTabProps {
  loading: () => boolean;
  setLoading: (value: boolean) => void;
  setShowAddForm: (value: boolean) => void;
  showAddForm: () => boolean;
}

const XAI_BASE_URL = "https://api.x.ai/v1";

export function XaiKeysTab(props: XaiKeysTabProps) {
  const [local] = splitProps(props, ["showAddForm", "setShowAddForm", "loading", "setLoading"]);
  const { t } = useI18n();
  const { proxyStatus, setConfig } = appStore;
  const [xaiKeys, setXaiKeys] = createSignal<XaiApiKey[]>([]);
  const [newXaiKey, setNewXaiKey] = createSignal<XaiApiKey>({
    apiKey: "",
    baseUrl: XAI_BASE_URL,
  });

  const loadKeys = async () => {
    if (!proxyStatus().running) {
      return;
    }

    local.setLoading(true);
    try {
      setXaiKeys(await getXaiApiKeys());
    } catch (error) {
      console.error("Failed to load xAI API keys:", error);
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

  const handleAddXaiKey = async () => {
    const key = newXaiKey();
    if (!key.apiKey.trim()) {
      toastStore.error(t("apiKeys.toasts.apiKeyRequired"));
      return;
    }
    if (!key.baseUrl.trim()) {
      toastStore.error(t("apiKeys.toasts.baseUrlRequired"));
      return;
    }

    local.setLoading(true);
    try {
      const updated = [...xaiKeys(), key];
      await setXaiApiKeys(updated);
      setConfig({ ...appStore.config(), xaiApiKeys: updated });
      setXaiKeys(updated);
      setNewXaiKey({ apiKey: "", baseUrl: XAI_BASE_URL });
      local.setShowAddForm(false);
      toastStore.success(t("apiKeys.toasts.apiKeyAdded", { provider: "xAI" }));
    } catch (error) {
      toastStore.error(t("apiKeys.toasts.failedToAddKey"), String(error));
    } finally {
      local.setLoading(false);
    }
  };

  const handleDeleteXaiKey = async (index: number) => {
    local.setLoading(true);
    try {
      const updated = xaiKeys().filter((_, i) => i !== index);
      await setXaiApiKeys(updated);
      setConfig({ ...appStore.config(), xaiApiKeys: updated });
      setXaiKeys(updated);
      toastStore.success(t("apiKeys.toasts.apiKeyDeleted", { provider: "xAI" }));
    } catch (error) {
      toastStore.error(t("apiKeys.toasts.failedToDeleteKey"), String(error));
    } finally {
      local.setLoading(false);
    }
  };

  const showEmptyState = createMemo(
    () =>
      proxyStatus().running && !local.loading() && xaiKeys().length === 0 && !local.showAddForm(),
  );

  return (
    <div class="space-y-4">
      <Show when={xaiKeys().length > 0}>
        <div class="space-y-2">
          <For each={xaiKeys()}>
            {(key, index) => (
              <div class="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                <div class="min-w-0 flex-1">
                  <code class="font-mono text-sm text-gray-700 dark:text-gray-300">
                    {key.apiKey.length <= 8
                      ? "****"
                      : `${key.apiKey.slice(0, 4)}...${key.apiKey.slice(-4)}`}
                  </code>
                  <p class="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                    {key.baseUrl}
                  </p>
                </div>
                <Button onClick={() => handleDeleteXaiKey(index())} size="sm" variant="ghost">
                  <span aria-label={t("authFiles.actions.delete")}>×</span>
                </Button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={local.showAddForm()}>
        <div class="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
          <label class="block">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("apiKeys.labels.apiKeyRequired")}
            </span>
            <input
              class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
              onInput={(e) => setNewXaiKey({ ...newXaiKey(), apiKey: e.currentTarget.value })}
              placeholder={t("apiKeys.placeholders.xaiApiKey")}
              type="password"
              value={newXaiKey().apiKey}
            />
          </label>
          <label class="block">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("apiKeys.labels.baseUrlRequired")}
            </span>
            <input
              class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
              onInput={(e) => setNewXaiKey({ ...newXaiKey(), baseUrl: e.currentTarget.value })}
              placeholder={t("apiKeys.placeholders.xaiBaseUrl")}
              type="url"
              value={newXaiKey().baseUrl}
            />
          </label>
          <label class="block">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("apiKeys.labels.prefixOptional")}
            </span>
            <input
              class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
              onInput={(e) =>
                setNewXaiKey({ ...newXaiKey(), prefix: e.currentTarget.value || undefined })
              }
              placeholder={t("apiKeys.placeholders.xaiPrefix")}
              type="text"
              value={newXaiKey().prefix || ""}
            />
          </label>
          <label class="block">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("apiKeys.labels.requestRetryOptional")}
            </span>
            <input
              class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
              min="0"
              onInput={(e) =>
                setNewXaiKey({
                  ...newXaiKey(),
                  requestRetry:
                    e.currentTarget.value === ""
                      ? undefined
                      : Math.max(0, Number.parseInt(e.currentTarget.value) || 0),
                })
              }
              placeholder={t("apiKeys.placeholders.requestRetry")}
              type="number"
              value={newXaiKey().requestRetry ?? ""}
            />
          </label>
          <div class="flex gap-2 pt-2">
            <Button
              disabled={local.loading()}
              onClick={handleAddXaiKey}
              size="sm"
              variant="primary"
            >
              {t("apiKeys.actions.addKey")}
            </Button>
            <Button onClick={() => local.setShowAddForm(false)} size="sm" variant="ghost">
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      </Show>

      <Show when={!local.showAddForm()}>
        <Button
          class="w-full"
          disabled={!proxyStatus().running}
          onClick={() => local.setShowAddForm(true)}
          variant="secondary"
        >
          {t("apiKeys.actions.addXaiApiKey")}
        </Button>
      </Show>

      <Show when={showEmptyState()}>
        <div class="py-8 text-center text-gray-500 dark:text-gray-400">
          <p class="text-sm">{t("apiKeys.noApiKeysConfiguredYet")}</p>
          <p class="mt-1 text-xs">{t("apiKeys.addFirstKeyHint")}</p>
        </div>
      </Show>
    </div>
  );
}

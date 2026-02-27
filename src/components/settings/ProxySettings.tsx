import { createEffect, createSignal, Show, splitProps } from "solid-js";
import { useI18n } from "../../i18n";
import {
  getLogSize,
  getMaxRetryInterval,
  saveConfig,
  setLogSize,
  setMaxRetryInterval,
  startProxy,
  stopProxy,
} from "../../lib/tauri";
import { toastStore } from "../../stores/toast";

import type { SettingsBaseProps } from "./types";

interface ProxySettingsProps extends SettingsBaseProps {
  proxyRunning: boolean;
}

export function ProxySettings(props: ProxySettingsProps) {
  const { t } = useI18n();
  const [local] = splitProps(props, [
    "config",
    "setConfig",
    "saving",
    "setSaving",
    "handleConfigChange",
    "proxyRunning",
  ]);

  void saveConfig;
  void startProxy;
  void stopProxy;

  const [showProxyApiKey, setShowProxyApiKey] = createSignal(false);
  const [showProxyPassword, setShowProxyPassword] = createSignal(false);
  const [showManagementKey, setShowManagementKey] = createSignal(false);
  const [maxRetryInterval, setMaxRetryIntervalState] = createSignal<number>(0);
  const [logSize, setLogSizeState] = createSignal<number>(500);
  const [savingMaxRetryInterval, setSavingMaxRetryInterval] = createSignal(false);
  const [savingLogSize, setSavingLogSize] = createSignal(false);

  createEffect(async () => {
    if (!local.proxyRunning) {
      return;
    }

    try {
      const interval = await getMaxRetryInterval();
      setMaxRetryIntervalState(interval);
    } catch (error) {
      console.error("Failed to fetch max retry interval:", error);
    }

    try {
      const size = await getLogSize();
      setLogSizeState(size);
    } catch (error) {
      console.error("Failed to fetch log size:", error);
    }
  });

  const handleMaxRetryIntervalChange = async (value: number) => {
    setSavingMaxRetryInterval(true);
    try {
      await setMaxRetryInterval(value);
      setMaxRetryIntervalState(value);
      toastStore.success(t("settings.toasts.maxRetryIntervalUpdated"));
    } catch (error) {
      toastStore.error(t("settings.toasts.failedToUpdateMaxRetryInterval"), String(error));
    } finally {
      setSavingMaxRetryInterval(false);
    }
  };

  const handleLogSizeChange = async (value: number) => {
    setSavingLogSize(true);
    try {
      await setLogSize(value);
      setLogSizeState(value);
      toastStore.success(t("settings.toasts.logBufferSizeUpdated"));
    } catch (error) {
      toastStore.error(t("settings.toasts.failedToUpdateLogSize"), String(error));
    } finally {
      setSavingLogSize(false);
    }
  };

  return (
    <div class="space-y-4">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
        Proxy Configuration
      </h2>

      <div class="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <label class="block">
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Port</span>
          <input
            class="transition-smooth mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
            max="65535"
            min="1024"
            onInput={(e) =>
              local.handleConfigChange("port", Number.parseInt(e.currentTarget.value) || 8317)
            }
            type="number"
            value={local.config().port}
          />
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            The port where the proxy server will listen (default: 8317)
          </p>
        </label>

        <div class="border-t border-gray-200 dark:border-gray-700" />

        <label class="transition-smooth group flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3 hover:border-brand-500/50 dark:border-gray-700 dark:bg-gray-800/50">
          <div class="flex flex-col">
            <span class="transition-smooth text-sm font-medium text-gray-700 group-hover:text-brand-600 dark:text-gray-300 dark:group-hover:text-brand-400">
              Use System Proxy
            </span>
            <span class="text-xs text-gray-500 dark:text-gray-400">
              Automatically detect proxy from OS settings
            </span>
          </div>
          <div class="transition-smooth relative inline-flex h-6 w-11 items-center rounded-full focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2">
            <input
              checked={local.config().useSystemProxy}
              class="peer sr-only"
              onChange={(e) => local.handleConfigChange("useSystemProxy", e.currentTarget.checked)}
              type="checkbox"
            />
            <div class="transition-smooth h-6 w-11 rounded-full bg-gray-200 peer-checked:bg-brand-600 dark:bg-gray-700" />
            <div class="transition-smooth absolute left-1 h-4 w-4 rounded-full bg-white peer-checked:translate-x-5" />
          </div>
        </label>

        <Show when={!local.config().useSystemProxy}>
          <label class="block">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
              Upstream Proxy URL
            </span>
            <input
              class="transition-smooth mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
              onInput={(e) => local.handleConfigChange("proxyUrl", e.currentTarget.value)}
              placeholder="socks5://127.0.0.1:1080"
              type="text"
              value={local.config().proxyUrl}
            />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Optional SOCKS5/HTTP proxy for outbound requests (e.g. socks5://host:port)
            </p>
          </label>
        </Show>

        <div class="mt-2 grid grid-cols-2 gap-4">
          <label class="block">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Proxy Username</span>
            <input
              class="transition-smooth mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
              onInput={(e) => local.handleConfigChange("proxyUsername", e.currentTarget.value)}
              placeholder="Optional"
              type="text"
              value={local.config().proxyUsername || ""}
            />
          </label>
          <label class="block">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Proxy Password</span>
            <div class="relative mt-1">
              <input
                class="transition-smooth block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-10 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
                onInput={(e) => local.handleConfigChange("proxyPassword", e.currentTarget.value)}
                placeholder="Optional"
                type={showProxyPassword() ? "text" : "password"}
                value={local.config().proxyPassword || ""}
              />
              <button
                class="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                onClick={() => setShowProxyPassword(!showProxyPassword())}
                type="button"
              >
                {showProxyPassword() ? (
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                    />
                  </svg>
                ) : (
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                    />
                    <path
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                    />
                  </svg>
                )}
              </button>
            </div>
          </label>
        </div>

        <div class="border-t border-gray-200 dark:border-gray-700" />

        <label class="block">
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Proxy API Key</span>
          <div class="relative mt-1">
            <input
              class="transition-smooth block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-10 font-mono text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
              onInput={(e) =>
                local.handleConfigChange("proxyApiKey", e.currentTarget.value || "proxypal-local")
              }
              placeholder="proxypal-local"
              type={showProxyApiKey() ? "text" : "password"}
              value={local.config().proxyApiKey || "proxypal-local"}
            />
            <button
              class="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              onClick={() => setShowProxyApiKey(!showProxyApiKey())}
              type="button"
            >
              {showProxyApiKey() ? (
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
              ) : (
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                  <path
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
              )}
            </button>
          </div>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            API key for client authentication. Change this if exposing proxy publicly.
          </p>
        </label>

        <div class="border-t border-gray-200 dark:border-gray-700" />

        <label class="block">
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
            Management API Key
          </span>
          <div class="relative mt-1">
            <input
              class="transition-smooth block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-10 font-mono text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
              onInput={(e) =>
                local.handleConfigChange(
                  "managementKey",
                  e.currentTarget.value || "proxypal-mgmt-key",
                )
              }
              placeholder="proxypal-mgmt-key"
              type={showManagementKey() ? "text" : "password"}
              value={local.config().managementKey || "proxypal-mgmt-key"}
            />
            <button
              class="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              onClick={() => setShowManagementKey(!showManagementKey())}
              type="button"
            >
              {showManagementKey() ? (
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
              ) : (
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                  <path
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
              )}
            </button>
          </div>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Secret key for internal management API. Change this if exposing proxy publicly.
          </p>
          <p class="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">
            ⚠️ Changing this key requires a proxy restart to take effect.
          </p>
        </label>

        <div class="border-t border-gray-200 dark:border-gray-700" />

        <label class="block">
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("settings.network.requestRetry.label")}
          </span>
          <input
            class="transition-smooth mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
            max="10"
            min="0"
            onInput={(e) =>
              local.handleConfigChange(
                "requestRetry",
                Math.max(0, Math.min(10, Number.parseInt(e.currentTarget.value) || 0)),
              )
            }
            type="number"
            value={local.config().requestRetry}
          />
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t("settings.network.requestRetry.description")}
          </p>
        </label>

        <div class="border-t border-gray-200 dark:border-gray-700" />

        <label class="block">
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("settings.network.routingStrategy.label")}
          </span>
          <select
            class="transition-smooth mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 [&>option]:bg-white [&>option]:text-gray-900 [&>option]:dark:bg-gray-900 [&>option]:dark:text-gray-100"
            onChange={(e) => local.handleConfigChange("routingStrategy", e.currentTarget.value)}
            value={local.config().routingStrategy}
          >
            <option value="round-robin">{t("settings.network.routingStrategy.roundRobin")}</option>
            <option value="fill-first">{t("settings.network.routingStrategy.fillFirst")}</option>
          </select>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t("settings.network.routingStrategy.description")}
          </p>
        </label>

        <Show when={local.proxyRunning}>
          <div class="border-t border-gray-200 dark:border-gray-700" />

          <label class="block">
            <span class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("settings.network.maxRetryInterval.label")}
              <Show when={savingMaxRetryInterval()}>
                <svg class="h-4 w-4 animate-spin text-brand-500" fill="none" viewBox="0 0 24 24">
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
            </span>
            <input
              class="transition-smooth mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900"
              disabled={savingMaxRetryInterval()}
              min="0"
              onInput={(e) => {
                const val = Math.max(0, Number.parseInt(e.currentTarget.value) || 0);
                handleMaxRetryIntervalChange(val);
              }}
              type="number"
              value={maxRetryInterval()}
            />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t("settings.network.maxRetryInterval.description")}
            </p>
          </label>

          <label class="block">
            <span class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("settings.network.logBufferSize.label")}
              <Show when={savingLogSize()}>
                <svg class="h-4 w-4 animate-spin text-brand-500" fill="none" viewBox="0 0 24 24">
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
            </span>
            <input
              class="transition-smooth mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900"
              disabled={savingLogSize()}
              min="100"
              onInput={(e) => {
                const val = Math.max(100, Number.parseInt(e.currentTarget.value) || 500);
                handleLogSizeChange(val);
              }}
              type="number"
              value={logSize()}
            />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t("settings.network.logBufferSize.description")}
            </p>
          </label>
        </Show>
      </div>
    </div>
  );
}

import { For, Show, splitProps } from "solid-js";
import { useI18n } from "../../i18n";
import { HealthIndicator } from "../HealthIndicator";

import type { Provider } from "../../lib/tauri";

interface ProviderInfo {
  id: Provider;
  logo: string;
  name: string;
}

interface ProviderSectionProps {
  authStatus: Record<Provider, number>;
  connected: ProviderInfo[];
  connectingProvider: Provider | null;
  deviceCodeProviders?: Set<Provider>;
  disconnected: ProviderInfo[];
  onConnect: (provider: Provider) => Promise<void>;
  onDeviceCodeConnect?: (provider: Provider) => Promise<void>;
  onDisconnect: (provider: Provider) => Promise<void>;
  proxyRunning: boolean;
  recentlyConnected: Set<Provider>;
}

export function ProviderSection(props: ProviderSectionProps) {
  const { t } = useI18n();
  const [local] = splitProps(props, [
    "connected",
    "disconnected",
    "recentlyConnected",
    "authStatus",
    "connectingProvider",
    "proxyRunning",
    "onConnect",
    "onDeviceCodeConnect",
    "onDisconnect",
    "deviceCodeProviders",
  ]);

  return (
    <div class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div class="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700">
        <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t("dashboard.providers.title")}
        </span>
        <span class="text-xs text-gray-500 dark:text-gray-400">
          {t("dashboard.providers.connectedCount", {
            count: local.connected.length,
          })}
        </span>
      </div>

      {/* Connected providers */}
      <Show when={local.connected.length > 0}>
        <div class="border-b border-gray-100 p-3 dark:border-gray-700">
          <div class="flex flex-wrap gap-2">
            <For each={local.connected}>
              {(p) => (
                <div
                  class={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${local.recentlyConnected.has(p.id) ? "border-green-400 bg-green-100 dark:bg-green-900/40" : "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20"} group`}
                >
                  <img alt={p.name} class="h-4 w-4 rounded" src={p.logo} />
                  <span class="text-sm font-medium text-green-800 dark:text-green-300">
                    {p.name}
                  </span>
                  {/* Account count badge - show when more than 1 account */}
                  <Show when={local.authStatus[p.id] > 1}>
                    <span class="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:bg-green-800/50 dark:text-green-400">
                      {local.authStatus[p.id]}
                    </span>
                  </Show>
                  <HealthIndicator provider={p.id} />
                  {/* Add another account button */}
                  <button
                    class="text-gray-400 opacity-0 transition-opacity hover:text-green-600 disabled:opacity-30 group-hover:opacity-100 dark:hover:text-green-400"
                    disabled={local.connectingProvider !== null}
                    onClick={() => local.onConnect(p.id)}
                    title={t("dashboard.providers.addAnotherAccount")}
                  >
                    {local.connectingProvider === p.id ? (
                      <svg
                        class="h-3.5 w-3.5 animate-spin"
                        fill="none"
                        stroke="currentColor"
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
                    ) : (
                      <svg
                        class="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M12 4v16m8-8H4"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                        />
                      </svg>
                    )}
                  </button>
                  {/* Disconnect button */}
                  <button
                    class="-mr-1 text-gray-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                    onClick={() => local.onDisconnect(p.id)}
                    title={t("dashboard.providers.disconnectAll")}
                  >
                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          </div>
        </div>
      </Show>

      {/* Add providers */}
      <Show when={local.disconnected.length > 0}>
        <div class="p-3">
          <Show when={!local.proxyRunning}>
            <p class="mb-2 text-xs text-amber-600 dark:text-amber-400">
              {t("dashboard.providers.startProxyToConnect")}
            </p>
          </Show>
          <div class="flex flex-wrap gap-2">
            <For each={local.disconnected}>
              {(p) => (
                <div class="flex items-center gap-1">
                  <button
                    class="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-100 px-3 py-1.5 transition-colors hover:border-brand-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700"
                    disabled={!local.proxyRunning || local.connectingProvider !== null}
                    onClick={() => local.onConnect(p.id)}
                    title={t("dashboard.providers.connectProvider")}
                  >
                    <img alt={p.name} class="h-4 w-4 rounded opacity-60" src={p.logo} />
                    <span class="text-sm text-gray-600 dark:text-gray-400">{p.name}</span>
                    {local.connectingProvider === p.id ? (
                      <svg
                        class="h-3 w-3 animate-spin text-gray-400"
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
                    ) : (
                      <svg
                        class="h-3 w-3 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M12 4v16m8-8H4"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                        />
                      </svg>
                    )}
                  </button>
                  <Show when={local.deviceCodeProviders?.has(p.id) && local.onDeviceCodeConnect}>
                    <button
                      class="rounded-full border border-gray-200 p-1.5 text-gray-400 transition-colors hover:border-blue-400 hover:text-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:hover:border-blue-500"
                      disabled={!local.proxyRunning || local.connectingProvider !== null}
                      onClick={() => local.onDeviceCodeConnect?.(p.id)}
                      title="Connect via device code"
                    >
                      <svg
                        class="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                        />
                      </svg>
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}

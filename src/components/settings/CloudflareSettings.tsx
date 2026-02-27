import { createSignal, For, Show } from "solid-js";
import { useI18n } from "../../i18n";
import {
  deleteCloudflareConfig,
  saveCloudflareConfig,
  setCloudflareConnection,
} from "../../lib/tauri";
import { appStore } from "../../stores/app";
import { toastStore } from "../../stores/toast";
import { Button, Switch } from "../ui";

import type { AppConfig, CloudflareConfig } from "../../lib/tauri";

interface CloudflareSettingsProps {
  config: AppConfig;
  setConfig: (updater: (prev: AppConfig) => AppConfig) => void;
}

export function CloudflareSettings(props: CloudflareSettingsProps) {
  const { t } = useI18n();

  // Cloudflare State
  const [cfId, setCfId] = createSignal("");
  const [cfName, setCfName] = createSignal("");
  const [cfToken, setCfToken] = createSignal("");
  const [cfLocalPort, setCfLocalPort] = createSignal(8317);
  const [cfAdding, setCfAdding] = createSignal(false);

  // Cloudflare Handlers
  const handleSaveCf = async () => {
    if (!cfName() || !cfToken()) {
      toastStore.error(t("settings.toasts.nameAndTunnelTokenRequired"));
      return;
    }
    try {
      const cfConfig: CloudflareConfig = {
        enabled: false,
        id: cfId() || crypto.randomUUID(),
        localPort: cfLocalPort(),
        name: cfName(),
        tunnelToken: cfToken(),
      };
      const updated = await saveCloudflareConfig(cfConfig);
      props.setConfig((prev) => ({ ...prev, cloudflareConfigs: updated }));
      setCfId("");
      setCfName("");
      setCfToken("");
      setCfLocalPort(8317);
      setCfAdding(false);
      toastStore.success(t("settings.toasts.cloudflareTunnelSaved"));
    } catch (error) {
      toastStore.error(t("settings.toasts.failedToSave"), String(error));
    }
  };

  const handleDeleteCf = async (id: string) => {
    try {
      const updated = await deleteCloudflareConfig(id);
      props.setConfig((prev) => ({ ...prev, cloudflareConfigs: updated }));
      toastStore.success(t("settings.toasts.tunnelDeleted"));
    } catch (error) {
      toastStore.error(t("settings.toasts.failedToDelete"), String(error));
    }
  };

  const handleToggleCf = async (id: string, enable: boolean) => {
    try {
      await setCloudflareConnection(id, enable);
      const configs = props.config.cloudflareConfigs || [];
      const updated = configs.map((c) => (c.id === id ? { ...c, enabled: enable } : c));
      props.setConfig((prev) => ({ ...prev, cloudflareConfigs: updated }));
    } catch (error) {
      toastStore.error(t("settings.toasts.failedToToggle"), String(error));
    }
  };

  const handleEditCf = (cf: CloudflareConfig) => {
    setCfId(cf.id);
    setCfName(cf.name);
    setCfToken(cf.tunnelToken);
    setCfLocalPort(cf.localPort);
    setCfAdding(true);
  };

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Cloudflare Tunnel</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400">
            Expose your local API via Cloudflare Tunnel
          </p>
        </div>
        <Button
          class="text-sm"
          onClick={() => {
            setCfId("");
            setCfName("");
            setCfToken("");
            setCfLocalPort(8317);
            setCfAdding(true);
          }}
          variant="primary"
        >
          + Add Tunnel
        </Button>
      </div>

      {/* Existing Tunnels */}
      <For each={props.config.cloudflareConfigs || []}>
        {(cf) => {
          const status = () => appStore.cloudflareStatus()[cf.id];
          return (
            <div class="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div
                    class={`h-3 w-3 rounded-full ${
                      status()?.status === "connected"
                        ? "bg-green-500"
                        : status()?.status === "connecting"
                          ? "animate-pulse bg-yellow-500"
                          : status()?.status === "error"
                            ? "bg-red-500"
                            : "bg-gray-400"
                    }`}
                  />
                  <div>
                    <p class="font-medium text-gray-900 dark:text-white">{cf.name}</p>
                    <p class="text-xs text-gray-500">
                      Port {cf.localPort} •{" "}
                      {status()?.message || (cf.enabled ? "Enabled" : "Disabled")}
                    </p>
                    <Show when={status()?.url}>
                      <p class="mt-1 text-xs text-blue-500">{status()?.url}</p>
                    </Show>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <Switch checked={cf.enabled} onChange={(v) => handleToggleCf(cf.id, v)} />
                  <button
                    class="p-2 text-gray-400 transition-colors hover:text-blue-500"
                    onClick={() => handleEditCf(cf)}
                    title="Edit"
                    type="button"
                  >
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                      />
                    </svg>
                  </button>
                  <button
                    class="p-2 text-gray-400 transition-colors hover:text-red-500"
                    onClick={() => handleDeleteCf(cf.id)}
                    title="Delete"
                    type="button"
                  >
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          );
        }}
      </For>

      {/* Add/Edit Form */}
      <Show when={cfAdding()}>
        <div class="space-y-4 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
          <div class="flex items-center justify-between">
            <h3 class="font-medium text-blue-900 dark:text-blue-100">
              {cfId() ? "Edit Tunnel" : "New Tunnel"}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600"
              onClick={() => setCfAdding(false)}
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
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-1">
              <label class="text-xs font-medium uppercase text-gray-500">Name</label>
              <input
                class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                onInput={(e) => setCfName(e.currentTarget.value)}
                placeholder="My Tunnel"
                value={cfName()}
              />
            </div>
            <div class="space-y-1">
              <label class="text-xs font-medium uppercase text-gray-500">
                Local Port (Reference)
              </label>
              <input
                class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                onInput={(e) => setCfLocalPort(Number.parseInt(e.currentTarget.value) || 8317)}
                placeholder="8317"
                type="number"
                value={cfLocalPort()}
              />
              <p class="text-[10px] text-gray-400">Configure actual port in Cloudflare dashboard</p>
            </div>
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium uppercase text-gray-500">Tunnel Token</label>
            <input
              class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              onInput={(e) => setCfToken(e.currentTarget.value)}
              placeholder="eyJ..."
              type="password"
              value={cfToken()}
            />
            <p class="text-[10px] text-gray-400">
              Get token from Cloudflare Zero Trust Dashboard → Access → Tunnels
            </p>
          </div>
          <div class="pt-2">
            <Button class="w-full sm:w-auto" onClick={handleSaveCf} variant="primary">
              {cfId() ? "Update Tunnel" : "Add Tunnel"}
            </Button>
          </div>
        </div>
      </Show>

      {/* Help Section */}
      <div class="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <h3 class="mb-2 font-medium text-gray-900 dark:text-white">
          How to set up Cloudflare Tunnel
        </h3>
        <ol class="list-inside list-decimal space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <li>
            Install <code class="rounded bg-gray-200 px-1 dark:bg-gray-700">cloudflared</code> on
            your system
          </li>
          <li>
            Go to{" "}
            <a
              class="text-blue-500 hover:underline"
              href="https://one.dash.cloudflare.com/"
              rel="noopener noreferrer"
              target="_blank"
            >
              Cloudflare Zero Trust Dashboard
            </a>{" "}
            → Networks → Tunnels
          </li>
          <li>{t("settings.cloudflare.instructions.createTunnel")}</li>
          <li>
            <strong class="text-gray-900 dark:text-white">
              {t("settings.cloudflare.instructions.important")}
            </strong>{" "}
            {t("settings.cloudflare.instructions.configurePrefix")}{" "}
            <strong>{t("settings.cloudflare.instructions.publicHostname")}</strong>{" "}
            {t("settings.cloudflare.instructions.configureSuffix")}
            <ul class="ml-4 mt-1 list-inside list-disc space-y-1">
              <li>
                Subdomain: your choice (e.g.,{" "}
                <code class="rounded bg-gray-200 px-1 dark:bg-gray-700">proxy</code>)
              </li>
              <li>{t("settings.cloudflare.instructions.domain")}</li>
              <li>
                Service Type: <code class="rounded bg-gray-200 px-1 dark:bg-gray-700">HTTP</code>
              </li>
              <li>
                URL: <code class="rounded bg-gray-200 px-1 dark:bg-gray-700">localhost:8317</code>{" "}
                (or your proxy port)
              </li>
            </ul>
          </li>
          <li>{t("settings.cloudflare.instructions.enableTunnel")}</li>
        </ol>
        <p class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">
          <strong>{t("settings.cloudflare.instructions.note")}</strong>{" "}
          {t("settings.cloudflare.instructions.noteText")}
        </p>
      </div>
    </div>
  );
}

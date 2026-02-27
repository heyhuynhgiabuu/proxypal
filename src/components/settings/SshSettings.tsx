import { open } from "@tauri-apps/plugin-dialog";
import { createMemo, createSignal, For, Show } from "solid-js";
import { useI18n } from "../../i18n";
import { deleteSshConfig, saveSshConfig, setSshConnection } from "../../lib/tauri";
import { appStore } from "../../stores/app";
import { toastStore } from "../../stores/toast";
import { Button, Switch } from "../ui";

import type { AppConfig, SshConfig } from "../../lib/tauri";

interface SshSettingsProps {
  config: AppConfig;
  setConfig: (updater: (prev: AppConfig) => AppConfig) => void;
}

export function SshSettings(props: SshSettingsProps) {
  const { t } = useI18n();

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
        filters: [{ extensions: ["*"], name: "All Files" }],
        multiple: false,
      });
      if (file) {
        setSshKey(file as string);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleSaveSsh = async () => {
    if (!sshHost() || !sshUser()) {
      toastStore.error(t("settings.toasts.hostAndUsernameRequired"));
      return;
    }

    setSshAdding(true);
    try {
      const newConfig: SshConfig = {
        enabled: false,
        host: sshHost(),
        id: sshId() || crypto.randomUUID(),
        keyFile: sshKey() || undefined,
        localPort: sshLocal(),
        password: sshPass() || undefined,
        port: sshPort(),
        remotePort: sshRemote(),
        username: sshUser(),
      };

      const updated = await saveSshConfig(newConfig);
      props.setConfig((prev) => ({ ...prev, sshConfigs: updated }));

      // Reset form
      handleCancelEdit();
      toastStore.success(t("settings.toasts.connectionSaved"));
    } catch (error) {
      toastStore.error(t("settings.toasts.failedToSave"), String(error));
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
    if (!confirm(t("settings.confirm.deleteConnection"))) {
      return;
    }
    try {
      const updated = await deleteSshConfig(id);
      props.setConfig((prev) => ({ ...prev, sshConfigs: updated }));
    } catch (error) {
      toastStore.error(t("settings.toasts.failedToDelete"), String(error));
    }
  };

  const handleToggleSsh = async (id: string, enable: boolean) => {
    try {
      await setSshConnection(id, enable);
      // Updating local config to reflect target state immediately for UI responsiveness
      const configs = props.config.sshConfigs || [];
      const updated = configs.map((c) => (c.id === id ? { ...c, enabled: enable } : c));
      props.setConfig((prev) => ({ ...prev, sshConfigs: updated }));
    } catch (error) {
      toastStore.error(t("settings.toasts.failedToToggle"), String(error));
    }
  };

  return (
    <div class="space-y-4">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
        SSH API Connections
      </h2>
      <p class="text-sm text-gray-500 dark:text-gray-400">
        Securely tunnel your local API (port 8317) to a remote server for shared access.
      </p>

      {/* List */}
      <div class="space-y-3">
        <For each={props.config.sshConfigs || []}>
          {(ssh: SshConfig) => {
            const statusProps = createMemo(() => {
              const status = appStore.sshStatus()[ssh.id] || {
                id: ssh.id,
                message: undefined,
                status: ssh.enabled ? "connecting" : "disconnected",
              };

              let displayStatus = status.status;
              const displayMessage = status.message;

              if (ssh.enabled) {
                if (!displayStatus || displayStatus === "disconnected") {
                  displayStatus = "connecting";
                }
              } else {
                if (displayStatus === "connected" || displayStatus === "connecting") {
                  displayStatus = "disconnected";
                }
              }
              return { message: displayMessage, status: displayStatus };
            });

            return (
              <div class="flex flex-col justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50 sm:flex-row sm:items-center">
                <div>
                  <div class="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
                    <span>
                      {ssh.username}@{ssh.host}:{ssh.port}
                    </span>
                  </div>
                  <div class="mt-1 text-xs text-gray-500">
                    Forward: Remote :{ssh.remotePort} &rarr; Local :{ssh.localPort}
                  </div>
                  <Show when={statusProps().message}>
                    <div
                      class={`mt-1 flex items-start gap-1 break-all text-xs ${
                        statusProps().status === "error" ? "text-red-500" : "text-gray-500"
                      }`}
                    >
                      <span class="opacity-75">&gt;</span>
                      <span>{statusProps().message}</span>
                    </div>
                  </Show>
                </div>
                <div class="flex items-center gap-4">
                  <div class="flex items-center gap-2">
                    <div
                      class={`h-2.5 w-2.5 rounded-full ${
                        statusProps().status === "connected"
                          ? "bg-green-500"
                          : statusProps().status === "error"
                            ? "bg-red-500"
                            : statusProps().status === "connecting" ||
                                statusProps().status === "reconnecting"
                              ? "animate-pulse bg-orange-500"
                              : "bg-gray-400"
                      }`}
                    />
                    <span class="min-w-[50px] text-sm font-medium capitalize text-gray-600 dark:text-gray-400">
                      {statusProps().status}
                    </span>
                  </div>
                  <div class="h-6 w-px bg-gray-200 dark:bg-gray-700"></div>
                  <Switch checked={ssh.enabled} onChange={(val) => handleToggleSsh(ssh.id, val)} />
                  <button
                    class="rounded p-2 text-blue-500 transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/20"
                    onClick={() => handleEditSsh(ssh)}
                    title="Edit Connection"
                  >
                    <svg
                      class="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
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
                    class="rounded p-2 text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                    onClick={() => handleDeleteSsh(ssh.id)}
                    title="Delete Connection"
                  >
                    <svg
                      class="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
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
              </div>
            );
          }}
        </For>
        <Show when={(props.config.sshConfigs || []).length === 0}>
          <div class="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 py-8 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-800/30 dark:text-gray-400">
            No SSH connections configured
          </div>
        </Show>
      </div>

      {/* Add Form */}
      <div class="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <h3 class="font-medium text-gray-900 dark:text-gray-100">
            {sshId() ? "Edit Connection" : "Add New Connection"}
          </h3>
          <Show when={sshId()}>
            <button
              class="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              onClick={handleCancelEdit}
            >
              Cancel Edit
            </button>
          </Show>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="space-y-1">
            <label class="text-xs font-medium uppercase text-gray-500">Host / IP</label>
            <input
              class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-all focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              onInput={(e) => setSshHost(e.currentTarget.value)}
              placeholder="e.g. 192.168.1.1 or vps.example.com"
              value={sshHost()}
            />
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium uppercase text-gray-500">Port</label>
            <input
              class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-all focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              onInput={(e) => setSshPort(Number.parseInt(e.currentTarget.value) || 22)}
              placeholder="22"
              type="number"
              value={sshPort()}
            />
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium uppercase text-gray-500">Username</label>
            <input
              class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-all focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              onInput={(e) => setSshUser(e.currentTarget.value)}
              placeholder="root"
              value={sshUser()}
            />
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium uppercase text-gray-500">
              Password (Not Supported)
            </label>
            <input
              class="w-full cursor-not-allowed rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
              disabled
              onInput={(e) => setSshPass(e.currentTarget.value)}
              placeholder="Password auth not supported - Use Key File"
              type="password"
              value={sshPass()}
            />
            <p class="text-[10px] text-orange-500">
              Note: Password authentication is not supported. Please use a Private Key file.
            </p>
          </div>
          <div class="col-span-1 space-y-1 sm:col-span-2">
            <label class="text-xs font-medium uppercase text-gray-500">Private Key File</label>
            <div class="flex gap-2">
              <input
                class="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-all focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                onInput={(e) => setSshKey(e.currentTarget.value)}
                placeholder="/path/to/private_key"
                value={sshKey()}
              />
              <button
                class="rounded-lg bg-gray-200 px-3 py-2 text-sm font-medium transition-colors hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600"
                onClick={handlePickKeyFile}
              >
                Browse
              </button>
            </div>
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium uppercase text-gray-500">Remote Port (VPS)</label>
            <input
              class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-all focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              onInput={(e) => setSshRemote(Number.parseInt(e.currentTarget.value) || 0)}
              placeholder="8317"
              type="number"
              value={sshRemote()}
            />
            <p class="text-[10px] text-gray-400">Port to open on the remote server</p>
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium uppercase text-gray-500">Local Port (This App)</label>
            <input
              class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-all focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              onInput={(e) => setSshLocal(Number.parseInt(e.currentTarget.value) || 0)}
              placeholder="8317"
              type="number"
              value={sshLocal()}
            />
            <p class="text-[10px] text-gray-400">Port running locally (default 8317)</p>
          </div>
        </div>
        <div class="pt-2">
          <Button
            class="w-full sm:w-auto"
            loading={sshAdding()}
            onClick={handleSaveSsh}
            variant="primary"
          >
            {sshId() ? "Update Connection" : "Add Connection"}
          </Button>
        </div>
      </div>
    </div>
  );
}

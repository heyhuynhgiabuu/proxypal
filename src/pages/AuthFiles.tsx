import { open } from "@tauri-apps/plugin-dialog";
import { createEffect, createSignal, For, Show } from "solid-js";
import { EmptyState } from "../components/EmptyState";
import { Button } from "../components/ui";
import { useI18n } from "../i18n";
import {
  type AuthFile,
  deleteAllAuthFiles,
  deleteAuthFile,
  downloadAuthFile,
  getAuthFiles,
  refreshAuthStatus,
  toggleAuthFile,
  uploadAuthFile,
} from "../lib/tauri";
import { appStore } from "../stores/app";
import { toastStore } from "../stores/toast";

// Provider color mapping
const providerColors: Record<string, string> = {
  antigravity: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  claude: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  codex: "bg-green-500/20 text-green-400 border-green-500/30",
  gemini: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  iflow: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  kiro: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  qwen: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  vertex: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

// Provider icons
const providerIcons: Record<string, string> = {
  antigravity: "/logos/antigravity.webp",
  claude: "/logos/claude.svg",
  codex: "/logos/openai.svg",
  gemini: "/logos/gemini.svg",
  "gemini-cli": "/logos/gemini.svg",
  iflow: "/logos/iflow.svg",
  kiro: "/logos/kiro.svg",
  qwen: "/logos/qwen.svg",
  vertex: "/logos/vertex.svg",
};

export function AuthFilesPage() {
  const { t } = useI18n();
  const { proxyStatus, setCurrentPage } = appStore;
  const [files, setFiles] = createSignal<AuthFile[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [filter, setFilter] = createSignal<string>("all");
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = createSignal(false);
  const [fileToDelete, setFileToDelete] = createSignal<AuthFile | null>(null);
  const [testingProvider, setTestingProvider] = createSignal<string | null>(null);

  // Load auth files on mount and when proxy status changes
  createEffect(() => {
    if (proxyStatus().running) {
      loadFiles();
    } else {
      setFiles([]);
    }
  });

  const loadFiles = async () => {
    setLoading(true);
    try {
      const result = await getAuthFiles();
      setFiles(result);
    } catch (error) {
      toastStore.error(t("authFiles.toasts.failedToLoadAuthFiles"), String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    try {
      const selected = await open({
        filters: [{ extensions: ["json"], name: "JSON" }],
        multiple: false,
      });

      if (selected) {
        // Try to detect provider from filename
        const filename = selected.split("/").pop() || "";
        let provider = "claude"; // default

        if (filename.includes("gemini")) {
          provider = "gemini";
        } else if (filename.includes("codex")) {
          provider = "codex";
        } else if (filename.includes("qwen")) {
          provider = "qwen";
        } else if (filename.includes("iflow")) {
          provider = "iflow";
        } else if (filename.includes("vertex")) {
          provider = "vertex";
        } else if (filename.includes("kiro")) {
          provider = "kiro";
        } else if (filename.includes("antigravity")) {
          provider = "antigravity";
        }

        await uploadAuthFile(selected, provider);
        toastStore.success(t("authFiles.toasts.authFileUploadedSuccessfully"));
        loadFiles();
      }
    } catch (error) {
      toastStore.error(t("authFiles.toasts.failedToUploadFile"), String(error));
    }
  };

  const handleTestConnection = async (file: AuthFile) => {
    const p = file.provider.toLowerCase();

    // Kiro: test via kiro-cli chat --no-interactive "/usage" instead of proxy
    if (p.includes("kiro")) {
      setTestingProvider(file.name);
      try {
        const { testKiroConnection } = await import("../lib/tauri");
        const result = await testKiroConnection();
        if (result.success) {
          toastStore.success(
            t("authFiles.toasts.kiroConnectionOk", {
              latency: result.latencyMs != null ? ` (${result.latencyMs}ms)` : "",
            }),
          );
        } else {
          toastStore.error(t("authFiles.toasts.kiroTestFailed"), result.message);
        }
      } catch (error: unknown) {
        toastStore.error(t("authFiles.toasts.testFailed"), String(error));
      } finally {
        setTestingProvider(null);
      }
      return;
    }

    // Determine a model to test with based on provider
    // Using ProxyPal's model IDs that map to each provider's auth
    let modelId: string | null = null;
    if (p.includes("claude")) {
      modelId = "gemini-claude-sonnet-4-5";
    } else if (p.includes("gemini") || p.includes("vertex")) {
      modelId = "gemini-2.5-flash";
    } else if (p.includes("codex")) {
      modelId = "gpt-5.1-codex-mini";
    } else if (p.includes("qwen")) {
      modelId = "glm-4.5";
    } else if (p.includes("deepseek")) {
      modelId = "deepseek-chat";
    } else if (p.includes("iflow")) {
      modelId = "gemini-claude-sonnet-4-5";
    } else if (p.includes("antigravity")) {
      modelId = "gemini-2.5-flash";
    }

    if (!modelId) {
      toastStore.error(
        t("authFiles.toasts.unknownProviderCannotDetermineTestModel", {
          provider: file.provider,
        }),
      );
      return;
    }

    setTestingProvider(file.name);
    try {
      const { testProviderConnection } = await import("../lib/tauri");
      const result = await testProviderConnection(modelId);
      if (result.success) {
        toastStore.success(
          t("authFiles.toasts.connectionToProviderSuccessful", {
            latency: result.latencyMs ?? "-",
            provider: file.provider,
          }),
        );
      } else {
        toastStore.error(t("authFiles.toasts.connectionFailed"), result.message);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toastStore.error(t("authFiles.toasts.testFailed"), message);
    } finally {
      setTestingProvider(null);
    }
  };

  const handleDelete = async (file: AuthFile) => {
    setFileToDelete(file);
  };

  const confirmDelete = async () => {
    const file = fileToDelete();
    if (!file) {
      return;
    }

    try {
      await deleteAuthFile(file.id);
      toastStore.success(t("authFiles.toasts.authFileDeleted"));
      setFileToDelete(null);
      // Refresh both file list and global auth status
      loadFiles();
      const newAuthStatus = await refreshAuthStatus();
      appStore.setAuthStatus(newAuthStatus);
    } catch (error) {
      toastStore.error(t("authFiles.toasts.failedToDelete"), String(error));
    }
  };

  const handleToggle = async (file: AuthFile) => {
    try {
      // Optimistic UI update
      setFiles((prev) =>
        prev.map((f) => {
          if (f.id === file.id) {
            return { ...f, disabled: !file.disabled };
          }
          return f;
        }),
      );

      await toggleAuthFile(file.name, !file.disabled);

      // Refresh auth status in background to ensure syncing
      const newAuthStatus = await refreshAuthStatus();
      appStore.setAuthStatus(newAuthStatus);
    } catch (error) {
      // Revert on error
      setFiles((prev) =>
        prev.map((f) => {
          if (f.id === file.id) {
            return { ...f, disabled: file.disabled };
          }
          return f;
        }),
      );
      toastStore.error(t("authFiles.toasts.failedToToggleFile"), String(error));
    }
  };

  const handleDownload = async (file: AuthFile) => {
    try {
      const path = await downloadAuthFile(file.id, file.name);
      toastStore.success(t("authFiles.toasts.downloadedTo", { path }));
    } catch (error) {
      toastStore.error(t("authFiles.toasts.failedToDownload"), String(error));
    }
  };

  const handleDeleteAll = async () => {
    try {
      await deleteAllAuthFiles();
      toastStore.success(t("authFiles.toasts.allAuthFilesDeleted"));
      setShowDeleteAllConfirm(false);
      // Refresh both file list and global auth status
      loadFiles();
      const newAuthStatus = await refreshAuthStatus();
      appStore.setAuthStatus(newAuthStatus);
    } catch (error) {
      toastStore.error(t("authFiles.toasts.failedToDeleteAll"), String(error));
    }
  };

  const filteredFiles = () => {
    const f = filter();
    if (f === "all") {
      return files();
    }
    return files().filter((file) => file.provider.toLowerCase() === f);
  };

  const providers = () => {
    const unique = new Set(files().map((f) => f.provider.toLowerCase()));
    return Array.from(unique).sort();
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) {
      return "-";
    }
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) {
      return "-";
    }
    const date = new Date(dateStr);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  };

  return (
    <div class="flex min-h-screen flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <header class="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900 sm:px-6 sm:py-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 sm:gap-3">
            <Button onClick={() => setCurrentPage("settings")} size="sm" variant="ghost">
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  d="M15 19l-7-7 7-7"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </svg>
            </Button>
            <h1 class="text-lg font-bold text-gray-900 dark:text-gray-100">
              {t("authFiles.title")}
            </h1>
            <Show when={loading()}>
              <span class="ml-2 flex items-center gap-1 text-xs text-gray-400">
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
                {t("common.loading")}
              </span>
            </Show>
          </div>

          <div class="flex items-center gap-2">
            <Show when={files().length > 0}>
              <Button
                class="text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                onClick={() => setShowDeleteAllConfirm(true)}
                size="sm"
                variant="ghost"
              >
                {t("authFiles.actions.deleteAll")}
              </Button>
            </Show>
            <Button onClick={handleUpload} size="sm" variant="primary">
              <svg class="mr-1.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  d="M12 4v16m8-8H4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </svg>
              {t("authFiles.actions.upload")}
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main class="flex flex-1 flex-col overflow-y-auto p-4 sm:p-6">
        <div class="mx-auto flex w-full max-w-2xl flex-1 flex-col">
          {/* Proxy not running warning */}
          <Show when={!proxyStatus().running}>
            <EmptyState
              description={t("authFiles.startProxyDescription")}
              icon={
                <svg class="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.5"
                  />
                </svg>
              }
              title={t("authFiles.proxyNotRunning")}
            />
          </Show>

          <Show when={proxyStatus().running}>
            {/* Filter Tabs */}
            <Show when={files().length > 0}>
              <div class="mb-4 flex flex-wrap items-center gap-2">
                <button
                  class={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    filter() === "all"
                      ? "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                  }`}
                  onClick={() => setFilter("all")}
                >
                  {t("authFiles.filters.all", { count: files().length })}
                </button>
                <For each={providers()}>
                  {(provider) => (
                    <button
                      class={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        filter() === provider
                          ? "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100"
                          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                      }`}
                      onClick={() => setFilter(provider)}
                    >
                      <img
                        alt={provider}
                        class="h-4 w-4"
                        src={
                          providerIcons[provider] ||
                          providerIcons[provider.toLowerCase()] ||
                          "/logos/openai.svg"
                        }
                      />
                      {provider.charAt(0).toUpperCase() + provider.slice(1)} (
                      {files().filter((f) => f.provider.toLowerCase() === provider).length})
                    </button>
                  )}
                </For>
              </div>
            </Show>

            {/* Empty State */}
            <Show when={files().length === 0 && !loading()}>
              <EmptyState
                action={{
                  label: t("authFiles.actions.uploadAuthFile"),
                  onClick: handleUpload,
                }}
                description={t("authFiles.noAuthFilesDescription")}
                icon={
                  <svg class="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="1.5"
                    />
                  </svg>
                }
                title={t("authFiles.noAuthFiles")}
              />
            </Show>

            {/* Files List */}
            <Show when={filteredFiles().length > 0}>
              <div class="space-y-3">
                <For each={filteredFiles()}>
                  {(file) => (
                    <div
                      class={`rounded-xl border p-4 transition-colors ${
                        file.disabled
                          ? "border-gray-200 bg-gray-50 opacity-60 dark:border-gray-700 dark:bg-gray-800/30"
                          : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50"
                      }`}
                    >
                      <div class="flex items-start justify-between gap-4">
                        {/* Left: Info */}
                        <div class="flex min-w-0 flex-1 items-start gap-3">
                          {/* Provider Icon */}
                          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
                            <img
                              alt={file.provider}
                              class="h-6 w-6"
                              src={
                                providerIcons[file.provider.toLowerCase()] ||
                                providerIcons[file.provider] ||
                                "/logos/openai.svg"
                              }
                            />
                          </div>

                          <div class="min-w-0 flex-1">
                            <div class="flex flex-wrap items-center gap-2">
                              <span class="truncate font-medium text-gray-900 dark:text-gray-100">
                                {file.name}
                              </span>
                              <span
                                class={`rounded border px-2 py-0.5 text-xs font-medium ${
                                  providerColors[file.provider.toLowerCase()] ||
                                  "border-gray-200 bg-gray-100 text-gray-600 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400"
                                }`}
                              >
                                {file.provider}
                              </span>
                              <Show when={file.status === "error"}>
                                <span class="rounded border border-red-200 bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
                                  {t("common.error")}
                                </span>
                              </Show>
                              <Show when={file.disabled}>
                                <span class="rounded border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400">
                                  {t("common.disabled")}
                                </span>
                              </Show>
                            </div>

                            <div class="mt-1.5 flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                              <Show when={file.email}>
                                <span class="flex items-center gap-1">
                                  <svg
                                    class="h-3.5 w-3.5"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                      stroke-width="2"
                                    />
                                  </svg>
                                  {file.email}
                                </span>
                              </Show>
                              <Show when={file.size}>
                                <span>{formatSize(file.size)}</span>
                              </Show>
                              <Show when={file.modtime}>
                                <span>{formatDate(file.modtime)}</span>
                              </Show>
                            </div>

                            <Show when={file.statusMessage}>
                              <div class="mt-2 text-sm text-red-600 dark:text-red-400">
                                {file.statusMessage}
                              </div>
                            </Show>

                            <div class="mt-4 flex items-center gap-2">
                              <button
                                class={`transition-smooth flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
                                  testingProvider() === file.name
                                    ? "cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-700"
                                    : "border border-brand-200/50 bg-brand-50 text-brand-600 hover:bg-brand-100 dark:border-brand-800/50 dark:bg-brand-900/20 dark:text-brand-400 dark:hover:bg-brand-900/30"
                                }`}
                                disabled={testingProvider() === file.name || file.disabled}
                                onClick={() => handleTestConnection(file)}
                                type="button"
                              >
                                <Show
                                  fallback={
                                    <svg
                                      class="h-3.5 w-3.5"
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
                                  when={testingProvider() === file.name}
                                >
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
                                </Show>
                                {testingProvider() === file.name
                                  ? t("authFiles.actions.testing")
                                  : t("authFiles.actions.testConnection")}
                              </button>
                            </div>

                            {/* Stats */}
                            <Show
                              when={
                                file.successCount !== undefined || file.failureCount !== undefined
                              }
                            >
                              <div class="mt-2 flex items-center gap-4 text-xs">
                                <Show when={file.successCount !== undefined}>
                                  <span class="text-green-600 dark:text-green-400">
                                    {t("authFiles.stats.successCount", {
                                      count: file.successCount || 0,
                                    })}
                                  </span>
                                </Show>
                                <Show
                                  when={file.failureCount !== undefined && file.failureCount > 0}
                                >
                                  <span class="text-red-600 dark:text-red-400">
                                    {t("authFiles.stats.failedCount", {
                                      count: file.failureCount || 0,
                                    })}
                                  </span>
                                </Show>
                              </div>
                            </Show>
                          </div>
                        </div>

                        {/* Right: Actions */}
                        <div class="flex shrink-0 items-center gap-1">
                          <button
                            class="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                            onClick={() => handleDownload(file)}
                            title={t("authFiles.actions.download")}
                          >
                            <svg
                              class="h-5 w-5"
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
                          </button>
                          <button
                            class={`rounded-lg p-2 transition-colors ${
                              file.disabled
                                ? "text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                                : "text-blue-500 hover:bg-blue-50 hover:text-blue-600 dark:text-blue-400 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"
                            }`}
                            onClick={() => handleToggle(file)}
                            title={
                              file.disabled
                                ? t("authFiles.actions.enable")
                                : t("authFiles.actions.disable")
                            }
                          >
                            <Show when={!file.disabled}>
                              <svg
                                class="h-5 w-5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
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
                            </Show>
                            <Show when={file.disabled}>
                              <svg
                                class="h-5 w-5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                />
                              </svg>
                            </Show>
                          </button>
                          <button
                            class="rounded-lg p-2 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-gray-400 dark:hover:bg-red-900/20"
                            onClick={() => handleDelete(file)}
                            title={t("authFiles.actions.delete")}
                          >
                            <svg
                              class="h-5 w-5"
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
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </main>

      {/* Delete All Confirmation Modal */}
      <Show when={showDeleteAllConfirm()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div class="mx-4 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-800">
            <h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("authFiles.modals.deleteAllTitle")}
            </h3>
            <p class="mb-6 text-gray-600 dark:text-gray-400">
              {t("authFiles.modals.deleteAllDescription", {
                count: files().length,
              })}
            </p>
            <div class="flex justify-end gap-3">
              <Button onClick={() => setShowDeleteAllConfirm(false)} variant="ghost">
                {t("common.cancel")}
              </Button>
              <Button
                class="bg-red-500 hover:bg-red-600"
                onClick={handleDeleteAll}
                variant="primary"
              >
                {t("authFiles.actions.deleteAll")}
              </Button>
            </div>
          </div>
        </div>
      </Show>

      {/* Delete Single File Confirmation Modal */}
      <Show when={fileToDelete()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div class="mx-4 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-800">
            <h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("authFiles.modals.deleteSingleTitle")}
            </h3>
            <p class="mb-6 text-gray-600 dark:text-gray-400">
              {t("authFiles.modals.deletePrefix")}{" "}
              <span class="font-medium text-gray-900 dark:text-gray-100">
                {fileToDelete()?.name}
              </span>
              ? {t("authFiles.modals.deleteSingleDescription")}
            </p>
            <div class="flex justify-end gap-3">
              <Button onClick={() => setFileToDelete(null)} variant="ghost">
                {t("common.cancel")}
              </Button>
              <Button class="bg-red-500 hover:bg-red-600" onClick={confirmDelete} variant="primary">
                {t("authFiles.actions.delete")}
              </Button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

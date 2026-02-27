import { createSignal, For, Show } from "solid-js";
import {
  ClaudeKeysTab,
  CodexKeysTab,
  GeminiKeysTab,
  OpenAICompatibleTab,
  VertexKeysTab,
} from "../components/api-keys";
import { Button } from "../components/ui";
import { useI18n } from "../i18n";
import { appStore } from "../stores/app";

type TabId = "gemini" | "claude" | "codex" | "openai-compatible" | "vertex";

interface Tab {
  icon: string;
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { icon: "/logos/gemini.svg", id: "gemini", label: "Gemini" },
  { icon: "/logos/claude.svg", id: "claude", label: "Claude" },
  { icon: "/logos/openai.svg", id: "codex", label: "Codex" },
  { icon: "/logos/openai.svg", id: "openai-compatible", label: "OpenAI" },
  { icon: "/logos/vertex.svg", id: "vertex", label: "Vertex" },
];

export function ApiKeysPage() {
  const { t } = useI18n();
  const { proxyStatus, setCurrentPage } = appStore;
  const [activeTab, setActiveTab] = createSignal<TabId>("gemini");
  const [loading, setLoading] = createSignal(false);
  const [showAddForm, setShowAddForm] = createSignal(false);

  return (
    <div class="flex min-h-screen flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <header class="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900 sm:px-6 sm:py-4">
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
          <h1 class="text-lg font-bold text-gray-900 dark:text-gray-100">{t("apiKeys.title")}</h1>
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
      </header>

      {/* Proxy not running warning */}
      <Show when={!proxyStatus().running}>
        <div class="mx-4 mt-4 rounded-xl border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20 sm:mx-6">
          <div class="flex items-center gap-3">
            <svg
              class="h-5 w-5 text-yellow-600 dark:text-yellow-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
            <div>
              <p class="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                {t("apiKeys.proxyNotRunning")}
              </p>
              <p class="mt-0.5 text-xs text-yellow-600 dark:text-yellow-400">
                {t("apiKeys.startProxyServerDescription")}
              </p>
            </div>
          </div>
        </div>
      </Show>

      {/* Main content */}
      <main class="flex flex-1 flex-col overflow-y-auto p-4 sm:p-6">
        <div class="mx-auto max-w-2xl space-y-4 sm:space-y-6">
          {/* Tabs */}
          <div class="flex gap-1 rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-gray-700 dark:bg-gray-800/50">
            <For each={TABS}>
              {(tab) => (
                <button
                  class={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                    activeTab() === tab.id
                      ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                      : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                  }`}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setShowAddForm(false);
                  }}
                >
                  <img alt="" class="h-4 w-4" src={tab.icon} />
                  <span class="hidden sm:inline">{tab.label}</span>
                </button>
              )}
            </For>
          </div>

          {/* Info text */}
          <p class="text-xs text-gray-500 dark:text-gray-400">{t("apiKeys.description")}</p>

          <Show when={activeTab() === "gemini"}>
            <GeminiKeysTab
              loading={loading}
              setLoading={setLoading}
              setShowAddForm={setShowAddForm}
              showAddForm={showAddForm}
            />
          </Show>

          <Show when={activeTab() === "claude"}>
            <ClaudeKeysTab
              loading={loading}
              setLoading={setLoading}
              setShowAddForm={setShowAddForm}
              showAddForm={showAddForm}
            />
          </Show>

          <Show when={activeTab() === "codex"}>
            <CodexKeysTab
              loading={loading}
              setLoading={setLoading}
              setShowAddForm={setShowAddForm}
              showAddForm={showAddForm}
            />
          </Show>

          <Show when={activeTab() === "vertex"}>
            <VertexKeysTab
              loading={loading}
              setLoading={setLoading}
              setShowAddForm={setShowAddForm}
              showAddForm={showAddForm}
            />
          </Show>

          <Show when={activeTab() === "openai-compatible"}>
            <OpenAICompatibleTab
              loading={loading}
              setLoading={setLoading}
              setShowAddForm={setShowAddForm}
              showAddForm={showAddForm}
            />
          </Show>
        </div>
      </main>
    </div>
  );
}

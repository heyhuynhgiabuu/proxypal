import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { useI18n } from "../i18n";
import { startProxy, stopProxy } from "../lib/tauri";
import { appStore } from "../stores/app";
import { toastStore } from "../stores/toast";

interface Command {
  action: () => void;
  category: "proxy" | "navigation" | "providers";
  icon: string;
  id: string;
  label: string;
  shortcut?: string;
}

// Export signal for external control
const [isOpen, setIsOpen] = createSignal(false);

export function openCommandPalette() {
  setIsOpen(true);
}

export function CommandPalette() {
  const [search, setSearch] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const { t } = useI18n();

  const { proxyStatus, setCurrentPage, setProxyStatus } = appStore;

  // Define commands
  const commands = (): Command[] => [
    {
      action: async () => {
        try {
          if (proxyStatus().running) {
            const status = await stopProxy();
            setProxyStatus(status);
            toastStore.info(t("commandPalette.notifications.proxyStopped"));
          } else {
            const status = await startProxy();
            setProxyStatus(status);
            toastStore.success(t("commandPalette.notifications.proxyStarted"));
          }
        } catch (error) {
          toastStore.error(t("commandPalette.notifications.toggleFailed"), String(error));
        }
        setIsOpen(false);
      },
      category: "proxy",
      icon: proxyStatus().running ? "stop" : "play",
      id: "toggle-proxy",
      label: proxyStatus().running
        ? t("commandPalette.commands.stopProxy")
        : t("commandPalette.commands.startProxy"),
      shortcut: "⌘S",
    },
    {
      action: () => {
        setCurrentPage("dashboard");
        setIsOpen(false);
      },
      category: "navigation",
      icon: "home",
      id: "go-dashboard",
      label: t("commandPalette.commands.goDashboard"),
      shortcut: "⌘1",
    },
    {
      action: () => {
        setCurrentPage("api-keys");
        setIsOpen(false);
      },
      category: "navigation",
      icon: "key",
      id: "go-api-keys",
      label: t("commandPalette.commands.goApiKeys"),
      shortcut: "⌘2",
    },
    {
      action: () => {
        setCurrentPage("auth-files");
        setIsOpen(false);
      },
      category: "navigation",
      icon: "file",
      id: "go-auth-files",
      label: t("commandPalette.commands.goAuthFiles"),
      shortcut: "⌘3",
    },
    {
      action: () => {
        setCurrentPage("logs");
        setIsOpen(false);
      },
      category: "navigation",
      icon: "logs",
      id: "go-logs",
      label: t("commandPalette.commands.goLogs"),
      shortcut: "⌘4",
    },
    {
      action: () => {
        setCurrentPage("analytics");
        setIsOpen(false);
      },
      category: "navigation",
      icon: "chart",
      id: "go-analytics",
      label: t("commandPalette.commands.goAnalytics"),
      shortcut: "⌘5",
    },
    {
      action: () => {
        setCurrentPage("settings");
        setIsOpen(false);
      },
      category: "navigation",
      icon: "settings",
      id: "go-settings",
      label: t("commandPalette.commands.goSettings"),
      shortcut: "⌘,",
    },
    {
      action: () => {
        navigator.clipboard.writeText(proxyStatus().endpoint);
        toastStore.success(t("common.copied"));
        setIsOpen(false);
      },
      category: "proxy",
      icon: "copy",
      id: "copy-endpoint",
      label: t("commandPalette.commands.copyApiEndpoint"),
    },
  ];

  // Filter commands based on search
  const filteredCommands = () => {
    const q = search().toLowerCase();
    if (!q) {
      return commands();
    }
    return commands().filter(
      (cmd) => cmd.label.toLowerCase().includes(q) || cmd.category.toLowerCase().includes(q),
    );
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: KeyboardEvent) => {
    // Open palette with Cmd+K
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setIsOpen(true);
      setSearch("");
      setSelectedIndex(0);
      return;
    }

    // Global shortcuts (work even when palette is closed)
    if (e.metaKey || e.ctrlKey) {
      switch (e.key) {
        case "s":
          e.preventDefault();
          commands()
            .find((c) => c.id === "toggle-proxy")
            ?.action();
          break;
        case ",":
          e.preventDefault();
          setCurrentPage("settings");
          break;
        case "1":
          e.preventDefault();
          setCurrentPage("dashboard");
          break;
        case "2":
          e.preventDefault();
          setCurrentPage("api-keys");
          break;
        case "3":
          e.preventDefault();
          setCurrentPage("auth-files");
          break;
        case "4":
          e.preventDefault();
          setCurrentPage("logs");
          break;
        case "5":
          e.preventDefault();
          setCurrentPage("analytics");
          break;
      }
    }

    // Palette-specific navigation
    if (!isOpen()) {
      return;
    }

    switch (e.key) {
      case "Escape":
        setIsOpen(false);
        break;
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredCommands().length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter": {
        e.preventDefault();
        const cmd = filteredCommands()[selectedIndex()];
        if (cmd) {
          cmd.action();
        }
        break;
      }
    }
  };

  // Reset selection when search changes
  createEffect(() => {
    search();
    setSelectedIndex(0);
  });

  // Global keyboard listener
  createEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  const getIcon = (icon: string) => {
    switch (icon) {
      case "play":
        return (
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
            <path
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
        );
      case "stop":
        return (
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
            <path
              d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
        );
      case "home":
        return (
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
        );
      case "settings":
        return (
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
            <path
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
        );
      case "copy":
        return (
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
        );
      case "key":
        return (
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
        );
      case "file":
        return (
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
        );
      case "logs":
        return (
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M4 6h16M4 12h16M4 18h7"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
        );
      case "chart":
        return (
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <Show when={isOpen()}>
      {/* Backdrop */}
      <div
        class="animate-fade-in fixed inset-0 z-50 bg-black/50"
        onClick={() => setIsOpen(false)}
      />

      {/* Modal */}
      <div class="animate-scale-in fixed inset-x-4 top-[20%] z-50 mx-auto max-w-lg">
        <div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
          {/* Search input */}
          <div class="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <svg
              class="h-5 w-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
            <input
              autofocus
              class="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 outline-none dark:text-gray-100"
              onInput={(e) => setSearch(e.currentTarget.value)}
              placeholder={t("commandPalette.placeholder")}
              type="text"
              value={search()}
            />
            <kbd class="hidden rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-400 dark:bg-gray-800 sm:inline-flex">
              esc
            </kbd>
          </div>

          {/* Commands list */}
          <div class="max-h-72 overflow-y-auto py-2">
            <Show
              fallback={
                <div class="px-4 py-8 text-center text-sm text-gray-500">
                  {t("commandPalette.noCommands")}
                </div>
              }
              when={filteredCommands().length > 0}
            >
              <For each={filteredCommands()}>
                {(cmd, index) => (
                  <button
                    class={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      selectedIndex() === index()
                        ? "bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
                        : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                    }`}
                    onClick={() => cmd.action()}
                    onMouseEnter={() => setSelectedIndex(index())}
                  >
                    <span class="text-gray-400">{getIcon(cmd.icon)}</span>
                    <span class="flex-1 text-sm font-medium">{cmd.label}</span>
                    {cmd.shortcut && (
                      <kbd class="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-400 dark:bg-gray-800">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </button>
                )}
              </For>
            </Show>
          </div>

          {/* Footer hint */}
          <div class="border-t border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800/50">
            <div class="flex items-center gap-4 text-xs text-gray-500">
              <span class="flex items-center gap-1">
                <kbd class="rounded bg-gray-200 px-1.5 py-0.5 dark:bg-gray-700">↑↓</kbd>
                {t("commandPalette.navigate")}
              </span>
              <span class="flex items-center gap-1">
                <kbd class="rounded bg-gray-200 px-1.5 py-0.5 dark:bg-gray-700">↵</kbd>
                {t("commandPalette.select")}
              </span>
              <span class="flex items-center gap-1">
                <kbd class="rounded bg-gray-200 px-1.5 py-0.5 dark:bg-gray-700">esc</kbd>
                {t("commandPalette.close")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}

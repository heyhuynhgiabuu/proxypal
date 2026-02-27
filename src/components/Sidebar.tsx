import { type Component, createEffect, createSignal, For, onMount, Show } from "solid-js";
import { useI18n } from "../i18n";
import { checkForUpdates, downloadAndInstallUpdate, saveConfig } from "../lib/tauri";
import { appStore } from "../stores/app";
import { themeStore } from "../stores/theme";
import { toastStore } from "../stores/toast";

type PageId = "dashboard" | "analytics" | "logs" | "api-keys" | "auth-files" | "settings";

interface NavItem {
  icon: Component<{ class?: string }>;
  id: PageId;
}

// Minimal icon components
const DashboardIcon: Component<{ class?: string }> = (props) => (
  <svg class={props.class} fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
    <path d="M9 22V12h6v10" />
  </svg>
);

const AnalyticsIcon: Component<{ class?: string }> = (props) => (
  <svg class={props.class} fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
    <path d="M18 20V10" />
    <path d="M12 20V4" />
    <path d="M6 20v-6" />
  </svg>
);

const LogsIcon: Component<{ class?: string }> = (props) => (
  <svg class={props.class} fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
  </svg>
);

const SettingsIcon: Component<{ class?: string }> = (props) => (
  <svg class={props.class} fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
    <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
);

const ApiKeysIcon: Component<{ class?: string }> = (props) => (
  <svg class={props.class} fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
    <path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
  </svg>
);

const AuthFilesIcon: Component<{ class?: string }> = (props) => (
  <svg class={props.class} fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
    <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
  </svg>
);

const PinIcon: Component<{ class?: string; pinned?: boolean }> = (props) => (
  <svg class={props.class} fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
    {props.pinned ? (
      <path
        d="M12 5V19H19V5H12ZM4 3H20C20.5523 3 21 3.44772 21 4V20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V4C3 3.44772 3.44772 3 4 3Z"
        fill="currentColor"
        stroke="none"
      />
    ) : (
      <path
        d="M12 5V19H19V5H12ZM4 3H20C20.5523 3 21 3.44772 21 4V20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V4C3 3.44772 3.44772 3 4 3Z"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    )}
  </svg>
);

const navItems: NavItem[] = [
  { icon: DashboardIcon, id: "dashboard" },
  { icon: ApiKeysIcon, id: "api-keys" },
  { icon: AuthFilesIcon, id: "auth-files" },
  { icon: LogsIcon, id: "logs" },
  { icon: AnalyticsIcon, id: "analytics" },
  { icon: SettingsIcon, id: "settings" },
];

export const Sidebar: Component = () => {
  const { t } = useI18n();
  const { currentPage, proxyStatus, setCurrentPage, setSidebarExpanded, sidebarExpanded } =
    appStore;
  const [isPinned, setIsPinned] = createSignal(appStore.config().sidebarPinned || false);

  // Persist pinned state
  createEffect(() => {
    const pinned = isPinned();
    if (appStore.config().sidebarPinned !== pinned) {
      appStore.setConfig({
        ...appStore.config(),
        sidebarPinned: pinned,
      });
      saveConfig(appStore.config());
    }
  });

  const [updateAvailable, setUpdateAvailable] = createSignal(false);
  const [updateVersion, setUpdateVersion] = createSignal("");
  const [isUpdating, setIsUpdating] = createSignal(false);

  // Check for updates on mount
  onMount(async () => {
    try {
      const info = await checkForUpdates();
      if (info.available && info.version) {
        setUpdateAvailable(true);
        setUpdateVersion(info.version);
      }
    } catch {
      // Silently ignore update check errors
    }
  });

  const handleUpdate = async () => {
    if (isUpdating()) {
      return;
    }
    setIsUpdating(true);
    try {
      await downloadAndInstallUpdate();
    } catch (error) {
      console.error("Update failed:", error);
      toastStore.error(t("settings.toasts.updateFailed"), String(error));
      setIsUpdating(false);
    }
  };

  const isExpanded = () => isPinned() || sidebarExpanded();

  const isActive = (id: PageId) => {
    const page = currentPage();
    return page === id;
  };

  const handleMouseEnter = () => {
    if (!isPinned()) {
      setSidebarExpanded(true);
    }
  };

  const handleMouseLeave = () => {
    if (!isPinned()) {
      setSidebarExpanded(false);
    }
  };

  const togglePin = () => {
    const newState = !isPinned();
    setIsPinned(newState);
    setSidebarExpanded(newState);
  };

  const getNavLabel = (id: PageId) => {
    switch (id) {
      case "dashboard":
        return t("sidebar.dashboard");
      case "api-keys":
        return t("sidebar.apiKeys");
      case "auth-files":
        return t("sidebar.authFiles");
      case "logs":
        return t("sidebar.logs");
      case "analytics":
        return t("sidebar.analytics");
      case "settings":
        return t("sidebar.settings");
      default:
        return id;
    }
  };

  return (
    <div
      class="fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-gray-200 bg-white transition-all duration-200 dark:border-gray-800 dark:bg-gray-900"
      classList={{
        "w-16": !isExpanded(),
        "w-48": isExpanded(),
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Logo */}
      <div class="flex h-16 items-center justify-center border-b border-gray-200 px-3 dark:border-gray-800">
        <img
          alt="ProxyPal"
          class="h-8 w-8 flex-shrink-0 rounded-lg object-contain"
          src={
            themeStore.resolvedTheme() === "dark" ? "/proxypal-white.png" : "/proxypal-black.png"
          }
        />
        <Show when={isExpanded()}>
          <span class="ml-3 overflow-hidden whitespace-nowrap font-semibold text-gray-900 dark:text-white">
            ProxyPal
          </span>
        </Show>
      </div>

      {/* Proxy Status */}
      <div class="border-b border-gray-200 px-3 py-3.5 dark:border-gray-800">
        <div
          class="flex items-center gap-2 rounded-lg px-2 py-1.5"
          classList={{
            "bg-gray-100 dark:bg-gray-800": !proxyStatus().running,
            "bg-green-50 dark:bg-green-900/20": proxyStatus().running,
          }}
        >
          <div
            class="h-2 w-2 flex-shrink-0 rounded-full"
            classList={{
              "bg-gray-400": !proxyStatus().running,
              "bg-green-500 animate-pulse": proxyStatus().running,
            }}
          />
          <Show when={isExpanded()}>
            <span
              class="overflow-hidden whitespace-nowrap text-xs font-medium"
              classList={{
                "text-gray-500 dark:text-gray-400": !proxyStatus().running,
                "text-green-700 dark:text-green-400": proxyStatus().running,
              }}
            >
              {proxyStatus().running ? t("sidebar.proxyRunning") : t("sidebar.proxyStopped")}
            </span>
          </Show>
        </div>
      </div>

      {/* Pin Toggle - Above Dashboard */}
      <div class="px-2 py-2">
        <button
          class="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 transition-colors"
          classList={{
            "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400": isPinned(),
            "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white":
              !isPinned(),
          }}
          onClick={togglePin}
          title={!isExpanded() ? t("sidebar.pinSidebar") : t("sidebar.unpinSidebar")}
          type="button"
        >
          <PinIcon class="h-5 w-5 flex-shrink-0" pinned={isPinned()} />
          <Show when={isExpanded()}>
            <span class="overflow-hidden whitespace-nowrap text-sm font-medium">
              {isPinned() ? t("sidebar.unpin") : t("sidebar.pin")}
            </span>
          </Show>
        </button>
      </div>

      {/* Navigation */}
      <nav class="flex-1 space-y-1 px-2 py-3">
        <For each={navItems}>
          {(item) => (
            <button
              class="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 transition-colors"
              classList={{
                "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400": isActive(
                  item.id,
                ),
                "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white":
                  !isActive(item.id),
              }}
              onClick={() => setCurrentPage(item.id)}
              title={!isExpanded() ? getNavLabel(item.id) : undefined}
              type="button"
            >
              <item.icon class="h-5 w-5 flex-shrink-0" />
              <Show when={isExpanded()}>
                <span class="overflow-hidden whitespace-nowrap text-sm font-medium">
                  {getNavLabel(item.id)}
                </span>
              </Show>
            </button>
          )}
        </For>
      </nav>

      {/* Update Button - Show when update available */}
      <Show when={updateAvailable()}>
        <div class="border-t border-gray-200 px-2 py-2 dark:border-gray-800">
          <button
            class="flex w-full items-center gap-3 rounded-lg bg-green-50 px-2.5 py-2 text-green-600 transition-colors hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50"
            disabled={isUpdating()}
            onClick={handleUpdate}
            title={!isExpanded() ? t("sidebar.updateTo", { version: updateVersion() }) : undefined}
            type="button"
          >
            <Show
              fallback={
                <svg class="h-5 w-5 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
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
              }
              when={!isUpdating()}
            >
              <svg
                class="h-5 w-5 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                viewBox="0 0 24 24"
              >
                <path
                  d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </Show>
            <Show when={isExpanded()}>
              <span class="overflow-hidden whitespace-nowrap text-sm font-medium">
                {isUpdating()
                  ? t("sidebar.updating")
                  : t("sidebar.updateTo", { version: updateVersion() })}
              </span>
            </Show>
          </button>
        </div>
      </Show>

      {/* Theme Toggle */}
      <div class="border-t border-gray-200 px-2 py-3 dark:border-gray-800">
        <button
          class="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          onClick={() =>
            themeStore.setTheme(themeStore.resolvedTheme() === "dark" ? "light" : "dark")
          }
          title={!isExpanded() ? t("sidebar.toggleTheme") : undefined}
          type="button"
        >
          <Show
            fallback={
              <svg
                class="h-5 w-5 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                viewBox="0 0 24 24"
              >
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            }
            when={themeStore.resolvedTheme() === "dark"}
          >
            <svg
              class="h-5 w-5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          </Show>
          <Show when={isExpanded()}>
            <span class="overflow-hidden whitespace-nowrap text-sm font-medium">
              {themeStore.resolvedTheme() === "dark"
                ? t("sidebar.lightMode")
                : t("sidebar.darkMode")}
            </span>
          </Show>
        </button>
      </div>
    </div>
  );
};

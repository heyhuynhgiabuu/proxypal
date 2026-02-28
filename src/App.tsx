import { Match, onCleanup, onMount, Switch } from "solid-js";
import { CommandPalette } from "./components/CommandPalette";
import { Sidebar } from "./components/Sidebar";
import { ToastContainer } from "./components/ui";
import { useI18n } from "./i18n";
import {
	AnalyticsPage,
	ApiKeysPage,
	AuthFilesPage,
	DashboardPage,
	LogViewerPage,
	SettingsPage,
} from "./pages";
import { appStore } from "./stores/app";
import { themeStore } from "./stores/theme";

function App() {
	const {
		currentPage,
		initialize,
		isLoading,
		retryInitialize,
		setCurrentPage,
		startupError,
		startupState,
	} = appStore;
	const { t } = useI18n();

	onMount(() => {
		void initialize();

		// Listen for navigation events from child components
		const handleNavigateToSettings = (e: Event) => {
			const detail = (e as CustomEvent).detail;
			if (detail?.tab) {
				appStore.setSettingsTab(detail.tab);
			}
			setCurrentPage("settings");
		};
		window.addEventListener("navigate-to-settings", handleNavigateToSettings);
		onCleanup(() => {
			window.removeEventListener(
				"navigate-to-settings",
				handleNavigateToSettings,
			);
		});
	});

	const renderStartupState = () => (
		<div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
			<div class="text-center max-w-xl">
				<div class="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4 animate-pulse">
					<img
						src={
							themeStore.resolvedTheme() === "dark"
								? "/proxypal-white.png"
								: "/proxypal-black.png"
						}
						alt="ProxyPal Logo"
						class="w-16 h-16 rounded-2xl object-contain"
					/>
				</div>

				<Switch>
					<Match when={startupState() === "error"}>
						<div class="space-y-3" role="alert">
							<p class="text-red-600 dark:text-red-400 font-medium">
								ProxyPal failed to start
							</p>
							<p class="text-sm text-gray-600 dark:text-gray-300 break-words">
								{startupError() ?? "Unknown startup error"}
							</p>
							<button
								type="button"
								onClick={() => void retryInitialize()}
								disabled={isLoading()}
								class="px-4 py-2 rounded-lg bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 hover:opacity-90 disabled:opacity-50"
							>
								{isLoading() ? "Retrying..." : "Retry startup"}
							</button>
						</div>
					</Match>
					<Match when={startupState() === "loading"}>
						<p class="text-gray-500 dark:text-gray-400">{t("app.loading")}</p>
					</Match>
				</Switch>
			</div>
		</div>
	);

	return (
		<>
			{startupState() !== "ready" ? (
				renderStartupState()
			) : (
				<>
					<Sidebar />
					<div
						classList={{
							"pl-16": !appStore.sidebarExpanded(),
							"pl-48": appStore.sidebarExpanded(),
						}}
					>
						<Switch fallback={<DashboardPage />}>
							<Match when={currentPage() === "dashboard"}>
								<DashboardPage />
							</Match>
							<Match when={currentPage() === "settings"}>
								<SettingsPage />
							</Match>
							<Match when={currentPage() === "api-keys"}>
								<ApiKeysPage />
							</Match>
							<Match when={currentPage() === "auth-files"}>
								<AuthFilesPage />
							</Match>
							<Match when={currentPage() === "logs"}>
								<LogViewerPage />
							</Match>
							<Match when={currentPage() === "analytics"}>
								<AnalyticsPage />
							</Match>
						</Switch>
					</div>
				</>
			)}
			<ToastContainer />
			<CommandPalette />
		</>
	);
}

export default App;

import { type Component, createSignal, For, Show } from "solid-js";
import { appStore } from "../stores/app";
import { themeStore } from "../stores/theme";

type PageId =
	| "dashboard"
	| "analytics"
	| "logs"
	| "api-keys"
	| "auth-files"
	| "settings";

interface NavItem {
	id: PageId;
	label: string;
	icon: Component<{ class?: string }>;
}

// Minimal icon components
const DashboardIcon: Component<{ class?: string }> = (props) => (
	<svg
		class={props.class}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
	>
		<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
		<path d="M9 22V12h6v10" />
	</svg>
);

const AnalyticsIcon: Component<{ class?: string }> = (props) => (
	<svg
		class={props.class}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
	>
		<path d="M18 20V10M12 20V4M6 20v-6" stroke-linecap="round" />
	</svg>
);

const LogsIcon: Component<{ class?: string }> = (props) => (
	<svg
		class={props.class}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
	>
		<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
		<path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
	</svg>
);

const SettingsIcon: Component<{ class?: string }> = (props) => (
	<svg
		class={props.class}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
	>
		<path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
		<path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
	</svg>
);

const ApiKeysIcon: Component<{ class?: string }> = (props) => (
	<svg
		class={props.class}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
	>
		<path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
	</svg>
);

const AuthFilesIcon: Component<{ class?: string }> = (props) => (
	<svg
		class={props.class}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
	>
		<path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
	</svg>
);

const PinIcon: Component<{ class?: string; pinned?: boolean }> = (props) => (
	<svg
		class={props.class}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
	>
		{props.pinned ? (
			<path
				d="M12 5V19H19V5H12ZM4 3H20C20.5523 3 21 3.44772 21 4V20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V4C3 3.44772 3.44772 3 4 3Z"
				fill="currentColor"
				stroke="none"
			/>
		) : (
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M12 5V19H19V5H12ZM4 3H20C20.5523 3 21 3.44772 21 4V20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V4C3 3.44772 3.44772 3 4 3Z"
			/>
		)}
	</svg>
);

const navItems: NavItem[] = [
	{ id: "dashboard", label: "Dashboard", icon: DashboardIcon },
	{ id: "api-keys", label: "API Keys", icon: ApiKeysIcon },
	{ id: "auth-files", label: "Auth Files", icon: AuthFilesIcon },
	{ id: "logs", label: "Logs", icon: LogsIcon },
	{ id: "analytics", label: "Analytics", icon: AnalyticsIcon },
	{ id: "settings", label: "Settings", icon: SettingsIcon },
];

export const Sidebar: Component = () => {
	const { currentPage, setCurrentPage, proxyStatus } = appStore;
	const [isExpanded, setIsExpanded] = createSignal(false);
	const [isPinned, setIsPinned] = createSignal(false);

	const isActive = (id: PageId) => {
		const page = currentPage();
		return page === id;
	};

	const handleMouseEnter = () => {
		if (!isPinned()) {
			setIsExpanded(true);
		}
	};

	const handleMouseLeave = () => {
		if (!isPinned()) {
			setIsExpanded(false);
		}
	};

	const togglePin = () => {
		const newState = !isPinned();
		setIsPinned(newState);
		setIsExpanded(newState);
	};

	return (
		<div
			class="fixed left-0 top-0 h-screen z-40 flex flex-col bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transition-all duration-200"
			classList={{
				"w-16": !isExpanded(),
				"w-48": isExpanded(),
			}}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
		>
			{/* Logo */}
			<div class="h-16 flex items-center justify-center border-b border-gray-200 dark:border-gray-800 px-3">
				<img
					src={
						themeStore.resolvedTheme() === "dark"
							? "/proxypal-white.png"
							: "/proxypal-black.png"
					}
					alt="ProxyPal"
					class="w-8 h-8 rounded-lg object-contain flex-shrink-0"
				/>
				<Show when={isExpanded()}>
					<span class="ml-3 font-semibold text-gray-900 dark:text-white whitespace-nowrap overflow-hidden">
						ProxyPal
					</span>
				</Show>
			</div>

			{/* Proxy Status */}
			<div class="px-3 py-3.5 border-b border-gray-200 dark:border-gray-800">
				<div
					class="flex items-center gap-2 px-2 py-1.5 rounded-lg"
					classList={{
						"bg-green-50 dark:bg-green-900/20": proxyStatus().running,
						"bg-gray-100 dark:bg-gray-800": !proxyStatus().running,
					}}
				>
					<div
						class="w-2 h-2 rounded-full flex-shrink-0"
						classList={{
							"bg-green-500 animate-pulse": proxyStatus().running,
							"bg-gray-400": !proxyStatus().running,
						}}
					/>
					<Show when={isExpanded()}>
						<span
							class="text-xs font-medium whitespace-nowrap overflow-hidden"
							classList={{
								"text-green-700 dark:text-green-400": proxyStatus().running,
								"text-gray-500 dark:text-gray-400": !proxyStatus().running,
							}}
						>
							{proxyStatus().running ? "Proxy Running" : "Proxy Stopped"}
						</span>
					</Show>
				</div>
			</div>

			{/* Pin Toggle - Above Dashboard */}
			<div class="px-2 py-2">
				<button
					type="button"
					onClick={togglePin}
					class="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg transition-colors"
					classList={{
						"bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400":
							isPinned(),
						"text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white":
							!isPinned(),
					}}
					title={!isExpanded() ? "Pin sidebar" : "Unpin sidebar"}
				>
					<PinIcon class="w-5 h-5 flex-shrink-0" pinned={isPinned()} />
					<Show when={isExpanded()}>
						<span class="text-sm font-medium whitespace-nowrap overflow-hidden">
							{isPinned() ? "Unpin" : "Pin"}
						</span>
					</Show>
				</button>
			</div>

			{/* Navigation */}
			<nav class="flex-1 py-3 px-2 space-y-1">
				<For each={navItems}>
					{(item) => (
						<button
							type="button"
							onClick={() => setCurrentPage(item.id)}
							class="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg transition-colors"
							classList={{
								"bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400":
									isActive(item.id),
								"text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white":
									!isActive(item.id),
							}}
							title={!isExpanded() ? item.label : undefined}
						>
							<item.icon class="w-5 h-5 flex-shrink-0" />
							<Show when={isExpanded()}>
								<span class="text-sm font-medium whitespace-nowrap overflow-hidden">
									{item.label}
								</span>
							</Show>
						</button>
					)}
				</For>
			</nav>

			{/* Theme Toggle */}
			<div class="px-2 py-3 border-t border-gray-200 dark:border-gray-800">
				<button
					type="button"
					onClick={() =>
						themeStore.setTheme(
							themeStore.resolvedTheme() === "dark" ? "light" : "dark",
						)
					}
					class="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors"
					title={!isExpanded() ? "Toggle Theme" : undefined}
				>
					<Show
						when={themeStore.resolvedTheme() === "dark"}
						fallback={
							<svg
								class="w-5 h-5 flex-shrink-0"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
							>
								<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
							</svg>
						}
					>
						<svg
							class="w-5 h-5 flex-shrink-0"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
						>
							<circle cx="12" cy="12" r="5" />
							<path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
						</svg>
					</Show>
					<Show when={isExpanded()}>
						<span class="text-sm font-medium whitespace-nowrap overflow-hidden">
							{themeStore.resolvedTheme() === "dark"
								? "Light Mode"
								: "Dark Mode"}
						</span>
					</Show>
				</button>
			</div>
		</div>
	);
};

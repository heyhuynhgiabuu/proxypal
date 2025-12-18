import { open } from "@tauri-apps/plugin-dialog";
import { createSignal, onCleanup } from "solid-js";
import { ProviderCard } from "../components/ProviderCard";
import { Button } from "../components/ui";
import {
	importVertexCredential,
	openOAuth,
	type Provider,
	pollOAuthStatus,
	refreshAuthStatus,
	startProxy,
} from "../lib/tauri";
import { appStore } from "../stores/app";
import { themeStore } from "../stores/theme";
import { toastStore } from "../stores/toast";

const providers = [
	{
		name: "Claude",
		provider: "claude" as Provider,
		logo: "/logos/claude.svg",
		description: "Anthropic's Claude models via Claude Code subscription",
	},
	{
		name: "ChatGPT",
		provider: "openai" as Provider,
		logo: "/logos/openai.svg",
		description: "OpenAI's GPT models via ChatGPT Plus/Pro subscription",
	},
	{
		name: "Gemini",
		provider: "gemini" as Provider,
		logo: "/logos/gemini.svg",
		description: "Google's Gemini models via Gemini CLI",
	},
	{
		name: "Qwen",
		provider: "qwen" as Provider,
		logo: "/logos/qwen.png",
		description: "Alibaba's Qwen models via Qwen Code",
	},
	{
		name: "iFlow",
		provider: "iflow" as Provider,
		logo: "/logos/iflow.svg",
		description: "iFlow AI models via iFlow subscription",
	},
	{
		name: "Vertex AI",
		provider: "vertex" as Provider,
		logo: "/logos/vertex.svg",
		description: "Google Cloud Vertex AI via service account",
	},
	{
		name: "Antigravity",
		provider: "antigravity" as Provider,
		logo: "/logos/antigravity.webp",
		description: "Antigravity AI models via Antigravity subscription",
	},
];

export function WelcomePage() {
	const {
		authStatus,
		setAuthStatus,
		proxyStatus,
		setProxyStatus,
		setCurrentPage,
	} = appStore;
	const [connecting, setConnecting] = createSignal<Provider | null>(null);

	const handleConnect = async (provider: Provider) => {
		// Auto-start proxy if not running
		if (!proxyStatus().running) {
			toastStore.info("Starting proxy...", "Please wait");
			try {
				const status = await startProxy();
				setProxyStatus(status);
				toastStore.success("Proxy started", `Listening on port ${status.port}`);
				// Wait for Management API to be ready (poll with retries)
				const maxRetries = 10;
				for (let i = 0; i < maxRetries; i++) {
					try {
						const res = await fetch(
							`http://127.0.0.1:${status.port}/v1/models`,
						);
						if (res.ok) break;
					} catch {
						// Ignore fetch errors, just retry
					}
					if (i === maxRetries - 1) {
						throw new Error("Proxy API not ready after startup");
					}
					await new Promise((resolve) => setTimeout(resolve, 200));
				}
			} catch (error) {
				console.error("Failed to start proxy:", error);
				toastStore.error("Failed to start proxy", String(error));
				return;
			}
		}

		// Vertex uses service account import, not OAuth
		if (provider === "vertex") {
			setConnecting(provider);
			toastStore.info(
				"Import Vertex service account",
				"Select your service account JSON file",
			);
			try {
				const selected = await open({
					multiple: false,
					filters: [{ name: "JSON", extensions: ["json"] }],
				});
				const selectedPath = Array.isArray(selected) ? selected[0] : selected;
				if (!selectedPath) {
					setConnecting(null);
					toastStore.warning(
						"No file selected",
						"Choose a service account JSON",
					);
					return;
				}
				await importVertexCredential(selectedPath);
				const newAuth = await refreshAuthStatus();
				setAuthStatus(newAuth);
				setConnecting(null);
				toastStore.success(
					"Vertex connected!",
					"Service account imported successfully",
				);
				setCurrentPage("dashboard");
			} catch (error) {
				console.error("Vertex import failed:", error);
				setConnecting(null);
				toastStore.error("Connection failed", String(error));
			}
			return;
		}

		setConnecting(provider);
		toastStore.info(
			`Connecting to ${provider}...`,
			"Complete authentication in your browser",
		);

		try {
			const oauthState = await openOAuth(provider);
			let attempts = 0;
			const maxAttempts = 120;
			const pollInterval = setInterval(async () => {
				attempts++;
				try {
					const completed = await pollOAuthStatus(oauthState);
					if (completed) {
						clearInterval(pollInterval);
						const newAuth = await refreshAuthStatus();
						setAuthStatus(newAuth);
						setConnecting(null);
						toastStore.success(
							`${provider} connected!`,
							"You can now use this provider",
						);
						// Auto-navigate to dashboard after successful connection
						setCurrentPage("dashboard");
					} else if (attempts >= maxAttempts) {
						clearInterval(pollInterval);
						setConnecting(null);
						toastStore.error("Connection timeout", "Please try again");
					}
				} catch (err) {
					console.error("Poll error:", err);
				}
			}, 1000);
			onCleanup(() => clearInterval(pollInterval));
		} catch (error) {
			console.error("Failed to start OAuth:", error);
			setConnecting(null);
			toastStore.error("Connection failed", String(error));
		}
	};

	const hasAnyConnection = () => {
		const status = authStatus();
		return (
			status.claude ||
			status.openai ||
			status.gemini ||
			status.qwen ||
			status.iflow ||
			status.vertex ||
			status.antigravity
		);
	};

	return (
		<div class="min-h-screen flex flex-col">
			{/* Header */}
			<header class="sticky top-0 z-10 px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
				<div class="flex items-center gap-2 sm:gap-3">
					<img
						src={
							themeStore.resolvedTheme() === "dark"
								? "/proxypal-white.png"
								: "/proxypal-black.png"
						}
						alt="ProxyPal Logo"
						class="w-8 h-8 sm:w-10 sm:h-10 rounded-xl object-contain"
					/>
					<div>
						<h1 class="font-bold text-base sm:text-lg text-gray-900 dark:text-gray-100">
							ProxyPal
						</h1>
						<p class="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">
							Use your AI subscriptions everywhere
						</p>
					</div>
				</div>
			</header>

			{/* Main content */}
			<main class="flex-1 p-4 sm:p-6">
				<div class="max-w-2xl mx-auto">
					{/* Welcome message */}
					<div class="text-center mb-6 sm:mb-8">
						<h2 class="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
							Connect your AI accounts
						</h2>
						<p class="text-sm sm:text-base text-gray-600 dark:text-gray-400">
							Link your existing subscriptions to use them with any AI coding
							tool.
							<br class="hidden sm:block" />
							<span class="sm:hidden"> </span>No separate API keys needed.
						</p>
					</div>

					{/* Provider cards */}
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-8">
						{providers.map((provider) => (
							<ProviderCard
								name={provider.name}
								provider={provider.provider}
								logo={provider.logo}
								description={provider.description}
								connected={authStatus()[provider.provider]}
								connecting={connecting() === provider.provider}
								onConnect={handleConnect}
							/>
						))}
					</div>

					{/* Continue button */}
					{hasAnyConnection() && (
						<div class="text-center">
							<Button
								variant="primary"
								size="lg"
								onClick={() => setCurrentPage("dashboard")}
							>
								Continue to Dashboard
								<svg
									class="w-4 h-4 ml-2"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M9 5l7 7-7 7"
									/>
								</svg>
							</Button>
						</div>
					)}
				</div>
			</main>

			{/* Footer */}
			<footer class="px-6 py-4 border-t border-gray-200 dark:border-gray-800 text-center">
				<p class="text-xs text-gray-500 dark:text-gray-400">
					Powered by CLIProxyAPI • Your data stays local
				</p>
			</footer>
		</div>
	);
}

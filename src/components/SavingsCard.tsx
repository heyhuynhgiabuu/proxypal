import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { syncUsageFromProxy } from "../lib/tauri";
import { appStore } from "../stores/app";
import { requestStore } from "../stores/requests";

function formatCost(cost: number): string {
	if (cost < 0.01) return "0.00";
	if (cost >= 100) return cost.toFixed(0);
	return cost.toFixed(2);
}

function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
	return tokens.toString();
}

// Animated number component - uses createEffect instead of polling
function AnimatedValue(props: {
	value: number;
	format: (n: number) => string;
	prefix?: string;
}) {
	const [displayValue, setDisplayValue] = createSignal(props.value);

	// Animate when value changes using createEffect
	createEffect(() => {
		const target = props.value;
		const current = displayValue();

		if (current === target) return;

		const duration = 600;
		const startTime = performance.now();
		const startValue = current;
		let animationFrame: number;

		const animate = (now: number) => {
			const elapsed = now - startTime;
			const progress = Math.min(elapsed / duration, 1);
			// Ease-out cubic
			const eased = 1 - (1 - progress) ** 3;
			const newValue = startValue + (target - startValue) * eased;
			setDisplayValue(newValue);

			if (progress < 1) {
				animationFrame = requestAnimationFrame(animate);
			}
		};

		animationFrame = requestAnimationFrame(animate);

		onCleanup(() => {
			if (animationFrame) cancelAnimationFrame(animationFrame);
		});
	});

	return (
		<span class="tabular-nums">
			{props.prefix}
			{props.format(displayValue())}
		</span>
	);
}

export function SavingsCard() {
	const { proxyStatus } = appStore;
	// Use centralized store instead of local state
	const history = requestStore.history;

	// Sync real token data from CLIProxyAPI
	const syncFromProxy = async () => {
		if (!proxyStatus().running) return;
		try {
			await syncUsageFromProxy();
			// Reload history to get updated token counts
			await requestStore.loadHistory();
		} catch (err) {
			// Silently fail - proxy might not be ready yet
			console.debug("Usage sync pending:", err);
		}
	};

	onMount(async () => {
		// Load from centralized store
		await requestStore.loadHistory();

		// If proxy is running, sync real token data immediately
		if (proxyStatus().running) {
			await syncFromProxy();
		}

		// No event listener needed - RequestMonitor handles all event processing
		// This eliminates duplicate state updates
	});

	// Sync when proxy status changes to running
	createEffect(() => {
		if (proxyStatus().running) {
			// Small delay to let proxy initialize
			setTimeout(syncFromProxy, 2000);
		}
	});

	const hasActivity = () => history().requests.length > 0;
	const totalTokens = () => history().totalTokensIn + history().totalTokensOut;

	return (
		<div class="relative overflow-hidden rounded-xl bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-900/30 dark:via-emerald-900/20 dark:to-teal-900/20 border border-green-200 dark:border-green-800/50 p-4 sm:p-5">
			{/* Background decoration */}
			<div class="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-green-200/30 to-transparent dark:from-green-700/10 rounded-full -translate-y-1/2 translate-x-1/2" />

			<div class="relative flex items-center justify-between gap-4">
				<div class="flex-1">
					<div class="flex items-center gap-2 mb-1">
						<svg
							class="w-4 h-4 text-green-600 dark:text-green-400"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<span class="text-sm font-medium text-green-700 dark:text-green-300">
							Estimated Savings
						</span>
					</div>

					<Show
						when={hasActivity()}
						fallback={
							<div class="text-gray-500 dark:text-gray-400">
								<p class="text-2xl sm:text-3xl font-bold text-gray-400 dark:text-gray-500">
									$0.00
								</p>
								<p class="text-xs mt-1">
									{proxyStatus().running
										? "Make API calls to start saving"
										: "Start proxy and make API calls"}
								</p>
							</div>
						}
					>
						<p class="text-3xl sm:text-4xl font-bold text-green-700 dark:text-green-300">
							<AnimatedValue
								value={history().totalCostUsd}
								format={formatCost}
								prefix="$"
							/>
						</p>
						<div class="flex items-center gap-3 mt-1 text-xs text-green-600/80 dark:text-green-400/80">
							<span>{history().requests.length} requests</span>
							<span class="w-1 h-1 rounded-full bg-green-400 dark:bg-green-600" />
							<span>{formatTokens(totalTokens())} tokens</span>
						</div>
					</Show>
				</div>

				{/* Icon */}
				<div class="hidden sm:flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-800/30 text-4xl">
					💰
				</div>
			</div>

			{/* Subtle hint */}
			<Show when={hasActivity()}>
				<p class="text-[10px] text-green-600/60 dark:text-green-400/50 mt-3">
					Estimated based on public API pricing. Using your subscription saves
					you money!
				</p>
			</Show>
		</div>
	);
}

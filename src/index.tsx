/* @refresh reload */
import { ErrorBoundary } from "solid-js";
import { render } from "solid-js/web";
import App from "./App";
import { I18nProvider, type Locale } from "./i18n";
import { appStore } from "./stores/app";
import "./styles/index.css";

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	if (typeof error === "string") {
		return error;
	}

	return "Unexpected application error";
}

render(
	() => (
		<I18nProvider
			locale={() => appStore.config().locale}
			setLocale={(locale: Locale) => appStore.setLocale(locale)}
		>
			<ErrorBoundary
				fallback={(error, reset) => (
					<div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
						<div class="max-w-xl rounded-xl border border-red-300 bg-white dark:bg-gray-900 p-6 space-y-3">
							<h1 class="text-lg font-semibold text-red-700 dark:text-red-400">
								ProxyPal crashed while rendering
							</h1>
							<p class="text-sm text-gray-700 dark:text-gray-300 break-words">
								{getErrorMessage(error)}
							</p>
							<button
								type="button"
								onClick={() => reset()}
								class="px-4 py-2 rounded-lg bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 hover:opacity-90"
							>
								Retry render
							</button>
						</div>
					</div>
				)}
			>
				<App />
			</ErrorBoundary>
		</I18nProvider>
	),
	document.getElementById("root") as HTMLElement,
);

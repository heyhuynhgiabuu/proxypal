import { createSignal, Show } from "solid-js";
import { Button } from "./ui";
import { toastStore } from "../stores/toast";
import type { Provider } from "../lib/tauri";

// Provider logos mapping
const providerLogos: Record<Provider, string> = {
    claude: "/logos/claude.svg",
    openai: "/logos/openai.svg",
    gemini: "/logos/gemini.svg",
    qwen: "/logos/qwen.png",
    iflow: "/logos/iflow.svg",
    vertex: "/logos/vertex.svg",
    antigravity: "/logos/antigravity.webp",
};

interface OAuthModalProps {
    provider: Provider | null;
    providerName: string;
    authUrl: string;
    onStartOAuth: () => void;
    onCancel: () => void;
    onAlreadyAuthorized: () => void;
    loading?: boolean;
}

export function OAuthModal(props: OAuthModalProps) {
    const [copied, setCopied] = createSignal(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(props.authUrl);
            setCopied(true);
            toastStore.success("Copied to clipboard!");
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toastStore.error("Failed to copy");
        }
    };

    const truncateUrl = (url: string, maxLength: number = 35) => {
        if (url.length <= maxLength) return url;
        return url.substring(0, maxLength) + "...";
    };

    return (
        <Show when={props.provider}>
            <div
                class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                onClick={(e) => e.target === e.currentTarget && props.onCancel()}
            >
                <div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full overflow-hidden border border-gray-200 dark:border-gray-700">
                    {/* Header with Provider Info */}
                    <div class="px-5 pt-5 pb-4 border-b border-gray-100 dark:border-gray-700">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center overflow-hidden">
                                <img
                                    src={props.provider ? providerLogos[props.provider] : ""}
                                    alt={props.providerName}
                                    class="w-7 h-7 object-contain"
                                />
                            </div>
                            <div>
                                <h3 class="font-semibold text-gray-900 dark:text-gray-100">
                                    Connect {props.providerName}
                                </h3>
                                <p class="text-xs text-gray-500 dark:text-gray-400">
                                    Authenticate with your account
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Main Content */}
                    <div class="p-5 space-y-4">
                        {/* Start OAuth Button */}
                        <Button
                            variant="primary"
                            size="lg"
                            class="w-full"
                            onClick={props.onStartOAuth}
                            loading={props.loading}
                        >
                            <svg
                                class="w-4 h-4 mr-2"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                />
                            </svg>
                            Start OAuth
                        </Button>

                        {/* Authorization URL Section */}
                        <div class="space-y-1.5">
                            <label class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                                Authorization URL
                            </label>
                            <div class="flex items-center gap-2 bg-gray-50 dark:bg-gray-900 rounded-lg px-3 py-2.5 border border-gray-200 dark:border-gray-600">
                                {/* URL Text */}
                                <span class="flex-1 text-xs text-gray-600 dark:text-gray-300 font-mono truncate">
                                    {truncateUrl(props.authUrl)}
                                </span>

                                {/* Copy Icon Button */}
                                <button
                                    class="flex-shrink-0 p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                    onClick={handleCopy}
                                    title="Copy URL"
                                >
                                    {copied() ? (
                                        <svg
                                            class="w-4 h-4 text-green-500"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M5 13l4 4L19 7"
                                            />
                                        </svg>
                                    ) : (
                                        <svg
                                            class="w-4 h-4 text-gray-400"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <rect x="9" y="9" width="13" height="13" rx="2" stroke-width="2" />
                                            <path stroke-width="2" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Footer Actions */}
                    <div class="px-5 pb-5 pt-2 space-y-2 border-t border-gray-100 dark:border-gray-700">
                        {/* I already authorized - styled as secondary action */}
                        <button
                            class="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-lg transition-colors border border-green-200 dark:border-green-800"
                            onClick={props.onAlreadyAuthorized}
                            disabled={props.loading}
                        >
                            <svg
                                class="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                            </svg>
                            I already authorized
                        </button>

                        {/* Cancel Button - Dark background */}
                        <button
                            class="w-full py-2.5 text-sm font-medium text-gray-300 bg-gray-700 dark:bg-gray-900 hover:bg-gray-600 dark:hover:bg-gray-800 rounded-lg transition-colors border border-gray-600 dark:border-gray-700"
                            onClick={props.onCancel}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </Show>
    );
}

import { createSignal, Show } from "solid-js";
import { useI18n } from "../i18n";
import { toastStore } from "../stores/toast";
import { Button } from "./ui";

import type { Provider } from "../lib/tauri";

// Provider logos mapping
const providerLogos: Record<Provider, string> = {
  antigravity: "/logos/antigravity.webp",
  claude: "/logos/claude.svg",
  gemini: "/logos/gemini.svg",
  iflow: "/logos/iflow.svg",
  kimi: "/logos/kimi.png",
  kiro: "/logos/kiro.svg",
  openai: "/logos/openai.svg",
  qwen: "/logos/qwen.png",
  vertex: "/logos/vertex.svg",
};

interface OAuthModalProps {
  authUrl: string;
  loading?: boolean;
  onAlreadyAuthorized: () => void;
  onCancel: () => void;
  onStartOAuth: () => void;
  provider: Provider | null;
  providerName: string;
}

export function OAuthModal(props: OAuthModalProps) {
  const [copied, setCopied] = createSignal(false);
  const { t } = useI18n();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(props.authUrl);
      setCopied(true);
      toastStore.success(t("common.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toastStore.error(t("common.copyFailed"));
    }
  };

  const truncateUrl = (url: string, maxLength: number = 35) => {
    if (url.length <= maxLength) {
      return url;
    }
    return url.slice(0, maxLength) + "...";
  };

  return (
    <Show when={props.provider}>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && props.onCancel()}
      >
        <div class="w-full max-w-sm overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
          {/* Header with Provider Info */}
          <div class="border-b border-gray-100 px-5 pb-4 pt-5 dark:border-gray-700">
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-700">
                <img
                  alt={props.providerName}
                  class="h-7 w-7 object-contain"
                  src={props.provider ? providerLogos[props.provider] : ""}
                />
              </div>
              <div>
                <h3 class="font-semibold text-gray-900 dark:text-gray-100">
                  {t("oauth.connect", { provider: props.providerName })}
                </h3>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {t("oauth.authenticateAccount")}
                </p>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div class="space-y-4 p-5">
            {/* Start OAuth Button */}
            <Button
              class="w-full"
              loading={props.loading}
              onClick={props.onStartOAuth}
              size="lg"
              variant="primary"
            >
              <svg class="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </svg>
              {t("oauth.startOAuth")}
            </Button>

            {/* Authorization URL Section */}
            <div class="space-y-1.5">
              <label class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t("oauth.authorizationUrl")}
              </label>
              <div class="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-600 dark:bg-gray-900">
                {/* URL Text */}
                <span class="flex-1 truncate font-mono text-xs text-gray-600 dark:text-gray-300">
                  {truncateUrl(props.authUrl)}
                </span>

                {/* Copy Icon Button */}
                <button
                  class="flex-shrink-0 rounded p-1.5 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700"
                  onClick={handleCopy}
                  title={t("oauth.copyUrl")}
                >
                  {copied() ? (
                    <svg
                      class="h-4 w-4 text-green-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="M5 13l4 4L19 7"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                      />
                    </svg>
                  ) : (
                    <svg
                      class="h-4 w-4 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <rect height="13" rx="2" stroke-width="2" width="13" x="9" y="9" />
                      <path
                        d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"
                        stroke-width="2"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div class="space-y-2 border-t border-gray-100 px-5 pb-5 pt-2 dark:border-gray-700">
            {/* I already authorized - styled as secondary action */}
            <button
              class="flex w-full items-center justify-center gap-2 rounded-lg border border-green-200 bg-green-50 py-2.5 text-sm font-medium text-green-700 transition-colors hover:bg-green-100 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
              disabled={props.loading}
              onClick={props.onAlreadyAuthorized}
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </svg>
              {t("oauth.alreadyAuthorized")}
            </button>

            {/* Cancel Button - Dark background */}
            <button
              class="w-full rounded-lg border border-gray-600 bg-gray-700 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
              onClick={props.onCancel}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

import { Show, splitProps } from "solid-js";
import { useI18n } from "../../i18n";
import { Button } from "../ui";

import type { Provider } from "../../lib/tauri";

interface OnboardingChecklistProps {
  firstDisconnectedProvider?: Provider;
  hasAgent: boolean;
  hasProvider: boolean;
  isComplete: boolean;
  isToggling: boolean;
  onConnectProvider: (provider: Provider) => Promise<void>;
  onNavigateSettings: () => void;
  onToggleProxy: () => Promise<void>;
  proxyRunning: boolean;
}

export function OnboardingChecklist(props: OnboardingChecklistProps) {
  const { t } = useI18n();
  const [local] = splitProps(props, [
    "isComplete",
    "proxyRunning",
    "isToggling",
    "onToggleProxy",
    "hasProvider",
    "onConnectProvider",
    "firstDisconnectedProvider",
    "hasAgent",
    "onNavigateSettings",
  ]);

  return (
    <Show when={!local.isComplete}>
      <div class="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-purple-50 p-4 dark:border-brand-800/50 dark:from-brand-900/30 dark:to-purple-900/20 sm:p-6">
        <div class="mb-4">
          <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100">
            {t("dashboard.onboarding.getStarted")}
          </h2>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {t("dashboard.onboarding.completeSteps")}
          </p>
        </div>
        <div class="space-y-3">
          {/* Step 1: Start Proxy */}
          <div
            class={`flex items-center gap-3 rounded-xl border p-3 ${local.proxyRunning ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20" : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"}`}
          >
            <div
              class={`flex h-8 w-8 items-center justify-center rounded-full ${local.proxyRunning ? "bg-green-500 text-white" : "bg-gray-200 text-gray-500 dark:bg-gray-700"}`}
            >
              {local.proxyRunning ? (
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M5 13l4 4L19 7"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
              ) : (
                "1"
              )}
            </div>
            <div class="flex-1">
              <p class="font-medium text-gray-900 dark:text-gray-100">
                {t("dashboard.onboarding.startProxy")}
              </p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {t("dashboard.onboarding.enableLocalProxy")}
              </p>
            </div>
            <Show when={!local.proxyRunning}>
              <Button
                disabled={local.isToggling}
                onClick={local.onToggleProxy}
                size="sm"
                variant="primary"
              >
                {local.isToggling
                  ? t("dashboard.onboarding.starting")
                  : t("dashboard.onboarding.start")}
              </Button>
            </Show>
          </div>
          {/* Step 2: Connect Provider */}
          <div
            class={`flex items-center gap-3 rounded-xl border p-3 ${local.hasProvider ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20" : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"}`}
          >
            <div
              class={`flex h-8 w-8 items-center justify-center rounded-full ${local.hasProvider ? "bg-green-500 text-white" : "bg-gray-200 text-gray-500 dark:bg-gray-700"}`}
            >
              {local.hasProvider ? (
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M5 13l4 4L19 7"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
              ) : (
                "2"
              )}
            </div>
            <div class="flex-1">
              <p class="font-medium text-gray-900 dark:text-gray-100">
                {t("dashboard.checklist.connectProvider")}
              </p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {t("dashboard.checklist.connectProviderDescription")}
              </p>
            </div>
            <Show when={!local.hasProvider && local.proxyRunning}>
              <Button
                onClick={() => {
                  const first = local.firstDisconnectedProvider;
                  if (first) {
                    local.onConnectProvider(first);
                  }
                }}
                size="sm"
                variant="secondary"
              >
                {t("dashboard.checklist.connect")}
              </Button>
            </Show>
          </div>
          {/* Step 3: Configure Agent */}
          <div
            class={`flex items-center gap-3 rounded-xl border p-3 ${local.hasAgent ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20" : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"}`}
          >
            <div
              class={`flex h-8 w-8 items-center justify-center rounded-full ${local.hasAgent ? "bg-green-500 text-white" : "bg-gray-200 text-gray-500 dark:bg-gray-700"}`}
            >
              {local.hasAgent ? (
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M5 13l4 4L19 7"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
              ) : (
                "3"
              )}
            </div>
            <div class="flex-1">
              <p class="font-medium text-gray-900 dark:text-gray-100">
                {t("dashboard.checklist.configureAgent")}
              </p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {t("dashboard.checklist.configureAgentDescription")}
              </p>
            </div>
            <Show when={!local.hasAgent && local.hasProvider}>
              <Button onClick={local.onNavigateSettings} size="sm" variant="secondary">
                {t("dashboard.checklist.setup")}
              </Button>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}

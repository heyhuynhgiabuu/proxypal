import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import { useI18n } from "../i18n";
import {
  configureContinue,
  type DetectedTool,
  detectAiTools,
  getToolSetupInfo,
  type ToolSetupInfo,
} from "../lib/tauri";
import { appStore } from "../stores/app";
import { toastStore } from "../stores/toast";
import { Button } from "./ui";

interface SetupWizardProps {
  onClose?: () => void;
  onComplete?: () => void;
}

const toolLogos: Record<string, string> = {
  cline: "/logos/cline.svg",
  continue: "/logos/continue.svg",
  cursor: "/logos/cursor.svg",
  windsurf: "/logos/windsurf.svg",
};

export function SetupWizard(props: SetupWizardProps) {
  const { t } = useI18n();
  const { proxyStatus } = appStore;
  const [tools, setTools] = createSignal<DetectedTool[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [selectedTool, setSelectedTool] = createSignal<string | null>(null);
  const [setupInfo, setSetupInfo] = createSignal<ToolSetupInfo | null>(null);
  const [configuring, setConfiguring] = createSignal(false);
  const [copiedField, setCopiedField] = createSignal<string | null>(null);

  // Detect tools on mount
  onMount(async () => {
    try {
      const detected = await detectAiTools();
      setTools(detected);
    } catch (error) {
      console.error("Failed to detect tools:", error);
      toastStore.error(t("setupWizard.toasts.failedToDetectInstalledTools"));
    } finally {
      setLoading(false);
    }
  });

  // Load setup info when tool is selected
  createEffect(async () => {
    const toolId = selectedTool();
    if (toolId) {
      try {
        const info = await getToolSetupInfo(toolId);
        setSetupInfo(info);
      } catch (error) {
        console.error("Failed to get setup info:", error);
      }
    } else {
      setSetupInfo(null);
    }
  });

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toastStore.success(t("common.copied"));
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toastStore.error(t("common.copyFailed"));
    }
  };

  const handleAutoConfigure = async () => {
    const toolId = selectedTool();
    if (toolId !== "continue") {
      return;
    }

    setConfiguring(true);
    try {
      const configPath = await configureContinue();
      toastStore.success(
        t("setupWizard.toasts.continueConfiguredConfigSaved", {
          path: configPath,
        }),
      );
      props.onComplete?.();
    } catch (error) {
      toastStore.error(t("setupWizard.toasts.failedToConfigure"), String(error));
    } finally {
      setConfiguring(false);
    }
  };

  const installedTools = () => tools().filter((t) => t.installed);
  const notInstalledTools = () => tools().filter((t) => !t.installed);

  const endpoint = () => proxyStatus().endpoint || "http://localhost:8317/v1";

  return (
    <div class="flex h-full flex-col">
      {/* Header */}
      <div class="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-800">
        <div>
          <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100">
            {t("setupWizard.title")}
          </h2>
          <p class="text-sm text-gray-500 dark:text-gray-400">{t("setupWizard.subtitle")}</p>
        </div>
        <Show when={props.onClose}>
          <button
            class="text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
            onClick={props.onClose}
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M6 18L18 6M6 6l12 12"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
          </button>
        </Show>
      </div>

      <div class="flex flex-1 overflow-hidden">
        {/* Tool list sidebar */}
        <div class="w-64 overflow-y-auto border-r border-gray-200 dark:border-gray-800">
          <Show
            fallback={
              <div class="space-y-3 p-4">
                <div class="h-12 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
                <div class="h-12 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
                <div class="h-12 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
              </div>
            }
            when={!loading()}
          >
            {/* Installed tools */}
            <Show when={installedTools().length > 0}>
              <div class="p-3">
                <h3 class="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("setupWizard.detectedTools")}
                </h3>
                <For each={installedTools()}>
                  {(tool) => (
                    <button
                      class={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                        selectedTool() === tool.id
                          ? "bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300"
                          : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                      }`}
                      onClick={() => setSelectedTool(tool.id)}
                    >
                      <div class="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
                        <img
                          alt={tool.name}
                          class="h-5 w-5"
                          src={toolLogos[tool.id] || "/logos/default.svg"}
                        />
                      </div>
                      <div class="flex-1 text-left">
                        <div class="text-sm font-medium">{tool.name}</div>
                        <div class="text-xs text-gray-500 dark:text-gray-400">
                          {tool.canAutoConfigure
                            ? t("setupWizard.autoConfigAvailable")
                            : t("setupWizard.manualSetup")}
                        </div>
                      </div>
                      <Show when={tool.canAutoConfigure}>
                        <span class="h-2 w-2 rounded-full bg-green-500" />
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </Show>

            {/* Not installed tools */}
            <Show when={notInstalledTools().length > 0}>
              <div class="border-t border-gray-200 p-3 dark:border-gray-800">
                <h3 class="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("setupWizard.otherTools")}
                </h3>
                <For each={notInstalledTools()}>
                  {(tool) => (
                    <button
                      class={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 opacity-60 transition-colors ${
                        selectedTool() === tool.id
                          ? "bg-gray-100 dark:bg-gray-800"
                          : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      }`}
                      onClick={() => setSelectedTool(tool.id)}
                    >
                      <div class="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
                        <img
                          alt={tool.name}
                          class="h-5 w-5 grayscale"
                          src={toolLogos[tool.id] || "/logos/default.svg"}
                        />
                      </div>
                      <div class="flex-1 text-left">
                        <div class="text-sm font-medium text-gray-600 dark:text-gray-400">
                          {tool.name}
                        </div>
                        <div class="text-xs text-gray-400 dark:text-gray-500">
                          {t("setupWizard.notDetected")}
                        </div>
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>

        {/* Setup instructions panel */}
        <div class="flex-1 overflow-y-auto p-6">
          <Show
            fallback={
              <div class="flex h-full items-center justify-center">
                <div class="text-center">
                  <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
                    <svg
                      class="h-8 w-8 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.5"
                      />
                    </svg>
                  </div>
                  <h3 class="mb-1 text-lg font-medium text-gray-900 dark:text-gray-100">
                    {t("setupWizard.selectTool")}
                  </h3>
                  <p class="max-w-sm text-sm text-gray-500 dark:text-gray-400">
                    {t("setupWizard.chooseToolFromList")}
                  </p>
                </div>
              </div>
            }
            when={selectedTool() && setupInfo()}
          >
            {/* Tool header */}
            <div class="mb-6 flex items-center gap-4">
              <div class="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800">
                <img alt={setupInfo()!.name} class="h-9 w-9" src={setupInfo()!.logo} />
              </div>
              <div class="flex-1">
                <h3 class="text-xl font-bold text-gray-900 dark:text-gray-100">
                  {setupInfo()!.name}
                </h3>
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  {setupInfo()!.canAutoConfigure
                    ? t("setupWizard.autoConfigurationAvailable")
                    : t("setupWizard.manualConfigurationRequired")}
                </p>
              </div>
              <Show when={setupInfo()!.canAutoConfigure}>
                <Button disabled={configuring()} onClick={handleAutoConfigure} variant="primary">
                  {configuring() ? (
                    <>
                      <svg class="-ml-1 mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
                      {t("setupWizard.configuring")}
                    </>
                  ) : (
                    <>
                      <svg
                        class="mr-1.5 h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M13 10V3L4 14h7v7l9-11h-7z"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                        />
                      </svg>
                      {t("setupWizard.autoConfigure")}
                    </>
                  )}
                </Button>
              </Show>
            </div>

            {/* Note if present */}
            <Show when={setupInfo()!.note}>
              <div class="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                <div class="flex gap-3">
                  <svg
                    class="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                    />
                  </svg>
                  <p class="text-sm text-amber-800 dark:text-amber-200">{setupInfo()!.note}</p>
                </div>
              </div>
            </Show>

            {/* Endpoint quick copy */}
            <Show when={setupInfo()!.endpoint}>
              <div class="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t("setupWizard.proxypalEndpoint")}
                  </span>
                  <button
                    class="flex items-center gap-1 text-xs text-brand-600 hover:underline dark:text-brand-400"
                    onClick={() => handleCopy(endpoint(), "endpoint")}
                  >
                    {copiedField() === "endpoint" ? (
                      <>
                        <svg
                          class="h-3.5 w-3.5"
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
                        {t("setupWizard.copied")}
                      </>
                    ) : (
                      <>
                        <svg
                          class="h-3.5 w-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                          />
                        </svg>
                        {t("common.copy")}
                      </>
                    )}
                  </button>
                </div>
                <code class="block rounded border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
                  {endpoint()}
                </code>
              </div>
            </Show>

            {/* Setup steps */}
            <div class="space-y-4">
              <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t("setupWizard.setupSteps")}
              </h4>
              <For each={setupInfo()!.steps}>
                {(step, index) => (
                  <div class="flex gap-4">
                    <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
                      {index() + 1}
                    </div>
                    <div class="min-w-0 flex-1">
                      <h5 class="mb-1 font-medium text-gray-900 dark:text-gray-100">
                        {step.title}
                      </h5>
                      <p class="mb-2 text-sm text-gray-600 dark:text-gray-400">
                        {step.description}
                      </p>
                      <Show when={step.copyable}>
                        <div class="relative">
                          <code class="block break-all rounded-lg bg-gray-100 px-3 py-2 pr-20 font-mono text-sm text-gray-900 dark:bg-gray-800 dark:text-gray-100">
                            {step.copyable}
                          </code>
                          <button
                            class="absolute right-1.5 top-1.5 rounded bg-white px-2 py-1 text-xs font-medium shadow-sm transition-colors hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-600"
                            onClick={() => handleCopy(step.copyable!, `step-${index()}`)}
                          >
                            {copiedField() === `step-${index()}`
                              ? t("setupWizard.copied")
                              : t("common.copy")}
                          </button>
                        </div>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>

            {/* Manual config for Continue */}
            <Show when={setupInfo()!.manualConfig}>
              <div class="mt-6 border-t border-gray-200 pt-6 dark:border-gray-700">
                <h4 class="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {t("setupWizard.manualConfiguration")}
                </h4>
                <div class="relative">
                  <pre class="overflow-x-auto rounded-lg bg-gray-100 p-4 font-mono text-xs text-gray-800 dark:bg-gray-800 dark:text-gray-200">
                    {setupInfo()!.manualConfig}
                  </pre>
                  <button
                    class="absolute right-2 top-2 rounded bg-white px-2 py-1 text-xs font-medium shadow-sm transition-colors hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-600"
                    onClick={() => handleCopy(setupInfo()!.manualConfig!, "manual")}
                  >
                    {copiedField() === "manual" ? t("setupWizard.copied") : t("common.copy")}
                  </button>
                </div>
              </div>
            </Show>
          </Show>
        </div>
      </div>

      {/* Footer */}
      <div class="border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-gray-800 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {t("setupWizard.toolsDetectedOnYourSystem", {
              count: installedTools().length,
            })}
          </p>
          <Show when={props.onComplete}>
            <Button onClick={props.onComplete} variant="secondary">
              {t("setupWizard.done")}
            </Button>
          </Show>
        </div>
      </div>
    </div>
  );
}

// Compact card version for dashboard
export function SetupWizardCard(props: { onOpenWizard: () => void }) {
  const { t } = useI18n();
  const [tools, setTools] = createSignal<DetectedTool[]>([]);
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    try {
      const detected = await detectAiTools();
      setTools(detected);
    } catch (error) {
      console.error("Failed to detect tools:", error);
    } finally {
      setLoading(false);
    }
  });

  const installedCount = () => tools().filter((t) => t.installed).length;
  const autoConfigurable = () => tools().filter((t) => t.installed && t.canAutoConfigure);

  return (
    <div class="rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-brand-100 p-4 dark:border-brand-800 dark:from-brand-900/20 dark:to-brand-800/20">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-brand-500">
          <svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
        </div>
        <div class="min-w-0 flex-1">
          <h3 class="mb-1 font-semibold text-gray-900 dark:text-gray-100">
            {t("setupWizard.card.configureYourTools")}
          </h3>
          <Show
            fallback={
              <p class="text-sm text-gray-600 dark:text-gray-400">
                {t("setupWizard.card.detectingInstalledTools")}
              </p>
            }
            when={!loading()}
          >
            <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
              {installedCount() > 0 ? (
                <>
                  {t("setupWizard.card.foundTools", {
                    count: installedCount(),
                  })}
                  {autoConfigurable().length > 0 && (
                    <>
                      {" "}
                      {t("setupWizard.card.autoConfigurableCount", {
                        count: autoConfigurable().length,
                      })}
                    </>
                  )}
                </>
              ) : (
                t("setupWizard.card.setUpAiCodingTools")
              )}
            </p>
          </Show>
          <Button onClick={props.onOpenWizard} size="sm" variant="secondary">
            <svg class="mr-1.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            {t("setupWizard.card.setupTools")}
          </Button>
        </div>
      </div>
    </div>
  );
}

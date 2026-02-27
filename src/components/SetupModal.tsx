import { createSignal, Show } from "solid-js";
import { useI18n } from "../i18n";
import { toastStore } from "../stores/toast";
import { Button } from "./ui";

type Tool = "cursor" | "cline" | "continue";

interface SetupModalProps {
  endpoint: string;
  onClose: () => void;
  tool: Tool | null;
}

interface ToolInfo {
  description: string;
  logo: string;
  name: string;
  steps: { content: string; copyable?: boolean; title: string }[];
}

function getToolInfo(
  t: (key: string, params?: Record<string, string | number>) => string,
): Record<Tool, ToolInfo> {
  return {
    cline: {
      description: t("setupModal.description.cline"),
      logo: "/logos/cline.svg",
      name: "Cline",
      steps: [
        {
          content: t("setupModal.steps.cline.openClineSettings.content"),
          title: t("setupModal.steps.cline.openClineSettings.title"),
        },
        {
          content: t("setupModal.steps.cline.selectApiProvider.content"),
          title: t("setupModal.steps.cline.selectApiProvider.title"),
        },
        {
          content: "",
          copyable: true,
          title: t("setupModal.steps.cline.setBaseUrl.title"),
        },
        {
          content: t("setupModal.steps.cline.setApiKey.content"),
          title: t("setupModal.steps.cline.setApiKey.title"),
        },
      ],
    },
    continue: {
      description: t("setupModal.description.continue"),
      logo: "/logos/continue.svg",
      name: "Continue",
      steps: [
        {
          content: t("setupModal.steps.continue.openConfig.content"),
          title: t("setupModal.steps.continue.openConfig.title"),
        },
        {
          content: "",
          copyable: true,
          title: t("setupModal.steps.continue.addModelConfiguration.title"),
        },
        {
          content: t("setupModal.steps.continue.saveAndReload.content"),
          title: t("setupModal.steps.continue.saveAndReload.title"),
        },
      ],
    },
    cursor: {
      description: t("setupModal.description.cursor"),
      logo: "/logos/cursor.svg",
      name: "Cursor",
      steps: [
        {
          content: t("setupModal.steps.cursor.openSettings.content"),
          title: t("setupModal.steps.cursor.openSettings.title"),
        },
        {
          content: "",
          copyable: true,
          title: t("setupModal.steps.cursor.setApiBaseUrl.title"),
        },
        {
          content: t("setupModal.steps.cursor.setApiKey.content"),
          copyable: false,
          title: t("setupModal.steps.cursor.setApiKey.title"),
        },
        {
          content: t("setupModal.steps.cursor.selectModel.content"),
          title: t("setupModal.steps.cursor.selectModel.title"),
        },
      ],
    },
  };
}

export function SetupModal(props: SetupModalProps) {
  const { t } = useI18n();
  const [copiedIndex, setCopiedIndex] = createSignal<number | null>(null);

  const handleCopy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      toastStore.success(t("common.copied"));
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      toastStore.error(t("common.copyFailed"));
    }
  };

  const getCopyableContent = (tool: Tool, stepIndex: number): string => {
    const endpoint = props.endpoint;

    if (tool === "cursor" && stepIndex === 1) {
      return endpoint;
    }
    if (tool === "cline" && stepIndex === 2) {
      return endpoint;
    }
    if (tool === "continue" && stepIndex === 1) {
      return JSON.stringify(
        {
          models: [
            {
              apiBase: endpoint,
              apiKey: "proxypal",
              model: "gpt-4",
              provider: "openai",
              title: "ProxyPal",
            },
          ],
        },
        null,
        2,
      );
    }
    return "";
  };

  return (
    <Show when={props.tool}>
      {(tool) => {
        const info = getToolInfo(t)[tool()];
        return (
          <div
            class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={(e) => e.target === e.currentTarget && props.onClose()}
          >
            <div class="animate-scale-in max-h-[90vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
              {/* Header */}
              <div class="flex items-center gap-4 border-b border-gray-200 p-6 dark:border-gray-800">
                <div class="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800">
                  <img alt={info.name} class="h-8 w-8" src={info.logo} />
                </div>
                <div class="flex-1">
                  <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100">
                    {t("setupModal.setupTool", { name: info.name })}
                  </h2>
                  <p class="text-sm text-gray-500 dark:text-gray-400">{info.description}</p>
                </div>
                <button
                  class="text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
                  onClick={props.onClose}
                >
                  <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      d="M6 18L18 6M6 6l12 12"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                    />
                  </svg>
                </button>
              </div>

              {/* Steps */}
              <div class="max-h-[60vh] space-y-4 overflow-y-auto p-6">
                {info.steps.map((step, index) => (
                  <div class="flex gap-4">
                    <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
                      {index + 1}
                    </div>
                    <div class="min-w-0 flex-1">
                      <h3 class="mb-1 font-medium text-gray-900 dark:text-gray-100">
                        {step.title}
                      </h3>
                      {step.content && (
                        <p class="text-sm text-gray-600 dark:text-gray-400">{step.content}</p>
                      )}
                      {step.copyable && (
                        <div class="relative mt-2">
                          <pre class="overflow-x-auto rounded-lg bg-gray-100 p-3 font-mono text-xs text-gray-800 dark:bg-gray-800 dark:text-gray-200">
                            {getCopyableContent(tool(), index)}
                          </pre>
                          <button
                            class="absolute right-2 top-2 rounded-md bg-white p-1.5 shadow-sm transition-colors hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-600"
                            onClick={() => handleCopy(getCopyableContent(tool(), index), index)}
                          >
                            {copiedIndex() === index ? (
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
                                class="h-4 w-4 text-gray-500"
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
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div class="border-t border-gray-200 bg-gray-50 p-6 dark:border-gray-800 dark:bg-gray-800/50">
                <div class="flex items-center justify-between">
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    {t("setupModal.needHelpDocumentation")}
                  </p>
                  <Button onClick={props.onClose} variant="primary">
                    {t("setupModal.done")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      }}
    </Show>
  );
}

import { createEffect, createSignal, For, Show } from "solid-js";
import { useI18n } from "../i18n";
import {
  type AgentConfigResult,
  type AgentStatus,
  type AvailableModel,
  appendToShellProfile,
  configureCliAgent,
  detectCliAgents,
  getAvailableModels,
  testAgentConnection,
} from "../lib/tauri";
import { appStore } from "../stores/app";
import { toastStore } from "../stores/toast";
import { Button } from "./ui";

interface AgentCardProps {
  agent: AgentStatus;
  configuring: boolean;
  onConfigure: (agentId: string) => void;
  onTest: (agentId: string) => void;
  testing: boolean;
}

function AgentCard(props: AgentCardProps) {
  const { t } = useI18n();
  const statusColor = () => {
    if (props.agent.configured) {
      return "bg-green-500";
    }
    if (props.agent.installed) {
      return "bg-amber-500";
    }
    return "bg-gray-400";
  };

  const statusText = () => {
    if (props.agent.configured) {
      return t("agentSetup.status.configured");
    }
    if (props.agent.installed) {
      return t("agentSetup.status.installed");
    }
    return t("agentSetup.status.notInstalled");
  };

  return (
    <div class="hover-lift rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-brand-500 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-brand-500">
      <div class="flex items-start gap-3">
        <img
          alt={props.agent.name}
          class="h-10 w-10 rounded-lg"
          onError={(e) => {
            // Fallback to a generic icon if logo fails to load
            (e.target as HTMLImageElement).src = "/logos/openai.svg";
          }}
          src={props.agent.logo}
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h3 class="font-semibold text-gray-900 dark:text-gray-100">{props.agent.name}</h3>
            <div class="flex items-center gap-1.5">
              <div class={`h-2 w-2 rounded-full ${statusColor()}`} />
              <span class="text-xs text-gray-500 dark:text-gray-400">{statusText()}</span>
            </div>
          </div>
          <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{props.agent.description}</p>
          <div class="mt-3 flex items-center gap-2">
            <Show when={props.agent.installed && !props.agent.configured}>
              <Button
                disabled={props.configuring}
                onClick={() => props.onConfigure(props.agent.id)}
                size="sm"
                variant="primary"
              >
                {props.configuring ? (
                  <span class="flex items-center gap-1.5">
                    <svg class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
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
                    {t("agentSetup.actions.configuring")}
                  </span>
                ) : (
                  t("agentSetup.actions.configure")
                )}
              </Button>
            </Show>
            <Show when={props.agent.configured}>
              <span class="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M5 13l4 4L19 7"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
                {t("agentSetup.status.ready")}
              </span>
              <Button
                disabled={props.configuring}
                onClick={() => props.onConfigure(props.agent.id)}
                size="sm"
                title={t("agentSetup.actions.updateConfiguration")}
                variant="ghost"
              >
                {props.configuring ? (
                  <svg class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
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
                ) : (
                  <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                    />
                  </svg>
                )}
              </Button>
              <Button
                disabled={props.testing}
                onClick={() => props.onTest(props.agent.id)}
                size="sm"
                variant="secondary"
              >
                {props.testing ? (
                  <span class="flex items-center gap-1.5">
                    <svg class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
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
                    {t("agentSetup.actions.testing")}
                  </span>
                ) : (
                  <span class="flex items-center gap-1.5">
                    <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                      />
                    </svg>
                    {t("agentSetup.actions.test")}
                  </span>
                )}
              </Button>
            </Show>
            <a
              class="text-xs text-gray-400 transition-colors hover:text-brand-500"
              href={props.agent.docsUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              {t("agentSetup.actions.docs")}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ConfigModalProps {
  agentName: string;
  onApplyEnv: () => void;
  onClose: () => void;
  result: AgentConfigResult;
}

function ConfigModal(props: ConfigModalProps) {
  const { t } = useI18n();
  const [copied, setCopied] = createSignal(false);

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div class="animate-scale-in w-full max-w-lg rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
        <div class="p-6">
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100">
              {t("agentSetup.configModal.agentConfigured", {
                agent: props.agentName,
              })}
            </h2>
            <button
              class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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
          </div>

          <div class="space-y-4">
            <Show when={props.result.configPath}>
              <div class="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
                <div class="flex items-center gap-2 text-green-700 dark:text-green-300">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      d="M5 13l4 4L19 7"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                    />
                  </svg>
                  <span class="text-sm font-medium">
                    {t("agentSetup.configModal.configFileCreated")}
                  </span>
                </div>
                <p class="mt-1 break-all font-mono text-xs text-green-600 dark:text-green-400">
                  {props.result.configPath}
                </p>
              </div>
            </Show>

            <Show when={props.result.shellConfig}>
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t("agentSetup.configModal.environmentVariables")}
                  </span>
                  <button
                    class="text-xs text-brand-500 hover:text-brand-600"
                    onClick={() => copyToClipboard(props.result.shellConfig!)}
                  >
                    {copied() ? t("agentSetup.configModal.copied") : t("common.copy")}
                  </button>
                </div>
                <pre class="overflow-x-auto whitespace-pre-wrap rounded-lg bg-gray-100 p-3 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  {props.result.shellConfig}
                </pre>
                <Button class="w-full" onClick={props.onApplyEnv} size="sm" variant="secondary">
                  {t("agentSetup.configModal.addToShellProfileAutomatically")}
                </Button>
              </div>
            </Show>

            <div class="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
              <p class="text-sm text-blue-700 dark:text-blue-300">{props.result.instructions}</p>
            </div>
          </div>

          <div class="mt-6 flex justify-end">
            <Button onClick={props.onClose} variant="primary">
              {t("agentSetup.configModal.done")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgentSetup() {
  const { t } = useI18n();
  const { proxyStatus } = appStore;
  const [agents, setAgents] = createSignal<AgentStatus[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [configuring, setConfiguring] = createSignal<string | null>(null);
  const [testing, setTesting] = createSignal<string | null>(null);
  const [configResult, setConfigResult] = createSignal<{
    agentName: string;
    result: AgentConfigResult;
  } | null>(null);

  const loadAgents = async () => {
    setLoading(true);
    try {
      const detected = await detectCliAgents();
      setAgents(detected);
    } catch (error) {
      console.error("Failed to detect agents:", error);
      toastStore.error(t("agentSetup.toasts.failedToDetectCliAgents"));
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    loadAgents();
  });

  const handleConfigure = async (agentId: string) => {
    // Agents that need models from the proxy (they configure with available model list)
    const agentsNeedingModels = ["factory-droid", "opencode"];
    const needsModels = agentsNeedingModels.includes(agentId);

    if (needsModels && !proxyStatus().running) {
      toastStore.warning(
        t("agentSetup.toasts.startProxyFirst"),
        t("agentSetup.toasts.proxyMustRunToConfigureAgent"),
      );
      return;
    }

    setConfiguring(agentId);
    try {
      // Fetch available models only for agents that need them
      let models: AvailableModel[] = [];
      if (needsModels) {
        models = await getAvailableModels();
        if (models.length === 0) {
          toastStore.warning(
            t("agentSetup.toasts.noModelsAvailable"),
            t("agentSetup.toasts.connectProviderToConfigureAgents"),
          );
          return;
        }
      }
      const result = await configureCliAgent(agentId, models);
      const agent = agents().find((a) => a.id === agentId);

      if (result.success) {
        setConfigResult({
          agentName: agent?.name || agentId,
          result,
        });

        // Refresh agent list to show updated status
        await loadAgents();
        toastStore.success(
          t("agentSetup.toasts.agentConfigured", {
            name: agent?.name || agentId,
          }),
        );
      }
    } catch (error) {
      console.error("Failed to configure agent:", error);
      toastStore.error(t("agentSetup.toasts.configurationFailed"), String(error));
    } finally {
      setConfiguring(null);
    }
  };

  const handleTest = async (agentId: string) => {
    if (!proxyStatus().running) {
      toastStore.warning(
        t("agentSetup.toasts.startProxyFirst"),
        t("agentSetup.toasts.proxyMustRunToTestConnections"),
      );
      return;
    }

    const agent = agents().find((a) => a.id === agentId);
    setTesting(agentId);
    try {
      const result = await testAgentConnection(agentId);
      if (result.success) {
        const latencyText = result.latencyMs ? ` (${result.latencyMs}ms)` : "";
        toastStore.success(
          t("agentSetup.toasts.agentConnected", {
            name: agent?.name || agentId,
          }),
          t("agentSetup.toasts.connectionSuccessful", { latency: latencyText }),
        );
      } else {
        toastStore.error(
          t("agentSetup.toasts.agentFailed", { name: agent?.name || agentId }),
          result.message,
        );
      }
    } catch (error) {
      console.error("Failed to test agent:", error);
      toastStore.error(t("agentSetup.toasts.testFailed"), String(error));
    } finally {
      setTesting(null);
    }
  };

  const handleApplyEnv = async () => {
    const result = configResult();
    if (!result?.result.shellConfig) {
      return;
    }

    try {
      const profilePath = await appendToShellProfile(result.result.shellConfig);
      toastStore.success(
        t("agentSetup.toasts.addedToShellProfile"),
        t("agentSetup.toasts.updatedPath", { path: profilePath }),
      );
      setConfigResult(null);
      await loadAgents();
    } catch (error) {
      toastStore.error(t("agentSetup.toasts.failedToUpdateShellProfile"), String(error));
    }
  };

  const installedAgents = () => agents().filter((a) => a.installed);
  const notInstalledAgents = () => agents().filter((a) => !a.installed);
  const configuredCount = () => agents().filter((a) => a.configured).length;

  return (
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
            {t("agentSetup.title")}
          </h2>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-500">
            {t("agentSetup.configuredSummary", {
              configured: configuredCount(),
              total: agents().length,
            })}
          </p>
        </div>
        <button
          class="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          onClick={loadAgents}
          title={t("agentSetup.actions.refresh")}
        >
          <svg
            class={`h-4 w-4 ${loading() ? "animate-spin" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
        </button>
      </div>

      <Show when={!proxyStatus().running}>
        <div class="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
          <div class="flex items-center gap-2 text-amber-700 dark:text-amber-300">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
            <span class="text-sm">{t("agentSetup.startProxyToConfigureAgents")}</span>
          </div>
        </div>
      </Show>

      <Show when={loading()}>
        <div class="flex items-center justify-center py-8">
          <svg class="h-6 w-6 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
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
        </div>
      </Show>

      <Show when={!loading()}>
        <Show when={installedAgents().length > 0}>
          <div class="space-y-3">
            <For each={installedAgents()}>
              {(agent) => (
                <AgentCard
                  agent={agent}
                  configuring={configuring() === agent.id}
                  onConfigure={handleConfigure}
                  onTest={handleTest}
                  testing={testing() === agent.id}
                />
              )}
            </For>
          </div>
        </Show>

        <Show when={notInstalledAgents().length > 0}>
          <div class="mt-6">
            <h3 class="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-500">
              {t("agentSetup.notInstalled")}
            </h3>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <For each={notInstalledAgents()}>
                {(agent) => (
                  <a
                    class="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800/50 dark:hover:border-gray-600"
                    href={agent.docsUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <img
                      alt={agent.name}
                      class="h-5 w-5 rounded opacity-50"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "/logos/openai.svg";
                      }}
                      src={agent.logo}
                    />
                    <span class="truncate text-xs text-gray-500 dark:text-gray-400">
                      {agent.name}
                    </span>
                  </a>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={agents().length === 0}>
          <div class="py-8 text-center">
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {t("agentSetup.noCliAgentsDetected")}
            </p>
          </div>
        </Show>
      </Show>

      <Show when={configResult()}>
        <ConfigModal
          agentName={configResult()!.agentName}
          onApplyEnv={handleApplyEnv}
          onClose={() => setConfigResult(null)}
          result={configResult()!.result}
        />
      </Show>
    </div>
  );
}

// Compact version for dashboard
export function AgentSetupCard() {
  const { t } = useI18n();
  const [agents, setAgents] = createSignal<AgentStatus[]>([]);
  const [loading, setLoading] = createSignal(true);

  createEffect(() => {
    detectCliAgents()
      .then(setAgents)
      .catch(console.error)
      .finally(() => setLoading(false));
  });

  const configuredCount = () => agents().filter((a) => a.configured).length;
  const installedCount = () => agents().filter((a) => a.installed).length;

  return (
    <div class="rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-purple-50 p-4 dark:border-brand-800 dark:from-brand-900/20 dark:to-purple-900/20">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 dark:bg-brand-900/50">
            <svg
              class="h-5 w-5 text-brand-600 dark:text-brand-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
          </div>
          <div>
            <h3 class="font-semibold text-gray-900 dark:text-gray-100">{t("agentSetup.title")}</h3>
            <Show
              fallback={<p class="text-xs text-gray-500">{t("common.loading")}...</p>}
              when={!loading()}
            >
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {t("agentSetup.cardConfiguredSummary", {
                  configured: configuredCount(),
                  installed: installedCount(),
                })}
              </p>
            </Show>
          </div>
        </div>
        <Show when={!loading() && installedCount() > configuredCount()}>
          <span class="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            {t("agentSetup.pendingCount", {
              count: installedCount() - configuredCount(),
            })}
          </span>
        </Show>
      </div>
    </div>
  );
}

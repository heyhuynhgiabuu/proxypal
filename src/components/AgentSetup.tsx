import { createSignal, createEffect, For, Show } from "solid-js";
import { Button } from "./ui";
import {
  detectCliAgents,
  configureCliAgent,
  appendToShellProfile,
  testAgentConnection,
  getAvailableModels,
  type AgentStatus,
  type AgentConfigResult,
  type AvailableModel,
} from "../lib/tauri";
import { toastStore } from "../stores/toast";
import { appStore } from "../stores/app";

interface AgentCardProps {
  agent: AgentStatus;
  onConfigure: (agentId: string) => void;
  onTest: (agentId: string) => void;
  configuring: boolean;
  testing: boolean;
}

function AgentCard(props: AgentCardProps) {
  const statusColor = () => {
    if (props.agent.configured) return "bg-green-500";
    if (props.agent.installed) return "bg-amber-500";
    return "bg-gray-400";
  };

  const statusText = () => {
    if (props.agent.configured) return "Configured";
    if (props.agent.installed) return "Installed";
    return "Not installed";
  };

  return (
    <div class="p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-brand-500 dark:hover:border-brand-500 transition-all hover-lift">
      <div class="flex items-start gap-3">
        <img
          src={props.agent.logo}
          alt={props.agent.name}
          class="w-10 h-10 rounded-lg"
          onError={(e) => {
            // Fallback to a generic icon if logo fails to load
            (e.target as HTMLImageElement).src = "/logos/openai.svg";
          }}
        />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <h3 class="font-semibold text-gray-900 dark:text-gray-100">
              {props.agent.name}
            </h3>
            <div class="flex items-center gap-1.5">
              <div class={`w-2 h-2 rounded-full ${statusColor()}`} />
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {statusText()}
              </span>
            </div>
          </div>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {props.agent.description}
          </p>
          <div class="flex items-center gap-2 mt-3">
            <Show when={props.agent.installed && !props.agent.configured}>
              <Button
                size="sm"
                variant="primary"
                onClick={() => props.onConfigure(props.agent.id)}
                disabled={props.configuring}
              >
                {props.configuring ? (
                  <span class="flex items-center gap-1.5">
                    <svg
                      class="w-3 h-3 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
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
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Configuring...
                  </span>
                ) : (
                  "Configure"
                )}
              </Button>
            </Show>
            <Show when={props.agent.configured}>
              <span class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/30 rounded-full">
                <svg
                  class="w-3 h-3"
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
                Ready
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => props.onConfigure(props.agent.id)}
                disabled={props.configuring}
                title="Update configuration with latest models"
              >
                {props.configuring ? (
                  <svg
                    class="w-3.5 h-3.5 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
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
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                ) : (
                  <svg
                    class="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                )}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => props.onTest(props.agent.id)}
                disabled={props.testing}
              >
                {props.testing ? (
                  <span class="flex items-center gap-1.5">
                    <svg
                      class="w-3 h-3 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
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
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Testing...
                  </span>
                ) : (
                  <span class="flex items-center gap-1.5">
                    <svg
                      class="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                    Test
                  </span>
                )}
              </Button>
            </Show>
            <a
              href={props.agent.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="text-xs text-gray-400 hover:text-brand-500 transition-colors"
            >
              Docs
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ConfigModalProps {
  result: AgentConfigResult;
  agentName: string;
  onClose: () => void;
  onApplyEnv: () => void;
}

function ConfigModal(props: ConfigModalProps) {
  const [copied, setCopied] = createSignal(false);

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in">
      <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg animate-scale-in">
        <div class="p-6">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100">
              {props.agentName} Configured
            </h2>
            <button
              onClick={props.onClose}
              class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div class="space-y-4">
            <Show when={props.result.configPath}>
              <div class="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                <div class="flex items-center gap-2 text-green-700 dark:text-green-300">
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
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span class="text-sm font-medium">Config file created</span>
                </div>
                <p class="mt-1 text-xs text-green-600 dark:text-green-400 font-mono break-all">
                  {props.result.configPath}
                </p>
              </div>
            </Show>

            <Show when={props.result.shellConfig}>
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Environment Variables
                  </span>
                  <button
                    onClick={() => copyToClipboard(props.result.shellConfig!)}
                    class="text-xs text-brand-500 hover:text-brand-600"
                  >
                    {copied() ? "Copied!" : "Copy"}
                  </button>
                </div>
                <pre class="p-3 rounded-lg bg-gray-100 dark:bg-gray-800 text-xs font-mono text-gray-700 dark:text-gray-300 overflow-x-auto whitespace-pre-wrap">
                  {props.result.shellConfig}
                </pre>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={props.onApplyEnv}
                  class="w-full"
                >
                  Add to Shell Profile Automatically
                </Button>
              </div>
            </Show>

            <div class="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <p class="text-sm text-blue-700 dark:text-blue-300">
                {props.result.instructions}
              </p>
            </div>
          </div>

          <div class="mt-6 flex justify-end">
            <Button variant="primary" onClick={props.onClose}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgentSetup() {
  const { proxyStatus } = appStore;
  const [agents, setAgents] = createSignal<AgentStatus[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [configuring, setConfiguring] = createSignal<string | null>(null);
  const [testing, setTesting] = createSignal<string | null>(null);
  const [configResult, setConfigResult] = createSignal<{
    result: AgentConfigResult;
    agentName: string;
  } | null>(null);

  const loadAgents = async () => {
    setLoading(true);
    try {
      const detected = await detectCliAgents();
      setAgents(detected);
    } catch (error) {
      console.error("Failed to detect agents:", error);
      toastStore.error("Failed to detect CLI agents");
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
        "Start the proxy first",
        "The proxy must be running to configure this agent",
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
            "No models available",
            "Connect at least one provider to configure agents",
          );
          return;
        }
      }
      const result = await configureCliAgent(agentId, models);
      const agent = agents().find((a) => a.id === agentId);

      if (result.success) {
        setConfigResult({
          result,
          agentName: agent?.name || agentId,
        });

        // Refresh agent list to show updated status
        await loadAgents();
        toastStore.success(`${agent?.name || agentId} configured!`);
      }
    } catch (error) {
      console.error("Failed to configure agent:", error);
      toastStore.error("Configuration failed", String(error));
    } finally {
      setConfiguring(null);
    }
  };

  const handleTest = async (agentId: string) => {
    if (!proxyStatus().running) {
      toastStore.warning(
        "Start the proxy first",
        "The proxy must be running to test connections",
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
          `${agent?.name || agentId} connected!`,
          `Connection successful${latencyText}`,
        );
      } else {
        toastStore.error(`${agent?.name || agentId} failed`, result.message);
      }
    } catch (error) {
      console.error("Failed to test agent:", error);
      toastStore.error("Test failed", String(error));
    } finally {
      setTesting(null);
    }
  };

  const handleApplyEnv = async () => {
    const result = configResult();
    if (!result?.result.shellConfig) return;

    try {
      const profilePath = await appendToShellProfile(result.result.shellConfig);
      toastStore.success("Added to shell profile", `Updated ${profilePath}`);
      setConfigResult(null);
      await loadAgents();
    } catch (error) {
      toastStore.error("Failed to update shell profile", String(error));
    }
  };

  const installedAgents = () => agents().filter((a) => a.installed);
  const notInstalledAgents = () => agents().filter((a) => !a.installed);
  const configuredCount = () => agents().filter((a) => a.configured).length;

  return (
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
            CLI Agents
          </h2>
          <p class="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
            {configuredCount()} of {agents().length} configured
          </p>
        </div>
        <button
          onClick={loadAgents}
          class="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          title="Refresh"
        >
          <svg
            class={`w-4 h-4 ${loading() ? "animate-spin" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      <Show when={!proxyStatus().running}>
        <div class="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <div class="flex items-center gap-2 text-amber-700 dark:text-amber-300">
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
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span class="text-sm">Start the proxy to configure agents</span>
          </div>
        </div>
      </Show>

      <Show when={loading()}>
        <div class="flex items-center justify-center py-8">
          <svg
            class="w-6 h-6 animate-spin text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
          >
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
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
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
                  onConfigure={handleConfigure}
                  onTest={handleTest}
                  configuring={configuring() === agent.id}
                  testing={testing() === agent.id}
                />
              )}
            </For>
          </div>
        </Show>

        <Show when={notInstalledAgents().length > 0}>
          <div class="mt-6">
            <h3 class="text-xs font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider mb-3">
              Not Installed
            </h3>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <For each={notInstalledAgents()}>
                {(agent) => (
                  <a
                    href={agent.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                  >
                    <img
                      src={agent.logo}
                      alt={agent.name}
                      class="w-5 h-5 rounded opacity-50"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          "/logos/openai.svg";
                      }}
                    />
                    <span class="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {agent.name}
                    </span>
                  </a>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={agents().length === 0}>
          <div class="text-center py-8">
            <p class="text-sm text-gray-500 dark:text-gray-400">
              No CLI agents detected
            </p>
          </div>
        </Show>
      </Show>

      <Show when={configResult()}>
        <ConfigModal
          result={configResult()!.result}
          agentName={configResult()!.agentName}
          onClose={() => setConfigResult(null)}
          onApplyEnv={handleApplyEnv}
        />
      </Show>
    </div>
  );
}

// Compact version for dashboard
export function AgentSetupCard() {
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
    <div class="p-4 rounded-xl bg-gradient-to-br from-brand-50 to-purple-50 dark:from-brand-900/20 dark:to-purple-900/20 border border-brand-200 dark:border-brand-800">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-brand-100 dark:bg-brand-900/50 flex items-center justify-center">
            <svg
              class="w-5 h-5 text-brand-600 dark:text-brand-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <div>
            <h3 class="font-semibold text-gray-900 dark:text-gray-100">
              CLI Agents
            </h3>
            <Show
              when={!loading()}
              fallback={<p class="text-xs text-gray-500">Loading...</p>}
            >
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {configuredCount()}/{installedCount()} configured
              </p>
            </Show>
          </div>
        </div>
        <Show when={!loading() && installedCount() > configuredCount()}>
          <span class="px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 rounded-full">
            {installedCount() - configuredCount()} pending
          </span>
        </Show>
      </div>
    </div>
  );
}

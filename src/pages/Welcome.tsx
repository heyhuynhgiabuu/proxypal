import { Button } from "../components/ui";
import { ProviderCard } from "../components/ProviderCard";
import { appStore } from "../stores/app";
import { openOAuth, type Provider } from "../lib/tauri";

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
];

export function WelcomePage() {
  const { authStatus, setCurrentPage } = appStore;

  const handleConnect = async (provider: Provider) => {
    try {
      await openOAuth(provider);
    } catch (error) {
      console.error("Failed to start OAuth:", error);
    }
  };

  const hasAnyConnection = () => {
    const status = authStatus();
    return status.claude || status.openai || status.gemini || status.qwen;
  };

  return (
    <div class="min-h-screen flex flex-col">
      {/* Header */}
      <header class="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
            <span class="text-white text-xl">⚡</span>
          </div>
          <div>
            <h1 class="font-bold text-lg text-gray-900 dark:text-gray-100">
              ProxyPal
            </h1>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              Use your AI subscriptions everywhere
            </p>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main class="flex-1 p-6">
        <div class="max-w-2xl mx-auto">
          {/* Welcome message */}
          <div class="text-center mb-8">
            <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              Connect your AI accounts
            </h2>
            <p class="text-gray-600 dark:text-gray-400">
              Link your existing subscriptions to use them with any AI coding
              tool.
              <br />
              No separate API keys needed.
            </p>
          </div>

          {/* Provider cards */}
          <div class="grid grid-cols-2 gap-4 mb-8">
            {providers.map((provider) => (
              <ProviderCard
                name={provider.name}
                provider={provider.provider}
                logo={provider.logo}
                description={provider.description}
                connected={authStatus()[provider.provider]}
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

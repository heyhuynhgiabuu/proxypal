import { createSignal } from "solid-js";
import { Button } from "./ui";
import type { Provider } from "../lib/tauri";

interface ProviderCardProps {
  name: string;
  provider: Provider;
  icon?: string;
  logo?: string;
  connected: boolean;
  description: string;
  onConnect: (provider: Provider) => Promise<void>;
}

export function ProviderCard(props: ProviderCardProps) {
  const [loading, setLoading] = createSignal(false);

  const handleConnect = async () => {
    setLoading(true);
    try {
      await props.onConnect(props.provider);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      class={`relative p-5 rounded-xl border-2 transition-all duration-200 cursor-pointer hover:shadow-lg ${
        props.connected
          ? "border-green-500 bg-green-50 dark:bg-green-950/20"
          : "border-gray-200 dark:border-gray-700 hover:border-brand-500"
      }`}
    >
      {/* Status indicator */}
      {props.connected && (
        <div class="absolute top-3 right-3">
          <span class="flex h-3 w-3">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
          </span>
        </div>
      )}

      {/* Icon */}
      <div class="w-12 h-12 mb-3 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 overflow-hidden">
        {props.logo ? (
          <img src={props.logo} alt={props.name} class="w-10 h-10 rounded" />
        ) : (
          <span class="text-2xl">{props.icon}</span>
        )}
      </div>

      {/* Content */}
      <h3 class="font-semibold text-gray-900 dark:text-gray-100">
        {props.name}
      </h3>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4">
        {props.description}
      </p>

      {/* Action */}
      {props.connected ? (
        <div class="flex items-center text-green-600 dark:text-green-400 text-sm font-medium">
          <svg class="w-4 h-4 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fill-rule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clip-rule="evenodd"
            />
          </svg>
          Connected
        </div>
      ) : (
        <Button
          variant="primary"
          size="sm"
          loading={loading()}
          onClick={handleConnect}
        >
          Connect
        </Button>
      )}
    </div>
  );
}

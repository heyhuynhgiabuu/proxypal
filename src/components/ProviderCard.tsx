import { createSignal } from "solid-js";
import { Button } from "./ui";

import type { Provider } from "../lib/tauri";

interface ProviderCardProps {
  connected: number; // Account count (0 = not connected, >0 = connected)
  connecting?: boolean;
  description: string;
  icon?: string;
  logo?: string;
  name: string;
  onConnect: (provider: Provider) => Promise<void>;
  provider: Provider;
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

  // Use external connecting state if provided, otherwise use internal loading state
  const isLoading = () => props.connecting ?? loading();

  // Check if connected (account count > 0)
  const isConnected = () => props.connected > 0;

  return (
    <div
      class={`relative cursor-pointer rounded-xl border-2 p-5 transition-all duration-200 hover:shadow-lg ${
        isConnected()
          ? "border-green-500 bg-green-50 dark:bg-green-950/20"
          : "border-gray-200 hover:border-brand-500 dark:border-gray-700"
      }`}
    >
      {/* Status indicator */}
      {isConnected() && (
        <div class="absolute right-3 top-3">
          <span class="flex h-3 w-3">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
            <span class="relative inline-flex h-3 w-3 rounded-full bg-green-500"></span>
          </span>
        </div>
      )}

      {/* Icon */}
      <div class="mb-3 flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
        {props.logo ? (
          <img alt={props.name} class="h-10 w-10 rounded" src={props.logo} />
        ) : (
          <span class="text-2xl">{props.icon}</span>
        )}
      </div>

      {/* Content */}
      <h3 class="font-semibold text-gray-900 dark:text-gray-100">{props.name}</h3>
      <p class="mb-4 mt-1 text-sm text-gray-500 dark:text-gray-400">{props.description}</p>

      {/* Action */}
      {isConnected() ? (
        <div class="flex items-center justify-between">
          <div class="flex items-center text-sm font-medium text-green-600 dark:text-green-400">
            <svg class="mr-1.5 h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                clip-rule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                fill-rule="evenodd"
              />
            </svg>
            {props.connected} account{props.connected > 1 ? "s" : ""}
          </div>
          <Button
            class="px-2 py-1 text-xs"
            loading={isLoading()}
            onClick={handleConnect}
            size="sm"
            variant="ghost"
          >
            + Add
          </Button>
        </div>
      ) : (
        <Button loading={isLoading()} onClick={handleConnect} size="sm" variant="primary">
          Connect
        </Button>
      )}
    </div>
  );
}

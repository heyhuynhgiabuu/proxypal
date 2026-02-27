import { Show } from "solid-js";

import type { JSX } from "solid-js";

interface EmptyStateProps {
  action?: {
    label: string;
    onClick: () => void;
  };
  description: string;
  hint?: string;
  icon: JSX.Element;
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  title: string;
}

export function EmptyState(props: EmptyStateProps) {
  return (
    <div class="animate-fade-in flex flex-col items-center justify-center px-6 py-12 text-center">
      {/* Icon container with gradient background */}
      <div class="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 shadow-sm dark:from-gray-800 dark:to-gray-700">
        <div class="text-gray-400 dark:text-gray-500">{props.icon}</div>
      </div>

      {/* Title */}
      <h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">{props.title}</h3>

      {/* Description */}
      <p class="mb-6 max-w-xs text-sm leading-relaxed text-gray-500 dark:text-gray-400">
        {props.description}
      </p>

      {/* Actions */}
      <div class="flex flex-col items-center gap-3 sm:flex-row">
        {props.action && (
          <button
            class="hover-lift rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-600 hover:shadow-md"
            onClick={props.action.onClick}
          >
            {props.action.label}
          </button>
        )}
        {props.secondaryAction && (
          <button
            class="rounded-lg bg-gray-100 px-5 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            onClick={props.secondaryAction.onClick}
          >
            {props.secondaryAction.label}
          </button>
        )}
      </div>

      {/* Hint text */}
      <Show when={props.hint}>
        <p class="mt-4 max-w-xs text-xs text-gray-400 dark:text-gray-500">{props.hint}</p>
      </Show>
    </div>
  );
}

// Pre-built empty states for common scenarios
export function NoProvidersEmptyState(props: { onConnect: () => void }) {
  return (
    <EmptyState
      action={{
        label: "Connect your first provider",
        onClick: props.onConnect,
      }}
      description="Connect your AI accounts to start using ProxyPal with your favorite coding tools."
      icon={
        <svg class="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
          />
        </svg>
      }
      title="No providers connected"
    />
  );
}

export function ProxyStoppedEmptyState(props: { onStart: () => void }) {
  return (
    <EmptyState
      action={{
        label: "Start Proxy",
        onClick: props.onStart,
      }}
      description="Start the proxy server to enable AI connections for your coding tools."
      icon={
        <svg class="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
          />
        </svg>
      }
      title="Proxy is offline"
    />
  );
}

export function GettingStartedEmptyState(props: {
  hasConfiguredAgent?: boolean;
  hasProvider?: boolean;
  onDismiss?: () => void;
  onStart: () => void;
  proxyRunning: boolean;
}) {
  // Determine which step is current
  const currentStep = () => {
    if (!props.proxyRunning) {
      return 1;
    }
    if (!props.hasProvider) {
      return 2;
    }
    if (!props.hasConfiguredAgent) {
      return 3;
    }
    return 4; // All done
  };

  const allDone = () => currentStep() === 4;
  const completedSteps = () => {
    let count = 0;
    if (props.proxyRunning) {
      count++;
    }
    if (props.hasProvider) {
      count++;
    }
    if (props.hasConfiguredAgent) {
      count++;
    }
    return count;
  };

  // Show celebration when all done
  if (allDone()) {
    return (
      <div class="animate-fade-in rounded-2xl border border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 p-4 dark:border-green-800 dark:from-green-900/20 dark:to-emerald-900/20 sm:p-6">
        <div class="flex items-start gap-3 sm:gap-4">
          <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-green-500 sm:h-12 sm:w-12">
            <svg
              class="h-5 w-5 text-white sm:h-6 sm:w-6"
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
          </div>
          <div class="min-w-0 flex-1">
            <h3 class="mb-1 font-semibold text-green-800 dark:text-green-200">You're all set!</h3>
            <p class="text-sm text-green-700 dark:text-green-300">
              ProxyPal is configured and ready. Start using your AI tools - all requests will be
              routed through your connected accounts.
            </p>
          </div>
          <Show when={props.onDismiss}>
            <button
              class="rounded-lg p-1 text-green-600 transition-colors hover:bg-green-100 hover:text-green-800 dark:text-green-400 dark:hover:bg-green-800/50 dark:hover:text-green-200"
              onClick={props.onDismiss}
              title="Dismiss"
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
      </div>
    );
  }

  return (
    <div class="animate-fade-in rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-purple-50 p-4 dark:border-brand-800 dark:from-brand-900/20 dark:to-purple-900/20 sm:p-6">
      <div class="flex flex-col items-start gap-3 sm:flex-row sm:gap-4">
        {/* Icon */}
        <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-brand-500 sm:h-12 sm:w-12">
          <svg
            class="h-5 w-5 text-white sm:h-6 sm:w-6"
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
        </div>

        {/* Content */}
        <div class="min-w-0 flex-1">
          <div class="mb-1 flex items-center justify-between">
            <h3 class="font-semibold text-gray-900 dark:text-gray-100">
              {completedSteps() === 0 ? "Welcome to ProxyPal!" : "Almost there!"}
            </h3>
            <span class="text-xs text-gray-500 dark:text-gray-400">
              {completedSteps()}/3 complete
            </span>
          </div>
          <p class="mb-3 text-sm text-gray-600 dark:text-gray-400 sm:mb-4">
            {completedSteps() === 0
              ? "Get started in 3 easy steps:"
              : `Just ${3 - completedSteps()} more step${3 - completedSteps() > 1 ? "s" : ""} to go:`}
          </p>

          {/* Progress bar */}
          <div class="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              class="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all duration-500"
              style={{ width: `${(completedSteps() / 3) * 100}%` }}
            />
          </div>

          {/* Steps */}
          <div class="space-y-2.5 sm:space-y-3">
            <StepItem
              actionLabel={!props.proxyRunning ? "Start Proxy" : undefined}
              current={currentStep() === 1}
              description="Click the toggle in the header"
              done={props.proxyRunning}
              number={1}
              onAction={props.onStart}
              title="Start the proxy"
            />
            <StepItem
              current={currentStep() === 2}
              description="Sign in with Claude, ChatGPT, or Gemini below"
              done={props.hasProvider || false}
              number={2}
              title="Connect a provider"
            />
            <StepItem
              current={currentStep() === 3}
              description="Set up Cursor, Windsurf, or other AI tools"
              done={props.hasConfiguredAgent || false}
              number={3}
              title="Configure your tool"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function StepItem(props: {
  actionLabel?: string;
  current?: boolean;
  description: string;
  done: boolean;
  number: number;
  onAction?: () => void;
  title: string;
}) {
  return (
    <div class="flex items-center gap-3">
      <div
        class={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-all ${
          props.done
            ? "bg-green-500 text-white"
            : props.current
              ? "bg-brand-500 text-white ring-2 ring-brand-300 ring-offset-2 dark:ring-offset-gray-900"
              : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
        }`}
      >
        {props.done ? (
          <svg class="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path
              clip-rule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              fill-rule="evenodd"
            />
          </svg>
        ) : (
          props.number
        )}
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <p
            class={`text-sm font-medium ${
              props.done
                ? "text-green-700 line-through opacity-70 dark:text-green-400"
                : props.current
                  ? "text-gray-900 dark:text-gray-100"
                  : "text-gray-600 dark:text-gray-400"
            }`}
          >
            {props.title}
          </p>
          {props.current && props.actionLabel && props.onAction && (
            <button
              class="rounded bg-brand-500 px-2 py-0.5 text-xs font-medium text-white transition-colors hover:bg-brand-600"
              onClick={props.onAction}
            >
              {props.actionLabel}
            </button>
          )}
        </div>
        {!props.done && <p class="text-xs text-gray-500 dark:text-gray-400">{props.description}</p>}
      </div>
    </div>
  );
}

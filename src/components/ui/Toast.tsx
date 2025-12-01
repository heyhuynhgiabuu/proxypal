import { For } from "solid-js";
import { toastStore, type ToastType } from "../../stores/toast";

const iconMap: Record<ToastType, string> = {
  success: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  error: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z",
  warning:
    "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
  info: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
};

const colorMap: Record<
  ToastType,
  { bg: string; border: string; icon: string; text: string }
> = {
  success: {
    bg: "bg-green-50 dark:bg-green-900/20",
    border: "border-green-200 dark:border-green-800",
    icon: "text-green-500",
    text: "text-green-800 dark:text-green-200",
  },
  error: {
    bg: "bg-red-50 dark:bg-red-900/20",
    border: "border-red-200 dark:border-red-800",
    icon: "text-red-500",
    text: "text-red-800 dark:text-red-200",
  },
  warning: {
    bg: "bg-amber-50 dark:bg-amber-900/20",
    border: "border-amber-200 dark:border-amber-800",
    icon: "text-amber-500",
    text: "text-amber-800 dark:text-amber-200",
  },
  info: {
    bg: "bg-blue-50 dark:bg-blue-900/20",
    border: "border-blue-200 dark:border-blue-800",
    icon: "text-blue-500",
    text: "text-blue-800 dark:text-blue-200",
  },
};

export function ToastContainer() {
  const { toasts, removeToast } = toastStore;

  return (
    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      <For each={toasts()}>
        {(toast) => {
          const colors = colorMap[toast.type];
          return (
            <div
              class={`pointer-events-auto max-w-sm w-full ${colors.bg} ${colors.border} border rounded-xl shadow-lg p-4 flex items-start gap-3 animate-slide-in`}
              role="alert"
            >
              <svg
                class={`w-5 h-5 flex-shrink-0 ${colors.icon}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d={iconMap[toast.type]}
                />
              </svg>
              <div class="flex-1 min-w-0">
                <p class={`text-sm font-medium ${colors.text}`}>
                  {toast.title}
                </p>
                {toast.description && (
                  <p class="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                    {toast.description}
                  </p>
                )}
              </div>
              <button
                class="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                onClick={() => removeToast(toast.id)}
              >
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
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          );
        }}
      </For>
    </div>
  );
}

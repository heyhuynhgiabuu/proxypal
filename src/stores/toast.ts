import { createSignal, createRoot } from "solid-js";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration: number;
}

function createToastStore() {
  const [toasts, setToasts] = createSignal<Toast[]>([]);

  const addToast = (
    toast: Omit<Toast, "id" | "duration"> & { duration?: number },
  ) => {
    const id = Math.random().toString(36).substring(2, 9);
    const duration = toast.duration ?? 4000;
    const newToast: Toast = {
      ...toast,
      id,
      duration,
    };

    setToasts((prev) => [...prev, newToast]);

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }

    return id;
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Convenience methods
  const success = (title: string, description?: string) =>
    addToast({ type: "success", title, description });

  const error = (title: string, description?: string) =>
    addToast({ type: "error", title, description, duration: 6000 });

  const info = (title: string, description?: string) =>
    addToast({ type: "info", title, description });

  const warning = (title: string, description?: string) =>
    addToast({ type: "warning", title, description, duration: 5000 });

  return {
    toasts,
    addToast,
    removeToast,
    success,
    error,
    info,
    warning,
  };
}

export const toastStore = createRoot(createToastStore);

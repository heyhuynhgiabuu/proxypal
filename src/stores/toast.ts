import { createSignal, createRoot } from "solid-js";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  description?: string;
  duration: number;
  id: string;
  title: string;
  type: ToastType;
}

function createToastStore() {
  const [toasts, setToasts] = createSignal<Toast[]>([]);

  const addToast = (toast: Omit<Toast, "id" | "duration"> & { duration?: number }) => {
    const id = Math.random().toString(36).slice(2, 9);
    const duration = toast.duration ?? 4000;
    const newToast: Toast = {
      ...toast,
      duration,
      id,
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
    addToast({ description, title, type: "success" });

  const error = (title: string, description?: string) =>
    addToast({ description, duration: 6000, title, type: "error" });

  const info = (title: string, description?: string) =>
    addToast({ description, title, type: "info" });

  const warning = (title: string, description?: string) =>
    addToast({ description, duration: 5000, title, type: "warning" });

  return {
    addToast,
    error,
    info,
    removeToast,
    success,
    toasts,
    warning,
  };
}

export const toastStore = createRoot(createToastStore);

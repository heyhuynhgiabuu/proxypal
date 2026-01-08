import { Show, type JSX } from "solid-js";
import { Button } from "./ui";

export interface ConfirmModalProps {
    open: boolean;
    title: string;
    message: string | JSX.Element;
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: "primary" | "danger";
    loading?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmModal(props: ConfirmModalProps) {
    return (
        <Show when={props.open}>
            <div
                class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                onClick={(e) => e.target === e.currentTarget && props.onCancel()}
            >
                <div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full overflow-hidden border border-gray-200 dark:border-gray-700 animate-in fade-in zoom-in-95 duration-200">
                    {/* Header */}
                    <div class="px-5 pt-5 pb-4">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                                <svg
                                    class="w-5 h-5 text-amber-600 dark:text-amber-400"
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
                            </div>
                            <h3 class="font-semibold text-gray-900 dark:text-gray-100 text-lg">
                                {props.title}
                            </h3>
                        </div>
                    </div>

                    {/* Content */}
                    <div class="px-5 pb-5">
                        <p class="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                            {props.message}
                        </p>
                    </div>

                    {/* Footer Actions */}
                    <div class="px-5 pb-5 pt-2 flex gap-3 border-t border-gray-100 dark:border-gray-700">
                        <Button
                            variant="secondary"
                            class="flex-1"
                            onClick={props.onCancel}
                            disabled={props.loading}
                        >
                            {props.cancelText || "Cancel"}
                        </Button>
                        <Button
                            variant={props.confirmVariant || "primary"}
                            class="flex-1"
                            onClick={props.onConfirm}
                            loading={props.loading}
                        >
                            {props.confirmText || "Confirm"}
                        </Button>
                    </div>
                </div>
            </div>
        </Show>
    );
}

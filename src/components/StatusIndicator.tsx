interface StatusIndicatorProps {
  disabled?: boolean;
  onToggle: () => void;
  running: boolean;
}

export function StatusIndicator(props: StatusIndicatorProps) {
  return (
    <button
      class={`flex items-center gap-2 rounded-full px-4 py-2 transition-all duration-200 ${
        props.running
          ? "bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
      } ${props.disabled ? "cursor-not-allowed opacity-50" : ""}`}
      disabled={props.disabled}
      onClick={props.onToggle}
    >
      <span class="relative flex h-2.5 w-2.5">
        {props.running && (
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
        )}
        <span
          class={`relative inline-flex h-2.5 w-2.5 rounded-full ${
            props.running ? "bg-green-500" : "bg-gray-400"
          }`}
        ></span>
      </span>
      <span class="text-sm font-medium">{props.running ? "Running" : "Stopped"}</span>
    </button>
  );
}

interface StatusIndicatorProps {
  running: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export function StatusIndicator(props: StatusIndicatorProps) {
  return (
    <button
      onClick={props.onToggle}
      disabled={props.disabled}
      class={`flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-200 ${
        props.running
          ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50"
          : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
      } ${props.disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span class="relative flex h-2.5 w-2.5">
        {props.running && (
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
        )}
        <span
          class={`relative inline-flex rounded-full h-2.5 w-2.5 ${
            props.running ? "bg-green-500" : "bg-gray-400"
          }`}
        ></span>
      </span>
      <span class="text-sm font-medium">
        {props.running ? "Running" : "Stopped"}
      </span>
    </button>
  );
}

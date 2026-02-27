import type { Component } from "solid-js";

interface ProviderBadgeProps {
  size?: "sm" | "md";
  source: string;
}

export const ProviderBadge: Component<ProviderBadgeProps> = (props) => {
  const size = () => props.size ?? "sm";

  const getBadgeConfig = () => {
    switch (props.source) {
      case "vertex":
        return {
          bgColor: "bg-blue-100 dark:bg-blue-900/30",
          dotColor: "bg-blue-500",
          label: "Vertex",
          textColor: "text-blue-700 dark:text-blue-300",
        };
      case "vertex+gemini-api":
        return {
          bgColor: "bg-purple-100 dark:bg-purple-900/30",
          dotColor: "bg-purple-500",
          label: "Vertex+API",
          textColor: "text-purple-700 dark:text-purple-300",
        };
      case "gemini-api":
        return {
          bgColor: "bg-green-100 dark:bg-green-900/30",
          dotColor: "bg-green-500",
          label: "API Key",
          textColor: "text-green-700 dark:text-green-300",
        };
      case "copilot":
        return {
          bgColor: "bg-orange-100 dark:bg-orange-900/30",
          dotColor: "bg-orange-500",
          label: "Copilot",
          textColor: "text-orange-700 dark:text-orange-300",
        };
      case "oauth":
        return {
          bgColor: "bg-indigo-100 dark:bg-indigo-900/30",
          dotColor: "bg-indigo-500",
          label: "OAuth",
          textColor: "text-indigo-700 dark:text-indigo-300",
        };
      case "api-key":
        return {
          bgColor: "bg-green-100 dark:bg-green-900/30",
          dotColor: "bg-green-500",
          label: "API Key",
          textColor: "text-green-700 dark:text-green-300",
        };
      default:
        return {
          bgColor: "bg-gray-100 dark:bg-gray-800",
          dotColor: "bg-gray-500",
          label: props.source || "Unknown",
          textColor: "text-gray-600 dark:text-gray-400",
        };
    }
  };

  const config = () => getBadgeConfig();
  const sizeClasses = () => (size() === "sm" ? "text-xs px-1.5 py-0.5" : "text-sm px-2 py-1");

  return (
    <span
      class={`inline-flex items-center gap-1.5 rounded-full font-medium ${config().bgColor} ${config().textColor} ${sizeClasses()}`}
    >
      <span class={`h-2 w-2 rounded-full ${config().dotColor}`} />
      {config().label}
    </span>
  );
};

export default ProviderBadge;

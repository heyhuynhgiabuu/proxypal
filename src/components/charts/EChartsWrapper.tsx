// eslint-disable-next-line import/no-namespace
import * as echarts from "echarts";
import { createEffect, type JSX, onCleanup } from "solid-js";
import { themeStore } from "../../stores/theme";

// ECharts dark theme
const darkTheme = {
  backgroundColor: "transparent",
  legend: { textStyle: { color: "#9ca3af" } },
  textStyle: { color: "#9ca3af" },
  title: { textStyle: { color: "#f3f4f6" } },
  tooltip: {
    backgroundColor: "rgba(17, 24, 39, 0.95)",
    borderColor: "#374151",
    textStyle: { color: "#f3f4f6" },
  },
};

const lightTheme = {
  backgroundColor: "transparent",
  legend: { textStyle: { color: "#6b7280" } },
  textStyle: { color: "#6b7280" },
  title: { textStyle: { color: "#111827" } },
  tooltip: {
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderColor: "#e5e7eb",
    textStyle: { color: "#111827" },
  },
};

interface EChartsWrapperProps {
  class?: string;
  onChartClick?: (params: echarts.ECElementEvent) => void;
  option: echarts.EChartsOption;
  style?: JSX.CSSProperties;
}

export function EChartsWrapper(props: EChartsWrapperProps) {
  let containerRef: HTMLDivElement | undefined;
  let chart: echarts.ECharts | undefined;

  const initChart = () => {
    if (!containerRef) {
      return;
    }

    // Dispose existing chart
    if (chart) {
      chart.dispose();
    }

    // Create new chart with theme
    const theme = themeStore.resolvedTheme() === "dark" ? darkTheme : lightTheme;
    chart = echarts.init(containerRef, undefined, { renderer: "canvas" });

    // Apply theme via option merge
    const optionWithTheme = {
      ...theme,
      ...props.option,
      tooltip: {
        ...theme.tooltip,
        ...((props.option.tooltip as object) || {}),
      },
    };

    chart.setOption(optionWithTheme);

    // Add click handler
    if (props.onChartClick) {
      chart.on("click", props.onChartClick);
    }
  };

  // Initialize and handle theme changes
  createEffect(() => {
    themeStore.resolvedTheme(); // Subscribe to theme changes
    initChart();
  });

  // Update options reactively
  createEffect(() => {
    if (chart && props.option) {
      const theme = themeStore.resolvedTheme() === "dark" ? darkTheme : lightTheme;
      const optionWithTheme = {
        ...theme,
        ...props.option,
        tooltip: {
          ...theme.tooltip,
          ...((props.option.tooltip as object) || {}),
        },
      };
      chart.setOption(optionWithTheme, { notMerge: true });
    }
  });

  // Handle resize
  createEffect(() => {
    const handleResize = () => chart?.resize();
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
  });

  // Cleanup on unmount
  onCleanup(() => {
    chart?.dispose();
  });

  return (
    <div
      class={props.class}
      ref={containerRef}
      style={{ height: "100%", width: "100%", ...props.style }}
    />
  );
}

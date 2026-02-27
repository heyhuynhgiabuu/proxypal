import { createMemo } from "solid-js";
import { themeStore } from "../../stores/theme";
import { EChartsWrapper } from "./EChartsWrapper";

import type { EChartsOption } from "echarts";

export interface HeatmapData {
  day: number; // 0-6 (Mon-Sun)
  hour: number; // 0-23
  value: number;
}

interface HeatmapChartProps {
  class?: string;
  data: HeatmapData[];
  onClick?: (day: number, hour: number) => void;
  title?: string;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => (i % 3 === 0 ? `${i}:00` : ""));

export function HeatmapChart(props: HeatmapChartProps) {
  const option = createMemo((): EChartsOption => {
    const maxValue = Math.max(...props.data.map((d) => d.value), 1);
    const isDark = themeStore.resolvedTheme() === "dark";

    return {
      grid: {
        bottom: 40,
        left: 50,
        right: 20,
        top: 20,
      },
      series: [
        {
          animationDuration: 1000,
          data: props.data.map((d) => [d.hour, d.day, d.value]),
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: "rgba(0, 0, 0, 0.5)",
            },
          },
          label: { show: false },
          type: "heatmap",
        },
      ],
      tooltip: {
        position: "top",
      },
      visualMap: {
        bottom: 0,
        calculable: true,
        inRange: {
          color: isDark
            ? ["#1e293b", "#3b82f6", "#2563eb"] // slate-800 → blue
            : ["#f1f5f9", "#60a5fa", "#2563eb"], // slate-100 → blue
        },
        left: "center",
        max: maxValue,
        min: 0,
        orient: "horizontal",
        show: false,
      },
      xAxis: {
        axisLabel: { fontSize: 10 },
        axisLine: { show: false },
        axisTick: { show: false },
        data: HOURS,
        splitArea: { show: true },
        type: "category",
      },
      yAxis: {
        axisLine: { show: false },
        axisTick: { show: false },
        data: DAYS,
        splitArea: { show: true },
        type: "category",
      },
    };
  });

  const handleClick = (params: unknown) => {
    const p = params as { data?: [number, number, number] };
    if (props.onClick && p.data) {
      const [hour, day] = p.data;
      props.onClick(day, hour);
    }
  };

  return <EChartsWrapper class={props.class} onChartClick={handleClick} option={option()} />;
}

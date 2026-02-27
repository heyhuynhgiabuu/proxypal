import { createMemo } from "solid-js";
import { EChartsWrapper } from "./EChartsWrapper";

import type { EChartsOption } from "echarts";

export interface DonutChartData {
  color?: string;
  name: string;
  value: number;
}

interface DonutChartProps {
  centerSubtext?: string;
  centerText?: string;
  class?: string;
  data: DonutChartData[];
  onClick?: (name: string) => void;
  title?: string;
}

// High-contrast palette for dark mode visibility
// Primary blue + complementary colors with good distinction
const COLORS = [
  "#3b82f6", // blue-500 (primary)
  "#38bdf8", // sky-400 (contrast)
  "#a78bfa", // violet-400
  "#fb923c", // orange-400
  "#f472b6", // pink-400
  "#22d3ee", // cyan-400
  "#facc15", // yellow-400
  "#94a3b8", // slate-400
];

export function DonutChart(props: DonutChartProps) {
  const option = createMemo(
    (): EChartsOption => ({
      legend: {
        itemGap: 12,
        orient: "vertical",
        right: 10,
        textStyle: { fontSize: 12 },
        top: "center",
      },
      series: [
        {
          animationDuration: 800,
          animationEasing: "elasticOut",
          animationType: "scale",
          avoidLabelOverlap: true,
          center: ["35%", "50%"],
          data: props.data.map((item, index) => ({
            itemStyle: {
              color: item.color || COLORS[index % COLORS.length],
            },
            name: item.name,
            value: item.value,
          })),
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: "rgba(0, 0, 0, 0.3)",
              shadowOffsetX: 0,
            },
            label: {
              fontSize: 14,
              fontWeight: "bold",
              show: true,
            },
          },
          itemStyle: {
            borderColor: "transparent",
            borderRadius: 6,
            borderWidth: 2,
          },
          label: { show: false },
          labelLine: { show: false },
          radius: ["50%", "75%"],
          type: "pie",
        },
      ],
      tooltip: {
        formatter: "{b}: {c} ({d}%)",
        trigger: "item",
      },
    }),
  );

  const handleClick = (params: unknown) => {
    const p = params as { name?: string };
    if (props.onClick && p.name) {
      props.onClick(p.name);
    }
  };

  return <EChartsWrapper class={props.class} onChartClick={handleClick} option={option()} />;
}

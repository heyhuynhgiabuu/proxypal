import { createMemo } from "solid-js";
import { EChartsWrapper } from "./EChartsWrapper";

import type { EChartsOption } from "echarts";

interface GaugeChartProps {
  class?: string;
  title?: string;
  value: number; // 0-100
}

export function GaugeChart(props: GaugeChartProps) {
  const getColor = (value: number) => {
    if (value >= 95) {
      return "#10b981";
    } // green
    if (value >= 80) {
      return "#f59e0b";
    } // amber
    return "#ef4444"; // red
  };

  const option = createMemo(
    (): EChartsOption => ({
      series: [
        {
          animationDuration: 1000,
          animationEasing: "elasticOut",
          axisLabel: {
            color: "#6b7280",
            distance: -35,
            fontSize: 10,
            formatter: (value: number) => {
              if (value === 0 || value === 100) {
                return `${value}%`;
              }
              return "";
            },
          },
          axisLine: {
            lineStyle: {
              color: [
                [0.8, "#ef4444"],
                [0.95, "#f59e0b"],
                [1, "#10b981"],
              ],
              width: 12,
            },
          },
          axisTick: {
            length: 6,
            lineStyle: {
              color: "auto",
              width: 1,
            },
          },
          center: ["50%", "70%"],
          data: [
            {
              name: props.title || "Success Rate",
              value: props.value,
            },
          ],
          detail: {
            color: getColor(props.value),
            fontSize: 28,
            fontWeight: "bold",
            formatter: (value: number) => `${value.toFixed(1)}%`,
            offsetCenter: [0, "-20%"],
            valueAnimation: true,
          },
          endAngle: 0,
          max: 100,
          min: 0,
          pointer: {
            icon: "path://M12.8,0.7l12,40.1H0.7L12.8,0.7z",
            itemStyle: {
              color: getColor(props.value),
            },
            length: "60%",
            offsetCenter: [0, "-10%"],
            width: 8,
          },
          radius: "90%",
          splitLine: {
            length: 10,
            lineStyle: {
              color: "auto",
              width: 2,
            },
          },
          splitNumber: 5,
          startAngle: 180,
          title: {
            color: "#6b7280",
            fontSize: 12,
            offsetCenter: [0, "20%"],
          },
          type: "gauge",
        },
      ],
    }),
  );

  return <EChartsWrapper class={props.class} option={option()} />;
}

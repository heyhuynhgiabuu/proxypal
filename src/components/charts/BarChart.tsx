import { createMemo, type JSX } from "solid-js";
import { EChartsWrapper } from "./EChartsWrapper";

import type { EChartsOption } from "echarts";

export interface BarChartData {
  name: string;
  resetTime?: string;
  secondaryValue?: number;
  value: number;
}

interface BarChartProps {
  class?: string;
  colorByValue?: boolean; // Enable quota-style color coding (green/yellow/red)
  data: BarChartData[];
  horizontal?: boolean;
  onClick?: (name: string) => void;
  secondaryLabel?: string;
  style?: JSX.CSSProperties;
  title?: string;
  valueLabel?: string;
}

export function BarChart(props: BarChartProps) {
  // Get quota-based color gradient
  const getQuotaColor = (value: number) => {
    if (value >= 70) {
      return {
        colorStops: [
          { color: "#10b981", offset: 0 }, // green-500
          { color: "#059669", offset: 1 }, // green-600
        ],
        type: "linear" as const,
        x: props.horizontal ? 0 : 0,
        x2: props.horizontal ? 1 : 0,
        y: props.horizontal ? 0 : 1,
        y2: 0,
      };
    } else if (value >= 30) {
      return {
        colorStops: [
          { color: "#eab308", offset: 0 }, // yellow-500
          { color: "#ca8a04", offset: 1 }, // yellow-600
        ],
        type: "linear" as const,
        x: props.horizontal ? 0 : 0,
        x2: props.horizontal ? 1 : 0,
        y: props.horizontal ? 0 : 1,
        y2: 0,
      };
    } else {
      return {
        colorStops: [
          { color: "#ef4444", offset: 0 }, // red-500
          { color: "#dc2626", offset: 1 }, // red-600
        ],
        type: "linear" as const,
        x: props.horizontal ? 0 : 0,
        x2: props.horizontal ? 1 : 0,
        y: props.horizontal ? 0 : 1,
        y2: 0,
      };
    }
  };

  const option = createMemo((): EChartsOption => {
    const isHorizontal = props.horizontal !== false;
    const sortedData = [...props.data].sort((a, b) => b.value - a.value);

    // Prepare data with colors if colorByValue is enabled
    const chartData = isHorizontal ? [...sortedData].reverse() : sortedData;

    return {
      grid: {
        bottom: 20,
        containLabel: false,
        left: isHorizontal ? 120 : 40,
        right: isHorizontal ? 80 : 20,
        top: isHorizontal ? 20 : 40,
      },
      series: [
        {
          animationDuration: 800,
          animationEasing: "elasticOut",
          barWidth: "60%",
          data: chartData.map((d) => {
            const labelPosition = isHorizontal ? "right" : "top";
            type QuotaColor = ReturnType<typeof getQuotaColor>;
            const item: {
              itemStyle?: {
                color: QuotaColor;
              };
              label: {
                color: string;
                position: "right" | "top";
              };
              value: number;
            } = {
              label: {
                color: "#333",
                position: labelPosition,
              },
              value: d.value,
            };
            if (props.colorByValue) {
              item.itemStyle = {
                color: getQuotaColor(d.value),
              };
            }
            return item;
          }),
          emphasis: {
            itemStyle: {
              color: {
                colorStops: [
                  { color: "#60a5fa", offset: 0 }, // blue-400
                  { color: "#3b82f6", offset: 1 }, // blue-500
                ],
                type: "linear",
                x: isHorizontal ? 0 : 0,
                x2: isHorizontal ? 1 : 0,
                y: isHorizontal ? 0 : 1,
                y2: 0,
              },
            },
          },
          itemStyle: props.colorByValue
            ? { borderRadius: [4, 4, 4, 4] }
            : {
                borderRadius: [4, 4, 4, 4],
                color: {
                  colorStops: [
                    { color: "#3b82f6", offset: 0 }, // blue-500
                    { color: "#2563eb", offset: 1 }, // blue-600
                  ],
                  type: "linear",
                  x: isHorizontal ? 0 : 0,
                  x2: isHorizontal ? 1 : 0,
                  y: isHorizontal ? 0 : 1,
                  y2: 0,
                },
              },
          label: {
            fontSize: 11,
            fontWeight: 500,
            formatter: (params: unknown) => {
              const p = params as { value?: number };
              const val = p.value ?? 0;
              return `${val.toFixed(1)}%`;
            },
            show: true,
          },
          type: "bar",
        },
      ],
      tooltip: {
        appendToBody: true,
        axisPointer: { type: "shadow" },
        confine: true,
        formatter: (params: unknown) => {
          const arr = params as Array<{
            dataIndex?: number;
            name?: string;
            value?: number;
          }>;
          const p = arr[0];
          if (!p) {
            return "";
          }
          const val = typeof p.value === "number" ? p.value.toFixed(1) : p.value;
          const dataIndex = p.dataIndex ?? 0;
          const item = chartData[dataIndex];
          let result = `${p.name}: ${val}%`;
          if (item?.resetTime) {
            const resetDate = new Date(item.resetTime).toLocaleString();
            result += `<br/>Resets: ${resetDate}`;
          }
          return result;
        },
        trigger: "axis",
      },
      xAxis: isHorizontal
        ? {
            axisLine: { show: false },
            axisTick: { show: false },
            splitLine: { lineStyle: { opacity: 0.3, type: "dashed" } },
            type: "value",
          }
        : {
            axisLine: { show: false },
            axisTick: { show: false },
            data: sortedData.map((d) => d.name),
            type: "category",
          },
      yAxis: isHorizontal
        ? {
            axisLabel: {
              ellipsis: "...",
              overflow: "truncate",
              width: 100,
            },
            axisLine: { show: false },
            axisTick: { show: false },
            data: sortedData.map((d) => d.name).reverse(),
            type: "category",
          }
        : {
            axisLine: { show: false },
            axisTick: { show: false },
            splitLine: { lineStyle: { opacity: 0.3, type: "dashed" } },
            type: "value",
          },
    };
  });

  const handleClick = (params: unknown) => {
    const p = params as { name?: string };
    if (props.onClick && p.name) {
      props.onClick(p.name);
    }
  };

  return (
    <EChartsWrapper
      class={props.class}
      onChartClick={handleClick}
      option={option()}
      style={props.style}
    />
  );
}

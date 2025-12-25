import type { EChartsOption } from "echarts";
import { createMemo, type JSX } from "solid-js";
import { EChartsWrapper } from "./EChartsWrapper";

export interface BarChartData {
	name: string;
	value: number;
	secondaryValue?: number;
	resetTime?: string;
}

interface BarChartProps {
	data: BarChartData[];
	title?: string;
	valueLabel?: string;
	secondaryLabel?: string;
	onClick?: (name: string) => void;
	class?: string;
	style?: JSX.CSSProperties;
	horizontal?: boolean;
	colorByValue?: boolean; // Enable quota-style color coding (green/yellow/red)
}

export function BarChart(props: BarChartProps) {
	// Get quota-based color gradient
	const getQuotaColor = (value: number) => {
		if (value >= 70) {
			return {
				type: "linear" as const,
				x: props.horizontal ? 0 : 0,
				y: props.horizontal ? 0 : 1,
				x2: props.horizontal ? 1 : 0,
				y2: 0,
				colorStops: [
					{ offset: 0, color: "#10b981" }, // green-500
					{ offset: 1, color: "#059669" }, // green-600
				],
			};
		} else if (value >= 30) {
			return {
				type: "linear" as const,
				x: props.horizontal ? 0 : 0,
				y: props.horizontal ? 0 : 1,
				x2: props.horizontal ? 1 : 0,
				y2: 0,
				colorStops: [
					{ offset: 0, color: "#eab308" }, // yellow-500
					{ offset: 1, color: "#ca8a04" }, // yellow-600
				],
			};
		} else {
			return {
				type: "linear" as const,
				x: props.horizontal ? 0 : 0,
				y: props.horizontal ? 0 : 1,
				x2: props.horizontal ? 1 : 0,
				y2: 0,
				colorStops: [
					{ offset: 0, color: "#ef4444" }, // red-500
					{ offset: 1, color: "#dc2626" }, // red-600
				],
			};
		}
	};

	const option = createMemo((): EChartsOption => {
		const isHorizontal = props.horizontal !== false;
		const sortedData = [...props.data].sort((a, b) => b.value - a.value);

		// Prepare data with colors if colorByValue is enabled
		const chartData = isHorizontal ? [...sortedData].reverse() : sortedData;

		return {
			tooltip: {
				trigger: "axis",
				axisPointer: { type: "shadow" },
				appendToBody: true,
				confine: true,
					formatter: (params: Array<{ name?: string; value?: number; dataIndex?: number }>) => {
					const p = params[0];
					if (!p) return "";
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
			},
			grid: {
				left: isHorizontal ? 120 : 40,
				right: 20,
				top: 20,
				bottom: 20,
				containLabel: false,
			},
			xAxis: isHorizontal
				? {
						type: "value",
						axisLine: { show: false },
						axisTick: { show: false },
						splitLine: { lineStyle: { type: "dashed", opacity: 0.3 } },
					}
				: {
						type: "category",
						data: sortedData.map((d) => d.name),
						axisLine: { show: false },
						axisTick: { show: false },
					},
			yAxis: isHorizontal
				? {
						type: "category",
						data: sortedData.map((d) => d.name).reverse(),
						axisLine: { show: false },
						axisTick: { show: false },
						axisLabel: {
							width: 100,
							overflow: "truncate",
							ellipsis: "...",
						},
					}
				: {
						type: "value",
						axisLine: { show: false },
						axisTick: { show: false },
						splitLine: { lineStyle: { type: "dashed", opacity: 0.3 } },
					},
			series: [
				{
					type: "bar",
					data: props.colorByValue
						? chartData.map((d) => ({
								value: d.value,
								itemStyle: {
									color: getQuotaColor(d.value),
								},
							}))
						: chartData.map((d) => d.value),
					barWidth: "60%",
					label: {
						show: true,
						position: "inside",
						formatter: (params: { value?: number }) => {
							const val = params.value ?? 0;
							return `${val.toFixed(1)}%`;
						},
						fontSize: 11,
						fontWeight: 500,
						color: "#fff",
						textShadowColor: "rgba(0,0,0,0.3)",
						textShadowBlur: 2,
					},
					itemStyle: props.colorByValue
						? { borderRadius: [4, 4, 4, 4] }
						: {
								borderRadius: [4, 4, 4, 4],
								color: {
									type: "linear",
									x: isHorizontal ? 0 : 0,
									y: isHorizontal ? 0 : 1,
									x2: isHorizontal ? 1 : 0,
									y2: 0,
									colorStops: [
										{ offset: 0, color: "#3b82f6" }, // blue-500
										{ offset: 1, color: "#2563eb" }, // blue-600
									],
								},
							},
					emphasis: {
						itemStyle: {
							color: {
								type: "linear",
								x: isHorizontal ? 0 : 0,
								y: isHorizontal ? 0 : 1,
								x2: isHorizontal ? 1 : 0,
								y2: 0,
								colorStops: [
									{ offset: 0, color: "#60a5fa" }, // blue-400
									{ offset: 1, color: "#3b82f6" }, // blue-500
								],
							},
						},
					},
					animationDuration: 800,
					animationEasing: "elasticOut",
				},
			],
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
			option={option()}
			class={props.class}
			style={props.style}
			onChartClick={handleClick}
		/>
	);
}

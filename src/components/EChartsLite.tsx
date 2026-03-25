import type { ComponentProps } from "react";

import ReactEChartsCore from "echarts-for-react/lib/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export type EChartsLiteProps = ComponentProps<typeof ReactEChartsCore>;

export default function EChartsLite(props: EChartsLiteProps) {
  return <ReactEChartsCore echarts={echarts} {...props} />;
}

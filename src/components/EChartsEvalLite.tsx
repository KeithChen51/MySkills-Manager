import type { ComponentProps } from "react";

import ReactEChartsCore from "echarts-for-react/lib/core";
import { BarChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([BarChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type EChartsEvalLiteProps = ComponentProps<typeof ReactEChartsCore>;

export default function EChartsEvalLite(props: EChartsEvalLiteProps) {
  return <ReactEChartsCore echarts={echarts} {...props} />;
}

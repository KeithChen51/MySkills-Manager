import ReactECharts from "echarts-for-react";
import { useEffect, useMemo, useState } from "react";

import { statsGet, type SkillMeta, type StatsResult } from "../api/tauri";
import KpiCard from "../components/KpiCard";
import { useI18n } from "../i18n/I18nProvider";
import { useTheme } from "../theme/ThemeProvider";
import "./DashboardPage.css";

type Props = { skills: SkillMeta[] };

type DashboardChartTokens = {
  palette: string[];
  textPrimary: string;
  textSecondary: string;
  border: string;
  split: string;
  tooltipBg: string;
  tooltipBorder: string;
};

function readDashboardChartTokens(): DashboardChartTokens {
  const fallback: DashboardChartTokens = {
    palette: ["#5a87f4", "#4aaed6", "#8d74f5", "#1fa870", "#d98a28", "#df5d70"],
    textPrimary: "#172239",
    textSecondary: "#42506b",
    border: "#d8e3f2",
    split: "#d8e3f2",
    tooltipBg: "#ffffff",
    tooltipBorder: "#d8e3f2",
  };
  if (typeof window === "undefined") {
    return fallback;
  }
  const styles = window.getComputedStyle(document.documentElement);
  const read = (name: string, value: string) => styles.getPropertyValue(name).trim() || value;
  return {
    palette: [
      read("--chart-1", fallback.palette[0]),
      read("--chart-2", fallback.palette[1]),
      read("--chart-3", fallback.palette[2]),
      read("--chart-4", fallback.palette[3]),
      read("--chart-5", fallback.palette[4]),
      read("--chart-6", fallback.palette[5]),
    ],
    textPrimary: read("--text-primary", fallback.textPrimary),
    textSecondary: read("--text-secondary", fallback.textSecondary),
    border: read("--border-card", fallback.border),
    split: read("--border-card", fallback.split),
    tooltipBg: read("--bg-card", fallback.tooltipBg),
    tooltipBorder: read("--border-card", fallback.tooltipBorder),
  };
}

export default function DashboardPage({ skills }: Props) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const chartTokens = useMemo(() => {
    // Theme switch updates CSS variables; this dependency forces token re-read.
    void resolvedTheme;
    return readDashboardChartTokens();
  }, [resolvedTheme]);
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    void (async () => {
      setStatus(t("tools.loading"));
      try {
        const r = await statsGet(days);
        setStats(r);
        setStatus("");
      } catch (e: unknown) {
        setStatus(String(e));
      }
    })();
  }, [days, t]);

  const topSkills = stats?.by_skill.slice(0, 15) ?? [];
  const byTool = stats?.by_tool ?? [];
  const byDay = stats?.by_day ?? [];

  return (
    <div className="page animate-fadein">
      <header className="page-header">
        <h1 className="page-title">{t("dashboard.title")}</h1>
        <div className="dash-actions">
          <select className="filter-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>{t("dashboard.range.7")}</option>
            <option value={30}>{t("dashboard.range.30")}</option>
            <option value={90}>{t("dashboard.range.90")}</option>
          </select>
          {status && <span className="page-count">{status}</span>}
        </div>
      </header>

      <div className="kpi-row">
        <KpiCard label={t("dashboard.kpi.invocations")} value={stats?.total_invocations ?? 0} />
        <KpiCard label={t("dashboard.kpi.active")} value={stats?.by_skill.length ?? 0} />
        <KpiCard label={t("dashboard.kpi.total")} value={skills.length} />
        <KpiCard label={t("dashboard.kpi.unused")} value={stats?.unused_skills.length ?? 0} />
      </div>
      {stats?.reliability_note && <p className="page-count">{stats.reliability_note}</p>}

      <div className="chart-row">
        <article className="chart-card">
          <h3 className="chart-title">{t("dashboard.topSkills")}</h3>
          <ReactECharts
            className="dashboard-chart dashboard-chart--tall"
            option={{
              color: chartTokens.palette,
              textStyle: { color: chartTokens.textPrimary },
              tooltip: {
                trigger: "axis",
                backgroundColor: chartTokens.tooltipBg,
                borderColor: chartTokens.tooltipBorder,
                textStyle: { color: chartTokens.textPrimary },
              },
              xAxis: {
                type: "value",
                axisLine: { lineStyle: { color: chartTokens.border } },
                axisTick: { lineStyle: { color: chartTokens.border } },
                axisLabel: { color: chartTokens.textSecondary },
                splitLine: { lineStyle: { color: chartTokens.split } },
              },
              yAxis: {
                type: "category",
                data: topSkills.map((i) => i.name),
                axisLine: { lineStyle: { color: chartTokens.border } },
                axisTick: { lineStyle: { color: chartTokens.border } },
                axisLabel: { color: chartTokens.textSecondary },
              },
              grid: { left: 130, right: 20, top: 20, bottom: 20 },
              series: [{ type: "bar", data: topSkills.map((i) => i.count), barMaxWidth: 24 }],
            }}
          />
        </article>

        <article className="chart-card">
          <h3 className="chart-title">{t("dashboard.byTool")}</h3>
          <ReactECharts
            className="dashboard-chart dashboard-chart--tall"
            option={{
              color: chartTokens.palette,
              textStyle: { color: chartTokens.textPrimary },
              tooltip: {
                trigger: "item",
                backgroundColor: chartTokens.tooltipBg,
                borderColor: chartTokens.tooltipBorder,
                textStyle: { color: chartTokens.textPrimary },
              },
              series: [
                {
                  type: "pie",
                  radius: "62%",
                  data: byTool.map((i) => ({ name: i.name, value: i.count })),
                },
              ],
            }}
          />
        </article>
      </div>

      <article className="chart-card">
        <h3 className="chart-title">{t("dashboard.byDay")}</h3>
        <ReactECharts
          className="dashboard-chart dashboard-chart--medium"
          option={{
            color: chartTokens.palette,
            textStyle: { color: chartTokens.textPrimary },
            tooltip: {
              trigger: "axis",
              backgroundColor: chartTokens.tooltipBg,
              borderColor: chartTokens.tooltipBorder,
              textStyle: { color: chartTokens.textPrimary },
            },
            xAxis: {
              type: "category",
              data: byDay.map((i) => i.date),
              axisLine: { lineStyle: { color: chartTokens.border } },
              axisTick: { lineStyle: { color: chartTokens.border } },
              axisLabel: { color: chartTokens.textSecondary },
            },
            yAxis: {
              type: "value",
              axisLine: { lineStyle: { color: chartTokens.border } },
              axisTick: { lineStyle: { color: chartTokens.border } },
              axisLabel: { color: chartTokens.textSecondary },
              splitLine: { lineStyle: { color: chartTokens.split } },
            },
            grid: { left: 50, right: 20, top: 20, bottom: 40 },
            series: [{ type: "line", data: byDay.map((i) => i.count), smooth: true }],
          }}
        />
      </article>

      <article className="chart-card">
        <h3 className="chart-title">{t("dashboard.unused")}</h3>
        {(stats?.unused_skills.length ?? 0) === 0 ? (
          <p className="empty-state">{t("dashboard.unused.empty")}</p>
        ) : (
          <ul className="item-list">{stats?.unused_skills.map((n) => <li key={n}>{n}</li>)}</ul>
        )}
      </article>
    </div>
  );
}

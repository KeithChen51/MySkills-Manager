import ReactECharts from "echarts-for-react";
import { useEffect, useState } from "react";
import * as echarts from "echarts";

import { statsGet, type SkillMeta, type StatsResult } from "../api/tauri";
import KpiCard from "../components/KpiCard";
import { useI18n } from "../i18n/I18nProvider";
import { useTheme } from "../theme/ThemeProvider";
import "./DashboardPage.css";

type Props = { skills: SkillMeta[] };

const CHART_THEME_LIGHT = "myskills-soft-light";
const CHART_THEME_DARK = "myskills-soft-dark";
let themesRegistered = false;

function ensureEchartsThemes() {
  if (themesRegistered) return;

  echarts.registerTheme(CHART_THEME_LIGHT, {
    backgroundColor: "transparent",
    color: ["#7f9cf5", "#63b3ed", "#b794f4", "#68d391", "#f6ad55", "#fc8181"],
    textStyle: { color: "#1a202c" },
    title: { textStyle: { color: "#1a202c" } },
    legend: { textStyle: { color: "#4a5568" } },
    tooltip: {
      backgroundColor: "rgba(255, 255, 255, 0.97)",
      borderColor: "#e2e8f0",
      textStyle: { color: "#1a202c" },
    },
    categoryAxis: {
      axisLine: { lineStyle: { color: "#e2e8f0" } },
      axisTick: { lineStyle: { color: "#e2e8f0" } },
      axisLabel: { color: "#718096" },
      splitLine: { lineStyle: { color: "#edf2f7" } },
    },
    valueAxis: {
      axisLine: { lineStyle: { color: "#e2e8f0" } },
      axisTick: { lineStyle: { color: "#e2e8f0" } },
      axisLabel: { color: "#718096" },
      splitLine: { lineStyle: { color: "#edf2f7" } },
    },
  });

  echarts.registerTheme(CHART_THEME_DARK, {
    backgroundColor: "transparent",
    color: ["#a3bffa", "#90cdf4", "#d6bcfa", "#9ae6b4", "#fbd38d", "#feb2b2"],
    textStyle: { color: "#f7fafc" },
    title: { textStyle: { color: "#f7fafc" } },
    legend: { textStyle: { color: "#cbd5e0" } },
    tooltip: {
      backgroundColor: "rgba(45, 55, 72, 0.96)",
      borderColor: "#718096",
      textStyle: { color: "#f7fafc" },
    },
    categoryAxis: {
      axisLine: { lineStyle: { color: "#4a5568" } },
      axisTick: { lineStyle: { color: "#4a5568" } },
      axisLabel: { color: "#a0aec0" },
      splitLine: { lineStyle: { color: "#4a5568" } },
    },
    valueAxis: {
      axisLine: { lineStyle: { color: "#4a5568" } },
      axisTick: { lineStyle: { color: "#4a5568" } },
      axisLabel: { color: "#a0aec0" },
      splitLine: { lineStyle: { color: "#4a5568" } },
    },
  });

  themesRegistered = true;
}

export default function DashboardPage({ skills }: Props) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  ensureEchartsThemes();
  const chartThemeName = resolvedTheme === "dark" ? CHART_THEME_DARK : CHART_THEME_LIGHT;
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
            theme={chartThemeName}
            option={{
              tooltip: { trigger: "axis" },
              xAxis: { type: "value" },
              yAxis: { type: "category", data: topSkills.map((i) => i.name) },
              grid: { left: 130, right: 20, top: 20, bottom: 20 },
              series: [{ type: "bar", data: topSkills.map((i) => i.count), barMaxWidth: 24 }],
            }}
          />
        </article>

        <article className="chart-card">
          <h3 className="chart-title">{t("dashboard.byTool")}</h3>
          <ReactECharts
            className="dashboard-chart dashboard-chart--tall"
            theme={chartThemeName}
            option={{
              tooltip: { trigger: "item" },
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
          theme={chartThemeName}
          option={{
            tooltip: { trigger: "axis" },
            xAxis: { type: "category", data: byDay.map((i) => i.date) },
            yAxis: { type: "value" },
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

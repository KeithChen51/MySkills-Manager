import ReactECharts from "echarts-for-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  logsGet,
  statsGet,
  type LogEntry,
  type LogsResult,
  type SkillMeta,
  type StatsResult,
} from "../api/tauri";
import KpiCard from "../components/KpiCard";
import { IconChevronLeft, IconChevronRight, IconClose, IconLogs } from "../components/icons";
import { toIsoEnd, toIsoStart } from "../domain/logDateRange";
import { formatLogTimestamp } from "../domain/logTimestamp";
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
    palette: ["#7f9cf5", "#63b3ed", "#b794f4", "#2f7a66", "#f6ad55", "#d46d82"],
    textPrimary: "#2d3748",
    textSecondary: "#475467",
    border: "#d3dcea",
    split: "#d3dcea",
    tooltipBg: "#fbfcfe",
    tooltipBorder: "#d3dcea",
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
  const { t, locale } = useI18n();
  const { resolvedTheme } = useTheme();
  const chartTokens = useMemo(() => {
    // Theme switch updates CSS variables; this dependency forces token re-read.
    void resolvedTheme;
    return readDashboardChartTokens();
  }, [resolvedTheme]);

  const logsLimit = 50;
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [status, setStatus] = useState("");
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsSkill, setLogsSkill] = useState("all");
  const [logsTool, setLogsTool] = useState("all");
  const [logsFrom, setLogsFrom] = useState("");
  const [logsTo, setLogsTo] = useState("");
  const [logsPage, setLogsPage] = useState(1);
  const [logsData, setLogsData] = useState<LogsResult>({ logs: [], total: 0 });
  const [logsStatus, setLogsStatus] = useState("");
  const [expandedLogKey, setExpandedLogKey] = useState<string | null>(null);
  const openLogsButtonRef = useRef<HTMLButtonElement | null>(null);
  const logsFirstFilterRef = useRef<HTMLSelectElement | null>(null);
  const closeLogsButtonRef = useRef<HTMLButtonElement | null>(null);

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

  useEffect(() => {
    if (!logsOpen) return;
    void (async () => {
      setLogsStatus(t("dashboard.logs.loading"));
      try {
        const result = await logsGet({
          skill: logsSkill === "all" ? undefined : logsSkill,
          tool: logsTool === "all" ? undefined : logsTool,
          from: toIsoStart(logsFrom),
          to: toIsoEnd(logsTo),
          page: logsPage,
          limit: logsLimit,
        });
        setLogsData(result);
        setLogsStatus("");
      } catch (error: unknown) {
        setLogsStatus(String(error));
      }
    })();
  }, [logsFrom, logsOpen, logsPage, logsSkill, logsTo, logsTool, t]);

  useEffect(() => {
    if (!logsOpen) return;
    const timer = window.setTimeout(() => {
      logsFirstFilterRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [logsOpen]);

  useEffect(() => {
    if (!logsOpen) return;
    const onEscClose = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLogsOpen(false);
      }
    };
    window.addEventListener("keydown", onEscClose);
    return () => window.removeEventListener("keydown", onEscClose);
  }, [logsOpen]);

  const openLogsPanel = useCallback(() => {
    setLogsOpen(true);
  }, []);

  const closeLogsPanel = useCallback(() => {
    setLogsOpen(false);
    window.setTimeout(() => {
      const trigger = openLogsButtonRef.current;
      if (!trigger) return;
      trigger.focus();
      trigger.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, 0);
  }, []);

  const openLogsForSkill = useCallback((skillName: string) => {
    setLogsSkill(skillName);
    setLogsPage(1);
    setExpandedLogKey(null);
    setLogsOpen(true);
  }, []);

  const resetLogsFilters = useCallback(() => {
    setLogsSkill("all");
    setLogsTool("all");
    setLogsFrom("");
    setLogsTo("");
    setLogsPage(1);
    setExpandedLogKey(null);
  }, []);

  const topSkillsChartEvents = useMemo(
    () => ({
      click: (params: { name?: string }) => {
        if (typeof params.name === "string" && params.name.trim()) {
          openLogsForSkill(params.name);
        }
      },
    }),
    [openLogsForSkill],
  );

  const toolOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of stats?.by_tool ?? []) {
      set.add(item.name);
    }
    for (const log of logsData.logs) {
      set.add(log.tool);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, locale));
  }, [locale, logsData.logs, stats?.by_tool]);

  const skillOptions = useMemo(() => {
    const set = new Set<string>();
    for (const skillItem of skills) {
      set.add(skillItem.name);
    }
    for (const item of stats?.by_skill ?? []) {
      set.add(item.name);
    }
    for (const log of logsData.logs) {
      set.add(log.skill);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, locale));
  }, [locale, logsData.logs, skills, stats?.by_skill]);

  const sortedLogs = useMemo(() => {
    return [...logsData.logs].sort((a, b) => {
      const byTs = b.ts.localeCompare(a.ts);
      if (byTs !== 0) return byTs;
      const bySkill = a.skill.localeCompare(b.skill, locale);
      if (bySkill !== 0) return bySkill;
      return a.tool.localeCompare(b.tool, locale);
    });
  }, [locale, logsData.logs]);

  const topSkills = stats?.by_skill.slice(0, 15) ?? [];
  const byTool = stats?.by_tool ?? [];
  const byDay = stats?.by_day ?? [];
  const topSkillQuickList = topSkills.slice(0, 8);
  const totalInvocations = stats?.total_invocations ?? 0;
  const logsTotalPages = Math.max(1, Math.ceil(logsData.total / logsLimit));

  function logRowKey(log: LogEntry) {
    return `${log.ts}|${log.skill}|${log.tool}|${log.cwd}`;
  }

  return (
    <div className="page animate-fadein usage-records-page">
      <header className="page-header usage-records-header">
        <h1 className="page-title">{t("dashboard.title")}</h1>
        <div className="dash-actions">
          <select className="filter-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>{t("dashboard.range.7")}</option>
            <option value={30}>{t("dashboard.range.30")}</option>
            <option value={90}>{t("dashboard.range.90")}</option>
          </select>
          <button
            ref={openLogsButtonRef}
            type="button"
            className="btn btn-primary usage-records-open-logs-btn"
            onClick={openLogsPanel}
            aria-label={t("dashboard.openLogs.aria")}
          >
            <IconLogs size={14} />
            {t("dashboard.openLogs")}
          </button>
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
            onEvents={topSkillsChartEvents}
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
          <p className="usage-records-chart-hint">{t("dashboard.topSkills.linkHint")}</p>
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

      <article className="chart-card usage-top-list-card">
        <header className="usage-top-list-head">
          <h3 className="chart-title">{t("dashboard.topSkills")}</h3>
          <p className="usage-top-list-help">{t("dashboard.topSkills.linkHint")}</p>
        </header>
        <div className="usage-top-list">
          {topSkillQuickList.map((item) => {
            const ratio = totalInvocations > 0 ? (item.count / totalInvocations) * 100 : 0;
            return (
              <button
                key={`top-skill-${item.name}`}
                type="button"
                className="usage-top-list-item"
                onClick={() => openLogsForSkill(item.name)}
              >
                <span className="usage-top-list-name">{item.name}</span>
                <span className="usage-top-list-metric">
                  {item.count} · {ratio.toFixed(1)}%
                </span>
              </button>
            );
          })}
        </div>
      </article>

      {logsOpen && (
        <div className="usage-logs-overlay" onClick={closeLogsPanel}>
          <section
            className="usage-logs-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("dashboard.logs.modal.title")}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="usage-logs-header">
              <div className="usage-logs-header-copy">
                <h2 className="usage-logs-title">{t("dashboard.logs.modal.title")}</h2>
                <p className="usage-logs-subtitle">{t("dashboard.logs.modal.subtitle")}</p>
              </div>
              <div className="usage-logs-header-actions">
                <button type="button" className="btn btn-ghost" onClick={resetLogsFilters}>
                  {t("dashboard.logs.clearFilters")}
                </button>
                <button
                  ref={closeLogsButtonRef}
                  type="button"
                  className="btn btn-ghost"
                  onClick={closeLogsPanel}
                  aria-label={t("dashboard.logs.close")}
                  title={t("dashboard.logs.close")}
                >
                  <IconClose size={14} />
                </button>
              </div>
            </header>

            {logsSkill !== "all" ? (
              <p className="usage-logs-filter-note">
                {t("dashboard.logs.filteredBySkill", { skill: logsSkill })}
              </p>
            ) : null}

            <div className="usage-logs-filters">
              <label className="field">
                <span className="field-label">{t("logs.skill")}</span>
                <select
                  ref={logsFirstFilterRef}
                  className="filter-select"
                  value={logsSkill}
                  onChange={(event) => {
                    setLogsSkill(event.target.value);
                    setLogsPage(1);
                    setExpandedLogKey(null);
                  }}
                >
                  <option value="all">{t("logs.all")}</option>
                  {skillOptions.map((skillOption) => (
                    <option key={skillOption} value={skillOption}>
                      {skillOption}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">{t("logs.tool")}</span>
                <select
                  className="filter-select"
                  value={logsTool}
                  onChange={(event) => {
                    setLogsTool(event.target.value);
                    setLogsPage(1);
                    setExpandedLogKey(null);
                  }}
                >
                  <option value="all">{t("logs.all")}</option>
                  {toolOptions.map((toolOption) => (
                    <option key={toolOption} value={toolOption}>
                      {toolOption}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">{t("logs.from")}</span>
                <input
                  className="field-input"
                  type="date"
                  value={logsFrom}
                  onChange={(event) => {
                    setLogsFrom(event.target.value);
                    setLogsPage(1);
                    setExpandedLogKey(null);
                  }}
                />
              </label>
              <label className="field">
                <span className="field-label">{t("logs.to")}</span>
                <input
                  className="field-input"
                  type="date"
                  value={logsTo}
                  onChange={(event) => {
                    setLogsTo(event.target.value);
                    setLogsPage(1);
                    setExpandedLogKey(null);
                  }}
                />
              </label>
            </div>

            {logsStatus ? (
              <p className="usage-logs-status" role="status" aria-live="polite">
                {logsStatus}
              </p>
            ) : null}

            <div className="usage-logs-table-wrap">
              <table className="data-table usage-logs-table">
                <thead>
                  <tr>
                    <th>{t("logs.table.time")}</th>
                    <th>{t("logs.skill")}</th>
                    <th>{t("logs.tool")}</th>
                    <th>{t("logs.table.cwd")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLogs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="empty-state">
                        {t("logs.empty")}
                      </td>
                    </tr>
                  ) : (
                    sortedLogs.map((log) => {
                      const rowKey = logRowKey(log);
                      const expanded = expandedLogKey === rowKey;
                      return (
                        <Fragment key={rowKey}>
                          <tr
                            className={`usage-logs-row ${expanded ? "is-expanded" : ""}`}
                            onClick={() => {
                              setExpandedLogKey((current) => (current === rowKey ? null : rowKey));
                            }}
                          >
                            <td>{formatLogTimestamp(log.ts, locale)}</td>
                            <td>{log.skill}</td>
                            <td>{log.tool}</td>
                            <td className="usage-log-cwd-cell" title={log.cwd}>
                              {log.cwd}
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="usage-logs-detail-row">
                              <td colSpan={4}>
                                <div className="usage-logs-detail-grid">
                                  <p className="usage-logs-detail-item">
                                    <strong>{t("dashboard.logs.detail.cwd")}</strong>
                                    <span>{log.cwd}</span>
                                  </p>
                                  <p className="usage-logs-detail-item">
                                    <strong>{t("dashboard.logs.detail.session")}</strong>
                                    <span>{log.session || t("dashboard.logs.detail.unavailable")}</span>
                                  </p>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <footer className="usage-logs-pager">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={logsPage <= 1}
                onClick={() => {
                  setLogsPage((current) => Math.max(1, current - 1));
                  setExpandedLogKey(null);
                }}
              >
                <IconChevronLeft size={14} />
                {t("logs.prev")}
              </button>
              <span className="page-count">
                {t("logs.page", { page: logsPage, total: logsTotalPages, rows: logsData.total })}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={logsPage >= logsTotalPages}
                onClick={() => {
                  setLogsPage((current) => Math.min(logsTotalPages, current + 1));
                  setExpandedLogKey(null);
                }}
              >
                {t("logs.next")}
                <IconChevronRight size={14} />
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

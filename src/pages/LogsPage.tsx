import { useEffect, useMemo, useState } from "react";

import { logsGet, statsGet, type LogsResult, type SkillMeta, type StatsResult } from "../api/tauri";
import { IconChevronLeft, IconChevronRight } from "../components/icons";
import { toIsoEnd, toIsoStart } from "../domain/logDateRange";
import { formatLogTimestamp } from "../domain/logTimestamp";
import { useI18n } from "../i18n/I18nProvider";
import "./LogsPage.css";

type Props = { skills: SkillMeta[] };

export default function LogsPage({ skills }: Props) {
  const { t, locale } = useI18n();
  const logsLimit = 50;
  const [skill, setSkill] = useState("all");
  const [tool, setTool] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LogsResult>({ logs: [], total: 0 });
  const [status, setStatus] = useState("");
  const [stats, setStats] = useState<StatsResult | null>(null);

  useEffect(() => {
    void statsGet(90).then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    void (async () => {
      setStatus(t("tools.loading"));
      try {
        const result = await logsGet({
          skill: skill === "all" ? undefined : skill,
          tool: tool === "all" ? undefined : tool,
          from: toIsoStart(from),
          to: toIsoEnd(to),
          page,
          limit: logsLimit,
        });
        setData(result);
        setStatus("");
      } catch (e: unknown) {
        setStatus(String(e));
      }
    })();
  }, [skill, tool, from, to, page, t]);

  const toolOptions = useMemo(() => {
    const out = new Set<string>();
    for (const i of stats?.by_tool ?? []) out.add(i.name);
    for (const r of data.logs) out.add(r.tool);
    return Array.from(out).sort();
  }, [stats, data.logs]);

  const totalPages = Math.max(1, Math.ceil(data.total / logsLimit));

  return (
    <div className="page animate-fadein">
      <header className="page-header">
        <h1 className="page-title">{t("logs.title")}</h1>
        {status && <span className="page-count">{status}</span>}
      </header>

      <div className="logs-filters">
        <label className="field">
          <span className="field-label">{t("logs.skill")}</span>
          <select
            className="filter-select"
            value={skill}
            onChange={(e) => {
              setSkill(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">{t("logs.all")}</option>
            {skills.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t("logs.tool")}</span>
          <select
            className="filter-select"
            value={tool}
            onChange={(e) => {
              setTool(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">{t("logs.all")}</option>
            {toolOptions.map((toolName) => (
              <option key={toolName} value={toolName}>
                {toolName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t("logs.from")}</span>
          <input
            className="field-input"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("logs.to")}</span>
          <input
            className="field-input"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("logs.table.time")}</th>
              <th>{t("logs.skill")}</th>
              <th>{t("logs.tool")}</th>
              <th>{t("logs.table.cwd")}</th>
            </tr>
          </thead>
          <tbody>
            {data.logs.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty-state">
                  {t("logs.empty")}
                </td>
              </tr>
            ) : (
              data.logs.map((log) => (
                <tr key={`${log.ts}-${log.skill}-${log.cwd}`}>
                  <td>{formatLogTimestamp(log.ts, locale)}</td>
                  <td>{log.skill}</td>
                  <td>{log.tool}</td>
                  <td className="cwd-cell">{log.cwd}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button
          className="btn btn-ghost"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          <IconChevronLeft size={14} /> {t("logs.prev")}
        </button>
        <span className="page-count">{t("logs.page", { page, total: totalPages, rows: data.total })}</span>
        <button
          className="btn btn-ghost"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        >
          {t("logs.next")} <IconChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

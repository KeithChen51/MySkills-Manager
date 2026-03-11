import { useEffect, useMemo, useState } from "react";

import {
  evalListHistory,
  logsGet,
  skillsDeleteEverywhere,
  skillsGetInsights,
  type EvalHistoryEntry,
  type LogEntry,
  type SkillInsight,
  type SkillMeta,
} from "../api/tauri";
import SkillCard from "../components/SkillCard";
import SkillEditor from "../components/SkillEditor";
import { IconRefresh, IconSearch } from "../components/icons";
import {
  compareSkillNamesByMode,
  type SkillInsightWindow,
} from "../domain/skillInsights";
import { formatLogTimestamp } from "../domain/logTimestamp";
import { useI18n } from "../i18n/I18nProvider";
import SkillConflictDrawer from "./skills/SkillConflictDrawer";
import SkillsOverviewPanel from "./skills/SkillsOverviewPanel";
import { useSkillsPageController } from "./skills/useSkillsPageController";
import "./SkillsPage.css";

type Props = {
  skills: SkillMeta[];
  onRefresh: () => void;
};

export default function SkillsPage({ skills, onRefresh }: Props) {
  const { t, locale } = useI18n();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [editing, setEditing] = useState<SkillMeta | null>(null);
  const [deletingSkillName, setDeletingSkillName] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState("");
  const [insights, setInsights] = useState<SkillInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightWindow, setInsightWindow] = useState<7 | 30 | 90>(30);
  const [sortMode, setSortMode] = useState<"name" | "usage" | "eval">("name");
  const [detailSkillName, setDetailSkillName] = useState<string | null>(null);
  const [detailLogs, setDetailLogs] = useState<LogEntry[]>([]);
  const [detailEvalHistory, setDetailEvalHistory] = useState<EvalHistoryEntry[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailStatus, setDetailStatus] = useState("");

  const controller = useSkillsPageController({ onRefresh, t });

  const categories = useMemo(() => {
    const out = new Set<string>();
    for (const s of skills) {
      if (s.category) out.add(s.category);
    }
    return ["all", ...Array.from(out).sort()];
  }, [skills]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return skills.filter((s) => {
      if (category !== "all" && (s.category ?? "") !== category) return false;
      if (!q) return true;
      const tags = (s.tags ?? []).join(" ").toLowerCase();
      const notes = (s.my_notes ?? "").toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q) ||
        tags.includes(q) ||
        notes.includes(q)
      );
    });
  }, [category, search, skills]);

  const insightBySkill = useMemo(() => {
    return new Map(insights.map((item) => [item.skillName, item]));
  }, [insights]);

  const visibleSorted = useMemo(() => {
    const copied = [...visible];
    copied.sort((a, b) =>
      compareSkillNamesByMode(
        a.name,
        b.name,
        insightBySkill,
        sortMode,
        insightWindow,
      ),
    );
    return copied;
  }, [insightBySkill, insightWindow, sortMode, visible]);

  useEffect(() => {
    let mounted = true;
    setInsightsLoading(true);
    void skillsGetInsights()
      .then((rows) => {
        if (!mounted) return;
        setInsights(rows);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setActionStatus(String(error));
      })
      .finally(() => {
        if (mounted) {
          setInsightsLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [skills]);

  async function handleOpenInsightDetail(skillName: string) {
    if (!skillName) return;
    setDetailSkillName(skillName);
    setDetailStatus("");
    setDetailLoading(true);
    try {
      const [logsResult, evalResult] = await Promise.all([
        logsGet({ skill: skillName, page: 1, limit: 10 }),
        evalListHistory(skillName, 10),
      ]);
      setDetailLogs(logsResult.logs);
      setDetailEvalHistory(evalResult);
    } catch (error: unknown) {
      setDetailLogs([]);
      setDetailEvalHistory([]);
      setDetailStatus(String(error));
    } finally {
      setDetailLoading(false);
    }
  }

  function handleCloseInsightDetail() {
    setDetailSkillName(null);
    setDetailLogs([]);
    setDetailEvalHistory([]);
    setDetailStatus("");
    setDetailLoading(false);
  }

  async function handleDeleteSkill(skill: SkillMeta) {
    const confirmed = window.confirm(t("skill.delete.confirm", { name: skill.name }));
    if (!confirmed) return;

    setDeletingSkillName(skill.name);
    setActionStatus(t("skill.delete.start", { name: skill.name }));
    try {
      const result = await skillsDeleteEverywhere(skill.name);
      onRefresh();
      if (editing?.name === skill.name) {
        setEditing(null);
      }
      if (result.failedRoots.length === 0) {
        setActionStatus(
          t("skill.delete.done", {
            name: skill.name,
            removed: result.removedPaths.length,
          }),
        );
      } else {
        setActionStatus(
          t("skill.delete.partial", {
            name: skill.name,
            removed: result.removedPaths.length,
            failed: result.failedRoots.length,
          }),
        );
      }
    } catch (error: unknown) {
      setActionStatus(String(error));
    } finally {
      setDeletingSkillName(null);
    }
  }

  return (
    <div className="page animate-fadein skills-page">
      <header className="page-header skills-page-header">
        <div className="skills-header-copy">
          <h1 className="page-title">{t("skills.title")}</h1>
          <p className="skills-installed">{t("skills.installed", { count: skills.length })}</p>
          <p className="skills-installed">
            {insightsLoading ? t("skills.insights.loading") : t("skills.insights.ready", { count: insights.length })}
          </p>
          {actionStatus ? <p className="skills-action-status">{actionStatus}</p> : null}
        </div>
        <div className="skills-header-actions">
          <div className="skills-insight-window-switch" role="tablist" aria-label={t("skills.insights.window.label")}>
            {[7, 30, 90].map((window) => (
              <button
                key={`insight-window-${window}`}
                type="button"
                className={`btn btn-ghost skills-insight-window-btn ${insightWindow === window ? "active" : ""}`}
                onClick={() => setInsightWindow(window as SkillInsightWindow)}
              >
                {t("skills.insights.window.option", { days: window })}
              </button>
            ))}
          </div>
          <button
            className="btn btn-primary skills-overview-btn"
            onClick={() => void controller.handleLocalOverview()}
            disabled={controller.overviewBusy}
          >
            {controller.overviewBusy
              ? t("skills.overview.scan.button.busy")
              : t("skills.overview.scan.button")}
          </button>
          <button className="btn btn-ghost skills-refresh-btn" onClick={onRefresh}>
            <IconRefresh size={14} />
            {t("skills.refresh")}
          </button>
          <div className="search-box skills-search-box">
            <IconSearch size={16} />
            <input
              className="search-input"
              placeholder={t("skills.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="filter-select skills-filter-select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === "all" ? t("skills.category.all") : c}
              </option>
            ))}
          </select>
          <select
            className="filter-select skills-filter-select"
            aria-label={t("skills.sort.label")}
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as "name" | "usage" | "eval")}
          >
            <option value="name">{t("skills.sort.name")}</option>
            <option value="usage">{t("skills.sort.usage")}</option>
            <option value="eval">{t("skills.sort.eval")}</option>
          </select>
        </div>
      </header>

      <SkillsOverviewPanel
        overview={controller.overview}
        overviewStatus={controller.overviewStatus}
        syncMissingBusy={controller.syncMissingBusy}
        conflictDetailBusy={controller.conflictDetailBusy}
        conflictSkillNames={controller.conflictSkillNames}
        t={t}
        onSyncMissingSkills={() => void controller.handleSyncMissingSkills()}
        onOpenConflictResolver={(skillName) => void controller.handleOpenConflictResolver(skillName)}
      />

      {visible.length === 0 ? (
        <p className="empty-state">{t("skills.empty")}</p>
      ) : (
        <div className="skills-grid">
          {visibleSorted.map((skill) => (
            <SkillCard
              key={skill.name}
              name={skill.name}
              description={skill.description}
              category={skill.category}
              tags={skill.tags}
              insightWindow={insightWindow}
              insight={insightBySkill.get(skill.name) ?? null}
              onEdit={() => setEditing(skill)}
              onViewInsights={() => void handleOpenInsightDetail(skill.name)}
              onDelete={() => void handleDeleteSkill(skill)}
              deleteBusy={deletingSkillName === skill.name}
            />
          ))}
        </div>
      )}

      {editing && (
        <SkillEditor
          skill={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            onRefresh();
            setEditing(null);
          }}
        />
      )}

      {detailSkillName && (
        <div
          className="skills-insight-detail-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={t("skills.insights.detail.title", { skill: detailSkillName })}
          onClick={handleCloseInsightDetail}
        >
          <article className="skills-insight-detail-panel" onClick={(event) => event.stopPropagation()}>
            <header className="skills-insight-detail-header">
              <div>
                <h2 className="skills-insight-detail-title">
                  {t("skills.insights.detail.title", { skill: detailSkillName })}
                </h2>
                <p className="skills-insight-detail-subtitle">
                  {t("skills.insights.detail.subtitle", { days: insightWindow })}
                </p>
              </div>
              <button className="btn btn-ghost" onClick={handleCloseInsightDetail}>
                {t("skills.insights.detail.close")}
              </button>
            </header>

            {detailStatus ? <p className="skills-insight-detail-status">{detailStatus}</p> : null}
            {detailLoading ? (
              <p className="skills-insight-detail-status">{t("skills.insights.detail.loading")}</p>
            ) : (
              <div className="skills-insight-detail-grid">
                <section className="skills-insight-detail-section">
                  <h3>{t("skills.insights.detail.logs")}</h3>
                  {detailLogs.length === 0 ? (
                    <p className="skills-insight-detail-empty">{t("skills.insights.detail.logs.empty")}</p>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{t("logs.table.time")}</th>
                          <th>{t("logs.tool")}</th>
                          <th>{t("logs.table.cwd")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailLogs.map((log) => (
                          <tr key={`${detailSkillName}-${log.ts}-${log.cwd}`}>
                            <td>{formatLogTimestamp(log.ts, locale)}</td>
                            <td>{log.tool}</td>
                            <td className="cwd-cell">{log.cwd}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>

                <section className="skills-insight-detail-section">
                  <h3>{t("skills.insights.detail.eval")}</h3>
                  {detailEvalHistory.length === 0 ? (
                    <p className="skills-insight-detail-empty">{t("skills.insights.detail.eval.empty")}</p>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{t("eval.history.time")}</th>
                          <th>{t("eval.config.mode")}</th>
                          <th>{t("eval.config.model")}</th>
                          <th>{t("eval.table.passRate")}</th>
                          <th>{t("eval.table.result")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailEvalHistory.map((entry) => (
                          <tr key={`${detailSkillName}-${entry.path}`}>
                            <td>{new Date(entry.savedAtUnix * 1000).toLocaleString(locale)}</td>
                            <td>{entry.mode}</td>
                            <td>{entry.model}</td>
                            <td>{Math.round(entry.passRate * 100)}%</td>
                            <td>{entry.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              </div>
            )}
          </article>
        </div>
      )}

      <SkillConflictDrawer
        activeConflictSkill={controller.activeConflictSkill}
        conflictDetailBusy={controller.conflictDetailBusy}
        conflictStatus={controller.conflictStatus}
        conflictDetail={controller.conflictDetail}
        conflictViewMode={controller.conflictViewMode}
        conflictResolveBusySource={controller.conflictResolveBusySource}
        t={t}
        onClose={controller.handleCloseConflictResolver}
        onViewModeChange={controller.setConflictViewMode}
        onResolveConflict={(sourceId) => void controller.handleResolveConflict(sourceId)}
      />
    </div>
  );
}

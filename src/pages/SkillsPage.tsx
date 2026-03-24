import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import {
  evalListHistory,
  logsGet,
  skillsDeleteEverywhere,
  skillsGetInsights,
  skillsRescanShapeTags,
  type EvalHistoryEntry,
  type LogEntry,
  type SkillInsight,
  type SkillMeta,
} from "../api/tauri";
import SkillCard from "../components/SkillCard";
import SkillEditor from "../components/SkillEditor";
import { IconRefresh, IconSearch } from "../components/icons";
import useDialogA11y from "../components/useDialogA11y";
import {
  compareSkillNamesByMode,
  type SkillInsightWindow,
} from "../domain/skillInsights";
import {
  formatTaxonomyGroupLabel,
  formatTaxonomyTagLabel,
  formatTaxonomyValueLabel,
} from "../domain/skillTaxonomyDisplay";
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

type GroupedSkills = {
  key: string;
  label: string;
  skills: SkillMeta[];
};

const INSIGHT_WINDOWS: SkillInsightWindow[] = [7, 30, 90];

export default function SkillsPage({ skills, onRefresh }: Props) {
  const { t, locale } = useI18n();
  const preferChineseTaxonomy = locale.toLowerCase().startsWith("zh");
  const [search, setSearch] = useState("");
  const [taxonomyStandard, setTaxonomyStandard] = useState<"sok" | "anthropic" | "skillsbench-domain" | "skillsbench-difficulty">("sok");
  const [taxonomyGroup, setTaxonomyGroup] = useState("all");
  const [difficultyDisplayMode, setDifficultyDisplayMode] = useState<"level" | "core">("level");
  const [editing, setEditing] = useState<SkillMeta | null>(null);
  const [deletingSkillName, setDeletingSkillName] = useState<string | null>(null);
  const [rescanShapeTagsBusy, setRescanShapeTagsBusy] = useState(false);
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
  const detailCloseButtonRef = useRef<HTMLButtonElement | null>(null);

  const controller = useSkillsPageController({ onRefresh, t });

  const unclassifiedLabel = t("skills.taxonomy.unclassified");

  const resolveGroupLabel = useCallback((skill: SkillMeta): string => {
    const taxonomy = skill.taxonomy;
    if (!taxonomy) return unclassifiedLabel;
    const normalizedSoKGroup = taxonomy.sokGroup?.trim()
      ? taxonomy.sokGroup.trim()
      : [taxonomy.sokRepresentation, taxonomy.sokScope].filter(Boolean).join(" × ").trim();
    switch (taxonomyStandard) {
      case "sok":
        return normalizedSoKGroup || unclassifiedLabel;
      case "anthropic":
        return taxonomy.anthropicCategory?.trim() || unclassifiedLabel;
      case "skillsbench-domain":
        return taxonomy.skillsbenchDomain?.trim() || unclassifiedLabel;
      case "skillsbench-difficulty":
        return difficultyDisplayMode === "core"
          ? taxonomy.skillsbenchDifficultyCore?.trim() || unclassifiedLabel
          : taxonomy.skillsbenchDifficultyLevel?.trim() || unclassifiedLabel;
      default:
        return unclassifiedLabel;
    }
  }, [difficultyDisplayMode, taxonomyStandard, unclassifiedLabel]);

  const searchMatched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return skills.filter((s) => {
      if (!q) return true;
      const tags = (s.tags ?? []).join(" ").toLowerCase();
      const tagsLocalized = (s.tags ?? [])
        .map((tag) => formatTaxonomyTagLabel(tag, preferChineseTaxonomy))
        .join(" ")
        .toLowerCase();
      const notes = (s.my_notes ?? "").toLowerCase();
      const taxonomy = s.taxonomy
        ? [
          s.taxonomy.sokRepresentation,
          s.taxonomy.sokScope,
          s.taxonomy.sokGroup,
          s.taxonomy.anthropicCategory,
          s.taxonomy.skillsbenchDomain,
          s.taxonomy.skillsbenchDifficultyCore,
          s.taxonomy.skillsbenchDifficultyLevel,
        ]
          .join(" ")
          .toLowerCase()
        : "";
      const taxonomyLocalized = s.taxonomy
        ? [
          formatTaxonomyValueLabel(s.taxonomy.sokRepresentation, preferChineseTaxonomy),
          formatTaxonomyValueLabel(s.taxonomy.sokScope, preferChineseTaxonomy),
          formatTaxonomyGroupLabel(s.taxonomy.sokGroup, preferChineseTaxonomy),
          formatTaxonomyValueLabel(s.taxonomy.anthropicCategory, preferChineseTaxonomy),
          formatTaxonomyValueLabel(s.taxonomy.skillsbenchDomain, preferChineseTaxonomy),
          formatTaxonomyValueLabel(s.taxonomy.skillsbenchDifficultyCore, preferChineseTaxonomy),
          formatTaxonomyValueLabel(s.taxonomy.skillsbenchDifficultyLevel, preferChineseTaxonomy),
        ]
          .join(" ")
          .toLowerCase()
        : "";
      return (
        s.name.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q) ||
        tags.includes(q) ||
        tagsLocalized.includes(q) ||
        notes.includes(q) ||
        taxonomy.includes(q) ||
        taxonomyLocalized.includes(q)
      );
    });
  }, [preferChineseTaxonomy, search, skills]);

  const insightBySkill = useMemo(() => {
    return new Map(insights.map((item) => [item.skillName, item]));
  }, [insights]);

  const groupedVisibleSkills = useMemo(() => {
    const bucket = new Map<string, SkillMeta[]>();
    for (const skill of searchMatched) {
      const key = resolveGroupLabel(skill);
      if (!bucket.has(key)) {
        bucket.set(key, []);
      }
      bucket.get(key)?.push(skill);
    }
    const groups = Array.from(bucket.entries())
      .map(([key, groupSkills]): GroupedSkills => ({
        key,
        label: key === unclassifiedLabel ? key : formatTaxonomyGroupLabel(key, preferChineseTaxonomy),
        skills: [...groupSkills].sort((a, b) =>
          compareSkillNamesByMode(
            a.name,
            b.name,
            insightBySkill,
            sortMode,
            insightWindow,
          ),
        ),
      }))
      .sort((a, b) => {
        if (a.key === unclassifiedLabel) return 1;
        if (b.key === unclassifiedLabel) return -1;
        return a.label.localeCompare(b.label, locale);
      });
    return groups;
  }, [
    insightBySkill,
    insightWindow,
    locale,
    preferChineseTaxonomy,
    searchMatched,
    sortMode,
    unclassifiedLabel,
    resolveGroupLabel,
  ]);

  const availableGroups = useMemo(() => {
    return ["all", ...groupedVisibleSkills.map((group) => group.key)];
  }, [groupedVisibleSkills]);

  const filteredGroups = useMemo(() => {
    if (taxonomyGroup === "all") return groupedVisibleSkills;
    return groupedVisibleSkills.filter((group) => group.key === taxonomyGroup);
  }, [groupedVisibleSkills, taxonomyGroup]);

  const visibleCount = useMemo(() => {
    return filteredGroups.reduce((total, group) => total + group.skills.length, 0);
  }, [filteredGroups]);

  const taxonomyGroupLabelByKey = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const group of groupedVisibleSkills) {
      lookup.set(group.key, group.label);
    }
    return lookup;
  }, [groupedVisibleSkills]);

  useEffect(() => {
    if (!availableGroups.includes(taxonomyGroup)) {
      setTaxonomyGroup("all");
    }
  }, [availableGroups, taxonomyGroup]);

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

  const { dialogRef: detailDialogRef } = useDialogA11y<HTMLElement>({
    open: Boolean(detailSkillName),
    onClose: handleCloseInsightDetail,
    initialFocusRef: detailCloseButtonRef,
  });

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

  async function handleRescanShapeTags() {
    setRescanShapeTagsBusy(true);
    setActionStatus(t("skills.shapeTags.rescan.start"));
    try {
      const result = await skillsRescanShapeTags();
      onRefresh();
      setActionStatus(
        t("skills.shapeTags.rescan.done", {
          scanned: result.scannedSkills,
          updated: result.updatedEntries,
        }),
      );
    } catch (error: unknown) {
      setActionStatus(String(error));
    } finally {
      setRescanShapeTagsBusy(false);
    }
  }

  const handleInsightWindowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, window: SkillInsightWindow) => {
      const currentIndex = INSIGHT_WINDOWS.indexOf(window);
      if (currentIndex < 0) return;

      if (event.key === "ArrowRight") {
        event.preventDefault();
        const next = INSIGHT_WINDOWS[(currentIndex + 1) % INSIGHT_WINDOWS.length];
        setInsightWindow(next);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        const next = INSIGHT_WINDOWS[(currentIndex - 1 + INSIGHT_WINDOWS.length) % INSIGHT_WINDOWS.length];
        setInsightWindow(next);
      }
    },
    [],
  );

  return (
    <div className="page animate-fadein skills-page">
      <header className="page-header skills-page-header page-header-grid">
        <div className="skills-header-copy page-header-copy">
          <h1 className="page-title">{t("skills.title")}</h1>
          <p className="skills-installed">{t("skills.installed", { count: skills.length })}</p>
          <p className="skills-installed">
            {insightsLoading ? t("skills.insights.loading") : t("skills.insights.ready", { count: insights.length })}
          </p>
          <p className="skills-installed">{t("skills.eval.nonBlockingHint")}</p>
          {actionStatus ? (
            <p className="skills-action-status" role="status" aria-live="polite">
              {actionStatus}
            </p>
          ) : null}
        </div>
        <div className="skills-header-actions page-header-actions-grid">
          <div className="skills-actions-row skills-actions-row-primary page-header-actions-row">
            <div className="skills-insight-window-switch" role="tablist" aria-label={t("skills.insights.window.label")}>
              {INSIGHT_WINDOWS.map((window) => (
                <button
                  key={`insight-window-${window}`}
                  type="button"
                  role="tab"
                  aria-selected={insightWindow === window}
                  tabIndex={insightWindow === window ? 0 : -1}
                  className={`btn btn-ghost skills-insight-window-btn ${insightWindow === window ? "active" : ""}`}
                  onClick={() => setInsightWindow(window)}
                  onKeyDown={(event) => handleInsightWindowKeyDown(event, window)}
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
            <button
              className="btn btn-ghost skills-refresh-btn"
              onClick={() => void handleRescanShapeTags()}
              disabled={rescanShapeTagsBusy}
            >
              {rescanShapeTagsBusy
                ? t("skills.shapeTags.rescan.button.busy")
                : t("skills.shapeTags.rescan.button")}
            </button>
            <div className="search-box skills-search-box">
              <IconSearch size={16} />
              <input
                className="search-input"
                aria-label={t("skills.search")}
                placeholder={t("skills.search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="skills-actions-row skills-actions-row-secondary page-header-actions-row">
            <section className="skills-filter-cluster" aria-label={t("skills.taxonomy.standard.label")}>
              <p className="skills-filter-cluster-title">{t("skills.taxonomy.standard.label")}</p>
              <div className="skills-filter-cluster-controls">
                <select
                  className="filter-select skills-filter-select"
                  aria-label={t("skills.taxonomy.standard.label")}
                  value={taxonomyStandard}
                  onChange={(e) => {
                    const next = e.target.value as "sok" | "anthropic" | "skillsbench-domain" | "skillsbench-difficulty";
                    setTaxonomyStandard(next);
                    setTaxonomyGroup("all");
                  }}
                >
                  <option value="sok">{t("skills.taxonomy.standard.sok")}</option>
                  <option value="anthropic">{t("skills.taxonomy.standard.anthropic")}</option>
                  <option value="skillsbench-domain">{t("skills.taxonomy.standard.skillsbenchDomain")}</option>
                  <option value="skillsbench-difficulty">{t("skills.taxonomy.standard.skillsbenchDifficulty")}</option>
                </select>
                {taxonomyStandard === "skillsbench-difficulty" ? (
                  <select
                    className="filter-select skills-filter-select"
                    aria-label={t("skills.taxonomy.difficulty.mode.label")}
                    value={difficultyDisplayMode}
                    onChange={(e) => {
                      setDifficultyDisplayMode(e.target.value as "level" | "core");
                      setTaxonomyGroup("all");
                    }}
                  >
                    <option value="level">{t("skills.taxonomy.difficulty.mode.level")}</option>
                    <option value="core">{t("skills.taxonomy.difficulty.mode.core")}</option>
                  </select>
                ) : null}
                <select
                  className="filter-select skills-filter-select"
                  aria-label={t("skills.taxonomy.group.label")}
                  value={taxonomyGroup}
                  onChange={(e) => setTaxonomyGroup(e.target.value)}
                >
                  {availableGroups.map((group) => (
                    <option key={group} value={group}>
                      {group === "all"
                        ? t("skills.taxonomy.group.all")
                        : (taxonomyGroupLabelByKey.get(group) ??
                          formatTaxonomyGroupLabel(group, preferChineseTaxonomy))}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <section className="skills-filter-cluster skills-filter-cluster-sort" aria-label={t("skills.sort.label")}>
              <p className="skills-filter-cluster-title">{t("skills.sort.label")}</p>
              <select
                className="filter-select skills-filter-select skills-sort-select"
                aria-label={t("skills.sort.label")}
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as "name" | "usage" | "eval")}
              >
                <option value="name">{t("skills.sort.name")}</option>
                <option value="usage">{t("skills.sort.usage")}</option>
                <option value="eval">{t("skills.sort.eval")}</option>
              </select>
            </section>
          </div>
        </div>
      </header>

      <SkillsOverviewPanel
        overview={controller.overview}
        overviewStatus={controller.overviewStatus}
        conflictDetailBusy={controller.conflictDetailBusy}
        conflictSkillNames={controller.conflictSkillNames}
        t={t}
        onOpenConflictResolver={(skillName) => void controller.handleOpenConflictResolver(skillName)}
      />

      {visibleCount === 0 ? (
        <p className="empty-state">{t("skills.empty")}</p>
      ) : (
        <div className="skills-group-list">
          {filteredGroups.map((group) => (
            <section key={group.key} className="skills-group-section">
              <header className="skills-group-header">
                <h2 className="skills-group-title">{group.label}</h2>
                <span className="skills-group-count">{group.skills.length}</span>
              </header>
              <div className="skills-grid">
                {group.skills.map((skill) => (
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
            </section>
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
          onClick={handleCloseInsightDetail}
        >
          <article
            ref={detailDialogRef}
            className="skills-insight-detail-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("skills.insights.detail.title", { skill: detailSkillName })}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="skills-insight-detail-header">
              <div>
                <h2 className="skills-insight-detail-title">
                  {t("skills.insights.detail.title", { skill: detailSkillName })}
                </h2>
                <p className="skills-insight-detail-subtitle">
                  {t("skills.insights.detail.subtitle", { days: insightWindow })}
                </p>
              </div>
              <button
                ref={detailCloseButtonRef}
                type="button"
                className="btn btn-ghost"
                onClick={handleCloseInsightDetail}
              >
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
                            <td>{formatLogTimestamp(new Date(entry.savedAtUnix * 1000).toISOString(), locale)}</td>
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
        conflictResolveBusySource={controller.conflictResolveBusySource}
        t={t}
        onClose={controller.handleCloseConflictResolver}
        onResolveConflict={(sourceId) => void controller.handleResolveConflict(sourceId)}
      />
    </div>
  );
}

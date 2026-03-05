import { useMemo, useState } from "react";

import {
  onboardingImportInstalledSkills,
  setupGetSkillConflictDetail,
  setupLocalSkillsOverview,
  setupResolveSkillConflict,
  type LocalSkillsOverview,
  type SkillConflictDetail,
  type SkillMeta,
} from "../api/tauri";
import { useI18n } from "../i18n/I18nProvider";
import SkillCard from "../components/SkillCard";
import SkillEditor from "../components/SkillEditor";
import { buildSkillDiff } from "../domain/skillConflictDiff";
import { IconClose, IconRefresh, IconSearch } from "../components/icons";
import "./SkillsPage.css";

type Props = {
  skills: SkillMeta[];
  onRefresh: () => void;
};

type ConflictViewMode = "diff" | "full";

export default function SkillsPage({ skills, onRefresh }: Props) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [editing, setEditing] = useState<SkillMeta | null>(null);
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [syncMissingBusy, setSyncMissingBusy] = useState(false);
  const [overviewStatus, setOverviewStatus] = useState("");
  const [overview, setOverview] = useState<LocalSkillsOverview | null>(null);
  const [activeConflictSkill, setActiveConflictSkill] = useState<string | null>(null);
  const [conflictDetailBusy, setConflictDetailBusy] = useState(false);
  const [conflictResolveBusySource, setConflictResolveBusySource] = useState<string | null>(null);
  const [conflictStatus, setConflictStatus] = useState("");
  const [conflictDetail, setConflictDetail] = useState<SkillConflictDetail | null>(null);
  const [conflictViewMode, setConflictViewMode] = useState<ConflictViewMode>("diff");

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

  const conflictSkillNames = useMemo(() => {
    if (!overview) return [];
    const names = new Set<string>();
    for (const tool of overview.tools) {
      for (const skill of tool.skills) {
        if (skill.hashConflictsMySkills) {
          names.add(skill.name);
        }
      }
    }
    return Array.from(names).sort();
  }, [overview]);

  const conflictView = useMemo(() => {
    if (!conflictDetail) {
      return {
        baseline: null as SkillConflictDetail["variants"][number] | null,
        conflicts: [] as Array<{
          variant: SkillConflictDetail["variants"][number];
          diff: ReturnType<typeof buildSkillDiff>;
        }>,
        hiddenMatchedCount: 0,
      };
    }

    const baseline = conflictDetail.variants.find((variant) => variant.sourceId === "my-skills") ?? null;
    if (!baseline) {
      return {
        baseline: null,
        conflicts: conflictDetail.variants.map((variant) => ({
          variant,
          diff: buildSkillDiff(conflictDetail.variants[0]?.content ?? "", variant.content),
        })),
        hiddenMatchedCount: 0,
      };
    }

    const conflictingVariants = conflictDetail.variants.filter(
      (variant) => variant.sourceId !== "my-skills" && !variant.hashMatchesMySkills,
    );
    return {
      baseline,
      conflicts: conflictingVariants.map((variant) => ({
        variant,
        diff: buildSkillDiff(baseline.content, variant.content),
      })),
      hiddenMatchedCount:
        conflictDetail.variants.filter(
          (variant) => variant.sourceId !== "my-skills" && variant.hashMatchesMySkills,
        ).length,
    };
  }, [conflictDetail]);

  function describeConflictDetail(detail: SkillConflictDetail) {
    const baseline = detail.variants.find((variant) => variant.sourceId === "my-skills") ?? null;
    if (!baseline) {
      return detail.variants.length > 0
        ? `已加载 ${detail.variants.length} 个来源（未检测到 my-skills 基准）。`
        : "未找到该技能的可用来源。";
    }
    const conflictingCount = detail.variants.filter(
      (variant) => variant.sourceId !== "my-skills" && !variant.hashMatchesMySkills,
    ).length;
    const hiddenMatchedCount = detail.variants.filter(
      (variant) => variant.sourceId !== "my-skills" && variant.hashMatchesMySkills,
    ).length;
    if (conflictingCount === 0) {
      return hiddenMatchedCount > 0
        ? `所有来源与基准一致，已隐藏 ${hiddenMatchedCount} 个一致来源。`
        : "当前没有可处理的冲突来源。";
    }
    return hiddenMatchedCount > 0
      ? `识别到 ${conflictingCount} 个冲突来源，已隐藏 ${hiddenMatchedCount} 个与基准一致来源。`
      : `识别到 ${conflictingCount} 个冲突来源。`;
  }

  async function handleLocalOverview() {
    setOverviewBusy(true);
    setOverviewStatus("正在扫描本机工具技能...");
    try {
      const result = await setupLocalSkillsOverview();
      setOverview(result);
      if (result.tools.length === 0) {
        setOverviewStatus("未识别到可导入的工具技能。");
      } else {
        const summary = `共识别 ${result.totalSkills} 个技能（唯一 ${result.uniqueSkills}）；已同步 ${result.matchedInMySkills}，未收录 ${result.missingInMySkills}，冲突 ${result.conflictWithMySkills}。`;
        setOverviewStatus(
          result.missingInMySkills > 0
            ? `${summary} 可点击下方按钮同步未收录技能。`
            : summary,
        );
        if (result.missingInMySkills > 0) {
          return;
        }
        if (result.conflictWithMySkills > 0) {
          setOverviewStatus(`${summary} 存在同名但内容不同的技能，请手动处理冲突。`);
        } else {
          setOverviewStatus(`${summary} 当前无需同步。`);
        }
      }
    } catch (e: unknown) {
      setOverviewStatus(String(e));
    } finally {
      setOverviewBusy(false);
    }
  }

  async function handleSyncMissingSkills() {
    if (!overview || overview.missingInMySkills === 0) return;

    setSyncMissingBusy(true);
    setOverviewStatus(`开始同步 ${overview.missingInMySkills} 个未收录技能...`);
    try {
      const syncResult = await onboardingImportInstalledSkills();
      const refreshed = await setupLocalSkillsOverview();
      setOverview(refreshed);
      setOverviewStatus(
        `已同步 ${syncResult.importedTotal}/${syncResult.detectedTotal}，跳过已存在 ${syncResult.skippedExistingTotal}。当前未收录 ${refreshed.missingInMySkills}。`,
      );
      onRefresh();
    } catch (e: unknown) {
      setOverviewStatus(String(e));
    } finally {
      setSyncMissingBusy(false);
    }
  }

  async function handleOpenConflictResolver(skillName: string) {
    if (!skillName) return;
    setActiveConflictSkill(skillName);
    setConflictDetailBusy(true);
    setConflictResolveBusySource(null);
    setConflictViewMode("diff");
    setConflictDetail(null);
    setConflictStatus(`正在加载 ${skillName} 的冲突详情...`);
    try {
      const detail = await setupGetSkillConflictDetail(skillName);
      setConflictDetail(detail);
      setConflictStatus(describeConflictDetail(detail));
    } catch (e: unknown) {
      setConflictStatus(String(e));
    } finally {
      setConflictDetailBusy(false);
    }
  }

  function handleCloseConflictResolver() {
    setActiveConflictSkill(null);
    setConflictDetail(null);
    setConflictResolveBusySource(null);
    setConflictViewMode("diff");
    setConflictStatus("");
  }

  async function handleResolveConflict(sourceId: string) {
    if (!conflictDetail) return;
    const source = conflictDetail.variants.find((variant) => variant.sourceId === sourceId);
    setConflictResolveBusySource(sourceId);
    setConflictStatus(`正在将 ${source?.sourceName ?? sourceId} 设为基准...`);
    try {
      await setupResolveSkillConflict(conflictDetail.skillName, sourceId);
      const [detail, refreshedOverview] = await Promise.all([
        setupGetSkillConflictDetail(conflictDetail.skillName),
        setupLocalSkillsOverview(),
      ]);
      setConflictDetail(detail);
      setOverview(refreshedOverview);
      setConflictStatus(`已将 ${source?.sourceName ?? sourceId} 设为基准。${describeConflictDetail(detail)}`);
      onRefresh();
    } catch (e: unknown) {
      setConflictStatus(String(e));
    } finally {
      setConflictResolveBusySource(null);
    }
  }

  return (
    <div className="page animate-fadein skills-page">
      <header className="page-header skills-page-header">
        <div className="skills-header-copy">
          <h1 className="page-title">{t("skills.title")}</h1>
          <p className="skills-installed">{t("skills.installed", { count: skills.length })}</p>
        </div>
        <div className="skills-header-actions">
          <button
            className="btn btn-primary skills-overview-btn"
            onClick={() => void handleLocalOverview()}
            disabled={overviewBusy}
          >
            {overviewBusy ? "扫描中..." : "全览本机 skills"}
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
        </div>
      </header>

      {(overviewStatus || overview) && (
        <section className="skills-overview-panel">
          {overviewStatus && <p className="skills-overview-status">{overviewStatus}</p>}
          {overview && (
            <>
              <p className="skills-overview-summary">
                工具数 {overview.tools.length}，技能总数 {overview.totalSkills}，唯一技能 {overview.uniqueSkills}
                ，已同步 {overview.matchedInMySkills}，未收录 {overview.missingInMySkills}，冲突{" "}
                {overview.conflictWithMySkills}
              </p>
              <div className="skills-overview-legend">
                <span className="skills-overview-tag matched">哈希一致</span>
                <span className="skills-overview-tag missing">未收录</span>
                <span className="skills-overview-tag conflict">内容冲突</span>
              </div>
              {overview.missingInMySkills > 0 && (
                <div className="skills-overview-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() => void handleSyncMissingSkills()}
                    disabled={syncMissingBusy}
                  >
                    {syncMissingBusy ? "同步中..." : `同步未收录 skills (${overview.missingInMySkills})`}
                  </button>
                </div>
              )}
              {overview.duplicateNames.length > 0 && (
                <div className="skills-overview-duplicates">
                  <strong>重名技能：</strong>
                  <div className="skills-overview-tags">
                    {overview.duplicateNames.map((name) => (
                      <span key={name} className="skills-overview-tag duplicate">
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {conflictSkillNames.length > 0 && (
                <div className="skills-overview-conflicts">
                  <strong>冲突技能（点击查看详情并设为基准）：</strong>
                  <div className="skills-overview-tags">
                    {conflictSkillNames.map((name) => (
                      <button
                        type="button"
                        key={`conflict-name-${name}`}
                        className="skills-overview-tag conflict skills-overview-conflict-btn"
                        onClick={() => void handleOpenConflictResolver(name)}
                        disabled={conflictDetailBusy}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="skills-overview-tools">
                {overview.tools.map((tool) => (
                  <article key={tool.toolId} className="skills-overview-tool-card">
                    <h3>
                      {tool.toolName} ({tool.count})
                    </h3>
                    <div className="skills-overview-tags">
                      {tool.skills.map((skill) => {
                        const stateClass = skill.hashConflictsMySkills
                          ? "conflict"
                          : skill.hashMatchesMySkills
                            ? "matched"
                            : skill.duplicateAcrossTools
                              ? "duplicate"
                              : skill.inMySkills
                                ? "tracked"
                                : "missing";

                        if (skill.hashConflictsMySkills) {
                          return (
                            <button
                              type="button"
                              key={`${tool.toolId}-${skill.name}`}
                              className={`skills-overview-tag ${stateClass} skills-overview-conflict-btn`}
                              onClick={() => void handleOpenConflictResolver(skill.name)}
                              disabled={conflictDetailBusy}
                            >
                              {skill.name}
                            </button>
                          );
                        }

                        return (
                          <span key={`${tool.toolId}-${skill.name}`} className={`skills-overview-tag ${stateClass}`}>
                            {skill.name}
                          </span>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {visible.length === 0 ? (
        <p className="empty-state">{t("skills.empty")}</p>
      ) : (
        <div className="skills-grid">
          {visible.map((skill) => (
            <SkillCard
              key={skill.name}
              name={skill.name}
              description={skill.description}
              category={skill.category}
              tags={skill.tags}
              onEdit={() => setEditing(skill)}
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

      {activeConflictSkill && (
        <div className="skills-conflict-overlay" onClick={handleCloseConflictResolver}>
          <aside
            className="skills-conflict-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`${activeConflictSkill} 冲突详情`}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="skills-conflict-header">
              <h2 className="skills-conflict-title">{activeConflictSkill} 冲突详情</h2>
              <div className="skills-conflict-actions">
                <span className="skills-conflict-status">{conflictStatus}</span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleCloseConflictResolver}
                  aria-label="关闭冲突详情"
                  title="关闭冲突详情"
                >
                  <IconClose size={16} />
                </button>
              </div>
            </header>

            <div className="skills-conflict-body">
              {conflictDetailBusy && <p className="skills-conflict-placeholder">冲突详情加载中...</p>}
              {!conflictDetailBusy && !conflictDetail && (
                <p className="skills-conflict-placeholder">未能加载冲突详情，请重试。</p>
              )}
              {!conflictDetailBusy && conflictDetail && conflictDetail.variants.length === 0 && (
                <p className="skills-conflict-placeholder">没有可处理的来源。</p>
              )}
              {!conflictDetailBusy && conflictDetail && conflictDetail.variants.length > 0 && (
                <>
                  <div className="skills-conflict-view-mode">
                    <span className="skills-conflict-view-mode-label">查看模式：</span>
                    <div className="skills-conflict-view-mode-actions">
                      <button
                        type="button"
                        className={`btn ${conflictViewMode === "diff" ? "btn-primary" : "btn-ghost"}`}
                        onClick={() => setConflictViewMode("diff")}
                      >
                        仅看变更
                      </button>
                      <button
                        type="button"
                        className={`btn ${conflictViewMode === "full" ? "btn-primary" : "btn-ghost"}`}
                        onClick={() => setConflictViewMode("full")}
                      >
                        完整内容
                      </button>
                    </div>
                  </div>

                  {conflictView.hiddenMatchedCount > 0 && (
                    <p className="skills-conflict-placeholder">
                      已隐藏 {conflictView.hiddenMatchedCount} 个与基准一致来源，仅展示冲突来源。
                    </p>
                  )}

                  <div className="skills-conflict-variants">
                    {conflictView.baseline && (
                      <article key={conflictView.baseline.sourceId} className="skills-conflict-variant baseline">
                        <div className="skills-conflict-variant-head">
                          <div className="skills-conflict-variant-copy">
                            <h3>{conflictView.baseline.sourceName}</h3>
                            <p>
                              sourceId: {conflictView.baseline.sourceId} | hash: {conflictView.baseline.contentHash}
                            </p>
                          </div>
                          <div className="skills-conflict-variant-actions">
                            <button type="button" className="btn btn-ghost" disabled>
                              当前基准
                            </button>
                          </div>
                        </div>
                        <div className="skills-overview-legend">
                          <span className="skills-overview-tag matched">当前基准</span>
                          {conflictView.baseline.fileList.length > 0 && (
                            <span className="skills-overview-tag tracked">
                              {conflictView.baseline.fileList.length} 个文件
                            </span>
                          )}
                        </div>
                        {conflictView.baseline.fileList.length > 1 && (
                          <details className="skills-conflict-filelist">
                            <summary>文件清单 ({conflictView.baseline.fileList.length})</summary>
                            <ul>
                              {conflictView.baseline.fileList.map((f) => (
                                <li key={f}>{f}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                        <pre className="skills-conflict-content">{conflictView.baseline.content}</pre>
                      </article>
                    )}

                    {conflictView.conflicts.map(({ variant, diff }) => (
                      <article key={variant.sourceId} className="skills-conflict-variant">
                        <div className="skills-conflict-variant-head">
                          <div className="skills-conflict-variant-copy">
                            <h3>{variant.sourceName}</h3>
                            <p>
                              sourceId: {variant.sourceId} | hash: {variant.contentHash}
                            </p>
                          </div>
                          <div className="skills-conflict-variant-actions">
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => void handleResolveConflict(variant.sourceId)}
                              disabled={Boolean(conflictResolveBusySource)}
                            >
                              {conflictResolveBusySource === variant.sourceId ? "处理中..." : "设为基准"}
                            </button>
                          </div>
                        </div>
                        <div className="skills-overview-legend">
                          <span className="skills-overview-tag conflict">与基准冲突</span>
                          <span className="skills-overview-tag duplicate">+{diff.added}</span>
                          <span className="skills-overview-tag duplicate">-{diff.removed}</span>
                          {variant.fileList.length > 0 && (
                            <span className="skills-overview-tag tracked">
                              {variant.fileList.length} 个文件
                            </span>
                          )}
                        </div>
                        {variant.fileList.length > 1 && (
                          <details className="skills-conflict-filelist">
                            <summary>文件清单 ({variant.fileList.length})</summary>
                            <ul>
                              {variant.fileList.map((f) => (
                                <li key={f}>{f}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                        {conflictViewMode === "full" ? (
                          <pre className="skills-conflict-content">{variant.content}</pre>
                        ) : diff.hasChanges ? (
                          <pre className="skills-conflict-diff">
                            {diff.lines.map((line, idx) => (
                              <span key={`${variant.sourceId}-${line.kind}-${idx}`} className={`skills-conflict-diff-line ${line.kind}`}>
                                <span className="skills-conflict-diff-prefix">
                                  {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}
                                </span>
                                {line.text}
                              </span>
                            ))}
                          </pre>
                        ) : (
                          <p className="skills-conflict-placeholder">未识别到内容差异。</p>
                        )}
                        {diff.truncated && (
                          <p className="skills-conflict-placeholder">
                            diff 已截断，仍有 {diff.hiddenLineCount} 行未展示。
                          </p>
                        )}
                      </article>
                    ))}
                  </div>

                  {conflictView.conflicts.length === 0 && (
                    <p className="skills-conflict-placeholder">当前没有与基准冲突的来源。</p>
                  )}
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

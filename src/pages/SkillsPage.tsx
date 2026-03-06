import { useMemo, useState } from "react";

import { skillsDeleteEverywhere, type SkillMeta } from "../api/tauri";
import SkillCard from "../components/SkillCard";
import SkillEditor from "../components/SkillEditor";
import { IconRefresh, IconSearch } from "../components/icons";
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
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [editing, setEditing] = useState<SkillMeta | null>(null);
  const [deletingSkillName, setDeletingSkillName] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState("");

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
          {actionStatus ? <p className="skills-action-status">{actionStatus}</p> : null}
        </div>
        <div className="skills-header-actions">
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
          {visible.map((skill) => (
            <SkillCard
              key={skill.name}
              name={skill.name}
              description={skill.description}
              category={skill.category}
              tags={skill.tags}
              onEdit={() => setEditing(skill)}
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

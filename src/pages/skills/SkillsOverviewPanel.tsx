import type { LocalSkillsOverview } from "../../api/tauri";
import type { MessageKey } from "../../i18n/messages";
import type { MissingSkillSource } from "./useSkillsPageController";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

type Props = {
  overview: LocalSkillsOverview | null;
  overviewStatus: string;
  overviewSyncBusy: boolean;
  overviewSyncingSkillName: string | null;
  missingSkillSources: MissingSkillSource[];
  conflictDetailBusy: boolean;
  conflictSkillNames: string[];
  t: Translate;
  onSyncMissingSkills: () => void;
  onSyncMissingSkill: (source: MissingSkillSource) => void;
  onOpenConflictResolver: (skillName: string) => void;
};

export default function SkillsOverviewPanel({
  overview,
  overviewStatus,
  overviewSyncBusy,
  overviewSyncingSkillName,
  missingSkillSources,
  conflictDetailBusy,
  conflictSkillNames,
  t,
  onSyncMissingSkills,
  onSyncMissingSkill,
  onOpenConflictResolver,
}: Props) {
  if (!overviewStatus && !overview) {
    return null;
  }

  return (
    <section className="skills-overview-panel">
      {overviewStatus && (
        <p className="skills-overview-status" role="status" aria-live="polite">
          {overviewStatus}
        </p>
      )}
      {overview && (
        <>
          <p className="skills-overview-summary">
            {t("skills.overview.panel.summary", {
              tools: overview.tools.length,
              total: overview.totalSkills,
              unique: overview.uniqueSkills,
              matched: overview.matchedInMySkills,
              missing: overview.missingInMySkills,
              conflict: overview.conflictWithMySkills,
            })}
          </p>
          <div className="skills-overview-legend">
            <span className="skills-overview-tag matched">{t("skills.overview.legend.matched")}</span>
            <span className="skills-overview-tag missing">{t("skills.overview.legend.missing")}</span>
            <span className="skills-overview-tag conflict">{t("skills.overview.legend.conflict")}</span>
          </div>
          <div className="skills-overview-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSyncMissingSkills}
              disabled={overviewSyncBusy || missingSkillSources.length === 0}
            >
              {overviewSyncBusy
                ? t("skills.overview.sync.button.busy")
                : t("skills.overview.sync.button", { count: missingSkillSources.length })}
            </button>
          </div>
          {overview.duplicateNames.length > 0 && (
            <div className="skills-overview-duplicates">
              <strong>{t("skills.overview.duplicates.title")}</strong>
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
              <strong>{t("skills.overview.conflicts.title")}</strong>
              <div className="skills-overview-tags">
                {conflictSkillNames.map((name) => (
                  <button
                    type="button"
                    key={`conflict-name-${name}`}
                    className="skills-overview-tag conflict skills-overview-conflict-btn"
                    onClick={() => onOpenConflictResolver(name)}
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
                          onClick={() => onOpenConflictResolver(skill.name)}
                          disabled={conflictDetailBusy}
                        >
                          {skill.name}
                        </button>
                      );
                    }

                    if (!skill.inMySkills) {
                      const source = missingSkillSources.find(
                        (item) => item.skillName === skill.name && item.sourceId === tool.toolId,
                      );
                      if (source) {
                        const syncingCurrent = overviewSyncingSkillName === source.skillName;
                        return (
                          <button
                            type="button"
                            key={`${tool.toolId}-${skill.name}`}
                            className={`skills-overview-tag ${stateClass} skills-overview-sync-btn`}
                            onClick={() => onSyncMissingSkill(source)}
                            disabled={conflictDetailBusy || overviewSyncBusy}
                            title={t("skills.overview.sync.single.button")}
                          >
                            {skill.name}
                            {syncingCurrent ? ` · ${t("skills.overview.sync.single.busy")}` : ""}
                          </button>
                        );
                      }
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
  );
}


import type { LocalSkillsOverview } from "../../api/tauri";
import type { MessageKey } from "../../i18n/messages";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

type Props = {
  overview: LocalSkillsOverview | null;
  overviewStatus: string;
  syncMissingBusy: boolean;
  conflictDetailBusy: boolean;
  conflictSkillNames: string[];
  t: Translate;
  onSyncMissingSkills: () => void;
  onOpenConflictResolver: (skillName: string) => void;
};

export default function SkillsOverviewPanel({
  overview,
  overviewStatus,
  syncMissingBusy,
  conflictDetailBusy,
  conflictSkillNames,
  t,
  onSyncMissingSkills,
  onOpenConflictResolver,
}: Props) {
  if (!overviewStatus && !overview) {
    return null;
  }

  return (
    <section className="skills-overview-panel">
      {overviewStatus && <p className="skills-overview-status">{overviewStatus}</p>}
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
          {overview.missingInMySkills > 0 && (
            <div className="skills-overview-actions">
              <button className="btn btn-primary" onClick={onSyncMissingSkills} disabled={syncMissingBusy}>
                {syncMissingBusy
                  ? t("skills.overview.sync.button.busy")
                  : t("skills.overview.sync.button", { count: overview.missingInMySkills })}
              </button>
            </div>
          )}
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


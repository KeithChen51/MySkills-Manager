import { useRef } from "react";
import type { SkillConflictDetail } from "../../api/tauri";
import useDialogA11y from "../../components/useDialogA11y";
import { IconClose } from "../../components/icons";
import type { MessageKey } from "../../i18n/messages";
import { useConflictDiffView } from "./useConflictDiffView";

type ConflictViewMode = "diff" | "full";
type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

type Props = {
  activeConflictSkill: string | null;
  conflictDetailBusy: boolean;
  conflictStatus: string;
  conflictDetail: SkillConflictDetail | null;
  conflictViewMode: ConflictViewMode;
  conflictResolveBusySource: string | null;
  t: Translate;
  onClose: () => void;
  onViewModeChange: (mode: ConflictViewMode) => void;
  onResolveConflict: (sourceId: string) => void;
};

function degradedNotice(
  t: Translate,
  reason: "input_limit" | "complexity_limit" | undefined,
) {
  if (reason === "input_limit") {
    return t("skills.conflict.diff.degraded.input");
  }
  if (reason === "complexity_limit") {
    return t("skills.conflict.diff.degraded.complexity");
  }
  return t("skills.conflict.diff.degraded.generic");
}

export default function SkillConflictDrawer({
  activeConflictSkill,
  conflictDetailBusy,
  conflictStatus,
  conflictDetail,
  conflictViewMode,
  conflictResolveBusySource,
  t,
  onClose,
  onViewModeChange,
  onResolveConflict,
}: Props) {
  const { baseline, hiddenMatchedCount, conflicts, computingDiff } = useConflictDiffView(conflictDetail);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const { dialogRef } = useDialogA11y({
    open: Boolean(activeConflictSkill),
    onClose,
    initialFocusRef: closeButtonRef,
  });

  if (!activeConflictSkill) {
    return null;
  }

  return (
    <div className="skills-conflict-overlay" onClick={onClose}>
      <aside
        ref={dialogRef}
        className="skills-conflict-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={t("skills.conflict.drawer.aria", { skill: activeConflictSkill })}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="skills-conflict-header">
          <h2 className="skills-conflict-title">
            {t("skills.conflict.drawer.title", { skill: activeConflictSkill })}
          </h2>
          <div className="skills-conflict-actions">
            <span className="skills-conflict-status">{conflictStatus}</span>
            <button
              ref={closeButtonRef}
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              aria-label={t("skills.conflict.drawer.close")}
              title={t("skills.conflict.drawer.close")}
            >
              <IconClose size={16} />
            </button>
          </div>
        </header>

        <div className="skills-conflict-body">
          {conflictDetailBusy && (
            <p className="skills-conflict-placeholder">{t("skills.conflict.placeholder.loading")}</p>
          )}
          {!conflictDetailBusy && !conflictDetail && (
            <p className="skills-conflict-placeholder">{t("skills.conflict.placeholder.loadFailed")}</p>
          )}
          {!conflictDetailBusy && conflictDetail && conflictDetail.variants.length === 0 && (
            <p className="skills-conflict-placeholder">{t("skills.conflict.placeholder.noVariants")}</p>
          )}
          {!conflictDetailBusy && conflictDetail && conflictDetail.variants.length > 0 && (
            <>
              <div className="skills-conflict-view-mode">
                <span className="skills-conflict-view-mode-label">{t("skills.conflict.view.label")}</span>
                <div className="skills-conflict-view-mode-actions">
                  <button
                    type="button"
                    className={`btn ${conflictViewMode === "diff" ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => onViewModeChange("diff")}
                  >
                    {t("skills.conflict.view.diff")}
                  </button>
                  <button
                    type="button"
                    className={`btn ${conflictViewMode === "full" ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => onViewModeChange("full")}
                  >
                    {t("skills.conflict.view.full")}
                  </button>
                </div>
              </div>

              {hiddenMatchedCount > 0 && (
                <p className="skills-conflict-placeholder">
                  {t("skills.conflict.placeholder.hiddenMatched", { count: hiddenMatchedCount })}
                </p>
              )}

              <div className="skills-conflict-variants">
                {baseline && (
                  <article key={baseline.sourceId} className="skills-conflict-variant baseline">
                    <div className="skills-conflict-variant-head">
                      <div className="skills-conflict-variant-copy">
                        <h3>{baseline.sourceName}</h3>
                        <p>{t("skills.conflict.meta", { sourceId: baseline.sourceId, hash: baseline.contentHash })}</p>
                      </div>
                      <div className="skills-conflict-variant-actions">
                        <button type="button" className="btn btn-ghost" disabled>
                          {t("skills.conflict.baseline.current")}
                        </button>
                      </div>
                    </div>
                    <div className="skills-overview-legend">
                      <span className="skills-overview-tag matched">{t("skills.conflict.baseline.current")}</span>
                      {baseline.fileList.length > 0 && (
                        <span className="skills-overview-tag tracked">
                          {t("skills.conflict.files.count", { count: baseline.fileList.length })}
                        </span>
                      )}
                    </div>
                    {baseline.fileList.length > 1 && (
                      <details className="skills-conflict-filelist">
                        <summary>
                          {t("skills.conflict.files.list", { count: baseline.fileList.length })}
                        </summary>
                        <ul>
                          {baseline.fileList.map((f) => (
                            <li key={f}>{f}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <pre className="skills-conflict-content">{baseline.content}</pre>
                  </article>
                )}

                {conflicts.map(({ variant, diff }) => (
                  <article key={variant.sourceId} className="skills-conflict-variant">
                    <div className="skills-conflict-variant-head">
                      <div className="skills-conflict-variant-copy">
                        <h3>{variant.sourceName}</h3>
                        <p>{t("skills.conflict.meta", { sourceId: variant.sourceId, hash: variant.contentHash })}</p>
                      </div>
                      <div className="skills-conflict-variant-actions">
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => onResolveConflict(variant.sourceId)}
                          disabled={Boolean(conflictResolveBusySource)}
                        >
                          {conflictResolveBusySource === variant.sourceId
                            ? t("skills.conflict.action.applying")
                            : t("skills.conflict.action.applyBaseline")}
                        </button>
                      </div>
                    </div>
                    {conflictViewMode === "full" ? (
                      <pre className="skills-conflict-content">{variant.content}</pre>
                    ) : !diff ? (
                      <p className="skills-conflict-placeholder">
                        {computingDiff
                          ? t("skills.conflict.diff.calculating")
                          : t("skills.conflict.placeholder.noChanges")}
                      </p>
                    ) : diff.hasChanges ? (
                      <>
                        <div className="skills-overview-legend">
                          <span className="skills-overview-tag conflict">
                            {t("skills.conflict.tag.conflict")}
                          </span>
                          <span className="skills-overview-tag duplicate">+{diff.added}</span>
                          <span className="skills-overview-tag duplicate">-{diff.removed}</span>
                          {variant.fileList.length > 0 && (
                            <span className="skills-overview-tag tracked">
                              {t("skills.conflict.files.count", { count: variant.fileList.length })}
                            </span>
                          )}
                        </div>
                        {variant.fileList.length > 1 && (
                          <details className="skills-conflict-filelist">
                            <summary>
                              {t("skills.conflict.files.list", { count: variant.fileList.length })}
                            </summary>
                            <ul>
                              {variant.fileList.map((f) => (
                                <li key={f}>{f}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                        <pre className="skills-conflict-diff">
                          {diff.lines.map((line, idx) => (
                            <span
                              key={`${variant.sourceId}-${line.kind}-${idx}`}
                              className={`skills-conflict-diff-line ${line.kind}`}
                            >
                              <span className="skills-conflict-diff-prefix">
                                {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}
                              </span>
                              {line.text}
                            </span>
                          ))}
                        </pre>
                        {diff.degraded && (
                          <p className="skills-conflict-placeholder">
                            {degradedNotice(t, diff.degradeReason)}
                          </p>
                        )}
                        {diff.truncated && (
                          <p className="skills-conflict-placeholder">
                            {t("skills.conflict.placeholder.truncated", {
                              hidden: diff.hiddenLineCount,
                            })}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="skills-conflict-placeholder">{t("skills.conflict.placeholder.noChanges")}</p>
                    )}
                  </article>
                ))}
              </div>

              {conflicts.length === 0 && (
                <p className="skills-conflict-placeholder">{t("skills.conflict.placeholder.noConflicts")}</p>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

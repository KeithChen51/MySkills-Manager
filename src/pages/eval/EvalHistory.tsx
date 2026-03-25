/**
 * EvalHistory.tsx - History modal (v6.0)
 * Uses eval-history-modal-backdrop, eval-history-modal, eval-history-list patterns.
 */
import { useEffect, useRef, useState } from "react";
import {
  evalListHistory,
  evalLoadHistory,
  type EvalModuleKey,
} from "../../api/tauri";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages";
import useDialogA11y from "../../components/useDialogA11y";
import { useEvalStore, useEvalDispatch, type EvalMode } from "./EvalStore";

interface EvalHistoryProps {
  open: boolean;
  onClose: () => void;
  skillName?: string;
}

const VALID_MODULE_KEYS = new Set<EvalModuleKey>([
  "trigger_accuracy",
  "execution_correctness",
  "robustness_security",
  "economics",
  "auditability",
]);

function normalizeEvalMode(mode: string): EvalMode {
  if (mode === "quick" || mode === "standard" || mode === "full") {
    return mode;
  }
  return "full";
}

export default function EvalHistory({ open, onClose, skillName }: EvalHistoryProps) {
  const { t } = useI18n();
  const state = useEvalStore();
  const dispatch = useEvalDispatch();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [loadBusyPath, setLoadBusyPath] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const { dialogRef } = useDialogA11y({
    open,
    onClose,
    initialFocusRef: closeButtonRef,
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    const targetSkill = (skillName ?? state.selectedSkill).trim();
    if (!targetSkill) {
      dispatch({ type: "SET_HISTORY_ENTRIES", payload: [] });
      return;
    }

    let active = true;
    setListLoading(true);
    setLoadError("");
    void evalListHistory(targetSkill, 30)
      .then((items) => {
        if (!active) return;
        dispatch({ type: "SET_HISTORY_ENTRIES", payload: items });
      })
      .catch((error: unknown) => {
        if (!active) return;
        dispatch({ type: "SET_HISTORY_ENTRIES", payload: [] });
        setLoadError(String(error));
      })
      .finally(() => {
        if (active) {
          setListLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [dispatch, open, skillName, state.selectedSkill]);

  if (!open) return null;

  const entries = state.historyEntries;

  async function handleLoadEntry(path: string) {
    setLoadBusyPath(path);
    setLoadError("");
    try {
      const loaded = await evalLoadHistory(path);
      const mode = normalizeEvalMode(loaded.mode);
      const selectedModules = mode === "quick"
        ? []
        : loaded.moduleResults
          ?.map((item) => item.key)
          .filter((key): key is EvalModuleKey => VALID_MODULE_KEYS.has(key as EvalModuleKey))
          ?? state.selectedModules;

      dispatch({
        type: "LOAD_HISTORY_ENTRY",
        payload: {
          report: loaded,
          runSnapshot: {
            skillName: state.selectedSkill.trim() || skillName || loaded.triggerClean.skillName || "--",
            mode,
            model: loaded.runMeta.model,
            repeats: loaded.runMeta.repeats,
            maxParallelArms: loaded.runMeta.maxParallelArms,
            triggerMaxWorkers: loaded.runMeta.triggerMaxWorkers,
            functionalMaxWorkers: loaded.runMeta.functionalMaxWorkers,
            selectedModules,
            triggerSetPath: state.triggerSetPath.trim(),
            functionalSetPath: state.functionalSetPath.trim(),
          },
          view: mode === "full" ? "review" : "result",
          status: t("eval.history.loaded" as MessageKey, { path }),
        },
      });
      onClose();
    } catch (error: unknown) {
      setLoadError(String(error));
    } finally {
      setLoadBusyPath((current) => (current === path ? null : current));
    }
  }

  return (
    <div className="eval-history-modal-backdrop" onClick={onClose}>
      <article
        ref={dialogRef}
        className="eval-history-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("eval.history.title" as MessageKey, { skill: skillName ?? "" })}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="eval-history-modal-head">
          <h3 className="chart-title">
            {t("eval.history.title" as MessageKey, { skill: skillName ?? "" })}
          </h3>
          <div className="eval-history-modal-actions">
            <button ref={closeButtonRef} type="button" className="btn btn-ghost" onClick={onClose}>
              {t("eval.history.close" as MessageKey)}
            </button>
          </div>
        </div>

        <div className="eval-history-modal-body">
          {listLoading ? (
            <p className="eval-path-hint">{t("app.loading" as MessageKey)}</p>
          ) : entries.length === 0 ? (
            <p className="eval-path-hint">{t("eval.history.empty" as MessageKey)}</p>
          ) : (
            <div className="eval-history-list">
              {entries.map((entry) => {
                const isExpanded = expandedPath === entry.path;
                return (
                  <article key={entry.path} className="eval-history-item">
                    <div className="eval-history-item-main">
                      <button
                        type="button"
                        className="eval-history-item-toggle"
                        aria-expanded={isExpanded}
                        onClick={() => setExpandedPath(isExpanded ? null : entry.path)}
                      >
                        <div className="eval-history-item-grid">
                          <div>
                            <span className="eval-history-item-label">
                              {t("eval.history.time" as MessageKey)}
                            </span>
                            <strong>{new Date(entry.savedAtUnix * 1000).toLocaleString()}</strong>
                          </div>
                          <div>
                            <span className="eval-history-item-label">
                              {t("eval.config.mode" as MessageKey)}
                            </span>
                            <strong>{entry.mode}</strong>
                          </div>
                          <div>
                            <span className="eval-history-item-label">
                              {t("eval.kpi.triggerPassRate" as MessageKey)}
                            </span>
                            <strong>{(entry.passRate * 100).toFixed(1)}%</strong>
                          </div>
                          <div>
                            <span className="eval-history-item-label">
                              {t("eval.history.repeats" as MessageKey)}
                            </span>
                            <strong>{entry.repeats}</strong>
                          </div>
                          <div>
                            <span className="eval-history-item-label">
                              {t("eval.history.reviewStatus" as MessageKey)}
                            </span>
                            <strong>
                              {entry.reviewSummary?.reviewed
                                ? t("eval.review.reviewed" as MessageKey)
                                : t("eval.review.pending" as MessageKey)}
                            </strong>
                          </div>
                        </div>
                      </button>
                      <div className="eval-history-item-actions">
                        <button
                          type="button"
                          className="btn btn-ghost eval-action-btn"
                          disabled={loadBusyPath === entry.path}
                          onClick={() => {
                            void handleLoadEntry(entry.path);
                          }}
                        >
                          {loadBusyPath === entry.path
                            ? t("app.loading" as MessageKey)
                            : t("eval.history.load" as MessageKey)}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {loadError ? <p className="eval-path-hint">{loadError}</p> : null}
        </div>
      </article>
    </div>
  );
}

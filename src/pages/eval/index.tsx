import { lazy, Suspense, useState, useCallback } from "react";
import { EvalProvider, useEvalStore, useEvalDispatch } from "./EvalStore";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages";
import type { SkillMeta } from "../../api/tauri";
import "../EvalPage.css";

const EvalSetup = lazy(() => import("./EvalSetup"));
const EvalRunning = lazy(() => import("./EvalRunning"));
const EvalResult = lazy(() => import("./EvalResult"));
const EvalReview = lazy(() => import("./EvalReview"));
const EvalHistory = lazy(() => import("./EvalHistory"));

interface Props {
  skills: SkillMeta[];
}

function EvalShellInner({ skills }: Props) {
  const { t } = useI18n();
  const state = useEvalStore();
  const dispatch = useEvalDispatch();
  const [showHistory, setShowHistory] = useState(false);

  const handleStartEval = useCallback(async () => {
    const skillMeta = skills.find((s) => s.name === state.selectedSkill);
    if (!skillMeta || !state.model || !state.triggerSetPath) return;
    const skillPath = `${skillMeta.directory.replace(/[\\/]+$/, "")}/SKILL.md`;

    dispatch({ type: "SET_RUNNING", payload: true });
    dispatch({ type: "SET_VIEW", payload: "running" });
    dispatch({ type: "SET_STATUS", payload: t("eval.running.initializing" as MessageKey) });

    try {
      const { runEvalPipeline } = await import("../../api/tauri");
      const result = await runEvalPipeline({
        skillName: state.selectedSkill,
        skillPath,
        triggerEvalSetPath: state.triggerSetPath,
        functionalEvalSetPath: state.functionalSetPath || "",
        mode: state.evalMode === "quick" ? "quick" : state.evalMode === "standard" ? "standard" : "full",
        model: state.model,
        judgeModel: state.judgeModel || undefined,
        repeats: parseInt(state.repeatsInput, 10) || 1,
        maxParallelArms: parseInt(state.maxParallelArmsInput, 10) || 2,
      });

      dispatch({ type: "SET_REPORT", payload: result });
      dispatch({ type: "SET_VIEW", payload: "result" });
      dispatch({ type: "SET_STATUS", payload: "" });
    } catch (error: unknown) {
      dispatch({ type: "SET_STATUS", payload: `❌ ${String(error)}` });
    } finally {
      dispatch({ type: "SET_RUNNING", payload: false });
    }
  }, [skills, state.selectedSkill, state.model, state.triggerSetPath, state.functionalSetPath, state.evalMode, state.judgeModel, state.repeatsInput, state.maxParallelArmsInput, dispatch, t]);

  const viewLabel =
    state.view === "running"
      ? t("eval.running.backToSetup" as MessageKey)
      : state.view === "result" || state.view === "review"
        ? t("eval.running.backToSetup" as MessageKey)
        : "";

  return (
    <div className={`page animate-fadein eval-page${state.view === "running" ? " eval-page-has-dock" : ""}`}>
      {/* ── Page Header ── */}
      <header className="page-header eval-page-header page-header-grid">
        <div className="eval-page-header-main page-header-copy">
          <h1 className="page-title eval-page-title">
            <span>{t("eval.title" as MessageKey)}</span>
            <span className="eval-beta-badge">BETA</span>
          </h1>
          <p className="eval-page-header-hint">
            {state.status || t("eval.notice.nonBlocking" as MessageKey)}
          </p>
        </div>
        <div className="eval-page-header-actions page-header-actions-grid">
          <div className="eval-page-header-actions-row page-header-actions-row">
            {state.view === "setup" ? (
              <button
                className="btn btn-primary eval-page-run-btn"
                onClick={() => void handleStartEval()}
                disabled={state.running || !state.selectedSkill || !state.triggerSetPath}
              >
                {t("eval.run" as MessageKey)}
              </button>
            ) : (
              <button
                className="btn btn-ghost eval-page-run-btn"
                onClick={() => {
                  dispatch({ type: "PATCH", payload: { view: "setup", report: null, runSnapshot: null, status: "" } });
                }}
                disabled={state.running}
              >
                {viewLabel}
              </button>
            )}
            <button
              className="btn btn-ghost"
              onClick={() => setShowHistory(true)}
            >
              {t("eval.history.view" as MessageKey)}
            </button>
          </div>
        </div>
      </header>

      {/* ── View Dispatch ── */}
      <Suspense fallback={<div className="empty-state">{t("app.loading" as MessageKey)}</div>}>
        {state.view === "setup" && <EvalSetup skills={skills} />}
        {state.view === "running" && <EvalRunning />}
        {state.view === "result" && <EvalResult />}
        {state.view === "review" && <EvalReview />}
      </Suspense>

      {/* ── History Modal ── */}
      <Suspense fallback={null}>
        <EvalHistory
          open={showHistory}
          onClose={() => setShowHistory(false)}
          skillName={state.selectedSkill}
        />
      </Suspense>
    </div>
  );
}

export default function EvalPage({ skills }: Props) {
  return (
    <EvalProvider skills={skills}>
      <EvalShellInner skills={skills} />
    </EvalProvider>
  );
}

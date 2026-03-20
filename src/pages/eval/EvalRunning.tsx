/**
 * EvalRunning.tsx — Stage-milestone progress visualization (v6.0)
 *
 * Displays 3–5 milestones depending on mode:
 *   quick: 预检查 → 触发测试 → 汇总
 *   standard: 预检查 → 触发测试 → 并行评估 → 汇总
 *   full: 预检查 → 触发测试 → 并行评估 → 汇总 → 审查
 *
 * Each milestone: green ✓ when done, pulsing when active, gray when pending.
 * Active stage shows case-level sub-progress (if applicable).
 */
import { useMemo, useState, useEffect, useRef } from "react";
import { useEvalStore, useEvalDispatch } from "./EvalStore";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages";

// ---------------------------------------------------------------------------
// Stage definitions
// ---------------------------------------------------------------------------

interface StageDef {
  key: string;
  label: MessageKey;
  hasCases: boolean;
}

const STAGES_QUICK: StageDef[] = [
  { key: "prepare", label: "eval.progress.step.quickChecks" as MessageKey, hasCases: false },
  { key: "trigger_clean", label: "eval.progress.step.triggerClean" as MessageKey, hasCases: true },
  { key: "finalize", label: "eval.progress.step.finalize" as MessageKey, hasCases: false },
];

const STAGES_STANDARD: StageDef[] = [
  { key: "prepare", label: "eval.progress.step.quickChecks" as MessageKey, hasCases: false },
  { key: "trigger_clean", label: "eval.progress.step.triggerClean" as MessageKey, hasCases: true },
  { key: "parallel_arms", label: "eval.progress.step.parallelArms" as MessageKey, hasCases: true },
  { key: "finalize", label: "eval.progress.step.finalize" as MessageKey, hasCases: false },
];

const STAGES_FULL: StageDef[] = [
  { key: "prepare", label: "eval.progress.step.quickChecks" as MessageKey, hasCases: false },
  { key: "trigger_clean", label: "eval.progress.step.triggerClean" as MessageKey, hasCases: true },
  { key: "parallel_arms", label: "eval.progress.step.parallelArms" as MessageKey, hasCases: true },
  { key: "finalize", label: "eval.progress.step.finalize" as MessageKey, hasCases: false },
  { key: "review_queue", label: "eval.progress.step.reviewQueue" as MessageKey, hasCases: false },
];

type CaseStatusType = "pass" | "fail" | "running" | "pending";
type StageStats = { completed: number; failed: number; total: number };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EvalRunning() {
  const { t } = useI18n();
  const state = useEvalStore();
  const dispatch = useEvalDispatch();
  const p = state.progressEvent;

  // Elapsed time counter (frontend, ticks every second)
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Track completed stage stats — accumulate per-stage data while active,
  // then snapshot on stage transition.
  const [stageStats, setStageStats] = useState<Record<string, StageStats>>({});
  const prevStageKeyRef = useRef<string | null>(null);
  const runningStatsRef = useRef<Record<string, StageStats>>({});

  const mode = state.runSnapshot?.mode ?? state.evalMode;
  const stages = useMemo(() => {
    if (mode === "quick") return STAGES_QUICK;
    if (mode === "full") return STAGES_FULL;
    return STAGES_STANDARD;
  }, [mode]);

  const currentStageKey = p?.stageKey ?? null;
  const currentStageIdx = stages.findIndex((s) => s.key === currentStageKey);
  const isCompleted = p?.status === "completed";

  // Keep running totals updated for the current stage
  useEffect(() => {
    if (currentStageKey && p) {
      runningStatsRef.current[currentStageKey] = {
        completed: p.completedCount ?? 0,
        failed: p.failedCount ?? 0,
        total: p.totalCount ?? 0,
      };
    }
  }, [currentStageKey, p]);

  // Capture stats only after render when stage transitions.
  useEffect(() => {
    const prevStage = prevStageKeyRef.current;
    if (prevStage && prevStage !== currentStageKey) {
      const lastKnown = runningStatsRef.current[prevStage];
      if (lastKnown) {
        setStageStats((existing) => {
          if (existing[prevStage]) return existing;
          return { ...existing, [prevStage]: lastKnown };
        });
      }
    }
    prevStageKeyRef.current = currentStageKey;
  }, [currentStageKey]);

  const totalPercent = p?.totalProgressPercent ?? 0;
  const stagePercent = p?.stageProgressPercent ?? 0;
  const completed = p?.completedCount ?? 0;
  const total = p?.totalCount ?? 0;
  const failedCount = p?.failedCount ?? 0;
  const caseStatuses = p?.caseStatuses ?? [];
  const hasProgress = !!p;

  const activeStage = currentStageIdx >= 0 ? stages[currentStageIdx] : null;

  // Compute remaining time on frontend (more responsive than backend)
  const computedRemaining = useMemo(() => {
    if (!hasProgress || totalPercent <= 1 || elapsed < 3) return null;
    const ratio = totalPercent / 100;
    const estimatedTotal = elapsed / ratio;
    const remaining = Math.max(0, Math.round(estimatedTotal - elapsed));
    return remaining;
  }, [hasProgress, totalPercent, elapsed]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <>
      <article className="chart-card eval-running-stage-card">
        <div className="eval-running-stage-head">
          <h3 className="chart-title">{t("eval.running.title" as MessageKey)}</h3>
          <div className="eval-running-stage-actions">
            <button
              className="btn btn-ghost"
              onClick={() => dispatch({ type: "SET_VIEW", payload: "setup" })}
            >
              {t("eval.running.backToSetup" as MessageKey)}
            </button>
          </div>
        </div>

        {/* ── Stage Milestone Bar ── */}
        <div className="eval-milestone-bar">
          <div className="eval-milestone-line" />
          {stages.map((stage, idx) => {
            let status: "done" | "active" | "pending" = "pending";
            if (isCompleted || (currentStageIdx >= 0 && idx < currentStageIdx)) {
              status = "done";
            } else if (idx === currentStageIdx) {
              status = "active";
            }
            const stats = stageStats[stage.key];
            return (
              <div
                key={stage.key}
                className={`eval-milestone-item eval-milestone-${status}`}
              >
                <div className="eval-milestone-circle">
                  {status === "done"
                    ? <svg className="eval-milestone-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    : idx + 1}
                </div>
                <span className="eval-milestone-label">{t(stage.label)}</span>
                {/* Show stats under completed stages */}
                {status === "done" && stats && stats.total > 0 && (
                  <span className="eval-milestone-stats">
                    {stats.failed > 0
                      ? t("eval.running.stageStatsWithFailures" as MessageKey, {
                        passed: stats.completed - stats.failed,
                        failed: stats.failed,
                      })
                      : `${stats.completed}/${stats.total}`}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Overall Progress ── */}
        <div className="eval-milestone-progress-section">
          <div className="eval-milestone-progress-header">
            <span className="eval-milestone-progress-title">
              {hasProgress
                ? (activeStage ? t(activeStage.label) : t("eval.running.waiting" as MessageKey))
                : t("eval.running.initializing" as MessageKey)}
            </span>
            <span className="eval-milestone-progress-meta">
              {hasProgress && total > 0 && `${completed}/${total}`}
              {hasProgress && total > 0 && failedCount > 0
                && ` (${t("eval.running.failedCount" as MessageKey, { failed: failedCount })})`}
              {" · "}{formatTime(elapsed)}
              {computedRemaining != null && computedRemaining > 0
                && ` · ${t("eval.running.remaining" as MessageKey)} ${formatTime(computedRemaining)}`}
            </span>
          </div>
          <div className="eval-milestone-progress-bar">
            <div
              className="eval-milestone-progress-fill"
              style={{
                width: hasProgress ? `${totalPercent}%` : "0%",
                transition: "width 0.5s ease",
              }}
            />
            {!hasProgress && <div className="eval-milestone-progress-shimmer" />}
          </div>
          <div className="eval-milestone-progress-percent">
            {totalPercent.toFixed(0)}%
          </div>
        </div>

        {/* ── Case Sub-Progress ── */}
        {activeStage?.hasCases && hasProgress && total > 0 && (
          <div className="eval-milestone-case-section">
            <div className="eval-milestone-case-header">
              <span className="eval-history-item-label">
                {t(activeStage.label)} — {t("eval.running.caseGrid" as MessageKey)}
              </span>
              <span className="eval-milestone-case-counter">{completed}/{total}</span>
            </div>
            <div className="eval-milestone-progress-bar eval-milestone-case-bar">
              <div
                className="eval-milestone-progress-fill eval-milestone-case-fill"
                style={{
                  width: `${stagePercent}%`,
                  transition: "width 0.3s ease",
                }}
              />
            </div>
            {caseStatuses.length > 0 && (
              <div className="eval-milestone-case-grid">
                {caseStatuses.map((cs: { caseId: string; status: string; latencyMs?: number }) => {
                  const st = (cs.status as CaseStatusType) || "pending";
                  return (
                    <div
                      key={cs.caseId}
                      className={`eval-milestone-case-dot eval-milestone-case-${st}`}
                      title={`${cs.caseId}: ${st}${cs.latencyMs ? ` (${cs.latencyMs}ms)` : ""}`}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </article>
    </>
  );
}

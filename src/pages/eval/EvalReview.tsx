/**
 * EvalReview.tsx — Review workbench (v6.0)
 * Uses eval-review-card, eval-review-guide, eval-config-grid, field-label patterns.
 */
import { useState, useCallback } from "react";
import { useEvalStore, useEvalDispatch } from "./EvalStore";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages";
import EvalScorecard from "./EvalScorecard";

export default function EvalReview() {
  const { t } = useI18n();
  const state = useEvalStore();
  const dispatch = useEvalDispatch();

  const [verdict, setVerdict] = useState(state.reviewFinalVerdict);
  const [overrideGate, setOverrideGate] = useState(state.reviewOverrideGate);
  const [overrideReason, setOverrideReason] = useState(state.reviewOverrideReason);
  const [notes, setNotes] = useState(state.reviewNotes);
  const [reviewer, setReviewer] = useState(state.reviewReviewer);

  const report = state.report;

  const handleSubmit = useCallback(() => {
    dispatch({
      type: "PATCH",
      payload: {
        reviewFinalVerdict: verdict,
        reviewOverrideGate: overrideGate,
        reviewOverrideReason: overrideGate ? overrideReason : "",
        reviewNotes: notes,
        reviewReviewer: reviewer,
        reviewSubmitting: true,
      },
    });
  }, [dispatch, verdict, overrideGate, overrideReason, notes, reviewer]);

  return (
    <>
      {/* ── Review Entry Card ── */}
      <article className="chart-card eval-review-entry-card">
        <div className="eval-review-entry-head">
          <h3 className="chart-title">{t("eval.review.title" as MessageKey)}</h3>
          <button
            className="btn btn-primary"
            onClick={() => dispatch({ type: "SET_VIEW", payload: "result" })}
          >
            {t("eval.results.title" as MessageKey)}
          </button>
        </div>

        {/* ── Scorecard Embed ── */}
        {report && <EvalScorecard report={report} />}
      </article>

      {/* ── Review Form Card ── */}
      <article className="chart-card eval-review-card">
        <h3 className="chart-title">{t("eval.review.guideVerdictTitle" as MessageKey)}</h3>

        {/* ── Review Guide ── */}
        <div className="eval-review-guide">
          <ul className="eval-review-guide-list">
            <li className="eval-review-guide-item">
              <div className="eval-review-guide-copy">
                <strong>{t("eval.review.guideVerdictTitle" as MessageKey)}</strong>
                <small>{t("eval.review.guideVerdictDesc" as MessageKey)}</small>
              </div>
            </li>
          </ul>
        </div>

        {/* ── Form Fields ── */}
        <div className="eval-config-grid">
          <div className="field">
            <label className="field-label">{t("eval.review.finalVerdict" as MessageKey)}</label>
            <select
              className="filter-select"
              value={verdict}
              onChange={(e) => setVerdict(e.target.value)}
            >
              <option value="pass">{t("eval.result.pass" as MessageKey)}</option>
              <option value="fail">{t("eval.result.fail" as MessageKey)}</option>
            </select>
          </div>

          <div className="field">
            <label className="field-label">{t("eval.review.reviewer" as MessageKey)}</label>
            <input
              className="field-input"
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              placeholder={t("eval.review.reviewerPlaceholder" as MessageKey)}
            />
          </div>

          <div className="field eval-field-wide">
            <label className="field-label">
              <input
                type="checkbox"
                checked={overrideGate}
                onChange={(e) => setOverrideGate(e.target.checked)}
                style={{ marginRight: 8 }}
              />
              {t("eval.review.overrideGate" as MessageKey)}
            </label>
          </div>

          {overrideGate && (
            <div className="field eval-field-wide">
              <label className="field-label">{t("eval.review.overrideReason" as MessageKey)}</label>
              <textarea
                className="eval-draft-textarea"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                rows={3}
              />
            </div>
          )}

          <div className="field eval-field-wide">
            <label className="field-label">{t("eval.review.notes" as MessageKey)}</label>
            <textarea
              className="eval-draft-textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <div className="eval-dataset-actions">
          <button
            className="btn btn-ghost"
            onClick={handleSubmit}
            disabled={state.reviewSubmitting}
          >
            {t("eval.review.submit" as MessageKey)}
          </button>
        </div>
      </article>
    </>
  );
}

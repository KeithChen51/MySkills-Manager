/**
 * EvalResult.tsx — Results view (v6.0)
 * Uses chart-card, eval-module-result-card, eval-economics-grid, eval-draft-table patterns.
 */
import { useState } from "react";
import { useEvalStore, useEvalDispatch } from "./EvalStore";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages";
import EvalScorecard from "./EvalScorecard";

type ResultTab = "scorecard" | "trigger" | "functional" | "economics";

export default function EvalResult() {
  const { t } = useI18n();
  const state = useEvalStore();
  const dispatch = useEvalDispatch();
  const [activeTab, setActiveTab] = useState<ResultTab>("scorecard");
  const report = state.report;

  const tabs: { key: ResultTab; label: string }[] = [
    { key: "scorecard", label: t("eval.scorecard.title" as MessageKey) },
    { key: "trigger", label: t("eval.trigger.title" as MessageKey) },
    { key: "functional", label: t("eval.functional.title" as MessageKey) },
    { key: "economics", label: t("eval.economics.title" as MessageKey) },
  ];

  return (
    <>
      {/* ── Tab Module Results ── */}
      <article className="chart-card eval-module-result-card">
        <div className="eval-running-stage-head">
          <h3 className="chart-title">{t("eval.results.title" as MessageKey)}</h3>
          <div className="eval-running-stage-actions">
            <button
              className="btn btn-ghost"
              onClick={() => dispatch({ type: "SET_VIEW", payload: "review" })}
            >
              {t("eval.review.title" as MessageKey)}
            </button>
          </div>
        </div>

        {/* ── Tab Buttons ── */}
        <div className="eval-result-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              className={`eval-result-tab${activeTab === tab.key ? " eval-result-tab-active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Tab Panels ── */}
        <div role="tabpanel">
          {activeTab === "scorecard" && report && (
            <EvalScorecard report={report} />
          )}

          {activeTab === "trigger" && report?.triggerClean?.results && (
            <div className="eval-draft-table-wrap">
              <table className="eval-draft-table">
                <thead>
                  <tr>
                    <th>{t("eval.table.query" as MessageKey)}</th>
                    <th>{t("eval.table.expected" as MessageKey)}</th>
                    <th>{t("eval.table.actual" as MessageKey)}</th>
                    <th>{t("eval.table.result" as MessageKey)}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.triggerClean.results.map((r, i) => (
                    <tr key={i}>
                      <td>{r.query}</td>
                      <td>
                        <span className={r.shouldTrigger ? "eval-badge-pass" : "eval-badge-fail"}>
                          {r.shouldTrigger ? t("eval.option.yes" as MessageKey) : t("eval.option.no" as MessageKey)}
                        </span>
                      </td>
                      <td>
                        <span className={r.triggered ? "eval-badge-pass" : "eval-badge-fail"}>
                          {r.triggered ? t("eval.option.yes" as MessageKey) : t("eval.option.no" as MessageKey)}
                        </span>
                      </td>
                      <td>
                        <span className={r.pass ? "eval-quick-pass" : "eval-quick-fail"}>
                          <span>{r.pass ? t("eval.result.pass" as MessageKey) : t("eval.result.fail" as MessageKey)}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "functional" && report?.functional?.results && (
            <div className="eval-module-results">
              {report.functional.results.map((r, i) => (
                <div key={i} className={`eval-module-result ${r.passed ? "eval-module-pass" : "eval-module-fail"}`}>
                  <strong>{r.caseId}</strong>
                  <small>
                    {t("eval.table.passRate" as MessageKey)}: {(r.passRate * 100).toFixed(1)}%
                    {r.qualityScore != null
                      && ` · ${t("eval.table.qualityScore" as MessageKey)}: ${r.qualityScore.toFixed(2)}`}
                  </small>
                  <small>
                    {r.passed ? t("eval.result.pass" as MessageKey) : t("eval.result.fail" as MessageKey)}
                  </small>
                </div>
              ))}
            </div>
          )}

          {activeTab === "economics" && report?.economics && (
            <div className="eval-economics-grid">
              <div>
                <span className="eval-history-item-label">{t("eval.economics.netTimeSavedMs" as MessageKey)}</span>
                <strong>{report.economics.netTimeSavedMs.toFixed(0)} ms</strong>
              </div>
              <div>
                <span className="eval-history-item-label">{t("eval.economics.netTokenSaved" as MessageKey)}</span>
                <strong>{report.economics.netTokenSaved.toFixed(0)}</strong>
              </div>
              <div>
                <span className="eval-history-item-label">{t("eval.economics.netUsd" as MessageKey)}</span>
                <strong>${report.economics.netUsd?.toFixed(4) ?? "—"}</strong>
              </div>
            </div>
          )}
        </div>
      </article>
    </>
  );
}

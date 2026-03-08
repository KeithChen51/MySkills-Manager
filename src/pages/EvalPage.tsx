import ReactECharts from "echarts-for-react";
import { useState } from "react";

import { type SkillMeta } from "../api/tauri";
import KpiCard from "../components/KpiCard";
import { useI18n } from "../i18n/I18nProvider";
import { useTheme } from "../theme/ThemeProvider";
import "./EvalPage.css";

type Props = { skills: SkillMeta[] };

/* ---- Mock data structures (will be replaced by real Tauri API calls) ---- */

type TriggerResult = {
  query: string;
  shouldTrigger: boolean;
  triggered: boolean;
  triggeredSkillName: string | null;
  pass: boolean;
};

type FunctionalResult = {
  caseId: string;
  passed: boolean;
  passRate: number;
};

type EvalSummary = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
};

type EvalReport = {
  triggerClean: { summary: EvalSummary; results: TriggerResult[] } | null;
  triggerComplex: { summary: EvalSummary; results: TriggerResult[] } | null;
  functional: { summary: EvalSummary; results: FunctionalResult[] } | null;
};

/* ---- Component ---- */

export default function EvalPage({ skills }: Props) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const chartThemeName =
    resolvedTheme === "dark" ? "myskills-soft-dark" : "myskills-soft-light";

  const [selectedSkill, setSelectedSkill] = useState("");
  const [evalMode, setEvalMode] = useState<"quick" | "standard" | "full">(
    "standard"
  );
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<EvalReport | null>(null);

  /* ---- Mock run function ---- */
  async function handleRunEval() {
    if (!selectedSkill) return;
    setRunning(true);
    setReport(null);

    // Simulate async evaluation (will be replaced by real Tauri invoke calls)
    await new Promise((r) => setTimeout(r, 1500));

    const mockTriggerResults: TriggerResult[] = [
      { query: "Write a blog post about AI", shouldTrigger: true, triggered: true, triggeredSkillName: selectedSkill, pass: true },
      { query: "Help me debug this Python code", shouldTrigger: false, triggered: false, triggeredSkillName: null, pass: true },
      { query: "Create a landing page", shouldTrigger: true, triggered: false, triggeredSkillName: null, pass: false },
      { query: "Summarize this document", shouldTrigger: false, triggered: true, triggeredSkillName: "another-skill", pass: false },
      { query: "Generate marketing copy", shouldTrigger: true, triggered: true, triggeredSkillName: selectedSkill, pass: true },
    ];

    const mockFunctionalResults: FunctionalResult[] = [
      { caseId: "case-001", passed: true, passRate: 1.0 },
      { caseId: "case-002", passed: true, passRate: 0.8 },
      { caseId: "case-003", passed: false, passRate: 0.4 },
    ];

    const triggerSummary = {
      total: mockTriggerResults.length,
      passed: mockTriggerResults.filter((r) => r.pass).length,
      failed: mockTriggerResults.filter((r) => !r.pass).length,
      passRate:
        mockTriggerResults.filter((r) => r.pass).length /
        mockTriggerResults.length,
    };

    const funcSummary = {
      total: mockFunctionalResults.length,
      passed: mockFunctionalResults.filter((r) => r.passed).length,
      failed: mockFunctionalResults.filter((r) => !r.passed).length,
      passRate:
        mockFunctionalResults.filter((r) => r.passed).length /
        mockFunctionalResults.length,
    };

    setReport({
      triggerClean: { summary: triggerSummary, results: mockTriggerResults },
      triggerComplex: null,
      functional: { summary: funcSummary, results: mockFunctionalResults },
    });
    setRunning(false);
  }

  /* ---- Render helpers ---- */

  function renderSummaryKpis() {
    if (!report) return null;
    const tc = report.triggerClean?.summary;
    const fn = report.functional?.summary;
    return (
      <div className="kpi-row">
        <KpiCard
          label={t("eval.kpi.triggerPassRate")}
          value={tc ? `${Math.round(tc.passRate * 100)}%` : "--"}
        />
        <KpiCard
          label={t("eval.kpi.functionalPassRate")}
          value={fn ? `${Math.round(fn.passRate * 100)}%` : "--"}
        />
        <KpiCard
          label={t("eval.kpi.totalCases")}
          value={(tc?.total ?? 0) + (fn?.total ?? 0)}
        />
        <KpiCard
          label={t("eval.kpi.totalPassed")}
          value={(tc?.passed ?? 0) + (fn?.passed ?? 0)}
        />
      </div>
    );
  }

  function renderTriggerChart() {
    if (!report?.triggerClean) return null;
    const results = report.triggerClean.results;
    return (
      <article className="chart-card">
        <h3 className="chart-title">{t("eval.trigger.title")}</h3>
        <ReactECharts
          className="eval-chart"
          theme={chartThemeName}
          option={{
            tooltip: { trigger: "axis" },
            xAxis: {
              type: "category",
              data: results.map((_, i) => `Q${i + 1}`),
              axisLabel: { rotate: 0 },
            },
            yAxis: { type: "value", max: 1, axisLabel: { formatter: "{value}" } },
            series: [
              {
                name: t("eval.trigger.expected"),
                type: "bar",
                data: results.map((r) => (r.shouldTrigger ? 1 : 0)),
                itemStyle: { color: "var(--chart-2)" },
                barMaxWidth: 20,
              },
              {
                name: t("eval.trigger.actual"),
                type: "bar",
                data: results.map((r) => (r.triggered ? 1 : 0)),
                itemStyle: { color: "var(--chart-1)" },
                barMaxWidth: 20,
              },
            ],
            legend: { data: [t("eval.trigger.expected"), t("eval.trigger.actual")] },
            grid: { left: 50, right: 20, top: 40, bottom: 30 },
          }}
        />
        <div className="eval-results-table-wrap">
          <table className="eval-results-table">
            <thead>
              <tr>
                <th>{t("eval.table.query")}</th>
                <th>{t("eval.table.expected")}</th>
                <th>{t("eval.table.actual")}</th>
                <th>{t("eval.table.capturedBy")}</th>
                <th>{t("eval.table.result")}</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className={r.pass ? "" : "eval-row-fail"}>
                  <td className="eval-query-cell">{r.query}</td>
                  <td>{r.shouldTrigger ? "Yes" : "No"}</td>
                  <td>{r.triggered ? "Yes" : "No"}</td>
                  <td>{r.triggeredSkillName ?? "-"}</td>
                  <td>
                    <span className={`eval-badge ${r.pass ? "eval-badge-pass" : "eval-badge-fail"}`}>
                      {r.pass ? "PASS" : "FAIL"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    );
  }

  function renderFunctionalChart() {
    if (!report?.functional) return null;
    const results = report.functional.results;
    return (
      <article className="chart-card">
        <h3 className="chart-title">{t("eval.functional.title")}</h3>
        <ReactECharts
          className="eval-chart"
          theme={chartThemeName}
          option={{
            tooltip: { trigger: "axis" },
            xAxis: {
              type: "category",
              data: results.map((r) => r.caseId),
            },
            yAxis: {
              type: "value",
              max: 1,
              axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%` },
            },
            series: [
              {
                name: t("eval.functional.passRate"),
                type: "bar",
                data: results.map((r) => r.passRate),
                itemStyle: {
                  color: (params: { dataIndex: number }) =>
                    results[params.dataIndex].passed
                      ? "var(--success)"
                      : "var(--danger)",
                },
                barMaxWidth: 32,
              },
            ],
            grid: { left: 60, right: 20, top: 30, bottom: 30 },
          }}
        />
        <div className="eval-results-table-wrap">
          <table className="eval-results-table">
            <thead>
              <tr>
                <th>{t("eval.table.caseId")}</th>
                <th>{t("eval.table.passRate")}</th>
                <th>{t("eval.table.result")}</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.caseId} className={r.passed ? "" : "eval-row-fail"}>
                  <td>{r.caseId}</td>
                  <td>{Math.round(r.passRate * 100)}%</td>
                  <td>
                    <span className={`eval-badge ${r.passed ? "eval-badge-pass" : "eval-badge-fail"}`}>
                      {r.passed ? "PASS" : "FAIL"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    );
  }

  return (
    <div className="page animate-fadein">
      <header className="page-header">
        <h1 className="page-title">{t("eval.title")}</h1>
      </header>

      {/* ---- Configuration Panel ---- */}
      <article className="chart-card eval-config-card">
        <h3 className="chart-title">{t("eval.config.title")}</h3>
        <div className="eval-config-grid">
          <div className="field">
            <label className="field-label">{t("eval.config.skill")}</label>
            <select
              className="filter-select"
              value={selectedSkill}
              onChange={(e) => setSelectedSkill(e.target.value)}
            >
              <option value="">{t("eval.config.selectSkill")}</option>
              {skills.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label">{t("eval.config.mode")}</label>
            <select
              className="filter-select"
              value={evalMode}
              onChange={(e) =>
                setEvalMode(e.target.value as "quick" | "standard" | "full")
              }
            >
              <option value="quick">{t("eval.config.mode.quick")}</option>
              <option value="standard">{t("eval.config.mode.standard")}</option>
              <option value="full">{t("eval.config.mode.full")}</option>
            </select>
          </div>

          <div className="field eval-config-actions">
            <button
              className="btn btn-primary"
              disabled={!selectedSkill || running}
              onClick={handleRunEval}
            >
              {running ? t("eval.running") : t("eval.run")}
            </button>
          </div>
        </div>
      </article>

      {/* ---- Results ---- */}
      {report && (
        <>
          {renderSummaryKpis()}
          <div className="chart-row">
            {renderTriggerChart()}
            {renderFunctionalChart()}
          </div>
        </>
      )}

      {!report && !running && (
        <div className="empty-state">{t("eval.empty")}</div>
      )}
    </div>
  );
}

/**
 * EvalScorecard 鈥?Five-dimensional radar chart + ratings for v6.0.
 *
 * Displays:
 * - ECharts radar chart with 5 dimensions (trigger, functional, robustness, efficiency, value)
 * - Overall rating (CSS stars + numeric score)
 * - Delta comparison table (with_skill vs without_skill)
 * - Analyzer insights & improvement suggestions
 * - Confidence warning when judge === executor (weak model)
 */

import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { useTheme } from "../../theme/ThemeProvider";
import type { EvalPipelineOutput } from "../../api/tauri";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScorecardDimension {
  key: string;
  label: string;
  score: number;
  weight: number;
}

export interface ScorecardData {
  dimensions: ScorecardDimension[];
  overallScore: number;
  overallRating: number;
  radarData: number[];
  confidenceWarning?: string;
}

interface ScorecardChartTokens {
  indicatorText: string;
  axisLine: string;
  splitLine: string;
  radarArea: string;
  radarLine: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildScorecardFromReport(report: EvalPipelineOutput): ScorecardData {
  const triggerPassRate = report.triggerClean?.summary?.passRate ?? 0;
  const functionalPassRate = report.functional?.summary?.passRate ?? 0;

  const repeatMeanPass =
    report.repeatStats?.triggerPassRate?.mean ?? triggerPassRate;
  const robustnessScore = repeatMeanPass;
  const efficiencyScore = functionalPassRate;
  const comparatorDelta = report.comparator?.averageDelta ?? 0;
  const valueScore = Math.max(0, Math.min(1, 0.5 + comparatorDelta));

  const dimensions: ScorecardDimension[] = [
    { key: "trigger", label: "eval.scorecard.trigger", score: triggerPassRate, weight: 0.25 },
    { key: "functional", label: "eval.scorecard.functional", score: functionalPassRate, weight: 0.25 },
    { key: "robustness", label: "eval.scorecard.robustness", score: robustnessScore, weight: 0.15 },
    { key: "efficiency", label: "eval.scorecard.efficiency", score: efficiencyScore, weight: 0.20 },
    { key: "value", label: "eval.scorecard.value", score: valueScore, weight: 0.15 },
  ];

  const overallScore = dimensions.reduce(
    (sum, dim) => sum + dim.score * dim.weight,
    0,
  );
  const overallRating = Math.min(5, Math.max(0, Math.round(overallScore * 5)));
  const radarData = dimensions.map((d) => Math.round(d.score * 100));

  let confidenceWarning: string | undefined;
  const executorModel = report.runMeta?.model?.toLowerCase();
  const judgeModels = report.runMeta?.judgeModels;
  if (
    executorModel &&
    judgeModels?.length === 1 &&
    judgeModels[0].toLowerCase() === executorModel
  ) {
    confidenceWarning = "eval.scorecard.confidenceWarning";
  }

  return { dimensions, overallScore, overallRating, radarData, confidenceWarning };
}

function scoreClass(score: number): string {
  if (score >= 0.8) return "eval-sc-good";
  if (score >= 0.5) return "eval-sc-warn";
  return "eval-sc-bad";
}

function renderStars(rating: number, max = 5): string {
  const safeRating = Math.max(0, Math.min(max, rating));
  return `${"★".repeat(safeRating)}${"☆".repeat(max - safeRating)}`;
}


function readScorecardChartTokens(): ScorecardChartTokens {
  const fallback: ScorecardChartTokens = {
    indicatorText: "var(--text-primary)",
    axisLine: "var(--border-card)",
    splitLine: "var(--stroke-soft)",
    radarArea: "var(--accent-light)",
    radarLine: "var(--accent)",
  };

  if (typeof window === "undefined") {
    return fallback;
  }

  const styles = window.getComputedStyle(document.documentElement);
  const read = (name: string, value: string) => styles.getPropertyValue(name).trim() || value;

  return {
    indicatorText: read("--text-primary", fallback.indicatorText),
    axisLine: read("--border-card", fallback.axisLine),
    splitLine: read("--stroke-soft", fallback.splitLine),
    radarArea: read("--accent-light", fallback.radarArea),
    radarLine: read("--accent", fallback.radarLine),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EvalScorecard({ report }: { report: EvalPipelineOutput }) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const chartTheme = resolvedTheme === "dark" ? "myskills-soft-dark" : "myskills-soft-light";

  const scorecard = useMemo(() => buildScorecardFromReport(report), [report]);
  const chartTokens = useMemo(() => {
    // Theme switch updates CSS variables; this dependency forces token re-read.
    void resolvedTheme;
    return readScorecardChartTokens();
  }, [resolvedTheme]);

  const radarOption = useMemo(() => {
    const labels = scorecard.dimensions.map((d) => t(d.label as never));
    return {
      tooltip: {},
      radar: {
        indicator: labels.map((label) => ({
          name: label,
          max: 100,
          color: chartTokens.indicatorText,
        })),
        shape: "polygon",
        splitArea: { show: false },
        axisLine: { lineStyle: { color: chartTokens.axisLine } },
        splitLine: { lineStyle: { color: chartTokens.splitLine } },
      },
      series: [
        {
          type: "radar",
          data: [
            {
              value: scorecard.radarData,
              name: t("eval.scorecard.title" as never),
              areaStyle: {
                color: chartTokens.radarArea,
              },
              lineStyle: { color: chartTokens.radarLine, width: 2 },
              itemStyle: { color: chartTokens.radarLine },
            },
          ],
        },
      ],
    };
  }, [chartTokens, scorecard, t]);

  const analyzerNotes = report.analyzer?.recommendations ?? [];
  const improvementSuggestions = report.analyzer?.improvementSuggestions ?? [];

  return (
    <div className="eval-sc">
      {/* Header: Overall Rating */}
      <div className="eval-sc-header">
        <div className="eval-sc-stars" role="img" aria-label={renderStars(scorecard.overallRating)}>
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              className={`eval-sc-star ${i < scorecard.overallRating ? "eval-sc-star-filled" : ""}`}
              aria-hidden="true"
            />
          ))}
        </div>
        <span className="eval-sc-score">
          {(scorecard.overallScore * 5).toFixed(2)}
          <span className="eval-sc-score-max">/5</span>
        </span>
        <span className="eval-sc-score-label">
          {t("eval.scorecard.title" as never)}
        </span>
      </div>

      {/* Confidence warning */}
      {scorecard.confidenceWarning && (
        <div className="eval-sc-warning">
          {t(scorecard.confidenceWarning as never)}
        </div>
      )}

      {/* Radar Chart */}
      <div className="eval-sc-section">
        <ReactECharts
          option={radarOption}
          theme={chartTheme}
          style={{ height: "260px", width: "100%" }}
          notMerge
        />
      </div>

      {/* Dimension breakdown */}
      <div className="eval-sc-section">
        <div className="eval-sc-dim-grid">
          {scorecard.dimensions.map((dim) => (
            <div key={dim.key} className="eval-sc-dim-item">
              <span className="eval-sc-dim-label">{t(dim.label as never)}</span>
              <span className={`eval-sc-dim-score ${scoreClass(dim.score)}`}>
                {(dim.score * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Comparator Delta Table */}
      {report.comparator && (
        <div className="eval-sc-section">
          <div className="eval-sc-section-title">
            {t("eval.scorecard.comparator" as never)}
          </div>
          <div className="eval-sc-comparator-grid">
            <div className="eval-sc-comp-improved">
              {t("eval.scorecard.improvedCases" as never, { count: report.comparator.improvedCases })}
            </div>
            <div className="eval-sc-comp-regressed">
              {t("eval.scorecard.regressedCases" as never, { count: report.comparator.regressedCases })}
            </div>
            <div className="eval-sc-comp-unchanged">
              {t("eval.scorecard.unchangedCases" as never, { count: report.comparator.unchangedCases })}
            </div>
          </div>
          <div className="eval-sc-comp-delta">
            {t("eval.scorecard.averageDelta" as never)}: {report.comparator.averageDelta >= 0 ? "+" : ""}{(report.comparator.averageDelta * 100).toFixed(1)}%
          </div>
        </div>
      )}

      {/* Analyzer Notes */}
      {analyzerNotes.length > 0 && (
        <div className="eval-sc-section">
          <div className="eval-sc-section-title">
            {t("eval.scorecard.analyzerNotes" as never)}
          </div>
          <ul className="eval-sc-list">
            {analyzerNotes.map((note, idx) => (
              <li key={idx}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Improvement Suggestions */}
      {improvementSuggestions.length > 0 && (
        <div className="eval-sc-section">
          <div className="eval-sc-section-title">
            {t("eval.scorecard.suggestions" as never)}
          </div>
          <ul className="eval-sc-list">
            {improvementSuggestions.map((suggestion, idx) => (
              <li key={idx}>{suggestion}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}


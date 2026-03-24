import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(relativePath: string): string {
  return readFileSync(resolve(relativePath), "utf-8");
}

describe("Eval Scorecard View (v6.0)", () => {
  test("EvalScorecard.tsx exists and imports ECharts radar chart", () => {
    const source = read("src/pages/eval/EvalScorecard.tsx");
    assert.ok(
      source.includes("ReactECharts"),
      "EvalScorecard should use ReactECharts for the radar chart",
    );
    assert.ok(
      source.includes("radar"),
      "EvalScorecard should configure a radar chart",
    );
  });

  test("EvalScorecard renders five dimension scores", () => {
    const source = read("src/pages/eval/EvalScorecard.tsx");
    const dimensions = [
      "eval.scorecard.trigger",
      "eval.scorecard.functional",
      "eval.scorecard.robustness",
      "eval.scorecard.efficiency",
      "eval.scorecard.value",
    ];
    for (const dim of dimensions) {
      assert.ok(
        source.includes(dim),
        `EvalScorecard should reference dimension key: ${dim}`,
      );
    }
  });

  test("EvalScorecard renders star rating", () => {
    const source = read("src/pages/eval/EvalScorecard.tsx");
    assert.ok(
      source.includes("renderStars") || source.includes("★"),
      "EvalScorecard should render star rating symbols",
    );
  });

  test("EvalScorecard renders comparator delta table", () => {
    const source = read("src/pages/eval/EvalScorecard.tsx");
    assert.ok(
      source.includes("comparator"),
      "EvalScorecard should render comparator delta section",
    );
    assert.ok(
      source.includes("improvedCases"),
      "EvalScorecard should show improved cases count",
    );
  });

  test("EvalScorecard renders analyzer notes and improvement suggestions", () => {
    const source = read("src/pages/eval/EvalScorecard.tsx");
    assert.ok(
      source.includes("analyzerNotes") || source.includes("recommendations"),
      "EvalScorecard should render analyzer notes",
    );
    assert.ok(
      source.includes("improvementSuggestions"),
      "EvalScorecard should render improvement suggestions",
    );
  });

  test("EvalScorecard shows confidence warning when judge equals executor", () => {
    const source = read("src/pages/eval/EvalScorecard.tsx");
    assert.ok(
      source.includes("confidenceWarning"),
      "EvalScorecard should show confidence warning for weak judge models",
    );
  });

  test("EvalStore.tsx exports EvalProvider and useEvalStore", () => {
    const source = read("src/pages/eval/EvalStore.tsx");
    assert.ok(
      source.includes("export function EvalProvider"),
      "EvalStore should export EvalProvider",
    );
    assert.ok(
      source.includes("export function useEvalStore"),
      "EvalStore should export useEvalStore",
    );
    assert.ok(
      source.includes("export function useEvalDispatch"),
      "EvalStore should export useEvalDispatch",
    );
  });

  test("EvalStore supports three eval modes including standard", () => {
    const source = read("src/pages/eval/EvalStore.tsx");
    assert.ok(
      source.includes('"standard"'),
      "EvalStore should support 'standard' eval mode",
    );
  });

  test("EvalStore has three-role model config (judge, generator)", () => {
    const source = read("src/pages/eval/EvalStore.tsx");
    assert.ok(
      source.includes("judgeModel"),
      "EvalStore should have judgeModel field",
    );
    assert.ok(
      source.includes("generatorModel"),
      "EvalStore should have generatorModel field",
    );
  });

  test("i18n messages include Scorecard keys in both en and zh", () => {
    const source = read("src/i18n/messages.ts");
    const keys = [
      "eval.scorecard.title",
      "eval.scorecard.trigger",
      "eval.scorecard.functional",
      "eval.scorecard.robustness",
      "eval.scorecard.efficiency",
      "eval.scorecard.value",
      "eval.scorecard.confidenceWarning",
    ];
    for (const key of keys) {
      const count = (source.match(new RegExp(`"${key.replace(/\./g, "\\.")}"`, "g")) || []).length;
      assert.ok(
        count >= 2,
        `i18n key "${key}" should appear at least twice (en + zh), found ${count}`,
      );
    }
  });

  test("TypeScript API includes improvementSuggestions on EvalAnalyzerSummary", () => {
    const source = read("src/api/tauri.ts");
    assert.ok(
      source.includes("improvementSuggestions"),
      "tauri.ts should have improvementSuggestions on EvalAnalyzerSummary",
    );
  });

  test("TypeScript API includes caseStatuses on EvalPipelineProgressEvent", () => {
    const source = read("src/api/tauri.ts");
    assert.ok(
      source.includes("caseStatuses"),
      "tauri.ts should have caseStatuses on EvalPipelineProgressEvent",
    );
  });

  test("Rust types.rs contains EvalScorecard and CaseStatus", () => {
    const source = read("src-tauri/src/evals/types.rs");
    assert.ok(
      source.includes("pub struct EvalScorecard"),
      "types.rs should contain EvalScorecard struct",
    );
    assert.ok(
      source.includes("pub struct CaseStatus"),
      "types.rs should contain CaseStatus struct",
    );
    assert.ok(
      source.includes("pub struct EvalScorecardDimension"),
      "types.rs should contain EvalScorecardDimension struct",
    );
  });
});

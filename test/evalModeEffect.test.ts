import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(pathFromRoot: string) {
  return fs.readFileSync(path.resolve(process.cwd(), pathFromRoot), "utf8");
}

test("EvalPage uses unified pipeline command and renders full-mode complex trigger chart", () => {
  const source = read("src/pages/EvalPage.tsx");
  assert.ok(
    source.includes("runEvalPipeline({"),
    "EvalPage should call unified runEvalPipeline command",
  );
  assert.ok(
    source.includes("report.mode === \"full\""),
    "EvalPage should branch display logic by report.mode for full mode",
  );
  assert.ok(
    source.includes("eval.trigger.titleComplex"),
    "EvalPage should render complex trigger chart title for full mode",
  );
});

test("functional eval engine supports compare_mode variants including without_skill", () => {
  const source = read("src-tauri/py/eval_engine/functional_eval.py");
  assert.ok(
    source.includes("args.compare_mode"),
    "functional eval should consume compare_mode from CLI args",
  );
  assert.ok(
    source.includes("without_skill"),
    "functional eval should support explicit without_skill baseline mode",
  );
});

test("trigger eval engine uses env_type directly in trigger decision", () => {
  const source = read("src-tauri/py/eval_engine/trigger_eval.py");
  assert.ok(
    source.includes("env_type"),
    "trigger eval should include env_type in trigger decision path",
  );
  assert.ok(
    source.includes("check_trigger(") && source.includes("env_type"),
    "trigger decision should consider env_type, not just prompt text",
  );
});

test("trigger eval engine validates trigger dataset schema before running", () => {
  const source = read("src-tauri/py/eval_engine/trigger_eval.py");
  assert.ok(
    source.includes("query") && source.includes("should_trigger"),
    "trigger eval should explicitly require query/should_trigger keys",
  );
  assert.ok(
    source.includes("Invalid trigger eval set"),
    "trigger eval should return readable schema errors instead of crashing",
  );
});

test("Rust eval backend exposes run_eval_pipeline command", () => {
  const source = read("src-tauri/src/evals.rs");
  assert.ok(
    source.includes("pub async fn run_eval_pipeline"),
    "evals.rs should expose run_eval_pipeline command",
  );
});

test("quick mode skips functional execution and hides functional visualization", () => {
  const evalPage = read("src/pages/EvalPage.tsx");
  assert.ok(
    evalPage.includes("if (evalMode !== \"quick\" && !functionalSetPath.trim())"),
    "quick mode should not require functional dataset path",
  );
  assert.ok(
    evalPage.includes("if (report?.mode === \"quick\") return null;"),
    "quick mode should hide functional chart and table",
  );

  const backend = read("src-tauri/src/evals.rs");
  assert.ok(
    backend.includes("skipped_functional_output("),
    "backend should generate skipped functional placeholder for quick mode",
  );
});

test("EvalPage renders Layer2 quality rationale and suggestions in functional results", () => {
  const source = read("src/pages/EvalPage.tsx");
  assert.ok(
    source.includes("eval.table.qualityScore"),
    "functional table should render quality score column",
  );
  assert.ok(
    source.includes("item.judgeRationale"),
    "functional table should show judge rationale",
  );
  assert.ok(
    source.includes("item.judgeSuggestions"),
    "functional table should show improvement suggestions",
  );
});

test("EvalPage exposes repeat and budget controls and renders cost/repeat aggregation", () => {
  const source = read("src/pages/EvalPage.tsx");
  assert.ok(
    source.includes("eval.config.repeats"),
    "EvalPage should expose repeats input for multi-run aggregation",
  );
  assert.ok(
    source.includes("eval.config.maxCostUsd"),
    "EvalPage should expose maxCostUsd input for budget guard",
  );
  assert.ok(
    source.includes("report.costEstimate.estimatedUsd"),
    "EvalPage should display estimated cost in report area",
  );
  assert.ok(
    source.includes("report.repeatStats"),
    "EvalPage should render repeatStats summary when available",
  );
});

test("EvalPage listens pipeline progress events and exposes pause/resume/stop controls", () => {
  const source = read("src/pages/EvalPage.tsx");
  assert.ok(
    source.includes("eval://pipeline-progress"),
    "EvalPage should listen backend progress events for multi-round visibility",
  );
  assert.ok(
    source.includes("evalControl("),
    "EvalPage should call evalControl for pause/resume/stop",
  );
  assert.ok(
    source.includes("eval.control.pause") && source.includes("eval.control.stop"),
    "EvalPage should render pause and stop controls while running",
  );
});

test("EvalPage renders AI sample drafts as editable forms and supports preset save path", () => {
  const source = read("src/pages/EvalPage.tsx");
  assert.ok(
    source.includes("eval.samples.triggerForm"),
    "EvalPage should render trigger draft as editable form",
  );
  assert.ok(
    source.includes("eval.samples.functionalForm"),
    "EvalPage should render functional draft as editable form",
  );
  assert.ok(
    source.includes("saveMode: \"default\" | \"choose\""),
    "EvalPage should support default-path and custom-path dataset save modes",
  );
  assert.ok(
    source.includes("eval.dataset.defaultPath"),
    "EvalPage should display preset dataset storage path",
  );
});

test("EvalPage provides history browsing and KPI explanation entry points", () => {
  const source = read("src/pages/EvalPage.tsx");
  assert.ok(
    source.includes("eval.history.view"),
    "EvalPage should provide history view entry",
  );
  assert.ok(
    source.includes("evalListHistory(") && source.includes("evalLoadHistory("),
    "EvalPage should support listing and loading history reports",
  );
  assert.ok(
    source.includes("kpiHelp"),
    "EvalPage should provide KPI dimension/explanation metadata for card tooltips",
  );
});

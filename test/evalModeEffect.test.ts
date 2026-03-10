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

test("EvalPage keeps a sticky run dock and includes repeat count in history overview", () => {
  const source = read("src/pages/EvalPage.tsx");
  assert.ok(
    source.includes("className=\"eval-run-dock\""),
    "EvalPage should render a sticky run dock so progress stays visible while scrolling",
  );
  assert.ok(
    source.includes("setShowSamples(false)") && source.includes("setShowHistory(false)"),
    "starting evaluation should collapse large panels to avoid long vertical scrolling",
  );
  assert.ok(
    source.includes("eval.history.repeats") && source.includes("item.repeats"),
    "history overview should expose repeat count for each run",
  );
});

test("Rust eval backend uses adaptive timeout instead of fixed 300s cap", () => {
  const source = read("src-tauri/src/evals.rs");
  assert.ok(
    source.includes("timeout_secs_for_case_count"),
    "eval backend should compute timeout based on dataset size",
  );
  assert.ok(
    source.includes("MAX_EVAL_TIMEOUT_SECS"),
    "adaptive timeout should still enforce an upper bound",
  );
});

test("Eval history is shown in a large modal and supports inline expansion of each run", () => {
  const source = read("src/pages/EvalPage.tsx");
  assert.ok(
    source.includes("className=\"eval-history-modal-backdrop\""),
    "history should be rendered inside a floating modal instead of inline page block",
  );
  assert.ok(
    source.includes("expandedHistoryPath") && source.includes("handleToggleHistoryExpand"),
    "modal history should support expand/collapse state per record",
  );
  assert.ok(
    source.includes("eval.runDock.idle"),
    "run dock should remain visible while browsing modal history",
  );
});

test("Eval sample drafts are shown in a floating modal instead of inline page block", () => {
  const source = read("src/pages/EvalPage.tsx");
  const css = read("src/pages/EvalPage.css");
  assert.ok(
    source.includes("className=\"eval-samples-modal-backdrop\""),
    "sample drafts should open in floating modal container",
  );
  assert.ok(
    source.includes("aria-label={t(\"eval.samples.title\")}"),
    "sample modal should expose accessible dialog label",
  );
  assert.ok(
    css.includes(".eval-samples-modal-backdrop") && css.includes(".eval-samples-modal"),
    "EvalPage CSS should define sample modal backdrop and panel styles",
  );
});

test("Eval overlay and run monitor use opaque theme tokens instead of undefined surface vars", () => {
  const css = read("src/pages/EvalPage.css");
  assert.ok(
    !css.includes("var(--surface-2)") && !css.includes("var(--surface)"),
    "EvalPage CSS should avoid undefined --surface tokens that make cards/modal transparent",
  );
  assert.ok(
    css.includes("background: var(--bg-card);"),
    "EvalPage CSS should use existing opaque bg-card token for modal and cards",
  );
  assert.ok(
    css.includes("background-color: var(--bg-card, #ffffff);"),
    "run dock/modal should include explicit opaque fallback background color",
  );
  assert.ok(
    css.includes("isolation: isolate;"),
    "sticky dock/modal should isolate paint stacking to avoid scroll-through artifacts",
  );
});

test("KpiCard help icon avoids undefined surface token that causes transparent background", () => {
  const css = read("src/components/KpiCard.css");
  assert.ok(
    !css.includes("var(--surface)"),
    "KpiCard CSS should not rely on undefined --surface token",
  );
  assert.ok(
    css.includes("background: var(--bg-input);"),
    "KpiCard help icon should use defined opaque background token",
  );
});

test("Eval i18n copy uses Skills wording and Chinese title is Skills 评测", () => {
  const source = read("src/i18n/messages.ts");
  assert.ok(
    source.includes("\"eval.title\": \"Skills Evaluator\""),
    "English eval title should use Skills Evaluator",
  );
  assert.ok(
    source.includes("\"eval.title\": \"Skills 评测\""),
    "Chinese eval title should be Skills 评测",
  );
  assert.ok(
    source.includes("\"eval.config.skill\": \"Select Skills\""),
    "English eval config label should use Select Skills",
  );
  assert.ok(
    source.includes("\"eval.config.skill\": \"选择 Skills\""),
    "Chinese eval config label should use 选择 Skills",
  );
});

test("Eval config action area is grouped and uses compact action buttons", () => {
  const source = read("src/pages/EvalPage.tsx");
  const css = read("src/pages/EvalPage.css");
  const i18n = read("src/i18n/messages.ts");

  assert.ok(
    source.includes("eval-action-group") && source.includes("eval-action-row"),
    "EvalPage should group config actions into structured blocks instead of a flat stack",
  );
  assert.ok(
    source.includes("eval-action-btn"),
    "EvalPage should use compact button class for action area controls",
  );
  assert.ok(
    css.includes(".eval-action-group") &&
      css.includes(".eval-action-row") &&
      css.includes(".btn.eval-action-btn"),
    "EvalPage CSS should define grouped action layout and compact button sizing rules",
  );
  assert.ok(
    i18n.includes("\"eval.actions.primary\"") && i18n.includes("\"eval.actions.secondary\""),
    "i18n should provide labels for primary/secondary action groups",
  );
});

test("Eval section is marked as BETA in sidebar and page title", () => {
  const sidebar = read("src/components/Sidebar.tsx");
  const sidebarCss = read("src/components/Sidebar.css");
  const evalPage = read("src/pages/EvalPage.tsx");
  const evalCss = read("src/pages/EvalPage.css");

  assert.ok(
    sidebar.includes("view: \"eval\"") && sidebar.includes("beta: true"),
    "sidebar nav config should explicitly mark eval item as beta",
  );
  assert.ok(
    sidebar.includes("sidebar-beta-badge") && sidebar.includes("BETA"),
    "sidebar should render BETA badge next to eval nav label",
  );
  assert.ok(
    evalPage.includes("eval-beta-badge") && evalPage.includes("BETA"),
    "eval page title should include a BETA badge",
  );
  assert.ok(
    sidebarCss.includes(".sidebar-beta-badge") && evalCss.includes(".eval-beta-badge"),
    "CSS should define badge styles for sidebar and eval page title",
  );
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(pathFromRoot: string) {
  return fs.readFileSync(path.resolve(process.cwd(), pathFromRoot), "utf8");
}

test("Eval running progress uses completion-based percentage and avoids 100% while still running", () => {
  const source = read("src/pages/EvalPage.tsx");
  assert.ok(
    source.includes("const isRunningProgress = progressEvent?.status === \"running\";"),
    "running progress should branch on progress status",
  );
  assert.ok(
    source.includes("const completedSteps = isRunningProgress"),
    "progress should be computed from completed steps instead of current running step",
  );
  assert.ok(
    source.includes("Math.min(99,"),
    "running percentage should be capped below 100 until completion event arrives",
  );
});

test("Eval running progress prefers backend stage progress payload and keeps running under 100%", () => {
  const source = read("src/pages/EvalPage.tsx");
  assert.ok(
    source.includes("stageProgressPercent"),
    "running view should consume backend stageProgressPercent when provided",
  );
  assert.ok(
    source.includes("remainingSeconds"),
    "running view should display backend remainingSeconds estimate for trustable ETA",
  );
  assert.ok(
    source.includes("const progressPercent = isCompletedProgress"),
    "running percentage should still only reach 100 on terminal status",
  );
});

test("Eval run failure keeps running workspace visible instead of jumping back to setup step 3", () => {
  const source = read("src/pages/EvalPage.tsx");
  const handleRunEvalMatch = source.match(
    /async function handleRunEval\(\)\s+\{([\s\S]*?)\n\s+}\n\n\s+async function handleSubmitReview/,
  );
  assert.ok(handleRunEvalMatch, "handleRunEval block should exist");
  const handleRunEvalBlock = handleRunEvalMatch[1];
  assert.match(
    handleRunEvalBlock,
    /catch \(error: unknown\) \{[\s\S]*setView\("running"\)/,
    "run failure branch should keep running view so users can inspect failure context",
  );
  assert.doesNotMatch(
    handleRunEvalBlock,
    /catch \(error: unknown\) \{[\s\S]*setView\("setup"\)/,
    "run failure branch should not force users back to setup step 3",
  );
});

test("Eval running active stage has breathe animation instead of static highlight", () => {
  const css = read("src/pages/EvalPage.css");
  assert.ok(
    css.includes("@keyframes eval-running-breathe"),
    "EvalPage CSS should define a dedicated breathing animation",
  );
  assert.ok(
    css.includes(".eval-running-flow .eval-flow-step.is-active"),
    "running flow active step should have scoped styling",
  );
  assert.ok(
    css.includes("animation: eval-running-breathe"),
    "active running step should apply breathing animation",
  );
  assert.ok(
    css.includes("outline: 2px solid color-mix(in srgb, var(--accent)"),
    "active running step should use a high-visibility outline pulse so motion is perceivable",
  );
  assert.ok(
    css.includes("@keyframes eval-running-breathe-reduced"),
    "reduced-motion mode should still use a low-intensity breathing animation",
  );
  assert.ok(
    !css.includes(".eval-running-flow .eval-flow-step.is-active {\n    animation: none;"),
    "reduced-motion mode should not fully disable the active-stage signal",
  );
});

test("Eval result view adds Chinese explanation helpers for quick checks, advisory reasons and failure patterns", () => {
  const source = read("src/pages/EvalPage.tsx");
  assert.ok(
    source.includes("renderQuickCheckLabel(") && source.includes("renderQuickCheckMessage("),
    "quick-check panel should map raw keys/messages into localized explanatory copy",
  );
  assert.ok(
    source.includes("renderAdvisoryReason("),
    "advisory panel should render user-facing risk explanations",
  );
  assert.ok(
    source.includes("renderAnalyzerPattern("),
    "analyzer panel should render localized failure-pattern descriptions",
  );
  assert.ok(
    source.includes("renderAnalyzerReason("),
    "analyzer panel should render localized failure reason details in Chinese",
  );
});

test("i18n defines Chinese guidance keys for quick checks, high-risk explanation and analyzer labels", () => {
  const messages = read("src/i18n/messages.ts");
  assert.ok(
    messages.includes("\"eval.quickCheck.legend\"") &&
      messages.includes("\"eval.quickCheck.skillShape\""),
    "messages should include quick-check legend and labels",
  );
  assert.ok(
    messages.includes("\"eval.advisory.whyHighRisk\""),
    "messages should include high-risk explanation heading",
  );
  assert.ok(
    messages.includes("\"eval.analysis.pattern.trigger\"") &&
      messages.includes("\"eval.analysis.pattern.functionalWithSkill\""),
    "messages should include localized analyzer pattern prefixes",
  );
});

test("Review workbench provides explicit user-facing checklist guidance on what to review", () => {
  const source = read("src/pages/EvalPage.tsx");
  assert.ok(
    source.includes("eval.review.guideTitle"),
    "review view should include a dedicated 'what to review' guide title",
  );
  assert.ok(
    source.includes("eval.review.guideRiskTitle") &&
      source.includes("eval.review.guideEvidenceTitle") &&
      source.includes("eval.review.guideVerdictTitle"),
    "review view should include risk/evidence/verdict checklist items",
  );

  const messages = read("src/i18n/messages.ts");
  assert.ok(
    messages.includes("\"eval.review.guideTitle\"") &&
      messages.includes("\"eval.review.guideHint\"") &&
      messages.includes("\"eval.review.guideTodo\"") &&
      messages.includes("\"eval.review.guideDone\""),
    "i18n should define checklist guidance labels for both locales",
  );
});

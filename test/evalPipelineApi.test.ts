import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(pathFromRoot: string) {
  return fs.readFileSync(path.resolve(process.cwd(), pathFromRoot), "utf8");
}

test("tauri API exposes run_eval_pipeline and maps nested trigger/functional payloads", () => {
  const source = read("src/api/tauri.ts");
  assert.ok(source.includes("run_eval_pipeline"), "runEvalPipeline should invoke run_eval_pipeline");
  assert.ok(
    source.includes("triggerClean: mapTriggerOutput(raw.triggerClean)"),
    "runEvalPipeline should map trigger output to camelCase",
  );
  assert.ok(
    source.includes("functional: mapFunctionalOutput(raw.functional)"),
    "runEvalPipeline should map functional output to camelCase",
  );
});

test("runEvalPipeline request forwards repeat and budget controls and keeps repeat stats in output contract", () => {
  const source = read("src/api/tauri.ts");
  assert.ok(
    source.includes("repeats: request.repeats"),
    "runEvalPipeline should forward repeats to backend pipeline",
  );
  assert.ok(
    source.includes("maxCostUsd: request.maxCostUsd"),
    "runEvalPipeline should forward maxCostUsd budget limit to backend pipeline",
  );
  assert.ok(
    source.includes("repeatStats"),
    "pipeline output contract should expose repeatStats aggregation for UI",
  );
});

test("tauri API exposes eval_control and supports runId for progress/control correlation", () => {
  const source = read("src/api/tauri.ts");
  assert.ok(
    source.includes("eval_control"),
    "tauri API should expose eval_control command for pause/resume/cancel",
  );
  assert.ok(
    source.includes("runId?: string"),
    "runEvalPipeline request should support runId for progress correlation",
  );
  assert.ok(
    source.includes("runId: request.runId"),
    "runEvalPipeline invoke payload should forward runId to backend",
  );
});

test("tauri API exposes eval dataset storage and history commands", () => {
  const source = read("src/api/tauri.ts");
  assert.ok(
    source.includes("eval_get_storage_paths"),
    "tauri API should expose eval_get_storage_paths for preset storage visibility",
  );
  assert.ok(
    source.includes("eval_list_history"),
    "tauri API should expose eval_list_history for history browsing",
  );
  assert.ok(
    source.includes("eval_load_history"),
    "tauri API should expose eval_load_history for loading previous reports",
  );
  assert.ok(
    source.includes("kind?: \"trigger\" | \"functional\""),
    "evalSaveDataset request should support dataset kind for preset file naming",
  );
  assert.ok(
    source.includes("repeats: number"),
    "eval history contract should include repeats in overview records",
  );
  assert.ok(
    source.includes("eval_list_sample_generation_history"),
    "tauri API should expose sidecar history command for sample generation timing",
  );
  assert.ok(
    source.includes("latestTriggerPath?: string") &&
      source.includes("latestFunctionalPath?: string"),
    "storage path contract should expose latest trigger/functional dataset hints for auto-prefill",
  );
});

test("tauri API defines sample generation timing history contract", () => {
  const source = read("src/api/tauri.ts");
  assert.ok(
    source.includes("export type EvalSampleGenerationTimingEntry = {"),
    "tauri API should define sample generation timing entry contract",
  );
  assert.ok(
    source.includes("recordedAtUnix: number;") &&
      source.includes("elapsedSeconds: number;") &&
      source.includes("triggerCount: number;") &&
      source.includes("functionalCount: number;"),
    "sample timing contract should expose timestamp, elapsed seconds, and case counts",
  );
});

test("evalSaveConfig sends compatibility keys for tauri arg naming differences", () => {
  const source = read("src/api/tauri.ts");
  assert.ok(source.includes("apiKey: config.apiKey"), "evalSaveConfig should send camelCase apiKey");
  assert.ok(source.includes("api_key: config.apiKey"), "evalSaveConfig should send snake_case api_key");
  assert.ok(source.includes("baseUrl: config.baseUrl"), "evalSaveConfig should send camelCase baseUrl");
  assert.ok(source.includes("base_url: config.baseUrl"), "evalSaveConfig should send snake_case base_url");
  assert.ok(
    source.includes("sampleModel: config.sampleModel") &&
      source.includes("sample_model: config.sampleModel"),
    "evalSaveConfig should send sample model via both camelCase and snake_case",
  );
  assert.ok(
    source.includes("runModel: config.runModel") && source.includes("run_model: config.runModel"),
    "evalSaveConfig should send run model via both camelCase and snake_case",
  );
  assert.ok(
    source.includes("defaultModel: config.runModel") && source.includes("default_model: config.runModel"),
    "evalSaveConfig should keep defaultModel payload for backward compatibility during migration",
  );
});

test("EvalConfig contract splits sample and run model defaults", () => {
  const source = read("src/api/tauri.ts");
  assert.ok(
    source.includes("sampleModel: string"),
    "EvalConfig should expose sampleModel field for sample-generation provider/model setting",
  );
  assert.ok(
    source.includes("runModel: string"),
    "EvalConfig should expose runModel field for evaluation runtime provider/model setting",
  );
});

test("functional eval mapping keeps Layer2 quality fields for UI explanation", () => {
  const source = read("src/api/tauri.ts");
  assert.ok(
    source.includes("qualityScore: item.quality_score"),
    "functional result mapping should expose qualityScore",
  );
  assert.ok(
    source.includes("judgeRationale: item.judge_rationale"),
    "functional result mapping should expose judge rationale",
  );
  assert.ok(
    source.includes("judgeSuggestions: item.judge_suggestions"),
    "functional result mapping should expose judge suggestions",
  );
  assert.ok(
    source.includes("dimensionScores: raw.dimension_scores"),
    "functional output should expose dimension score summary",
  );
});

test("tauri API exposes taxonomy metadata on skills and eval pipeline outputs", () => {
  const source = read("src/api/tauri.ts");
  assert.ok(
    source.includes("export type SkillTaxonomy = {"),
    "tauri API should define SkillTaxonomy contract",
  );
  assert.ok(
    source.includes("taxonomy?: SkillTaxonomy;"),
    "SkillMeta should expose optional taxonomy metadata",
  );
  assert.ok(
    source.includes("taxonomyStatus?: \"applied\" | \"skipped\" | \"failed\";"),
    "Eval pipeline output should include taxonomy status",
  );
  assert.ok(
    source.includes("taxonomyMessage?: string;") && source.includes("taxonomyApplied?: boolean;"),
    "Eval pipeline output should include taxonomy message/applied flags",
  );
});

test("tauri API exposes advisory and evidence fields with backward-compatible defaults", () => {
  const source = read("src/api/tauri.ts");
  assert.ok(
    source.includes("evidenceLevel?: \"simulated\" | \"real\";"),
    "Eval pipeline output should expose evidence level",
  );
  assert.ok(
    source.includes("advisory?: EvalAdvisory;"),
    "Eval pipeline output should expose advisory payload",
  );
  assert.ok(
    source.includes("evidenceSummary?: EvalEvidenceSummary;"),
    "Eval pipeline output should expose evidence summary payload",
  );
  assert.ok(
    source.includes("evidenceLevel: raw.evidenceLevel ?? \"simulated\""),
    "runEvalPipeline/evalLoadHistory should default missing evidenceLevel to simulated",
  );
});

test("tauri API maps trigger and functional evidence details into camelCase fields", () => {
  const source = read("src/api/tauri.ts");
  assert.ok(
    source.includes("rawResponsePath: item.raw_response_path ?? null"),
    "result mapping should expose rawResponsePath",
  );
  assert.ok(
    source.includes("latencyMs: item.latency_ms ?? null"),
    "result mapping should expose latencyMs",
  );
  assert.ok(
    source.includes("inputTokens: item.input_tokens ?? null"),
    "result mapping should expose inputTokens",
  );
  assert.ok(
    source.includes("outputTokens: item.output_tokens ?? null"),
    "result mapping should expose outputTokens",
  );
  assert.ok(
    source.includes("judgeTraceId: item.judge_trace_id ?? null"),
    "result mapping should expose judgeTraceId",
  );
});

test("runEvalPipeline request supports controlled parallelism knobs", () => {
  const source = read("src/api/tauri.ts");
  assert.ok(
    source.includes("maxParallelArms?: number"),
    "pipeline request should expose maxParallelArms",
  );
  assert.ok(
    source.includes("triggerMaxWorkers?: number"),
    "pipeline request should expose triggerMaxWorkers",
  );
  assert.ok(
    source.includes("functionalMaxWorkers?: number"),
    "pipeline request should expose functionalMaxWorkers",
  );
  assert.ok(
    source.includes("maxParallelArms: request.maxParallelArms"),
    "runEvalPipeline invoke payload should forward maxParallelArms",
  );
  assert.ok(
    source.includes("triggerMaxWorkers: request.triggerMaxWorkers"),
    "runEvalPipeline invoke payload should forward triggerMaxWorkers",
  );
  assert.ok(
    source.includes("functionalMaxWorkers: request.functionalMaxWorkers"),
    "runEvalPipeline invoke payload should forward functionalMaxWorkers",
  );
});

test("tauri API exposes runtime progress payload contract for stage-level auditability", () => {
  const source = read("src/api/tauri.ts");
  assert.ok(
    source.includes("export type EvalPipelineProgressEvent = {"),
    "tauri API should export a typed runtime progress payload",
  );
  assert.ok(
    source.includes("stageKey?: string") &&
      source.includes("stageProgressPercent?: number") &&
      source.includes("remainingSeconds?: number"),
    "progress payload should expose stage key, stage progress and ETA fields",
  );
  assert.ok(
    source.includes("activeCount?: number") &&
      source.includes("completedCount?: number") &&
      source.includes("failedCount?: number") &&
      source.includes("totalCount?: number"),
    "progress payload should expose counters for in-flight/completed/failed/total tasks",
  );
  assert.ok(
    source.includes("maxParallelArms?: number") &&
      source.includes("triggerMaxWorkers?: number") &&
      source.includes("functionalMaxWorkers?: number"),
    "progress payload should expose runtime parallelism snapshot for auditing",
  );
});

test("evalEstimatePipeline request forwards controlled parallelism knobs", () => {
  const source = read("src/api/tauri.ts");
  assert.ok(
    source.includes("maxParallelArms?: number") &&
      source.includes("triggerMaxWorkers?: number") &&
      source.includes("functionalMaxWorkers?: number"),
    "estimate request should include the same parallelism knobs as runtime request",
  );
  assert.ok(
    source.includes("maxParallelArms: request.maxParallelArms") &&
      source.includes("triggerMaxWorkers: request.triggerMaxWorkers") &&
      source.includes("functionalMaxWorkers: request.functionalMaxWorkers"),
    "estimate invoke payload should forward parallelism values for wall-time calculation",
  );
});

test("tauri API exposes review queue and review submission commands", () => {
  const source = read("src/api/tauri.ts");
  assert.ok(
    source.includes("eval_submit_review"),
    "tauri API should expose eval_submit_review command",
  );
  assert.ok(
    source.includes("eval_get_review"),
    "tauri API should expose eval_get_review command",
  );
  assert.ok(
    source.includes("eval_list_review_queue"),
    "tauri API should expose eval_list_review_queue command",
  );
  assert.ok(
    source.includes("eval_generate_feedback_drafts"),
    "tauri API should expose eval_generate_feedback_drafts command",
  );
  assert.ok(
    source.includes("eval_read_evidence_case"),
    "tauri API should expose eval_read_evidence_case command",
  );
});

test("pipeline output contract includes review/comparator/analyzer optional payloads", () => {
  const source = read("src/api/tauri.ts");
  assert.ok(
    source.includes("reviewSummary?: EvalReviewSummary;"),
    "pipeline output should expose reviewSummary",
  );
  assert.ok(
    source.includes("finalVerdict?: string;"),
    "pipeline output should expose finalVerdict",
  );
  assert.ok(
    source.includes("comparator?: EvalComparatorSummary;"),
    "pipeline output should expose comparator summary",
  );
  assert.ok(
    source.includes("analyzer?: EvalAnalyzerSummary;"),
    "pipeline output should expose analyzer summary",
  );
});

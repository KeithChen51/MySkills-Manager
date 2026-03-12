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
});

test("evalSaveConfig sends compatibility keys for tauri arg naming differences", () => {
  const source = read("src/api/tauri.ts");
  assert.ok(source.includes("apiKey: config.apiKey"), "evalSaveConfig should send camelCase apiKey");
  assert.ok(source.includes("api_key: config.apiKey"), "evalSaveConfig should send snake_case api_key");
  assert.ok(source.includes("baseUrl: config.baseUrl"), "evalSaveConfig should send camelCase baseUrl");
  assert.ok(source.includes("base_url: config.baseUrl"), "evalSaveConfig should send snake_case base_url");
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

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(pathFromRoot: string) {
  return fs.readFileSync(path.resolve(process.cwd(), pathFromRoot), "utf8");
}

test("eval backend ensures taxonomy before pipeline execution and keeps non-blocking semantics", () => {
  const source = read("src-tauri/src/evals.rs");
  assert.ok(
    source.includes("ensure_skill_taxonomy("),
    "eval backend should ensure taxonomy before running pipeline",
  );
  assert.ok(
    source.includes("taxonomy_status") && source.includes("taxonomy_message"),
    "pipeline output should carry taxonomy execution status fields",
  );
  assert.ok(
    source.includes("select_eval_strategy_by_sok("),
    "eval backend should expose SoK strategy selection hook",
  );
});

test("eval engine CLI exposes classify subcommand", () => {
  const source = read("src-tauri/py/eval_engine/__main__.py");
  assert.ok(
    source.includes("subparsers.add_parser(\"classify\""),
    "CLI should expose classify subcommand",
  );
  assert.ok(
    source.includes("if args.command == \"classify\""),
    "CLI should route classify command to classifier module",
  );
});

test("classifier module normalizes difficulty to both core and level labels", () => {
  const source = read("src-tauri/py/eval_engine/classify.py");
  assert.ok(
    source.includes("skillsbenchDifficultyCore") && source.includes("skillsbenchDifficultyLevel"),
    "classifier should output both SkillsBench difficulty forms",
  );
  assert.ok(
    source.includes("Core") && source.includes("Extended") && source.includes("Extreme"),
    "classifier should keep canonical SkillsBench core values",
  );
});

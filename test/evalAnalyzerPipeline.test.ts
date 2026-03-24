import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(relativePath: string): string {
  return readFileSync(resolve(relativePath), "utf-8");
}

describe("Eval Analyzer Pipeline (v6.0)", () => {
  test("Python analyzer.py exists and implements four-step analysis", () => {
    const source = read("src-tauri/py/eval_engine/analyzer.py");
    assert.ok(
      source.includes("def run"),
      "analyzer.py should contain run() entry point",
    );
    assert.ok(
      source.includes("per_assertion"),
      "analyzer.py should implement per-assertion analysis",
    );
    assert.ok(
      source.includes("cross_case"),
      "analyzer.py should implement cross-case analysis",
    );
    assert.ok(
      source.includes("efficiency"),
      "analyzer.py should implement efficiency analysis",
    );
    assert.ok(
      source.includes("improvement") || source.includes("suggest"),
      "analyzer.py should generate improvement suggestions",
    );
  });

  test("Python __main__.py registers analyze subcommand", () => {
    const source = read("src-tauri/py/eval_engine/__main__.py");
    assert.ok(
      source.includes('"analyze"'),
      "__main__.py should register 'analyze' subcommand",
    );
  });

  test("Python __main__.py supports judge model parameters", () => {
    const source = read("src-tauri/py/eval_engine/__main__.py");
    assert.ok(
      source.includes("--judge-model"),
      "__main__.py should support --judge-model parameter",
    );
  });

  test("Python llm_client.py provides unified LLMClient", () => {
    const source = read("src-tauri/py/eval_engine/llm_client.py");
    assert.ok(
      source.includes("class LLMClient"),
      "llm_client.py should contain LLMClient class",
    );
    assert.ok(
      source.includes("extract_json_object") || source.includes("_extract_json_object"),
      "llm_client.py should provide JSON extraction utility",
    );
  });

  test("Python trigger_eval.py imports from llm_client", () => {
    const source = read("src-tauri/py/eval_engine/trigger_eval.py");
    assert.ok(
      source.includes("from") && source.includes("llm_client"),
      "trigger_eval.py should import from llm_client module",
    );
  });

  test("Python functional_eval.py imports from llm_client", () => {
    const source = read("src-tauri/py/eval_engine/functional_eval.py");
    assert.ok(
      source.includes("from") && source.includes("llm_client"),
      "functional_eval.py should import from llm_client module",
    );
  });

  test("Python sample_gen.py imports from llm_client", () => {
    const source = read("src-tauri/py/eval_engine/sample_gen.py");
    assert.ok(
      source.includes("from") && source.includes("llm_client"),
      "sample_gen.py should import from llm_client module",
    );
  });

  test("Rust evals/mod.rs imports from types submodule", () => {
    const source = read("src-tauri/src/evals/mod.rs");
    assert.ok(
      source.includes("mod types;"),
      "evals/mod.rs should declare types submodule",
    );
    assert.ok(
      source.includes("pub use types::*;"),
      "evals/mod.rs should re-export types",
    );
  });

  test("Rust types.rs contains EvalAnalyzerSummary with improvement_suggestions", () => {
    const source = read("src-tauri/src/evals/types.rs");
    assert.ok(
      source.includes("pub struct EvalAnalyzerSummary"),
      "types.rs should contain EvalAnalyzerSummary struct",
    );
    assert.ok(
      source.includes("improvement_suggestions"),
      "EvalAnalyzerSummary should have improvement_suggestions field",
    );
    assert.ok(
      source.includes("description_feedback"),
      "EvalAnalyzerSummary should have description_feedback field",
    );
  });

  test("TypeScript tauri.ts EvalAnalyzerSummary has improvementSuggestions", () => {
    const source = read("src/api/tauri.ts");
    assert.ok(
      source.includes("improvementSuggestions"),
      "tauri.ts EvalAnalyzerSummary should have improvementSuggestions",
    );
    assert.ok(
      source.includes("descriptionFeedback"),
      "tauri.ts EvalAnalyzerSummary should have descriptionFeedback",
    );
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");
}

test("EvalPage delegates floating modal shell to eval scoped component", () => {
  const source = readSource("src/pages/EvalPage.tsx");
  assert.ok(
    source.includes('from "./eval/components/EvalFloatingModal"'),
    "EvalPage should import EvalFloatingModal from eval/components",
  );
  assert.ok(
    source.includes("<EvalFloatingModal"),
    "EvalPage should render EvalFloatingModal instead of duplicating modal shell markup",
  );
});

test("GitPage delegates floating modal shell to git scoped component", () => {
  const source = readSource("src/pages/GitPage.tsx");
  assert.ok(
    source.includes('from "./git/components/GitFloatingModal"'),
    "GitPage should import GitFloatingModal from git/components",
  );
  assert.ok(
    source.includes("<GitFloatingModal"),
    "GitPage should render GitFloatingModal for guide/graph/ignore overlays",
  );
});

test("Task14 scoped component directories exist with TSX entries", () => {
  const evalComponentsDir = path.resolve(process.cwd(), "src/pages/eval/components");
  const gitComponentsDir = path.resolve(process.cwd(), "src/pages/git/components");
  assert.ok(
    fs.existsSync(evalComponentsDir),
    "Task14 should create src/pages/eval/components directory",
  );
  assert.ok(
    fs.existsSync(gitComponentsDir),
    "Task14 should create src/pages/git/components directory",
  );
  const evalEntries = fs.readdirSync(evalComponentsDir).filter((name) => name.endsWith(".tsx"));
  const gitEntries = fs.readdirSync(gitComponentsDir).filter((name) => name.endsWith(".tsx"));
  assert.ok(evalEntries.length > 0, "eval/components should contain tsx components");
  assert.ok(gitEntries.length > 0, "git/components should contain tsx components");
});

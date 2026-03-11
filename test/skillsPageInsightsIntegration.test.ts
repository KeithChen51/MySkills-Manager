import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");
}

test("Skills page requests insights in a single fetch path", () => {
  const source = readSource("src/pages/SkillsPage.tsx");

  assert.ok(
    source.includes("skillsGetInsights("),
    "SkillsPage should request aggregated insights from backend command",
  );
});

test("Skills page exposes 7/30/90 insight window toggle with default 30", () => {
  const source = readSource("src/pages/SkillsPage.tsx");

  assert.ok(
    source.includes("useState<7 | 30 | 90>(30)"),
    "SkillsPage should default insight window to 30 days",
  );
  assert.ok(
    source.includes("[7, 30, 90]"),
    "SkillsPage should render the expected 7/30/90 window options",
  );
});

test("Skills page exposes sort mode for usage/eval and applies comparator", () => {
  const source = readSource("src/pages/SkillsPage.tsx");

  assert.ok(
    source.includes("useState<\"name\" | \"usage\" | \"eval\">(\"name\")"),
    "SkillsPage should maintain sort mode state with name/usage/eval options",
  );
  assert.ok(
    source.includes("compareSkillNamesByMode("),
    "SkillsPage should sort skills via shared insight comparator",
  );
});

test("Skills page insight detail fetches logs and eval history with limit 10", () => {
  const source = readSource("src/pages/SkillsPage.tsx");

  assert.ok(
    source.includes("logsGet({") && source.includes("limit: 10"),
    "SkillsPage detail panel should load recent logs with limit 10",
  );
  assert.ok(
    source.includes("evalListHistory(") && source.includes(", 10"),
    "SkillsPage detail panel should load recent eval history with limit 10",
  );
});

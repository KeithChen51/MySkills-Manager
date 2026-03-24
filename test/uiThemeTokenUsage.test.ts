import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const COLOR_LITERAL_PATTERN = /#[0-9a-fA-F]{3,8}\b|rgba?\(/g;

function read(pathFromRoot: string) {
  return fs.readFileSync(path.resolve(process.cwd(), pathFromRoot), "utf8");
}

function findColorLiterals(source: string): string[] {
  return Array.from(source.matchAll(COLOR_LITERAL_PATTERN), (match) => match[0]);
}

test("Eval scorecard uses theme tokens instead of inline color literals", () => {
  const source = read("src/pages/eval/EvalScorecard.tsx");
  const found = findColorLiterals(source);

  assert.equal(
    found.length,
    0,
    `EvalScorecard should avoid hard-coded color literals, found: ${found.join(", ")}`,
  );
});

test("Settings page styles avoid hard-coded semantic colors", () => {
  const source = read("src/pages/SettingsPage.css");
  const found = findColorLiterals(source);

  assert.equal(
    found.length,
    0,
    `SettingsPage.css should rely on semantic tokens, found: ${found.join(", ")}`,
  );
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const COLOR_LITERAL_PATTERN = /#[0-9a-fA-F]{3,8}\b|rgba?\(/g;
const FONT_SIZE_PX_PATTERN = /font-size:\s*\d+px/g;

function read(pathFromRoot: string) {
  return fs.readFileSync(path.resolve(process.cwd(), pathFromRoot), "utf8");
}

function findColorLiterals(source: string): string[] {
  return Array.from(source.matchAll(COLOR_LITERAL_PATTERN), (match) => match[0]);
}

function findHardcodedFontSizes(source: string): string[] {
  return Array.from(source.matchAll(FONT_SIZE_PX_PATTERN), (match) => match[0]);
}

const FILES_TO_ENFORCE = [
  "src/pages/eval/EvalScorecard.tsx",
  "src/pages/DashboardPage.tsx",
  "src/pages/SettingsPage.css",
  "src/pages/GitPage.css",
  "src/pages/ToolsPage.css",
  "src/pages/SkillsPage.css",
  "src/pages/EvalPage.css",
  "src/pages/DashboardPage.css",
];

for (const file of FILES_TO_ENFORCE) {
  test(`${file} should avoid direct color literals and rely on semantic tokens`, () => {
    const source = read(file);
    const found = findColorLiterals(source);
    assert.equal(
      found.length,
      0,
      `${file} still has hard-coded color literals: ${found.join(", ")}`,
    );
  });
}

const CSS_FILES_FOR_FONT_SIZE = FILES_TO_ENFORCE.filter((f) => f.endsWith(".css"));

for (const file of CSS_FILES_FOR_FONT_SIZE) {
  test(`${file} should use token variables instead of hardcoded font-size px`, () => {
    const source = read(file);
    const found = findHardcodedFontSizes(source);
    assert.equal(
      found.length,
      0,
      `${file} still has hard-coded font-size px values: ${found.join(", ")}`,
    );
  });
}

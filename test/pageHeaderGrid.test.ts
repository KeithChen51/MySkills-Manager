import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(pathFromRoot: string) {
  return fs.readFileSync(path.resolve(process.cwd(), pathFromRoot), "utf8");
}

test("shared page header grid utilities are defined in primitives", () => {
  const css = read("src/styles/primitives.css");
  assert.ok(
    css.includes(".page-header-grid {"),
    "primitives should define page-header-grid utility",
  );
  assert.ok(
    css.includes(".page-header-actions-grid {"),
    "primitives should define page-header-actions-grid utility",
  );
  assert.ok(
    css.includes("width: min(100%, var(--page-header-actions-max-width, 1140px));"),
    "header action area width should be normalized by shared grid token",
  );
});

test("Skills page header consumes shared grid utilities", () => {
  const source = read("src/pages/SkillsPage.tsx");
  assert.ok(
    source.includes("page-header skills-page-header page-header-grid"),
    "Skills page header should opt into shared page-header-grid",
  );
  assert.ok(
    source.includes("skills-header-actions page-header-actions-grid"),
    "Skills action area should opt into shared page-header-actions-grid",
  );
});

test("Tools page header consumes shared grid utilities", () => {
  const source = read("src/pages/ToolsPage.tsx");
  assert.ok(
    source.includes("page-header tools-page-header page-header-grid"),
    "Tools page header should opt into shared page-header-grid",
  );
  assert.ok(
    source.includes("tools-header-actions page-header-actions-grid"),
    "Tools action area should opt into shared page-header-actions-grid",
  );
});

test("Git page header consumes shared grid utilities", () => {
  const source = read("src/pages/GitPage.tsx");
  assert.ok(
    source.includes("page-header git-page-header page-header-grid"),
    "Git page header should opt into shared page-header-grid",
  );
  assert.ok(
    source.includes("git-header-actions page-header-actions-grid"),
    "Git action area should opt into shared page-header-actions-grid",
  );
});

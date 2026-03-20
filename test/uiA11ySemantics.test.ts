import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(pathFromRoot: string) {
  return fs.readFileSync(path.resolve(process.cwd(), pathFromRoot), "utf8");
}

test("EvalHistory modal has dialog semantics", () => {
  const source = read("src/pages/eval/EvalHistory.tsx");

  assert.match(
    source,
    /role="dialog"/,
    "EvalHistory modal should declare role=\"dialog\" for assistive technologies",
  );
  assert.match(
    source,
    /aria-modal="true"/,
    "EvalHistory modal should declare aria-modal=\"true\" to mark background as inert",
  );
});

test("Settings collapsible group headers use semantic button elements", () => {
  const source = read("src/pages/SettingsPage.tsx");

  assert.ok(
    !source.includes("role=\"button\""),
    "SettingsPage should avoid div+role=button and use native button semantics",
  );
  assert.ok(
    !source.includes("tabIndex={0}"),
    "SettingsPage should avoid manual keyboard patching via tabIndex on non-button containers",
  );
});

test("Skills insights window switch exposes tab roles and selected state", () => {
  const source = read("src/pages/SkillsPage.tsx");

  const tablistBlock = source.match(
    /<div className="skills-insight-window-switch"[\s\S]*?<\/div>\s*<\/div>/,
  );
  assert.ok(tablistBlock, "SkillsPage should keep a tablist wrapper for insight window switching");
  assert.match(
    tablistBlock?.[0] ?? "",
    /role="tab"/,
    "Each window option should declare role=\"tab\"",
  );
  assert.match(
    tablistBlock?.[0] ?? "",
    /aria-selected=/,
    "Each tab option should expose aria-selected state",
  );
});

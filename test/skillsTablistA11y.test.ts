import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(pathFromRoot: string) {
  return fs.readFileSync(path.resolve(process.cwd(), pathFromRoot), "utf8");
}

test("Skills insights window switch exposes tab semantics and keyboard navigation", () => {
  const source = read("src/pages/SkillsPage.tsx");

  assert.match(source, /role="tablist"/, "window switch should keep tablist role");
  assert.match(source, /role="tab"/, "window options should expose role=\"tab\"");
  assert.match(
    source,
    /aria-selected=\{insightWindow === window\}/,
    "window tabs should expose selected state via aria-selected",
  );
  assert.match(
    source,
    /handleInsightWindowKeyDown/,
    "window switch should define a keyboard handler for arrow navigation",
  );
  assert.match(
    source,
    /event\.key === "ArrowRight"/,
    "keyboard handler should support ArrowRight navigation",
  );
  assert.match(
    source,
    /event\.key === "ArrowLeft"/,
    "keyboard handler should support ArrowLeft navigation",
  );
});

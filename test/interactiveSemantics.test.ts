import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(pathFromRoot: string) {
  return fs.readFileSync(path.resolve(process.cwd(), pathFromRoot), "utf8");
}

test("EvalSetup flow stepper uses native buttons for step navigation", () => {
  const source = read("src/pages/eval/EvalSetup.tsx");

  assert.match(
    source,
    /<button[\s\S]*className=\{`eval-flow-step is-\$\{status\}`\}[\s\S]*onClick=\{\(\) => jumpToStep\(step\)\}/,
    "EvalSetup stepper items should be real buttons",
  );
  assert.doesNotMatch(
    source,
    /<div\s+key=\{step\}\s+className=\{`eval-flow-step is-\$\{status\}`\}/,
    "EvalSetup stepper should not rely on clickable div containers",
  );
});

test("EvalHistory list items expose semantic toggle button", () => {
  const source = read("src/pages/eval/EvalHistory.tsx");

  assert.match(
    source,
    /className="eval-history-item-toggle"/,
    "EvalHistory should expose an explicit toggle button for expanding/collapsing entries",
  );
  assert.doesNotMatch(
    source,
    /style=\{\{\s*cursor:\s*"pointer"\s*\}\}/,
    "EvalHistory item wrapper should not be clickable div",
  );
});

test("Settings model-group header uses native button instead of role=button div", () => {
  const source = read("src/pages/SettingsPage.tsx");

  assert.ok(
    !source.includes("role=\"button\""),
    "SettingsPage should remove role=button shim from non-button containers",
  );
  assert.ok(
    !source.includes("tabIndex={0}"),
    "SettingsPage should remove manual tabIndex from non-button containers",
  );
  assert.match(
    source,
    /<button[\s\S]*className="btn btn-ghost settings-model-group-toggle"[\s\S]*onClick=\{\(\) => toggleGroupCollapsed\(group.id\)\}/,
    "SettingsPage collapse header should be a native button",
  );
});

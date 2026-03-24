import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(pathFromRoot: string) {
  return fs.readFileSync(path.resolve(process.cwd(), pathFromRoot), "utf8");
}

test("EvalHistory load button dispatches a real history load action", () => {
  const source = read("src/pages/eval/EvalHistory.tsx");

  assert.match(
    source,
    /evalLoadHistory\(/,
    "EvalHistory should load selected history entry via evalLoadHistory",
  );
  assert.match(
    source,
    /type:\s*"LOAD_HISTORY_ENTRY"/,
    "EvalHistory should dispatch LOAD_HISTORY_ENTRY after loading history data",
  );
  assert.ok(
    !source.includes("e.stopPropagation();\n                          onClose();"),
    "Load button should not be a close-only action",
  );
});

test("EvalStore exposes reducer branch for loading history into result state", () => {
  const source = read("src/pages/eval/EvalStore.tsx");

  assert.match(
    source,
    /\{\s*type:\s*"LOAD_HISTORY_ENTRY";\s*payload:/,
    "EvalStore action union should define LOAD_HISTORY_ENTRY payload",
  );
  assert.match(
    source,
    /case\s*"LOAD_HISTORY_ENTRY":/,
    "EvalStore reducer should handle LOAD_HISTORY_ENTRY",
  );
  assert.match(
    source,
    /report:\s*action\.payload\.report/,
    "LOAD_HISTORY_ENTRY should write loaded report into state",
  );
});

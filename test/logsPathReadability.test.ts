import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(pathFromRoot: string) {
  return fs.readFileSync(path.resolve(process.cwd(), pathFromRoot), "utf8");
}

test("Logs cwd cell exposes full path via title attribute", () => {
  const source = read("src/pages/LogsPage.tsx");

  assert.match(
    source,
    /className="cwd-cell"\s+title=\{log\.cwd\}/,
    "LogsPage cwd cell should include title={log.cwd} for full-path discoverability",
  );
});

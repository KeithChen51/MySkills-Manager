import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { scripts?: Record<string, string> };

const scripts = packageJson.scripts ?? {};

test("desktop build syncs tauri icons from design-pack centered light logo first", () => {
  assert.equal(
    scripts["sync:tauri-icons"],
    "cargo tauri icon ./skillar-design-pack/logo/skillar-icon-centered-light.png --output ./src-tauri/icons",
  );
  assert.equal(
    scripts["build:desktop"],
    "npm run sync:tauri-icons && npm run vscode:resource && cargo tauri build",
  );
});

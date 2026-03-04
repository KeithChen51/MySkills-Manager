import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const buildScript = readFileSync(new URL("../src-tauri/build.rs", import.meta.url), "utf8");

test("tauri build script watches icon assets for changes", () => {
  const requiredWatchTargets = [
    "tauri.conf.json",
    "icons/icon.ico",
    "icons/icon.icns",
    "icons/icon.png",
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
  ];

  for (const target of requiredWatchTargets) {
    assert.match(
      buildScript,
      new RegExp(`cargo:rerun-if-changed=${target.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`),
      `missing watch target: ${target}`,
    );
  }
});

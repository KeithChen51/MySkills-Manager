import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(filePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

test("tauri invoke handler registers update commands", () => {
  const source = read("src-tauri/src/lib.rs");
  for (const command of [
    "update_checker::should_check_updates",
    "update_checker::get_update_settings",
    "update_checker::save_update_settings",
    "update_checker::update_last_check_time",
    "update_checker::save_pending_update_notes",
    "update_checker::check_version_jump",
    "update_checker::update_log",
  ]) {
    assert.ok(source.includes(command), `missing command registration: ${command}`);
  }
});

test("frontend tauri api exports update command wrappers", () => {
  const source = read("src/api/tauri.ts");
  for (const symbol of [
    "shouldCheckUpdates",
    "getUpdateSettings",
    "saveUpdateSettings",
    "updateLastCheckTime",
    "savePendingUpdateNotes",
    "checkVersionJump",
    "updateLog",
  ]) {
    assert.ok(source.includes(`function ${symbol}`), `missing API wrapper: ${symbol}`);
  }
});

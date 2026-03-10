import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelToAvailableOrHidden,
  INITIAL_UPDATE_ACTION,
  toAvailable,
  toDownloading,
  toReady,
  withProgress,
} from "../src/updater/stateMachine";

test("toAvailable creates available action with reset progress", () => {
  const action = toAvailable("0.2.0");
  assert.deepEqual(action, {
    state: "available",
    version: "0.2.0",
    progress: 0,
    requiresInstall: true,
  });
});

test("toDownloading and withProgress clamp progress values", () => {
  const base = toDownloading("0.2.0");
  assert.equal(base.state, "downloading");
  assert.equal(base.progress, 0);

  const over = withProgress(base, 140);
  assert.equal(over.progress, 100);
  const under = withProgress(base, -10);
  assert.equal(under.progress, 0);
  const mid = withProgress(base, 52.6);
  assert.equal(mid.progress, 53);
});

test("toReady marks update as ready to install", () => {
  const action = toReady("0.2.0");
  assert.deepEqual(action, {
    state: "ready",
    version: "0.2.0",
    progress: 100,
    requiresInstall: true,
  });
});

test("cancelToAvailableOrHidden preserves discovered version if present", () => {
  const downloading = toDownloading("0.2.0");
  const canceled = cancelToAvailableOrHidden(downloading);
  assert.equal(canceled.state, "available");
  assert.equal(canceled.version, "0.2.0");

  const hidden = cancelToAvailableOrHidden(INITIAL_UPDATE_ACTION);
  assert.deepEqual(hidden, INITIAL_UPDATE_ACTION);
});

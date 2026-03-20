import assert from "node:assert/strict";
import test from "node:test";

import type { ToolStatus } from "../src/api/tauri";
import { buildToolPathDiagnostics } from "../src/domain/toolPathDiagnostics.ts";

function makeToolStatus(partial: Partial<ToolStatus> = {}): ToolStatus {
  return {
    name: "Codex",
    id: "codex",
    skillsDir: "C:\\Users\\Keith\\.codex\\skills",
    rulesPath: "C:\\Users\\Keith\\.codex\\AGENTS.md",
    pathSource: "default",
    skillsDirExists: true,
    skillsDirWritable: true,
    rulesPathExists: true,
    rulesPathWritable: true,
    exists: true,
    configured: true,
    syncedSkills: 10,
    syncMode: "copy",
    lastSyncTime: "2026-02-28T10:00:00Z",
    autoSync: true,
    trackingEnabled: true,
    hookConfigured: true,
    isCustom: false,
    ...partial,
  };
}

test("buildToolPathDiagnostics marks unset rules path as healthy", () => {
  const diagnostics = buildToolPathDiagnostics(
    makeToolStatus({ rulesPath: "", rulesPathExists: false, rulesPathWritable: false }),
  );

  assert.equal(diagnostics.skillsPathHealthy, true);
  assert.equal(diagnostics.rulesPathHealthy, true);
  assert.equal(diagnostics.rulesPathLabel, "Rules Path Unset");
});

test("buildToolPathDiagnostics detects missing skills path", () => {
  const diagnostics = buildToolPathDiagnostics(
    makeToolStatus({ skillsDirExists: false }),
  );

  assert.equal(diagnostics.skillsPathHealthy, false);
  assert.equal(diagnostics.skillsPathLabel, "Skills Path Missing");
});

test("buildToolPathDiagnostics detects non-writable rules path", () => {
  const diagnostics = buildToolPathDiagnostics(
    makeToolStatus({ rulesPathWritable: false }),
  );

  assert.equal(diagnostics.rulesPathHealthy, false);
  assert.equal(diagnostics.rulesPathLabel, "Rules Path Read-only");
});


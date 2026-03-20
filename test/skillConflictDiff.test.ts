import assert from "node:assert/strict";
import test from "node:test";

import { buildSkillDiff } from "../src/domain/skillConflictDiff.ts";

test("buildSkillDiff reports no changes for identical content", () => {
  const content = "---\nname: sample\n---\n\nbody\n";
  const diff = buildSkillDiff(content, content);

  assert.equal(diff.hasChanges, false);
  assert.equal(diff.added, 0);
  assert.equal(diff.removed, 0);
});

test("buildSkillDiff identifies added and removed lines", () => {
  const base = "---\nname: sample\n---\n\nline-a\nline-b\nline-c\n";
  const incoming = "---\nname: sample\n---\n\nline-a\nline-B\nline-c\nline-d\n";
  const diff = buildSkillDiff(base, incoming, 200);

  assert.equal(diff.hasChanges, true);
  assert.equal(diff.removed, 1);
  assert.equal(diff.added, 2);
  assert.ok(diff.lines.some((line) => line.kind === "removed" && line.text === "line-b"));
  assert.ok(diff.lines.some((line) => line.kind === "added" && line.text === "line-B"));
  assert.ok(diff.lines.some((line) => line.kind === "added" && line.text === "line-d"));
});


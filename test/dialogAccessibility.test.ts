import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(pathFromRoot: string) {
  return fs.readFileSync(path.resolve(process.cwd(), pathFromRoot), "utf8");
}

test("useDialogA11y centralizes Escape handling and focus lifecycle", () => {
  const source = read("src/components/useDialogA11y.ts");

  assert.match(
    source,
    /event\.key\s*===\s*"Escape"/,
    "dialog hook should close on Escape key",
  );
  assert.match(
    source,
    /document\.addEventListener\("keydown"/,
    "dialog hook should register keydown listener while dialog is open",
  );
  assert.match(
    source,
    /dialogRef\.current\?\.focus\(\)/,
    "dialog hook should move focus into dialog on open",
  );
  assert.match(
    source,
    /previouslyFocusedRef\.current\?\.focus\(\)/,
    "dialog hook should restore focus to trigger element on close",
  );
});

test("EvalHistory dialog uses semantic role and shared dialog a11y hook", () => {
  const source = read("src/pages/eval/EvalHistory.tsx");

  assert.match(source, /role="dialog"/, "EvalHistory should expose role=\"dialog\"");
  assert.match(source, /aria-modal="true"/, "EvalHistory should expose aria-modal=\"true\"");
  assert.match(source, /useDialogA11y\(/, "EvalHistory should use shared dialog hook");
});

test("SkillEditor dialog uses shared dialog a11y hook", () => {
  const source = read("src/components/SkillEditor.tsx");

  assert.match(source, /useDialogA11y(?:<[^>]+>)?\(/, "SkillEditor should use shared dialog hook");
  assert.match(source, /ref=\{dialogRef\}/, "SkillEditor should bind dialogRef to dialog container");
});

test("SkillConflictDrawer dialog uses shared dialog a11y hook", () => {
  const source = read("src/pages/skills/SkillConflictDrawer.tsx");

  assert.match(source, /useDialogA11y(?:<[^>]+>)?\(/, "SkillConflictDrawer should use shared dialog hook");
  assert.match(
    source,
    /ref=\{dialogRef\}/,
    "SkillConflictDrawer should bind dialogRef to drawer dialog container",
  );
});

test("Skills detail overlay uses shared dialog a11y hook", () => {
  const source = read("src/pages/SkillsPage.tsx");

  assert.match(
    source,
    /useDialogA11y(?:<[^>]+>)?\(\{\s*open:\s*Boolean\(detailSkillName\)/,
    "SkillsPage should pass detail overlay open-state to shared dialog hook",
  );
  assert.match(
    source,
    /ref=\{detailDialogRef\}/,
    "SkillsPage detail panel should bind dialogRef for focus management",
  );
});

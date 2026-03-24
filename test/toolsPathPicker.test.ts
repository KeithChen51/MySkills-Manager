import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPathPickerOptions,
  pickPathValueFromDialogResult,
  updateDraftWithPickedPath,
  type ToolPathDraft,
} from "../src/pages/toolsPathPicker.ts";

test("buildPathPickerOptions creates directory options for skills path", () => {
  const options = buildPathPickerOptions("skills", "C:\\Users\\Keith\\.codex\\skills");
  assert.equal(options.directory, true);
  assert.equal(options.multiple, false);
  assert.equal(options.defaultPath, "C:\\Users\\Keith\\.codex\\skills");
});

test("buildPathPickerOptions creates file options for rules path", () => {
  const options = buildPathPickerOptions("rules", "C:\\Users\\Keith\\.codex\\AGENTS.md");
  assert.equal(options.directory, false);
  assert.equal(options.multiple, false);
  assert.equal(options.defaultPath, "C:\\Users\\Keith\\.codex\\AGENTS.md");
});

test("pickPathValueFromDialogResult only accepts single string result", () => {
  assert.equal(pickPathValueFromDialogResult("C:\\Temp\\a.txt"), "C:\\Temp\\a.txt");
  assert.equal(pickPathValueFromDialogResult(["C:\\Temp\\a.txt"]), null);
  assert.equal(pickPathValueFromDialogResult(null), null);
});

test("updateDraftWithPickedPath only mutates chosen field when value exists", () => {
  const draft: ToolPathDraft = {
    skillsDir: "C:\\Users\\Keith\\.codex\\skills",
    rulesPath: "C:\\Users\\Keith\\.codex\\AGENTS.md",
  };

  assert.deepEqual(updateDraftWithPickedPath(draft, "skills", "D:\\skills"), {
    skillsDir: "D:\\skills",
    rulesPath: "C:\\Users\\Keith\\.codex\\AGENTS.md",
  });

  assert.deepEqual(updateDraftWithPickedPath(draft, "rules", "D:\\rules\\AGENTS.md"), {
    skillsDir: "C:\\Users\\Keith\\.codex\\skills",
    rulesPath: "D:\\rules\\AGENTS.md",
  });

  assert.deepEqual(updateDraftWithPickedPath(draft, "skills", null), draft);
});


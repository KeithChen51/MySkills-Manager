import assert from "node:assert/strict";
import test from "node:test";

import { copyModeToolsRequiringResync } from "../src/domain/copyModeWarning.ts";

test("copyModeToolsRequiringResync returns installed copy-mode tools", () => {
  const result = copyModeToolsRequiringResync([
    { name: "Codex", exists: true, syncMode: "copy" },
    { name: "Claude Code", exists: true, syncMode: "symlink" },
    { name: "Cursor", exists: false, syncMode: "copy" },
    { name: "Windsurf", exists: true, syncMode: "none" },
    { name: "Trae", exists: true, syncMode: "copy" },
  ]);

  assert.deepEqual(result, ["Codex", "Trae"]);
});


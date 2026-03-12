import assert from "node:assert/strict";
import test from "node:test";

import { createSkillViewItems } from "../src/presentation";

test("createSkillViewItems maps skill models to view items", () => {
  const items = createSkillViewItems([
    {
      name: "router",
      description: "route requests",
      folderPath: "/tmp/router",
      skillMdPath: "/tmp/router/SKILL.md",
    },
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.label, "router");
  assert.equal(items[0]?.description, "route requests");
  assert.equal(items[0]?.skillMdPath, "/tmp/router/SKILL.md");
});

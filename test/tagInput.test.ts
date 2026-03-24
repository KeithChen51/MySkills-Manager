import assert from "node:assert/strict";
import test from "node:test";

import { tagsFromInput, tagsToInput } from "../src/domain/tagInput.ts";

test("tagsFromInput splits, trims and removes empty items", () => {
  const tags = tagsFromInput(" review, quality , , daily ,, ");
  assert.deepEqual(tags, ["review", "quality", "daily"]);
});

test("tagsToInput joins tags for form display", () => {
  const input = tagsToInput(["review", "quality", "daily"]);
  assert.equal(input, "review, quality, daily");
});



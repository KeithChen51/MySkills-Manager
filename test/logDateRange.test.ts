import assert from "node:assert/strict";
import test from "node:test";

import { toIsoEnd, toIsoStart } from "../src/domain/logDateRange";

test("toIsoStart returns undefined for empty value", () => {
  assert.equal(toIsoStart(""), undefined);
});

test("toIsoStart appends start-of-day suffix", () => {
  assert.equal(toIsoStart("2026-02-01"), "2026-01-31T16:00:00Z");
});

test("toIsoEnd returns undefined for empty value", () => {
  assert.equal(toIsoEnd(""), undefined);
});

test("toIsoEnd appends end-of-day suffix", () => {
  assert.equal(toIsoEnd("2026-02-01"), "2026-02-01T15:59:59Z");
});

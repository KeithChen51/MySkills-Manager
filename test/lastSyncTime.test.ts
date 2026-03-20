import assert from "node:assert/strict";
import test from "node:test";

import { formatLastSyncTime } from "../src/domain/lastSyncTime.ts";

test("formatLastSyncTime returns fallback when value is missing", () => {
  const result = formatLastSyncTime(undefined, "en-US", "Never");
  assert.equal(result, "Never");
});

test("formatLastSyncTime keeps raw value when timestamp is invalid", () => {
  const result = formatLastSyncTime("not-a-timestamp", "en-US", "Never");
  assert.equal(result, "not-a-timestamp");
});

test("formatLastSyncTime formats ISO timestamp with locale", () => {
  const iso = "2026-02-28T01:02:03Z";
  const result = formatLastSyncTime(iso, "en-US", "Never", "UTC");
  const expected = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(iso));

  assert.equal(result, expected);
});


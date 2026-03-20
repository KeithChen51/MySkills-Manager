import assert from "node:assert/strict";
import test from "node:test";

import { formatLogTimestamp } from "../src/domain/logTimestamp.ts";

test("formatLogTimestamp keeps raw value when timestamp is invalid", () => {
  assert.equal(formatLogTimestamp("not-a-ts", "zh-CN"), "not-a-ts");
});

test("formatLogTimestamp renders in Beijing timezone by default", () => {
  const iso = "2026-03-04T00:30:00Z";
  const expected = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(iso));

  assert.equal(formatLogTimestamp(iso, "zh-CN"), expected);
});


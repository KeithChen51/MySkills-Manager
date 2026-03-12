import assert from "node:assert/strict";
import test from "node:test";

import {
  compareSkillNamesByMode,
  trendFromValues,
  usageCountForWindow,
  usagePrevCountForWindow,
  type SkillInsightWindow,
} from "../src/domain/skillInsights.ts";

const sampleUsage = {
  lastUsedAt: "2026-03-10T01:00:00Z",
  d7: 8,
  d30: 21,
  d90: 56,
  d7Prev: 4,
  d30Prev: 25,
  d90Prev: 56,
};

test("usageCountForWindow selects correct count for 7/30/90", () => {
  const windows: SkillInsightWindow[] = [7, 30, 90];
  const counts = windows.map((window) => usageCountForWindow(sampleUsage, window));
  assert.deepEqual(counts, [8, 21, 56]);
});

test("usagePrevCountForWindow selects previous window count for 7/30/90", () => {
  const windows: SkillInsightWindow[] = [7, 30, 90];
  const counts = windows.map((window) => usagePrevCountForWindow(sampleUsage, window));
  assert.deepEqual(counts, [4, 25, 56]);
});

test("trendFromValues reports up/down/flat/na", () => {
  assert.equal(trendFromValues(8, 4), "up");
  assert.equal(trendFromValues(8, 9), "down");
  assert.equal(trendFromValues(8, 8), "flat");
  assert.equal(trendFromValues(null, 8), "na");
  assert.equal(trendFromValues(8, null), "na");
});

test("compareSkillNamesByMode sorts by usage count desc for selected window", () => {
  const insightBySkill = new Map([
    [
      "alpha",
      {
        usage: { ...sampleUsage, d30: 9 },
        eval: { latestPassRate: 0.8, latestStatus: "success" },
      },
    ],
    [
      "beta",
      {
        usage: { ...sampleUsage, d30: 21 },
        eval: { latestPassRate: 0.4, latestStatus: "failed" },
      },
    ],
  ]);

  const names = ["alpha", "beta"].sort((a, b) =>
    compareSkillNamesByMode(a, b, insightBySkill, "usage", 30),
  );
  assert.deepEqual(names, ["beta", "alpha"]);
});

test("compareSkillNamesByMode sorts by eval pass rate desc and unevaluated last", () => {
  const insightBySkill = new Map([
    [
      "alpha",
      {
        usage: sampleUsage,
        eval: { latestPassRate: null, latestStatus: null },
      },
    ],
    [
      "beta",
      {
        usage: sampleUsage,
        eval: { latestPassRate: 0.52, latestStatus: "failed" },
      },
    ],
    [
      "gamma",
      {
        usage: sampleUsage,
        eval: { latestPassRate: 0.88, latestStatus: "success" },
      },
    ],
  ]);

  const names = ["alpha", "beta", "gamma"].sort((a, b) =>
    compareSkillNamesByMode(a, b, insightBySkill, "eval", 30),
  );
  assert.deepEqual(names, ["gamma", "beta", "alpha"]);
});

test("compareSkillNamesByMode prioritizes high-risk advisory before pass rate when sorting eval", () => {
  const insightBySkill = new Map([
    [
      "alpha",
      {
        usage: sampleUsage,
        eval: { latestPassRate: 0.9, latestStatus: "success", latestAdvisoryLevel: "pass" },
      },
    ],
    [
      "beta",
      {
        usage: sampleUsage,
        eval: { latestPassRate: 0.6, latestStatus: "failed", latestAdvisoryLevel: "high_risk" },
      },
    ],
    [
      "gamma",
      {
        usage: sampleUsage,
        eval: { latestPassRate: 0.8, latestStatus: "success", latestAdvisoryLevel: "warn" },
      },
    ],
  ]);

  const names = ["alpha", "beta", "gamma"].sort((a, b) =>
    compareSkillNamesByMode(a, b, insightBySkill, "eval", 30),
  );
  assert.deepEqual(names, ["beta", "gamma", "alpha"]);
});

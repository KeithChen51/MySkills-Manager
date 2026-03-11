import type { SkillEvalInsight, SkillUsageInsight } from "../api/tauri";

export type SkillInsightWindow = 7 | 30 | 90;
export type InsightTrend = "up" | "down" | "flat" | "na";
export type SkillSortMode = "name" | "usage" | "eval";

type SkillInsightLite = {
  usage?: Pick<SkillUsageInsight, "d7" | "d30" | "d90">;
  eval?: Pick<SkillEvalInsight, "latestPassRate" | "latestStatus">;
};

export function usageCountForWindow(
  usage: Pick<SkillUsageInsight, "d7" | "d30" | "d90">,
  window: SkillInsightWindow,
): number {
  if (window === 7) return usage.d7;
  if (window === 30) return usage.d30;
  return usage.d90;
}

export function usagePrevCountForWindow(
  usage: Pick<SkillUsageInsight, "d7Prev" | "d30Prev" | "d90Prev">,
  window: SkillInsightWindow,
): number {
  if (window === 7) return usage.d7Prev;
  if (window === 30) return usage.d30Prev;
  return usage.d90Prev;
}

export function trendFromValues(
  current: number | null | undefined,
  previous: number | null | undefined,
): InsightTrend {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return "na";
  }
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

export function evalTrend(evalInsight: SkillEvalInsight): InsightTrend {
  return trendFromValues(evalInsight.latestPassRate, evalInsight.prevPassRate);
}

function evalStatusRank(status: string | null | undefined): number {
  if (status === "success") return 3;
  if (status === "failed") return 2;
  if (status) return 1;
  return 0;
}

export function compareSkillNamesByMode(
  aName: string,
  bName: string,
  insightBySkill: Map<string, SkillInsightLite>,
  mode: SkillSortMode,
  window: SkillInsightWindow,
): number {
  if (mode === "name") {
    return aName.localeCompare(bName);
  }

  const aInsight = insightBySkill.get(aName);
  const bInsight = insightBySkill.get(bName);

  if (mode === "usage") {
    const aUsage = usageCountForWindow(
      aInsight?.usage ?? { d7: 0, d30: 0, d90: 0 },
      window,
    );
    const bUsage = usageCountForWindow(
      bInsight?.usage ?? { d7: 0, d30: 0, d90: 0 },
      window,
    );
    if (bUsage !== aUsage) {
      return bUsage - aUsage;
    }
    return aName.localeCompare(bName);
  }

  const aPass = aInsight?.eval?.latestPassRate ?? -1;
  const bPass = bInsight?.eval?.latestPassRate ?? -1;
  if (bPass !== aPass) {
    return bPass - aPass;
  }
  const aStatusRank = evalStatusRank(aInsight?.eval?.latestStatus);
  const bStatusRank = evalStatusRank(bInsight?.eval?.latestStatus);
  if (bStatusRank !== aStatusRank) {
    return bStatusRank - aStatusRank;
  }
  return aName.localeCompare(bName);
}

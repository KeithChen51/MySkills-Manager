import type { LocalSkillsOverview, SkillConflictDetail } from "../api/tauri";

export type ConflictSummary = {
  hasBaseline: boolean;
  totalSources: number;
  conflictingCount: number;
  hiddenMatchedCount: number;
};

export function selectConflictSkillNames(overview: LocalSkillsOverview | null): string[] {
  if (!overview) return [];
  const names = new Set<string>();
  for (const tool of overview.tools) {
    for (const skill of tool.skills) {
      if (skill.hashConflictsMySkills) {
        names.add(skill.name);
      }
    }
  }
  return Array.from(names).sort();
}

export function summarizeConflictDetail(detail: SkillConflictDetail): ConflictSummary {
  const hasBaseline = detail.variants.some((variant) => variant.sourceId === "my-skills");
  const conflictingCount = detail.variants.filter(
    (variant) => variant.sourceId !== "my-skills" && !variant.hashMatchesMySkills,
  ).length;
  const hiddenMatchedCount = detail.variants.filter(
    (variant) => variant.sourceId !== "my-skills" && variant.hashMatchesMySkills,
  ).length;
  return {
    hasBaseline,
    totalSources: detail.variants.length,
    conflictingCount,
    hiddenMatchedCount,
  };
}


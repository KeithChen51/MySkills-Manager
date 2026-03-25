import { useMemo, useState } from "react";

import {
  setupGetSkillConflictDetail,
  setupLocalSkillsOverview,
  setupResolveSkillConflict,
  type LocalSkillsOverview,
  type SkillConflictDetail,
} from "../../api/tauri";
import {
  selectConflictSkillNames,
  summarizeConflictDetail,
} from "../../domain/skillConflict";
import type { MessageKey } from "../../i18n/messages";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

type Params = {
  onRefresh: () => void;
  t: Translate;
};

export type MissingSkillSource = {
  skillName: string;
  sourceId: string;
  sourceName: string;
};

function collectMissingSkillSources(overview: LocalSkillsOverview | null): MissingSkillSource[] {
  if (!overview) return [];
  const dedup = new Map<string, MissingSkillSource>();
  for (const tool of overview.tools) {
    for (const skill of tool.skills) {
      if (skill.inMySkills || skill.hashConflictsMySkills) {
        continue;
      }
      if (dedup.has(skill.name)) {
        continue;
      }
      dedup.set(skill.name, {
        skillName: skill.name,
        sourceId: tool.toolId,
        sourceName: tool.toolName,
      });
    }
  }
  return Array.from(dedup.values()).sort((left, right) =>
    left.skillName.localeCompare(right.skillName),
  );
}

function describeConflictDetail(detail: SkillConflictDetail, t: Translate) {
  const summary = summarizeConflictDetail(detail);

  if (!summary.hasBaseline) {
    return summary.totalSources > 0
      ? t("skills.conflict.status.noBaseline", { count: summary.totalSources })
      : t("skills.conflict.status.empty");
  }

  if (summary.conflictingCount === 0) {
    return summary.hiddenMatchedCount > 0
      ? t("skills.conflict.status.allMatched", { hidden: summary.hiddenMatchedCount })
      : t("skills.conflict.status.empty");
  }
  return summary.hiddenMatchedCount > 0
    ? t("skills.conflict.status.withHidden", {
        conflicts: summary.conflictingCount,
        hidden: summary.hiddenMatchedCount,
      })
    : t("skills.conflict.status.conflicts", { conflicts: summary.conflictingCount });
}

function buildOverviewSummary(overview: LocalSkillsOverview, t: Translate) {
  return t("skills.overview.summary", {
    total: overview.totalSkills,
    unique: overview.uniqueSkills,
    matched: overview.matchedInMySkills,
    missing: overview.missingInMySkills,
    conflict: overview.conflictWithMySkills,
  });
}

export function useSkillsPageController({ onRefresh, t }: Params) {
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [overviewSyncBusy, setOverviewSyncBusy] = useState(false);
  const [overviewSyncingSkillName, setOverviewSyncingSkillName] = useState<string | null>(null);
  const [overviewStatus, setOverviewStatus] = useState("");
  const [overview, setOverview] = useState<LocalSkillsOverview | null>(null);

  const [activeConflictSkill, setActiveConflictSkill] = useState<string | null>(null);
  const [conflictDetailBusy, setConflictDetailBusy] = useState(false);
  const [conflictResolveBusySource, setConflictResolveBusySource] = useState<string | null>(null);
  const [conflictStatus, setConflictStatus] = useState("");
  const [conflictDetail, setConflictDetail] = useState<SkillConflictDetail | null>(null);

  const conflictSkillNames = useMemo(() => {
    return selectConflictSkillNames(overview);
  }, [overview]);

  const missingSkillSources = useMemo(() => {
    return collectMissingSkillSources(overview);
  }, [overview]);

  async function handleLocalOverview() {
    setOverviewBusy(true);
    setOverviewStatus(t("skills.overview.scan.start"));
    try {
      const result = await setupLocalSkillsOverview();
      setOverview(result);
      if (result.tools.length === 0) {
        setOverviewStatus(t("skills.overview.scan.empty"));
      } else {
        const summary = buildOverviewSummary(result, t);
        setOverviewStatus(
          result.missingInMySkills > 0
            ? t("skills.overview.scan.needsSync", { summary })
            : result.conflictWithMySkills > 0
              ? t("skills.overview.scan.hasConflict", { summary })
              : t("skills.overview.scan.noChange", { summary }),
        );
      }
    } catch (e: unknown) {
      setOverviewStatus(String(e));
    } finally {
      setOverviewBusy(false);
    }
  }

  async function handleOpenConflictResolver(skillName: string) {
    if (!skillName) return;
    setActiveConflictSkill(skillName);
    setConflictDetailBusy(true);
    setConflictResolveBusySource(null);
    setConflictDetail(null);
    setConflictStatus(t("skills.conflict.load.start", { skill: skillName }));
    try {
      const detail = await setupGetSkillConflictDetail(skillName);
      setConflictDetail(detail);
      setConflictStatus(describeConflictDetail(detail, t));
    } catch (e: unknown) {
      setConflictStatus(String(e));
    } finally {
      setConflictDetailBusy(false);
    }
  }

  function handleCloseConflictResolver() {
    setActiveConflictSkill(null);
    setConflictDetail(null);
    setConflictResolveBusySource(null);
    setConflictStatus("");
  }

  async function refreshOverviewAfterSync() {
    const refreshedOverview = await setupLocalSkillsOverview();
    setOverview(refreshedOverview);
    onRefresh();
    return refreshedOverview;
  }

  async function handleSyncMissingSkill(source: MissingSkillSource) {
    if (!source.skillName || !source.sourceId) {
      return;
    }
    setOverviewSyncBusy(true);
    setOverviewSyncingSkillName(source.skillName);
    setOverviewStatus(
      t("skills.overview.sync.single.start", {
        skill: source.skillName,
        source: source.sourceName,
      }),
    );
    try {
      await setupResolveSkillConflict(source.skillName, source.sourceId);
      const refreshed = await refreshOverviewAfterSync();
      setOverviewStatus(
        t("skills.overview.sync.single.done", {
          skill: source.skillName,
          source: source.sourceName,
          missing: refreshed.missingInMySkills,
        }),
      );
    } catch (e: unknown) {
      setOverviewStatus(String(e));
    } finally {
      setOverviewSyncBusy(false);
      setOverviewSyncingSkillName(null);
    }
  }

  async function handleSyncAllMissingSkills() {
    if (missingSkillSources.length === 0) {
      setOverviewStatus(t("skills.overview.sync.none"));
      return;
    }

    setOverviewSyncBusy(true);
    setOverviewStatus(t("skills.overview.sync.start", { count: missingSkillSources.length }));

    let imported = 0;
    let failed = 0;
    let firstError = "";

    for (const source of missingSkillSources) {
      setOverviewSyncingSkillName(source.skillName);
      try {
        await setupResolveSkillConflict(source.skillName, source.sourceId);
        imported += 1;
      } catch (error: unknown) {
        failed += 1;
        if (!firstError) {
          firstError = String(error);
        }
      }
    }

    try {
      const refreshed = await refreshOverviewAfterSync();
      if (failed === 0) {
        setOverviewStatus(
          t("skills.overview.sync.done", {
            imported,
            detected: missingSkillSources.length,
            skipped: 0,
            missing: refreshed.missingInMySkills,
          }),
        );
      } else {
        setOverviewStatus(
          t("skills.overview.sync.partial", {
            imported,
            failed,
            missing: refreshed.missingInMySkills,
            error: firstError,
          }),
        );
      }
    } catch (e: unknown) {
      setOverviewStatus(String(e));
    } finally {
      setOverviewSyncBusy(false);
      setOverviewSyncingSkillName(null);
    }
  }

  async function handleResolveConflict(sourceId: string) {
    if (!conflictDetail) return;
    const source = conflictDetail.variants.find((variant) => variant.sourceId === sourceId);
    setConflictResolveBusySource(sourceId);
    setConflictStatus(
      t("skills.conflict.resolve.start", { source: source?.sourceName ?? sourceId }),
    );
    try {
      await setupResolveSkillConflict(conflictDetail.skillName, sourceId);
      const [detail, refreshedOverview] = await Promise.all([
        setupGetSkillConflictDetail(conflictDetail.skillName),
        setupLocalSkillsOverview(),
      ]);
      setConflictDetail(detail);
      setOverview(refreshedOverview);
      setConflictStatus(
        t("skills.conflict.resolve.done", {
          source: source?.sourceName ?? sourceId,
          detail: describeConflictDetail(detail, t),
        }),
      );
      onRefresh();
    } catch (e: unknown) {
      setConflictStatus(String(e));
    } finally {
      setConflictResolveBusySource(null);
    }
  }

  return {
    overviewBusy,
    overviewSyncBusy,
    overviewSyncingSkillName,
    overviewStatus,
    overview,
    missingSkillSources,
    conflictSkillNames,
    activeConflictSkill,
    conflictDetailBusy,
    conflictResolveBusySource,
    conflictStatus,
    conflictDetail,
    handleLocalOverview,
    handleSyncMissingSkill,
    handleSyncAllMissingSkills,
    handleOpenConflictResolver,
    handleCloseConflictResolver,
    handleResolveConflict,
  };
}

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
    overviewStatus,
    overview,
    conflictSkillNames,
    activeConflictSkill,
    conflictDetailBusy,
    conflictResolveBusySource,
    conflictStatus,
    conflictDetail,
    handleLocalOverview,
    handleOpenConflictResolver,
    handleCloseConflictResolver,
    handleResolveConflict,
  };
}

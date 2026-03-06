/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";

import type { SkillConflictDetail } from "../../api/tauri";
import { buildSkillDiff, type SkillDiffResult } from "../../domain/skillConflictDiff";

type ConflictVariant = SkillConflictDetail["variants"][number];

type WorkerResponse = {
  id: string;
  diff: SkillDiffResult;
};

const WORKER_DIFF_MIN_CHARS = 20_000;

export function useConflictDiffView(conflictDetail: SkillConflictDetail | null) {
  const [diffBySource, setDiffBySource] = useState<Record<string, SkillDiffResult>>({});
  const [computingDiff, setComputingDiff] = useState(false);

  const conflictData = useMemo(() => {
    if (!conflictDetail) {
      return {
        baseline: null as ConflictVariant | null,
        targets: [] as ConflictVariant[],
        hiddenMatchedCount: 0,
      };
    }

    const baseline =
      conflictDetail.variants.find((variant) => variant.sourceId === "my-skills") ?? null;
    if (!baseline) {
      return {
        baseline: null,
        targets: [...conflictDetail.variants],
        hiddenMatchedCount: 0,
      };
    }

    const targets = conflictDetail.variants.filter(
      (variant) => variant.sourceId !== "my-skills" && !variant.hashMatchesMySkills,
    );
    const hiddenMatchedCount = conflictDetail.variants.filter(
      (variant) => variant.sourceId !== "my-skills" && variant.hashMatchesMySkills,
    ).length;
    return { baseline, targets, hiddenMatchedCount };
  }, [conflictDetail]);

  const fingerprint = useMemo(() => {
    if (!conflictDetail) return "";
    return [
      conflictDetail.skillName,
      ...conflictDetail.variants.map(
        (variant) => `${variant.sourceId}:${variant.contentHash}:${variant.hashMatchesMySkills}`,
      ),
    ].join("|");
  }, [conflictDetail]);

  useEffect(() => {
    if (!conflictDetail) {
      setDiffBySource({});
      setComputingDiff(false);
      return;
    }

    const { baseline, targets } = conflictData;
    if (targets.length === 0) {
      setDiffBySource({});
      setComputingDiff(false);
      return;
    }

    let canceled = false;
    const baseContent = baseline?.content ?? conflictDetail.variants[0]?.content ?? "";
    const shouldUseWorker =
      typeof Worker !== "undefined" &&
      targets.some((variant) => baseContent.length + variant.content.length >= WORKER_DIFF_MIN_CHARS);

    const syncCompute = () => {
      const map: Record<string, SkillDiffResult> = {};
      for (const variant of targets) {
        map[variant.sourceId] = buildSkillDiff(baseContent, variant.content);
      }
      if (!canceled) {
        setDiffBySource(map);
        setComputingDiff(false);
      }
    };

    setDiffBySource({});
    setComputingDiff(true);

    if (!shouldUseWorker) {
      syncCompute();
      return () => {
        canceled = true;
      };
    }

    let pending = targets.length;
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("../../workers/skillDiff.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      syncCompute();
      return () => {
        canceled = true;
      };
    }

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (canceled) return;
      const { id, diff } = event.data;
      setDiffBySource((prev) => ({ ...prev, [id]: diff }));
      pending -= 1;
      if (pending <= 0) {
        setComputingDiff(false);
        worker?.terminate();
        worker = null;
      }
    };

    worker.onerror = () => {
      if (canceled) return;
      worker?.terminate();
      worker = null;
      syncCompute();
    };

    for (const variant of targets) {
      worker.postMessage({
        id: variant.sourceId,
        baseContent,
        incomingContent: variant.content,
      });
    }

    return () => {
      canceled = true;
      worker?.terminate();
    };
  }, [conflictData, conflictDetail, fingerprint]);

  const conflicts = useMemo(
    () =>
      conflictData.targets.map((variant) => ({
        variant,
        diff: diffBySource[variant.sourceId] ?? null,
      })),
    [conflictData.targets, diffBySource],
  );

  return {
    baseline: conflictData.baseline,
    hiddenMatchedCount: conflictData.hiddenMatchedCount,
    conflicts,
    computingDiff,
  };
}

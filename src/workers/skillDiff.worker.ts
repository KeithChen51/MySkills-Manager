/// <reference lib="webworker" />

import { buildSkillDiff, type SkillDiffResult } from "../domain/skillConflictDiff";

type DiffRequest = {
  id: string;
  baseContent: string;
  incomingContent: string;
  maxLines?: number;
};

type DiffResponse = {
  id: string;
  diff: SkillDiffResult;
};

self.onmessage = (event: MessageEvent<DiffRequest>) => {
  const { id, baseContent, incomingContent, maxLines } = event.data;
  const diff = buildSkillDiff(baseContent, incomingContent, maxLines);
  const response: DiffResponse = { id, diff };
  self.postMessage(response);
};

export {};

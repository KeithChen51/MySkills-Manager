export type SkillDiffLineKind = "context" | "removed" | "added";

export type SkillDiffLine = {
  kind: SkillDiffLineKind;
  text: string;
};

export type SkillDiffMode = "lcs" | "degraded";
export type SkillDiffDegradeReason = "input_limit" | "complexity_limit";

export type SkillDiffResult = {
  hasChanges: boolean;
  added: number;
  removed: number;
  lines: SkillDiffLine[];
  truncated: boolean;
  hiddenLineCount: number;
  mode: SkillDiffMode;
  degraded: boolean;
  degradeReason?: SkillDiffDegradeReason;
};

const DEFAULT_MAX_LINES = 280;
const MAX_INPUT_CHARS = 160_000;
const MAX_INPUT_LINES = 6_000;
const MAX_LCS_COMPLEXITY = 2_000_000;

function normalizeLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function applyLineLimit(
  allLines: SkillDiffLine[],
  added: number,
  removed: number,
  maxLines: number,
  mode: SkillDiffMode,
  degradeReason?: SkillDiffDegradeReason,
): SkillDiffResult {
  if (maxLines <= 0 || allLines.length <= maxLines) {
    return {
      hasChanges: added + removed > 0,
      added,
      removed,
      lines: allLines,
      truncated: false,
      hiddenLineCount: 0,
      mode,
      degraded: mode === "degraded",
      degradeReason,
    };
  }

  return {
    hasChanges: added + removed > 0,
    added,
    removed,
    lines: allLines.slice(0, maxLines),
    truncated: true,
    hiddenLineCount: allLines.length - maxLines,
    mode,
    degraded: mode === "degraded",
    degradeReason,
  };
}

function lcsTable(baseLines: string[], incomingLines: string[]): number[][] {
  const n = baseLines.length;
  const m = incomingLines.length;
  const table = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (baseLines[i] === incomingLines[j]) {
        table[i][j] = table[i + 1][j + 1] + 1;
      } else {
        table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
  }
  return table;
}

function buildLcsDiff(baseLines: string[], incomingLines: string[], maxLines: number): SkillDiffResult {
  const table = lcsTable(baseLines, incomingLines);

  const allLines: SkillDiffLine[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;

  while (i < baseLines.length && j < incomingLines.length) {
    if (baseLines[i] === incomingLines[j]) {
      allLines.push({ kind: "context", text: baseLines[i] });
      i += 1;
      j += 1;
      continue;
    }
    if (table[i + 1][j] >= table[i][j + 1]) {
      allLines.push({ kind: "removed", text: baseLines[i] });
      removed += 1;
      i += 1;
      continue;
    }
    allLines.push({ kind: "added", text: incomingLines[j] });
    added += 1;
    j += 1;
  }

  while (i < baseLines.length) {
    allLines.push({ kind: "removed", text: baseLines[i] });
    removed += 1;
    i += 1;
  }
  while (j < incomingLines.length) {
    allLines.push({ kind: "added", text: incomingLines[j] });
    added += 1;
    j += 1;
  }

  return applyLineLimit(allLines, added, removed, maxLines, "lcs");
}

function buildDegradedDiff(
  baseLines: string[],
  incomingLines: string[],
  maxLines: number,
  degradeReason: SkillDiffDegradeReason,
): SkillDiffResult {
  const allLines: SkillDiffLine[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;

  while (i < baseLines.length || j < incomingLines.length) {
    const left = i < baseLines.length ? baseLines[i] : undefined;
    const right = j < incomingLines.length ? incomingLines[j] : undefined;

    if (left !== undefined && right !== undefined) {
      if (left === right) {
        allLines.push({ kind: "context", text: left });
      } else {
        allLines.push({ kind: "removed", text: left });
        allLines.push({ kind: "added", text: right });
        removed += 1;
        added += 1;
      }
      i += 1;
      j += 1;
      continue;
    }

    if (left !== undefined) {
      allLines.push({ kind: "removed", text: left });
      removed += 1;
      i += 1;
      continue;
    }

    if (right !== undefined) {
      allLines.push({ kind: "added", text: right });
      added += 1;
      j += 1;
    }
  }

  return applyLineLimit(allLines, added, removed, maxLines, "degraded", degradeReason);
}

export function buildSkillDiff(
  baseContent: string,
  incomingContent: string,
  maxLines = DEFAULT_MAX_LINES,
): SkillDiffResult {
  const baseLines = normalizeLines(baseContent);
  const incomingLines = normalizeLines(incomingContent);

  const totalChars = baseContent.length + incomingContent.length;
  const totalLines = baseLines.length + incomingLines.length;
  const complexity = baseLines.length * incomingLines.length;

  if (totalChars > MAX_INPUT_CHARS || totalLines > MAX_INPUT_LINES) {
    return buildDegradedDiff(baseLines, incomingLines, maxLines, "input_limit");
  }

  if (complexity > MAX_LCS_COMPLEXITY) {
    return buildDegradedDiff(baseLines, incomingLines, maxLines, "complexity_limit");
  }

  return buildLcsDiff(baseLines, incomingLines, maxLines);
}

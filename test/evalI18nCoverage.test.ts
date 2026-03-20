import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const FILES = [
  "src/pages/eval/EvalSetup.tsx",
  "src/pages/eval/EvalRunning.tsx",
  "src/pages/eval/EvalResult.tsx",
  "src/pages/eval/EvalScorecard.tsx",
];

const LITERAL_PATTERN = /(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g;
const CJK_OR_EMOJI_PATTERN = /[\u3400-\u9fff\u{1f300}-\u{1faff}]/u;

function read(pathFromRoot: string) {
  return fs.readFileSync(path.resolve(process.cwd(), pathFromRoot), "utf8");
}

for (const file of FILES) {
  test(`${file} avoids hard-coded CJK/emoji literals in UI strings`, () => {
    const source = read(file);
    const flagged = Array.from(source.matchAll(LITERAL_PATTERN), (match) => match[0])
      .filter((literal) => CJK_OR_EMOJI_PATTERN.test(literal));

    assert.equal(
      flagged.length,
      0,
      `${file} still contains hard-coded localized literals: ${flagged.join(" | ")}`,
    );
  });
}

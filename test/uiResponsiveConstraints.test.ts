import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(pathFromRoot: string) {
  return fs.readFileSync(path.resolve(process.cwd(), pathFromRoot), "utf8");
}

function readPxToken(source: string, tokenName: string): number | null {
  const pattern = new RegExp(`${tokenName}:\\s*(\\d+)px;`);
  const match = source.match(pattern);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

test("Global control height token meets 44px minimum target size", () => {
  const source = read("src/styles/tokens.css");
  const controlHeight = readPxToken(source, "--control-height");

  assert.notEqual(
    controlHeight,
    null,
    "tokens.css should define --control-height",
  );
  assert.ok(
    (controlHeight ?? 0) >= 44,
    `--control-height should be >= 44px for touch accessibility, got ${controlHeight}px`,
  );
});

test("Core button and input primitives bind to control height token", () => {
  const source = read("src/styles/primitives.css");

  assert.match(
    source,
    /\.field-input,\s*\.filter-select[\s\S]*min-height:\s*var\(--control-height\)/,
    "form controls should derive min-height from --control-height",
  );
  assert.match(
    source,
    /\.btn[\s\S]*min-height:\s*var\(--control-height\)/,
    "button controls should derive min-height from --control-height",
  );
});

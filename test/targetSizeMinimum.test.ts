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

function readSelectorBlock(source: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`);
  const match = source.match(regex);
  return match?.[1] ?? null;
}

function readPxValueFromBlock(block: string, propertyName: string): number | null {
  const regex = new RegExp(`${propertyName}:\\s*([^;]+);`);
  const match = block.match(regex);
  if (!match) return null;
  const value = match[1].trim();
  if (value.includes("var(--control-height)")) {
    return controlHeight;
  }
  const pxMatch = value.match(/^(\d+)px$/);
  if (!pxMatch) return null;
  return Number.parseInt(pxMatch[1], 10);
}

const tokenSource = read("src/styles/tokens.css");
const controlHeight = readPxToken(tokenSource, "--control-height");

test("Global control height token is at least 44px", () => {
  assert.notEqual(controlHeight, null, "tokens.css should define --control-height");
  assert.ok(
    (controlHeight ?? 0) >= 44,
    `--control-height should be >= 44px for touch accessibility, got ${controlHeight}px`,
  );
});

test("Tools toggle switch hit-area is at least 44px tall", () => {
  const source = read("src/pages/ToolsPage.css");
  const block = readSelectorBlock(source, ".tool-switch");
  assert.ok(block, "ToolsPage.css should define .tool-switch");
  const explicitHeight = readPxValueFromBlock(block ?? "", "height");
  assert.ok(
    (explicitHeight ?? 0) >= 44,
    `.tool-switch height should be >= 44px, got ${explicitHeight ?? "missing"}px`,
  );
});

test("Skills insight window tabs have >=44px minimum touch target", () => {
  const source = read("src/pages/SkillsPage.css");
  const block = readSelectorBlock(source, ".skills-insight-window-btn");
  assert.ok(block, "SkillsPage.css should define .skills-insight-window-btn");
  const minHeight = readPxValueFromBlock(block ?? "", "min-height");
  assert.ok(
    (minHeight ?? 0) >= 44,
    `.skills-insight-window-btn min-height should be >= 44px, got ${minHeight ?? "missing"}px`,
  );
});

test("Git ignore tree expand/collapse affordance has >=44px hit-area", () => {
  const source = read("src/pages/GitPage.css");
  const block = source.match(/\.git-ignore-expand,\s*\.git-ignore-expand-placeholder\s*\{([\s\S]*?)\}/)?.[1] ?? null;
  assert.ok(block, "GitPage.css should define .git-ignore-expand/.git-ignore-expand-placeholder hit-area block");
  const height = readPxValueFromBlock(block ?? "", "height");
  const width = readPxValueFromBlock(block ?? "", "width");
  assert.ok(
    (height ?? 0) >= 44 && (width ?? 0) >= 44,
    `.git-ignore-expand hit-area should be >=44px; got ${width ?? "missing"}x${height ?? "missing"}px`,
  );
});

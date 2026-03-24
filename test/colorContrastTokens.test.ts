import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

type RgbColor = { r: number; g: number; b: number; a: number };

function read(pathFromRoot: string) {
  return fs.readFileSync(path.resolve(process.cwd(), pathFromRoot), "utf8");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractBlock(source: string, selector: string): string {
  const start = source.search(new RegExp(`${escapeRegExp(selector)}\\s*\\{`));
  assert.notEqual(start, -1, `Unable to find selector block: ${selector}`);

  const openBrace = source.indexOf("{", start);
  assert.notEqual(openBrace, -1, `Selector ${selector} should have an opening brace`);

  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBrace + 1, i);
    }
  }

  throw new Error(`Selector ${selector} block is not closed`);
}

function parseTokens(block: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

function parseColor(value: string): RgbColor {
  const color = value.trim().toLowerCase();

  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const expanded = color
      .slice(1)
      .split("")
      .map((char) => char + char)
      .join("");
    return parseColor(`#${expanded}`);
  }

  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return {
      r: Number.parseInt(color.slice(1, 3), 16),
      g: Number.parseInt(color.slice(3, 5), 16),
      b: Number.parseInt(color.slice(5, 7), 16),
      a: 1,
    };
  }

  const rgbMatch = color.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(",").map((part) => part.trim());
    assert.ok(parts.length === 3 || parts.length === 4, `Invalid rgb/rgba token: ${value}`);
    return {
      r: Number.parseFloat(parts[0]),
      g: Number.parseFloat(parts[1]),
      b: Number.parseFloat(parts[2]),
      a: parts.length === 4 ? Number.parseFloat(parts[3]) : 1,
    };
  }

  throw new Error(`Unsupported color format: ${value}`);
}

function blendColor(foreground: RgbColor, background: RgbColor): RgbColor {
  const alpha = foreground.a;
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
    a: 1,
  };
}

function toLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: RgbColor): number {
  const r = toLinear(color.r);
  const g = toLinear(color.g);
  const b = toLinear(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: RgbColor, background: RgbColor): number {
  const lumA = relativeLuminance(foreground);
  const lumB = relativeLuminance(background);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function resolveStatusBackground(tokens: Record<string, string>): RgbColor {
  const appBackground = parseColor(tokens["--bg-app"]);
  const statusBarBackground = blendColor(
    parseColor(tokens["--status-bar-bg"]),
    appBackground,
  );
  return blendColor({ ...statusBarBackground, a: 0.92 }, appBackground);
}

function resolveStateChipBackground(
  tokens: Record<string, string>,
  tokenName: "--success-bg" | "--danger-bg" | "--warning-bg",
): RgbColor {
  return blendColor(parseColor(tokens[tokenName]), parseColor(tokens["--bg-primary"]));
}

const tokenSource = read("src/styles/tokens.css");
const lightTokens = parseTokens(extractBlock(tokenSource, ":root"));
const darkTokens = parseTokens(extractBlock(tokenSource, ':root[data-theme="dark"]'));

test("Light theme muted text has at least 4.5:1 contrast in status bar", () => {
  const ratio = contrastRatio(
    parseColor(lightTokens["--text-muted"]),
    resolveStatusBackground(lightTokens),
  );
  assert.ok(
    ratio >= 4.5,
    `Expected light --text-muted contrast >= 4.5 in status bar, got ${ratio.toFixed(2)}`,
  );
});

test("Light theme success chip text contrast meets 4.5:1", () => {
  const ratio = contrastRatio(
    parseColor(lightTokens["--success"]),
    resolveStateChipBackground(lightTokens, "--success-bg"),
  );
  assert.ok(
    ratio >= 4.5,
    `Expected light --success contrast >= 4.5 on success chip background, got ${ratio.toFixed(2)}`,
  );
});

test("Light theme danger chip text contrast meets 4.5:1", () => {
  const ratio = contrastRatio(
    parseColor(lightTokens["--danger"]),
    resolveStateChipBackground(lightTokens, "--danger-bg"),
  );
  assert.ok(
    ratio >= 4.5,
    `Expected light --danger contrast >= 4.5 on danger chip background, got ${ratio.toFixed(2)}`,
  );
});

test("Light theme warning chip text contrast meets 4.5:1", () => {
  const ratio = contrastRatio(
    parseColor(lightTokens["--warning"]),
    resolveStateChipBackground(lightTokens, "--warning-bg"),
  );
  assert.ok(
    ratio >= 4.5,
    `Expected light --warning contrast >= 4.5 on warning chip background, got ${ratio.toFixed(2)}`,
  );
});

test("Dark theme muted text has at least 4.5:1 contrast in status bar", () => {
  const ratio = contrastRatio(
    parseColor(darkTokens["--text-muted"]),
    resolveStatusBackground(darkTokens),
  );
  assert.ok(
    ratio >= 4.5,
    `Expected dark --text-muted contrast >= 4.5 in status bar, got ${ratio.toFixed(2)}`,
  );
});

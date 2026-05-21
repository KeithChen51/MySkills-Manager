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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function toSrgbChannel(linear: number): number {
  const value = clamp01(linear);
  return value <= 0.0031308
    ? value * 12.92 * 255
    : (1.055 * value ** (1 / 2.4) - 0.055) * 255;
}

function parseOklch(value: string): RgbColor {
  const match = value.match(/^oklch\(([^)]+)\)$/);
  assert.ok(match, `Invalid oklch token: ${value}`);
  const parts = match[1].trim().split(/\s+/);
  assert.ok(parts.length >= 3, `Invalid oklch token: ${value}`);
  const lightness = parts[0].endsWith("%")
    ? Number.parseFloat(parts[0]) / 100
    : Number.parseFloat(parts[0]);
  const chroma = Number.parseFloat(parts[1]);
  const hueRadians = Number.parseFloat(parts[2]) * (Math.PI / 180);
  const a = chroma * Math.cos(hueRadians);
  const b = chroma * Math.sin(hueRadians);

  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;

  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;

  return {
    r: toSrgbChannel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: toSrgbChannel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: toSrgbChannel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: 1,
  };
}

function splitColorMixArgs(value: string): [string, string] {
  const args = value.replace(/^color-mix\(in\s+\w+,\s*/i, "").replace(/\)$/, "");
  let depth = 0;
  for (let i = 0; i < args.length; i += 1) {
    const char = args[i];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      return [args.slice(0, i).trim(), args.slice(i + 1).trim()];
    }
  }
  throw new Error(`Invalid color-mix token: ${value}`);
}

function parseColorStop(stop: string, tokens: Record<string, string>): RgbColor {
  const percentMatch = stop.match(/\s+([0-9.]+)%$/);
  const weight = percentMatch ? Number.parseFloat(percentMatch[1]) / 100 : 1;
  const colorValue = percentMatch ? stop.slice(0, percentMatch.index).trim() : stop.trim();
  if (colorValue === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const color = parseColor(colorValue, tokens);
  return { ...color, a: color.a * weight };
}

function parseColor(value: string, tokens: Record<string, string> = {}): RgbColor {
  const color = value.trim().toLowerCase();

  const varMatch = color.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (varMatch) {
    const resolved = tokens[varMatch[1]];
    assert.ok(resolved, `Unresolved color token: ${value}`);
    return parseColor(resolved, tokens);
  }

  if (color.startsWith("color-mix(")) {
    const [leftStop, rightStop] = splitColorMixArgs(color);
    const left = parseColorStop(leftStop, tokens);
    const right = parseColorStop(rightStop, tokens);
    const totalAlpha = left.a + right.a;
    if (totalAlpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (left.r * left.a + right.r * right.a) / totalAlpha,
      g: (left.g * left.a + right.g * right.a) / totalAlpha,
      b: (left.b * left.a + right.b * right.a) / totalAlpha,
      a: Math.min(1, totalAlpha),
    };
  }

  if (color.startsWith("oklch(")) {
    return parseOklch(color);
  }

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
  const appBackground = parseColor(tokens["--bg-app"], tokens);
  const statusBarBackground = blendColor(
    parseColor(tokens["--status-bar-bg"], tokens),
    appBackground,
  );
  return blendColor({ ...statusBarBackground, a: 0.92 }, appBackground);
}

function resolveStateChipBackground(
  tokens: Record<string, string>,
  tokenName: "--success-bg" | "--danger-bg" | "--warning-bg",
): RgbColor {
  return blendColor(parseColor(tokens[tokenName], tokens), parseColor(tokens["--bg-primary"], tokens));
}

const tokenSource = read("src/styles/tokens.css");
const lightTokens = parseTokens(extractBlock(tokenSource, ":root"));
const darkTokens = parseTokens(extractBlock(tokenSource, ':root[data-theme="dark"]'));

test("Light theme muted text has at least 4.5:1 contrast in status bar", () => {
  const ratio = contrastRatio(
    parseColor(lightTokens["--text-muted"], lightTokens),
    resolveStatusBackground(lightTokens),
  );
  assert.ok(
    ratio >= 4.5,
    `Expected light --text-muted contrast >= 4.5 in status bar, got ${ratio.toFixed(2)}`,
  );
});

test("Light theme success chip text contrast meets 4.5:1", () => {
  const ratio = contrastRatio(
    parseColor(lightTokens["--success"], lightTokens),
    resolveStateChipBackground(lightTokens, "--success-bg"),
  );
  assert.ok(
    ratio >= 4.5,
    `Expected light --success contrast >= 4.5 on success chip background, got ${ratio.toFixed(2)}`,
  );
});

test("Light theme danger chip text contrast meets 4.5:1", () => {
  const ratio = contrastRatio(
    parseColor(lightTokens["--danger"], lightTokens),
    resolveStateChipBackground(lightTokens, "--danger-bg"),
  );
  assert.ok(
    ratio >= 4.5,
    `Expected light --danger contrast >= 4.5 on danger chip background, got ${ratio.toFixed(2)}`,
  );
});

test("Light theme warning chip text contrast meets 4.5:1", () => {
  const ratio = contrastRatio(
    parseColor(lightTokens["--warning"], lightTokens),
    resolveStateChipBackground(lightTokens, "--warning-bg"),
  );
  assert.ok(
    ratio >= 4.5,
    `Expected light --warning contrast >= 4.5 on warning chip background, got ${ratio.toFixed(2)}`,
  );
});

test("Dark theme muted text has at least 4.5:1 contrast in status bar", () => {
  const ratio = contrastRatio(
    parseColor(darkTokens["--text-muted"], darkTokens),
    resolveStatusBackground(darkTokens),
  );
  assert.ok(
    ratio >= 4.5,
    `Expected dark --text-muted contrast >= 4.5 in status bar, got ${ratio.toFixed(2)}`,
  );
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");
}

test("tokens define visual hierarchy and rhythm primitives for low-priority polish", () => {
  const tokens = readSource("src/styles/tokens.css");
  assert.ok(
    tokens.includes("--type-display:"),
    "tokens should define a dedicated display type scale",
  );
  assert.ok(
    tokens.includes("--card-rhythm-gap:"),
    "tokens should define card rhythm spacing for consistent density",
  );
  assert.ok(
    tokens.includes("--chart-height-tall:") && tokens.includes("--chart-height-medium:"),
    "tokens should define chart height elasticity variables",
  );
});

test("shared primitives consume display type token for page title hierarchy", () => {
  const primitives = readSource("src/styles/primitives.css");
  assert.ok(
    primitives.includes("font-size: var(--type-display);"),
    "page title should consume display token instead of ad-hoc scale",
  );
});

test("dashboard chart heights are elastic via semantic tokens", () => {
  const dashboard = readSource("src/pages/DashboardPage.css");
  assert.ok(
    dashboard.includes("height: var(--chart-height-tall);"),
    "tall dashboard chart should use chart-height-tall token",
  );
  assert.ok(
    dashboard.includes("height: var(--chart-height-medium);"),
    "medium dashboard chart should use chart-height-medium token",
  );
});

test("SkillCard spacing rhythm is normalized to dedicated token", () => {
  const skillCard = readSource("src/components/SkillCard.css");
  assert.ok(
    skillCard.includes("gap: var(--card-rhythm-gap);"),
    "skill card should use card-rhythm-gap token for layout cadence",
  );
});

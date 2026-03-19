import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  formatTaxonomyGroupLabel,
  formatTaxonomyTagLabel,
  formatTaxonomyValueLabel,
} from "../src/domain/skillTaxonomyDisplay";

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");
}

test("taxonomy tag labels show Chinese + English for shape and anthropic category", () => {
  const shapeLabel = formatTaxonomyTagLabel("taxonomy:shape:markdown-only", true);
  assert.match(shapeLabel, /形态：/u);
  assert.match(shapeLabel, /纯 Markdown/u);
  assert.match(shapeLabel, /\(Markdown(?: &)? Only\)/u);

  const categoryLabel = formatTaxonomyTagLabel(
    "taxonomy:anthropic-category:workflow-automation",
    true,
  );
  assert.match(categoryLabel, /Anthropic 分类：/u);
  assert.match(categoryLabel, /工作流自动化/u);
  assert.match(categoryLabel, /\(Workflow Automation\)/u);
});

test("taxonomy value and group labels expose Chinese variants", () => {
  assert.equal(
    formatTaxonomyValueLabel("Software Engineering", true),
    "软件工程 (Software Engineering)",
  );
  assert.equal(
    formatTaxonomyGroupLabel("Natural-language × Workflow Automation", true),
    "自然语言 (Natural Language) × 工作流自动化 (Workflow Automation)",
  );
});

test("skills page and card use taxonomy display formatter for visible tags", () => {
  const skillsPageSource = readSource("src/pages/SkillsPage.tsx");
  assert.ok(
    skillsPageSource.includes("formatTaxonomyGroupLabel(") &&
      skillsPageSource.includes("formatTaxonomyTagLabel("),
    "SkillsPage should format taxonomy group labels and localized taxonomy search text",
  );

  const skillCardSource = readSource("src/components/SkillCard.tsx");
  assert.ok(
    skillCardSource.includes("formatTaxonomyTagLabel("),
    "SkillCard should render taxonomy tags with localized bilingual labels",
  );
});

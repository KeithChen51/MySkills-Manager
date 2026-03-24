import assert from "node:assert/strict";
import test from "node:test";

import {
  fromEditableDocument,
  toEditableDocument,
  type SkillDocument,
} from "../src/domain/skillDocument.ts";

test("toEditableDocument normalizes frontmatter fields", () => {
  const raw: SkillDocument = {
    frontmatter: {
      name: "code-review",
      description: "review code",
      category: "quality",
      tags: ["review", "quality"],
      my_notes: "before merge",
      last_updated: "2026-02-27",
      custom_flag: true,
    },
    body: "## Body\n",
  };

  const normalized = toEditableDocument(raw);

  assert.equal(normalized.frontmatter.name, "code-review");
  assert.deepEqual(normalized.frontmatter.tags, ["review", "quality"]);
  assert.equal(normalized.frontmatter.extra.custom_flag, true);
  assert.equal(normalized.body, "## Body\n");
});

test("fromEditableDocument serializes markdown with frontmatter and body", () => {
  const markdown = fromEditableDocument({
    frontmatter: {
      name: "planner",
      description: "plan tasks",
      category: "planning",
      tags: ["plan", "daily"],
      my_notes: "use daily",
      last_updated: "",
      extra: {
        custom_flag: true,
      },
    },
    body: "new body\n",
  });

  assert.match(markdown, /^---\n/);
  assert.match(markdown, /name:\s*"planner"/);
  assert.match(markdown, /custom_flag: true/);
  assert.match(markdown, /new body/);
});

test("fromEditableDocument keeps multiline and special frontmatter values", () => {
  const markdown = fromEditableDocument({
    frontmatter: {
      name: "special-skill",
      description: "line 1\nline 2",
      category: "ops",
      tags: ["a:b", "x#y"],
      my_notes: "quote: \"hello\"",
      last_updated: "2026-02-27",
      skillar_taxonomy: {
        sokRepresentation: "Natural-language",
        sokScope: "Single-tool",
      },
      extra: {
        nested: { env: "prod", enabled: true },
      },
    },
    body: "body\n",
  });

  assert.match(markdown, /description:/);
  assert.match(markdown, /line 1/);
  assert.match(markdown, /line 2/);
  assert.match(markdown, /nested:/);
  assert.match(markdown, /enabled: true/);
  assert.match(markdown, /skillar_taxonomy:/);
  assert.match(markdown, /sokRepresentation:/);
});

test("toEditableDocument preserves skillar_taxonomy outside extra fields", () => {
  const raw: SkillDocument = {
    frontmatter: {
      name: "tax-skill",
      description: "taxonomy-enabled",
      tags: ["alpha"],
      skillar_taxonomy: {
        sokRepresentation: "Tool macros",
        sokScope: "Multi-tool",
      },
    },
    body: "# Body\n",
  };

  const normalized = toEditableDocument(raw);
  assert.deepEqual(normalized.frontmatter.skillar_taxonomy, {
    sokRepresentation: "Tool macros",
    sokScope: "Multi-tool",
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(normalized.frontmatter.extra, "skillar_taxonomy"),
    false,
  );
});


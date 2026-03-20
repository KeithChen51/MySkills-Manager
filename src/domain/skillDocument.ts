import { stringify } from "yaml";

export type SkillDocument = {
  frontmatter: Record<string, unknown>;
  body: string;
};

export type EditableSkillFrontmatter = {
  name: string;
  description: string;
  category: string;
  tags: string[];
  skillar_taxonomy?: unknown;
  my_notes: string;
  last_updated: string;
  extra: Record<string, unknown>;
};

export type EditableSkillDocument = {
  frontmatter: EditableSkillFrontmatter;
  body: string;
};

const KNOWN_KEYS = new Set([
  "name",
  "description",
  "category",
  "tags",
  "skillar_taxonomy",
  "skillarTaxonomy",
  "my_notes",
  "last_updated",
]);
const TAXONOMY_TAG_PREFIX = "taxonomy:";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0)
    .filter((item) => !item.toLowerCase().startsWith(TAXONOMY_TAG_PREFIX));
}

export function toEditableDocument(raw: SkillDocument): EditableSkillDocument {
  const frontmatter = raw.frontmatter ?? {};
  const extra: Record<string, unknown> = {};
  const skillarTaxonomy = frontmatter.skillar_taxonomy ?? frontmatter.skillarTaxonomy;

  for (const [key, value] of Object.entries(frontmatter)) {
    if (!KNOWN_KEYS.has(key)) {
      extra[key] = value;
    }
  }

  return {
    frontmatter: {
      name: asString(frontmatter.name),
      description: asString(frontmatter.description),
      category: asString(frontmatter.category),
      tags: asTags(frontmatter.tags),
      skillar_taxonomy: skillarTaxonomy,
      my_notes: asString(frontmatter.my_notes),
      last_updated: asString(frontmatter.last_updated),
      extra,
    },
    body: raw.body ?? "",
  };
}

export function fromEditableDocument(doc: EditableSkillDocument): string {
  const meta = doc.frontmatter;
  const frontmatter: Record<string, unknown> = {};

  if (meta.name) frontmatter.name = meta.name;
  if (meta.description) frontmatter.description = meta.description;
  if (meta.category) frontmatter.category = meta.category;
  const manualTags = meta.tags.filter(
    (item) => item.trim().length > 0 && !item.toLowerCase().startsWith(TAXONOMY_TAG_PREFIX),
  );
  if (manualTags.length > 0) frontmatter.tags = manualTags;
  if (meta.skillar_taxonomy !== undefined) {
    frontmatter.skillar_taxonomy = meta.skillar_taxonomy;
  }
  if (meta.my_notes) frontmatter.my_notes = meta.my_notes;
  if (meta.last_updated) frontmatter.last_updated = meta.last_updated;

  const extraKeys = Object.keys(meta.extra).sort();
  for (const key of extraKeys) {
    const normalizedKey = key.replace(/[\s_-]/g, "").toLowerCase();
    if (normalizedKey === "skillartaxonomy") {
      continue;
    }
    frontmatter[key] = meta.extra[key];
  }

  const yaml = stringify(frontmatter, {
    defaultKeyType: "PLAIN",
    defaultStringType: "QUOTE_DOUBLE",
    lineWidth: 0,
  }).trimEnd();
  const normalizedBody = doc.body.replace(/\r\n/g, "\n").trimStart();
  return `---\n${yaml}\n---\n\n${normalizedBody}`;
}

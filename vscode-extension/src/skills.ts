import { constants as fsConstants } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface SkillItem {
  name: string;
  description: string;
  folderPath: string;
  skillMdPath: string;
}

export interface SkillFrontmatter {
  name: string;
  description: string;
}

const DEFAULT_SKILLS_ROOT = "~/my-skills";

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const first = trimmed.at(0);
  const last = trimmed.at(-1);
  if ((first === "'" && last === "'") || (first === "\"" && last === "\"")) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

export function parseSkillFrontmatter(markdown: string): SkillFrontmatter {
  const frontmatterMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch?.[1]) {
    return { name: "", description: "" };
  }

  let name = "";
  let description = "";

  for (const rawLine of frontmatterMatch[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1));

    if (key === "name" && !name) {
      name = value;
    } else if (key === "description" && !description) {
      description = value;
    }
  }

  return { name, description };
}

function expandHomePath(rawPath: string): string {
  if (rawPath === "~") {
    return os.homedir();
  }

  if (rawPath.startsWith("~/") || rawPath.startsWith("~\\")) {
    return path.join(os.homedir(), rawPath.slice(2));
  }

  return rawPath;
}

export function stripWindowsLongPathPrefix(rawPath: string): string {
  const normalized = rawPath.trim();
  if (normalized.startsWith("\\\\?\\UNC\\")) {
    return `\\\\${normalized.slice("\\\\?\\UNC\\".length)}`;
  }
  if (normalized.startsWith("\\\\?\\")) {
    return normalized.slice("\\\\?\\".length);
  }
  return normalized;
}

export function normalizeFileSystemPath(rawPath: string): string {
  return stripWindowsLongPathPrefix(rawPath.trim());
}

export function resolveSkillsRoot(configValue?: string): string {
  const value = configValue?.trim() || DEFAULT_SKILLS_ROOT;
  return normalizeFileSystemPath(path.resolve(expandHomePath(value)));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function scanSkills(rootPath: string): Promise<SkillItem[]> {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const result: SkillItem[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const folderPath = path.join(rootPath, entry.name);
    const skillMdPath = path.join(folderPath, "SKILL.md");
    if (!(await fileExists(skillMdPath))) {
      continue;
    }

    let markdown = "";
    try {
      markdown = await readFile(skillMdPath, "utf8");
    } catch {
      // If file cannot be read, include folder with fallback metadata.
    }

    const frontmatter = parseSkillFrontmatter(markdown);
    result.push({
      name: frontmatter.name || entry.name,
      description: frontmatter.description,
      folderPath,
      skillMdPath,
    });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseSkillFrontmatter,
  resolveSkillsRoot,
  scanSkills,
  stripWindowsLongPathPrefix,
} from "../src/skills";

test("parseSkillFrontmatter reads name and description", () => {
  const result = parseSkillFrontmatter(
    "---\nname: router\ndescription: route requests\n---\n## Body",
  );

  assert.equal(result.name, "router");
  assert.equal(result.description, "route requests");
});

test("parseSkillFrontmatter strips wrapping quotes", () => {
  const result = parseSkillFrontmatter(
    "---\nname: \"skill-a\"\ndescription: 'desc'\n---\nbody",
  );

  assert.equal(result.name, "skill-a");
  assert.equal(result.description, "desc");
});

test("scanSkills returns only directories containing SKILL.md", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillar-vscode-scan-"));
  const validSkillDir = path.join(tempRoot, "router");
  const ignoredDir = path.join(tempRoot, "draft");

  try {
    await mkdir(validSkillDir, { recursive: true });
    await mkdir(ignoredDir, { recursive: true });
    await writeFile(
      path.join(validSkillDir, "SKILL.md"),
      "---\nname: router\ndescription: route requests\n---\n## body\n",
    );
    await writeFile(path.join(ignoredDir, "notes.md"), "not a skill");

    const result = await scanSkills(tempRoot);

    assert.equal(result.length, 1);
    assert.equal(result[0]?.name, "router");
    assert.equal(result[0]?.description, "route requests");
    assert.equal(result[0]?.folderPath, validSkillDir);
    assert.equal(result[0]?.skillMdPath, path.join(validSkillDir, "SKILL.md"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("resolveSkillsRoot expands ~/ prefix", () => {
  const resolved = resolveSkillsRoot("~/my-skills");
  assert.equal(resolved, path.join(os.homedir(), "my-skills"));
});

test("stripWindowsLongPathPrefix removes \\\\?\\ prefix paths", () => {
  assert.equal(
    stripWindowsLongPathPrefix("\\\\?\\C:\\Users\\Keith\\my-skills"),
    "C:\\Users\\Keith\\my-skills",
  );
  assert.equal(
    stripWindowsLongPathPrefix("\\\\?\\UNC\\fileserver\\skills"),
    "\\\\fileserver\\skills",
  );
});

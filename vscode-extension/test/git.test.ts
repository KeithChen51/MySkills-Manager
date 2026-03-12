import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseGitLogOutput,
  parseGitStatusPorcelain,
  readManagedRepositoriesFromConfig,
} from "../src/git";

test("parseGitStatusPorcelain reads branch ahead behind and file groups", () => {
  const status = parseGitStatusPorcelain(
    [
      "## main...origin/main [ahead 2, behind 1]",
      " M README.md",
      "M  src/index.ts",
      "MM src/mixed.ts",
      "?? docs/new.md",
      "",
    ].join("\n"),
  );

  assert.equal(status.branch, "main");
  assert.equal(status.ahead, 2);
  assert.equal(status.behind, 1);
  assert.deepEqual(status.changed, ["README.md", "src/mixed.ts"]);
  assert.deepEqual(status.staged, ["src/index.ts", "src/mixed.ts"]);
  assert.deepEqual(status.untracked, ["docs/new.md"]);
});

test("parseGitLogOutput parses commit rows", () => {
  const output = [
    "a1b2c3d4e5f6\u001fa1b2c3d4\u001ffeat: add git dashboard\u001fKeith\u001f2026-03-12T12:00:00+08:00",
    "f1e2d3c4b5a6\u001ff1e2d3c4\u001ffix: improve open folder\u001fKeith\u001f2026-03-11T10:30:00+08:00",
  ].join("\n");
  const commits = parseGitLogOutput(output);

  assert.equal(commits.length, 2);
  assert.equal(commits[0]?.shortHash, "a1b2c3d4");
  assert.equal(commits[0]?.summary, "feat: add git dashboard");
  assert.equal(commits[1]?.authorName, "Keith");
});

test("readManagedRepositoriesFromConfig loads same repository list as desktop app", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "skillar-vscode-home-"));
  const configDir = path.join(tempHome, ".myskills-manager");
  const configFile = path.join(configDir, "git-repositories.json");

  try {
    await mkdir(configDir, { recursive: true });
    await writeFile(
      configFile,
      JSON.stringify(
        [
          {
            id: "repo-1",
            name: "my-skills",
            alias: "主仓库",
            url: "https://github.com/keith/my-skills.git",
            provider: "github",
            syncMode: "direct",
            sourcePath: "C:/Users/Keith/my-skills",
            localPath: "C:/Users/Keith/my-skills",
            isSyncing: false,
            lastSyncAt: null,
            lastSyncError: null,
            scriptAfterAdd: null,
            ignorePaths: [],
          },
        ],
        null,
        2,
      ),
      "utf8",
    );

    const repositories = await readManagedRepositoriesFromConfig(tempHome);
    assert.equal(repositories.length, 1);
    assert.equal(repositories[0]?.id, "repo-1");
    assert.equal(repositories[0]?.alias, "主仓库");
    assert.equal(repositories[0]?.localPath, "C:/Users/Keith/my-skills");
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGithubUploadAssetNames,
  parseGithubRepoSlug,
} from "../scripts/sync-github-release.mjs";

test("parseGithubRepoSlug extracts owner/repo from https url", () => {
  const slug = parseGithubRepoSlug("https://github.com/KeithChen51/MySkills-Manager.git");
  assert.equal(slug, "KeithChen51/MySkills-Manager");
});

test("parseGithubRepoSlug extracts owner/repo from ssh url", () => {
  const slug = parseGithubRepoSlug("git@github.com:KeithChen51/MySkills-Manager.git");
  assert.equal(slug, "KeithChen51/MySkills-Manager");
});

test("buildGithubUploadAssetNames includes updater essentials", () => {
  const assets = buildGithubUploadAssetNames({
    version: "0.1.9",
    launcherName: "Skillar.exe",
  });
  assert.deepEqual(assets, [
    "Skillar.exe",
    "Skillar_0.1.9_x64-setup.exe",
    "Skillar_0.1.9_x64-setup.exe.sig",
    "latest.json",
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWindowsLatestJson,
  chooseArchiveName,
  resolveGiteeReleaseBaseUrl,
  shouldExcludeFromSource,
} from "../scripts/prepare-gitee-package.mjs";

test("chooseArchiveName prioritizes explicit override", () => {
  const name = chooseArchiveName("0.1.3", "custom.zip");
  assert.equal(name, "custom.zip");
});

test("chooseArchiveName uses package version by default", () => {
  const name = chooseArchiveName("0.1.3");
  assert.equal(name, "MySkills-Manager-v0.1.3-source.zip");
});

test("shouldExcludeFromSource filters build and dependency outputs", () => {
  assert.equal(shouldExcludeFromSource("node_modules/a.txt"), true);
  assert.equal(shouldExcludeFromSource("dist/assets/index.js"), true);
  assert.equal(shouldExcludeFromSource("doc/guide.md"), true);
  assert.equal(shouldExcludeFromSource("docs/plan.md"), true);
  assert.equal(shouldExcludeFromSource("release/Skillar.exe"), true);
  assert.equal(shouldExcludeFromSource("src-tauri/target/release/app.exe"), true);
  assert.equal(shouldExcludeFromSource(".git/config"), true);
  assert.equal(shouldExcludeFromSource("src/main.tsx"), false);
  assert.equal(shouldExcludeFromSource("scripts/expose-skillar-exe.mjs"), false);
});

test("resolveGiteeReleaseBaseUrl prioritizes explicit base url", () => {
  const url = resolveGiteeReleaseBaseUrl("0.1.9", {
    explicitBaseUrl: "https://gitee.com/acme/tools/releases/download/v0.1.9",
    giteeRepo: "ignored/repo",
  });
  assert.equal(url, "https://gitee.com/acme/tools/releases/download/v0.1.9");
});

test("resolveGiteeReleaseBaseUrl derives from repo and version", () => {
  const url = resolveGiteeReleaseBaseUrl("0.1.9", {
    explicitBaseUrl: "",
    giteeRepo: "acme/tools",
  });
  assert.equal(url, "https://gitee.com/acme/tools/releases/download/v0.1.9");
});

test("buildWindowsLatestJson includes windows updater platform aliases", () => {
  const manifest = buildWindowsLatestJson({
    version: "0.1.9",
    notes: "Release notes",
    publishedAt: "2026-03-10T00:00:00.000Z",
    installerFileName: "Skillar_0.1.9_x64-setup.exe",
    signature: "MINISIGN-SIG",
    baseDownloadUrl: "https://gitee.com/acme/tools/releases/download/v0.1.9",
  });

  assert.equal(manifest.version, "0.1.9");
  assert.equal(manifest.notes, "Release notes");
  assert.equal(manifest.pub_date, "2026-03-10T00:00:00.000Z");
  assert.deepEqual(manifest.platforms["windows-x86_64"], {
    signature: "MINISIGN-SIG",
    url: "https://gitee.com/acme/tools/releases/download/v0.1.9/Skillar_0.1.9_x64-setup.exe",
  });
  assert.deepEqual(manifest.platforms["windows-x86_64-nsis"], {
    signature: "MINISIGN-SIG",
    url: "https://gitee.com/acme/tools/releases/download/v0.1.9/Skillar_0.1.9_x64-setup.exe",
  });
});

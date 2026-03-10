import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  chooseSetupExeName,
  syncReleaseArtifacts,
} from "../scripts/expose-skillar-exe.mjs";

test("chooseSetupExeName builds installer filename from package version", () => {
  assert.equal(chooseSetupExeName("0.1.8"), "Skillar_0.1.8_x64-setup.exe");
});

test("syncReleaseArtifacts copies latest artifacts and removes stale setup files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "myskills-expose-test-"));
  const projectRoot = path.join(tempRoot, "project");
  const releaseDir = path.join(projectRoot, "release");
  const sourceExe = path.join(projectRoot, "src-tauri", "target", "release", "app.exe");
  const nsisDir = path.join(projectRoot, "src-tauri", "target", "release", "bundle", "nsis");
  const latestSetupName = "Skillar_0.1.8_x64-setup.exe";
  const latestSetup = path.join(nsisDir, latestSetupName);
  const oldSetup = path.join(releaseDir, "Skillar_0.1.6_x64-setup.exe");

  try {
    await mkdir(path.dirname(sourceExe), { recursive: true });
    await mkdir(nsisDir, { recursive: true });
    await mkdir(releaseDir, { recursive: true });
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ version: "0.1.8" }));
    await writeFile(sourceExe, "new-app-binary");
    await writeFile(latestSetup, "new-setup-binary");
    await writeFile(oldSetup, "old-setup-binary");

    const result = await syncReleaseArtifacts({ projectRoot, releaseDir });

    const releaseExeContent = await readFile(result.targetExe, "utf8");
    const releaseSetupContent = await readFile(result.targetSetupExe, "utf8");
    assert.equal(releaseExeContent, "new-app-binary");
    assert.equal(releaseSetupContent, "new-setup-binary");

    await assert.rejects(() => readFile(oldSetup, "utf8"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

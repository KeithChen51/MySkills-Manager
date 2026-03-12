import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  copyVsixToTauriResources,
  getVsixResourcePaths,
} from "../scripts/prepare-vscode-vsix-resource.mjs";

test("build scripts prepare bundled VSIX resource before desktop build", async () => {
  const packageJsonRaw = await readFile(path.resolve(process.cwd(), "package.json"), "utf8");
  const packageJson = JSON.parse(packageJsonRaw) as { scripts?: Record<string, string> };
  const scripts = packageJson.scripts ?? {};

  assert.equal(
    scripts["vscode:resource"],
    "node scripts/prepare-vscode-vsix-resource.mjs",
  );
  assert.equal(
    scripts["build:desktop"],
    "npm run sync:tauri-icons && npm run vscode:resource && cargo tauri build",
  );
});

test("tauri config bundles VSIX resource file", async () => {
  const tauriConfigRaw = await readFile(
    path.resolve(process.cwd(), "src-tauri/tauri.conf.json"),
    "utf8",
  );
  const tauriConfig = JSON.parse(tauriConfigRaw) as {
    bundle?: { resources?: string[] };
  };
  const resources = tauriConfig.bundle?.resources ?? [];
  assert.ok(
    resources.includes("resources/skillar-vscode.vsix"),
    "tauri bundle.resources should include resources/skillar-vscode.vsix",
  );
});

test("copyVsixToTauriResources copies VSIX into src-tauri resources", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "myskills-vsix-resource-"));
  const releaseDir = path.join(tempRoot, "release");
  const resourcesDir = path.join(tempRoot, "src-tauri", "resources");

  try {
    await mkdir(releaseDir, { recursive: true });
    await mkdir(resourcesDir, { recursive: true });
    await writeFile(path.join(releaseDir, "skillar-vscode.vsix"), "vsix-binary");

    const result = await copyVsixToTauriResources({ projectRoot: tempRoot });

    const copied = await readFile(result.targetPath, "utf8");
    assert.equal(copied, "vsix-binary");
    assert.equal(result.sourcePath, path.join(releaseDir, "skillar-vscode.vsix"));
    assert.equal(result.targetPath, path.join(resourcesDir, "skillar-vscode.vsix"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("getVsixResourcePaths returns expected source and target paths", () => {
  const projectRoot = path.resolve("C:/demo/myskills-manager");
  const paths = getVsixResourcePaths(projectRoot);
  assert.equal(paths.sourcePath, path.join(projectRoot, "release", "skillar-vscode.vsix"));
  assert.equal(paths.targetPath, path.join(projectRoot, "src-tauri", "resources", "skillar-vscode.vsix"));
});

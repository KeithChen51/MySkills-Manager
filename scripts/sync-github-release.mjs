import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { chooseSetupExeName } from "./expose-skillar-exe.mjs";
import { buildWindowsLatestJson } from "./prepare-gitee-package.mjs";

const execFileAsync = promisify(execFile);

function normalizeRepoInput(value) {
  return String(value ?? "").trim();
}

export function parseGithubRepoSlug(input) {
  const raw = normalizeRepoInput(input);
  if (!raw) return "";

  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw)) {
    return raw;
  }

  const httpsMatch = raw.match(/^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i);
  if (httpsMatch?.[1]) {
    return httpsMatch[1];
  }

  const sshMatch = raw.match(/^git@github\.com:([^/\s]+\/[^/\s]+?)(?:\.git)?$/i);
  if (sshMatch?.[1]) {
    return sshMatch[1];
  }

  return "";
}

function resolveRepositoryFieldToSlug(repositoryField) {
  if (!repositoryField) return "";
  if (typeof repositoryField === "string") {
    return parseGithubRepoSlug(repositoryField);
  }
  if (typeof repositoryField === "object") {
    const candidate = repositoryField.url ?? repositoryField.git ?? repositoryField.repository;
    return parseGithubRepoSlug(candidate);
  }
  return "";
}

export function buildGithubUploadAssetNames({ version, launcherName = "Skillar.exe" }) {
  const setupExeName = chooseSetupExeName(version);
  return [
    launcherName,
    setupExeName,
    `${setupExeName}.sig`,
    "latest.json",
  ];
}

async function runGh(args, cwd) {
  try {
    const result = await execFileAsync("gh", args, {
      cwd,
      windowsHide: true,
    });
    return result;
  } catch (error) {
    const stderr = String(error?.stderr ?? "").trim();
    const stdout = String(error?.stdout ?? "").trim();
    const detail = stderr || stdout || String(error?.message ?? error);
    throw new Error(`gh ${args.join(" ")} failed: ${detail}`);
  }
}

async function ensureGhCliReady(projectRoot) {
  await runGh(["--version"], projectRoot);
}

async function ensureReleaseExists(projectRoot, { repoSlug, tagName, title, notes }) {
  try {
    await runGh(["release", "view", tagName, "--repo", repoSlug], projectRoot);
    return false;
  } catch {
    await runGh(
      ["release", "create", tagName, "--repo", repoSlug, "--title", title, "--notes", notes],
      projectRoot,
    );
    return true;
  }
}

async function ensurePathExists(filePath, hint) {
  try {
    await access(filePath);
  } catch {
    throw new Error(hint);
  }
}

async function readPackageManifest(projectRoot) {
  const packageJsonPath = path.join(projectRoot, "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  return JSON.parse(raw);
}

async function resolveInstallerArtifacts(projectRoot, version) {
  const setupExeName = chooseSetupExeName(version);
  const releaseDir = path.join(projectRoot, "release");
  const nsisDir = path.join(projectRoot, "src-tauri", "target", "release", "bundle", "nsis");

  const releaseSetupPath = path.join(releaseDir, setupExeName);
  const sourceSetupPath = path.join(nsisDir, setupExeName);
  const sourceSigPath = path.join(nsisDir, `${setupExeName}.sig`);
  const releaseSigPath = path.join(releaseDir, `${setupExeName}.sig`);

  await mkdir(releaseDir, { recursive: true });
  try {
    await access(releaseSetupPath);
  } catch {
    await ensurePathExists(
      sourceSetupPath,
      `Missing ${setupExeName}. Run \`npm run build:desktop:windows:update\` first.`,
    );
    await copyFile(sourceSetupPath, releaseSetupPath);
  }

  try {
    await access(releaseSigPath);
  } catch {
    await ensurePathExists(
      sourceSigPath,
      `Missing ${setupExeName}.sig. Ensure updater artifacts are generated with signing env.`,
    );
    await copyFile(sourceSigPath, releaseSigPath);
  }

  return {
    releaseDir,
    setupExeName,
    setupPath: releaseSetupPath,
    setupSigPath: releaseSigPath,
  };
}

async function writeGithubLatestJson(projectRoot, { repoSlug, version, setupExeName, setupSigPath }) {
  const releaseDir = path.join(projectRoot, "release");
  const latestJsonPath = path.join(releaseDir, "latest.json");
  const signature = (await readFile(setupSigPath, "utf8")).trim();
  if (!signature) {
    throw new Error(`Signature file is empty: ${setupSigPath}`);
  }

  const baseDownloadUrl = `https://github.com/${repoSlug}/releases/download/v${version}`;
  const payload = buildWindowsLatestJson({
    version,
    notes: `Release v${version}`,
    publishedAt: new Date().toISOString(),
    installerFileName: setupExeName,
    signature,
    baseDownloadUrl,
  });
  await writeFile(latestJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return latestJsonPath;
}

export async function syncGithubRelease(options = {}) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = options.projectRoot ?? path.resolve(__dirname, "..");
  const launcherName = options.launcherName ?? "Skillar.exe";

  const manifest = await readPackageManifest(projectRoot);
  const version = manifest.version ?? "0.0.0";
  const tagName = options.tagName ?? `v${version}`;
  const repoSlug =
    parseGithubRepoSlug(options.githubRepo) ||
    parseGithubRepoSlug(process.env.GITHUB_REPOSITORY) ||
    resolveRepositoryFieldToSlug(manifest.repository);

  if (!repoSlug) {
    throw new Error(
      "Cannot resolve GitHub repo slug. Set GITHUB_REPOSITORY or pass --repo owner/name.",
    );
  }

  const releaseDir = path.join(projectRoot, "release");
  const launcherPath = path.join(releaseDir, launcherName);
  await ensurePathExists(
    launcherPath,
    `Missing release/${launcherName}. Run \`npm run build:desktop:windows:update\` first.`,
  );

  const installer = await resolveInstallerArtifacts(projectRoot, version);
  const latestJsonPath = await writeGithubLatestJson(projectRoot, {
    repoSlug,
    version,
    setupExeName: installer.setupExeName,
    setupSigPath: installer.setupSigPath,
  });

  await ensureGhCliReady(projectRoot);
  await ensureReleaseExists(projectRoot, {
    repoSlug,
    tagName,
    title: `Skillar ${tagName}`,
    notes: `Release ${tagName}`,
  });

  const assetNames = buildGithubUploadAssetNames({ version, launcherName });
  const assetPaths = assetNames.map((name) => path.join(releaseDir, name));
  for (const filePath of assetPaths) {
    await ensurePathExists(filePath, `Missing upload asset: ${filePath}`);
  }

  await runGh(
    [
      "release",
      "upload",
      tagName,
      ...assetPaths,
      "--repo",
      repoSlug,
      "--clobber",
    ],
    projectRoot,
  );

  return {
    projectRoot,
    repoSlug,
    version,
    tagName,
    releaseDir,
    launcherPath,
    setupPath: installer.setupPath,
    setupSigPath: installer.setupSigPath,
    latestJsonPath,
  };
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const repoFlagIndex = process.argv.indexOf("--repo");
  const githubRepo =
    repoFlagIndex >= 0 && process.argv.length > repoFlagIndex + 1
      ? process.argv[repoFlagIndex + 1]
      : "";

  syncGithubRelease({ githubRepo })
    .then((result) => {
      console.log(`Synced GitHub release: ${result.repoSlug}@${result.tagName}`);
      console.log(`- launcher : ${result.launcherPath}`);
      console.log(`- setup    : ${result.setupPath}`);
      console.log(`- signature: ${result.setupSigPath}`);
      console.log(`- latest   : ${result.latestJsonPath}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}

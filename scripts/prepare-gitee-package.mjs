import { access, copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { chooseSetupExeName } from "./expose-skillar-exe.mjs";

const execFileAsync = promisify(execFile);

const EXCLUDED_PREFIXES = [
  ".git",
  "node_modules",
  "dist",
  "doc",
  "docs",
  "release",
  "src-tauri/target",
];

const EXCLUDED_FILES = new Set([
  "tauri-dev.log",
  "vite-dev.log",
]);

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function trimTrailingSlash(value) {
  return value.trim().replace(/\/+$/, "");
}

export function shouldExcludeFromSource(relativePath) {
  const normalized = normalizePath(relativePath).replace(/^\.\/+/, "");
  if (!normalized) {
    return false;
  }

  if (EXCLUDED_FILES.has(path.posix.basename(normalized))) {
    return true;
  }

  return EXCLUDED_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

export function chooseArchiveName(packageVersion, overrideName = "") {
  const override = (overrideName ?? "").trim();
  if (override) {
    return override;
  }
  return `MySkills-Manager-v${packageVersion}-source.zip`;
}

export function resolveGiteeReleaseBaseUrl(
  packageVersion,
  options = {},
) {
  const explicitBaseUrl = trimTrailingSlash(options.explicitBaseUrl ?? "");
  if (explicitBaseUrl) {
    return explicitBaseUrl;
  }

  const giteeRepo = normalizePath((options.giteeRepo ?? "").trim()).replace(/^\/+|\/+$/g, "");
  if (giteeRepo) {
    return `https://gitee.com/${giteeRepo}/releases/download/v${packageVersion}`;
  }

  return `https://gitee.com/<owner>/<repo>/releases/download/v${packageVersion}`;
}

export function buildWindowsLatestJson({
  version,
  notes,
  publishedAt,
  installerFileName,
  signature,
  baseDownloadUrl,
}) {
  const installerUrl = `${trimTrailingSlash(baseDownloadUrl)}/${encodeURIComponent(installerFileName)}`;
  const entry = {
    signature,
    url: installerUrl,
  };
  return {
    version,
    notes,
    pub_date: publishedAt,
    platforms: {
      "windows-x86_64": entry,
      "windows-x86_64-nsis": { ...entry },
    },
  };
}

async function collectSourceFiles(rootDir, currentDir = rootDir, output = []) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = normalizePath(path.relative(rootDir, fullPath));
    if (shouldExcludeFromSource(relativePath)) {
      continue;
    }
    if (entry.isDirectory()) {
      await collectSourceFiles(rootDir, fullPath, output);
      continue;
    }
    output.push(relativePath);
  }
  return output;
}

async function readPackageVersion(projectRoot) {
  const packageJsonPath = path.join(projectRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  return packageJson.version ?? "0.0.0";
}

async function findExistingArchives(giteeDir) {
  try {
    const entries = await readdir(giteeDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^MySkills-Manager-v.+-source\.zip$/.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function removeOldArchives(giteeDir, keepName) {
  const existing = await findExistingArchives(giteeDir);
  const removable = existing.filter((name) => name !== keepName);
  for (const name of removable) {
    await rm(path.join(giteeDir, name), { force: true });
  }
}

async function ensureFileExists(filePath, hint) {
  try {
    await access(filePath);
  } catch {
    throw new Error(hint);
  }
}

async function resolveFirstExistingPath(candidates, hint) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error(hint);
}

async function locateInstallerAndSignature(projectRoot, packageVersion) {
  const setupExeName = chooseSetupExeName(packageVersion);
  const releaseDir = path.join(projectRoot, "release");
  const nsisDir = path.join(projectRoot, "src-tauri", "target", "release", "bundle", "nsis");

  const setupExePath = await resolveFirstExistingPath(
    [
      path.join(releaseDir, setupExeName),
      path.join(nsisDir, setupExeName),
    ],
    `Missing ${setupExeName}. Run \`npm run build:desktop:windows:update\` first.`,
  );

  const signaturePath = await resolveFirstExistingPath(
    [
      `${setupExePath}.sig`,
      path.join(releaseDir, `${setupExeName}.sig`),
      path.join(nsisDir, `${setupExeName}.sig`),
    ],
    `Missing installer signature for ${setupExeName}. Ensure updater artifacts are enabled and build with signing env.`,
  );

  return {
    setupExeName,
    setupExePath,
    signaturePath,
  };
}

async function readSignatureFile(filePath) {
  const content = (await readFile(filePath, "utf8")).trim();
  if (!content) {
    throw new Error(`Signature file is empty: ${filePath}`);
  }
  return content;
}

async function createSourceArchive(projectRoot, giteeDir, archiveName) {
  const files = await collectSourceFiles(projectRoot);
  const stageRoot = await mkdtemp(path.join(os.tmpdir(), "myskills-gitee-pack-"));
  const stageProjectDir = path.join(stageRoot, "MySkills-Manager");
  await mkdir(stageProjectDir, { recursive: true });

  try {
    for (const relativePath of files) {
      const sourcePath = path.join(projectRoot, relativePath);
      const targetPath = path.join(stageProjectDir, relativePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
    }

    const archivePath = path.join(giteeDir, archiveName);
    await execFileAsync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${stageProjectDir.replace(/'/g, "''")}' -DestinationPath '${archivePath.replace(/'/g, "''")}' -Force`,
      ],
      { windowsHide: true },
    );
    return archivePath;
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

export async function prepareGiteePackage(options = {}) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = options.projectRoot ?? path.resolve(__dirname, "..");
  const workspaceRoot = path.resolve(projectRoot, "..");
  const giteeDir =
    options.giteeDir ??
    process.env.GITEE_SYNC_DIR ??
    path.join(workspaceRoot, "gitee-ver");
  const giteeRepo = options.giteeRepo ?? process.env.GITEE_REPO ?? "";
  const giteeReleaseBaseUrl = options.giteeReleaseBaseUrl ?? process.env.GITEE_RELEASE_BASE_URL ?? "";
  const releaseNotes = options.releaseNotes ?? process.env.GITEE_RELEASE_NOTES ?? "";
  const publishedAt = options.publishedAt ?? process.env.GITEE_PUBLISHED_AT ?? new Date().toISOString();
  const archiveNameOverride = options.archiveName ?? process.env.GITEE_SOURCE_ARCHIVE_NAME ?? "";

  const sourceExe = path.join(projectRoot, "release", "Skillar.exe");
  await ensureFileExists(
    sourceExe,
    "Missing release/Skillar.exe. Run `npm run build:desktop` first.",
  );

  await mkdir(giteeDir, { recursive: true });
  const packageVersion = await readPackageVersion(projectRoot);
  const archiveName = chooseArchiveName(packageVersion, archiveNameOverride);
  const { setupExeName, setupExePath, signaturePath } = await locateInstallerAndSignature(
    projectRoot,
    packageVersion,
  );
  const installerSignature = await readSignatureFile(signaturePath);

  const targetExe = path.join(giteeDir, "Skillar.exe");
  const targetSetupExe = path.join(giteeDir, setupExeName);
  const targetSetupSig = `${targetSetupExe}.sig`;
  await copyFile(sourceExe, targetExe);
  await copyFile(setupExePath, targetSetupExe);
  await copyFile(signaturePath, targetSetupSig);

  const updaterBaseUrl = resolveGiteeReleaseBaseUrl(packageVersion, {
    explicitBaseUrl: giteeReleaseBaseUrl,
    giteeRepo,
  });
  const latestJsonPath = path.join(giteeDir, "latest.json");
  const latestJson = buildWindowsLatestJson({
    version: packageVersion,
    notes: releaseNotes.trim() || `Release v${packageVersion}`,
    publishedAt,
    installerFileName: setupExeName,
    signature: installerSignature,
    baseDownloadUrl: updaterBaseUrl,
  });
  await writeFile(latestJsonPath, `${JSON.stringify(latestJson, null, 2)}\n`, "utf8");

  const archivePath = await createSourceArchive(projectRoot, giteeDir, archiveName);
  await removeOldArchives(giteeDir, archiveName);

  const readmePath = path.join(giteeDir, "README.md");
  const readmeExists = await stat(readmePath)
    .then(() => true)
    .catch(() => false);

  return {
    giteeDir,
    targetExe,
    targetSetupExe,
    targetSetupSig,
    latestJsonPath,
    updaterBaseUrl,
    usingPlaceholderUpdaterBaseUrl: updaterBaseUrl.includes("<owner>/<repo>"),
    archivePath,
    readmePath,
    readmeExists,
  };
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  prepareGiteePackage()
    .then((result) => {
      console.log(`Prepared Gitee package dir: ${result.giteeDir}`);
      console.log(`- Skillar.exe: ${result.targetExe}`);
      console.log(`- Setup exe  : ${result.targetSetupExe}`);
      console.log(`- Setup sig  : ${result.targetSetupSig}`);
      console.log(`- latest.json: ${result.latestJsonPath}`);
      console.log(`- Base URL   : ${result.updaterBaseUrl}`);
      if (result.usingPlaceholderUpdaterBaseUrl) {
        console.warn(
          "- Using placeholder updater base URL. Set GITEE_REPO or GITEE_RELEASE_BASE_URL for production updates.",
        );
      }
      console.log(`- Source zip : ${result.archivePath}`);
      if (!result.readmeExists) {
        console.warn(
          `- README.md missing in ${result.giteeDir}. You can add it to keep gitee-ver artifact list complete.`,
        );
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}

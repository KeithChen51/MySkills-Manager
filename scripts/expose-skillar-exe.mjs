import { mkdir, copyFile, access, readFile, readdir, rm, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function chooseSetupExeName(packageVersion) {
  return `Skillar_${packageVersion}_x64-setup.exe`;
}

async function ensureFileExists(filePath, hint) {
  try {
    await access(filePath);
  } catch {
    throw new Error(hint);
  }
}

async function readPackageVersion(projectRoot) {
  const packageJsonPath = path.join(projectRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  return packageJson.version ?? "0.0.0";
}

async function removeStaleSetupFiles(releaseDir, keepFileName) {
  let entries = [];
  try {
    entries = await readdir(releaseDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!/^Skillar_.+_x64-setup\.exe$/.test(entry.name)) {
      continue;
    }
    if (entry.name === keepFileName) {
      continue;
    }
    await rm(path.join(releaseDir, entry.name), { force: true });
  }
}

async function syncPortablePythonRuntime(projectRoot, releaseDir) {
  const sourcePyDir = path.join(projectRoot, "src-tauri", "py");
  const targetPyDir = path.join(releaseDir, "py");
  await ensureFileExists(
    sourcePyDir,
    "Missing src-tauri/py. Cannot prepare portable eval runtime.",
  );
  await rm(targetPyDir, { recursive: true, force: true });
  await cp(sourcePyDir, targetPyDir, { recursive: true, force: true });
  return targetPyDir;
}

export async function syncReleaseArtifacts(options = {}) {
  const projectRoot = options.projectRoot ?? path.resolve(__dirname, "..");
  const releaseDir = options.releaseDir ?? path.join(projectRoot, "release");
  const sourceExe = path.join(projectRoot, "src-tauri", "target", "release", "app.exe");

  await ensureFileExists(
    sourceExe,
    "Missing src-tauri/target/release/app.exe. Run `cargo tauri build` first.",
  );

  const packageVersion = await readPackageVersion(projectRoot);
  const setupExeName = chooseSetupExeName(packageVersion);
  const sourceSetupExe = path.join(
    projectRoot,
    "src-tauri",
    "target",
    "release",
    "bundle",
    "nsis",
    setupExeName,
  );

  await ensureFileExists(
    sourceSetupExe,
    `Missing src-tauri/target/release/bundle/nsis/${setupExeName}. Run \`cargo tauri build\` first.`,
  );

  await mkdir(releaseDir, { recursive: true });
  await removeStaleSetupFiles(releaseDir, setupExeName);

  const targetExe = path.join(releaseDir, "Skillar.exe");
  const targetSetupExe = path.join(releaseDir, setupExeName);
  const targetPyDir = await syncPortablePythonRuntime(projectRoot, releaseDir);

  await copyFile(sourceExe, targetExe);
  await copyFile(sourceSetupExe, targetSetupExe);

  return {
    projectRoot,
    packageVersion,
    releaseDir,
    targetExe,
    targetSetupExe,
    targetPyDir,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  syncReleaseArtifacts()
    .then((result) => {
      console.log(`Prepared launcher: ${result.targetExe}`);
      console.log(`Prepared portable py runtime: ${result.targetPyDir}`);
      console.log(`Prepared installer: ${result.targetSetupExe}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}

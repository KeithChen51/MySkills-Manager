import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function scriptDirectory() {
  return path.dirname(fileURLToPath(import.meta.url));
}

export function resolveProjectRoot() {
  return path.resolve(scriptDirectory(), "..");
}

export function getVsixResourcePaths(projectRoot = resolveProjectRoot()) {
  return {
    sourcePath: path.join(projectRoot, "release", "skillar-vscode.vsix"),
    targetPath: path.join(projectRoot, "src-tauri", "resources", "skillar-vscode.vsix"),
  };
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: false,
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}`));
    });
  });
}

export async function buildVsix(projectRoot = resolveProjectRoot()) {
  if (process.platform === "win32") {
    await runCommand(
      "cmd.exe",
      ["/d", "/s", "/c", "npm run package --prefix vscode-extension"],
      projectRoot,
    );
    return;
  }
  await runCommand("npm", ["run", "package", "--prefix", "vscode-extension"], projectRoot);
}

async function assertFileExists(filePath) {
  try {
    await access(filePath, fsConstants.R_OK);
  } catch {
    throw new Error(`VSIX file not found: ${filePath}`);
  }
}

export async function copyVsixToTauriResources({ projectRoot = resolveProjectRoot() } = {}) {
  const { sourcePath, targetPath } = getVsixResourcePaths(projectRoot);
  await assertFileExists(sourcePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
  return { sourcePath, targetPath };
}

export async function prepareBundledVsixResource({ projectRoot = resolveProjectRoot() } = {}) {
  await buildVsix(projectRoot);
  return copyVsixToTauriResources({ projectRoot });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = await prepareBundledVsixResource();
  console.log(`[vscode:resource] copied ${result.sourcePath} -> ${result.targetPath}`);
}

import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { normalizeFileSystemPath, resolveSkillsRoot } from "./skills";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 20_000;
const GIT_LOG_SEPARATOR = "\u001f";

export interface GitCommitItem {
  hash: string;
  shortHash: string;
  summary: string;
  authorName: string;
  authoredAt: string;
}

export interface GitOverview {
  repoPath: string;
  branch: string;
  ahead: number;
  behind: number;
  changed: string[];
  staged: string[];
  untracked: string[];
  recentCommits: GitCommitItem[];
}

export type GitRepositoryProvider = "github" | "gitlab" | "gitee" | "other";
export type GitRepositorySyncMode = "direct" | "mirror";

export interface ManagedGitRepository {
  id: string;
  name: string;
  alias?: string;
  url: string;
  provider: GitRepositoryProvider;
  syncMode: GitRepositorySyncMode;
  sourcePath: string;
  localPath: string;
  isSyncing: boolean;
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
  scriptAfterAdd?: string | null;
  ignorePaths: string[];
}

export interface ParsedGitStatus {
  branch: string;
  ahead: number;
  behind: number;
  changed: string[];
  staged: string[];
  untracked: string[];
}

function resolveHomeDirectory(explicitHome?: string): string {
  const normalizedExplicit = explicitHome?.trim();
  if (normalizedExplicit) {
    return normalizeFileSystemPath(path.resolve(normalizedExplicit));
  }
  if (process.env.HOME?.trim()) {
    return normalizeFileSystemPath(path.resolve(process.env.HOME));
  }
  if (process.env.USERPROFILE?.trim()) {
    return normalizeFileSystemPath(path.resolve(process.env.USERPROFILE));
  }
  return normalizeFileSystemPath(path.resolve(os.homedir()));
}

function managedRepositoriesConfigPath(explicitHome?: string): string {
  return path.join(resolveHomeDirectory(explicitHome), ".myskills-manager", "git-repositories.json");
}

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeRepositoryProvider(raw: unknown): GitRepositoryProvider {
  if (raw === "github" || raw === "gitlab" || raw === "gitee" || raw === "other") {
    return raw;
  }
  return "other";
}

function normalizeRepositorySyncMode(raw: unknown): GitRepositorySyncMode {
  if (raw === "direct" || raw === "mirror") {
    return raw;
  }
  return "mirror";
}

function normalizeManagedRepositoryRecord(
  raw: unknown,
  defaultSourcePath: string,
): ManagedGitRepository | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as {
    id?: unknown;
    name?: unknown;
    alias?: unknown;
    url?: unknown;
    provider?: unknown;
    syncMode?: unknown;
    sourcePath?: unknown;
    localPath?: unknown;
    isSyncing?: unknown;
    lastSyncAt?: unknown;
    lastSyncError?: unknown;
    scriptAfterAdd?: unknown;
    ignorePaths?: unknown;
  };

  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
  const localPathRaw = typeof candidate.localPath === "string" ? candidate.localPath.trim() : "";

  if (!id || !name || !url || !localPathRaw) {
    return null;
  }

  const sourcePathRaw = typeof candidate.sourcePath === "string"
    ? candidate.sourcePath.trim()
    : "";

  return {
    id,
    name,
    alias: typeof candidate.alias === "string" && candidate.alias.trim()
      ? candidate.alias.trim()
      : undefined,
    url,
    provider: normalizeRepositoryProvider(candidate.provider),
    syncMode: normalizeRepositorySyncMode(candidate.syncMode),
    sourcePath: normalizeFileSystemPath(sourcePathRaw || defaultSourcePath),
    localPath: normalizeFileSystemPath(localPathRaw),
    isSyncing: candidate.isSyncing === true,
    lastSyncAt: typeof candidate.lastSyncAt === "string" ? candidate.lastSyncAt : null,
    lastSyncError: typeof candidate.lastSyncError === "string" ? candidate.lastSyncError : null,
    scriptAfterAdd: typeof candidate.scriptAfterAdd === "string" ? candidate.scriptAfterAdd : null,
    ignorePaths: Array.isArray(candidate.ignorePaths)
      ? candidate.ignorePaths.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export async function readManagedRepositoriesFromConfig(
  explicitHome?: string,
  defaultSourcePath = "~/my-skills",
): Promise<ManagedGitRepository[]> {
  const configPath = managedRepositoriesConfigPath(explicitHome);
  if (!(await isReadableFile(configPath))) {
    return [];
  }

  const raw = await readFile(configPath, "utf8");
  if (!raw.trim()) {
    return [];
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Managed repository config should be an array: ${configPath}`);
  }

  const normalizedDefaultSource = resolveSkillsRoot(defaultSourcePath);
  return parsed
    .map((item) => normalizeManagedRepositoryRecord(item, normalizedDefaultSource))
    .filter((item): item is ManagedGitRepository => Boolean(item))
    .sort((a, b) => {
      const nameA = (a.alias || a.name).toLowerCase();
      const nameB = (b.alias || b.name).toLowerCase();
      return nameA.localeCompare(nameB);
    });
}

function formatGitError(repoPath: string, args: string[], error: unknown): string {
  const command = `git -C "${repoPath}" ${args.join(" ")}`;
  if (typeof error !== "object" || !error) {
    return `Git 命令执行失败: ${command}`;
  }
  const candidate = error as {
    message?: string;
    stdout?: string | Buffer;
    stderr?: string | Buffer;
  };
  const message = candidate.message || "未知错误";
  const stdout = typeof candidate.stdout === "string"
    ? candidate.stdout.trim()
    : "";
  const stderr = typeof candidate.stderr === "string"
    ? candidate.stderr.trim()
    : "";
  const detail = [message, stdout, stderr].filter(Boolean).join(" | ");
  return `Git 命令执行失败: ${command} | ${detail}`;
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  const normalizedPath = normalizeFileSystemPath(repoPath);
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", normalizedPath, ...args],
      {
        windowsHide: true,
        encoding: "utf8",
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    return typeof stdout === "string" ? stdout : "";
  } catch (error) {
    throw new Error(formatGitError(normalizedPath, args, error));
  }
}

function parseBranchHeader(header: string): {
  branch: string;
  ahead: number;
  behind: number;
} {
  const trimmed = header.trim();
  const trackedPart = trimmed.split("...", 2);
  const branch = trackedPart[0]?.trim() || "HEAD";

  let ahead = 0;
  let behind = 0;
  const aheadMatch = trimmed.match(/ahead (\d+)/i);
  if (aheadMatch?.[1]) {
    ahead = Number.parseInt(aheadMatch[1], 10) || 0;
  }
  const behindMatch = trimmed.match(/behind (\d+)/i);
  if (behindMatch?.[1]) {
    behind = Number.parseInt(behindMatch[1], 10) || 0;
  }

  return { branch, ahead, behind };
}

function finalizeSortedList(values: Set<string>): string[] {
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

export function parseGitStatusPorcelain(raw: string): ParsedGitStatus {
  let branch = "HEAD";
  let ahead = 0;
  let behind = 0;
  const changed = new Set<string>();
  const staged = new Set<string>();
  const untracked = new Set<string>();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (line.startsWith("## ")) {
      const parsed = parseBranchHeader(line.slice(3));
      branch = parsed.branch;
      ahead = parsed.ahead;
      behind = parsed.behind;
      continue;
    }

    if (line.length < 4) {
      continue;
    }

    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    const target = line.slice(3).trim();
    if (!target) {
      continue;
    }

    if (x === "?" && y === "?") {
      untracked.add(target);
      continue;
    }

    if (x === "!" && y === "!") {
      continue;
    }

    if (x !== " " && x !== "?") {
      staged.add(target);
    }
    if (y !== " " && y !== "?") {
      changed.add(target);
    }
  }

  return {
    branch,
    ahead,
    behind,
    changed: finalizeSortedList(changed),
    staged: finalizeSortedList(staged),
    untracked: finalizeSortedList(untracked),
  };
}

export function parseGitLogOutput(raw: string): GitCommitItem[] {
  const result: GitCommitItem[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const [hash, shortHash, summary, authorName, authoredAt] = line.split(GIT_LOG_SEPARATOR);
    if (!hash || !shortHash || !summary) {
      continue;
    }
    result.push({
      hash: hash.trim(),
      shortHash: shortHash.trim(),
      summary: summary.trim(),
      authorName: (authorName || "").trim(),
      authoredAt: (authoredAt || "").trim(),
    });
  }
  return result;
}

export async function readGitOverview(skillsRoot: string): Promise<GitOverview> {
  const repoPath = normalizeFileSystemPath(
    (await runGit(skillsRoot, ["rev-parse", "--show-toplevel"])).trim(),
  );

  const statusRaw = await runGit(repoPath, ["status", "--porcelain=1", "--branch"]);
  const parsedStatus = parseGitStatusPorcelain(statusRaw);
  const logRaw = await runGit(
    repoPath,
    [
      "log",
      "--max-count=12",
      `--pretty=format:%H${GIT_LOG_SEPARATOR}%h${GIT_LOG_SEPARATOR}%s${GIT_LOG_SEPARATOR}%an${GIT_LOG_SEPARATOR}%aI`,
    ],
  );

  return {
    repoPath,
    branch: parsedStatus.branch,
    ahead: parsedStatus.ahead,
    behind: parsedStatus.behind,
    changed: parsedStatus.changed,
    staged: parsedStatus.staged,
    untracked: parsedStatus.untracked,
    recentCommits: parseGitLogOutput(logRaw),
  };
}

export async function commitAllChanges(skillsRoot: string, message: string): Promise<string> {
  const commitMessage = message.trim();
  if (!commitMessage) {
    throw new Error("提交信息不能为空。");
  }

  const repoPath = normalizeFileSystemPath(
    (await runGit(skillsRoot, ["rev-parse", "--show-toplevel"])).trim(),
  );
  await runGit(repoPath, ["add", "-A"]);
  await runGit(repoPath, ["commit", "-m", commitMessage]);
  return (await runGit(repoPath, ["rev-parse", "--short", "HEAD"])).trim();
}

export async function pushRepository(skillsRoot: string): Promise<void> {
  const repoPath = normalizeFileSystemPath(
    (await runGit(skillsRoot, ["rev-parse", "--show-toplevel"])).trim(),
  );
  await runGit(repoPath, ["push"]);
}

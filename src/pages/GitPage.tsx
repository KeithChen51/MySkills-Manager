import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { siGitee, siGithub, siGitlab } from "simple-icons";

import {
  gitAddRepository,
  gitCommit,
  gitGetGuideMarkdown,
  gitListCommitHistory,
  gitListRepositories,
  gitOpenDirectory,
  gitOpenUrl,
  gitPush,
  gitRemoveRepository,
  gitListSyncTree,
  gitUpdateRepositoryIgnoredPaths,
  gitUpdateRepositorySyncPath,
  gitUpdateRepositoryAlias,
  gitSyncSkillsToRepo,
  gitSyncSourcePath,
  gitStatus,
  type GitAddRepositoryOptions,
  type GitGraphCommit,
  type GitManagedRepository,
  type GitSyncTreeEntry,
  type GitSyncMode,
  type GitStatus,
} from "../api/tauri";
import { useI18n } from "../i18n/I18nProvider";
import "./GitPage.css";

function inferRepositoryName(url: string): string {
  const normalized = url.trim().replace(/\/+$/, "");
  if (!normalized) return "repository";
  const noDotGit = normalized.endsWith(".git") ? normalized.slice(0, -4) : normalized;
  const segments = noDotGit.split(/[/:]/).filter(Boolean);
  return segments[segments.length - 1] ?? "repository";
}

function inferRepositoryProvider(url: string): GitManagedRepository["provider"] {
  const normalized = url.trim().toLowerCase();
  if (normalized.includes("github.com")) return "github";
  if (normalized.includes("gitee.com")) return "gitee";
  if (normalized.includes("gitlab.com") || normalized.includes("gitlab.")) return "gitlab";
  return "other";
}

const providerIcons: Record<GitManagedRepository["provider"], { path: string; hex: string } | undefined> = {
  github: siGithub,
  gitlab: siGitlab,
  gitee: siGitee,
  other: undefined,
};

function normalizeRepositoryWebUrl(rawUrl: string): string | null {
  const value = rawUrl.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    return value.replace(/\.git$/i, "").replace(/\/+$/, "");
  }

  const sshMatch = value.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    const host = sshMatch[1];
    const path = sshMatch[2].replace(/\.git$/i, "");
    return `https://${host}/${path}`.replace(/\/+$/, "");
  }

  const sshProtocolMatch = value.match(/^ssh:\/\/git@([^/]+)\/(.+)$/i);
  if (sshProtocolMatch) {
    const host = sshProtocolMatch[1];
    const path = sshProtocolMatch[2].replace(/\.git$/i, "");
    return `https://${host}/${path}`.replace(/\/+$/, "");
  }

  return null;
}

function buildCommitDetailUrl(repository: GitManagedRepository, hash: string): string | null {
  const base = normalizeRepositoryWebUrl(repository.url);
  if (!base || !hash.trim()) return null;
  if (repository.provider === "gitlab") {
    return `${base}/-/commit/${hash}`;
  }
  return `${base}/commit/${hash}`;
}

function buildCommitGraphUrl(repository: GitManagedRepository, branch: string): string | null {
  const base = normalizeRepositoryWebUrl(repository.url);
  if (!base) return null;
  const branchPart = branch.trim() && branch !== "HEAD" ? `/${encodeURIComponent(branch)}` : "";
  if (repository.provider === "gitlab") {
    return `${base}/-/commits${branchPart}`;
  }
  return `${base}/commits${branchPart}`;
}

function formatCommitTime(value: string): string {
  if (!value.trim()) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

const GRAPH_LANE_WIDTH = 18;
const GRAPH_ROW_HEIGHT = 34;
const GRAPH_NODE_Y = 13;

type GitGraphRow = GitGraphCommit & {
  lane: number;
  laneCount: number;
  beforeLanes: string[];
  afterLanes: string[];
  parentLanes: number[];
};

function dedupeLaneHashes(lanes: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const hash of lanes) {
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    output.push(hash);
  }
  return output;
}

function buildCommitGraphRows(commits: GitGraphCommit[]): GitGraphRow[] {
  const rows: GitGraphRow[] = [];
  let lanes: string[] = [];

  for (const commit of commits) {
    let lane = lanes.indexOf(commit.hash);
    if (lane < 0) {
      lane = lanes.length;
      lanes = [...lanes, commit.hash];
    }

    const beforeLanes = [...lanes];
    const parentHashes = commit.parent_hashes.filter((hash) => hash.trim().length > 0);

    lanes.splice(lane, 1);
    if (parentHashes.length > 0) {
      lanes.splice(lane, 0, parentHashes[0]);
      for (let index = 1; index < parentHashes.length; index += 1) {
        lanes.splice(lane + index, 0, parentHashes[index]);
      }
    }

    lanes = dedupeLaneHashes(lanes);
    const afterLanes = [...lanes];
    const parentLanes = parentHashes.map((hash) => afterLanes.indexOf(hash)).filter((index) => index >= 0);
    const laneCount = Math.max(
      1,
      beforeLanes.length,
      afterLanes.length,
      lane + 1,
      ...parentLanes.map((index) => index + 1),
    );

    rows.push({
      ...commit,
      lane,
      laneCount,
      beforeLanes,
      afterLanes,
      parentLanes,
    });
  }

  return rows;
}

type GitViewMode = "overview" | "detail";
type GuideBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language: string; code: string };

function parseGuideMarkdown(markdown: string): GuideBlock[] {
  const blocks: GuideBlock[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const paragraphLines: string[] = [];
  const listItems: string[] = [];
  let listOrdered: boolean | null = null;
  let codeLanguage = "";
  let codeLines: string[] | null = null;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ").trim() });
    paragraphLines.length = 0;
  };

  const flushList = () => {
    if (listItems.length === 0 || listOrdered === null) return;
    blocks.push({ type: "list", ordered: listOrdered, items: [...listItems] });
    listItems.length = 0;
    listOrdered = null;
  };

  const flushCode = () => {
    if (!codeLines) return;
    blocks.push({
      type: "code",
      language: codeLanguage,
      code: codeLines.join("\n"),
    });
    codeLanguage = "";
    codeLines = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (codeLines) {
      if (trimmed.startsWith("```")) {
        flushCode();
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (trimmed.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      codeLanguage = trimmed.slice(3).trim();
      codeLines = [];
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2].trim(),
      });
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listOrdered === false) flushList();
      listOrdered = true;
      listItems.push(orderedMatch[1].trim());
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      if (listOrdered === true) flushList();
      listOrdered = false;
      listItems.push(bulletMatch[1].trim());
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushCode();
  return blocks;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const output: ReactNode[] = [];
  const pattern = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let tokenIndex = 0;
  let match = pattern.exec(text);

  while (match) {
    if (match.index > lastIndex) {
      output.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `token-${tokenIndex++}`;

    if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        output.push(
          <a key={key} href={linkMatch[2]} target="_blank" rel="noreferrer">
            {linkMatch[1]}
          </a>,
        );
      } else {
        output.push(token);
      }
    } else if (token.startsWith("`")) {
      output.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      output.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      output.push(token);
    }

    lastIndex = pattern.lastIndex;
    match = pattern.exec(text);
  }

  if (lastIndex < text.length) {
    output.push(text.slice(lastIndex));
  }

  return output;
}

function repositoryDisplayName(repo: GitManagedRepository): string {
  return repo.alias?.trim() || repo.name;
}

function normalizeIgnoreRule(value: string): string {
  const raw = value.trim().replace(/\\/g, "/");
  const hasDirSuffix = raw.endsWith("/");
  const normalized = raw.replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "");
  if (!normalized) return "";
  return hasDirSuffix ? `${normalized}/` : normalized;
}

function sortIgnoreRules(paths: string[]): string[] {
  return Array.from(new Set(paths.map(normalizeIgnoreRule).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

function ignoreRuleForEntry(entry: GitSyncTreeEntry): string {
  return entry.entryType === "dir" ? `${entry.relativePath}/` : entry.relativePath;
}

export default function GitPage() {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<GitViewMode>("overview");
  const [showAddForm, setShowAddForm] = useState(false);

  const [repositories, setRepositories] = useState<GitManagedRepository[]>([]);
  const [loadingRepositories, setLoadingRepositories] = useState(false);
  const [repositoryStatus, setRepositoryStatus] = useState("");
  const [selectedRepoId, setSelectedRepoId] = useState("");

  const [syncSourcePath, setSyncSourcePath] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [syncMode, setSyncMode] = useState<GitSyncMode>("direct");
  const [syncPathInput, setSyncPathInput] = useState("");
  const [repoAliasInput, setRepoAliasInput] = useState("");
  const [postAddScript, setPostAddScript] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideLoading, setGuideLoading] = useState(false);
  const [guidePath, setGuidePath] = useState("");
  const [guideMarkdown, setGuideMarkdown] = useState("");
  const [guideError, setGuideError] = useState("");

  const [addingRepository, setAddingRepository] = useState(false);
  const [removingRepositoryId, setRemovingRepositoryId] = useState("");
  const [syncingSkills, setSyncingSkills] = useState(false);

  const [state, setState] = useState<GitStatus | null>(null);
  const [status, setStatus] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [aliasDraft, setAliasDraft] = useState("");
  const [aliasEditing, setAliasEditing] = useState(false);
  const [syncPathDraft, setSyncPathDraft] = useState("");
  const [savingAlias, setSavingAlias] = useState(false);
  const [savingSyncPath, setSavingSyncPath] = useState(false);
  const [actionStatus, setActionStatus] = useState("");
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [syncTree, setSyncTree] = useState<Record<string, GitSyncTreeEntry[]>>({});
  const [syncTreeExpanded, setSyncTreeExpanded] = useState<Record<string, boolean>>({});
  const [syncTreeLoading, setSyncTreeLoading] = useState<Record<string, boolean>>({});
  const [ignoreDraft, setIgnoreDraft] = useState<string[]>([]);
  const [ignoreInitial, setIgnoreInitial] = useState<string[]>([]);
  const [ignoreSaving, setIgnoreSaving] = useState(false);
  const [ignoreStatus, setIgnoreStatus] = useState("");
  const [ignoreSelectorOpen, setIgnoreSelectorOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphStatus, setGraphStatus] = useState("");
  const [graphCommits, setGraphCommits] = useState<GitGraphCommit[]>([]);

  const selectedRepository = useMemo(
    () => repositories.find((repo) => repo.id === selectedRepoId),
    [repositories, selectedRepoId],
  );
  const selectedRepoPath = selectedRepository?.localPath ?? "";
  const syncingRepositories = useMemo(
    () => repositories.filter((repo) => repo.isSyncing),
    [repositories],
  );
  const displayedSyncPath = selectedRepository?.sourcePath || syncSourcePath;
  const guideBlocks = useMemo(() => parseGuideMarkdown(guideMarkdown), [guideMarkdown]);
  const recentCommits = state?.recent_commits ?? [];
  const latestCommitHash = state?.latest_commit_hash ?? "";
  const graphRows = useMemo(() => buildCommitGraphRows(graphCommits), [graphCommits]);
  const graphLaneCount = useMemo(
    () => graphRows.reduce((maxCount, row) => Math.max(maxCount, row.laneCount), 1),
    [graphRows],
  );
  const commitGraphUrl = useMemo(() => {
    if (!selectedRepository) return null;
    return buildCommitGraphUrl(selectedRepository, state?.branch ?? "");
  }, [selectedRepository, state?.branch]);
  const rootTreeEntries = syncTree[""] ?? [];
  const rootTreeLoading = syncTreeLoading[""] ?? false;
  const ignoreDraftSet = useMemo(() => new Set(ignoreDraft), [ignoreDraft]);
  const ignoreDirty = useMemo(
    () => ignoreDraft.join("\u0000") !== ignoreInitial.join("\u0000"),
    [ignoreDraft, ignoreInitial],
  );

  const refreshStatus = useCallback(
    async (repoPath?: string) => {
      const targetRepoPath = (repoPath ?? selectedRepoPath).trim();
      if (!targetRepoPath) {
        setState(null);
        setStatus(t("git.repo.selectPrompt"));
        return;
      }
      setStatus(t("tools.loading"));
      try {
        const result = await gitStatus(targetRepoPath);
        setState(result);
        setStatus("");
      } catch (e: unknown) {
        setStatus(String(e));
      }
    },
    [selectedRepoPath, t],
  );

  const refreshRepositories = useCallback(
    async (preferredSelectedId?: string) => {
      setLoadingRepositories(true);
      setRepositoryStatus(t("tools.loading"));
      try {
        const list = await gitListRepositories();
        setRepositories(list);

        const preferredId = preferredSelectedId?.trim() ?? "";
        const selectedStillExists =
          selectedRepoId.length > 0 && list.some((repo) => repo.id === selectedRepoId);
        const preferredStillExists = preferredId.length > 0 && list.some((repo) => repo.id === preferredId);

        const nextSelectedId = preferredStillExists
          ? preferredId
          : selectedStillExists
            ? selectedRepoId
            : list[0]?.id ?? "";

        setSelectedRepoId(nextSelectedId);
        setRepositoryStatus("");

        if (!nextSelectedId) {
          setViewMode("overview");
          setState(null);
          setStatus(t("git.repo.selectPrompt"));
        }
      } catch (e: unknown) {
        setRepositoryStatus(String(e));
      } finally {
        setLoadingRepositories(false);
      }
    },
    [selectedRepoId, t],
  );

  useEffect(() => {
    void refreshRepositories();
  }, [refreshRepositories]);

  useEffect(() => {
    void (async () => {
      try {
        const path = await gitSyncSourcePath();
        setSyncSourcePath(path);
      } catch (e: unknown) {
        setRepositoryStatus(String(e));
      }
    })();
  }, []);

  useEffect(() => {
    if (viewMode !== "detail" || !selectedRepoPath) return;
    void refreshStatus(selectedRepoPath);
  }, [refreshStatus, selectedRepoPath, viewMode]);

  useEffect(() => {
    setAliasDraft(selectedRepository?.alias ?? "");
    setAliasEditing(false);
  }, [selectedRepository?.id, selectedRepository?.alias]);

  useEffect(() => {
    setSyncPathDraft(selectedRepository?.sourcePath ?? "");
  }, [selectedRepository?.id, selectedRepository?.sourcePath]);

  useEffect(() => {
    const selectedRepositoryId = selectedRepository?.id;
    const selectedIgnorePaths = selectedRepository?.ignorePaths;
    if (viewMode !== "detail" || !selectedRepositoryId) return;
    const initialRules = sortIgnoreRules(selectedIgnorePaths ?? []);
    setIgnoreDraft(initialRules);
    setIgnoreInitial(initialRules);
    setSyncTree({});
    setSyncTreeExpanded({});
    setSyncTreeLoading({});
    setIgnoreStatus("");
    setIgnoreSelectorOpen(false);
    setGraphOpen(false);
    setGraphLoading(false);
    setGraphStatus("");
    setGraphCommits([]);
  }, [selectedRepository?.id, selectedRepository?.ignorePaths, viewMode]);

  useEffect(() => {
    if (!showAddForm) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowAddForm(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showAddForm]);

  useEffect(() => {
    if (!guideOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setGuideOpen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [guideOpen]);

  useEffect(() => {
    if (!ignoreSelectorOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIgnoreSelectorOpen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [ignoreSelectorOpen]);

  useEffect(() => {
    if (!graphOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setGraphOpen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [graphOpen]);

  function openRepositoryDetail(repo: GitManagedRepository) {
    setShowAddForm(false);
    setGuideOpen(false);
    setIgnoreSelectorOpen(false);
    setGraphOpen(false);
    setSelectedRepoId(repo.id);
    setViewMode("detail");
    void refreshStatus(repo.localPath);
  }

  function resetAddForm() {
    setRepoUrl("");
    setRepoAliasInput("");
    setPostAddScript("");
    setSyncMode("direct");
    setSyncPathInput("");
  }

  function closeAddDrawer() {
    setShowAddForm(false);
  }

  function closeGuideModal() {
    setGuideOpen(false);
  }

  function closeIgnoreSelectorModal() {
    setIgnoreSelectorOpen(false);
  }

  function closeGraphModal() {
    setGraphOpen(false);
  }

  async function openGuideModal() {
    setShowAddForm(false);
    setIgnoreSelectorOpen(false);
    setGraphOpen(false);
    setGuideOpen(true);
    setGuideLoading(true);
    setGuideError("");
    try {
      const document = await gitGetGuideMarkdown();
      setGuidePath(document.path);
      setGuideMarkdown(document.content);
    } catch (e: unknown) {
      setGuideError(String(e));
    } finally {
      setGuideLoading(false);
    }
  }

  async function pickDirectoryPath(defaultPath: string) {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: defaultPath || undefined,
      title: t("git.repo.syncPath"),
    });
    if (typeof selected === "string") {
      return selected;
    }
    return "";
  }

  async function handlePickAddSyncPath() {
    try {
      const selected = await pickDirectoryPath(syncPathInput.trim() || syncSourcePath.trim());
      if (selected) {
        setSyncPathInput(selected);
      }
    } catch (e: unknown) {
      setRepositoryStatus(String(e));
    }
  }

  async function handleOpenAddSyncPath() {
    const targetPath = (syncPathInput.trim() || syncSourcePath.trim()).trim();
    if (!targetPath) {
      setRepositoryStatus(t("git.path.empty"));
      return;
    }
    setRepositoryStatus(t("git.path.opening"));
    try {
      await gitOpenDirectory(targetPath);
      setRepositoryStatus("");
    } catch (e: unknown) {
      setRepositoryStatus(String(e));
    }
  }

  async function handlePickDetailSyncPath() {
    try {
      const selected = await pickDirectoryPath(
        syncPathDraft.trim() || displayedSyncPath.trim() || syncSourcePath.trim(),
      );
      if (selected) {
        setSyncPathDraft(selected);
      }
    } catch (e: unknown) {
      setActionStatus(String(e));
    }
  }

  async function handleOpenDetailSyncPath() {
    const targetPath = (syncPathDraft.trim() || displayedSyncPath.trim() || syncSourcePath.trim()).trim();
    if (!targetPath) {
      setActionStatus(t("git.path.empty"));
      return;
    }
    setActionStatus(t("git.path.opening"));
    try {
      await gitOpenDirectory(targetPath);
      setActionStatus(t("git.path.opened"));
    } catch (e: unknown) {
      setActionStatus(String(e));
    }
  }

  async function handleSaveSyncPath() {
    if (!selectedRepository || savingSyncPath) return;
    setSavingSyncPath(true);
    setActionStatus(t("git.path.saving"));
    try {
      const updated = await gitUpdateRepositorySyncPath(selectedRepository.id, syncPathDraft.trim() || undefined);
      setRepositories((previous) => previous.map((repo) => (repo.id === updated.id ? updated : repo)));
      setSyncPathDraft(updated.sourcePath);
      setActionStatus(t("git.path.saved"));
      await refreshStatus(updated.localPath);
    } catch (e: unknown) {
      setActionStatus(String(e));
    } finally {
      setSavingSyncPath(false);
    }
  }

  async function loadSyncTree(parentRelativePath?: string, force = false) {
    if (!selectedRepository) return;
    const key = parentRelativePath ?? "";
    if (!force && syncTree[key]) return;
    setSyncTreeLoading((previous) => ({ ...previous, [key]: true }));
    try {
      const entries = await gitListSyncTree(selectedRepository.id, key || undefined);
      setSyncTree((previous) => ({ ...previous, [key]: entries }));
      setIgnoreStatus("");
    } catch (e: unknown) {
      setIgnoreStatus(String(e));
    } finally {
      setSyncTreeLoading((previous) => ({ ...previous, [key]: false }));
    }
  }

  async function handleToggleSyncTreeDirectory(entry: GitSyncTreeEntry) {
    if (entry.entryType !== "dir") return;
    const key = entry.relativePath;
    const nextExpanded = !(syncTreeExpanded[key] ?? false);
    setSyncTreeExpanded((previous) => ({ ...previous, [key]: nextExpanded }));
    if (nextExpanded && entry.hasChildren && !syncTree[key]) {
      await loadSyncTree(key);
    }
  }

  async function handleOpenIgnoreSelectorModal() {
    if (ignoreSelectorOpen) return;
    setIgnoreSelectorOpen(true);
    setGuideOpen(false);
    setGraphOpen(false);
    await loadSyncTree(undefined, false);
  }

  async function loadGraphHistory(force = false) {
    if (!selectedRepoPath) return;
    if (!force && graphCommits.length > 0) return;
    setGraphLoading(true);
    setGraphStatus("");
    try {
      const commits = await gitListCommitHistory(selectedRepoPath, 120);
      setGraphCommits(commits);
    } catch (e: unknown) {
      setGraphStatus(String(e));
    } finally {
      setGraphLoading(false);
    }
  }

  async function handleOpenGraphModal() {
    if (!selectedRepoPath) {
      setActionStatus(t("git.graph.noRepo"));
      return;
    }
    setShowAddForm(false);
    setGuideOpen(false);
    setIgnoreSelectorOpen(false);
    setActionStatus(t("git.graph.opening"));
    setGraphOpen(true);
    await loadGraphHistory(false);
    setActionStatus("");
  }

  async function handleOpenExternalUrl(url: string | null) {
    if (!url) return;
    try {
      await gitOpenUrl(url);
    } catch (e: unknown) {
      setActionStatus(String(e));
    }
  }

  function handleToggleIgnoreEntry(entry: GitSyncTreeEntry) {
    const rule = ignoreRuleForEntry(entry);
    setIgnoreDraft((previous) => {
      const next = new Set(previous);
      if (next.has(rule)) {
        next.delete(rule);
      } else {
        next.add(rule);
      }
      return sortIgnoreRules(Array.from(next));
    });
  }

  function handleResetIgnoreRules() {
    setIgnoreDraft(ignoreInitial);
    setIgnoreStatus("");
  }

  async function handleRefreshIgnoreTree() {
    await loadSyncTree(undefined, true);
  }

  async function handleSaveIgnoreRules() {
    if (!selectedRepository || ignoreSaving || !ignoreDirty) return;
    setIgnoreSaving(true);
    setIgnoreStatus(t("git.ignore.saving"));
    try {
      const result = await gitUpdateRepositoryIgnoredPaths(selectedRepository.id, ignoreDraft);
      setRepositories((previous) =>
        previous.map((repo) => (repo.id === result.repository.id ? result.repository : repo)),
      );
      const nextRules = sortIgnoreRules(result.repository.ignorePaths ?? []);
      setIgnoreDraft(nextRules);
      setIgnoreInitial(nextRules);

      if (result.syncResult) {
        setIgnoreStatus(
          t("git.ignore.savedWithSync", {
            ignored: nextRules.length,
            copied: result.syncResult.copiedFiles,
            removed: result.syncResult.removedEntries,
          }),
        );
      } else {
        setIgnoreStatus(t("git.ignore.saved", { ignored: nextRules.length }));
      }
      await refreshStatus(result.repository.localPath);
      await loadSyncTree(undefined, true);
    } catch (e: unknown) {
      setIgnoreStatus(String(e));
    } finally {
      setIgnoreSaving(false);
    }
  }

  async function handleAddRepository() {
    const trimmedUrl = repoUrl.trim();
    if (addingRepository || trimmedUrl.length === 0) return;

    const alias = repoAliasInput.trim();
    const script = postAddScript.trim();
    const inputSyncPath = syncPathInput.trim();
    const resolvedSourcePath = inputSyncPath || syncSourcePath.trim();
    const addOptions: GitAddRepositoryOptions = {
      alias: alias || undefined,
      scriptAfterAdd: script || undefined,
      syncMode,
      sourcePath: resolvedSourcePath || undefined,
      localPath: syncMode === "direct" ? resolvedSourcePath || undefined : undefined,
    };

    const pendingId = `pending-${Date.now()}`;
    const pendingRepository: GitManagedRepository = {
      id: pendingId,
      name: inferRepositoryName(trimmedUrl),
      alias: alias || undefined,
      url: trimmedUrl,
      provider: inferRepositoryProvider(trimmedUrl),
      syncMode,
      sourcePath: resolvedSourcePath,
      localPath: syncMode === "direct" ? resolvedSourcePath : "",
      isSyncing: true,
      scriptAfterAdd: script || undefined,
      ignorePaths: [],
    };

    setAddingRepository(true);
    setActionStatus(t("git.repo.adding"));
    setRepositories((prev) => [pendingRepository, ...prev]);

    try {
      const created = await gitAddRepository(trimmedUrl, addOptions);
      setActionStatus(t("git.repo.add.ok", { name: repositoryDisplayName(created) }));
      resetAddForm();
      setShowAddForm(false);
      setViewMode("detail");
      await refreshRepositories(created.id);
      await refreshStatus(created.localPath);
    } catch (e: unknown) {
      setActionStatus(String(e));
    } finally {
      setAddingRepository(false);
      setRepositories((prev) => prev.filter((repo) => !repo.id.startsWith("pending-")));
    }
  }

  async function handleSaveAlias() {
    if (!selectedRepository || savingAlias) return false;
    setSavingAlias(true);
    setActionStatus(t("git.repo.alias.saving"));
    try {
      const updated = await gitUpdateRepositoryAlias(selectedRepository.id, aliasDraft.trim() || undefined);
      setRepositories((previous) => previous.map((repo) => (repo.id === updated.id ? updated : repo)));
      setAliasDraft(updated.alias ?? "");
      setActionStatus(t("git.repo.alias.saved", { name: repositoryDisplayName(updated) }));
      return true;
    } catch (e: unknown) {
      setActionStatus(String(e));
      return false;
    } finally {
      setSavingAlias(false);
    }
  }

  async function handleSaveAliasFromHeader() {
    const success = await handleSaveAlias();
    if (success) {
      setAliasEditing(false);
    }
  }

  function handleCancelAliasEdit() {
    setAliasDraft(selectedRepository?.alias ?? "");
    setAliasEditing(false);
  }

  async function handleCommit() {
    if (committing || pushing || !selectedRepoPath) return;
    setCommitting(true);
    setActionStatus(t("git.committing"));
    try {
      const result = await gitCommit(commitMessage, selectedRepoPath);
      setActionStatus(`${t("git.commit.ok", { hash: result.hash.slice(0, 8) })} (${result.hash})`);
      setCommitMessage("");
      await refreshStatus(selectedRepoPath);
    } catch (e: unknown) {
      setActionStatus(String(e));
    } finally {
      setCommitting(false);
    }
  }

  async function handlePush() {
    if (committing || pushing || !selectedRepoPath) return;
    setPushing(true);
    setActionStatus(t("git.pushing"));
    try {
      await gitPush(selectedRepoPath);
      setActionStatus(t("git.push.ok"));
      await refreshStatus(selectedRepoPath);
    } catch (e: unknown) {
      setActionStatus(String(e));
    } finally {
      setPushing(false);
    }
  }

  async function handleSyncSkills() {
    if (!selectedRepoPath || syncingSkills || committing || pushing) return;
    if (selectedRepository?.syncMode === "direct") {
      setActionStatus(t("git.sync.skip.direct"));
      return;
    }

    setSyncingSkills(true);
    setActionStatus(t("git.sync.syncing"));
    try {
      const result = await gitSyncSkillsToRepo(selectedRepoPath, selectedRepository?.sourcePath);
      setActionStatus(
        t("git.sync.ok", {
          copied: result.copiedFiles,
          removed: result.removedEntries,
        }),
      );
      await refreshStatus(selectedRepoPath);
    } catch (e: unknown) {
      setActionStatus(String(e));
    } finally {
      setSyncingSkills(false);
    }
  }

  async function handleRemoveRepository(repo: GitManagedRepository) {
    if (removingRepositoryId || addingRepository || syncingSkills || committing || pushing) return;

    const displayName = repositoryDisplayName(repo);
    const confirmed = window.confirm(t("git.repo.remove.confirm", { name: displayName }));
    if (!confirmed) return;

    setRemovingRepositoryId(repo.id);
    setActionStatus(t("git.repo.removing"));
    try {
      await gitRemoveRepository(repo.id);
      setActionStatus(t("git.repo.remove.ok", { name: displayName }));
      if (selectedRepoId === repo.id) {
        setSelectedRepoId("");
        setViewMode("overview");
        setState(null);
        setStatus(t("git.repo.selectPrompt"));
      }
      await refreshRepositories();
    } catch (e: unknown) {
      setActionStatus(String(e));
    } finally {
      setRemovingRepositoryId("");
    }
  }

  function renderIgnoreTreeEntries(entries: GitSyncTreeEntry[], depth = 0): ReactNode {
    return (
      <ul className="git-ignore-tree-list">
        {entries.map((entry) => {
          const key = entry.relativePath;
          const isDir = entry.entryType === "dir";
          const isExpanded = syncTreeExpanded[key] ?? false;
          const isLoadingChildren = syncTreeLoading[key] ?? false;
          const childEntries = syncTree[key] ?? [];
          const ignoreRule = ignoreRuleForEntry(entry);
          const isChecked = ignoreDraftSet.has(ignoreRule);
          return (
            <li key={key} className="git-ignore-tree-row">
              <div className="git-ignore-row-main" style={{ paddingLeft: `${depth * 14}px` }}>
                {isDir && entry.hasChildren ? (
                  <button
                    type="button"
                    className="git-ignore-expand"
                    onClick={() => void handleToggleSyncTreeDirectory(entry)}
                    aria-label={isExpanded ? t("git.ignore.collapse") : t("git.ignore.expand")}
                  >
                    {isExpanded ? "▾" : "▸"}
                  </button>
                ) : (
                  <span className="git-ignore-expand-placeholder" />
                )}
                <label className="git-ignore-check">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => handleToggleIgnoreEntry(entry)}
                  />
                  <span className={`git-ignore-entry-name ${isDir ? "is-dir" : ""}`}>{entry.name}</span>
                </label>
              </div>
              {isDir && isExpanded && (
                <div className="git-ignore-children">
                  {isLoadingChildren ? (
                    <p className="empty-state">{t("git.ignore.loading")}</p>
                  ) : childEntries.length === 0 ? (
                    <p className="empty-state">{t("git.ignore.emptyDir")}</p>
                  ) : (
                    renderIgnoreTreeEntries(childEntries, depth + 1)
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="page animate-fadein git-page">
      <header className="page-header git-page-header page-header-grid">
        <div className="git-header-copy page-header-copy">
          <h1 className="page-title">{t("git.title")}</h1>
          {(status || repositoryStatus) && (
            <span className="page-count git-header-status">{status || repositoryStatus}</span>
          )}
        </div>
        <div className="git-header-actions page-header-actions-grid">
          <div className="git-header-actions-row page-header-actions-row">
            {viewMode === "detail" ? (
              <button className="btn btn-ghost" onClick={() => setViewMode("overview")}>
                {t("git.backToList")}
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => setShowAddForm((previous) => !previous)}
                disabled={addingRepository}
              >
                {showAddForm ? t("git.repo.addForm.hide") : t("git.repo.addForm.show")}
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => void openGuideModal()}>
              {t("git.guide.open")}
            </button>
            <button className="btn btn-ghost" onClick={() => void refreshRepositories()} disabled={loadingRepositories}>
              {t("git.refresh")}
            </button>
          </div>
        </div>
      </header>

      {viewMode === "overview" ? (
        <div className="git-overview-layout">
          <article className="chart-card">
            <div className="git-overview-head">
              <h3 className="chart-title">{t("git.repo.list.title")}</h3>
              <span className="git-overview-meta">{t("git.repo.count", { count: repositories.length })}</span>
            </div>
            {syncingRepositories.length > 0 && (
              <p className="git-syncing-inline">
                {t("git.repo.syncing.title")}:{" "}
                {syncingRepositories.map((repo) => repositoryDisplayName(repo)).join(" / ")}
              </p>
            )}
            {repositories.length === 0 ? (
              <p className="empty-state">{t("git.repo.list.empty")}</p>
            ) : (
              <div className="git-repo-grid">
                {repositories.map((repo) => {
                  const isSelected = repo.id === selectedRepoId;
                  const providerIcon = providerIcons[repo.provider];
                  return (
                    <article key={repo.id} className={`git-repo-card ${isSelected ? "is-selected" : ""}`}>
                      <button className="git-repo-card-main" onClick={() => openRepositoryDetail(repo)}>
                        <div className="git-repo-title-row">
                          <strong>{repositoryDisplayName(repo)}</strong>
                          <span className="git-provider-inline git-provider-chip">
                            {providerIcon ? (
                              <svg
                                className="git-provider-icon"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                                fill={`#${providerIcon.hex}`}
                              >
                                <path d={providerIcon.path} />
                              </svg>
                            ) : null}
                            {t(`git.provider.${repo.provider}`)}
                          </span>
                        </div>
                        <p className="git-repo-card-url">{repo.url}</p>
                        <p className="git-repo-card-meta">
                          {t("git.repo.mode")}: {t(`git.repo.mode.${repo.syncMode}`)}
                        </p>
                        <p className="git-repo-card-meta">
                          {t("git.repo.syncPath")}: <span className="git-repo-card-path">{repo.sourcePath || syncSourcePath || "-"}</span>
                        </p>
                        <p className="git-repo-card-meta">
                          {t("git.repo.lastSync")}: {repo.lastSyncAt ?? t("git.repo.lastSync.never")}
                        </p>
                        {repo.lastSyncError && (
                          <p className="git-repo-card-error">
                            {t("git.repo.error")}: {repo.lastSyncError}
                          </p>
                        )}
                      </button>
                      <div className="git-repo-card-actions">
                        <button className="btn btn-ghost" onClick={() => openRepositoryDetail(repo)}>
                          {t("git.repo.open")}
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={() => void handleRemoveRepository(repo)}
                          disabled={removingRepositoryId === repo.id}
                        >
                          {removingRepositoryId === repo.id ? t("git.repo.removing") : t("git.repo.remove")}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </article>

          {showAddForm && (
            <>
              <button
                type="button"
                className="git-add-drawer-overlay"
                aria-label={t("git.repo.addForm.hide")}
                onClick={closeAddDrawer}
              />
              <aside className="git-add-drawer" role="dialog" aria-modal="true" aria-label={t("git.repo.add")}>
                <article className="chart-card git-add-drawer-panel">
                  <header className="git-add-drawer-head">
                    <h3 className="chart-title">{t("git.repo.add")}</h3>
                    <button
                      type="button"
                      className="btn btn-ghost git-add-drawer-close"
                      onClick={closeAddDrawer}
                      disabled={addingRepository}
                    >
                      {t("git.repo.addForm.hide")}
                    </button>
                  </header>

                  <div className="git-add-drawer-body">
                    <div className="git-repo-form git-form-grid">
                      <label className="field git-field">
                        <span className="field-label">{t("git.repo.mode")}</span>
                        <select
                          className="field-input"
                          value={syncMode}
                          onChange={(e) => setSyncMode(e.target.value as GitSyncMode)}
                        >
                          <option value="direct">{t("git.repo.mode.direct")}</option>
                          <option value="mirror">{t("git.repo.mode.mirror")}</option>
                        </select>
                      </label>
                      <label className="field git-field field-wide">
                        <span className="field-label">{t("git.repo.url")}</span>
                        <input
                          className="field-input"
                          value={repoUrl}
                          placeholder={t("git.repo.url.placeholder")}
                          onChange={(e) => setRepoUrl(e.target.value)}
                        />
                      </label>
                      <label className="field git-field field-wide">
                        <span className="field-label">{t("git.repo.alias")}</span>
                        <input
                          className="field-input"
                          value={repoAliasInput}
                          placeholder={t("git.repo.alias.placeholder")}
                          onChange={(e) => setRepoAliasInput(e.target.value)}
                        />
                      </label>
                      <label className="field git-field field-wide">
                        <span className="field-label">{t("git.repo.syncPath")}</span>
                        <div className="git-path-inline">
                          <input
                            className="field-input"
                            value={syncPathInput}
                            placeholder={t("git.repo.syncPath.placeholder")}
                            onChange={(e) => setSyncPathInput(e.target.value)}
                          />
                          <button type="button" className="btn btn-ghost" onClick={() => void handlePickAddSyncPath()}>
                            {t("git.path.pick")}
                          </button>
                          <button type="button" className="btn btn-ghost" onClick={() => void handleOpenAddSyncPath()}>
                            {t("git.path.open")}
                          </button>
                        </div>
                      </label>
                      <label className="field git-field field-wide">
                        <span className="field-label">{t("git.repo.script")}</span>
                        <input
                          className="field-input"
                          value={postAddScript}
                          placeholder={t("git.repo.script.placeholder")}
                          onChange={(e) => setPostAddScript(e.target.value)}
                        />
                      </label>
                      <div className="git-action-buttons field-wide">
                        <button
                          className="btn btn-primary"
                          onClick={() => void handleAddRepository()}
                          disabled={addingRepository || repoUrl.trim().length === 0}
                        >
                          {addingRepository ? t("git.repo.adding") : t("git.repo.add")}
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={() => {
                            resetAddForm();
                            closeAddDrawer();
                          }}
                          disabled={addingRepository}
                        >
                          {t("git.repo.addForm.hide")}
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              </aside>
            </>
          )}
        </div>
      ) : selectedRepository ? (
        <div className="git-detail-layout">
          <div className="git-detail-top">
            <article className="chart-card git-detail-card">
              <h3 className="chart-title">{t("git.detail.config")}</h3>
              <div className="git-config-hero">
                <div className="git-config-name-row">
                  {aliasEditing ? (
                    <div className="git-config-name-edit">
                      <input
                        className="field-input"
                        value={aliasDraft}
                        placeholder={t("git.repo.alias.placeholder")}
                        onChange={(e) => setAliasDraft(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => void handleSaveAliasFromHeader()}
                        disabled={savingAlias}
                      >
                        {savingAlias ? t("git.repo.alias.saving") : t("git.repo.alias.save")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={handleCancelAliasEdit}
                        disabled={savingAlias}
                      >
                        {t("git.repo.addForm.hide")}
                      </button>
                    </div>
                  ) : (
                    <>
                      <strong className="git-config-name">{repositoryDisplayName(selectedRepository)}</strong>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setAliasEditing(true)}
                      >
                        {t("git.repo.alias.edit")}
                      </button>
                    </>
                  )}
                  <span className="git-provider-inline git-provider-chip">
                    {providerIcons[selectedRepository.provider] ? (
                      <svg
                        className="git-provider-icon"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        fill={`#${providerIcons[selectedRepository.provider]?.hex}`}
                      >
                        <path d={providerIcons[selectedRepository.provider]?.path ?? ""} />
                      </svg>
                    ) : null}
                    {t(`git.provider.${selectedRepository.provider}`)}
                  </span>
                </div>
                <p className="git-config-url-label">{t("git.repo.url")}</p>
                <p className="git-config-url git-break">{selectedRepository.url}</p>
              </div>
              <div className="git-sync-path-stack">
                <span className="field-label">{t("git.repo.syncPath")}</span>
                <div className="git-path-inline">
                  <input
                    className="field-input"
                    value={syncPathDraft}
                    placeholder={t("git.repo.syncPath.placeholder")}
                    onChange={(e) => setSyncPathDraft(e.target.value)}
                  />
                  <button type="button" className="btn btn-ghost" onClick={() => void handlePickDetailSyncPath()}>
                    {t("git.path.pick")}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => void handleOpenDetailSyncPath()}>
                    {t("git.path.open")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void handleSaveSyncPath()}
                    disabled={savingSyncPath}
                  >
                    {savingSyncPath ? t("git.path.saving") : t("git.path.save")}
                  </button>
                </div>
              </div>
              <div className="git-config-meta-grid">
                <div className="git-config-meta-item">
                  <span>{t("git.repo.mode")}</span>
                  <strong>{t(`git.repo.mode.${selectedRepository.syncMode}`)}</strong>
                </div>
                <div className="git-config-meta-item">
                  <span>{t("git.repo.lastSync")}</span>
                  <strong>{selectedRepository.lastSyncAt ?? t("git.repo.lastSync.never")}</strong>
                </div>
              </div>
            </article>

            <article className="chart-card git-detail-card">
              <h3 className="chart-title">{t("git.actions")}</h3>
              <div className="git-actions">
                <label className="field git-field">
                  <span className="field-label">{t("git.commit.message")}</span>
                  <input
                    className="field-input"
                    value={commitMessage}
                    placeholder={t("git.commit.placeholder")}
                    onChange={(e) => setCommitMessage(e.target.value)}
                  />
                </label>
                <div className="git-action-buttons">
                  <button
                    className="btn btn-primary"
                    onClick={() => void handleCommit()}
                    disabled={committing || pushing || !selectedRepoPath || commitMessage.trim().length === 0}
                  >
                    {committing ? t("git.committing") : t("git.commit")}
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => void handlePush()}
                    disabled={committing || pushing || !selectedRepoPath}
                  >
                    {pushing ? t("git.pushing") : t("git.push")}
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => void handleSyncSkills()}
                    disabled={
                      syncingSkills ||
                      committing ||
                      pushing ||
                      !selectedRepoPath ||
                      selectedRepository.syncMode === "direct"
                    }
                  >
                    {syncingSkills ? t("git.sync.syncing") : t("git.sync.button")}
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => void refreshStatus(selectedRepoPath)}
                    disabled={committing || pushing || !selectedRepoPath}
                  >
                    {t("git.refresh")}
                  </button>
                </div>
                {actionStatus && <p className="git-action-status">{actionStatus}</p>}
                <section className="git-recent-panel">
                  <div className="git-recent-head">
                    <h4 className="git-recent-title">{t("git.recent.title")}</h4>
                    <button
                      type="button"
                      className="btn btn-ghost git-recent-graph-link"
                      onClick={() => void handleOpenGraphModal()}
                      disabled={!selectedRepoPath}
                    >
                      {t("git.recent.openGraph")}
                    </button>
                  </div>
                  <p className="git-recent-latest">
                    {t("git.recent.latestHash")}:{" "}
                    <code>{latestCommitHash || "-"}</code>
                  </p>
                  {recentCommits.length === 0 ? (
                    <p className="empty-state">{t("git.recent.empty")}</p>
                  ) : (
                    <ul className="git-recent-list">
                      {recentCommits.slice(0, 1).map((entry) => {
                        const detailUrl = buildCommitDetailUrl(selectedRepository, entry.hash);
                        return (
                          <li key={entry.hash} className="git-recent-item">
                            <div className="git-recent-item-head">
                              {detailUrl ? (
                                <button
                                  type="button"
                                  className="git-recent-hash-link git-recent-link-btn"
                                  onClick={() => void handleOpenExternalUrl(detailUrl)}
                                >
                                  {entry.short_hash}
                                </button>
                              ) : (
                                <code>{entry.short_hash}</code>
                              )}
                              <span
                                className={`git-recent-tag ${entry.is_pushed ? "is-pushed" : "is-pending"}`}
                              >
                                {entry.is_pushed ? t("git.recent.pushed") : t("git.recent.notPushed")}
                              </span>
                            </div>
                            <p className="git-recent-summary">{entry.summary}</p>
                            <p className="git-recent-meta">
                              {entry.author_name} · {formatCommitTime(entry.authored_at)}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </div>
            </article>
          </div>

          <article className="chart-card git-change-overview">
            <div className="git-change-overview-head">
              <h3 className="chart-title">{t("git.branch")}</h3>
              <strong className="git-branch-badge">{state?.branch ?? "-"}</strong>
            </div>
            <div className="git-file-grid">
              <article className="git-file-card">
                <div className="git-file-head">
                  <h3 className="chart-title">{t("git.changedFiles")}</h3>
                  <span className="git-file-count">{state?.changed.length ?? 0}</span>
                </div>
                {(state?.changed.length ?? 0) === 0 ? (
                  <p className="empty-state">{t("git.empty.changed")}</p>
                ) : (
                  <ul className="item-list git-file-list">{state?.changed.map((f) => <li key={f}>{f}</li>)}</ul>
                )}
              </article>
              <article className="git-file-card">
                <div className="git-file-head">
                  <h3 className="chart-title">{t("git.stagedFiles")}</h3>
                  <span className="git-file-count">{state?.staged.length ?? 0}</span>
                </div>
                {(state?.staged.length ?? 0) === 0 ? (
                  <p className="empty-state">{t("git.empty.staged")}</p>
                ) : (
                  <ul className="item-list git-file-list">{state?.staged.map((f) => <li key={f}>{f}</li>)}</ul>
                )}
              </article>
              <article className="git-file-card">
                <div className="git-file-head">
                  <h3 className="chart-title">{t("git.untrackedFiles")}</h3>
                  <span className="git-file-count">{state?.not_added.length ?? 0}</span>
                </div>
                {(state?.not_added.length ?? 0) === 0 ? (
                  <p className="empty-state">{t("git.empty.untracked")}</p>
                ) : (
                  <ul className="item-list git-file-list">{state?.not_added.map((f) => <li key={f}>{f}</li>)}</ul>
                )}
              </article>
              <article className="git-file-card git-ignore-file-card">
                <div className="git-file-head">
                  <h3 className="chart-title">{t("git.ignore.files")}</h3>
                  <span className="git-file-count">{ignoreDraft.length}</span>
                </div>
                <p className="git-ignore-help">{t("git.ignore.help")}</p>
                <div className="git-ignore-inline-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void handleOpenIgnoreSelectorModal()}
                  >
                    {t("git.ignore.show")}
                  </button>
                  {ignoreDirty ? <span className="git-ignore-dirty-tag">{t("git.ignore.unsaved")}</span> : null}
                </div>
                {ignoreDraft.length === 0 ? (
                  <p className="empty-state">{t("git.ignore.none")}</p>
                ) : (
                  <ul className="item-list git-file-list">
                    {ignoreDraft.map((rule) => (
                      <li key={rule}>{rule}</li>
                    ))}
                  </ul>
                )}
              </article>
            </div>
          </article>
        </div>
      ) : (
        <article className="chart-card">
          <p className="empty-state">{t("git.repo.detailMissing")}</p>
          <div className="git-action-buttons">
            <button className="btn btn-ghost" onClick={() => setViewMode("overview")}>
              {t("git.backToList")}
            </button>
          </div>
        </article>
      )}

      {guideOpen && (
        <>
          <button
            type="button"
            className="git-guide-overlay"
            aria-label={t("git.guide.close")}
            onClick={closeGuideModal}
          />
          <aside className="git-guide-modal" role="dialog" aria-modal="true" aria-label={t("git.guide.title")}>
            <article className="chart-card git-guide-panel">
              <header className="git-guide-head">
                <h3 className="chart-title">{t("git.guide.title")}</h3>
                <button type="button" className="btn btn-ghost git-guide-close" onClick={closeGuideModal}>
                  {t("git.guide.close")}
                </button>
              </header>
              <div className="git-guide-body">
                {guidePath && <p className="git-guide-path">{t("git.guide.path", { path: guidePath })}</p>}
                {guideLoading ? (
                  <p className="empty-state">{t("git.guide.loading")}</p>
                ) : guideError ? (
                  <p className="git-guide-error">{guideError}</p>
                ) : guideBlocks.length === 0 ? (
                  <p className="empty-state">{t("git.guide.empty")}</p>
                ) : (
                  <div className="git-guide-markdown">
                    {guideBlocks.map((block, index) => {
                      if (block.type === "heading") {
                        const HeadingTag = `h${block.level}` as "h1" | "h2" | "h3";
                        return <HeadingTag key={`heading-${index}`}>{renderInlineMarkdown(block.text)}</HeadingTag>;
                      }
                      if (block.type === "paragraph") {
                        return <p key={`paragraph-${index}`}>{renderInlineMarkdown(block.text)}</p>;
                      }
                      if (block.type === "list") {
                        const ListTag = block.ordered ? "ol" : "ul";
                        return (
                          <ListTag key={`list-${index}`}>
                            {block.items.map((item, itemIndex) => (
                              <li key={`item-${index}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
                            ))}
                          </ListTag>
                        );
                      }
                      return (
                        <pre key={`code-${index}`} className="git-guide-code">
                          {block.language && <span className="git-guide-code-lang">{block.language}</span>}
                          <code>{block.code}</code>
                        </pre>
                      );
                    })}
                  </div>
                )}
              </div>
            </article>
          </aside>
        </>
      )}

      {graphOpen && (
        <>
          <button
            type="button"
            className="git-graph-overlay"
            aria-label={t("git.graph.close")}
            onClick={closeGraphModal}
          />
          <aside className="git-graph-modal" role="dialog" aria-modal="true" aria-label={t("git.graph.title")}>
            <article className="chart-card git-graph-panel">
              <header className="git-graph-head">
                <h3 className="chart-title">{t("git.graph.title")}</h3>
                <div className="git-action-buttons">
                  {commitGraphUrl ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void handleOpenExternalUrl(commitGraphUrl)}
                    >
                      {t("git.graph.openRemote")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void loadGraphHistory(true)}
                    disabled={graphLoading}
                  >
                    {t("git.graph.refresh")}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={closeGraphModal}>
                    {t("git.graph.close")}
                  </button>
                </div>
              </header>
              <div className="git-graph-body">
                {graphStatus && <p className="git-ignore-status">{graphStatus}</p>}
                {graphLoading ? (
                  <p className="empty-state">{t("git.graph.loading")}</p>
                ) : graphCommits.length === 0 ? (
                  <p className="empty-state">{t("git.graph.empty")}</p>
                ) : (
                  <ul className="git-graph-list">
                    {graphRows.map((entry) => {
                      const detailUrl = selectedRepository ? buildCommitDetailUrl(selectedRepository, entry.hash) : null;
                      const graphWidth = graphLaneCount * GRAPH_LANE_WIDTH;
                      const laneToX = (laneIndex: number) => laneIndex * GRAPH_LANE_WIDTH + GRAPH_LANE_WIDTH / 2;
                      const continuityEdges = entry.beforeLanes
                        .map((hash, laneIndex) => {
                          if (hash === entry.hash) return null;
                          const nextLane = entry.afterLanes.indexOf(hash);
                          if (nextLane < 0) return null;
                          return { from: laneIndex, to: nextLane };
                        })
                        .filter((edge): edge is { from: number; to: number } => Boolean(edge));
                      return (
                        <li key={entry.hash} className="git-graph-item">
                          <div className="git-graph-track" aria-hidden="true">
                            <svg
                              className="git-graph-svg"
                              viewBox={`0 0 ${graphWidth} ${GRAPH_ROW_HEIGHT}`}
                              style={{ width: `${graphWidth}px`, height: `${GRAPH_ROW_HEIGHT}px` }}
                            >
                              <line
                                x1={laneToX(entry.lane)}
                                y1={0}
                                x2={laneToX(entry.lane)}
                                y2={GRAPH_NODE_Y}
                                className="git-graph-edge"
                              />
                              {continuityEdges.map((edge, edgeIndex) => (
                                <line
                                  key={`continuity-${entry.hash}-${edgeIndex}`}
                                  x1={laneToX(edge.from)}
                                  y1={0}
                                  x2={laneToX(edge.to)}
                                  y2={GRAPH_ROW_HEIGHT}
                                  className="git-graph-edge"
                                />
                              ))}
                              {entry.parentLanes.map((parentLane, edgeIndex) => (
                                <line
                                  key={`parent-${entry.hash}-${edgeIndex}`}
                                  x1={laneToX(entry.lane)}
                                  y1={GRAPH_NODE_Y}
                                  x2={laneToX(parentLane)}
                                  y2={GRAPH_ROW_HEIGHT}
                                  className={`git-graph-edge ${entry.parent_hashes.length > 1 ? "is-merge" : ""}`}
                                />
                              ))}
                              <circle
                                cx={laneToX(entry.lane)}
                                cy={GRAPH_NODE_Y}
                                r={4.4}
                                className={`git-graph-node ${entry.is_pushed ? "is-pushed" : "is-pending"}`}
                              />
                            </svg>
                          </div>
                          <div className="git-graph-content">
                            <div className="git-graph-top">
                              {detailUrl ? (
                                <button
                                  type="button"
                                  className="git-recent-hash-link git-recent-link-btn"
                                  onClick={() => void handleOpenExternalUrl(detailUrl)}
                                >
                                  {entry.short_hash}
                                </button>
                              ) : (
                                <code>{entry.short_hash}</code>
                              )}
                              {entry.refs.map((label, refIndex) => (
                                <span key={`${entry.hash}-${refIndex}`} className="git-graph-ref">
                                  {label}
                                </span>
                              ))}
                              {entry.parent_hashes.length > 1 ? (
                                <span className="git-graph-merge">{t("git.graph.merge")}</span>
                              ) : null}
                              <span className={`git-recent-tag ${entry.is_pushed ? "is-pushed" : "is-pending"}`}>
                                {entry.is_pushed ? t("git.recent.pushed") : t("git.recent.notPushed")}
                              </span>
                            </div>
                            <p className="git-graph-summary">{entry.summary}</p>
                            <p className="git-graph-meta">
                              {entry.author_name} · {formatCommitTime(entry.authored_at)}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </article>
          </aside>
        </>
      )}

      {ignoreSelectorOpen && (
        <>
          <button
            type="button"
            className="git-ignore-overlay"
            aria-label={t("git.ignore.hide")}
            onClick={closeIgnoreSelectorModal}
          />
          <aside className="git-ignore-modal" role="dialog" aria-modal="true" aria-label={t("git.ignore.title")}>
            <article className="chart-card git-ignore-modal-panel">
              <header className="git-ignore-modal-head">
                <h3 className="chart-title">{t("git.ignore.title")}</h3>
                <button
                  type="button"
                  className="btn btn-ghost git-ignore-modal-close"
                  onClick={closeIgnoreSelectorModal}
                >
                  {t("git.ignore.hide")}
                </button>
              </header>
              <div className="git-ignore-modal-body">
                <section className="git-ignore-panel">
                  <div className="git-ignore-head">
                    <p className="git-ignore-help">{t("git.ignore.help")}</p>
                    <div className="git-ignore-head-actions">
                      <span className="git-file-count">{t("git.ignore.count", { count: ignoreDraft.length })}</span>
                    </div>
                  </div>
                  <div className="git-ignore-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void handleSaveIgnoreRules()}
                      disabled={ignoreSaving || !ignoreDirty}
                    >
                      {ignoreSaving ? t("git.ignore.saving") : t("git.ignore.save")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={handleResetIgnoreRules}
                      disabled={ignoreSaving || !ignoreDirty}
                    >
                      {t("git.ignore.reset")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void handleRefreshIgnoreTree()}
                      disabled={ignoreSaving || rootTreeLoading}
                    >
                      {t("git.ignore.refresh")}
                    </button>
                  </div>
                  {ignoreStatus && <p className="git-ignore-status">{ignoreStatus}</p>}
                  <div className="git-ignore-tree">
                    {rootTreeLoading ? (
                      <p className="empty-state">{t("git.ignore.loading")}</p>
                    ) : rootTreeEntries.length === 0 ? (
                      <p className="empty-state">{t("git.ignore.empty")}</p>
                    ) : (
                      renderIgnoreTreeEntries(rootTreeEntries)
                    )}
                  </div>
                </section>
              </div>
            </article>
          </aside>
        </>
      )}
    </div>
  );
}


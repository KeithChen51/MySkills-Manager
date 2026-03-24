import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readGitPageSource() {
  const pagePath = path.resolve(process.cwd(), "src/pages/GitPage.tsx");
  return fs.readFileSync(pagePath, "utf8");
}

function readTauriApiSource() {
  const apiPath = path.resolve(process.cwd(), "src/api/tauri.ts");
  return fs.readFileSync(apiPath, "utf8");
}

test("GitPage supports repository add flow and selected repository actions", () => {
  const source = readGitPageSource();

  assert.ok(source.includes("gitListRepositories("), "GitPage should load managed repositories");
  assert.ok(
    source.includes('from "./git/components/GitFloatingModal"'),
    "GitPage should delegate modal shell rendering to git scoped components",
  );
  assert.ok(source.includes("<GitFloatingModal"), "GitPage should use GitFloatingModal wrappers");
  assert.ok(source.includes("gitAddRepository("), "GitPage should add repositories from URL");
  assert.ok(source.includes("gitSyncSourcePath("), "GitPage should load local sync source path");
  assert.ok(source.includes("viewMode"), "GitPage should support overview/detail view mode");
  assert.ok(source.includes("git-repo-grid"), "GitPage should render repository cards in overview");
  assert.ok(source.includes("git-add-drawer-overlay"), "GitPage should render add-repository drawer overlay");
  assert.ok(source.includes("git-add-drawer"), "GitPage should render add-repository drawer container");
  assert.ok(source.includes("git-add-drawer-close"), "GitPage should render drawer close control");
  assert.ok(source.includes("gitGetGuideMarkdown("), "GitPage should load local guide markdown content");
  assert.ok(source.includes("gitListSyncTree("), "GitPage should load sync tree entries for ignore selector");
  assert.ok(
    source.includes("gitUpdateRepositoryIgnoredPaths("),
    "GitPage should save repository ignore path rules",
  );
  assert.ok(source.includes("git-guide-overlay"), "GitPage should render guide overlay");
  assert.ok(source.includes("git-guide-modal"), "GitPage should render guide modal");
  assert.ok(source.includes("repoAliasInput"), "GitPage should support repository alias input");
  assert.ok(source.includes("git.repo.alias"), "GitPage should show alias field label");
  assert.ok(source.includes("git.repo.open"), "GitPage should expose repository entry action");
  assert.ok(source.includes("git.backToList"), "GitPage detail should support back-to-list");
  assert.ok(source.includes("git-config-hero"), "GitPage detail config should use grouped header layout");
  assert.ok(source.includes("git-change-overview"), "GitPage should merge git status and file list into one overview");
  assert.ok(!source.includes("git-kpi-row"), "GitPage should remove duplicated KPI row");
  assert.ok(source.includes("git.path.pick"), "GitPage should expose folder picker action for paths");
  assert.ok(source.includes("git.path.open"), "GitPage should expose open-folder action for paths");
  assert.ok(source.includes("gitUpdateRepositorySyncPath("), "GitPage should update repository sync path from detail view");
  assert.ok(source.includes("gitOpenDirectory("), "GitPage should open selected sync folder in file manager");
  assert.ok(source.includes("gitOpenUrl("), "GitPage should open repository graph/details links via native opener");
  assert.ok(source.includes("recent_commits"), "GitPage should render recent commit records from git status");
  assert.ok(source.includes("latest_commit_hash"), "GitPage should show latest commit hash for verification");
  assert.ok(source.includes("buildCommitDetailUrl("), "GitPage should provide commit detail links");
  assert.ok(source.includes("buildCommitGraphUrl("), "GitPage should provide commit graph links");
  assert.ok(source.includes("gitListCommitHistory("), "GitPage should load commit history for graph view");
  assert.ok(source.includes("buildCommitGraphRows("), "GitPage should transform commits into graph rows");
  assert.ok(source.includes("git.recent.title"), "GitPage should show recent update panel title");
  assert.ok(source.includes("git.recent.openGraph"), "GitPage should expose open graph action");
  assert.ok(source.includes("git-graph-modal"), "GitPage should render commit graph modal");
  assert.ok(source.includes("git-graph-svg"), "GitPage should render SVG graph lanes");
  assert.ok(source.includes("git-ignore-panel"), "GitPage should render ignore-sync panel in branch section");
  assert.ok(source.includes("git-ignore-modal"), "GitPage should render floating ignore selector modal");
  assert.ok(source.includes("git.ignore.files"), "GitPage should render ignored-sync files column");
  assert.ok(source.includes("git.ignore.title"), "GitPage should show ignore-sync panel title");
  assert.ok(source.includes("git.ignore.save"), "GitPage should expose save ignore rules action");
  assert.ok(!source.includes("ignorePanelOpen"), "GitPage should no longer use inline expanded ignore panel");
  const changedIndex = source.indexOf('t("git.changedFiles")');
  const stagedIndex = source.indexOf('t("git.stagedFiles")');
  const untrackedIndex = source.indexOf('t("git.untrackedFiles")');
  const ignoreFilesIndex = source.indexOf('t("git.ignore.files")');
  assert.ok(changedIndex >= 0 && stagedIndex >= 0 && untrackedIndex >= 0 && ignoreFilesIndex >= 0);
  assert.ok(
    changedIndex < stagedIndex && stagedIndex < untrackedIndex && untrackedIndex < ignoreFilesIndex,
    "Git status columns should render left-to-right: changed, staged, untracked, ignored",
  );
  assert.ok(source.includes("gitSyncSkillsToRepo("), "GitPage should sync local skills into selected repository");
  assert.ok(source.includes("gitRemoveRepository("), "GitPage should allow deleting managed repositories");
  assert.ok(source.includes("syncMode"), "GitPage should support sync mode selection");
  assert.ok(source.includes("syncPathInput"), "GitPage should support single sync folder input");
  assert.ok(source.includes("git.repo.syncPath"), "GitPage should show single sync folder label");
  assert.ok(!source.includes("sourcePathInput"), "GitPage should not expose separate source folder input");
  assert.ok(!source.includes("localPathInput"), "GitPage should not expose separate local folder input");
  assert.ok(!source.includes("git.sync.target"), "GitPage detail should not show a second target path row");
  assert.ok(source.includes("syncingRepositories"), "GitPage should render syncing repository list");
  assert.ok(source.includes("git-repo-card-path"), "GitPage repository card should show sync path summary");
  assert.ok(source.includes("setSelectedRepoId("), "GitPage should allow selecting repository");
  assert.ok(
    source.includes("gitCommit(commitMessage, selectedRepoPath)"),
    "Commit should target selected repository path",
  );
  assert.ok(
    source.includes("gitPush(selectedRepoPath)"),
    "Push should target selected repository path",
  );
});

test("tauri API exposes repository commands and forwards repoPath", () => {
  const source = readTauriApiSource();

  assert.ok(
    source.includes("git_list_repositories"),
    "tauri API should expose repository listing command",
  );
  assert.ok(
    source.includes("git_add_repository"),
    "tauri API should expose repository add command",
  );
  assert.ok(
    source.includes("git_sync_source_path"),
    "tauri API should expose local source path command",
  );
  assert.ok(
    source.includes("git_get_guide_markdown"),
    "tauri API should expose git guide markdown command",
  );
  assert.ok(
    source.includes("git_sync_skills_to_repo"),
    "tauri API should expose local skills sync command",
  );
  assert.ok(
    source.includes("git_remove_repository"),
    "tauri API should expose repository remove command",
  );
  assert.ok(
    source.includes("git_update_repository_alias"),
    "tauri API should expose repository alias update command",
  );
  assert.ok(
    source.includes("git_update_repository_sync_path"),
    "tauri API should expose repository sync path update command",
  );
  assert.ok(
    source.includes("git_open_directory"),
    "tauri API should expose open-directory command",
  );
  assert.ok(
    source.includes("git_open_url"),
    "tauri API should expose open-url command",
  );
  assert.ok(
    source.includes("git_list_commit_history"),
    "tauri API should expose commit history command",
  );
  assert.ok(
    source.includes("git_list_sync_tree"),
    "tauri API should expose sync tree listing command",
  );
  assert.ok(
    source.includes("git_update_repository_ignored_paths"),
    "tauri API should expose ignore-path update command",
  );
  assert.ok(source.includes("GitSyncTreeEntry"), "tauri API should expose sync tree entry type");
  assert.ok(source.includes("ignorePaths: string[]"), "tauri API should support ignore path array type");
  assert.ok(
    source.includes("ignore_paths: ignorePaths"),
    "tauri API should forward ignorePaths to ignore_paths field",
  );
  assert.ok(source.includes("GitRecentCommit"), "tauri API should expose recent commit type");
  assert.ok(source.includes("GitGraphCommit"), "tauri API should expose graph commit type");
  assert.ok(source.includes("recent_commits"), "tauri API GitStatus type should include recent commits");
  assert.ok(source.includes("latest_commit_hash"), "tauri API GitStatus type should include latest commit hash");
  assert.ok(source.includes("repo_path: repoPath"), "tauri API should forward repoPath argument");
  assert.ok(source.includes("source_path: sourcePath"), "tauri API should forward sourcePath argument");
  assert.ok(
    source.includes("repository_id: repositoryId"),
    "tauri API should forward repositoryId to repository_id field",
  );
  assert.ok(source.includes("alias?: string"), "tauri API should support repository alias in type definitions");
  assert.ok(source.includes("alias,"), "tauri API should forward alias argument");
});




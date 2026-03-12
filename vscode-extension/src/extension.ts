import * as vscode from "vscode";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";

import { createDashboardHtml, parseDashboardMessage } from "./dashboardHtml";
import {
  commitAllChanges,
  pushRepository,
  readManagedRepositoriesFromConfig,
  readGitOverview,
  type GitOverview,
  type ManagedGitRepository,
} from "./git";
import {
  normalizeFileSystemPath,
  resolveSkillsRoot,
  scanSkills,
  type SkillItem,
} from "./skills";

const SKILLS_ROOT_CONFIG_KEY = "skillar.skillsRoot";
const SKILLAR_VIEW_ID = "skillarSkills";
const SKILLAR_ICON_FILE = "skillar-icon-centered-light.png";
const SKILLAR_CONTAINER_FOCUS_COMMAND = "workbench.view.extension.skillar";

async function ensureDirectoryExists(pathValue: string): Promise<void> {
  await access(pathValue, fsConstants.R_OK);
}

async function openDirectory(pathValue: string): Promise<void> {
  const normalizedPath = normalizeFileSystemPath(pathValue);
  await ensureDirectoryExists(normalizedPath);
  const uri = vscode.Uri.file(normalizedPath);
  const opened = await vscode.env.openExternal(uri);
  if (!opened) {
    await vscode.commands.executeCommand("revealFileInOS", uri);
  }
}

async function openSkillReadme(skillMdPath: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(skillMdPath);
  await vscode.window.showTextDocument(document, { preview: false });
}

function getSkillReadmePath(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = (value as { skillMdPath?: unknown }).skillMdPath;
  if (typeof candidate === "string" && candidate.trim()) {
    return candidate;
  }
  return null;
}

class SkillarDashboardProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private rootPath = resolveSkillsRoot();
  private skills: SkillItem[] = [];
  private mode: "skills" | "git" = "skills";
  private gitRepositories: ManagedGitRepository[] = [];
  private selectedGitRepositoryId: string | null = null;
  private gitOverview: GitOverview | null = null;
  private gitStatusMessage = "";

  constructor(private readonly extensionUri: vscode.Uri) {}

  async refreshSkills(): Promise<{ rootPath: string; count: number }> {
    const configuredPath = vscode.workspace
      .getConfiguration()
      .get<string>(SKILLS_ROOT_CONFIG_KEY);
    this.rootPath = resolveSkillsRoot(configuredPath);
    this.skills = await scanSkills(this.rootPath);
    this.render();
    return { rootPath: this.rootPath, count: this.skills.length };
  }

  async showGitDashboard(): Promise<void> {
    this.mode = "git";
    await this.refreshGit();
    this.view?.show?.(true);
  }

  async showSkillsDashboard(): Promise<void> {
    this.mode = "skills";
    this.render();
    this.view?.show?.(true);
  }

  private selectedGitRepository(): ManagedGitRepository | null {
    if (!this.selectedGitRepositoryId) {
      return null;
    }
    return this.gitRepositories.find((repo) => repo.id === this.selectedGitRepositoryId) ?? null;
  }

  private async refreshGitRepositories(): Promise<void> {
    this.gitRepositories = await readManagedRepositoriesFromConfig(undefined, this.rootPath);
    if (this.gitRepositories.length === 0) {
      this.selectedGitRepositoryId = null;
      return;
    }

    const selectedStillExists = this.selectedGitRepositoryId
      ? this.gitRepositories.some((repo) => repo.id === this.selectedGitRepositoryId)
      : false;
    if (!selectedStillExists) {
      this.selectedGitRepositoryId = this.gitRepositories[0]?.id ?? null;
    }
  }

  async refreshGit(): Promise<void> {
    try {
      await this.refreshGitRepositories();
      const selectedRepository = this.selectedGitRepository();
      if (!selectedRepository) {
        this.gitOverview = null;
        if (!this.gitStatusMessage) {
          this.gitStatusMessage = "尚未发现仓库，请先在 Skillar 桌面端 Git 模块中添加仓库。";
        }
        this.render();
        return;
      }

      this.gitOverview = await readGitOverview(selectedRepository.localPath);
      this.gitStatusMessage = "";
    } catch (error) {
      this.gitOverview = null;
      this.gitStatusMessage = error instanceof Error ? error.message : String(error);
    }
    this.render();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };

    view.webview.onDidReceiveMessage(async (rawMessage) => {
      const message = parseDashboardMessage(rawMessage);
      if (!message) {
        return;
      }

      try {
        if (message.type === "refresh") {
          const { rootPath, count } = await this.refreshSkills();
          if (this.mode === "git") {
            await this.refreshGit();
          }
          vscode.window.setStatusBarMessage(`Skillar 已刷新 ${count} 个技能：${rootPath}`, 3500);
          return;
        }

        if (message.type === "openFolder") {
          await openDirectory(this.rootPath);
          vscode.window.setStatusBarMessage("已打开技能目录", 2500);
          return;
        }

        if (message.type === "openSkills") {
          await this.showSkillsDashboard();
          return;
        }

        if (message.type === "openGit") {
          this.gitStatusMessage = "";
          await this.showGitDashboard();
          return;
        }

        if (message.type === "refreshGitRepos") {
          this.gitStatusMessage = "";
          await this.refreshGit();
          return;
        }

        if (message.type === "selectGitRepo") {
          this.selectedGitRepositoryId = message.repositoryId;
          this.gitStatusMessage = "";
          await this.refreshGit();
          return;
        }

        if (message.type === "refreshGit") {
          this.gitStatusMessage = "";
          await this.refreshGit();
          return;
        }

        if (message.type === "openGitFolder") {
          const folderPath = this.selectedGitRepository()?.localPath || this.gitOverview?.repoPath || this.rootPath;
          await openDirectory(folderPath);
          vscode.window.setStatusBarMessage("已打开 Git 仓库目录", 2500);
          return;
        }

        if (message.type === "commitGit") {
          const selectedRepository = this.selectedGitRepository();
          if (!selectedRepository) {
            throw new Error("未选择仓库，无法提交。");
          }
          const shortHash = await commitAllChanges(selectedRepository.localPath, message.message);
          this.gitStatusMessage = `提交成功：${shortHash}`;
          await this.refreshGit();
          return;
        }

        if (message.type === "pushGit") {
          const selectedRepository = this.selectedGitRepository();
          if (!selectedRepository) {
            throw new Error("未选择仓库，无法推送。");
          }
          await pushRepository(selectedRepository.localPath);
          this.gitStatusMessage = "推送成功";
          await this.refreshGit();
          return;
        }

        if (message.type === "openSkill") {
          await openSkillReadme(message.skillMdPath);
          return;
        }
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        this.gitStatusMessage = `操作失败: ${details}`;
        this.render();
        vscode.window.showErrorMessage(`Skillar action failed: ${details}`);
      }
    });

    this.render();
  }

  private render(): void {
    if (!this.view) {
      return;
    }
    const logoUri = this.view.webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", SKILLAR_ICON_FILE))
      .toString();
    this.view.webview.html = createDashboardHtml({
      rootPath: this.rootPath,
      logoUri,
      skills: this.skills,
      mode: this.mode,
      gitRepositories: this.gitRepositories,
      selectedGitRepositoryId: this.selectedGitRepositoryId,
      gitOverview: this.gitOverview,
      gitStatusMessage: this.gitStatusMessage,
    });
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const dashboardProvider = new SkillarDashboardProvider(context.extensionUri);
  const dashboardViewRegistration = vscode.window.registerWebviewViewProvider(
    SKILLAR_VIEW_ID,
    dashboardProvider,
  );

  const refreshCommand = vscode.commands.registerCommand("skillar.refreshSkills", async () => {
    const { rootPath, count } = await dashboardProvider.refreshSkills();
    vscode.window.setStatusBarMessage(`Skillar 已刷新 ${count} 个技能：${rootPath}`, 3500);
  });

  const openFolderCommand = vscode.commands.registerCommand("skillar.openMySkillsFolder", async () => {
    try {
      const configuredPath = vscode.workspace
        .getConfiguration()
        .get<string>(SKILLS_ROOT_CONFIG_KEY);
      const rootPath = resolveSkillsRoot(configuredPath);
      await openDirectory(rootPath);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`打开技能目录失败: ${details}`);
    }
  });

  const openReadmeCommand = vscode.commands.registerCommand(
    "skillar.openSkillReadme",
    async (item?: unknown) => {
      const skillMdPath = getSkillReadmePath(item);
      if (!skillMdPath) {
        vscode.window.showInformationMessage("请先选择一个技能条目。");
        return;
      }
      await openSkillReadme(skillMdPath);
    },
  );

  const openGitViewCommand = vscode.commands.registerCommand("skillar.openGitView", async () => {
    try {
      await vscode.commands.executeCommand(SKILLAR_CONTAINER_FOCUS_COMMAND);
    } catch {
      // Ignore focus command failures, webview can still be shown once resolved.
    }
    await dashboardProvider.showGitDashboard();
  });

  const configChangeWatcher = vscode.workspace.onDidChangeConfiguration(async (event) => {
    if (event.affectsConfiguration(SKILLS_ROOT_CONFIG_KEY)) {
      await dashboardProvider.refreshSkills();
      await dashboardProvider.refreshGit();
    }
  });

  context.subscriptions.push(
    dashboardViewRegistration,
    refreshCommand,
    openFolderCommand,
    openReadmeCommand,
    openGitViewCommand,
    configChangeWatcher,
  );

  await dashboardProvider.refreshSkills();
}

export function deactivate(): void {}

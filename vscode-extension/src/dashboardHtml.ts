import type { GitOverview, ManagedGitRepository } from "./git";
import type { SkillItem } from "./skills";

export interface DashboardViewModel {
  rootPath: string;
  logoUri: string;
  skills: SkillItem[];
  mode: "skills" | "git";
  gitRepositories: ManagedGitRepository[];
  selectedGitRepositoryId: string | null;
  gitOverview: GitOverview | null;
  gitStatusMessage: string;
}

export type DashboardMessage =
  | { type: "refresh" }
  | { type: "openFolder" }
  | { type: "openSkills" }
  | { type: "openGit" }
  | { type: "refreshGitRepos" }
  | { type: "selectGitRepo"; repositoryId: string }
  | { type: "refreshGit" }
  | { type: "openGitFolder" }
  | { type: "pushGit" }
  | { type: "commitGit"; message: string }
  | { type: "openSkill"; skillMdPath: string };

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function repositoryDisplayName(repository: ManagedGitRepository): string {
  const alias = repository.alias?.trim();
  return alias || repository.name;
}

function renderSkillCards(skills: SkillItem[]): string {
  if (!skills.length) {
    return `
      <div class="empty">
        <h3>没有发现技能</h3>
        <p>请确认 <code>skillar.skillsRoot</code> 指向包含技能目录与 <code>SKILL.md</code> 的路径。</p>
      </div>
    `;
  }

  return skills
    .map((skill) => {
      const description = skill.description.trim() || "暂无描述";
      const searchable = `${skill.name} ${description}`.toLowerCase();
      return `
        <article class="skill-card" data-search="${escapeHtml(searchable)}">
          <div class="skill-card-head">
            <h3>${escapeHtml(skill.name)}</h3>
            <button class="skill-open-btn" data-open-skill="${escapeHtml(skill.skillMdPath)}">打开</button>
          </div>
          <p>${escapeHtml(description)}</p>
          <code>${escapeHtml(skill.skillMdPath)}</code>
        </article>
      `;
    })
    .join("\n");
}

function renderPathList(items: string[], emptyText: string): string {
  if (!items.length) {
    return `<p class="empty-state">${escapeHtml(emptyText)}</p>`;
  }
  return `
    <ul class="path-list">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

function renderRecentCommits(model: GitOverview | null): string {
  if (!model || model.recentCommits.length === 0) {
    return `<p class="empty-state">暂无提交记录</p>`;
  }
  return `
    <ul class="commit-list">
      ${model.recentCommits
    .slice(0, 6)
    .map((commit) => `
          <li>
            <div class="commit-head">
              <code>${escapeHtml(commit.shortHash)}</code>
              <span>${escapeHtml(commit.authorName || "-")}</span>
            </div>
            <p>${escapeHtml(commit.summary)}</p>
            <small>${escapeHtml(commit.authoredAt || "-")}</small>
          </li>
        `)
    .join("")}
    </ul>
  `;
}

function renderRepositoryList(
  repositories: ManagedGitRepository[],
  selectedRepositoryId: string | null,
): string {
  if (!repositories.length) {
    return `<p class="empty-state">尚未在 Skillar 中配置仓库。请先在桌面端 Git 模块添加仓库。</p>`;
  }

  return repositories
    .map((repository) => {
      const active = repository.id === selectedRepositoryId;
      const statusTag = repository.isSyncing
        ? "同步中"
        : (repository.syncMode === "mirror" ? "镜像" : "直连");
      return `
        <article
          class="git-repo-item ${active ? "is-active" : ""}"
          data-select-repo="${escapeHtml(repository.id)}"
          role="button"
          tabindex="0"
          aria-label="选择仓库 ${escapeHtml(repositoryDisplayName(repository))}"
        >
          <div class="git-repo-item-head">
            <span class="git-repo-name">
              ${escapeHtml(repositoryDisplayName(repository))}
            </span>
            <span class="git-repo-tag">${escapeHtml(statusTag)}</span>
          </div>
          <p class="git-repo-path">${escapeHtml(repository.localPath)}</p>
        </article>
      `;
    })
    .join("");
}

export function parseDashboardMessage(raw: unknown): DashboardMessage | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const message = raw as {
    type?: unknown;
    skillMdPath?: unknown;
    message?: unknown;
    repositoryId?: unknown;
  };

  if (message.type === "refresh") {
    return { type: "refresh" };
  }
  if (message.type === "openFolder") {
    return { type: "openFolder" };
  }
  if (message.type === "openSkills") {
    return { type: "openSkills" };
  }
  if (message.type === "openGit") {
    return { type: "openGit" };
  }
  if (message.type === "refreshGitRepos") {
    return { type: "refreshGitRepos" };
  }
  if (message.type === "selectGitRepo" && typeof message.repositoryId === "string") {
    return { type: "selectGitRepo", repositoryId: message.repositoryId };
  }
  if (message.type === "refreshGit") {
    return { type: "refreshGit" };
  }
  if (message.type === "openGitFolder") {
    return { type: "openGitFolder" };
  }
  if (message.type === "pushGit") {
    return { type: "pushGit" };
  }
  if (message.type === "commitGit" && typeof message.message === "string") {
    return { type: "commitGit", message: message.message };
  }
  if (message.type === "openSkill" && typeof message.skillMdPath === "string") {
    return { type: "openSkill", skillMdPath: message.skillMdPath };
  }
  return null;
}

export function createDashboardHtml(model: DashboardViewModel): string {
  const safeRoot = escapeHtml(model.rootPath);
  const skillsCount = model.skills.length;
  const cards = renderSkillCards(model.skills);
  const mode = model.mode;
  const selectedRepository = model.gitRepositories.find(
    (repository) => repository.id === model.selectedGitRepositoryId,
  ) ?? model.gitRepositories[0] ?? null;
  const hasSelectedRepository = Boolean(selectedRepository);
  const git = model.gitOverview;
  const gitMessage = escapeHtml(model.gitStatusMessage || "");
  const gitBranch = escapeHtml(git?.branch || "-");
  const gitRepoPath = escapeHtml(git?.repoPath || selectedRepository?.localPath || model.rootPath);
  const gitAhead = git?.ahead ?? 0;
  const gitBehind = git?.behind ?? 0;
  const repositoryListHtml = renderRepositoryList(model.gitRepositories, selectedRepository?.id ?? null);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Skillar</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background:
        radial-gradient(1000px 500px at 0% -10%, color-mix(in srgb, var(--vscode-button-background) 18%, transparent), transparent),
        var(--vscode-editor-background);
    }
    .wrap {
      display: grid;
      gap: 12px;
      padding: 12px;
    }
    .panel {
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      background: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-foreground) 8%);
      border-radius: 10px;
      padding: 10px;
    }
    .hero {
      display: grid;
      grid-template-columns: 42px 1fr;
      gap: 10px;
      align-items: center;
    }
    .hero img {
      width: 42px;
      height: 42px;
      border-radius: 10px;
      border: 1px solid var(--vscode-panel-border);
      background: #ffffff;
      object-fit: contain;
      padding: 5px;
    }
    .title {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
    }
    .sub {
      margin: 3px 0 0;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      word-break: break-all;
    }
    .tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .tab-btn {
      min-height: 32px;
      border-radius: 8px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: color-mix(in srgb, var(--vscode-button-background) 42%, transparent);
      color: var(--vscode-foreground);
      font-weight: 700;
      cursor: pointer;
    }
    .tab-btn.is-active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .toolbar {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    button {
      min-height: 30px;
      border-radius: 8px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font-weight: 600;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button:disabled {
      opacity: .55;
      cursor: not-allowed;
    }
    .skills-panel, .git-panel { display: none; }
    body[data-mode="git"] .toolbar { display: none; }
    body[data-mode="skills"] .skills-panel { display: grid; gap: 10px; }
    body[data-mode="git"] .git-panel { display: grid; gap: 10px; }
    .search-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: center;
    }
    .search-row input, .git-commit input {
      width: 100%;
      min-height: 32px;
      border-radius: 8px;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      padding: 0 10px;
      outline: none;
    }
    .counter {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }
    .cards {
      display: grid;
      gap: 8px;
    }
    .skill-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      padding: 10px;
      background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-button-background) 12%);
      transition: border-color .18s ease, transform .12s ease;
    }
    .skill-card:hover {
      border-color: var(--vscode-focusBorder);
      transform: translateY(-1px);
    }
    .skill-card-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .skill-card h3 {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      color: var(--vscode-foreground);
    }
    .skill-card p {
      margin: 0 0 8px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.45;
    }
    .skill-card code {
      display: block;
      font-size: 11px;
      color: var(--vscode-textPreformat-foreground, var(--vscode-descriptionForeground));
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .skill-open-btn {
      min-height: 24px;
      min-width: 58px;
      font-size: 12px;
      border-radius: 999px;
      padding: 0 10px;
    }
    .git-repo-list-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .git-repo-list-head h3 {
      margin: 0;
      font-size: 12px;
    }
    .git-repo-list {
      display: grid;
      gap: 8px;
    }
    .git-repo-item {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      padding: 8px;
      background: color-mix(in srgb, var(--vscode-editor-background) 89%, var(--vscode-button-background) 11%);
      cursor: pointer;
      transition: border-color .16s ease, box-shadow .16s ease;
    }
    .git-repo-item:hover {
      border-color: var(--vscode-focusBorder);
    }
    .git-repo-item:focus-visible {
      outline: none;
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder) 55%, transparent);
    }
    .git-repo-item.is-active {
      border-color: var(--vscode-focusBorder);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder) 45%, transparent);
    }
    .git-repo-item-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .git-repo-name {
      font-size: 12px;
      font-weight: 700;
      color: var(--vscode-button-background);
      line-height: 1.3;
    }
    .git-repo-tag {
      font-size: 11px;
      border-radius: 999px;
      padding: 2px 8px;
      background: color-mix(in srgb, var(--vscode-button-background) 20%, transparent);
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }
    .git-repo-path {
      margin: 0;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      word-break: break-all;
    }
    .git-grid {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .git-kpi {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      padding: 10px;
      background: color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-button-background) 10%);
    }
    .git-kpi h3 {
      margin: 0 0 6px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .git-kpi strong {
      font-size: 14px;
      word-break: break-all;
    }
    .git-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .git-commit {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: center;
    }
    .git-columns {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    .git-col {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      padding: 10px;
      min-height: 130px;
    }
    .git-col h4 {
      margin: 0 0 8px;
      font-size: 12px;
    }
    .path-list, .commit-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
      font-size: 12px;
    }
    .path-list li {
      padding: 5px 7px;
      border-radius: 7px;
      background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-button-background) 12%);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .commit-list li {
      padding: 8px;
      border-radius: 8px;
      border: 1px solid var(--vscode-panel-border);
      background: color-mix(in srgb, var(--vscode-editor-background) 89%, var(--vscode-button-background) 11%);
    }
    .commit-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .commit-head code {
      font-size: 11px;
    }
    .commit-list p {
      margin: 0 0 4px;
      font-size: 12px;
    }
    .commit-list small {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    .git-status {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      border: 1px dashed var(--vscode-panel-border);
      border-radius: 8px;
      padding: 8px;
      margin: 0;
      word-break: break-all;
    }
    .empty, .empty-state {
      border: 1px dashed var(--vscode-panel-border);
      border-radius: 10px;
      padding: 10px;
      color: var(--vscode-descriptionForeground);
      margin: 0;
      font-size: 12px;
      line-height: 1.5;
    }
    .empty h3 {
      margin: 0 0 8px;
      color: var(--vscode-foreground);
      font-size: 13px;
    }
    .git-recent h3 {
      margin: 0 0 8px;
      font-size: 12px;
    }
  </style>
</head>
<body data-mode="${mode}">
  <main class="wrap">
    <section class="panel hero">
      <img src="${model.logoUri}" alt="Skillar logo" />
      <div>
        <h1 class="title">Skillar</h1>
        <p class="sub">技能目录：${safeRoot}</p>
      </div>
    </section>

    <section class="panel tabs">
      <button id="skillsTabBtn" class="tab-btn ${mode === "skills" ? "is-active" : ""}" type="button">技能</button>
      <button id="gitTabBtn" class="tab-btn ${mode === "git" ? "is-active" : ""}" type="button">Git</button>
    </section>

    <section class="panel toolbar">
      <button id="refreshBtn" type="button">刷新技能</button>
      <button id="folderBtn" type="button">打开目录</button>
    </section>

    <section class="skills-panel">
      <section class="panel search-row">
        <input id="searchInput" type="search" placeholder="搜索技能..." />
        <span id="counter" class="counter">${skillsCount} 个技能</span>
      </section>
      <section id="cards" class="cards">${cards}</section>
    </section>

    <section class="git-panel">
      <section class="panel git-repo-list-panel">
        <div class="git-repo-list-head">
          <h3>仓库列表</h3>
          <button id="refreshGitReposBtn" type="button">刷新仓库列表</button>
        </div>
        <div class="git-repo-list">
          ${repositoryListHtml}
        </div>
      </section>

      <section class="panel git-grid">
        <article class="git-kpi">
          <h3>分支</h3>
          <strong>${gitBranch}</strong>
        </article>
        <article class="git-kpi">
          <h3>仓库路径</h3>
          <strong>${gitRepoPath}</strong>
        </article>
        <article class="git-kpi">
          <h3>领先 / 落后</h3>
          <strong>${gitAhead} / ${gitBehind}</strong>
        </article>
        <article class="git-kpi">
          <h3>变更统计</h3>
          <strong>${git?.changed.length ?? 0} 改动 · ${git?.staged.length ?? 0} 暂存 · ${git?.untracked.length ?? 0} 未跟踪</strong>
        </article>
      </section>

      <section class="panel git-actions">
        <button id="refreshGitBtn" type="button" ${hasSelectedRepository ? "" : "disabled"}>刷新仓库</button>
        <button id="openGitFolderBtn" type="button" ${hasSelectedRepository ? "" : "disabled"}>打开仓库目录</button>
      </section>

      <section class="panel git-commit">
        <input id="commitInput" type="text" placeholder="提交信息，例如：feat: 更新技能" ${hasSelectedRepository ? "" : "disabled"} />
        <button id="commitBtn" type="button" ${hasSelectedRepository ? "" : "disabled"}>提交</button>
      </section>

      <section class="panel git-actions">
        <button id="pushBtn" type="button" ${hasSelectedRepository ? "" : "disabled"}>推送</button>
        <button id="backToSkillsBtn" type="button">返回技能</button>
      </section>

      <section class="panel git-columns">
        <article class="git-col">
          <h4>工作区变更</h4>
          ${renderPathList(git?.changed ?? [], "当前没有工作区变更。")}
        </article>
        <article class="git-col">
          <h4>暂存文件</h4>
          ${renderPathList(git?.staged ?? [], "当前没有暂存文件。")}
        </article>
        <article class="git-col">
          <h4>未跟踪文件</h4>
          ${renderPathList(git?.untracked ?? [], "当前没有未跟踪文件。")}
        </article>
      </section>

      <section class="panel git-recent">
        <h3>最近提交</h3>
        ${renderRecentCommits(git)}
      </section>

      ${gitMessage ? `<p class="git-status">${gitMessage}</p>` : ""}
      ${
        !hasSelectedRepository
          ? `<p class="empty-state">当前未选择仓库。请先在上方仓库列表中选择一个仓库。</p>`
          : (git ? "" : `<p class="empty-state">当前仓库无法读取 Git 状态，请点击“刷新仓库”重试。</p>`)
      }
    </section>
  </main>

  <script>
    const vscode = acquireVsCodeApi();
    const cardsEl = document.getElementById("cards");
    const searchInputEl = document.getElementById("searchInput");
    const counterEl = document.getElementById("counter");
    const bodyEl = document.body;
    const skillsTabBtn = document.getElementById("skillsTabBtn");
    const gitTabBtn = document.getElementById("gitTabBtn");

    const post = (type, payload = {}) => vscode.postMessage({ type, ...payload });

    const syncTabState = () => {
      const mode = bodyEl.dataset.mode || "skills";
      skillsTabBtn.classList.toggle("is-active", mode === "skills");
      gitTabBtn.classList.toggle("is-active", mode === "git");
    };

    const switchMode = (mode) => {
      bodyEl.dataset.mode = mode;
      syncTabState();
    };

    const updateFilter = () => {
      const query = (searchInputEl.value || "").trim().toLowerCase();
      const cards = Array.from(document.querySelectorAll(".skill-card"));
      let visible = 0;
      for (const card of cards) {
        const text = (card.getAttribute("data-search") || "").toLowerCase();
        const match = !query || text.includes(query);
        card.style.display = match ? "" : "none";
        if (match) {
          visible += 1;
        }
      }
      counterEl.textContent = visible + " 个技能";
    };

    syncTabState();
    searchInputEl?.addEventListener("input", updateFilter);

    document.getElementById("refreshBtn")?.addEventListener("click", () => post("refresh"));
    document.getElementById("folderBtn")?.addEventListener("click", () => post("openFolder"));

    skillsTabBtn?.addEventListener("click", () => {
      switchMode("skills");
      post("openSkills");
    });
    gitTabBtn?.addEventListener("click", () => {
      switchMode("git");
      post("openGit");
    });
    document.getElementById("backToSkillsBtn")?.addEventListener("click", () => {
      switchMode("skills");
      post("openSkills");
    });

    document.getElementById("refreshGitReposBtn")?.addEventListener("click", () => post("refreshGitRepos"));
    document.getElementById("refreshGitBtn")?.addEventListener("click", () => post("refreshGit"));
    document.getElementById("openGitFolderBtn")?.addEventListener("click", () => post("openGitFolder"));
    document.getElementById("pushBtn")?.addEventListener("click", () => post("pushGit"));
    document.getElementById("commitBtn")?.addEventListener("click", () => {
      const input = document.getElementById("commitInput");
      const message = input instanceof HTMLInputElement ? input.value.trim() : "";
      post("commitGit", { message });
    });

    cardsEl?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const button = target.closest("[data-open-skill]");
      if (!(button instanceof HTMLElement)) {
        return;
      }
      const skillMdPath = button.getAttribute("data-open-skill");
      if (!skillMdPath) {
        return;
      }
      post("openSkill", { skillMdPath });
    });

    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const repoButton = target.closest("[data-select-repo]");
      if (!(repoButton instanceof HTMLElement)) {
        return;
      }
      const repositoryId = repoButton.getAttribute("data-select-repo");
      if (!repositoryId) {
        return;
      }
      post("selectGitRepo", { repositoryId });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const repoCard = target.closest("[data-select-repo]");
      if (!(repoCard instanceof HTMLElement)) {
        return;
      }
      const repositoryId = repoCard.getAttribute("data-select-repo");
      if (!repositoryId) {
        return;
      }
      event.preventDefault();
      post("selectGitRepo", { repositoryId });
    });
  </script>
</body>
</html>`;
}

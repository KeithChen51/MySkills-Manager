import assert from "node:assert/strict";
import test from "node:test";

import { createDashboardHtml } from "../src/dashboardHtml";

test("git mode hides top toolbar actions", () => {
  const html = createDashboardHtml({
    rootPath: "C:/Users/Keith/my-skills",
    logoUri: "file:///logo.png",
    skills: [],
    mode: "git",
    gitRepositories: [],
    selectedGitRepositoryId: null,
    gitOverview: null,
    gitStatusMessage: "",
  });

  assert.ok(
    html.includes('body[data-mode="git"] .toolbar { display: none; }'),
    "toolbar should be hidden in git mode",
  );
});

test("git mode renders repository list section", () => {
  const html = createDashboardHtml({
    rootPath: "C:/Users/Keith/my-skills",
    logoUri: "file:///logo.png",
    skills: [],
    mode: "git",
    gitRepositories: [],
    selectedGitRepositoryId: null,
    gitOverview: null,
    gitStatusMessage: "",
  });

  assert.ok(
    html.includes("git-repo-list"),
    "git home should render repository list container",
  );
});

test("git repository card uses full-card click target", () => {
  const html = createDashboardHtml({
    rootPath: "C:/Users/Keith/my-skills",
    logoUri: "file:///logo.png",
    skills: [],
    mode: "git",
    gitRepositories: [
      {
        id: "repo-1",
        name: "repo-1",
        alias: "My Repo",
        url: "https://example.com/repo.git",
        provider: "github",
        syncMode: "direct",
        sourcePath: "C:/Users/Keith/my-skills",
        localPath: "C:/Users/Keith/my-skills",
        isSyncing: false,
        ignorePaths: [],
      },
    ],
    selectedGitRepositoryId: "repo-1",
    gitOverview: null,
    gitStatusMessage: "",
  });

  assert.ok(
    html.includes('data-select-repo="repo-1"'),
    "repository article should be the click target",
  );
  assert.ok(
    html.includes('role="button"'),
    "repository article should remain keyboard accessible",
  );
});

test("skills toolbar does not render open git button", () => {
  const html = createDashboardHtml({
    rootPath: "C:/Users/Keith/my-skills",
    logoUri: "file:///logo.png",
    skills: [],
    mode: "skills",
    gitRepositories: [],
    selectedGitRepositoryId: null,
    gitOverview: null,
    gitStatusMessage: "",
  });

  assert.ok(
    !html.includes('id="gitBtn"'),
    "skills toolbar should not include open git button",
  );
});

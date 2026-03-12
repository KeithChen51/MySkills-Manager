import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("package script outputs VSIX to release directory", async () => {
  const packageJsonPath = path.join(process.cwd(), "package.json");
  const content = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(content) as { scripts?: Record<string, string> };

  const script = packageJson.scripts?.package;
  assert.equal(
    script,
    "npm run build && vsce package --allow-missing-repository --out ../release/skillar-vscode.vsix",
  );
});

test("manifest contributes single webview in skillar container and git command", async () => {
  const packageJsonPath = path.join(process.cwd(), "package.json");
  const content = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(content) as {
    icon?: string;
    version?: string;
    contributes?: {
      commands?: Array<{ command: string }>;
      views?: Record<string, Array<{ id: string; name?: string; type?: string }>>;
      viewsContainers?: {
        activitybar?: Array<{ id: string; title?: string; icon?: string }>;
      };
    };
  };

  const commands = new Set(
    (packageJson.contributes?.commands || []).map((item) => item.command),
  );
  assert.ok(commands.has("skillar.openGitView"));
  assert.ok(!commands.has("skillar.openDashboard"));
  assert.ok(!commands.has("skillar.openDashboardBeside"));

  const containers = packageJson.contributes?.viewsContainers?.activitybar || [];
  assert.equal(containers.length, 1);
  assert.equal(containers[0]?.id, "skillar");
  assert.equal(containers[0]?.icon, "media/skillar-activity-logo.png");

  const skillarViews = (packageJson.contributes?.views || {}).skillar || [];
  assert.equal(skillarViews.length, 1);
  assert.equal(skillarViews[0]?.id, "skillarSkills");
  assert.equal(skillarViews[0]?.name, "Skillar");
  assert.equal(skillarViews[0]?.type, "webview");

  assert.equal(packageJson.icon, "media/skillar-icon-centered-light.png");
  assert.equal(packageJson.version, "0.1.4");
});

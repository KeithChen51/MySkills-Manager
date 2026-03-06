import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readSource(relativePath: string) {
  const filePath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(filePath, "utf8");
}

test("SkillsPage provides conflict detail, filtering, and resolve actions", () => {
  const pageSource = readSource("src/pages/SkillsPage.tsx");
  const controllerSource = readSource("src/pages/skills/useSkillsPageController.ts");
  const drawerSource = readSource("src/pages/skills/SkillConflictDrawer.tsx");
  const diffViewSource = readSource("src/pages/skills/useConflictDiffView.ts");

  assert.ok(
    pageSource.includes("useSkillsPageController"),
    "SkillsPage should delegate conflict logic to the page controller hook",
  );
  assert.ok(
    pageSource.includes("handleOpenConflictResolver"),
    "SkillsPage should expose a dedicated conflict detail action",
  );
  assert.ok(
    pageSource.includes("handleResolveConflict"),
    "SkillsPage should expose a dedicated conflict resolve action",
  );
  assert.ok(
    controllerSource.includes("setupGetSkillConflictDetail("),
    "Controller should request conflict detail when user opens a conflict",
  );
  assert.ok(
    controllerSource.includes("setupResolveSkillConflict("),
    "Controller should call resolve API when user chooses a source",
  );
  assert.ok(
    diffViewSource.includes("!variant.hashMatchesMySkills"),
    "Conflict diff view should hide variants that already match baseline",
  );
  assert.ok(
    diffViewSource.includes("buildSkillDiff("),
    "Conflict diff view should build readable diff between baseline and conflicting variants",
  );
  assert.ok(
    drawerSource.includes("conflictViewMode"),
    "Conflict drawer should keep explicit conflict diff view mode state",
  );
  assert.ok(
    drawerSource.includes('t("skills.conflict.view.diff")'),
    "Conflict drawer should offer changed-lines mode in conflict drawer",
  );
  assert.ok(
    drawerSource.includes('t("skills.conflict.view.full")'),
    "Conflict drawer should offer full-content mode in conflict drawer",
  );
  assert.ok(
    drawerSource.includes('t("skills.conflict.action.applyBaseline")'),
    "Conflict drawer should offer a primary action to set selected source as baseline",
  );
});

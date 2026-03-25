import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(filePath) {
  return fs.readFileSync(path.join(root, filePath), "utf8");
}

function assertCheck(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function checkRegex(filePath, regex, message) {
  const content = read(filePath);
  assertCheck(regex.test(content), `${message} (${filePath})`);
}

function checkNoRegex(filePath, regex, message) {
  const content = read(filePath);
  assertCheck(!regex.test(content), `${message} (${filePath})`);
}

function run() {
  const packageJson = JSON.parse(read("package.json"));
  assertCheck(
    typeof packageJson.scripts?.["test:ui-regression"] === "string",
    "Missing npm script `test:ui-regression` (package.json)",
  );

  checkRegex(
    "src/styles/primitives.css",
    /\.page\s*\{[^}]*overflow-y:\s*auto;/m,
    "Primary page scroll container must keep overflow-y:auto",
  );

  checkRegex(
    "src/App.css",
    /\.app-shell\s*\{[^}]*overflow:\s*clip;/m,
    "App shell should use overflow:clip to avoid unintended parent scroll containers",
  );

  checkRegex(
    "src/pages/SkillToolsPage.css",
    /\.skill-tools-shell\s*\{[^}]*overflow:\s*clip;/m,
    "Skill/tools shell should use overflow:clip",
  );
  checkRegex(
    "src/pages/SkillToolsPage.css",
    /\.skill-tools-pane\s*\{[^}]*overflow:\s*clip;/m,
    "Skill/tools pane should use overflow:clip",
  );

  checkRegex(
    "src/pages/GitPage.css",
    /\.git-page\s*\{[^}]*overflow-y:\s*auto;/m,
    "Git page root should keep vertical scrolling enabled",
  );
  checkNoRegex(
    "src/pages/GitPage.css",
    /\.git-page\s*\{[^}]*overflow:\s*hidden;/m,
    "Git page root must not lock scrolling with overflow:hidden",
  );

  checkNoRegex(
    "src/pages/tools/ToolCard.tsx",
    /className=\"tool-card-info-icon\"[\s\S]*role=\"img\"/m,
    "Info hint icon must not use role=img interactive pattern",
  );
  checkNoRegex(
    "src/pages/tools/ToolCard.tsx",
    /className=\"tool-card-info-icon\"[\s\S]*tabIndex=\{0\}/m,
    "Info hint icon must not be focusable span",
  );
  checkRegex(
    "src/pages/tools/ToolCard.tsx",
    /aria-describedby=\{syncDirectionHintId\}/,
    "Sync button should expose direction hint via aria-describedby",
  );
  checkRegex(
    "src/pages/tools/ToolCard.tsx",
    /className=\"sr-only\"/,
    "Screen-reader-only hint class should be used for sync direction",
  );

  const pageRoots = [
    "src/pages/ToolsPage.tsx",
    "src/pages/SkillsPage.tsx",
    "src/pages/GitPage.tsx",
    "src/pages/EvalPage.tsx",
    "src/pages/SettingsPage.tsx",
  ];
  for (const filePath of pageRoots) {
    checkRegex(
      filePath,
      /className=\"page[^\"]*\"/,
      "Page root should include shared `.page` shell class",
    );
  }

  if (failures.length > 0) {
    console.error("UI regression guard failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`UI regression guard passed (${pageRoots.length + 10} checks).`);
}

run();

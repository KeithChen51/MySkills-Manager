import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(pathFromRoot: string) {
  return fs.readFileSync(path.resolve(process.cwd(), pathFromRoot), "utf8");
}

function readTokenValue(source: string, tokenName: string): string | null {
  const match = source.match(new RegExp(`${tokenName}:\\s*([^;]+);`));
  return match?.[1]?.trim() ?? null;
}

test("Tools and Skills layouts avoid rigid 420/520 min-width columns", () => {
  const toolsCss = read("src/pages/ToolsPage.css");
  const skillsCss = read("src/pages/SkillsPage.css");

  assert.ok(
    !/minmax\(520px,\s*1fr\)/.test(toolsCss),
    "Tools grid should not keep a rigid 520px column minimum",
  );
  assert.ok(
    !/minmax\(420px,\s*1fr\)/.test(skillsCss),
    "Skills grid should not keep a rigid 420px column minimum",
  );
  assert.match(
    toolsCss,
    /clamp\(/,
    "Tools layout should use clamp()-based responsive column strategy",
  );
  assert.match(
    skillsCss,
    /clamp\(/,
    "Skills layout should use clamp()-based responsive column strategy",
  );
});

test("Drawer min-width token is viewport-friendly and no longer fixed at 540px", () => {
  const tokens = read("src/styles/tokens.css");
  const drawerMinWidth = readTokenValue(tokens, "--drawer-min-width");

  assert.notEqual(drawerMinWidth, null, "tokens.css should define --drawer-min-width");
  assert.ok(
    drawerMinWidth !== "540px",
    `--drawer-min-width should not remain fixed at 540px, got ${drawerMinWidth}`,
  );
  assert.ok(
    drawerMinWidth?.includes("clamp(") || /^([0-9]{2,3})px$/.test(drawerMinWidth ?? ""),
    `--drawer-min-width should use clamp() or a smaller fixed px value, got ${drawerMinWidth}`,
  );
});

test("Logs page path column width uses adaptive clamp instead of fixed 420px", () => {
  const logsCss = read("src/pages/LogsPage.css");

  assert.ok(
    !/max-width:\s*420px;/.test(logsCss),
    "Logs path cell should avoid fixed 420px max-width",
  );
  assert.match(
    logsCss,
    /max-width:\s*clamp\(/,
    "Logs path cell should use clamp()-based max-width",
  );
});

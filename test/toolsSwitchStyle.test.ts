import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

test("tool switch active state uses common green/white palette", () => {
  const cssPath = path.resolve("src/pages/ToolsPage.css");
  const tokensPath = path.resolve("src/styles/tokens.css");
  const css = fs.readFileSync(cssPath, "utf8");
  const tokens = fs.readFileSync(tokensPath, "utf8");

  assert.match(
    css,
    /\.tool-switch\.active\s*\{[\s\S]*background:\s*var\(--switch-track-active\);[\s\S]*\}/,
  );

  assert.match(
    css,
    /\.tool-switch-thumb\s*\{[\s\S]*background:\s*var\(--switch-thumb\);[\s\S]*\}/,
  );

  assert.match(
    tokens,
    /--switch-track-active:\s*#[0-9a-fA-F]{6};/,
  );

  assert.match(
    tokens,
    /--switch-thumb:\s*#[0-9a-fA-F]{6};/,
  );
});

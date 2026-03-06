import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("frontend entry uses bundled local fonts instead of Google Fonts", () => {
  const mainSource = readSource("src/main.tsx");
  const indexCss = readSource("src/index.css");
  const packageJson = JSON.parse(readSource("package.json")) as {
    dependencies?: Record<string, string>;
  };

  assert.ok(
    packageJson.dependencies?.["@fontsource/inter"],
    "package.json should include @fontsource/inter",
  );
  assert.ok(
    packageJson.dependencies?.["@fontsource/jetbrains-mono"],
    "package.json should include @fontsource/jetbrains-mono",
  );
  assert.match(
    mainSource,
    /@fontsource\/inter/,
    "main.tsx should import Inter from a bundled package",
  );
  assert.match(
    mainSource,
    /@fontsource\/jetbrains-mono/,
    "main.tsx should import JetBrains Mono from a bundled package",
  );
  assert.doesNotMatch(
    indexCss,
    /fonts\.googleapis\.com/i,
    "index.css should not depend on Google Fonts",
  );
});

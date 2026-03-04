import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidebarSource = readFileSync(
  new URL("../src/components/Sidebar.tsx", import.meta.url),
  "utf8",
);
const readmeSource = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("Sidebar uses design-pack transparent and white-bg logo assets", () => {
  assert.match(
    sidebarSource,
    /skillar-design-pack\/logo\/skillar-logo-transparent\.png/,
  );
  assert.match(
    sidebarSource,
    /skillar-design-pack\/logo\/skillar-logo-white-bg\.png/,
  );
  assert.doesNotMatch(sidebarSource, /["'`]\/skillar-logo-transparent\.png["'`]/);
  assert.doesNotMatch(sidebarSource, /["'`]\/skillar-logo-white\.png["'`]/);
});

test("README hero logo uses centered light logo asset", () => {
  assert.match(
    readmeSource,
    /skillar-design-pack\/logo\/skillar-icon-centered-light\.png/,
  );
});

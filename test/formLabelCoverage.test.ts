import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(pathFromRoot: string) {
  return fs.readFileSync(path.resolve(process.cwd(), pathFromRoot), "utf8");
}

test("Skills search input has explicit accessible name", () => {
  const source = read("src/pages/SkillsPage.tsx");

  assert.match(
    source,
    /className="search-input"[\s\S]*aria-label=\{t\("skills.search"\)\}/,
    "Skills search input should expose aria-label for screen readers",
  );
});

test("Onboarding skills directory input has label and id binding", () => {
  const source = read("src/components/OnboardingWizard.tsx");

  assert.match(
    source,
    /<label[\s\S]*htmlFor="onboarding-skills-dir-input"/,
    "Onboarding skills directory input should have explicit label htmlFor binding",
  );
  assert.match(
    source,
    /id="onboarding-skills-dir-input"/,
    "Onboarding skills directory input should define matching id",
  );
});

test("Settings skills directory input has label and id binding", () => {
  const source = read("src/pages/SettingsPage.tsx");

  assert.match(
    source,
    /<label[\s\S]*htmlFor="settings-skills-dir-input"/,
    "Settings skills directory input should have explicit label htmlFor binding",
  );
  assert.match(
    source,
    /id="settings-skills-dir-input"/,
    "Settings skills directory input should define matching id",
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseUpdaterReleaseNotes,
  resolveUpdaterDownloadUrl,
} from "../src/updater/releaseNotes.ts";

test("parseUpdaterReleaseNotes parses json structured notes", () => {
  const parsed = parseUpdaterReleaseNotes(
    JSON.stringify({
      release_notes: "English note",
      release_notes_zh: "中文说明",
    }),
  );
  assert.equal(parsed.releaseNotes, "English note");
  assert.equal(parsed.releaseNotesZh, "中文说明");
});

test("parseUpdaterReleaseNotes falls back to plain text", () => {
  const parsed = parseUpdaterReleaseNotes("## v0.2.0\n- improve updater");
  assert.equal(parsed.releaseNotes, "## v0.2.0\n- improve updater");
  assert.equal(parsed.releaseNotesZh, "## v0.2.0\n- improve updater");
});

test("resolveUpdaterDownloadUrl prefers windows platform url", () => {
  const url = resolveUpdaterDownloadUrl("0.2.0", {
    platforms: {
      "windows-x86_64": {
        url: "https://github.com/acme/app/releases/download/v0.2.0/latest.json",
      },
    },
  });
  assert.equal(
    url,
    "https://github.com/acme/app/releases/download/v0.2.0/latest.json",
  );
});

test("resolveUpdaterDownloadUrl falls back to tag page", () => {
  const url = resolveUpdaterDownloadUrl("0.2.0", null);
  assert.equal(
    url,
    "https://github.com/KeithChen51/MySkills-Manager/releases/tag/v0.2.0",
  );
});

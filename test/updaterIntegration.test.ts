import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readTauriConfig() {
  const configPath = path.resolve(process.cwd(), "src-tauri/tauri.conf.json");
  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw) as {
    plugins?: {
      updater?: {
        endpoints?: string[];
        pubkey?: string;
      };
    };
  };
}

function readSettingsPageSource() {
  const pagePath = path.resolve(process.cwd(), "src/pages/SettingsPage.tsx");
  return fs.readFileSync(pagePath, "utf8");
}

test("tauri config defines updater endpoint and public key", () => {
  const config = readTauriConfig();
  const updater = config.plugins?.updater;

  assert.ok(updater, "tauri config should define plugins.updater");
  assert.ok(
    Array.isArray(updater.endpoints) && updater.endpoints.length > 0,
    "updater endpoints should be configured",
  );
  assert.ok(
    updater.endpoints?.some((value) =>
      value.includes("/KeithChen51/MySkills-Manager/releases/latest/download/latest.json"),
    ),
    "updater endpoint should target GitHub latest.json",
  );
  assert.ok(
    typeof updater.pubkey === "string" && updater.pubkey.trim().length > 0,
    "updater pubkey should be configured",
  );
});

test("Settings page wires updater check and relaunch flow", () => {
  const source = readSettingsPageSource();

  assert.ok(
    source.includes("@tauri-apps/plugin-updater"),
    "Settings page should import updater plugin bindings",
  );
  assert.ok(
    source.includes("check("),
    "Settings page should call updater check",
  );
  assert.ok(
    source.includes("downloadAndInstall"),
    "Settings page should trigger download and install when update exists",
  );
  assert.ok(
    source.includes("@tauri-apps/plugin-process"),
    "Settings page should import process plugin bindings",
  );
  assert.ok(
    source.includes("relaunch("),
    "Settings page should relaunch app after installing update",
  );
});

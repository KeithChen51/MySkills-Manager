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

function readAppSource() {
  const appPath = path.resolve(process.cwd(), "src/App.tsx");
  return fs.readFileSync(appPath, "utf8");
}

test("tauri config defines GitHub updater endpoint and public key", () => {
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

test("App wires shared updater hook and update dialogs", () => {
  const source = readAppSource();

  assert.ok(
    source.includes("useAppUpdater"),
    "App should use shared updater hook",
  );
  assert.ok(
    source.includes("UpdateNotification"),
    "App should render update notification dialog",
  );
  assert.ok(
    source.includes("VersionJumpNotification"),
    "App should render version jump dialog",
  );
});

test("Settings page exposes updater policy controls and manual check trigger", () => {
  const source = readSettingsPageSource();

  assert.ok(
    source.includes("settings.update.autoCheck.label"),
    "Settings page should render auto-check control",
  );
  assert.ok(
    source.includes("settings.update.autoInstall.label"),
    "Settings page should render auto-install control",
  );
  assert.ok(
    source.includes("settings.update.interval.24h"),
    "Settings page should render update interval options",
  );
  assert.ok(
    source.includes("onOpenUpdateDialog"),
    "Settings page should delegate manual check to shared updater flow",
  );
});

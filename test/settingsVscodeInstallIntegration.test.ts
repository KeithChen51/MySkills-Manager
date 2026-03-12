import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readSettingsPageSource() {
  const pagePath = path.resolve(process.cwd(), "src/pages/SettingsPage.tsx");
  return fs.readFileSync(pagePath, "utf8");
}

function readTauriApiSource() {
  const apiPath = path.resolve(process.cwd(), "src/api/tauri.ts");
  return fs.readFileSync(apiPath, "utf8");
}

function readI18nSource() {
  const i18nPath = path.resolve(process.cwd(), "src/i18n/messages.ts");
  return fs.readFileSync(i18nPath, "utf8");
}

test("Settings page exposes VS Code extension install action", () => {
  const source = readSettingsPageSource();

  assert.ok(
    source.includes("installVscodeExtension"),
    "Settings page should use installVscodeExtension API",
  );
  assert.ok(
    source.includes("settings.vscode.install.button"),
    "Settings page should render VS Code install button label",
  );
  assert.ok(
    source.includes("settings.vscode.installing"),
    "Settings page should render installing status text",
  );
  assert.ok(
    source.includes("handleInstallVscodeExtension"),
    "Settings page should define install action handler",
  );
  assert.ok(
    source.includes("handleUninstallVscodeExtension"),
    "Settings page should define uninstall action handler",
  );
  assert.ok(
    source.includes("await installVscodeExtension(skillsDir"),
    "Settings page should pass current skillsDir to install command",
  );
  assert.ok(
    source.includes("await uninstallVscodeExtension()"),
    "Settings page should invoke uninstall command",
  );
  assert.ok(
    source.includes("await getVscodeExtensionStatus()"),
    "Settings page should refresh extension status from backend",
  );
  assert.ok(
    source.includes("vscodeInstallStatus"),
    "Settings page should keep dedicated install status near VS Code section",
  );
  assert.ok(
    source.includes("settings-vscode-status"),
    "Settings page should render inline VS Code install status message",
  );
});

test("Settings page marks extension as not installed immediately after uninstall", () => {
  const source = readSettingsPageSource();
  const uninstallStart = source.indexOf("async function handleUninstallVscodeExtension()");
  assert.ok(uninstallStart >= 0, "Settings page should define uninstall handler");

  const uninstallBlock = source.slice(
    uninstallStart,
    source.indexOf("return (", uninstallStart),
  );
  assert.ok(
    uninstallBlock.includes("setVscodeInstalled(false)"),
    "Uninstall flow should immediately clear installed badge in UI",
  );
});

test("Tauri API exposes vscode_extension_install command wrapper", () => {
  const source = readTauriApiSource();

  assert.ok(
    source.includes("type VscodeExtensionInstallResult"),
    "API should export VS Code extension install result type",
  );
  assert.ok(
    source.includes("installVscodeExtension("),
    "API should expose installVscodeExtension function",
  );
  assert.ok(
    source.includes("getVscodeExtensionStatus("),
    "API should expose getVscodeExtensionStatus function",
  );
  assert.ok(
    source.includes("uninstallVscodeExtension("),
    "API should expose uninstallVscodeExtension function",
  );
  assert.ok(
    source.includes("vscode_extension_install"),
    "API should invoke vscode_extension_install backend command",
  );
  assert.ok(
    source.includes("vscode_extension_status"),
    "API should invoke vscode_extension_status backend command",
  );
  assert.ok(
    source.includes("vscode_extension_uninstall"),
    "API should invoke vscode_extension_uninstall backend command",
  );
});

test("i18n messages include VS Code extension install keys", () => {
  const source = readI18nSource();

  for (const key of [
    "settings.vscode.title",
    "settings.vscode.help",
    "settings.vscode.install.button",
    "settings.vscode.installing",
    "settings.vscode.install.done",
    "settings.vscode.install.failed",
    "settings.vscode.uninstall.button",
    "settings.vscode.uninstalling",
    "settings.vscode.uninstall.done",
    "settings.vscode.uninstall.failed",
    "settings.vscode.status.checking",
    "settings.vscode.status.installed",
    "settings.vscode.status.notInstalled",
    "settings.vscode.sharedData.note",
    "settings.vscode.sync.done",
    "settings.vscode.sync.failed",
  ]) {
    assert.ok(source.includes(`"${key}"`), `messages should include ${key}`);
  }
});

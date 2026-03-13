import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";

import {
  evalGetConfig,
  evalSaveConfig,
  getVscodeExtensionStatus,
  installVscodeExtension,
  syncVscodeSkillsRoot,
  uninstallVscodeExtension,
  type CostCurrency,
  type EvalConfig,
  type UpdateSettings,
  onboardingGetState,
  onboardingSetSkillsDir,
  setupGetImportMode,
  setupSetImportMode,
} from "../api/tauri";
import { useI18n } from "../i18n/I18nProvider";
import type { Locale, MessageKey } from "../i18n/messages";
import { useTheme, type ThemeMode } from "../theme/ThemeProvider";
import "./SettingsPage.css";

type Props = {
  onSkillsDirChanged: () => void;
  updaterSettings: UpdateSettings;
  updaterSettingsLoading: boolean;
  updaterSettingsSaving: boolean;
  updateCheckBusy: boolean;
  onUpdateSettingsPatch: (patch: Partial<UpdateSettings>) => void;
  onOpenUpdateDialog: () => void;
};

function formatStatusError(
  error: unknown,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  const raw = String(error);
  if (raw.includes("skills dir does not exist")) {
    return t("onboard.error.dirMissing");
  }
  if (raw.includes("skills dir is required")) {
    return t("tools.validation.skillsRequired");
  }
  return raw;
}

function normalizeCostCurrency(value: string | undefined): CostCurrency {
  return value === "CNY" ? "CNY" : "USD";
}

export default function SettingsPage({
  onSkillsDirChanged,
  updaterSettings,
  updaterSettingsLoading,
  updaterSettingsSaving,
  updateCheckBusy,
  onUpdateSettingsPatch,
  onOpenUpdateDialog,
}: Props) {
  const { t, locale, setLocale } = useI18n();
  const { themeMode, setThemeMode } = useTheme();
  const [skillsDir, setSkillsDir] = useState("");
  const [importMode, setImportMode] = useState("manual");
  const [apiConfig, setApiConfig] = useState<EvalConfig>({
    apiKey: "",
    provider: "openai-compatible",
    defaultModel: "gpt-4o-mini",
    costCurrency: "USD",
  });
  const [busy, setBusy] = useState(false);
  const [apiBusy, setApiBusy] = useState(false);
  const [vscodeInstalled, setVscodeInstalled] = useState<boolean | null>(null);
  const [vscodeInstallBusy, setVscodeInstallBusy] = useState(false);
  const [vscodeUninstallBusy, setVscodeUninstallBusy] = useState(false);
  const [vscodeInstallStatus, setVscodeInstallStatus] = useState("");
  const [appVersion, setAppVersion] = useState("-");
  const [status, setStatus] = useState("");

  useEffect(() => {
    setBusy(true);
    void Promise.all([
      onboardingGetState(),
      setupGetImportMode(),
      evalGetConfig(),
      getVersion().catch(() => "-"),
      getVscodeExtensionStatus().catch(() => null),
    ])
      .then(([state, mode, evalConfig, version, vscodeStatus]) => {
        setSkillsDir(state.skillsDir);
        setImportMode(mode);
        setApiConfig({
          apiKey: evalConfig.apiKey,
          provider: evalConfig.provider || "openai-compatible",
          baseUrl: evalConfig.baseUrl,
          defaultModel: evalConfig.defaultModel || "gpt-4o-mini",
          costCurrency: normalizeCostCurrency(evalConfig.costCurrency),
        });
        setAppVersion(version);
        if (vscodeStatus) {
          setVscodeInstalled(vscodeStatus.installed);
        } else {
          setVscodeInstalled(null);
        }
        setStatus("");
      })
      .catch((error: unknown) => {
        setStatus(formatStatusError(error, t));
      })
      .finally(() => {
        setBusy(false);
      });
  }, [t]);

  async function handlePickPath() {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: skillsDir,
      title: t("onboard.step1.title"),
    });
    if (typeof selected === "string") {
      setSkillsDir(selected);
    }
  }

  async function handleSaveSkillsDir() {
    const normalized = skillsDir.trim();
    if (!normalized) {
      setStatus(formatStatusError("skills dir is required", t));
      return;
    }

    setBusy(true);
    setStatus(t("onboard.path.checking"));
    try {
      let result: Awaited<ReturnType<typeof onboardingSetSkillsDir>>;
      try {
        result = await onboardingSetSkillsDir(normalized);
      } catch (error: unknown) {
        const message = String(error);
        if (message.includes("skills dir does not exist") && window.confirm(t("onboard.path.create.confirm"))) {
          result = await onboardingSetSkillsDir(normalized, true);
        } else {
          throw error;
        }
      }
      let syncNote = "";
      try {
        const syncResult = await syncVscodeSkillsRoot(normalized);
        syncNote = ` ${t("settings.vscode.sync.done", { path: syncResult.settingsPath })}`;
      } catch (syncError: unknown) {
        syncNote = ` ${t("settings.vscode.sync.failed")}: ${String(syncError)}`;
      }
      setStatus(`${t("tools.path.saved")} (${result.skills.length}).${syncNote}`);
      onSkillsDirChanged();
    } catch (error: unknown) {
      setStatus(formatStatusError(error, t));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveApiConfig() {
    setApiBusy(true);
    setStatus(t("settings.evalConfig.saving"));
    try {
      const normalized: EvalConfig = {
        apiKey: apiConfig.apiKey.trim(),
        provider: "openai-compatible",
        baseUrl: apiConfig.baseUrl?.trim() || undefined,
        defaultModel: apiConfig.defaultModel.trim() || "gpt-4o-mini",
        costCurrency: normalizeCostCurrency(apiConfig.costCurrency),
      };
      await evalSaveConfig(normalized);
      setApiConfig(normalized);
      setStatus(t("settings.evalConfig.saved"));
    } catch (error: unknown) {
      setStatus(`${t("settings.evalConfig.failed")}: ${String(error)}`);
    } finally {
      setApiBusy(false);
    }
  }

  async function handleInstallVscodeExtension() {
    if (!skillsDir.trim()) {
      const message = formatStatusError("skills dir is required", t);
      setStatus(message);
      setVscodeInstallStatus(message);
      return;
    }

    if (vscodeInstalled) {
      const installedMessage = t("settings.vscode.status.installed");
      setVscodeInstallStatus(installedMessage);
      setStatus(installedMessage);
      return;
    }

    setVscodeInstallBusy(true);
    setVscodeInstallStatus(t("settings.vscode.installing"));
    setStatus(t("settings.vscode.installing"));
    try {
      const result = await installVscodeExtension(skillsDir);
      const statusResult = await getVscodeExtensionStatus();
      setVscodeInstalled(statusResult.installed);
      const message = `${t("settings.vscode.install.done", {
        path: result.settingsPath,
      })} (CLI: ${result.vscodeCli}) ${t("settings.vscode.install.reloadHint")}`;
      setVscodeInstallStatus(message);
      setStatus(message);
    } catch (error: unknown) {
      const message = `${t("settings.vscode.install.failed")}: ${String(error)}`;
      setVscodeInstallStatus(message);
      setStatus(message);
    } finally {
      setVscodeInstallBusy(false);
    }
  }

  async function handleUninstallVscodeExtension() {
    if (!vscodeInstalled) {
      const message = t("settings.vscode.status.notInstalled");
      setVscodeInstallStatus(message);
      setStatus(message);
      return;
    }

    setVscodeUninstallBusy(true);
    const uninstallingMessage = t("settings.vscode.uninstalling");
    setVscodeInstallStatus(uninstallingMessage);
    setStatus(uninstallingMessage);
    try {
      const result = await uninstallVscodeExtension();
      setVscodeInstalled(false);
      const message = `${t("settings.vscode.uninstall.done")} (CLI: ${result.vscodeCli})`;
      setVscodeInstallStatus(message);
      setStatus(message);
    } catch (error: unknown) {
      const message = `${t("settings.vscode.uninstall.failed")}: ${String(error)}`;
      setVscodeInstallStatus(message);
      setStatus(message);
    } finally {
      setVscodeUninstallBusy(false);
    }
  }

  return (
    <div className="page animate-fadein settings-page">
      <header className="page-header">
        <h1 className="page-title">{t("nav.settings")}</h1>
      </header>

      <section className="chart-card settings-card">
        <h2 className="chart-title">{t("onboard.step3.skillsDir")}</h2>
        <p className="settings-help">{t("onboard.step1.desc")}</p>
        <div className="settings-row">
          <input
            className="field-input settings-path-input"
            value={skillsDir}
            onChange={(e) => setSkillsDir(e.target.value)}
            placeholder="C:\\Users\\Keith\\my-skills"
            disabled={busy}
          />
          <button type="button" className="btn btn-ghost" onClick={() => void handlePickPath()} disabled={busy}>
            {t("onboard.path.pick")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSaveSkillsDir()}
            disabled={busy}
          >
            {busy ? t("tools.path.saving") : t("tools.path.save")}
          </button>
        </div>
      </section>

      <section className="chart-card settings-card">
        <h2 className="chart-title">{t("settings.update.title")}</h2>
        <p className="settings-help">{t("settings.update.help")}</p>
        <div className="settings-row settings-update-policy-row">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={updaterSettings.auto_check}
              disabled={updaterSettingsLoading || updaterSettingsSaving}
              onChange={(e) => onUpdateSettingsPatch({ auto_check: e.target.checked })}
            />
            <span>{t("settings.update.autoCheck.label")}</span>
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={updaterSettings.auto_install}
              disabled={updaterSettingsLoading || updaterSettingsSaving}
              onChange={(e) => onUpdateSettingsPatch({ auto_install: e.target.checked })}
            />
            <span>{t("settings.update.autoInstall.label")}</span>
          </label>
        </div>
        <p className="settings-help">{t("settings.update.autoCheck.help")}</p>
        <p className="settings-help">{t("settings.update.autoInstall.help")}</p>
        <div className="settings-row">
          <label className="field-label settings-inline-label" htmlFor="update-interval-select">
            {t("settings.update.interval.label")}
          </label>
          <select
            id="update-interval-select"
            className="filter-select settings-update-interval-select"
            value={String(updaterSettings.check_interval_hours)}
            disabled={updaterSettingsLoading || updaterSettingsSaving}
            onChange={(e) => {
              const value = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(value) && value > 0) {
                onUpdateSettingsPatch({ check_interval_hours: value });
              }
            }}
          >
            <option value="1">{t("settings.update.interval.1h")}</option>
            <option value="6">{t("settings.update.interval.6h")}</option>
            <option value="24">{t("settings.update.interval.24h")}</option>
          </select>
        </div>
        <div className="settings-row settings-update-row">
          <span className="settings-version-chip">
            {t("settings.update.current", { version: appVersion })}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onOpenUpdateDialog()}
            disabled={busy || updateCheckBusy}
          >
            {updateCheckBusy ? t("settings.update.checkingButton") : t("settings.update.checkButton")}
          </button>
        </div>
      </section>

      <section className="chart-card settings-card">
        <h2 className="chart-title">{t("settings.vscode.title")}</h2>
        <p className="settings-help">{t("settings.vscode.help")}</p>
        <p className="settings-help">{t("settings.vscode.sharedData.note")}</p>
        <p
          className={`settings-help settings-vscode-installed ${
            vscodeInstalled ? "is-installed" : "is-not-installed"
          }`}
        >
          {vscodeInstalled === null
            ? t("settings.vscode.status.checking")
            : vscodeInstalled
              ? t("settings.vscode.status.installed")
              : t("settings.vscode.status.notInstalled")}
        </p>
        <div className="settings-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleInstallVscodeExtension()}
            disabled={busy || vscodeInstallBusy || vscodeUninstallBusy}
          >
            {vscodeInstallBusy
              ? t("settings.vscode.installing")
              : t("settings.vscode.install.button")}
          </button>
          <button
            type="button"
            className={`btn ${
              vscodeInstalled
                ? "settings-vscode-uninstall-btn"
                : "settings-vscode-uninstall-btn-disabled"
            }`}
            onClick={() => void handleUninstallVscodeExtension()}
            disabled={busy || vscodeInstallBusy || vscodeUninstallBusy || !vscodeInstalled}
          >
            {vscodeUninstallBusy
              ? t("settings.vscode.uninstalling")
              : t("settings.vscode.uninstall.button")}
          </button>
        </div>
        {vscodeInstallStatus && (
          <p className="settings-help settings-vscode-status" role="status" aria-live="polite">
            {vscodeInstallStatus}
          </p>
        )}
      </section>

      <section className="chart-card settings-card">
        <h2 className="chart-title">{t("settings.theme")}</h2>
        <p className="settings-help">{t("settings.theme.help")}</p>
        <div className="settings-row">
          <select
            className="filter-select settings-theme-select"
            value={themeMode}
            onChange={(e) => setThemeMode(e.target.value as ThemeMode)}
          >
            <option value="system">{t("settings.theme.system")}</option>
            <option value="light">{t("settings.theme.light")}</option>
            <option value="dark">{t("settings.theme.dark")}</option>
          </select>
        </div>
      </section>

      <section className="chart-card settings-card">
        <h2 className="chart-title">{t("locale.switch")}</h2>
        <div className="settings-row">
          <select
            className="filter-select settings-language-select"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            <option value="zh-CN">{t("locale.zhCN")}</option>
            <option value="en-US">{t("locale.enUS")}</option>
          </select>
        </div>
      </section>

      <section className="chart-card settings-card">
        <h2 className="chart-title">{t("settings.importMode.title")}</h2>
        <p className="settings-help">{t("settings.importMode.help")}</p>
        <div className="settings-row">
          <select
            className="filter-select settings-import-mode-select"
            value={importMode}
            disabled={busy}
            onChange={(e) => {
              const mode = e.target.value;
              setImportMode(mode);
              void setupSetImportMode(mode).catch((err: unknown) => {
                setStatus(String(err));
              });
            }}
          >
            <option value="manual">{t("settings.importMode.manual")}</option>
            <option value="prompt">{t("settings.importMode.prompt")}</option>
            <option value="auto">{t("settings.importMode.auto")}</option>
          </select>
        </div>
      </section>

      <section className="chart-card settings-card">
        <h2 className="chart-title">{t("settings.evalConfig.title")}</h2>
        <p className="settings-help">{t("settings.evalConfig.help")}</p>
        <div className="field">
          <label className="field-label">{t("settings.evalConfig.apiKey")}</label>
          <input
            className="field-input"
            type="password"
            value={apiConfig.apiKey}
            onChange={(e) =>
              setApiConfig((prev) => ({
                ...prev,
                apiKey: e.target.value,
              }))
            }
            placeholder="sk-..."
            autoComplete="off"
            disabled={busy || apiBusy}
          />
        </div>
        <div className="field">
          <label className="field-label">{t("settings.evalConfig.baseUrl")}</label>
          <input
            className="field-input"
            value={apiConfig.baseUrl ?? ""}
            onChange={(e) =>
              setApiConfig((prev) => ({
                ...prev,
                baseUrl: e.target.value,
              }))
            }
            placeholder="https://api.openai.com/v1"
            autoComplete="off"
            disabled={busy || apiBusy}
          />
        </div>
        <div className="field">
          <label className="field-label">{t("settings.evalConfig.defaultModel")}</label>
          <input
            className="field-input"
            value={apiConfig.defaultModel}
            onChange={(e) =>
              setApiConfig((prev) => ({
                ...prev,
                defaultModel: e.target.value,
              }))
            }
            placeholder="gpt-4o-mini"
            autoComplete="off"
            disabled={busy || apiBusy}
          />
        </div>
        <div className="field">
          <label className="field-label">{t("settings.evalConfig.costCurrency")}</label>
          <select
            className="filter-select settings-eval-currency-select"
            value={apiConfig.costCurrency}
            onChange={(e) =>
              setApiConfig((prev) => ({
                ...prev,
                costCurrency: normalizeCostCurrency(e.target.value),
              }))
            }
            disabled={busy || apiBusy}
          >
            <option value="USD">{t("settings.evalConfig.costCurrency.usd")}</option>
            <option value="CNY">{t("settings.evalConfig.costCurrency.cny")}</option>
          </select>
          <p className="settings-help">{t("settings.evalConfig.costCurrency.help")}</p>
        </div>
        <div className="settings-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSaveApiConfig()}
            disabled={busy || apiBusy}
          >
            {apiBusy ? t("settings.evalConfig.savingButton") : t("settings.evalConfig.saveButton")}
          </button>
        </div>
      </section>

      {status && (
        <p className="settings-status" role="status" aria-live="polite">
          {status}
        </p>
      )}
    </div>
  );
}


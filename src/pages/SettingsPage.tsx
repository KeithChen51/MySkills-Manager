import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";

import {
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
};

function formatSize(bytes: number): string {
  if (bytes <= 0 || !Number.isFinite(bytes)) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

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

export default function SettingsPage({ onSkillsDirChanged }: Props) {
  const { t, locale, setLocale } = useI18n();
  const { themeMode, setThemeMode } = useTheme();
  const [skillsDir, setSkillsDir] = useState("");
  const [importMode, setImportMode] = useState("manual");
  const [busy, setBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [appVersion, setAppVersion] = useState("-");
  const [status, setStatus] = useState("");

  useEffect(() => {
    setBusy(true);
    void Promise.all([
      onboardingGetState(),
      setupGetImportMode(),
      getVersion().catch(() => "-"),
    ])
      .then(([state, mode, version]) => {
        setSkillsDir(state.skillsDir);
        setImportMode(mode);
        setAppVersion(version);
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
      setStatus(`${t("tools.path.saved")} (${result.skills.length})`);
      onSkillsDirChanged();
    } catch (error: unknown) {
      setStatus(formatStatusError(error, t));
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckForUpdates() {
    setUpdateBusy(true);
    setStatus(t("settings.update.checking"));

    try {
      const update = await check();
      if (!update) {
        setStatus(t("settings.update.none"));
        return;
      }

      const installNow = window.confirm(
        t("settings.update.available", {
          version: update.version,
          current: update.currentVersion,
        }),
      );
      if (!installNow) {
        setStatus(t("settings.update.declined", { version: update.version }));
        return;
      }

      let downloaded = 0;
      let contentLength: number | undefined;
      setStatus(t("settings.update.downloading"));

      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength;
          return;
        }

        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (contentLength && contentLength > 0) {
            setStatus(
              t("settings.update.downloading.progress", {
                downloaded: formatSize(downloaded),
                total: formatSize(contentLength),
              }),
            );
          }
          return;
        }

        setStatus(t("settings.update.installing"));
      });

      const restartNow = window.confirm(t("settings.update.restartNow"));
      if (restartNow) {
        setStatus(t("settings.update.relaunching"));
        await relaunch();
        return;
      }
      setStatus(t("settings.update.restartLater"));
    } catch (error: unknown) {
      setStatus(`${t("settings.update.failed")}: ${String(error)}`);
    } finally {
      setUpdateBusy(false);
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
        <div className="settings-row settings-update-row">
          <span className="settings-version-chip">
            {t("settings.update.current", { version: appVersion })}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleCheckForUpdates()}
            disabled={busy || updateBusy}
          >
            {updateBusy ? t("settings.update.checkingButton") : t("settings.update.checkButton")}
          </button>
        </div>
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

      {status && (
        <p className="settings-status" role="status" aria-live="polite">
          {status}
        </p>
      )}
    </div>
  );
}


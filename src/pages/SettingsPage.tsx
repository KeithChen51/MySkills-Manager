import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { onboardingGetState, onboardingSetSkillsDir } from "../api/tauri";
import { useI18n } from "../i18n/I18nProvider";
import type { Locale } from "../i18n/messages";
import { useTheme, type ThemeMode } from "../theme/ThemeProvider";
import "./SettingsPage.css";

type Props = {
  onSkillsDirChanged: () => void;
};

function formatStatusError(
  error: unknown,
  t: (key: "tools.validation.skillsRequired" | "onboard.path.create.confirm") => string,
): string {
  const raw = String(error);
  if (raw.includes("skills dir does not exist")) {
    return t("onboard.path.create.confirm");
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
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setBusy(true);
    void onboardingGetState()
      .then((state) => {
        setSkillsDir(state.skillsDir);
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
        if (
          message.includes("skills dir does not exist") &&
          window.confirm(t("onboard.path.create.confirm"))
        ) {
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
            <option value="zh-CN">Chinese (Simplified)</option>
            <option value="en-US">English</option>
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

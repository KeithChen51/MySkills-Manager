import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import {
  onboardingComplete,
  onboardingImportInstalledSkills,
  onboardingSetSkillsDir,
  setupStatus,
  type OnboardingCompleteResult,
  type ToolStatus,
} from "../api/tauri";
import { useI18n } from "../i18n/I18nProvider";
import "./OnboardingWizard.css";

type Props = {
  initialSkillsDir: string;
  initialAutoSync: boolean;
  onCompleted: (result: OnboardingCompleteResult) => void;
};

export default function OnboardingWizard({
  initialSkillsDir,
  initialAutoSync,
  onCompleted,
}: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState(1);
  const [skillsDir, setSkillsDir] = useState(initialSkillsDir);
  const [autoSync, setAutoSync] = useState(initialAutoSync);
  const [skillsCount, setSkillsCount] = useState(0);
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  function formatStatusError(error: unknown): string {
    const raw = String(error);
    if (raw.includes("skills dir does not exist")) {
      return t("onboard.error.dirMissing");
    }
    if (raw.includes("skills dir is required")) {
      return t("onboard.error.dirRequired");
    }
    return raw;
  }

  useEffect(() => {
    void setupStatus()
      .then(setTools)
      .catch(() => setTools([]));
  }, []);

  async function handleCheckSkillsDir() {
    setBusy(true);
    setStatus(t("onboard.path.checking"));
    try {
      let result: Awaited<ReturnType<typeof onboardingSetSkillsDir>>;
      try {
        result = await onboardingSetSkillsDir(skillsDir);
      } catch (e: unknown) {
        const message = String(e);
        if (
          message.includes("skills dir does not exist") &&
          window.confirm(t("onboard.path.create.confirm"))
        ) {
          result = await onboardingSetSkillsDir(skillsDir, true);
        } else {
          throw e;
        }
      }
      setSkillsCount(result.skills.length);
      setStep(2);
      setStatus("");
    } catch (e: unknown) {
      setStatus(formatStatusError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleFinish() {
    setBusy(true);
    setStatus(t("onboard.finishing"));
    try {
      const result = await onboardingComplete(autoSync);
      setStatus("");
      onCompleted(result);
    } catch (e: unknown) {
      setStatus(formatStatusError(e));
      setBusy(false);
    }
  }

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

  async function handleImportInstalledSkills() {
    setBusy(true);
    setStatus(t("onboard.import.start"));
    try {
      await onboardingSetSkillsDir(skillsDir, true);
      const imported = await onboardingImportInstalledSkills();
      const refreshed = await onboardingSetSkillsDir(skillsDir, true);
      setSkillsCount(refreshed.skills.length);
      setStatus(
        t("onboard.import.done", {
          imported: imported.importedTotal,
          detected: imported.detectedTotal,
          skipped: imported.skippedExistingTotal,
        }),
      );
    } catch (e: unknown) {
      setStatus(formatStatusError(e));
    } finally {
      setBusy(false);
    }
  }

  const availableTools = tools.filter((item) => item.exists).length;

  return (
    <div className="onboarding-screen">
      <div className="onboarding-card animate-fadein">
        <h1 className="onboarding-title">{t("onboard.title")}</h1>
        <p className="onboarding-subtitle">{t("onboard.subtitle", { step })}</p>

        {step === 1 && (
          <section className="onboarding-step">
            <h2>{t("onboard.step1.title")}</h2>
            <p>{t("onboard.step1.desc")}</p>
            <label className="field-label" htmlFor="onboarding-skills-dir-input">
              {t("onboard.step3.skillsDir")}
            </label>
            <input
              id="onboarding-skills-dir-input"
              className="field-input"
              value={skillsDir}
              onChange={(e) => setSkillsDir(e.target.value)}
              placeholder="C:\\Users\\Keith\\my-skills"
            />
            <div className="onboarding-actions">
              <button type="button" className="btn btn-ghost" onClick={() => void handlePickPath()} disabled={busy}>
                {t("onboard.path.pick")}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void handleImportInstalledSkills()}
                disabled={busy || skillsDir.trim().length === 0}
              >
                {t("onboard.import.button")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleCheckSkillsDir()}
                disabled={busy || skillsDir.trim().length === 0}
              >
                {busy ? t("onboard.path.checking") : t("onboard.path.next")}
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="onboarding-step">
            <h2>{t("onboard.step2.title")}</h2>
            <p>{t("onboard.step2.summary", { skills: skillsCount, tools: availableTools })}</p>
            <label className="onboarding-toggle">
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(e) => setAutoSync(e.target.checked)}
              />
              <span>{t("onboard.step2.toggle")}</span>
            </label>
            <div className="onboarding-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(1)} disabled={busy}>
                {t("onboard.back")}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setStep(3)} disabled={busy}>
                {t("onboard.next")}
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="onboarding-step">
            <h2>{t("onboard.step3.title")}</h2>
            <ul className="onboarding-list">
              <li>{t("onboard.step3.skillsDir")}: {skillsDir}</li>
              <li>{t("onboard.step3.skillCount")}: {skillsCount}</li>
              <li>{t("onboard.step3.toolCount")}: {availableTools}</li>
              <li>{t("onboard.step3.syncMode")}: {autoSync ? t("onboard.step3.sync.auto") : t("onboard.step3.sync.manual")}</li>
            </ul>
            <div className="onboarding-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(2)} disabled={busy}>
                {t("onboard.back")}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void handleFinish()} disabled={busy}>
                {busy ? t("onboard.finishing") : t("onboard.finish")}
              </button>
            </div>
          </section>
        )}

        {status && (
          <p className="onboarding-status" role="status" aria-live="polite">
            {status}
          </p>
        )}
      </div>
    </div>
  );
}

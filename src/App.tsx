import { Suspense, lazy, useEffect, useState } from "react";

import {
  APP_ERROR_EVENT,
  appPing,
  onboardingGetState,
  onboardingImportInstalledSkills,
  setupGetImportMode,
  setupLocalSkillsOverview,
  type OnboardingCompleteResult,
  skillsList,
  type SkillMeta,
} from "./api/tauri";
import AppErrorBoundary from "./components/AppErrorBoundary";
import OnboardingWizard from "./components/OnboardingWizard";
import Sidebar, { type ViewName } from "./components/Sidebar";
import SilentUpdateToast from "./components/SilentUpdateToast";
import UpdateNotification from "./components/UpdateNotification";
import VersionJumpNotification from "./components/VersionJumpNotification";
import { useI18n } from "./i18n/I18nProvider";
import { useAppUpdater } from "./updater/useAppUpdater";
import "./App.css";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const GitPage = lazy(() => import("./pages/GitPage"));
const SkillToolsPage = lazy(() => import("./pages/SkillToolsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const EvalPage = lazy(() => import("./pages/EvalPage"));

export default function App() {
  const { t } = useI18n();
  const [view, setView] = useState<ViewName>("skills");
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [ping, setPing] = useState(t("app.loading"));
  const [booting, setBooting] = useState(true);
  const [onboardingCompleted, setOnboardingCompleted] = useState(true);
  const [hasOpenedEval, setHasOpenedEval] = useState(false);
  const [initialSkillsDir, setInitialSkillsDir] = useState("");
  const [initialAutoSync, setInitialAutoSync] = useState(false);
  const [globalErrors, setGlobalErrors] = useState<
    { id: number; message: string; at: number }[]
  >([]);
  const [importStatus, setImportStatus] = useState("");
  const updater = useAppUpdater({
    enabled: !booting && onboardingCompleted,
  });

  function pushGlobalError(message: string) {
    const now = Date.now();
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setGlobalErrors((prev) => {
      const duplicate = prev.some(
        (item) => item.message === message && now - item.at < 2000,
      );
      if (duplicate) {
        return prev;
      }
      return [...prev, { id, message, at: now }].slice(-4);
    });
    setTimeout(() => {
      setGlobalErrors((prev) => prev.filter((item) => item.id !== id));
    }, 6000);
  }

  function loadSkills() {
    void skillsList()
      .then(setSkills)
      .catch((err: unknown) => console.error("skills_list error:", err));
  }

  useEffect(() => {
    void (async () => {
      try {
        const state = await onboardingGetState();
        setOnboardingCompleted(state.completed);
        setInitialSkillsDir(state.skillsDir);
        setInitialAutoSync(state.autoSync);
        if (state.completed) {
          void appPing().then(setPing).catch(() => setPing(t("app.ping.error")));
          loadSkills();
          void runBootScan();
        } else {
          setPing(t("app.ping.onboarding"));
        }
      } catch {
        setPing(t("app.ping.error"));
      } finally {
        setBooting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runBootScan() {
    try {
      const mode = await setupGetImportMode();
      if (mode === "manual") return;

      setImportStatus(t("app.import.scan"));
      const overview = await setupLocalSkillsOverview();
      if (overview.missingInMySkills === 0) {
        setImportStatus("");
        return;
      }

      if (mode === "auto") {
        setImportStatus(t("app.import.auto.start", { count: overview.missingInMySkills }));
        const result = await onboardingImportInstalledSkills();
        setImportStatus(t("app.import.auto.done", { count: result.importedTotal }));
        loadSkills();
        setTimeout(() => setImportStatus(""), 5000);
      } else if (mode === "prompt") {
        setImportStatus(t("app.import.prompt.found", { count: overview.missingInMySkills }));
        const confirmed = window.confirm(t("app.import.prompt.confirm", { count: overview.missingInMySkills }));
        if (confirmed) {
          setImportStatus(t("app.import.manual.start", { count: overview.missingInMySkills }));
          const result = await onboardingImportInstalledSkills();
          setImportStatus(t("app.import.manual.done", { count: result.importedTotal }));
          loadSkills();
          setTimeout(() => setImportStatus(""), 5000);
        } else {
          setImportStatus("");
        }
      }
    } catch (err: unknown) {
      console.error("Boot scan failed:", err);
      setImportStatus("");
    }
  }

  useEffect(() => {
    const handleAppError = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      pushGlobalError(detail || t("app.error.unknown"));
    };
    const handleWindowError = (event: ErrorEvent) => {
      if (event.message) {
        pushGlobalError(event.message);
      }
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      pushGlobalError(String(event.reason ?? t("app.error.unhandledRejection")));
    };

    window.addEventListener(APP_ERROR_EVENT, handleAppError as EventListener);
    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener(APP_ERROR_EVENT, handleAppError as EventListener);
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [t]);

  function handleOnboardingCompleted(result: OnboardingCompleteResult) {
    setOnboardingCompleted(true);
    setInitialAutoSync(result.autoSync);
    void appPing().then(setPing).catch(() => setPing(t("app.ping.error")));
    loadSkills();
  }

  useEffect(() => {
    if (view === "eval") {
      setHasOpenedEval(true);
    }
  }, [view]);

  if (booting) {
    return <div className="app-status-bar">{t("app.loading")}</div>;
  }

  if (!onboardingCompleted) {
    return (
      <OnboardingWizard
        initialSkillsDir={initialSkillsDir}
        initialAutoSync={initialAutoSync}
        onCompleted={handleOnboardingCompleted}
      />
    );
  }

  function renderPage() {
    switch (view) {
      case "skills":
        return <SkillToolsPage skills={skills} onRefresh={loadSkills} />;
      case "dashboard":
        return <DashboardPage skills={skills} />;
      case "eval":
        return <EvalPage skills={skills} />;
      case "git":
        return <GitPage />;
      case "settings":
        return (
          <SettingsPage
            onSkillsDirChanged={loadSkills}
            updaterSettings={updater.settings}
            updaterSettingsLoading={updater.settingsLoading}
            updaterSettingsSaving={updater.settingsSaving}
            updateCheckBusy={updater.dialog.checking || updater.action.state === "downloading"}
            onUpdateSettingsPatch={(patch) => {
              void updater.setUpdaterSettings(patch);
            }}
            onOpenUpdateDialog={() => {
              void updater.openManualCheckDialog();
            }}
          />
        );
    }
  }

  const showEvalContainer = hasOpenedEval || view === "eval";

  return (
    <AppErrorBoundary
      onError={pushGlobalError}
      fallbackTitle={t("app.fallback.title")}
      fallbackDescription={t("app.fallback.desc")}
    >
      <UpdateNotification
        open={updater.dialog.open}
        checking={updater.dialog.checking}
        noUpdate={updater.dialog.noUpdate}
        checkError={updater.dialog.checkError}
        updateInfo={updater.dialog.updateInfo}
        action={updater.action}
        retryStatus={updater.retryStatus}
        actionError={updater.actionError}
        actionErrorDetails={updater.actionErrorDetails}
        restarting={updater.restarting}
        onClose={updater.closeDialog}
        onPrimaryAction={() => updater.handlePrimaryAction()}
        onRetryCheck={() => updater.openManualCheckDialog()}
        onCancelDownload={() => updater.cancelDownload()}
      />
      {updater.versionJumpInfo && (
        <VersionJumpNotification
          info={updater.versionJumpInfo}
          onClose={updater.dismissVersionJump}
        />
      )}
      <div className="app-shell">
        <Sidebar active={view} onChange={setView} />
        <div className="app-content">
          <div className="app-status-bar">
            <span className="status-dot" />
            <span className="status-text">
              {t("app.status")}: {ping}
            </span>
            {importStatus && (
              <span className="status-import">{importStatus}</span>
            )}
          </div>
          {updater.silentReadyVersion && (
            <SilentUpdateToast
              version={updater.silentReadyVersion}
              onRestart={() => updater.restartAndApply()}
              onDismiss={updater.dismissSilentReady}
            />
          )}
          <Suspense
            fallback={
              <div className="app-page-loading" role="status" aria-live="polite">
                {t("app.loading")}
              </div>
            }
          >
            {showEvalContainer ? (
              <div style={{ display: view === "eval" ? "flex" : "none", flex: 1, minHeight: 0 }}>
                <EvalPage skills={skills} />
              </div>
            ) : null}
            {view !== "eval" ? renderPage() : null}
          </Suspense>
        </div>
        <div className="app-error-toast-wrap">
          {globalErrors.map((item) => (
            <div key={item.id} className="app-error-toast">
              {item.message}
            </div>
          ))}
        </div>
      </div>
    </AppErrorBoundary>
  );
}

import { useEffect, useState, useCallback, useRef } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";

import {
  evalGetConfig,
  evalSaveConfig,
  evalTestConnection,
  getVscodeExtensionStatus,
  installVscodeExtension,
  syncVscodeSkillsRoot,
  uninstallVscodeExtension,
  type CostCurrency,
  type EvalConfig,
  type ModelGroup,
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

function makeGroupId(): string {
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type TestStatus = { state: "idle" | "testing" | "success" | "fail"; message?: string };

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
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [costCurrency, setCostCurrency] = useState<CostCurrency>("USD");
  const [busy, setBusy] = useState(false);
  const [apiBusy, setApiBusy] = useState(false);
  const [testStatuses, setTestStatuses] = useState<Record<string, TestStatus>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const dragHandleActive = useRef<string | null>(null);
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
        setModelGroups(evalConfig.modelGroups ?? []);
        setCostCurrency(normalizeCostCurrency(evalConfig.costCurrency));
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
      // Derive flat fields from first group for backward compat
      const first = modelGroups[0];
      const normalized: EvalConfig = {
        apiKey: first?.apiKey ?? "",
        provider: "openai-compatible",
        baseUrl: first?.baseUrl || undefined,
        sampleModel: first?.models[0] ?? "gpt-4o-mini",
        runModel: first?.models[0] ?? "gpt-4o-mini",
        judgeModel: "",
        costCurrency,
        modelGroups,
      };
      await evalSaveConfig(normalized);
      setStatus(t("settings.evalConfig.saved"));
    } catch (error: unknown) {
      setStatus(`${t("settings.evalConfig.failed")}: ${String(error)}`);
    } finally {
      setApiBusy(false);
    }
  }

  function updateGroup(id: string, patch: Partial<ModelGroup>) {
    setModelGroups((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }

  function addModelToGroup(groupId: string) {
    setModelGroups((prev) =>
      prev.map((g) =>
        g.id === groupId ? { ...g, models: [...g.models, ""] } : g,
      ),
    );
  }

  function removeModelFromGroup(groupId: string, modelIndex: number) {
    setModelGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, models: g.models.filter((_, i) => i !== modelIndex) }
          : g,
      ),
    );
  }

  function updateModelInGroup(groupId: string, modelIndex: number, value: string) {
    setModelGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, models: g.models.map((m, i) => (i === modelIndex ? value : m)) }
          : g,
      ),
    );
  }

  async function handleTestConnection(group: ModelGroup) {
    const model = group.models[0];
    if (!group.baseUrl || !model) return;
    setTestStatuses((prev) => ({ ...prev, [group.id]: { state: "testing" } }));
    try {
      const result = await evalTestConnection(
        group.baseUrl,
        group.isGateway ? undefined : group.apiKey,
        model,
      );
      setTestStatuses((prev) => ({
        ...prev,
        [group.id]: {
          state: result.success ? "success" : "fail",
          message: result.message,
        },
      }));
    } catch (error: unknown) {
      setTestStatuses((prev) => ({
        ...prev,
        [group.id]: { state: "fail", message: String(error) },
      }));
    }
  }

  const handleMoveGroup = useCallback((fromIdx: number, toIdx: number) => {
    setModelGroups((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      return copy;
    });
  }, []);

  function handleMoveModel(groupId: string, fromIdx: number, toIdx: number) {
    setModelGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        const copy = [...g.models];
        const [moved] = copy.splice(fromIdx, 1);
        copy.splice(toIdx, 0, moved);
        return { ...g, models: copy };
      }),
    );
  }

  function toggleGroupExpanded(id: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
        <label className="field-label" htmlFor="settings-skills-dir-input">
          {t("onboard.step3.skillsDir")}
        </label>
        <div className="settings-row">
          <input
            id="settings-skills-dir-input"
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

        {modelGroups.map((group, groupIdx) => {
          const ts = testStatuses[group.id] ?? { state: "idle" as const };
          const isExpanded = expandedGroups.has(group.id);
          return (
            <div
              key={group.id}
              className={`settings-model-group-card${isExpanded ? " is-expanded" : ""}`}
              draggable
              onDragStart={(e) => {
                if (dragHandleActive.current !== `group:${groupIdx}`) {
                  e.preventDefault();
                  return;
                }
                e.dataTransfer.setData("groupIdx", String(groupIdx));
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => { dragHandleActive.current = null; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const from = parseInt(e.dataTransfer.getData("groupIdx"), 10);
                if (!isNaN(from) && from !== groupIdx) handleMoveGroup(from, groupIdx);
              }}
            >
              <button
                type="button"
                className="settings-model-group-header"
                onClick={() => toggleGroupExpanded(group.id)}
              >
                <span
                  className="settings-model-group-drag-handle"
                  title="Drag"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={() => { dragHandleActive.current = `group:${groupIdx}`; }}
                  onMouseUp={() => { dragHandleActive.current = null; }}
                >☰</span>
                <span className="settings-model-group-header-name">{group.name || `模型组 ${groupIdx + 1}`}</span>
                <span className="settings-model-group-header-meta">
                  {group.models.length > 0 && (
                    <span className="settings-model-group-model-count">{group.models.length} models</span>
                  )}
                  {ts.state === "success" && <span className="settings-model-group-badge-ok">✓</span>}
                  {ts.state === "fail" && <span className="settings-model-group-badge-fail">✗</span>}
                  {ts.state === "testing" && <span className="settings-model-group-badge-testing">…</span>}
                </span>
                <span className={`settings-model-group-chevron${isExpanded ? " is-open" : ""}`}>▶</span>
              </button>

              {isExpanded && (
                <>
                  <div className="settings-model-group-expanded-toolbar">
                    <input
                      className="field-input settings-model-group-name-input"
                      value={group.name}
                      onChange={(e) => updateGroup(group.id, { name: e.target.value })}
                      placeholder={t("settings.modelGroup.groupName" as MessageKey)}
                      disabled={busy || apiBusy}
                      onClick={(e) => e.stopPropagation()}
                      draggable={false}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost settings-model-group-remove-btn"
                      onClick={() => setModelGroups((prev) => prev.filter((g) => g.id !== group.id))}
                      disabled={busy || apiBusy}
                    >
                      {t("settings.modelGroup.removeGroup" as MessageKey)}
                    </button>
                  </div>

                  <div className="settings-model-group-fields">
                    <div className="field">
                      <label className="field-label">{t("settings.modelGroup.url" as MessageKey)}</label>
                      <input
                        className="field-input"
                        value={group.baseUrl}
                        onChange={(e) => updateGroup(group.id, { baseUrl: e.target.value })}
                        placeholder="https://api.openai.com/v1"
                        disabled={busy || apiBusy}
                        draggable={false}
                      />
                    </div>
                    <div className="field">
                      <label className="field-label">
                        {t("settings.modelGroup.apiKey" as MessageKey)}
                        <label className="settings-model-group-gateway-toggle">
                          <input
                            type="checkbox"
                            checked={group.isGateway}
                            onChange={(e) => updateGroup(group.id, { isGateway: e.target.checked })}
                            disabled={busy || apiBusy}
                          />
                          <span>{t("settings.modelGroup.gateway" as MessageKey)}</span>
                        </label>
                      </label>
                      {!group.isGateway && (
                        <input
                          className="field-input"
                          type="password"
                          value={group.apiKey}
                          onChange={(e) => updateGroup(group.id, { apiKey: e.target.value })}
                          placeholder="sk-..."
                          autoComplete="off"
                          disabled={busy || apiBusy}
                          draggable={false}
                        />
                      )}
                    </div>

                    <div className="field">
                      <label className="field-label">
                        Models
                        <button
                          type="button"
                          className="btn btn-ghost settings-model-group-add-model-btn"
                          onClick={() => addModelToGroup(group.id)}
                          disabled={busy || apiBusy}
                        >
                          + {t("settings.modelGroup.addModel" as MessageKey)}
                        </button>
                      </label>
                      {group.models.length === 0 && (
                        <p className="settings-help">{t("settings.modelGroup.emptyModels" as MessageKey)}</p>
                      )}
                      {group.models.map((model, mi) => (
                        <div
                          key={mi}
                          className="settings-model-group-model-row"
                          draggable
                          onDragStart={(e) => {
                            if (dragHandleActive.current !== `model:${group.id}:${mi}`) {
                              e.preventDefault();
                              return;
                            }
                            e.stopPropagation();
                            e.dataTransfer.setData("modelDrag", JSON.stringify({ groupId: group.id, idx: mi }));
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => { dragHandleActive.current = null; }}
                          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onDrop={(e) => {
                            e.stopPropagation();
                            try {
                              const data = JSON.parse(e.dataTransfer.getData("modelDrag"));
                              if (data.groupId === group.id && data.idx !== mi) {
                                handleMoveModel(group.id, data.idx, mi);
                              }
                            } catch { /* group-level drop */ }
                          }}
                        >
                          <span
                            className="settings-model-group-model-drag"
                            title="Drag"
                            onMouseDown={() => { dragHandleActive.current = `model:${group.id}:${mi}`; }}
                            onMouseUp={() => { dragHandleActive.current = null; }}
                          >≡</span>
                          <input
                            className="field-input"
                            value={model}
                            onChange={(e) => updateModelInGroup(group.id, mi, e.target.value)}
                            placeholder={t("settings.modelGroup.modelPlaceholder" as MessageKey)}
                            disabled={busy || apiBusy}
                            draggable={false}
                          />
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => removeModelFromGroup(group.id, mi)}
                            disabled={busy || apiBusy}
                          >
                            {t("settings.modelGroup.removeModel" as MessageKey)}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="settings-model-group-footer">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void handleTestConnection(group)}
                      disabled={busy || apiBusy || ts.state === "testing" || !group.baseUrl || group.models.length === 0}
                    >
                      {ts.state === "testing"
                        ? t("settings.modelGroup.testing" as MessageKey)
                        : t("settings.modelGroup.testConnection" as MessageKey)}
                    </button>
                    {ts.state === "success" && (
                      <span className="settings-model-group-test-ok">{t("settings.modelGroup.testSuccess" as MessageKey)}</span>
                    )}
                    {ts.state === "fail" && (
                      <span className="settings-model-group-test-fail" title={ts.message}>
                        {t("settings.modelGroup.testFailed" as MessageKey)}: {ts.message?.slice(0, 80)}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        <div className="settings-row">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              setModelGroups((prev) => [
                ...prev,
                {
                  id: makeGroupId(),
                  name: `模型组 ${prev.length + 1}`,
                  baseUrl: "",
                  apiKey: "",
                  isGateway: false,
                  models: [],
                },
              ])
            }
            disabled={busy || apiBusy}
          >
            + {t("settings.modelGroup.addGroup" as MessageKey)}
          </button>
        </div>

        <div className="field">
          <label className="field-label">{t("settings.evalConfig.costCurrency")}</label>
          <select
            className="filter-select settings-eval-currency-select"
            value={costCurrency}
            onChange={(e) => setCostCurrency(normalizeCostCurrency(e.target.value))}
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


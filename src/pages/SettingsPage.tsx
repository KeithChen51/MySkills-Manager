import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
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
import { IconChevronRight, IconEval, IconFolder, IconSun, IconTools } from "../components/icons";
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

type SettingsCategory = "basic" | "appearance" | "integration" | "eval";

type CategoryMeta = {
  groupLabelKey: MessageKey;
  navLabelKey: MessageKey;
  titleKey: MessageKey;
  descKey: MessageKey;
  icon: ComponentType<{ size?: number; className?: string }>;
};

const DEFAULT_API_CONFIG: EvalConfig = {
  apiKey: "",
  provider: "openai-compatible",
  sampleModel: "gpt-4o-mini",
  runModel: "gpt-4o-mini",
  judgeModel: "",
  costCurrency: "USD",
  modelGroups: [],
};

const CATEGORY_ORDER: SettingsCategory[] = ["basic", "appearance", "integration", "eval"];

const CATEGORY_META: Record<SettingsCategory, CategoryMeta> = {
  basic: {
    groupLabelKey: "settings.category.basic.group",
    navLabelKey: "settings.category.basic.nav",
    titleKey: "settings.category.basic.title",
    descKey: "settings.category.basic.desc",
    icon: IconFolder,
  },
  appearance: {
    groupLabelKey: "settings.category.appearance.group",
    navLabelKey: "settings.category.appearance.nav",
    titleKey: "settings.category.appearance.title",
    descKey: "settings.category.appearance.desc",
    icon: IconSun,
  },
  integration: {
    groupLabelKey: "settings.category.integration.group",
    navLabelKey: "settings.category.integration.nav",
    titleKey: "settings.category.integration.title",
    descKey: "settings.category.integration.desc",
    icon: IconTools,
  },
  eval: {
    groupLabelKey: "settings.category.eval.group",
    navLabelKey: "settings.category.eval.nav",
    titleKey: "settings.category.eval.title",
    descKey: "settings.category.eval.desc",
    icon: IconEval,
  },
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

function normalizeModelGroups(groups: ModelGroup[] | undefined): ModelGroup[] {
  return (groups ?? []).map((group, index) => ({
    id: group.id?.trim() || `group-${index + 1}`,
    name: group.name?.trim() || `Group ${index + 1}`,
    baseUrl: group.baseUrl?.trim() || "",
    apiKey: group.apiKey?.trim() || "",
    isGateway: Boolean(group.isGateway),
    models: Array.isArray(group.models)
      ? group.models.map((model) => model.trim()).filter(Boolean)
      : [],
  }));
}

function seedModelGroups(config: EvalConfig): ModelGroup[] {
  const existing = normalizeModelGroups(config.modelGroups);
  if (existing.length > 0) {
    return existing;
  }
  const fallbackModels = Array.from(
    new Set(
      [config.sampleModel, config.runModel, config.defaultModel]
        .map((value) => value?.trim() ?? "")
        .filter(Boolean),
    ),
  );
  return [
    {
      id: makeGroupId(),
      name: "Group 1",
      baseUrl: config.baseUrl?.trim() || "",
      apiKey: config.apiKey.trim(),
      isGateway: false,
      models: fallbackModels.length > 0 ? fallbackModels : ["gpt-4o-mini"],
    },
  ];
}

function deriveLegacyConfigFromGroups(
  groups: ModelGroup[],
  fallback: EvalConfig,
): Pick<EvalConfig, "apiKey" | "baseUrl" | "sampleModel" | "runModel"> {
  const normalizedGroups = groups.map((group) => ({
    ...group,
    models: group.models.map((model) => model.trim()).filter(Boolean),
  }));
  const pickModel = (preferred: string): string => {
    const normalized = preferred.trim();
    if (normalized) {
      const matched = normalizedGroups.some((group) => group.models.includes(normalized));
      if (matched) {
        return normalized;
      }
    }
    return normalizedGroups.find((group) => group.models.length > 0)?.models[0] || "";
  };

  const fallbackSample = fallback.sampleModel.trim();
  const fallbackRun = fallback.runModel.trim();
  const sampleModel = pickModel(fallbackSample) || fallbackSample || "gpt-4o-mini";
  const runModel = pickModel(fallbackRun) || sampleModel;
  const primary =
    normalizedGroups.find((group) => group.models.includes(runModel)) ??
    normalizedGroups.find((group) => group.models.includes(sampleModel)) ??
    normalizedGroups.find((group) => group.models.length > 0) ??
    normalizedGroups[0];

  return {
    apiKey: primary ? (primary.isGateway ? "" : primary.apiKey.trim()) : fallback.apiKey.trim(),
    baseUrl: primary?.baseUrl.trim() || fallback.baseUrl?.trim() || undefined,
    sampleModel,
    runModel,
  };
}

function normalizeEvalConfigDraft(config: EvalConfig): EvalConfig {
  const modelGroups = normalizeModelGroups(config.modelGroups);
  const legacy = deriveLegacyConfigFromGroups(modelGroups, config);
  return {
    apiKey: legacy.apiKey,
    provider: "openai-compatible",
    baseUrl: legacy.baseUrl,
    sampleModel: legacy.sampleModel,
    runModel: legacy.runModel,
    judgeModel: config.judgeModel?.trim() || "",
    costCurrency: normalizeCostCurrency(config.costCurrency),
    modelGroups,
  };
}

function isEvalConfigEqual(left: EvalConfig, right: EvalConfig): boolean {
  const normalizedLeft = normalizeEvalConfigDraft(left);
  const normalizedRight = normalizeEvalConfigDraft(right);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
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
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("basic");
  const [pendingCategory, setPendingCategory] = useState<SettingsCategory | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [skillsDir, setSkillsDir] = useState("");
  const [savedSkillsDir, setSavedSkillsDir] = useState("");
  const [importMode, setImportMode] = useState("manual");
  const [apiConfig, setApiConfig] = useState<EvalConfig>(DEFAULT_API_CONFIG);
  const [savedApiConfig, setSavedApiConfig] = useState<EvalConfig>(DEFAULT_API_CONFIG);
  const [testStatuses, setTestStatuses] = useState<Record<string, TestStatus>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [apiBusy, setApiBusy] = useState(false);
  const [vscodeInstalled, setVscodeInstalled] = useState<boolean | null>(null);
  const [vscodeInstallBusy, setVscodeInstallBusy] = useState(false);
  const [vscodeUninstallBusy, setVscodeUninstallBusy] = useState(false);
  const [vscodeInstallStatus, setVscodeInstallStatus] = useState("");
  const [appVersion, setAppVersion] = useState("-");
  const [status, setStatus] = useState("");
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const dragHandleActiveRef = useRef<string | null>(null);

  const normalizedApiConfig = useMemo(() => normalizeEvalConfigDraft(apiConfig), [apiConfig]);
  const basicDirty = useMemo(
    () => skillsDir.trim() !== savedSkillsDir.trim(),
    [savedSkillsDir, skillsDir],
  );
  const evalDirty = useMemo(
    () => !isEvalConfigEqual(normalizedApiConfig, savedApiConfig),
    [normalizedApiConfig, savedApiConfig],
  );

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
        const normalizedSkillsDir = state.skillsDir.trim();
        const normalizedEval = normalizeEvalConfigDraft({
          apiKey: evalConfig.apiKey,
          provider: evalConfig.provider || "openai-compatible",
          baseUrl: evalConfig.baseUrl,
          sampleModel: evalConfig.sampleModel || evalConfig.defaultModel || "gpt-4o-mini",
          runModel: evalConfig.runModel || evalConfig.defaultModel || "gpt-4o-mini",
          judgeModel: evalConfig.judgeModel || "",
          costCurrency: normalizeCostCurrency(evalConfig.costCurrency),
          modelGroups: seedModelGroups(evalConfig),
        });
        setSkillsDir(normalizedSkillsDir);
        setSavedSkillsDir(normalizedSkillsDir);
        setImportMode(mode);
        setApiConfig(normalizedEval);
        setSavedApiConfig(normalizedEval);
        setTestStatuses({});
        setCollapsedGroups(
          (normalizedEval.modelGroups ?? []).reduce<Record<string, boolean>>((acc, group) => {
            acc[group.id] = false;
            return acc;
          }, {}),
        );
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

  useEffect(() => {
    contentScrollRef.current?.scrollTo({
      top: 0,
      left: 0,
      behavior: "auto",
    });
  }, [activeCategory]);

  function hasCategoryUnsaved(category: SettingsCategory): boolean {
    if (category === "basic") {
      return basicDirty;
    }
    if (category === "eval") {
      return evalDirty;
    }
    return false;
  }

  function requestCategoryChange(nextCategory: SettingsCategory) {
    if (nextCategory === activeCategory) {
      return;
    }
    if (hasCategoryUnsaved(activeCategory)) {
      setPendingCategory(nextCategory);
      setConfirmOpen(true);
      return;
    }
    setActiveCategory(nextCategory);
  }

  function closeCategoryConfirm() {
    setConfirmOpen(false);
    setPendingCategory(null);
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

  async function handleSaveSkillsDir(): Promise<boolean> {
    const normalized = skillsDir.trim();
    if (!normalized) {
      setStatus(formatStatusError("skills dir is required", t));
      return false;
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
      setSavedSkillsDir(normalized);
      setSkillsDir(normalized);
      onSkillsDirChanged();
      return true;
    } catch (error: unknown) {
      setStatus(formatStatusError(error, t));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveApiConfig(): Promise<boolean> {
    setApiBusy(true);
    setStatus(t("settings.evalConfig.saving"));
    try {
      const normalized = normalizeEvalConfigDraft(apiConfig);
      await evalSaveConfig(normalized);
      setApiConfig(normalized);
      setSavedApiConfig(normalized);
      setStatus(t("settings.evalConfig.saved"));
      return true;
    } catch (error: unknown) {
      setStatus(`${t("settings.evalConfig.failed")}: ${String(error)}`);
      return false;
    } finally {
      setApiBusy(false);
    }
  }

  function setModelGroups(
    updater: ModelGroup[] | ((previous: ModelGroup[]) => ModelGroup[]),
  ) {
    setApiConfig((previous) => {
      const currentGroups = previous.modelGroups ?? [];
      const nextGroups =
        typeof updater === "function"
          ? updater(currentGroups)
          : updater;
      return {
        ...previous,
        modelGroups: nextGroups,
      };
    });
  }

  function updateGroup(groupId: string, patch: Partial<ModelGroup>) {
    setModelGroups((previous) =>
      previous.map((group) => (group.id === groupId ? { ...group, ...patch } : group)),
    );
  }

  function addGroup() {
    const groupId = makeGroupId();
    setModelGroups((previous) => [
      ...previous,
      {
        id: groupId,
        name: `Group ${previous.length + 1}`,
        baseUrl: "",
        apiKey: "",
        isGateway: false,
        models: ["gpt-4o-mini"],
      },
    ]);
    setCollapsedGroups((previous) => ({
      ...previous,
      [groupId]: false,
    }));
  }

  function moveGroup(fromIndex: number, toIndex: number) {
    setModelGroups((previous) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= previous.length ||
        toIndex >= previous.length ||
        fromIndex === toIndex
      ) {
        return previous;
      }
      const next = [...previous];
      const [picked] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, picked);
      return next;
    });
  }

  function removeGroup(groupId: string) {
    setModelGroups((previous) => previous.filter((group) => group.id !== groupId));
    setTestStatuses((previous) => {
      const next = { ...previous };
      delete next[groupId];
      return next;
    });
    setCollapsedGroups((previous) => {
      const next = { ...previous };
      delete next[groupId];
      return next;
    });
  }

  function toggleGroupCollapsed(groupId: string) {
    setCollapsedGroups((previous) => ({
      ...previous,
      [groupId]: !(previous[groupId] ?? false),
    }));
  }

  function addModelToGroup(groupId: string) {
    setModelGroups((previous) =>
      previous.map((group) =>
        group.id === groupId
          ? { ...group, models: [...group.models, ""] }
          : group,
      ),
    );
  }

  function updateModelInGroup(groupId: string, modelIndex: number, value: string) {
    setModelGroups((previous) =>
      previous.map((group) =>
        group.id === groupId
          ? {
              ...group,
              models: group.models.map((model, index) => (index === modelIndex ? value : model)),
            }
          : group,
      ),
    );
  }

  function removeModelFromGroup(groupId: string, modelIndex: number) {
    setModelGroups((previous) =>
      previous.map((group) =>
        group.id === groupId
          ? { ...group, models: group.models.filter((_, index) => index !== modelIndex) }
          : group,
      ),
    );
  }

  function moveModelInGroup(groupId: string, fromIndex: number, toIndex: number) {
    setModelGroups((previous) =>
      previous.map((group) => {
        if (group.id !== groupId) return group;
        if (
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= group.models.length ||
          toIndex >= group.models.length ||
          fromIndex === toIndex
        ) {
          return group;
        }
        const nextModels = [...group.models];
        const [picked] = nextModels.splice(fromIndex, 1);
        nextModels.splice(toIndex, 0, picked);
        return { ...group, models: nextModels };
      }),
    );
  }

  async function handleTestConnection(group: ModelGroup) {
    const baseUrl = group.baseUrl.trim();
    const model = group.models.find((item) => item.trim())?.trim() || "";
    if (!baseUrl || !model) {
      return;
    }
    setTestStatuses((previous) => ({
      ...previous,
      [group.id]: { state: "testing" },
    }));
    try {
      const result = await evalTestConnection(
        baseUrl,
        group.isGateway ? undefined : group.apiKey.trim(),
        model,
      );
      setTestStatuses((previous) => ({
        ...previous,
        [group.id]: {
          state: result.success ? "success" : "fail",
          message: result.message,
        },
      }));
    } catch (error: unknown) {
      setTestStatuses((previous) => ({
        ...previous,
        [group.id]: { state: "fail", message: String(error) },
      }));
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

  async function handleConfirmKeepAndSwitch() {
    if (!pendingCategory) {
      return;
    }
    let saved = true;
    if (activeCategory === "basic") {
      saved = await handleSaveSkillsDir();
    } else if (activeCategory === "eval") {
      saved = await handleSaveApiConfig();
    }
    if (!saved) {
      return;
    }
    setActiveCategory(pendingCategory);
    closeCategoryConfirm();
  }

  function handleConfirmDiscardAndSwitch() {
    if (!pendingCategory) {
      return;
    }
    if (activeCategory === "basic") {
      setSkillsDir(savedSkillsDir);
    } else if (activeCategory === "eval") {
      setApiConfig(savedApiConfig);
      setTestStatuses({});
      setCollapsedGroups(
        (savedApiConfig.modelGroups ?? []).reduce<Record<string, boolean>>((acc, group) => {
          acc[group.id] = false;
          return acc;
        }, {}),
      );
    }
    setActiveCategory(pendingCategory);
    closeCategoryConfirm();
  }

  function renderBasicCategory() {
    return (
      <>
        <section className="settings-card">
          <h3 className="settings-card-title">{t("onboard.step3.skillsDir")}</h3>
          <p className="settings-help">{t("onboard.step1.desc")}</p>
          <div className="settings-row">
            <input
              className="field-input settings-path-input"
              value={skillsDir}
              onChange={(event) => setSkillsDir(event.target.value)}
              placeholder="C:\\Users\\Keith\\my-skills"
              disabled={busy}
            />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void handlePickPath()}
              disabled={busy}
            >
              {t("onboard.path.pick")}
            </button>
          </div>
          <div className="settings-card-actions">
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

        <section className="settings-card">
          <h3 className="settings-card-title">{t("settings.importMode.title")}</h3>
          <p className="settings-help">{t("settings.importMode.help")}</p>
          <div className="settings-row">
            <select
              className="filter-select settings-import-mode-select"
              value={importMode}
              disabled={busy}
              onChange={(event) => {
                const mode = event.target.value;
                setImportMode(mode);
                void setupSetImportMode(mode).catch((error: unknown) => {
                  setStatus(String(error));
                });
              }}
            >
              <option value="manual">{t("settings.importMode.manual")}</option>
              <option value="prompt">{t("settings.importMode.prompt")}</option>
              <option value="auto">{t("settings.importMode.auto")}</option>
            </select>
          </div>
        </section>
      </>
    );
  }

  function renderAppearanceCategory() {
    return (
      <>
        <section className="settings-card">
          <h3 className="settings-card-title">{t("settings.theme")}</h3>
          <p className="settings-help">{t("settings.theme.help")}</p>
          <div className="settings-row">
            <select
              className="filter-select settings-theme-select"
              value={themeMode}
              onChange={(event) => setThemeMode(event.target.value as ThemeMode)}
            >
              <option value="system">{t("settings.theme.system")}</option>
              <option value="light">{t("settings.theme.light")}</option>
              <option value="dark">{t("settings.theme.dark")}</option>
            </select>
          </div>
        </section>

        <section className="settings-card">
          <h3 className="settings-card-title">{t("locale.switch")}</h3>
          <div className="settings-row">
            <select
              className="filter-select settings-language-select"
              value={locale}
              onChange={(event) => setLocale(event.target.value as Locale)}
            >
              <option value="zh-CN">{t("locale.zhCN")}</option>
              <option value="en-US">{t("locale.enUS")}</option>
            </select>
          </div>
        </section>
      </>
    );
  }

  function renderIntegrationCategory() {
    return (
      <>
        <section className="settings-card">
          <h3 className="settings-card-title">{t("settings.update.title")}</h3>
          <p className="settings-help">{t("settings.update.help")}</p>
          <div className="settings-row settings-update-policy-row">
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={updaterSettings.auto_check}
                disabled={updaterSettingsLoading || updaterSettingsSaving}
                onChange={(event) => onUpdateSettingsPatch({ auto_check: event.target.checked })}
              />
              <span>{t("settings.update.autoCheck.label")}</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={updaterSettings.auto_install}
                disabled={updaterSettingsLoading || updaterSettingsSaving}
                onChange={(event) => onUpdateSettingsPatch({ auto_install: event.target.checked })}
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
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10);
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
            <span className="settings-version-chip">{t("settings.update.current", { version: appVersion })}</span>
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

        <section className="settings-card">
          <h3 className="settings-card-title">{t("settings.vscode.title")}</h3>
          <p className="settings-help">{t("settings.vscode.help")}</p>
          <p className="settings-help">{t("settings.vscode.sharedData.note")}</p>
          <p
            className={`settings-help settings-vscode-installed ${vscodeInstalled ? "is-installed" : "is-not-installed"}`}
          >
            {vscodeInstalled === null
              ? t("settings.vscode.status.checking")
              : vscodeInstalled
                ? t("settings.vscode.status.installed")
                : t("settings.vscode.status.notInstalled")}
          </p>
          <div className="settings-card-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleInstallVscodeExtension()}
              disabled={busy || vscodeInstallBusy || vscodeUninstallBusy}
            >
              {vscodeInstallBusy ? t("settings.vscode.installing") : t("settings.vscode.install.button")}
            </button>
            <button
              type="button"
              className={`btn ${vscodeInstalled ? "settings-vscode-uninstall-btn" : "settings-vscode-uninstall-btn-disabled"}`}
              onClick={() => void handleUninstallVscodeExtension()}
              disabled={busy || vscodeInstallBusy || vscodeUninstallBusy || !vscodeInstalled}
            >
              {vscodeUninstallBusy ? t("settings.vscode.uninstalling") : t("settings.vscode.uninstall.button")}
            </button>
          </div>
          {vscodeInstallStatus && (
            <p className="settings-help settings-vscode-status" role="status" aria-live="polite">
              {vscodeInstallStatus}
            </p>
          )}
        </section>
      </>
    );
  }

  function renderEvalCategory() {
    const modelGroups = apiConfig.modelGroups ?? [];
    return (
      <section className="settings-card">
        <h3 className="settings-card-title">{t("settings.evalConfig.title")}</h3>
        <p className="settings-help">{t("settings.evalConfig.help")}</p>
        <div className="settings-model-groups">
          {modelGroups.map((group, groupIndex) => {
            const testStatus = testStatuses[group.id] ?? { state: "idle" as const };
            const activeModelCount = group.models.filter((model) => model.trim()).length;
            const testDisabled =
              busy ||
              apiBusy ||
              testStatus.state === "testing" ||
              !group.baseUrl.trim() ||
              !group.models.some((model) => model.trim());
            const groupTitle = group.name || `${t("settings.modelGroup.groupName")} ${groupIndex + 1}`;
            const isCollapsed = collapsedGroups[group.id] ?? false;
            const groupContentId = `settings-model-group-content-${group.id}`;
            return (
              <article
                className="settings-model-group"
                key={group.id}
                draggable
                onDragStart={(event) => {
                  if (dragHandleActiveRef.current !== `group:${groupIndex}`) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("groupIdx", String(groupIndex));
                }}
                onDragEnd={() => {
                  dragHandleActiveRef.current = null;
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const from = Number.parseInt(event.dataTransfer.getData("groupIdx"), 10);
                  if (Number.isFinite(from) && from !== groupIndex) {
                    moveGroup(from, groupIndex);
                  }
                }}
              >
                <div className="settings-model-group-head">
                  <h4 className="settings-model-group-title">{groupTitle}</h4>
                  <div className="settings-model-group-head-meta">
                    <span className="settings-model-group-model-count">
                      {t("settings.modelGroup.modelCount", { count: activeModelCount })}
                    </span>
                    {testStatus.state === "success" && (
                      <span className="settings-model-group-status-ok">{t("settings.modelGroup.testSuccess")}</span>
                    )}
                    {testStatus.state === "fail" && (
                      <span className="settings-model-group-status-fail">{t("settings.modelGroup.testFailed")}</span>
                    )}
                    {testStatus.state === "testing" && (
                      <span className="settings-model-group-status-testing">{t("settings.modelGroup.testing")}</span>
                    )}
                  </div>
                  <div className="settings-model-group-actions">
                    <button
                      type="button"
                      className="btn btn-ghost settings-model-group-drag"
                      title={t("settings.modelGroup.dragGroup")}
                      onMouseDown={() => {
                        dragHandleActiveRef.current = `group:${groupIndex}`;
                      }}
                      onMouseUp={() => {
                        dragHandleActiveRef.current = null;
                      }}
                      onMouseLeave={() => {
                        if (!dragHandleActiveRef.current?.startsWith("group:")) {
                          return;
                        }
                        dragHandleActiveRef.current = null;
                      }}
                      disabled={busy || apiBusy}
                    >
                      ≡
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost settings-model-group-toggle"
                      onClick={() => toggleGroupCollapsed(group.id)}
                      disabled={busy || apiBusy}
                      aria-expanded={!isCollapsed}
                      aria-controls={groupContentId}
                    >
                      <IconChevronRight
                        className={`settings-model-group-toggle-icon ${isCollapsed ? "" : "is-expanded"}`}
                        size={14}
                      />
                      <span>
                        {isCollapsed ? t("settings.modelGroup.expand") : t("settings.modelGroup.collapse")}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => removeGroup(group.id)}
                      disabled={busy || apiBusy}
                    >
                      {t("settings.modelGroup.removeGroup")}
                    </button>
                  </div>
                </div>

                <div id={groupContentId} className="settings-model-group-content" hidden={isCollapsed}>
                  <div className="field">
                    <label className="field-label">{t("settings.modelGroup.groupName")}</label>
                    <input
                      className="field-input"
                      value={group.name}
                      onChange={(event) => updateGroup(group.id, { name: event.target.value })}
                      placeholder={`${t("settings.modelGroup.groupName")} ${groupIndex + 1}`}
                      autoComplete="off"
                      disabled={busy || apiBusy}
                    />
                  </div>

                  <div className="field">
                    <label className="field-label">{t("settings.modelGroup.url")}</label>
                    <input
                      className="field-input"
                      value={group.baseUrl}
                      onChange={(event) => updateGroup(group.id, { baseUrl: event.target.value })}
                      placeholder="https://api.openai.com/v1"
                      autoComplete="off"
                      disabled={busy || apiBusy}
                    />
                  </div>

                  <div className="field">
                    <div className="settings-row">
                      <label className="field-label">{t("settings.modelGroup.apiKey")}</label>
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={group.isGateway}
                          onChange={(event) => updateGroup(group.id, { isGateway: event.target.checked })}
                          disabled={busy || apiBusy}
                        />
                        <span>{t("settings.modelGroup.gateway")}</span>
                      </label>
                    </div>
                    {!group.isGateway && (
                      <input
                        className="field-input"
                        type="password"
                        value={group.apiKey}
                        onChange={(event) => updateGroup(group.id, { apiKey: event.target.value })}
                        placeholder="sk-..."
                        autoComplete="off"
                        disabled={busy || apiBusy}
                      />
                    )}
                  </div>

                  <div className="field">
                    <div className="settings-row">
                      <label className="field-label">{t("settings.modelGroup.addModel")}</label>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => addModelToGroup(group.id)}
                        disabled={busy || apiBusy}
                      >
                        + {t("settings.modelGroup.addModel")}
                      </button>
                    </div>

                    {group.models.length === 0 ? (
                      <p className="settings-help">{t("settings.modelGroup.emptyModels")}</p>
                    ) : (
                      <div className="settings-model-list">
                        {group.models.map((model, modelIndex) => (
                          <div
                            className="settings-model-row"
                            key={`${group.id}-${modelIndex}`}
                            draggable
                            onDragStart={(event) => {
                              if (dragHandleActiveRef.current !== `model:${group.id}:${modelIndex}`) {
                                event.preventDefault();
                                return;
                              }
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData(
                                "modelDrag",
                                JSON.stringify({ groupId: group.id, index: modelIndex }),
                              );
                            }}
                            onDragEnd={() => {
                              dragHandleActiveRef.current = null;
                            }}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const raw = event.dataTransfer.getData("modelDrag");
                              if (!raw) return;
                              try {
                                const payload = JSON.parse(raw) as {
                                  groupId?: string;
                                  index?: number;
                                };
                                if (
                                  payload.groupId === group.id &&
                                  Number.isFinite(payload.index) &&
                                  typeof payload.index === "number" &&
                                  payload.index !== modelIndex
                                ) {
                                  moveModelInGroup(group.id, payload.index, modelIndex);
                                }
                              } catch {
                                // ignore malformed drag payload
                              }
                            }}
                          >
                            <button
                              type="button"
                              className="btn btn-ghost settings-model-row-drag"
                              title={t("settings.modelGroup.dragModel")}
                              onMouseDown={() => {
                                dragHandleActiveRef.current = `model:${group.id}:${modelIndex}`;
                              }}
                              onMouseUp={() => {
                                dragHandleActiveRef.current = null;
                              }}
                              onMouseLeave={() => {
                                if (!dragHandleActiveRef.current?.startsWith(`model:${group.id}:`)) {
                                  return;
                                }
                                dragHandleActiveRef.current = null;
                              }}
                              disabled={busy || apiBusy}
                            >
                              ⋮⋮
                            </button>
                            <input
                              className="field-input"
                              value={model}
                              onChange={(event) =>
                                updateModelInGroup(group.id, modelIndex, event.target.value)
                              }
                              placeholder={t("settings.modelGroup.modelPlaceholder")}
                              autoComplete="off"
                              disabled={busy || apiBusy}
                            />
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => removeModelFromGroup(group.id, modelIndex)}
                              disabled={busy || apiBusy}
                            >
                              {t("settings.modelGroup.removeModel")}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="settings-row settings-model-test-row">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void handleTestConnection(group)}
                      disabled={testDisabled}
                    >
                      {testStatus.state === "testing"
                        ? t("settings.modelGroup.testing")
                        : t("settings.modelGroup.testConnection")}
                    </button>
                    {testStatus.state !== "idle" && (
                      <p
                        className={`settings-model-test-status ${
                          testStatus.state === "success"
                            ? "is-success"
                            : testStatus.state === "fail"
                              ? "is-fail"
                              : "is-testing"
                        }`}
                      >
                        {testStatus.state === "success"
                          ? t("settings.modelGroup.testSuccess")
                          : testStatus.state === "fail"
                            ? `${t("settings.modelGroup.testFailed")}: ${testStatus.message ?? ""}`
                            : t("settings.modelGroup.testing")}
                      </p>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <div className="settings-row settings-model-add-row">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={addGroup}
            disabled={busy || apiBusy}
          >
            + {t("settings.modelGroup.addGroup")}
          </button>
        </div>

        <div className="field">
          <label className="field-label">{t("settings.evalConfig.judgeModel")}</label>
          <input
            className="field-input"
            value={apiConfig.judgeModel ?? ""}
            onChange={(event) =>
              setApiConfig((previous) => ({
                ...previous,
                judgeModel: event.target.value,
              }))
            }
            placeholder={t("settings.evalConfig.judgeModelHint")}
            autoComplete="off"
            disabled={busy || apiBusy}
          />
          <p className="settings-help">{t("settings.evalConfig.judgeModelHelp")}</p>
        </div>

        <div className="field">
          <label className="field-label">{t("settings.evalConfig.costCurrency")}</label>
          <select
            className="filter-select settings-eval-currency-select"
            value={apiConfig.costCurrency}
            onChange={(event) =>
              setApiConfig((previous) => ({
                ...previous,
                costCurrency: normalizeCostCurrency(event.target.value),
              }))
            }
            disabled={busy || apiBusy}
          >
            <option value="USD">{t("settings.evalConfig.costCurrency.usd")}</option>
            <option value="CNY">{t("settings.evalConfig.costCurrency.cny")}</option>
          </select>
          <p className="settings-help">{t("settings.evalConfig.costCurrency.help")}</p>
        </div>
        <div className="settings-card-actions">
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
    );
  }

  function renderCategoryContent() {
    if (activeCategory === "basic") {
      return renderBasicCategory();
    }
    if (activeCategory === "appearance") {
      return renderAppearanceCategory();
    }
    if (activeCategory === "integration") {
      return renderIntegrationCategory();
    }
    return renderEvalCategory();
  }

  const activeMeta = CATEGORY_META[activeCategory];
  const pendingMeta = pendingCategory ? CATEGORY_META[pendingCategory] : null;
  const confirmBusy = activeCategory === "basic" ? busy : activeCategory === "eval" ? apiBusy : false;

  return (
    <div className="page animate-fadein settings-page">
      <header className="page-header">
        <h1 className="page-title">{t("nav.settings")}</h1>
      </header>

      <section className="chart-card settings-workbench">
        <aside className="settings-nav" aria-label={t("settings.categories.aria")}>
          {CATEGORY_ORDER.map((category) => {
            const meta = CATEGORY_META[category];
            const Icon = meta.icon;
            return (
              <div className="settings-nav-group" key={category}>
                <p className="settings-nav-group-label">{t(meta.groupLabelKey)}</p>
                <button
                  type="button"
                  className={`settings-nav-item ${activeCategory === category ? "is-active" : ""}`}
                  onClick={() => requestCategoryChange(category)}
                >
                  <Icon className="settings-nav-item-icon" size={16} />
                  <span>{t(meta.navLabelKey)}</span>
                </button>
              </div>
            );
          })}
        </aside>

        <div className="settings-pane">
          <header className="settings-pane-header">
            <div className="settings-pane-heading">
              <h2 className="settings-pane-title">{t(activeMeta.titleKey)}</h2>
              <p className="settings-pane-description">{t(activeMeta.descKey)}</p>
            </div>
            <p className={`settings-pane-status ${status ? "" : "is-empty"}`} role="status" aria-live="polite">
              {status || t("settings.status.idle")}
            </p>
          </header>

          <div className="settings-pane-scroll" ref={contentScrollRef}>
            {renderCategoryContent()}
          </div>
        </div>
      </section>

      {confirmOpen && pendingMeta && (
        <div className="settings-unsaved-overlay" onClick={closeCategoryConfirm}>
          <div
            className="settings-unsaved-dialog chart-card"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="settings-unsaved-title">{t("settings.unsaved.title")}</h3>
            <p className="settings-help">
              {t("settings.unsaved.desc", {
                current: t(activeMeta.titleKey),
                next: t(pendingMeta.titleKey),
              })}
            </p>
            <div className="settings-unsaved-actions">
              <button type="button" className="btn btn-ghost" onClick={closeCategoryConfirm} disabled={confirmBusy}>
                {t("settings.unsaved.cancel")}
              </button>
              <button
                type="button"
                className="btn settings-btn-danger-ghost"
                onClick={handleConfirmDiscardAndSwitch}
                disabled={confirmBusy}
              >
                {t("settings.unsaved.discard")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleConfirmKeepAndSwitch()}
                disabled={confirmBusy}
              >
                {t("settings.unsaved.keep")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

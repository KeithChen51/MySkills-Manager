import { open, save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import ReactECharts from "echarts-for-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  evalGenerateSamples,
  evalControl,
  evalEstimatePipeline,
  evalGetConfig,
  evalGetStoragePaths,
  evalListHistory,
  evalLoadHistory,
  evalSaveDataset,
  onboardingGetState,
  runEvalPipeline,
  type CostCurrency,
  type EvalHistoryEntry,
  type EvalModuleKey,
  type EvalPipelineEstimate,
  type EvalPipelineOutput,
  type EvalStoragePaths,
  type SkillMeta,
} from "../api/tauri";
import KpiCard from "../components/KpiCard";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import { useTheme } from "../theme/ThemeProvider";
import "./EvalPage.css";

type Props = { skills: SkillMeta[] };
type EvalMode = "quick" | "full";
type EvalControlAction = "pause" | "resume" | "cancel";
type EvalDraftKind = "trigger" | "functional";

type TriggerDraftRow = {
  query: string;
  shouldTrigger: boolean;
  testBucket: TriggerBucketKey;
};

type FunctionalDraftRow = {
  id: string;
  prompt: string;
  assertionsText: string;
};

type KpiHelpMeta = {
  dimension: string;
  description: string;
};

type TriggerBucketKey =
  | "positive_trigger"
  | "negative_trigger"
  | "boundary_ambiguous"
  | "adjacent_skill_confusion";

type EvalProgressEvent = {
  runId: string;
  status: "running" | "paused" | "completed" | "cancelled" | "error" | string;
  currentRepeat: number;
  totalRepeats: number;
  stepIndex: number;
  totalSteps: number;
  stepName: string;
  message: string;
  messageKey?: string;
  messageArgs?: Record<string, string | number | boolean>;
  elapsedMs: number;
};

const EVAL_PROGRESS_STEP_KEYS: Record<string, MessageKey> = {
  pipeline: "eval.progress.step.pipeline",
  quick_checks: "eval.progress.step.quickChecks",
  trigger_clean: "eval.progress.step.triggerClean",
  trigger_complex: "eval.progress.step.triggerComplex",
  functional_with_skill: "eval.progress.step.functionalWithSkill",
  functional_without_skill: "eval.progress.step.functionalWithoutSkill",
};

const MODEL_PRESETS = [
  "gpt-4o-mini",
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-4o",
];
const USD_TO_CNY_RATE = 7.2;
const TRIGGER_BUCKET_MIN_SAMPLES = 12;
const FUNCTIONAL_MIN_SAMPLES = 24;
const EVAL_MODULE_OPTIONS: Array<{
  key: EvalModuleKey;
  labelKey: string;
  needsFunctional: boolean;
}> = [
  { key: "trigger_accuracy", labelKey: "eval.modules.triggerAccuracy", needsFunctional: false },
  { key: "execution_correctness", labelKey: "eval.modules.executionCorrectness", needsFunctional: true },
  { key: "robustness_security", labelKey: "eval.modules.robustnessSecurity", needsFunctional: false },
  { key: "economics", labelKey: "eval.modules.economics", needsFunctional: true },
  { key: "auditability", labelKey: "eval.modules.auditability", needsFunctional: false },
];
const TRIGGER_BUCKET_OPTIONS: Array<{ key: TriggerBucketKey; labelKey: string }> = [
  { key: "positive_trigger", labelKey: "eval.samples.bucket.positive" },
  { key: "negative_trigger", labelKey: "eval.samples.bucket.negative" },
  { key: "boundary_ambiguous", labelKey: "eval.samples.bucket.boundary" },
  { key: "adjacent_skill_confusion", labelKey: "eval.samples.bucket.adjacent" },
];
const DEFAULT_TRIGGER_SAMPLE_COUNT = TRIGGER_BUCKET_OPTIONS.length * TRIGGER_BUCKET_MIN_SAMPLES;

function defaultSelectedModules(): EvalModuleKey[] {
  return EVAL_MODULE_OPTIONS.map((item) => item.key);
}

function defaultBucketForShouldTrigger(shouldTrigger: boolean): TriggerBucketKey {
  return shouldTrigger ? "positive_trigger" : "negative_trigger";
}

function resolveRequestedJudgeModels(mode: EvalMode, model: string): string[] {
  const primary = model.trim();
  if (!primary) return [];
  if (mode === "full") {
    return Array.from(new Set([primary, "gpt-4.1-mini"].filter(Boolean)));
  }
  return [primary];
}

function formatDurationLabel(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function formatInteger(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString();
}

function normalizeCostCurrency(value: string | undefined): CostCurrency {
  return value === "CNY" ? "CNY" : "USD";
}

function toCurrencyAmount(usd: number, currency: CostCurrency): number {
  if (!Number.isFinite(usd)) return 0;
  return currency === "CNY" ? usd * USD_TO_CNY_RATE : usd;
}

function formatCostAmount(usd: number, currency: CostCurrency): string {
  const symbol = currency === "CNY" ? "¥" : "$";
  return `${symbol}${toCurrencyAmount(usd, currency).toFixed(4)}`;
}

function formatCostRange(
  estimatedUsd: number,
  estimatedUsdMin: number | undefined,
  estimatedUsdMax: number | undefined,
  currency: CostCurrency,
): string {
  const minUsd =
    typeof estimatedUsdMin === "number" && Number.isFinite(estimatedUsdMin)
      ? estimatedUsdMin
      : estimatedUsd * 0.8;
  const maxUsd =
    typeof estimatedUsdMax === "number" && Number.isFinite(estimatedUsdMax)
      ? estimatedUsdMax
      : estimatedUsd * 1.2;
  const symbol = currency === "CNY" ? "¥" : "$";
  return `${symbol}${toCurrencyAmount(minUsd, currency).toFixed(4)} - ${symbol}${toCurrencyAmount(
    maxUsd,
    currency,
  ).toFixed(4)}`;
}

function toSinglePath(value: string | string[] | null): string | null {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string" && value[0].trim()) {
    return value[0];
  }
  return null;
}

function skillDocPath(skill: SkillMeta | undefined): string | undefined {
  if (!skill) return undefined;
  return `${skill.directory.replace(/[\\/]+$/, "")}/SKILL.md`;
}

function compactPath(path: string | null | undefined): string {
  if (!path) return "--";
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

function formatTokenPair(inputTokens: number | null | undefined, outputTokens: number | null | undefined): string {
  if (typeof inputTokens !== "number" && typeof outputTokens !== "number") {
    return "--";
  }
  return `${inputTokens ?? 0}/${outputTokens ?? 0}`;
}

function parseTriggerDraftRows(raw: string): TriggerDraftRow[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Trigger draft must be a JSON array.");
  }
  return parsed.map((item) => {
    const row = item as Record<string, unknown>;
    if (typeof row.query !== "string" || typeof row.should_trigger !== "boolean") {
      throw new Error(
        "Trigger draft row must include query(string), should_trigger(boolean), and optional test_bucket(string).",
      );
    }
    const rawBucket = typeof row.test_bucket === "string" ? row.test_bucket : undefined;
    const normalizedBucket = TRIGGER_BUCKET_OPTIONS.find((item) => item.key === rawBucket)?.key;
    return {
      query: row.query.trim(),
      shouldTrigger: row.should_trigger,
      testBucket: normalizedBucket ?? defaultBucketForShouldTrigger(row.should_trigger),
    };
  });
}

function parseFunctionalDraftRows(raw: string): FunctionalDraftRow[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Functional draft must be a JSON array.");
  }
  return parsed.map((item) => {
    const row = item as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      typeof row.prompt !== "string" ||
      !Array.isArray(row.assertions)
    ) {
      throw new Error("Functional draft row must include id, prompt, assertions.");
    }
    return {
      id: row.id.trim(),
      prompt: row.prompt.trim(),
      assertionsText: row.assertions
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .join("\n"),
    };
  });
}

function serializeTriggerDraftRows(rows: TriggerDraftRow[]): string {
  return JSON.stringify(
    rows
      .map((row) => ({
        query: row.query.trim(),
        should_trigger: row.shouldTrigger,
        test_bucket: row.testBucket,
      }))
      .filter((row) => row.query.length > 0),
    null,
    2,
  );
}

function serializeFunctionalDraftRows(rows: FunctionalDraftRow[]): string {
  return JSON.stringify(
    rows
      .map((row) => ({
        id: row.id.trim(),
        prompt: row.prompt.trim(),
        assertions: row.assertionsText
          .split(/\r?\n/)
          .map((entry) => entry.trim())
          .filter(Boolean),
      }))
      .filter((row) => row.id.length > 0 && row.prompt.length > 0 && row.assertions.length > 0),
    null,
    2,
  );
}

export default function EvalPage({ skills }: Props) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const chartThemeName =
    resolvedTheme === "dark" ? "myskills-soft-dark" : "myskills-soft-light";

  const [selectedSkill, setSelectedSkill] = useState("");
  const [evalMode, setEvalMode] = useState<EvalMode>("full");
  const [model, setModel] = useState("gpt-4o-mini");
  const [costCurrency, setCostCurrency] = useState<CostCurrency>("USD");
  const [repeatsInput, setRepeatsInput] = useState("1");
  const [maxCostUsdInput, setMaxCostUsdInput] = useState("");
  const [selectedModules, setSelectedModules] = useState<EvalModuleKey[]>(defaultSelectedModules());
  const [running, setRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const [progressEvent, setProgressEvent] = useState<EvalProgressEvent | null>(null);
  const [progressStartedAtMs, setProgressStartedAtMs] = useState<number | null>(null);
  const [progressElapsedMs, setProgressElapsedMs] = useState(0);
  const [controlBusy, setControlBusy] = useState(false);
  const [pauseRequested, setPauseRequested] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savingDraft, setSavingDraft] = useState<EvalDraftKind | null>(null);
  const [status, setStatus] = useState("");
  const [report, setReport] = useState<EvalPipelineOutput | null>(null);
  const [skillsRootDir, setSkillsRootDir] = useState<string | undefined>(undefined);
  const [storagePaths, setStoragePaths] = useState<EvalStoragePaths | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<EvalHistoryEntry[]>([]);
  const [showSamples, setShowSamples] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedHistoryPath, setExpandedHistoryPath] = useState<string | null>(null);
  const [historyDetails, setHistoryDetails] = useState<Record<string, EvalPipelineOutput>>({});
  const [historyDetailLoadingPath, setHistoryDetailLoadingPath] = useState<string | null>(null);
  const [historyDetailErrors, setHistoryDetailErrors] = useState<Record<string, string>>({});
  const [triggerSetPath, setTriggerSetPath] = useState("");
  const [functionalSetPath, setFunctionalSetPath] = useState("");
  const [triggerDraftRows, setTriggerDraftRows] = useState<TriggerDraftRow[]>([]);
  const [functionalDraftRows, setFunctionalDraftRows] = useState<FunctionalDraftRow[]>([]);
  const [preflightEstimate, setPreflightEstimate] = useState<EvalPipelineEstimate | null>(null);
  const [preflightEstimateError, setPreflightEstimateError] = useState("");
  const [preflightEstimating, setPreflightEstimating] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [stepOverride, setStepOverride] = useState<1 | 2 | 3 | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const pageHeaderRef = useRef<HTMLElement | null>(null);
  const runDockRef = useRef<HTMLElement | null>(null);
  const [headerTopPx, setHeaderTopPx] = useState(56);
  const [headerOffsetPx, setHeaderOffsetPx] = useState(96);
  const [runDockOffsetPx, setRunDockOffsetPx] = useState(280);

  const selectedSkillMeta = useMemo(
    () => skills.find((item) => item.name === selectedSkill),
    [skills, selectedSkill],
  );
  const selectedModulesForRun = useMemo<EvalModuleKey[]>(
    () => (evalMode === "quick" ? [] : selectedModules),
    [evalMode, selectedModules],
  );
  const requiresFunctionalByModules = useMemo(
    () =>
      evalMode !== "quick" &&
      selectedModulesForRun.some(
        (key) => EVAL_MODULE_OPTIONS.find((option) => option.key === key)?.needsFunctional ?? false,
      ),
    [evalMode, selectedModulesForRun],
  );
  const triggerDraftCount = triggerDraftRows.length;
  const functionalDraftCount = functionalDraftRows.length;
  const kpiHelp = useMemo<Record<string, KpiHelpMeta>>(
    () => ({
      triggerPassRate: {
        dimension: t("eval.dimension.triggerCore"),
        description: t("eval.kpi.help.triggerPassRate"),
      },
      functionalPassRate: {
        dimension: t("eval.dimension.functionalCore"),
        description: t("eval.kpi.help.functionalPassRate"),
      },
      totalCases: {
        dimension: t("eval.dimension.coverage"),
        description: t("eval.kpi.help.totalCases"),
      },
      totalPassed: {
        dimension: t("eval.dimension.coverage"),
        description: t("eval.kpi.help.totalPassed"),
      },
      precision: {
        dimension: t("eval.dimension.triggerCore"),
        description: t("eval.kpi.help.precision"),
      },
      recall: {
        dimension: t("eval.dimension.triggerCore"),
        description: t("eval.kpi.help.recall"),
      },
      fpr: {
        dimension: t("eval.dimension.triggerCore"),
        description: t("eval.kpi.help.fpr"),
      },
      costEstimate: {
        dimension: t("eval.dimension.efficiency"),
        description: t("eval.kpi.help.costEstimate"),
      },
      repeatStats: {
        dimension: t("eval.dimension.robustness"),
        description: t("eval.kpi.help.repeatStats"),
      },
      valueAdded: {
        dimension: t("eval.dimension.valueAdded"),
        description: t("eval.kpi.help.valueAdded"),
      },
      executedSteps: {
        dimension: t("eval.dimension.pipeline"),
        description: t("eval.kpi.help.executedSteps"),
      },
    }),
    [t],
  );

  useEffect(() => {
    void evalGetConfig()
      .then((config) => {
        if (config.defaultModel?.trim()) {
          setModel(config.defaultModel.trim());
        }
        setCostCurrency(normalizeCostCurrency(config.costCurrency));
      })
      .catch(() => {
        // keep defaults
      });
    void onboardingGetState()
      .then((state) => {
        if (state.skillsDir?.trim()) {
          setSkillsRootDir(state.skillsDir.trim());
        }
      })
      .catch(() => {
        // keep undefined
      });
  }, []);

  useEffect(() => {
    if (!selectedSkill) {
      setStoragePaths(null);
      setHistoryEntries([]);
      setShowSamples(false);
      setShowHistory(false);
      setExpandedHistoryPath(null);
      setHistoryDetails({});
      setHistoryDetailErrors({});
      setHistoryDetailLoadingPath(null);
      return;
    }
    void refreshHistory(selectedSkill);
  }, [selectedSkill]);

  useEffect(() => {
    if (!showHistory && !showSamples) return;
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowHistory(false);
        setShowSamples(false);
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => {
      window.removeEventListener("keydown", onKeydown);
    };
  }, [showHistory, showSamples]);

  useEffect(() => {
    if (!showHistory) {
      setExpandedHistoryPath(null);
    }
  }, [showHistory]);

  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<EvalProgressEvent>("eval://pipeline-progress", (event) => {
      const payload = event.payload;
      if (!activeRunIdRef.current || payload.runId !== activeRunIdRef.current) {
        return;
      }
      setProgressEvent(payload);
      setProgressStartedAtMs(Date.now() - payload.elapsedMs);
      setProgressElapsedMs(payload.elapsedMs);
      if (payload.status === "cancelled") {
        setStatus(t("eval.status.cancelled"));
      }
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {
        // keep polling-free fallback
      });
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [t]);

  useEffect(() => {
    if (!(running || generating) || progressStartedAtMs === null) {
      return;
    }
    const updateElapsed = () => {
      setProgressElapsedMs(Math.max(0, Date.now() - progressStartedAtMs));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [running, generating, progressStartedAtMs]);

  useEffect(() => {
    const docPath = skillDocPath(selectedSkillMeta);
    const trimmedModel = model.trim();
    const trimmedTriggerSetPath = triggerSetPath.trim();
    const trimmedFunctionalSetPath = functionalSetPath.trim();
    const requiresFunctionalSet = requiresFunctionalByModules;

    if (
      !selectedSkill ||
      !docPath ||
      !trimmedModel ||
      !trimmedTriggerSetPath ||
      (requiresFunctionalSet && !trimmedFunctionalSetPath)
    ) {
      setPreflightEstimate(null);
      setPreflightEstimateError("");
      setPreflightEstimating(false);
      return;
    }

    const repeats = Number.parseInt(repeatsInput, 10);
    if (!Number.isFinite(repeats) || repeats < 1) {
      setPreflightEstimate(null);
      setPreflightEstimateError(t("eval.error.repeatsInvalid"));
      setPreflightEstimating(false);
      return;
    }

    const budgetInputValue = maxCostUsdInput.trim() ? Number(maxCostUsdInput.trim()) : undefined;
    if (budgetInputValue !== undefined && (!Number.isFinite(budgetInputValue) || budgetInputValue <= 0)) {
      setPreflightEstimate(null);
      setPreflightEstimateError(t("eval.error.maxCostInvalid"));
      setPreflightEstimating(false);
      return;
    }
    const maxCostUsd =
      budgetInputValue === undefined
        ? undefined
        : costCurrency === "CNY"
          ? budgetInputValue / USD_TO_CNY_RATE
          : budgetInputValue;

    const functionalPathForEstimate =
      requiresFunctionalSet ? trimmedFunctionalSetPath : trimmedFunctionalSetPath || trimmedTriggerSetPath;
    const requestedModels = resolveRequestedJudgeModels(evalMode, trimmedModel);

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPreflightEstimating(true);
      setPreflightEstimateError("");
      void evalEstimatePipeline({
        skillName: selectedSkill,
        skillPath: docPath,
        triggerEvalSetPath: trimmedTriggerSetPath,
        functionalEvalSetPath: functionalPathForEstimate,
        mode: evalMode,
        model: trimmedModel,
        judgeModels: requestedModels,
        repeats,
        maxCostUsd,
        selectedModules: selectedModulesForRun,
      })
        .then((estimate) => {
          if (!cancelled) {
            setPreflightEstimate(estimate);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setPreflightEstimate(null);
            setPreflightEstimateError(`${t("eval.preflight.errorPrefix")}: ${String(error)}`);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setPreflightEstimating(false);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    selectedSkill,
    selectedSkillMeta,
    evalMode,
    model,
    costCurrency,
    repeatsInput,
    maxCostUsdInput,
    triggerSetPath,
    functionalSetPath,
    requiresFunctionalByModules,
    selectedModulesForRun,
    t,
  ]);

  async function pickEvalSet(kind: "trigger" | "functional") {
    const selected = await open({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
      title: kind === "trigger" ? t("eval.dataset.trigger") : t("eval.dataset.functional"),
    });
    const next = toSinglePath(selected);
    if (!next) return;
    if (kind === "trigger") {
      setTriggerSetPath(next);
    } else {
      setFunctionalSetPath(next);
    }
  }

  async function refreshHistory(skillName: string) {
    if (!skillName.trim()) {
      setHistoryEntries([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const [paths, items] = await Promise.all([
        evalGetStoragePaths(skillName),
        evalListHistory(skillName, 30),
      ]);
      setStoragePaths(paths);
      setHistoryEntries(items);
    } catch {
      setHistoryEntries([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleLoadHistory(path: string) {
    setHistoryLoading(true);
    try {
      const loaded = await evalLoadHistory(path);
      setReport(loaded);
      setStatus(t("eval.history.loaded", { path }));
      setShowHistory(false);
    } catch (error: unknown) {
      setStatus(`${t("eval.error.runFailed")}: ${String(error)}`);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleToggleHistoryExpand(path: string) {
    if (expandedHistoryPath === path) {
      setExpandedHistoryPath(null);
      return;
    }
    setExpandedHistoryPath(path);
    if (historyDetails[path] || historyDetailLoadingPath === path) {
      return;
    }
    setHistoryDetailLoadingPath(path);
    setHistoryDetailErrors((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    try {
      const loaded = await evalLoadHistory(path);
      setHistoryDetails((prev) => ({ ...prev, [path]: loaded }));
    } catch (error: unknown) {
      setHistoryDetailErrors((prev) => ({ ...prev, [path]: String(error) }));
    } finally {
      setHistoryDetailLoadingPath((current) => (current === path ? null : current));
    }
  }

  async function handleGenerateSamples() {
    if (generating) {
      return;
    }
    if (!selectedSkill) {
      setStatus(t("eval.error.selectSkill"));
      return;
    }
    if (!model.trim()) {
      setStatus(t("eval.error.modelRequired"));
      return;
    }
    const docPath = skillDocPath(selectedSkillMeta);
    if (!docPath) {
      setStatus(t("eval.error.skillPathMissing"));
      return;
    }

    setGenerating(true);
    setProgressEvent(null);
    setProgressElapsedMs(0);
    setProgressStartedAtMs(Date.now());
    setStatus(t("eval.samples.generating"));
    try {
      const drafts = await evalGenerateSamples({
        skillName: selectedSkill,
        skillPath: docPath,
        model: model.trim(),
        triggerCount: DEFAULT_TRIGGER_SAMPLE_COUNT,
        functionalCount: FUNCTIONAL_MIN_SAMPLES,
      });
      const nextTriggerRows = parseTriggerDraftRows(drafts.triggerDraft);
      const nextFunctionalRows = parseFunctionalDraftRows(drafts.functionalDraft);
      setTriggerDraftRows(nextTriggerRows);
      setFunctionalDraftRows(nextFunctionalRows);
      setShowSamples(true);
      setShowHistory(false);
      setStatus(
        t("eval.samples.generated", {
          trigger: nextTriggerRows.length,
          functional: nextFunctionalRows.length,
        }),
      );
    } catch (error: unknown) {
      setStatus(`${t("eval.error.generateFailed")}: ${String(error)}`);
    } finally {
      setGenerating(false);
      setProgressStartedAtMs(null);
    }
  }

  async function handleSaveDraft(kind: EvalDraftKind, saveMode: "default" | "choose") {
    const content =
      kind === "trigger"
        ? serializeTriggerDraftRows(triggerDraftRows)
        : serializeFunctionalDraftRows(functionalDraftRows);
    const parsed = JSON.parse(content) as unknown;
    const count = Array.isArray(parsed) ? parsed.length : 0;
    if (count <= 0) {
      const typeLabel =
        kind === "trigger" ? t("eval.dataset.trigger") : t("eval.dataset.functional");
      setStatus(t("eval.error.datasetRequired", { type: typeLabel }));
      return;
    }

    let chosenPath: string | undefined;
    if (saveMode === "choose") {
      const chosen = await save({
        defaultPath: `${selectedSkill || "skill"}-${kind}-eval.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
        title: kind === "trigger" ? t("eval.samples.saveTrigger") : t("eval.samples.saveFunctional"),
      });
      if (typeof chosen !== "string" || !chosen.trim()) {
        return;
      }
      chosenPath = chosen;
    }

    setSavingDraft(kind);
    try {
      const saved = await evalSaveDataset({
        path: chosenPath,
        content,
        kind,
        skillName: selectedSkill || undefined,
      });
      if (kind === "trigger") {
        setTriggerSetPath(saved.path);
      } else {
        setFunctionalSetPath(saved.path);
      }
      if (selectedSkill) {
        await refreshHistory(selectedSkill);
      }
      setStatus(t("eval.samples.saved", { type: kind, path: saved.path }));
    } catch (error: unknown) {
      setStatus(`${t("eval.error.runFailed")}: ${String(error)}`);
    } finally {
      setSavingDraft(null);
    }
  }

  async function handleEvalControl(action: EvalControlAction) {
    if (!activeRunId) return;
    setControlBusy(true);
    try {
      await evalControl(activeRunId, action);
      if (action === "pause") {
        setPauseRequested(true);
        setStatus(t("eval.status.pauseRequested"));
      } else if (action === "resume") {
        setPauseRequested(false);
        setStatus(t("eval.status.resumeRequested"));
      } else {
        setStatus(t("eval.status.cancelRequested"));
      }
    } catch (error: unknown) {
      setStatus(`${t("eval.error.controlFailed")}: ${String(error)}`);
    } finally {
      setControlBusy(false);
    }
  }

  async function handleRunEval() {
    if (!selectedSkill) {
      setStatus(t("eval.error.selectSkill"));
      return;
    }
    if (!model.trim()) {
      setStatus(t("eval.error.modelRequired"));
      return;
    }
    if (!triggerSetPath.trim()) {
      setStatus(t("eval.error.datasetRequired", { type: t("eval.dataset.trigger") }));
      return;
    }
    if (requiresFunctionalByModules && !functionalSetPath.trim()) {
      setStatus(t("eval.error.datasetRequired", { type: t("eval.dataset.functional") }));
      return;
    }

    const docPath = skillDocPath(selectedSkillMeta);
    if (!docPath) {
      setStatus(t("eval.error.skillPathMissing"));
      return;
    }
    const repeats = Number.parseInt(repeatsInput, 10);
    if (!Number.isFinite(repeats) || repeats < 1) {
      setStatus(t("eval.error.repeatsInvalid"));
      return;
    }
    const budgetInputValue = maxCostUsdInput.trim()
      ? Number(maxCostUsdInput.trim())
      : undefined;
    if (budgetInputValue !== undefined && (!Number.isFinite(budgetInputValue) || budgetInputValue <= 0)) {
      setStatus(t("eval.error.maxCostInvalid"));
      return;
    }
    const maxCostUsd =
      budgetInputValue === undefined
        ? undefined
        : costCurrency === "CNY"
          ? budgetInputValue / USD_TO_CNY_RATE
          : budgetInputValue;
    const runId = `eval-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    setRunning(true);
    setActiveRunId(runId);
    setPauseRequested(false);
    setControlBusy(false);
    setReport(null);
    setProgressEvent(null);
    setProgressElapsedMs(0);
    setProgressStartedAtMs(Date.now());
    setShowSamples(false);
    setShowHistory(false);
    setStatus(t("eval.running"));

    try {
      const requestedModels = resolveRequestedJudgeModels(evalMode, model);
      const pipeline = await runEvalPipeline({
        skillName: selectedSkill,
        skillPath: docPath,
        triggerEvalSetPath: triggerSetPath,
        functionalEvalSetPath: requiresFunctionalByModules
          ? functionalSetPath.trim()
          : functionalSetPath.trim() || triggerSetPath,
        mode: evalMode,
        model: model.trim(),
        installedSkillsDir: skillsRootDir,
        judgeModels: requestedModels,
        repeats,
        temperature: 0,
        maxCostUsd,
        selectedModules: selectedModulesForRun,
        runId,
      });
      if (pipeline.status !== "success") {
        throw new Error(pipeline.message || "Evaluation failed");
      }
      setReport(pipeline);
      if (selectedSkill) {
        await refreshHistory(selectedSkill);
      }
      if (pipeline.historyPath) {
        setStatus(t("eval.history.saved", { path: pipeline.historyPath }));
      } else if (pipeline.message?.trim()) {
        setStatus(pipeline.message);
      } else {
        setStatus("");
      }
    } catch (error: unknown) {
      setStatus(`${t("eval.error.runFailed")}: ${String(error)}`);
    } finally {
      setActiveRunId(null);
      setPauseRequested(false);
      setRunning(false);
    }
  }

  function renderSummaryKpis() {
    if (!report) return null;
    const functionalSummary = report.functional?.summary;
    const functionalPassRate =
      report.mode === "quick"
        ? "--"
        : functionalSummary
          ? `${Math.round(functionalSummary.passRate * 100)}%`
          : "--";
    return (
      <div className="kpi-row">
        <KpiCard
          label={t("eval.kpi.triggerPassRate")}
          value={`${Math.round(report.dimensionScores.triggerAccuracy * 100)}%`}
          dimension={kpiHelp.triggerPassRate.dimension}
          description={kpiHelp.triggerPassRate.description}
        />
        <KpiCard
          label={t("eval.kpi.functionalPassRate")}
          value={functionalPassRate}
          dimension={kpiHelp.functionalPassRate.dimension}
          description={kpiHelp.functionalPassRate.description}
        />
        <KpiCard
          label={t("eval.kpi.totalCases")}
          value={report.summary.totalCases}
          dimension={kpiHelp.totalCases.dimension}
          description={kpiHelp.totalCases.description}
        />
        <KpiCard
          label={t("eval.kpi.totalPassed")}
          value={report.summary.totalPassed}
          dimension={kpiHelp.totalPassed.dimension}
          description={kpiHelp.totalPassed.description}
        />
      </div>
    );
  }

  function renderModeKpis() {
    if (!report) return null;
    const overallStats = report.repeatStats?.overallPassRate;
    const overallStatsLabel = overallStats
      ? `${Math.round(overallStats.mean * 100)}% +/- ${Math.round(overallStats.stdDev * 100)}%`
      : "--";
    const valueAddedLabel = report.deltaVsNoSkill
      ? `${Math.round(report.deltaVsNoSkill.functionalPassRateDelta * 100)}%`
      : "--";
    return (
      <div className="kpi-row">
        <KpiCard
          label={t("eval.kpi.precision")}
          value={`${Math.round(report.triggerMetrics.precision * 100)}%`}
          dimension={kpiHelp.precision.dimension}
          description={kpiHelp.precision.description}
        />
        <KpiCard
          label={t("eval.kpi.recall")}
          value={`${Math.round(report.triggerMetrics.recall * 100)}%`}
          dimension={kpiHelp.recall.dimension}
          description={kpiHelp.recall.description}
        />
        <KpiCard
          label={t("eval.kpi.fpr")}
          value={`${Math.round(report.triggerMetrics.fpr * 100)}%`}
          dimension={kpiHelp.fpr.dimension}
          description={kpiHelp.fpr.description}
        />
        <KpiCard
          label={t("eval.kpi.costEstimate")}
          value={formatCostRange(
            report.costEstimate.estimatedUsd,
            report.costEstimate.estimatedUsdMin,
            report.costEstimate.estimatedUsdMax,
            costCurrency,
          )}
          dimension={kpiHelp.costEstimate.dimension}
          description={kpiHelp.costEstimate.description}
        />
        <KpiCard
          label={t("eval.kpi.repeatStats")}
          value={overallStatsLabel}
          dimension={kpiHelp.repeatStats.dimension}
          description={kpiHelp.repeatStats.description}
        />
        <KpiCard
          label={t("eval.kpi.valueAdded")}
          value={valueAddedLabel}
          dimension={kpiHelp.valueAdded.dimension}
          description={kpiHelp.valueAdded.description}
        />
        <KpiCard
          label={t("eval.kpi.executedSteps")}
          value={report.runMeta.executedSteps}
          dimension={kpiHelp.executedSteps.dimension}
          description={kpiHelp.executedSteps.description}
        />
      </div>
    );
  }

  function resolvePreflightStepLabel(stepKey: string): string {
    switch (stepKey) {
      case "taxonomy":
        return t("eval.preflight.step.taxonomy");
      case "quick-taxonomy-validity":
        return t("eval.preflight.step.quickTaxonomyValidity");
      case "quick-structure-syntax":
        return t("eval.preflight.step.quickStructureSyntax");
      case "quick-generation-guardrail":
        return t("eval.preflight.step.quickGenerationGuardrail");
      case "quick-ui-metadata-consistency":
        return t("eval.preflight.step.quickUiMetadataConsistency");
      case "quick-script-smoke":
        return t("eval.preflight.step.quickScriptSmoke");
      case "quick-trigger-bucket-coverage":
        return t("eval.preflight.step.quickTriggerBucketCoverage");
      case "trigger-clean":
        return t("eval.preflight.step.triggerClean");
      case "trigger-complex":
        return t("eval.preflight.step.triggerComplex");
      case "functional-with-skill":
        return t("eval.preflight.step.functionalWithSkill");
      case "functional-without-skill":
        return t("eval.preflight.step.functionalWithoutSkill");
      case "auditability-check":
        return t("eval.preflight.step.auditabilityCheck");
      default:
        return stepKey;
    }
  }

  function handleToggleModule(moduleKey: EvalModuleKey) {
    setSelectedModules((prev) => {
      const exists = prev.includes(moduleKey);
      if (exists) {
        const next = prev.filter((item) => item !== moduleKey);
        return next.length > 0 ? next : prev;
      }
      return [...prev, moduleKey];
    });
  }

  function renderPreflightEstimate() {
    if (!selectedSkill) return null;

    return (
      <section className="eval-preflight-card">
        <div className="eval-preflight-head">
          <h4 className="chart-title">{t("eval.preflight.title")}</h4>
          {preflightEstimating && <span className="eval-path-hint">{t("eval.preflight.calculating")}</span>}
        </div>
        <p className="eval-preflight-note">{t("eval.preflight.note")}</p>
        {costCurrency === "CNY" && (
          <p className="eval-path-hint">{t("eval.preflight.fxNote", { rate: USD_TO_CNY_RATE })}</p>
        )}

        {preflightEstimateError && (
          <p className="settings-status" role="status">
            {preflightEstimateError}
          </p>
        )}

        {!preflightEstimateError && !preflightEstimate && !preflightEstimating && (
          <p className="eval-path-hint">{t("eval.preflight.awaiting")}</p>
        )}

        {preflightEstimate && (
          <>
            <div className="eval-preflight-grid">
              <div>
                <span className="eval-history-item-label">{t("eval.preflight.totalTime")}</span>
                <strong>{formatDurationLabel(preflightEstimate.estimatedSeconds)}</strong>
              </div>
              <div>
                <span className="eval-history-item-label">{t("eval.preflight.totalTokens")}</span>
                <strong>{formatInteger(preflightEstimate.estimatedTotalTokens)}</strong>
              </div>
              <div>
                <span className="eval-history-item-label">{t("eval.preflight.inputTokens")}</span>
                <strong>{formatInteger(preflightEstimate.estimatedInputTokens)}</strong>
              </div>
              <div>
                <span className="eval-history-item-label">{t("eval.preflight.outputTokens")}</span>
                <strong>{formatInteger(preflightEstimate.estimatedOutputTokens)}</strong>
              </div>
              <div>
                <span className="eval-history-item-label">{t("eval.preflight.estimatedCostRange")}</span>
                <strong>
                  {formatCostRange(
                    preflightEstimate.costEstimate.estimatedUsd,
                    preflightEstimate.costEstimate.estimatedUsdMin,
                    preflightEstimate.costEstimate.estimatedUsdMax,
                    costCurrency,
                  )}
                </strong>
              </div>
              <div>
                <span className="eval-history-item-label">{t("eval.preflight.taxonomyLabel")}</span>
                <strong>
                  {preflightEstimate.taxonomyPending
                    ? t("eval.preflight.taxonomyPending")
                    : t("eval.preflight.taxonomyReady")}
                </strong>
              </div>
            </div>

            {preflightEstimate.costEstimate.budgetExceeded && (
              <p className="settings-status">
                {preflightEstimate.costEstimate.budgetLimitUsd
                  ? t("eval.preflight.budgetExceededWithLimit", {
                      limit: formatCostAmount(preflightEstimate.costEstimate.budgetLimitUsd, costCurrency),
                    })
                  : t("eval.preflight.budgetExceeded")}
              </p>
            )}

            <div className="eval-preflight-steps">
              <span className="eval-history-item-label">{t("eval.preflight.steps")}</span>
              <ul>
                {preflightEstimate.steps.map((step) => (
                  <li key={step.key}>
                    <strong>{resolvePreflightStepLabel(step.key)}</strong>
                    <span>
                      {t("eval.preflight.stepMeta", {
                        cases: step.caseCount,
                        runs: step.runs,
                        calls: step.llmCalls,
                        tokens: formatInteger(step.estimatedTotalTokens),
                        seconds: step.estimatedSeconds,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>
    );
  }

  function renderModuleSelector() {
    const selectedCount = selectedModulesForRun.length;
    return (
      <section className="eval-module-selector">
        <div className="eval-module-selector-head">
          <h4 className="chart-title">{t("eval.modules.title")}</h4>
          <span className="eval-path-hint">
            {evalMode === "quick"
              ? t("eval.modules.quickHint")
              : t("eval.modules.selectedCount", {
                  selected: selectedCount,
                  total: EVAL_MODULE_OPTIONS.length,
                })}
          </span>
        </div>
        <div className="eval-module-selector-grid">
          {EVAL_MODULE_OPTIONS.map((option) => {
            const checked = selectedModules.includes(option.key);
            const disabled = evalMode === "quick";
            return (
              <label key={option.key} className={`eval-module-option ${disabled ? "is-disabled" : ""}`}>
                <input
                  type="checkbox"
                  checked={disabled ? false : checked}
                  disabled={disabled}
                  onChange={() => handleToggleModule(option.key)}
                />
                <span>{t(option.labelKey as Parameters<typeof t>[0])}</span>
                {option.needsFunctional && <em>{t("eval.modules.needsFunctional")}</em>}
              </label>
            );
          })}
        </div>
      </section>
    );
  }

  function renderGateAndQuickChecks() {
    if (!report) return null;
    const quickChecks = report.quickChecks;
    const gate = report.gate;
    if (!quickChecks && !gate) return null;
    return (
      <article className="chart-card eval-gate-card">
        <h3 className="chart-title">{t("eval.gate.title")}</h3>
        {gate && (
          <div className="eval-gate-grid">
            <div>
              <span className="eval-history-item-label">{t("eval.gate.quickBlockingPass")}</span>
              <strong>{gate.quickBlockingPass ? t("eval.result.pass") : t("eval.result.fail")}</strong>
            </div>
            <div>
              <span className="eval-history-item-label">{t("eval.gate.fullReleasePass")}</span>
              <strong>
                {typeof gate.fullReleasePass === "boolean"
                  ? gate.fullReleasePass
                    ? t("eval.result.pass")
                    : t("eval.result.fail")
                  : naLabel}
              </strong>
            </div>
            <div>
              <span className="eval-history-item-label">{t("eval.gate.partialRelease")}</span>
              <strong>
                {typeof gate.partialRelease === "boolean"
                  ? gate.partialRelease
                    ? t("eval.option.yes")
                    : t("eval.option.no")
                  : naLabel}
              </strong>
            </div>
            <div>
              <span className="eval-history-item-label">{t("eval.gate.failedModules")}</span>
              <strong>{gate.failedModules.length > 0 ? gate.failedModules.join(", ") : naLabel}</strong>
            </div>
          </div>
        )}
        {quickChecks && (
          <div className="eval-quick-check-list">
            <span className="eval-history-item-label">{t("eval.gate.quickChecksStage0")}</span>
            <ul>
              {quickChecks.checks.map((item) => (
                <li key={item.key} className={item.passed ? "eval-quick-pass" : "eval-quick-fail"}>
                  <strong>{item.key}</strong>
                  <span>{item.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </article>
    );
  }

  function renderModuleResultsPanel() {
    const moduleResults = report?.moduleResults;
    if (!moduleResults || moduleResults.length === 0) return null;
    const resolveModuleTitle = (moduleKey: string, fallback: string): string => {
      const option = EVAL_MODULE_OPTIONS.find((item) => item.key === moduleKey);
      if (!option) return fallback;
      return t(option.labelKey as Parameters<typeof t>[0]);
    };
    return (
      <article className="chart-card eval-module-result-card">
        <h3 className="chart-title">{t("eval.modules.resultsTitle")}</h3>
        <div className="eval-module-results">
          {moduleResults.map((item) => (
            <div key={item.key} className={`eval-module-result eval-module-${item.status}`}>
              <span className="eval-history-item-label">
                {resolveModuleTitle(item.key, item.title)}
              </span>
              <strong>{resolveResultLabel(item.status)}</strong>
              {typeof item.score === "number" && (
                <span>
                  {t("eval.modules.score")}: {Math.round(item.score * 100)}%
                </span>
              )}
              {item.message && <small>{item.message}</small>}
            </div>
          ))}
        </div>
      </article>
    );
  }

  function renderEconomicsPanel() {
    const economics = report?.economics;
    if (!economics) return null;
    return (
      <article className="chart-card eval-economics-card">
        <h3 className="chart-title">{t("eval.economics.title")}</h3>
        <div className="eval-economics-grid">
          <div>
            <span className="eval-history-item-label">{t("eval.economics.grossTimeSavedMs")}</span>
            <strong>{Math.round(economics.grossTimeSavedMs)}</strong>
          </div>
          <div>
            <span className="eval-history-item-label">{t("eval.economics.grossTokenSaved")}</span>
            <strong>{Math.round(economics.grossTokenSaved)}</strong>
          </div>
          <div>
            <span className="eval-history-item-label">{t("eval.economics.negativeTimeWasteMs")}</span>
            <strong>{Math.round(economics.negativeTimeWasteMs)}</strong>
          </div>
          <div>
            <span className="eval-history-item-label">{t("eval.economics.negativeTokenWaste")}</span>
            <strong>{Math.round(economics.negativeTokenWaste)}</strong>
          </div>
          <div>
            <span className="eval-history-item-label">{t("eval.economics.netTimeSavedMs")}</span>
            <strong>{Math.round(economics.netTimeSavedMs)}</strong>
          </div>
          <div>
            <span className="eval-history-item-label">{t("eval.economics.netTokenSaved")}</span>
            <strong>{Math.round(economics.netTokenSaved)}</strong>
          </div>
          <div>
            <span className="eval-history-item-label">{t("eval.economics.netUsd")}</span>
            <strong>{typeof economics.netUsd === "number" ? economics.netUsd.toFixed(4) : naLabel}</strong>
          </div>
          <div>
            <span className="eval-history-item-label">{t("eval.economics.pairs")}</span>
            <strong>{`${economics.evaluatedPairs}/${economics.baselineSamples}`}</strong>
          </div>
        </div>
      </article>
    );
  }

  function renderEvidenceOverview() {
    if (!report) return null;
    const advisory = report.advisory;
    const level = advisory?.level ?? "warn";
    const evidenceSummary = report.evidenceSummary;
    const samplePath =
      report.triggerClean.results?.find((item) => item.rawResponsePath)?.rawResponsePath ??
      report.functional.results?.find((item) => item.rawResponsePath)?.rawResponsePath ??
      null;

    const advisoryClass =
      level === "high_risk"
        ? "eval-advisory-high-risk"
        : level === "warn"
          ? "eval-advisory-warn"
          : "eval-advisory-pass";

    return (
      <article className="chart-card eval-advisory-card">
        <div className="eval-advisory-head">
          <h3 className="chart-title">{t("eval.advisory.title")}</h3>
          <span className={`eval-advisory-pill ${advisoryClass}`}>
            {level === "high_risk"
              ? t("eval.advisory.level.highRisk")
              : level === "warn"
                ? t("eval.advisory.level.warn")
                : t("eval.advisory.level.pass")}
          </span>
        </div>
        <p className="eval-advisory-note">{t("eval.notice.nonBlocking")}</p>
        <div className="eval-advisory-grid">
          <div>
            <span className="eval-history-item-label">{t("eval.advisory.evidenceLevel")}</span>
            <strong>
              {report.evidenceLevel === "real"
                ? t("eval.advisory.evidenceLevel.real")
                : t("eval.advisory.evidenceLevel.simulated")}
            </strong>
          </div>
          <div>
            <span className="eval-history-item-label">{t("eval.advisory.totalRuns")}</span>
            <strong>{evidenceSummary?.totalRuns ?? 0}</strong>
          </div>
          <div>
            <span className="eval-history-item-label">{t("eval.advisory.captured")}</span>
            <strong>
              {`${evidenceSummary?.capturedTranscripts ?? 0}/${evidenceSummary?.capturedTiming ?? 0}/${evidenceSummary?.capturedTokens ?? 0}`}
            </strong>
          </div>
          <div>
            <span className="eval-history-item-label">{t("eval.advisory.samplePath")}</span>
            <strong title={samplePath ?? undefined}>{samplePath ? compactPath(samplePath) : "--"}</strong>
          </div>
        </div>
        <ul className="eval-advisory-reasons">
          {(advisory?.reasons ?? [t("eval.advisory.reason.missing")]).map((reason, index) => (
            <li key={`advisory-reason-${index}`}>{reason}</li>
          ))}
        </ul>
      </article>
    );
  }

  function renderTriggerChart(triggerReport: EvalPipelineOutput["triggerClean"] | undefined, title: string) {
    const results = triggerReport?.results;
    if (!results || results.length === 0) return null;

    return (
      <article className="chart-card">
        <h3 className="chart-title">{title}</h3>
        <ReactECharts
          className="eval-chart"
          theme={chartThemeName}
          option={{
            tooltip: { trigger: "axis" },
            xAxis: {
              type: "category",
              data: results.map((_, i) => `Q${i + 1}`),
              axisLabel: { rotate: 0 },
            },
            yAxis: { type: "value", max: 1, axisLabel: { formatter: "{value}" } },
            series: [
              {
                name: t("eval.trigger.expected"),
                type: "bar",
                data: results.map((item) => (item.shouldTrigger ? 1 : 0)),
                itemStyle: { color: "var(--chart-2)" },
                barMaxWidth: 20,
              },
              {
                name: t("eval.trigger.actual"),
                type: "bar",
                data: results.map((item) => (item.triggered ? 1 : 0)),
                itemStyle: { color: "var(--chart-1)" },
                barMaxWidth: 20,
              },
            ],
            legend: { data: [t("eval.trigger.expected"), t("eval.trigger.actual")] },
            grid: { left: 50, right: 20, top: 40, bottom: 30 },
          }}
        />
        <div className="eval-results-table-wrap">
          <table className="eval-results-table">
            <thead>
              <tr>
                <th>{t("eval.table.query")}</th>
                <th>{t("eval.table.expected")}</th>
                <th>{t("eval.table.actual")}</th>
                <th>{t("eval.table.capturedBy")}</th>
                <th>{t("eval.table.evidence")}</th>
                <th>{t("eval.table.result")}</th>
              </tr>
            </thead>
            <tbody>
              {results.map((item, index) => (
                <tr key={`${item.query}-${index}`} className={item.pass ? "" : "eval-row-fail"}>
                  <td className="eval-query-cell">{item.query}</td>
                  <td>{item.shouldTrigger ? t("eval.option.yes") : t("eval.option.no")}</td>
                  <td>{item.triggered ? t("eval.option.yes") : t("eval.option.no")}</td>
                  <td>{item.triggeredSkillName ?? naLabel}</td>
                  <td className="eval-evidence-cell">
                    <span>
                      {(typeof item.latencyMs === "number" ? `${item.latencyMs}ms` : naLabel)} /{" "}
                      {formatTokenPair(item.inputTokens, item.outputTokens)} {t("eval.table.tokenPairSuffix")}
                    </span>
                    <small title={item.rawResponsePath ?? undefined}>
                      {item.rawResponsePath ? compactPath(item.rawResponsePath) : naLabel}
                    </small>
                  </td>
                  <td>
                    <span className={`eval-badge ${item.pass ? "eval-badge-pass" : "eval-badge-fail"}`}>
                      {item.pass ? t("eval.result.pass") : t("eval.result.fail")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    );
  }

  function renderFunctionalChart() {
    if (report?.mode === "quick") return null;
    const results = report?.functional?.results;
    if (!results || results.length === 0) return null;

    return (
      <article className="chart-card">
        <h3 className="chart-title">{t("eval.functional.title")}</h3>
        <ReactECharts
          className="eval-chart"
          theme={chartThemeName}
          option={{
            tooltip: { trigger: "axis" },
            xAxis: { type: "category", data: results.map((item) => item.caseId) },
            yAxis: {
              type: "value",
              max: 1,
              axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%` },
            },
            series: [
              {
                name: t("eval.functional.passRate"),
                type: "bar",
                data: results.map((item) => item.passRate),
                itemStyle: {
                  color: (params: { dataIndex: number }) =>
                    results[params.dataIndex].passed ? "var(--success)" : "var(--danger)",
                },
                barMaxWidth: 32,
              },
            ],
            grid: { left: 60, right: 20, top: 30, bottom: 30 },
          }}
        />
        <div className="eval-results-table-wrap">
          <table className="eval-results-table">
            <thead>
              <tr>
                <th>{t("eval.table.caseId")}</th>
                <th>{t("eval.table.passRate")}</th>
                <th>{t("eval.table.qualityScore")}</th>
                <th>{t("eval.table.judgeRationale")}</th>
                <th>{t("eval.table.judgeSuggestions")}</th>
                <th>{t("eval.table.evidence")}</th>
                <th>{t("eval.table.result")}</th>
              </tr>
            </thead>
            <tbody>
              {results.map((item) => (
                <tr key={item.caseId} className={item.passed ? "" : "eval-row-fail"}>
                  <td>{item.caseId}</td>
                  <td>{Math.round(item.passRate * 100)}%</td>
                  <td>{typeof item.qualityScore === "number" ? `${Math.round(item.qualityScore * 100)}%` : naLabel}</td>
                  <td className="eval-query-cell">{item.judgeRationale || naLabel}</td>
                  <td className="eval-query-cell">
                    {item.judgeSuggestions && item.judgeSuggestions.length > 0
                      ? item.judgeSuggestions.join("; ")
                      : naLabel}
                  </td>
                  <td className="eval-evidence-cell">
                    <span>
                      {(typeof item.latencyMs === "number" ? `${item.latencyMs}ms` : naLabel)} /{" "}
                      {formatTokenPair(item.inputTokens, item.outputTokens)} {t("eval.table.tokenPairSuffix")}
                    </span>
                    <small title={item.rawResponsePath ?? undefined}>
                      {item.rawResponsePath ? compactPath(item.rawResponsePath) : naLabel}
                    </small>
                  </td>
                  <td>
                    <span className={`eval-badge ${item.passed ? "eval-badge-pass" : "eval-badge-fail"}`}>
                      {item.passed ? t("eval.result.pass") : t("eval.result.fail")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    );
  }

  const elapsedSeconds = Math.floor(progressElapsedMs / 1000);
  const parsedRepeats = Number.parseInt(repeatsInput, 10);
  const configuredRepeats = Number.isFinite(parsedRepeats) && parsedRepeats > 0 ? parsedRepeats : 1;
  const totalSteps = Math.max(progressEvent?.totalSteps ?? 1, 1);
  const currentStep = Math.min(progressEvent?.stepIndex ?? 0, totalSteps);
  const progressPercent = running ? Math.round((currentStep / totalSteps) * 100) : report ? 100 : 0;
  const progressStepLabel = (stepName: string) => {
    const messageKey = EVAL_PROGRESS_STEP_KEYS[stepName];
    if (!messageKey) {
      return t("eval.progress.step.unknown", { step: stepName });
    }
    return t(messageKey);
  };
  const progressMessage = progressEvent
    ? (() => {
        if (progressEvent.messageKey?.trim()) {
          return t(
            progressEvent.messageKey as MessageKey,
            progressEvent.messageArgs as Record<string, string | number>,
          );
        }
        if (progressEvent.stepName === "repeat_complete") {
          return t("eval.progress.repeatCompleted", {
            current: progressEvent.currentRepeat,
            total: Math.max(progressEvent.totalRepeats, 1),
          });
        }
        if (progressEvent.status === "paused") {
          return t("eval.progress.paused");
        }
        if (progressEvent.status === "cancelled") {
          return t("eval.progress.cancelled");
        }
        if (progressEvent.status === "completed") {
          return t("eval.progress.pipelineCompleted");
        }
        if (progressEvent.status === "running" && progressEvent.stepName === "pipeline" && progressEvent.stepIndex <= 0) {
          return t("eval.progress.pipelineStarted");
        }
        if (progressEvent.status === "running") {
          return t("eval.progress.step.running", {
            current: progressEvent.currentRepeat,
            total: Math.max(progressEvent.totalRepeats, 1),
            step: progressStepLabel(progressEvent.stepName),
          });
        }
        if (progressEvent.status === "error") {
          return t("eval.progress.failed", {
            reason: progressEvent.message?.trim() || t("eval.common.na"),
          });
        }
        return progressEvent.message || t("eval.running");
      })()
    : running || generating
      ? status || (running ? t("eval.running") : t("eval.samples.generating"))
      : "";
  const progressDetail = progressEvent
    ? t("eval.progress.detail", {
        message: progressMessage,
        current: progressEvent.stepIndex,
        total: Math.max(progressEvent.totalSteps, 1),
        seconds: elapsedSeconds,
      })
    : progressMessage;
  const hasSelectedSkill = selectedSkill.trim().length > 0;
  const hasModel = model.trim().length > 0;
  const hasTriggerDataset = triggerSetPath.trim().length > 0;
  const hasFunctionalDataset = !requiresFunctionalByModules || functionalSetPath.trim().length > 0;
  const repeatsValid = Number.isFinite(parsedRepeats) && parsedRepeats >= 1;
  const budgetValue = maxCostUsdInput.trim() ? Number(maxCostUsdInput.trim()) : undefined;
  const budgetValid =
    budgetValue === undefined || (Number.isFinite(budgetValue) && budgetValue > 0);
  const setupReady = hasSelectedSkill && hasModel && repeatsValid && budgetValid;
  const datasetReady = hasTriggerDataset && hasFunctionalDataset;
  const readyToRun = setupReady && datasetReady;
  const autoStep: 1 | 2 | 3 = !setupReady ? 1 : !datasetReady ? 2 : 3;
  const activeStep: 1 | 2 | 3 =
    stepOverride === null
      ? autoStep
      : stepOverride === 3 && !datasetReady
        ? 2
        : stepOverride >= 2 && !setupReady
          ? 1
          : stepOverride;
  const runBlockedReason = !hasSelectedSkill
    ? t("eval.error.selectSkill")
    : !hasModel
      ? t("eval.error.modelRequired")
      : !repeatsValid
        ? t("eval.error.repeatsInvalid")
        : !budgetValid
          ? t("eval.error.maxCostInvalid")
          : !hasTriggerDataset
            ? t("eval.error.datasetRequired", { type: t("eval.dataset.trigger") })
            : !hasFunctionalDataset
            ? t("eval.error.datasetRequired", { type: t("eval.dataset.functional") })
              : "";
  const flowNextMessage = readyToRun
    ? t("eval.flow.ready")
    : t("eval.flow.next", { reason: runBlockedReason });
  const runPrimaryLabel = running ? t("eval.running") : t("eval.run");
  const naLabel = t("eval.common.na");

  useEffect(() => {
    if (stepOverride === null) return;
    if (stepOverride >= 2 && !setupReady) {
      setStepOverride(null);
      return;
    }
    if (stepOverride === 3 && !datasetReady) {
      setStepOverride(null);
    }
  }, [stepOverride, setupReady, datasetReady]);

  useEffect(() => {
    const headerEl = pageHeaderRef.current;
    const dockEl = runDockRef.current;
    const statusBarEl = document.querySelector<HTMLElement>(".app-status-bar");
    if (!headerEl || !dockEl) return;

    const updateOffsets = () => {
      const statusBarHeight = Math.ceil(statusBarEl?.getBoundingClientRect().height ?? 0);
      const nextHeaderTop = Math.max(0, statusBarHeight + 8);
      const nextHeaderOffset = Math.max(
        80,
        nextHeaderTop + Math.ceil(headerEl.getBoundingClientRect().height) + 8,
      );
      const nextDockOffset = Math.max(220, Math.ceil(dockEl.getBoundingClientRect().height) + 24);
      setHeaderTopPx((current) => (current === nextHeaderTop ? current : nextHeaderTop));
      setHeaderOffsetPx((current) => (current === nextHeaderOffset ? current : nextHeaderOffset));
      setRunDockOffsetPx((current) => (current === nextDockOffset ? current : nextDockOffset));
    };

    updateOffsets();
    window.addEventListener("resize", updateOffsets);
    if (typeof ResizeObserver === "undefined") {
      return () => {
        window.removeEventListener("resize", updateOffsets);
      };
    }

    const observer = new ResizeObserver(updateOffsets);
    observer.observe(headerEl);
    observer.observe(dockEl);
    if (statusBarEl) {
      observer.observe(statusBarEl);
    }
    return () => {
      window.removeEventListener("resize", updateOffsets);
      observer.disconnect();
    };
  }, [activeStep, progressDetail, running, showAdvancedSettings, status, t]);

  function jumpToStep(step: 1 | 2 | 3) {
    if (step === 1) {
      setStepOverride(1);
      return;
    }
    if (step === 2) {
      if (!setupReady) return;
      setStepOverride(2);
      return;
    }
    if (!setupReady || !datasetReady) return;
    setStepOverride(3);
  }

  function handleSelectSkill(nextSkill: string) {
    if (nextSkill !== selectedSkill) {
      setTriggerSetPath("");
      setFunctionalSetPath("");
      setTriggerDraftRows([]);
      setFunctionalDraftRows([]);
      setShowSamples(false);
      setShowHistory(false);
      setPreflightEstimate(null);
      setPreflightEstimateError("");
    }
    setSelectedSkill(nextSkill);
    if (!nextSkill.trim()) {
      setStepOverride(1);
      return;
    }
    if (hasModel && repeatsValid && budgetValid) {
      setStepOverride(2);
      return;
    }
    setStepOverride(1);
  }

  function resolveResultLabel(status: string): string {
    switch (status.trim().toLowerCase()) {
      case "pass":
        return t("eval.result.pass");
      case "fail":
        return t("eval.result.fail");
      case "skipped":
        return t("eval.result.skipped");
      default:
        return status.toUpperCase();
    }
  }

  const pageStyle = useMemo<CSSProperties>(
    () =>
      ({
        "--eval-header-top": `${headerTopPx}px`,
        "--eval-header-offset": `${headerOffsetPx}px`,
        "--eval-run-dock-offset": `${runDockOffsetPx}px`,
      }) as CSSProperties,
    [headerOffsetPx, headerTopPx, runDockOffsetPx],
  );

  return (
    <div className="page animate-fadein eval-page" ref={pageRef} style={pageStyle}>
      <header className="page-header eval-page-header" ref={pageHeaderRef}>
        <div className="eval-page-header-main">
          <h1 className="page-title eval-page-title">
            <span>{t("eval.title")}</span>
            <span className="eval-beta-badge">{t("eval.beta")}</span>
          </h1>
          <p className="eval-page-header-hint">{flowNextMessage}</p>
        </div>
        <button
          className="btn btn-primary eval-page-run-btn"
          onClick={() => void handleRunEval()}
          disabled={running || generating || !readyToRun}
          title={!readyToRun ? runBlockedReason : undefined}
        >
          {runPrimaryLabel}
        </button>
      </header>

      <article className="chart-card eval-config-card">
        <h3 className="chart-title">{t("eval.config.title")}</h3>
        <p className="eval-advisory-note">{t("eval.notice.nonBlocking")}</p>
        <div className="eval-flow-sticky">
          <section className="eval-flow-guide" aria-label={t("eval.flow.aria")}>
            <div className={`eval-flow-step ${activeStep === 1 ? "is-active" : setupReady ? "is-done" : ""}`}>
              <span className="eval-flow-index">1</span>
              <div>
                <strong>{t("eval.flow.step1.title")}</strong>
                <small>{t("eval.flow.step1.desc")}</small>
              </div>
            </div>
            <div className={`eval-flow-step ${activeStep === 2 ? "is-active" : datasetReady ? "is-done" : ""}`}>
              <span className="eval-flow-index">2</span>
              <div>
                <strong>{t("eval.flow.step2.title")}</strong>
                <small>{t("eval.flow.step2.desc")}</small>
              </div>
            </div>
            <div className={`eval-flow-step ${activeStep === 3 ? "is-active" : report ? "is-done" : ""}`}>
              <span className="eval-flow-index">3</span>
              <div>
                <strong>{t("eval.flow.step3.title")}</strong>
                <small>{t("eval.flow.step3.desc")}</small>
              </div>
            </div>
          </section>
          <div className="eval-flow-jump">
            {activeStep > 1 && (
              <button className="btn btn-ghost eval-action-btn" onClick={() => jumpToStep(1)}>
                {t("eval.flow.edit.step1")}
              </button>
            )}
            {activeStep === 1 && setupReady && (
              <button className="btn btn-ghost eval-action-btn" onClick={() => jumpToStep(2)}>
                {t("eval.flow.continue.step2")}
              </button>
            )}
            {activeStep === 2 && datasetReady && (
              <button className="btn btn-ghost eval-action-btn" onClick={() => jumpToStep(3)}>
                {t("eval.flow.continue.step3")}
              </button>
            )}
            {activeStep === 3 && (
              <button className="btn btn-ghost eval-action-btn" onClick={() => jumpToStep(2)}>
                {t("eval.flow.edit.step2")}
              </button>
            )}
          </div>
        </div>
        <div className="eval-config-grid">
          {activeStep === 1 && (
            <>
              <p className="eval-config-group-title">{t("eval.flow.group.step1")}</p>
              <div className="field">
                <label className="field-label">{t("eval.config.skill")}</label>
                <select
                  className="filter-select"
                  value={selectedSkill}
                  onChange={(e) => handleSelectSkill(e.target.value)}
                >
                  <option value="">{t("eval.config.selectSkill")}</option>
                  {skills.map((skill) => (
                    <option key={skill.name} value={skill.name}>
                      {skill.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="field-label">{t("eval.config.mode")}</label>
                <select
                  className="filter-select"
                  value={evalMode}
                  onChange={(e) => setEvalMode(e.target.value as EvalMode)}
                >
                  <option value="quick">{t("eval.config.mode.quick")}</option>
                  <option value="full">{t("eval.config.mode.full")}</option>
                </select>
              </div>

              <div className="field">
                <label className="field-label">{t("eval.config.model")}</label>
                <input
                  className="field-input"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={t("eval.config.model.placeholder")}
                />
              </div>

              <div className="eval-advanced-toggle-wrap">
                <button
                  className="btn btn-ghost eval-action-btn"
                  onClick={() => setShowAdvancedSettings((prev) => !prev)}
                  aria-expanded={showAdvancedSettings}
                >
                  {showAdvancedSettings ? t("eval.advanced.hide") : t("eval.advanced.show")}
                </button>
                <p className="eval-path-hint">{t("eval.advanced.hint")}</p>
              </div>

              {showAdvancedSettings && (
                <>
                  <div className="field">
                    <label className="field-label">{t("eval.config.modelPreset")}</label>
                    <select
                      className="filter-select"
                      value={MODEL_PRESETS.includes(model) ? model : ""}
                      onChange={(e) => {
                        if (e.target.value) {
                          setModel(e.target.value);
                        }
                      }}
                    >
                      <option value="">{t("eval.config.modelPreset.custom")}</option>
                      {MODEL_PRESETS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label className="field-label">{t("eval.config.repeats")}</label>
                    <input
                      className="field-input"
                      type="number"
                      min={1}
                      step={1}
                      value={repeatsInput}
                      onChange={(e) => setRepeatsInput(e.target.value)}
                    />
                  </div>

                  <div className="field">
                    <label className="field-label">{t("eval.config.maxCost", { currency: costCurrency })}</label>
                    <input
                      className="field-input"
                      type="number"
                      min={0}
                      step="0.01"
                      value={maxCostUsdInput}
                      onChange={(e) => setMaxCostUsdInput(e.target.value)}
                      placeholder={t("eval.config.maxCost.placeholder", { currency: costCurrency })}
                    />
                  </div>

                  {renderModuleSelector()}
                </>
              )}
            </>
          )}

          {activeStep === 2 && (
            <>
              <p className="eval-config-group-title">{t("eval.flow.group.step2")}</p>

              <div className="field eval-field-wide">
                <label className="field-label">{t("eval.dataset.trigger")}</label>
                <div className="eval-path-row">
                  <input
                    className="field-input"
                    value={triggerSetPath}
                    onChange={(e) => setTriggerSetPath(e.target.value)}
                    placeholder="...trigger-eval.json"
                  />
                  <button className="btn btn-ghost" onClick={() => void pickEvalSet("trigger")}>
                    {t("eval.dataset.pick")}
                  </button>
                </div>
                <p className="eval-path-hint">
                  {t("eval.dataset.defaultPath", { path: storagePaths?.datasetDir ?? "--" })}
                </p>
              </div>

              <div className="field eval-field-wide">
                <label className="field-label">{t("eval.dataset.functional")}</label>
                <div className="eval-path-row">
                  <input
                    className="field-input"
                    value={functionalSetPath}
                    onChange={(e) => setFunctionalSetPath(e.target.value)}
                    placeholder="...functional-eval.json"
                    disabled={!requiresFunctionalByModules}
                  />
                  <button
                    className="btn btn-ghost"
                    onClick={() => void pickEvalSet("functional")}
                    disabled={!requiresFunctionalByModules}
                  >
                    {t("eval.dataset.pick")}
                  </button>
                </div>
                <p className="eval-path-hint">
                  {t("eval.history.path", { path: storagePaths?.historyDir ?? "--" })}
                </p>
              </div>

              <div className="eval-dataset-actions">
                <button
                  className="btn btn-ghost eval-action-btn"
                  onClick={() => void handleGenerateSamples()}
                  disabled={running || generating || !hasSelectedSkill || !hasModel}
                >
                  {t("eval.samples.generate", {
                    trigger: DEFAULT_TRIGGER_SAMPLE_COUNT,
                    functional: FUNCTIONAL_MIN_SAMPLES,
                  })}
                </button>
                <button
                  className="btn btn-ghost eval-action-btn"
                  onClick={() => {
                    const next = !showSamples;
                    setShowSamples(next);
                    if (next) {
                      setShowHistory(false);
                    }
                  }}
                  disabled={triggerDraftRows.length === 0 && functionalDraftRows.length === 0}
                >
                  {showSamples ? t("eval.samples.hide") : t("eval.samples.view")} ({triggerDraftCount}/
                  {functionalDraftCount})
                </button>
              </div>
            </>
          )}

          {activeStep === 3 && (
            <>
              <p className="eval-config-group-title">{t("eval.flow.group.step3")}</p>
              {renderPreflightEstimate()}
              <div className="eval-config-actions">
                <span className="eval-action-group-label">{t("eval.flow.actions.secondary")}</span>
                <div className="eval-action-row">
                  <button
                    className="btn btn-ghost eval-action-btn"
                    onClick={() => {
                      const next = !showHistory;
                      setShowHistory(next);
                      if (next && selectedSkill) {
                        setShowSamples(false);
                        void refreshHistory(selectedSkill);
                      }
                    }}
                    disabled={!selectedSkill}
                  >
                    {t("eval.history.view")} ({historyEntries.length})
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </article>

      <article className="eval-run-dock" ref={runDockRef}>
        <div className="eval-run-dock-head">
          <h3 className="chart-title">{t("eval.runDock.title")}</h3>
          <div className="eval-run-dock-actions">
            {running ? (
              <>
                <button
                  className="btn btn-ghost"
                  onClick={() => void handleEvalControl(pauseRequested ? "resume" : "pause")}
                  disabled={controlBusy || !activeRunId}
                >
                  {pauseRequested ? t("eval.control.resume") : t("eval.control.pause")}
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => void handleEvalControl("cancel")}
                  disabled={controlBusy || !activeRunId}
                >
                  {t("eval.control.stop")}
                </button>
              </>
            ) : (
              <span className="eval-run-dock-idle">{t("eval.runDock.idle")}</span>
            )}
          </div>
        </div>
        <p className="eval-run-dock-status">{progressDetail || status || t("eval.empty")}</p>
        <div className="eval-run-dock-meta">
          <span>
            {t("eval.runDock.rounds", {
              current: progressEvent?.currentRepeat ?? (running ? 1 : 0),
              total: progressEvent?.totalRepeats ?? configuredRepeats,
            })}
          </span>
          <span>
            {t("eval.runDock.steps", {
              current: progressEvent?.stepIndex ?? 0,
              total: progressEvent?.totalSteps ?? 0,
            })}
          </span>
          <span>{t("eval.runDock.elapsed", { seconds: elapsedSeconds })}</span>
        </div>
        <div
          className="eval-run-dock-progress"
          role="progressbar"
          aria-label={t("eval.runDock.progressAria")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPercent}
          aria-valuetext={t("eval.runDock.steps", {
            current: progressEvent?.stepIndex ?? 0,
            total: progressEvent?.totalSteps ?? 0,
          })}
        >
          <span style={{ width: `${progressPercent}%` }} />
        </div>
      </article>

      {showSamples && (triggerDraftRows.length > 0 || functionalDraftRows.length > 0) && (
        <div
          className="eval-samples-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t("eval.samples.title")}
          onClick={() => setShowSamples(false)}
        >
          <article className="eval-samples-modal" onClick={(event) => event.stopPropagation()}>
            <div className="eval-samples-modal-head">
              <h3 className="chart-title">{t("eval.samples.title")}</h3>
              <div className="eval-samples-modal-actions">
                <button className="btn btn-ghost" onClick={() => setShowSamples(false)}>
                  {t("eval.history.close")}
                </button>
              </div>
            </div>
            <div className="eval-samples-modal-body">
              <div className="eval-draft-grid">
                <div className="field">
                  <label className="field-label">
                    {t("eval.samples.triggerForm")} ({triggerDraftCount})
                  </label>
                  <div className="eval-draft-actions">
                    <button
                      className="btn btn-ghost"
                      onClick={() =>
                        setTriggerDraftRows((prev) => [
                          ...prev,
                          {
                            query: "",
                            shouldTrigger: true,
                            testBucket: "positive_trigger",
                          },
                        ])
                      }
                    >
                      {t("eval.samples.addRow")}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => void handleSaveDraft("trigger", "default")}
                      disabled={savingDraft !== null}
                    >
                      {savingDraft === "trigger"
                        ? t("eval.samples.saving")
                        : t("eval.samples.saveTriggerDefault")}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => void handleSaveDraft("trigger", "choose")}
                      disabled={savingDraft !== null}
                    >
                      {savingDraft === "trigger" ? t("eval.samples.saving") : t("eval.samples.saveTrigger")}
                    </button>
                  </div>
                  <div className="eval-draft-table-wrap">
                    <table className="eval-draft-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>{t("eval.table.query")}</th>
                          <th>{t("eval.table.expected")}</th>
                          <th>{t("eval.table.bucket")}</th>
                          <th>{t("eval.samples.actions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {triggerDraftRows.map((row, index) => (
                          <tr key={`trigger-draft-${index}`}>
                            <td>{index + 1}</td>
                            <td>
                              <input
                                className="field-input"
                                value={row.query}
                                onChange={(event) => {
                                  const query = event.target.value;
                                  setTriggerDraftRows((prev) =>
                                    prev.map((item, itemIndex) =>
                                      itemIndex === index ? { ...item, query } : item,
                                    ),
                                  );
                                }}
                              />
                            </td>
                            <td>
                              <select
                                className="filter-select"
                                value={row.shouldTrigger ? "true" : "false"}
                                onChange={(event) => {
                                  const shouldTrigger = event.target.value === "true";
                                  setTriggerDraftRows((prev) =>
                                    prev.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? {
                                            ...item,
                                            shouldTrigger,
                                            testBucket:
                                              item.testBucket === "positive_trigger" ||
                                              item.testBucket === "negative_trigger"
                                                ? defaultBucketForShouldTrigger(shouldTrigger)
                                                : item.testBucket,
                                          }
                                        : item,
                                    ),
                                  );
                                }}
                              >
                                <option value="true">{t("eval.option.yes")}</option>
                                <option value="false">{t("eval.option.no")}</option>
                              </select>
                            </td>
                            <td>
                              <select
                                className="filter-select"
                                value={row.testBucket}
                                onChange={(event) => {
                                  const testBucket = event.target.value as TriggerBucketKey;
                                  setTriggerDraftRows((prev) =>
                                    prev.map((item, itemIndex) =>
                                      itemIndex === index ? { ...item, testBucket } : item,
                                    ),
                                  );
                                }}
                              >
                                {TRIGGER_BUCKET_OPTIONS.map((option) => (
                                  <option key={option.key} value={option.key}>
                                    {t(option.labelKey as Parameters<typeof t>[0])}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <button
                                className="btn btn-danger eval-draft-inline-btn"
                                onClick={() =>
                                  setTriggerDraftRows((prev) =>
                                    prev.filter((_, itemIndex) => itemIndex !== index),
                                  )
                                }
                              >
                                {t("eval.samples.removeRow")}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="field">
                  <label className="field-label">
                    {t("eval.samples.functionalForm")} ({functionalDraftCount})
                  </label>
                  <div className="eval-draft-actions">
                    <button
                      className="btn btn-ghost"
                      onClick={() =>
                        setFunctionalDraftRows((prev) => [
                          ...prev,
                          { id: "", prompt: "", assertionsText: "" },
                        ])
                      }
                    >
                      {t("eval.samples.addRow")}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => void handleSaveDraft("functional", "default")}
                      disabled={savingDraft !== null}
                    >
                      {savingDraft === "functional"
                        ? t("eval.samples.saving")
                        : t("eval.samples.saveFunctionalDefault")}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => void handleSaveDraft("functional", "choose")}
                      disabled={savingDraft !== null}
                    >
                      {savingDraft === "functional"
                        ? t("eval.samples.saving")
                        : t("eval.samples.saveFunctional")}
                    </button>
                  </div>
                  <div className="eval-functional-draft-list">
                    {functionalDraftRows.map((row, index) => (
                      <div className="eval-functional-draft-item" key={`functional-draft-${index}`}>
                        <div className="eval-functional-draft-head">
                          <span>#{index + 1}</span>
                          <button
                            className="btn btn-danger eval-draft-inline-btn"
                            onClick={() =>
                              setFunctionalDraftRows((prev) =>
                                prev.filter((_, itemIndex) => itemIndex !== index),
                              )
                            }
                          >
                            {t("eval.samples.removeRow")}
                          </button>
                        </div>
                        <label className="field-label">{t("eval.table.caseId")}</label>
                        <input
                          className="field-input"
                          value={row.id}
                          onChange={(event) => {
                            const id = event.target.value;
                            setFunctionalDraftRows((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, id } : item,
                              ),
                            );
                          }}
                        />
                        <label className="field-label">{t("eval.samples.prompt")}</label>
                        <textarea
                          className="eval-draft-textarea"
                          value={row.prompt}
                          onChange={(event) => {
                            const prompt = event.target.value;
                            setFunctionalDraftRows((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, prompt } : item,
                              ),
                            );
                          }}
                        />
                        <label className="field-label">{t("eval.samples.assertions")}</label>
                        <textarea
                          className="eval-draft-textarea"
                          value={row.assertionsText}
                          onChange={(event) => {
                            const assertionsText = event.target.value;
                            setFunctionalDraftRows((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, assertionsText } : item,
                              ),
                            );
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </article>
        </div>
      )}

      {showHistory && selectedSkill && (
        <div
          className="eval-history-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t("eval.history.title", { skill: selectedSkill })}
          onClick={() => setShowHistory(false)}
        >
          <article className="eval-history-modal" onClick={(event) => event.stopPropagation()}>
            <div className="eval-history-modal-head">
              <h3 className="chart-title">{t("eval.history.title", { skill: selectedSkill })}</h3>
              <div className="eval-history-modal-actions">
                <button
                  className="btn btn-ghost"
                  onClick={() => void refreshHistory(selectedSkill)}
                  disabled={historyLoading}
                >
                  {historyLoading ? t("eval.history.loading") : t("eval.history.refresh")}
                </button>
                <button className="btn btn-ghost" onClick={() => setShowHistory(false)}>
                  {t("eval.history.close")}
                </button>
              </div>
            </div>
            <p className="eval-path-hint">
              {t("eval.history.path", { path: storagePaths?.historyDir ?? "--" })}
            </p>

            <div className="eval-history-modal-body">
              {historyEntries.length === 0 ? (
                <p className="eval-path-hint">{t("eval.history.empty")}</p>
              ) : (
                <div className="eval-history-list">
                  {historyEntries.map((item) => {
                    const expanded = expandedHistoryPath === item.path;
                    const detail = historyDetails[item.path];
                    const detailError = historyDetailErrors[item.path];
                    const detailLoading = historyDetailLoadingPath === item.path;
                    return (
                      <section className="eval-history-item" key={item.path}>
                        <div className="eval-history-item-main">
                          <div className="eval-history-item-grid">
                            <div>
                              <span className="eval-history-item-label">{t("eval.history.time")}</span>
                              <strong>{new Date(item.savedAtUnix * 1000).toLocaleString()}</strong>
                            </div>
                            <div>
                              <span className="eval-history-item-label">{t("eval.config.mode")}</span>
                              <strong>{item.mode}</strong>
                            </div>
                            <div>
                              <span className="eval-history-item-label">{t("eval.history.repeats")}</span>
                              <strong>{item.repeats}</strong>
                            </div>
                            <div>
                              <span className="eval-history-item-label">{t("eval.kpi.totalCases")}</span>
                              <strong>{item.totalCases}</strong>
                            </div>
                            <div>
                              <span className="eval-history-item-label">{t("eval.table.passRate")}</span>
                              <strong>{Math.round(item.passRate * 100)}%</strong>
                            </div>
                            <div>
                              <span className="eval-history-item-label">{t("eval.config.model")}</span>
                              <strong>{item.model}</strong>
                            </div>
                          </div>
                          <div className="eval-history-item-actions">
                            <button
                              className="btn btn-ghost"
                              onClick={() => void handleToggleHistoryExpand(item.path)}
                              disabled={detailLoading}
                            >
                              {expanded ? t("eval.history.collapse") : t("eval.history.expand")}
                            </button>
                            <button
                              className="btn btn-ghost"
                              onClick={() => void handleLoadHistory(item.path)}
                              disabled={historyLoading}
                            >
                              {t("eval.history.load")}
                            </button>
                          </div>
                        </div>

                        {expanded && (
                          <div className="eval-history-item-detail">
                            {detailLoading && <p className="eval-path-hint">{t("eval.history.detailLoading")}</p>}
                            {!detailLoading && detailError && (
                              <p className="settings-status">{`${t("eval.history.detailError")}: ${detailError}`}</p>
                            )}
                            {!detailLoading && !detailError && detail && (
                              <div className="eval-history-detail-grid">
                                <div>
                                  <span className="eval-history-item-label">{t("eval.kpi.totalCases")}</span>
                                  <strong>{detail.summary.totalCases}</strong>
                                </div>
                                <div>
                                  <span className="eval-history-item-label">{t("eval.kpi.totalPassed")}</span>
                                  <strong>{detail.summary.totalPassed}</strong>
                                </div>
                                <div>
                                  <span className="eval-history-item-label">{t("eval.table.passRate")}</span>
                                  <strong>{Math.round(detail.summary.passRate * 100)}%</strong>
                                </div>
                                <div>
                                  <span className="eval-history-item-label">{t("eval.kpi.precision")}</span>
                                  <strong>{Math.round(detail.triggerMetrics.precision * 100)}%</strong>
                                </div>
                                <div>
                                  <span className="eval-history-item-label">{t("eval.kpi.recall")}</span>
                                  <strong>{Math.round(detail.triggerMetrics.recall * 100)}%</strong>
                                </div>
                                <div>
                                  <span className="eval-history-item-label">{t("eval.kpi.fpr")}</span>
                                  <strong>{Math.round(detail.triggerMetrics.fpr * 100)}%</strong>
                                </div>
                                <div>
                                  <span className="eval-history-item-label">{t("eval.kpi.costEstimate")}</span>
                                  <strong>
                                    {formatCostRange(
                                      detail.costEstimate.estimatedUsd,
                                      detail.costEstimate.estimatedUsdMin,
                                      detail.costEstimate.estimatedUsdMax,
                                      costCurrency,
                                    )}
                                  </strong>
                                </div>
                                <div>
                                  <span className="eval-history-item-label">{t("eval.advisory.level.label")}</span>
                                  <strong>
                                    {detail.advisory?.level === "high_risk"
                                      ? t("eval.advisory.level.highRisk")
                                      : detail.advisory?.level === "warn"
                                        ? t("eval.advisory.level.warn")
                                        : detail.advisory?.level === "pass"
                                          ? t("eval.advisory.level.pass")
                                          : "--"}
                                  </strong>
                                </div>
                                <div>
                                  <span className="eval-history-item-label">{t("eval.advisory.evidenceLevel")}</span>
                                  <strong>
                                    {detail.evidenceLevel === "real"
                                      ? t("eval.advisory.evidenceLevel.real")
                                      : t("eval.advisory.evidenceLevel.simulated")}
                                  </strong>
                                </div>
                                <div>
                                  <span className="eval-history-item-label">{t("eval.kpi.repeatStats")}</span>
                                  <strong>
                                    {Math.round(detail.repeatStats.overallPassRate.mean * 100)}% +/-{" "}
                                    {Math.round(detail.repeatStats.overallPassRate.stdDev * 100)}%
                                  </strong>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          </article>
        </div>
      )}

      {report && (
        <>
          {renderGateAndQuickChecks()}
          {renderEvidenceOverview()}
          {renderEconomicsPanel()}
          {renderModuleResultsPanel()}
          {renderSummaryKpis()}
          {renderModeKpis()}
          <div className="chart-row">
            {renderTriggerChart(report.triggerClean, t("eval.trigger.titleClean"))}
            {renderFunctionalChart()}
          </div>
          {report.mode === "full" &&
            renderTriggerChart(report.triggerComplex, t("eval.trigger.titleComplex"))}
        </>
      )}

      {!report && !running && !status && <div className="empty-state">{t("eval.empty")}</div>}
    </div>
  );
}



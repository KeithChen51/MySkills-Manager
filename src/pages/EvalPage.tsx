import { open, save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type ReactNode,
} from "react";

import {
  evalGenerateSamples,
  evalGenerateFeedbackDrafts,
  evalReadEvidenceCase,
  evalSubmitReview,
  evalControl,
  evalEstimatePipeline,
  evalGetConfig,
  evalListSampleGenerationHistory,
  evalGetStoragePaths,
  evalListHistory,
  evalLoadHistory,
  evalSaveConfig,
  evalSaveDataset,
  onboardingGetState,
  runEvalPipeline,
  type CostCurrency,
  type EvalHistoryEntry,
  type EvalModuleKey,
  type EvalPipelineEstimate,
  type EvalPipelineOutput,
  type EvalPipelineProgressEvent,
  type EvalSampleGenerationTimingEntry,
  type EvalStoragePaths,
  type ModelGroup,
  type SkillMeta,
} from "../api/tauri";
import DeferredEChart from "../components/DeferredEChart";
import KpiCard from "../components/KpiCard";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import EvalFloatingModal from "./eval/components/EvalFloatingModal";
import { useTheme } from "../theme/ThemeProvider";
import "./EvalPage.css";

type Props = { skills: SkillMeta[] };
type EvalMode = "quick" | "full";
type EvalControlAction = "pause" | "resume" | "cancel";
type EvalDraftKind = "trigger" | "functional";
type EvalFlowStatus = "active" | "done" | "pending";
type HistoryRefreshMode = "replace" | "append";
type HistoryReviewTone = "pass" | "pending" | "warn";
type ResultFilter = "all" | "fail" | "pass";
type TriggerPanelKey = "clean" | "complex";
type EvalConnectionTarget = "sample" | "run";

type ResultPanelState = {
  chartExpanded: boolean;
  tableExpanded: boolean;
  filter: ResultFilter;
  page: number;
  pageSize: 20 | 50 | 100;
};

type ChartErrorBoundaryProps = {
  resetKey: string;
  fallback: ReactNode;
  children: ReactNode;
};

type ChartErrorBoundaryState = {
  hasError: boolean;
};

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

type ModelCatalogItem = {
  model: string;
  groupId: string;
  groupName: string;
};

type EvalView = "setup" | "running" | "review" | "result";

type EvalRunSnapshot = {
  skillName: string;
  mode: EvalMode;
  model: string;
  repeats: number;
  maxParallelArms: number;
  triggerMaxWorkers: number;
  functionalMaxWorkers: number;
  selectedModules: EvalModuleKey[];
  triggerSetPath: string;
  functionalSetPath: string;
};

class EvalChartErrorBoundary extends Component<ChartErrorBoundaryProps, ChartErrorBoundaryState> {
  state: ChartErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ChartErrorBoundaryState {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: ChartErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch() {
    // keep fallback-only behavior
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

const EVAL_PROGRESS_STEP_KEYS: Record<string, MessageKey> = {
  pipeline: "eval.progress.step.pipeline",
  quick_checks: "eval.progress.step.quickChecks",
  trigger_clean: "eval.progress.step.triggerClean",
  trigger_complex: "eval.progress.step.triggerComplex",
  functional_with_skill: "eval.progress.step.functionalWithSkill",
  functional_without_skill: "eval.progress.step.functionalWithoutSkill",
  parallel_arms: "eval.progress.step.parallelArms",
  finalize: "eval.progress.step.finalize",
  review_queue: "eval.progress.step.reviewQueue",
};

const USD_TO_CNY_RATE = 7.2;
const BEIJING_TIME_ZONE = "Asia/Shanghai";
const TRIGGER_BUCKET_MIN_SAMPLES = 12;
const FUNCTIONAL_MIN_SAMPLES = 24;
const MIN_MAX_PARALLEL_ARMS = 1;
const MAX_MAX_PARALLEL_ARMS = 4;
const MIN_EVAL_WORKERS = 1;
const MAX_EVAL_WORKERS = 16;
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
const BASE_SAMPLE_GENERATION_OVERHEAD_SECONDS = 4;
const EVAL_MODEL_DATALIST_ID = "eval-model-catalog";

function normalizeModelKey(value: string): string {
  return value.trim().toLowerCase();
}

function buildModelCatalog(groups: ModelGroup[] | undefined): ModelCatalogItem[] {
  const out: ModelCatalogItem[] = [];
  const seen = new Set<string>();
  for (const group of groups ?? []) {
    const groupId = group.id?.trim() || "";
    const groupName = group.name?.trim() || groupId || "Group";
    for (const rawModel of group.models ?? []) {
      const model = rawModel.trim();
      if (!model) continue;
      const key = model.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ model, groupId, groupName });
    }
  }
  return out;
}

function resolveModelGroupName(group: ModelGroup): string {
  const trimmedName = group.name?.trim() ?? "";
  if (trimmedName) return trimmedName;
  const trimmedId = group.id?.trim() ?? "";
  if (trimmedId) return trimmedId;
  return "Group";
}

function findModelCatalogItem(catalog: ModelCatalogItem[], value: string): ModelCatalogItem | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return catalog.find((item) => item.model.toLowerCase() === normalized) ?? null;
}

function findModelGroupsByModel(groups: ModelGroup[], value: string): ModelGroup[] {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  return groups.filter((group) =>
    (group.models ?? []).some((item) => item.trim().toLowerCase() === normalized),
  );
}

function resolvePreferredModelGroup(
  groups: ModelGroup[],
  value: string,
  preferredGroupId?: string | null,
): ModelGroup | null {
  const candidates = findModelGroupsByModel(groups, value);
  if (candidates.length === 0) {
    return null;
  }
  const normalizedPreferred = preferredGroupId?.trim() ?? "";
  if (normalizedPreferred) {
    const matched = candidates.find((group) => group.id === normalizedPreferred);
    if (matched) {
      return matched;
    }
  }
  return candidates[0] ?? null;
}

function estimateModelSpeedSecondsPerCase(model: string): number {
  const key = normalizeModelKey(model);
  if (!key) return 2.6;
  if (key.includes("nano")) return 1.4;
  if (key.includes("mini")) return 1.9;
  if (key.includes("4.1")) return 2.4;
  if (key.includes("4o")) return 2.2;
  if (key.includes("o3") || key.includes("reason")) return 3.2;
  if (key.includes("m2.5")) return 2.8;
  return 2.6;
}

function estimateSampleGenerationSeconds(
  model: string,
  triggerCount: number,
  functionalCount: number,
  history: EvalSampleGenerationTimingEntry[],
): { seconds: number; historyMatches: number; lastSeconds?: number } {
  const totalCases = Math.max(1, triggerCount + functionalCount);
  const modelKey = normalizeModelKey(model);
  const basePerCase = estimateModelSpeedSecondsPerCase(modelKey);
  const exactMatches = history
    .filter((item) => normalizeModelKey(item.model) === modelKey)
    .slice(0, 12);
  const familyMatches = history
    .filter(
      (item) =>
        !exactMatches.includes(item) &&
        modelKey &&
        normalizeModelKey(item.model).split("-")[0] === modelKey.split("-")[0],
    )
    .slice(0, 8);
  const historyMatches = exactMatches.length + familyMatches.length;
  const blendedMatches = [...exactMatches, ...familyMatches];
  const historyPerCase =
    blendedMatches.length > 0
      ? blendedMatches.reduce((sum, item) => {
          const itemCases = Math.max(1, item.triggerCount + item.functionalCount);
          return sum + item.elapsedSeconds / itemCases;
        }, 0) / blendedMatches.length
      : basePerCase;
  const historyWeight = Math.min(0.85, historyMatches * 0.16);
  const adjustedPerCase = basePerCase * (1 - historyWeight) + historyPerCase * historyWeight;
  const estimatedSeconds = Math.max(
    1,
    Math.round(BASE_SAMPLE_GENERATION_OVERHEAD_SECONDS + adjustedPerCase * totalCases),
  );
  return {
    seconds: estimatedSeconds,
    historyMatches,
    lastSeconds: exactMatches[0]?.elapsedSeconds ?? familyMatches[0]?.elapsedSeconds,
  };
}

function resolveFlowStatus(
  step: 1 | 2 | 3,
  activeStep: 1 | 2 | 3,
  done: boolean,
): EvalFlowStatus {
  if (activeStep === step) return "active";
  if (done) return "done";
  return "pending";
}

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

function formatBeijingDateTime(value: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: BEIJING_TIME_ZONE,
  }).format(value);
}

function formatBeijingDateTimeYmdHm(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: BEIJING_TIME_ZONE,
  }).formatToParts(value);
  const map = parts.reduce<Record<string, string>>((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${map.year ?? "0000"}-${map.month ?? "00"}-${map.day ?? "00"} ${map.hour ?? "00"}:${map.minute ?? "00"}`;
}

function truncatePreview(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(page, 1), Math.max(totalPages, 1));
}

function formatPercent(value: number, digits = 2): string {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return `${(value * 100).toFixed(digits)}%`;
}

function formatPercentValue(value: number, digits = 2): string {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return (value * 100).toFixed(digits);
}

function formatSignedNumber(value: number, digits = 2): string {
  const rounded = Number(value.toFixed(digits));
  const abs = Math.abs(rounded).toFixed(digits);
  if (rounded > 0) {
    return `+${abs}`;
  }
  if (rounded < 0) {
    return `-${abs}`;
  }
  return abs;
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
  const { t, locale } = useI18n();
  const { resolvedTheme } = useTheme();
  const chartThemeName =
    resolvedTheme === "dark" ? "myskills-soft-dark" : "myskills-soft-light";

  const [selectedSkill, setSelectedSkill] = useState("");
  const [evalMode, setEvalMode] = useState<EvalMode>("full");
  const [sampleModel, setSampleModel] = useState("gpt-4o-mini");
  const [model, setModel] = useState("gpt-4o-mini");
  const [evalModelGroups, setEvalModelGroups] = useState<ModelGroup[]>([]);
  const [sampleModelGroupId, setSampleModelGroupId] = useState("");
  const [runModelGroupId, setRunModelGroupId] = useState("");
  const [maxParallelArmsInput, setMaxParallelArmsInput] = useState("2");
  const [triggerMaxWorkersInput, setTriggerMaxWorkersInput] = useState("6");
  const [functionalMaxWorkersInput, setFunctionalMaxWorkersInput] = useState("3");
  const [costCurrency, setCostCurrency] = useState<CostCurrency>("USD");
  const [repeatsInput, setRepeatsInput] = useState("1");
  const [maxCostUsdInput, setMaxCostUsdInput] = useState("");
  const [selectedModules, setSelectedModules] = useState<EvalModuleKey[]>(defaultSelectedModules());
  const [running, setRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const [progressEvent, setProgressEvent] = useState<EvalPipelineProgressEvent | null>(null);
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
  const [historyRefreshing, setHistoryRefreshing] = useState(false);
  const [historyRefreshError, setHistoryRefreshError] = useState("");
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyFetchLimit, setHistoryFetchLimit] = useState(20);
  const [historyLoadingPath, setHistoryLoadingPath] = useState<string | null>(null);
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
  const [stepOverride, setStepOverride] = useState<1 | 2 | 3 | null>(null);
  const [view, setView] = useState<EvalView>("setup");
  const [runSnapshot, setRunSnapshot] = useState<EvalRunSnapshot | null>(null);
  const [sampleTimingHistory, setSampleTimingHistory] = useState<EvalSampleGenerationTimingEntry[]>([]);
  const [reviewFinalVerdict, setReviewFinalVerdict] = useState("pass");
  const [reviewOverrideGate, setReviewOverrideGate] = useState(false);
  const [reviewOverrideReason, setReviewOverrideReason] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewReviewer, setReviewReviewer] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [feedbackDrafting, setFeedbackDrafting] = useState(false);
  const [reviewCaseId, setReviewCaseId] = useState("");
  const [reviewEvidence, setReviewEvidence] = useState("");
  const [reviewEvidenceLoading, setReviewEvidenceLoading] = useState(false);
  const runDockRef = useRef<HTMLElement | null>(null);
  const [runDockOffsetPx, setRunDockOffsetPx] = useState(280);
  const [triggerPanels, setTriggerPanels] = useState<Record<TriggerPanelKey, ResultPanelState>>({
    clean: {
      chartExpanded: true,
      tableExpanded: false,
      filter: "all",
      page: 1,
      pageSize: 50,
    },
    complex: {
      chartExpanded: false,
      tableExpanded: false,
      filter: "all",
      page: 1,
      pageSize: 50,
    },
  });
  const [functionalPanel, setFunctionalPanel] = useState<ResultPanelState>({
    chartExpanded: true,
    tableExpanded: false,
    filter: "all",
    page: 1,
    pageSize: 50,
  });
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const copyToastTimerRef = useRef<number | null>(null);
  const cleanTableAnchorRef = useRef<HTMLDivElement | null>(null);
  const complexTableAnchorRef = useRef<HTMLDivElement | null>(null);
  const functionalTableAnchorRef = useRef<HTMLDivElement | null>(null);

  const selectedSkillMeta = useMemo(
    () => skills.find((item) => item.name === selectedSkill),
    [skills, selectedSkill],
  );
  const modelCatalog = useMemo(() => buildModelCatalog(evalModelGroups), [evalModelGroups]);
  const sampleModelCatalogItem = useMemo(
    () => findModelCatalogItem(modelCatalog, sampleModel),
    [modelCatalog, sampleModel],
  );
  const runModelCatalogItem = useMemo(
    () => findModelCatalogItem(modelCatalog, model),
    [modelCatalog, model],
  );
  const sampleModelGroupOptions = useMemo(
    () => findModelGroupsByModel(evalModelGroups, sampleModel),
    [evalModelGroups, sampleModel],
  );
  const runModelGroupOptions = useMemo(
    () => findModelGroupsByModel(evalModelGroups, model),
    [evalModelGroups, model],
  );
  const resolvedSampleModelGroup = useMemo(
    () => resolvePreferredModelGroup(evalModelGroups, sampleModel, sampleModelGroupId),
    [evalModelGroups, sampleModel, sampleModelGroupId],
  );
  const resolvedRunModelGroup = useMemo(
    () => resolvePreferredModelGroup(evalModelGroups, model, runModelGroupId),
    [evalModelGroups, model, runModelGroupId],
  );
  const sampleModelGroupHint = useMemo(
    () => resolvedSampleModelGroup?.name?.trim() || sampleModelCatalogItem?.groupName || "",
    [resolvedSampleModelGroup, sampleModelCatalogItem],
  );
  const runModelGroupHint = useMemo(
    () => resolvedRunModelGroup?.name?.trim() || runModelCatalogItem?.groupName || "",
    [resolvedRunModelGroup, runModelCatalogItem],
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
      overallPassRate: {
        dimension: t("eval.dimension.functionalCore"),
        description: t("eval.kpi.help.overallPassRate"),
      },
      passRateDelta: {
        dimension: t("eval.dimension.valueAdded"),
        description: t("eval.kpi.help.passRateDelta"),
      },
      failedSamples: {
        dimension: t("eval.dimension.coverage"),
        description: t("eval.kpi.help.failedSamples"),
      },
      evalDuration: {
        dimension: t("eval.dimension.efficiency"),
        description: t("eval.kpi.help.evalDuration"),
      },
    }),
    [t],
  );

  const refreshSampleTimingHistory = useCallback(async (skillName?: string) => {
    try {
      const items = await evalListSampleGenerationHistory({
        skillName: skillName?.trim() || undefined,
        limit: 80,
      });
      setSampleTimingHistory(items);
    } catch {
      setSampleTimingHistory([]);
    }
  }, []);

  const syncEvalConnectionForSelectedModels = useCallback(async (target: EvalConnectionTarget) => {
    const runModelTrimmed = model.trim();
    const sampleModelTrimmed = sampleModel.trim();
    if (!runModelTrimmed && !sampleModelTrimmed) {
      return;
    }

    const config = await evalGetConfig();
    const groups = config.modelGroups ?? [];
    const preferredModel = target === "sample" ? sampleModelTrimmed : runModelTrimmed;
    const preferredGroupId = target === "sample" ? sampleModelGroupId : runModelGroupId;
    const selectedGroup =
      resolvePreferredModelGroup(groups, preferredModel, preferredGroupId) ??
      resolvePreferredModelGroup(
        groups,
        target === "sample" ? runModelTrimmed : sampleModelTrimmed,
        target === "sample" ? runModelGroupId : sampleModelGroupId,
      );

    const nextSampleModel = sampleModelTrimmed || config.sampleModel;
    const nextRunModel = runModelTrimmed || config.runModel;
    const nextSampleModelGroupId =
      resolvePreferredModelGroup(groups, nextSampleModel, sampleModelGroupId)?.id;
    const nextRunModelGroupId =
      resolvePreferredModelGroup(groups, nextRunModel, runModelGroupId)?.id;

    let changed = false;
    const nextConfig = {
      ...config,
      sampleModel: nextSampleModel,
      runModel: nextRunModel,
      sampleModelGroupId: nextSampleModelGroupId,
      runModelGroupId: nextRunModelGroupId,
    };
    if (
      nextSampleModel !== config.sampleModel ||
      nextRunModel !== config.runModel ||
      (nextSampleModelGroupId ?? "") !== (config.sampleModelGroupId ?? "") ||
      (nextRunModelGroupId ?? "") !== (config.runModelGroupId ?? "")
    ) {
      changed = true;
    }

    if (selectedGroup) {
      const nextBaseUrl = selectedGroup.baseUrl.trim();
      const currentBaseUrl = (config.baseUrl ?? "").trim();
      if (nextBaseUrl && currentBaseUrl !== nextBaseUrl) {
        nextConfig.baseUrl = nextBaseUrl;
        changed = true;
      }

      // Keep existing key when gateway mode is enabled to avoid breaking strict key checks.
      const nextApiKey = selectedGroup.isGateway ? config.apiKey.trim() : selectedGroup.apiKey.trim();
      if (nextApiKey && nextApiKey !== config.apiKey.trim()) {
        nextConfig.apiKey = nextApiKey;
        changed = true;
      }
    }

    setEvalModelGroups(groups);
    if (changed) {
      await evalSaveConfig(nextConfig);
    }
  }, [model, sampleModel, runModelGroupId, sampleModelGroupId]);

  useEffect(() => {
    void evalGetConfig()
      .then((config) => {
        const sample = (config.sampleModel || config.defaultModel || "").trim();
        const run = (config.runModel || config.defaultModel || "").trim();
        const groups = config.modelGroups ?? [];
        setEvalModelGroups(groups);
        if (sample) {
          setSampleModel(sample);
        }
        if (run) {
          setModel(run);
        }
        const sampleGroupId = resolvePreferredModelGroup(
          groups,
          sample,
          config.sampleModelGroupId,
        )?.id;
        const runGroupId = resolvePreferredModelGroup(
          groups,
          run,
          config.runModelGroupId,
        )?.id;
        setSampleModelGroupId(sampleGroupId ?? "");
        setRunModelGroupId(runGroupId ?? "");
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
    void refreshSampleTimingHistory();
  }, [refreshSampleTimingHistory]);

  useEffect(() => {
    const candidates = findModelGroupsByModel(evalModelGroups, sampleModel);
    if (candidates.length === 0) {
      if (sampleModelGroupId) {
        setSampleModelGroupId("");
      }
      return;
    }
    if (sampleModelGroupId && candidates.some((group) => group.id === sampleModelGroupId)) {
      return;
    }
    if (candidates.length === 1) {
      setSampleModelGroupId(candidates[0].id);
      return;
    }
    setSampleModelGroupId("");
  }, [evalModelGroups, sampleModel, sampleModelGroupId]);

  useEffect(() => {
    const candidates = findModelGroupsByModel(evalModelGroups, model);
    if (candidates.length === 0) {
      if (runModelGroupId) {
        setRunModelGroupId("");
      }
      return;
    }
    if (runModelGroupId && candidates.some((group) => group.id === runModelGroupId)) {
      return;
    }
    if (candidates.length === 1) {
      setRunModelGroupId(candidates[0].id);
      return;
    }
    setRunModelGroupId("");
  }, [evalModelGroups, model, runModelGroupId]);

  useEffect(() => {
    if (!selectedSkill) {
      setStoragePaths(null);
      setHistoryEntries([]);
      setHistoryHasMore(false);
      setHistoryFetchLimit(20);
      setHistoryRefreshError("");
      setHistoryRefreshing(false);
      setHistoryLoadingPath(null);
      setSampleTimingHistory([]);
      setRunSnapshot(null);
      setView("setup");
      setShowSamples(false);
      setShowHistory(false);
      setExpandedHistoryPath(null);
      setHistoryDetails({});
      setHistoryDetailErrors({});
      setHistoryDetailLoadingPath(null);
      return;
    }
    void refreshHistory(selectedSkill, "replace", 20);
    void refreshSampleTimingHistory(selectedSkill);
  }, [refreshSampleTimingHistory, selectedSkill]);

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
    if (!report) {
      setReviewFinalVerdict("pass");
      setReviewOverrideGate(false);
      setReviewOverrideReason("");
      setReviewNotes("");
      setReviewCaseId("");
      setReviewEvidence("");
      return;
    }
    setReviewFinalVerdict(report.finalVerdict || report.reviewSummary?.finalVerdict || "pass");
    setReviewOverrideGate(Boolean(report.reviewSummary?.overrideGate));
    setReviewOverrideReason(report.overrideReason || "");
    const firstFailedCase = report.functional.results?.find((item) => !item.passed)?.caseId || "";
    setReviewCaseId(firstFailedCase);
    setReviewEvidence("");
  }, [report]);

  useEffect(() => {
    if (view !== "result") {
      return;
    }
    setTriggerPanels((prev) => ({
      clean: {
        ...prev.clean,
        chartExpanded: true,
        tableExpanded: false,
        filter: "all",
        page: 1,
      },
      complex: {
        ...prev.complex,
        chartExpanded: false,
        tableExpanded: false,
        filter: "all",
        page: 1,
      },
    }));
    setFunctionalPanel((prev) => ({
      ...prev,
      chartExpanded: true,
      tableExpanded: false,
      filter: "all",
      page: 1,
    }));
  }, [report?.historyPath, view]);

  useEffect(() => {
    return () => {
      if (copyToastTimerRef.current !== null) {
        window.clearTimeout(copyToastTimerRef.current);
      }
    };
  }, []);

  const updateTriggerPanel = useCallback(
    (key: TriggerPanelKey, updater: (current: ResultPanelState) => ResultPanelState) => {
      setTriggerPanels((prev) => ({
        ...prev,
        [key]: updater(prev[key]),
      }));
    },
    [],
  );

  const updateFunctionalPanel = useCallback((updater: (current: ResultPanelState) => ResultPanelState) => {
    setFunctionalPanel((prev) => updater(prev));
  }, []);

  const scrollTableAnchor = useCallback((anchor: RefObject<HTMLDivElement | null>) => {
    window.requestAnimationFrame(() => {
      anchor.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const pushCopyToast = useCallback((message: string) => {
    if (copyToastTimerRef.current !== null) {
      window.clearTimeout(copyToastTimerRef.current);
    }
    setCopyToast(message);
    copyToastTimerRef.current = window.setTimeout(() => {
      setCopyToast(null);
      copyToastTimerRef.current = null;
    }, 1200);
  }, []);

  const handleCopyPath = useCallback(
    async (value: string | null | undefined) => {
      if (!value?.trim()) {
        return;
      }
      try {
        await navigator.clipboard.writeText(value);
        pushCopyToast(t("eval.table.copyPathSuccess"));
      } catch {
        pushCopyToast(t("eval.table.copyPathFailed"));
      }
    },
    [pushCopyToast, t],
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<EvalPipelineProgressEvent>("eval://pipeline-progress", (event) => {
      const payload = event.payload;
      if (!activeRunIdRef.current || payload.runId !== activeRunIdRef.current) {
        return;
      }
      setProgressEvent((previous) =>
        previous
          ? {
              ...previous,
              ...payload,
              stageKey: payload.stageKey ?? previous.stageKey,
              stageLabel: payload.stageLabel ?? previous.stageLabel,
              stageIndex: payload.stageIndex ?? previous.stageIndex,
              stageTotal: payload.stageTotal ?? previous.stageTotal,
              stageProgressPercent:
                payload.stageProgressPercent ?? previous.stageProgressPercent,
              totalProgressPercent:
                payload.totalProgressPercent ?? previous.totalProgressPercent,
              totalCount: payload.totalCount ?? previous.totalCount,
              completedCount: payload.completedCount ?? previous.completedCount,
              activeCount: payload.activeCount ?? previous.activeCount,
              failedCount: payload.failedCount ?? previous.failedCount,
              maxParallelArms: payload.maxParallelArms ?? previous.maxParallelArms,
              triggerMaxWorkers: payload.triggerMaxWorkers ?? previous.triggerMaxWorkers,
              functionalMaxWorkers:
                payload.functionalMaxWorkers ?? previous.functionalMaxWorkers,
              remainingSeconds: payload.remainingSeconds ?? previous.remainingSeconds,
              reviewGateState: payload.reviewGateState ?? previous.reviewGateState,
            }
          : payload,
      );
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
    const maxParallelArms = Number.parseInt(maxParallelArmsInput, 10);
    if (
      !Number.isFinite(maxParallelArms) ||
      maxParallelArms < MIN_MAX_PARALLEL_ARMS ||
      maxParallelArms > MAX_MAX_PARALLEL_ARMS
    ) {
      setPreflightEstimate(null);
      setPreflightEstimateError(
        t("eval.error.maxParallelArmsInvalid", {
          min: MIN_MAX_PARALLEL_ARMS,
          max: MAX_MAX_PARALLEL_ARMS,
        }),
      );
      setPreflightEstimating(false);
      return;
    }
    const triggerMaxWorkers = Number.parseInt(triggerMaxWorkersInput, 10);
    if (
      !Number.isFinite(triggerMaxWorkers) ||
      triggerMaxWorkers < MIN_EVAL_WORKERS ||
      triggerMaxWorkers > MAX_EVAL_WORKERS
    ) {
      setPreflightEstimate(null);
      setPreflightEstimateError(
        t("eval.error.triggerMaxWorkersInvalid", {
          min: MIN_EVAL_WORKERS,
          max: MAX_EVAL_WORKERS,
        }),
      );
      setPreflightEstimating(false);
      return;
    }
    const functionalMaxWorkers = Number.parseInt(functionalMaxWorkersInput, 10);
    if (
      !Number.isFinite(functionalMaxWorkers) ||
      functionalMaxWorkers < MIN_EVAL_WORKERS ||
      functionalMaxWorkers > MAX_EVAL_WORKERS
    ) {
      setPreflightEstimate(null);
      setPreflightEstimateError(
        t("eval.error.functionalMaxWorkersInvalid", {
          min: MIN_EVAL_WORKERS,
          max: MAX_EVAL_WORKERS,
        }),
      );
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
        maxParallelArms,
        triggerMaxWorkers,
        functionalMaxWorkers,
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
    maxParallelArmsInput,
    triggerMaxWorkersInput,
    functionalMaxWorkersInput,
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

  async function refreshHistory(
    skillName: string,
    mode: HistoryRefreshMode = "replace",
    limit = 20,
    previousCount = 0,
  ) {
    const normalized = skillName.trim();
    if (!normalized) {
      setHistoryEntries([]);
      setHistoryHasMore(false);
      setHistoryFetchLimit(20);
      return;
    }

    setHistoryRefreshing(true);
    setHistoryRefreshError("");
    if (mode === "replace") {
      setExpandedHistoryPath(null);
      setHistoryDetails({});
      setHistoryDetailErrors({});
      setHistoryDetailLoadingPath(null);
    }

    try {
      const [paths, items] = await Promise.all([
        evalGetStoragePaths(normalized),
        evalListHistory(normalized, limit),
      ]);
      const sortedItems = [...items].sort((a, b) => b.savedAtUnix - a.savedAtUnix);
      setStoragePaths(paths);
      setTriggerSetPath((current) => current.trim() || paths.latestTriggerPath || "");
      setFunctionalSetPath((current) => current.trim() || paths.latestFunctionalPath || "");
      setHistoryEntries(sortedItems);
      setHistoryFetchLimit(limit);
      const reachedEnd = sortedItems.length < limit || (mode === "append" && sortedItems.length <= previousCount);
      setHistoryHasMore(!reachedEnd);
    } catch (error: unknown) {
      if (mode === "replace") {
        setHistoryEntries([]);
        setHistoryHasMore(false);
      }
      setHistoryRefreshError(String(error));
    } finally {
      setHistoryRefreshing(false);
    }
  }

  async function handleLoadMoreHistory() {
    if (!selectedSkill.trim() || historyRefreshing || !historyHasMore) {
      return;
    }
    const nextLimit = historyFetchLimit + 20;
    await refreshHistory(selectedSkill, "append", nextLimit, historyEntries.length);
  }

  async function handleLoadHistory(path: string) {
    setHistoryLoadingPath(path);
    try {
      const loaded = await evalLoadHistory(path);
      setReport(loaded);
      setRunSnapshot({
        skillName: selectedSkill.trim() || loaded.triggerClean.skillName || "--",
        mode: loaded.mode === "quick" ? "quick" : "full",
        model: loaded.runMeta.model,
        repeats: loaded.runMeta.repeats,
        maxParallelArms: loaded.runMeta.maxParallelArms,
        triggerMaxWorkers: loaded.runMeta.triggerMaxWorkers,
        functionalMaxWorkers: loaded.runMeta.functionalMaxWorkers,
        selectedModules:
          loaded.mode === "quick"
            ? []
            : (loaded.moduleResults
                ?.map((item) => item.key)
                .filter(
                  (key): key is EvalModuleKey =>
                    EVAL_MODULE_OPTIONS.some((option) => option.key === key),
                ) ?? []),
        triggerSetPath: triggerSetPath.trim(),
        functionalSetPath: functionalSetPath.trim(),
      });
      setView("result");
      setStatus(t("eval.history.loaded", { path }));
      setShowHistory(false);
    } catch (error: unknown) {
      setStatus(`${t("eval.error.runFailed")}: ${String(error)}`);
    } finally {
      setHistoryLoadingPath((current) => (current === path ? null : current));
    }
  }

  async function loadHistoryDetail(path: string, force = false) {
    if (!force && (historyDetails[path] || historyDetailLoadingPath === path)) {
      return;
    }
    setHistoryDetailErrors((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setHistoryDetailLoadingPath(path);
    try {
      const loaded = await evalLoadHistory(path);
      setHistoryDetails((prev) => ({ ...prev, [path]: loaded }));
    } catch (error: unknown) {
      setHistoryDetailErrors((prev) => ({ ...prev, [path]: String(error) }));
    } finally {
      setHistoryDetailLoadingPath((current) => (current === path ? null : current));
    }
  }

  async function handleToggleHistoryExpand(path: string) {
    if (expandedHistoryPath === path) {
      setExpandedHistoryPath(null);
      return;
    }
    setExpandedHistoryPath(path);
    await loadHistoryDetail(path);
  }

  async function handleRetryHistoryDetail(path: string) {
    await loadHistoryDetail(path, true);
  }

  async function handleGenerateSamples() {
    if (generating) {
      return;
    }
    if (!selectedSkill) {
      setStatus(t("eval.error.selectSkill"));
      return;
    }
    if (!sampleModel.trim()) {
      setStatus(t("eval.error.generationModelRequired"));
      return;
    }
    const docPath = skillDocPath(selectedSkillMeta);
    if (!docPath) {
      setStatus(t("eval.error.skillPathMissing"));
      return;
    }

    try {
      await syncEvalConnectionForSelectedModels("sample");
    } catch (error: unknown) {
      setStatus(`${t("eval.error.runFailed")}: ${String(error)}`);
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
        model: sampleModel.trim(),
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
      await refreshSampleTimingHistory(selectedSkill);
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
        await refreshHistory(selectedSkill, "replace", 20);
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
    if (evalMode !== "quick" && !functionalSetPath.trim()) {
      if (requiresFunctionalByModules) {
        setStatus(t("eval.error.datasetRequired", { type: t("eval.dataset.functional") }));
        return;
      }
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
    const maxParallelArmsValue = Number.parseInt(maxParallelArmsInput, 10);
    if (
      !Number.isFinite(maxParallelArmsValue) ||
      maxParallelArmsValue < MIN_MAX_PARALLEL_ARMS ||
      maxParallelArmsValue > MAX_MAX_PARALLEL_ARMS
    ) {
      setStatus(
        t("eval.error.maxParallelArmsInvalid", {
          min: MIN_MAX_PARALLEL_ARMS,
          max: MAX_MAX_PARALLEL_ARMS,
        }),
      );
      return;
    }
    const triggerMaxWorkersValue = Number.parseInt(triggerMaxWorkersInput, 10);
    if (
      !Number.isFinite(triggerMaxWorkersValue) ||
      triggerMaxWorkersValue < MIN_EVAL_WORKERS ||
      triggerMaxWorkersValue > MAX_EVAL_WORKERS
    ) {
      setStatus(
        t("eval.error.triggerMaxWorkersInvalid", {
          min: MIN_EVAL_WORKERS,
          max: MAX_EVAL_WORKERS,
        }),
      );
      return;
    }
    const functionalMaxWorkersValue = Number.parseInt(functionalMaxWorkersInput, 10);
    if (
      !Number.isFinite(functionalMaxWorkersValue) ||
      functionalMaxWorkersValue < MIN_EVAL_WORKERS ||
      functionalMaxWorkersValue > MAX_EVAL_WORKERS
    ) {
      setStatus(
        t("eval.error.functionalMaxWorkersInvalid", {
          min: MIN_EVAL_WORKERS,
          max: MAX_EVAL_WORKERS,
        }),
      );
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

    try {
      await syncEvalConnectionForSelectedModels("run");
    } catch (error: unknown) {
      setStatus(`${t("eval.error.runFailed")}: ${String(error)}`);
      return;
    }

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
    setView("running");
    setRunSnapshot({
      skillName: selectedSkill.trim(),
      mode: evalMode,
      model: model.trim(),
      repeats,
      maxParallelArms: maxParallelArmsValue,
      triggerMaxWorkers: triggerMaxWorkersValue,
      functionalMaxWorkers: functionalMaxWorkersValue,
      selectedModules: selectedModulesForRun,
      triggerSetPath: triggerSetPath.trim(),
      functionalSetPath: functionalSetPath.trim(),
    });
    setStatus(t("eval.running"));

    let runSucceeded = false;
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
        maxParallelArms: maxParallelArmsValue,
        triggerMaxWorkers: triggerMaxWorkersValue,
        functionalMaxWorkers: functionalMaxWorkersValue,
        runId,
      });
      if (pipeline.status !== "success") {
        throw new Error(pipeline.message || "Evaluation failed");
      }
      runSucceeded = true;
      setReport(pipeline);
      if (selectedSkill) {
        await refreshHistory(selectedSkill, "replace", 20);
      }
      setView(pipeline.mode === "full" ? "review" : "result");
      if (pipeline.historyPath) {
        setStatus(t("eval.history.saved", { path: pipeline.historyPath }));
      } else if (pipeline.message?.trim()) {
        setStatus(pipeline.message);
      } else {
        setStatus("");
      }
    } catch (error: unknown) {
      const errorMessage = `${t("eval.error.runFailed")}: ${String(error)}`;
      setView("running");
      setProgressEvent((previous) => {
        if (!previous) {
          return {
            runId,
            status: "error",
            currentRepeat: 0,
            totalRepeats: repeats,
            stepIndex: 0,
            totalSteps: 1,
            stepName: "pipeline",
            message: errorMessage,
            elapsedMs: progressElapsedMs,
            totalProgressPercent: 99,
            stageProgressPercent: 99,
            totalCount: 1,
            completedCount: 0,
            activeCount: 0,
            failedCount: 1,
            remainingSeconds: 0,
          };
        }
        return {
          ...previous,
          runId,
          status: "error",
          message: errorMessage,
          activeCount: 0,
          failedCount: Math.max(1, previous.failedCount ?? 0),
          remainingSeconds: 0,
          totalProgressPercent: Math.min(99, Math.max(0, previous.totalProgressPercent ?? 99)),
          stageProgressPercent: Math.min(99, Math.max(0, previous.stageProgressPercent ?? 99)),
        };
      });
      setStatus(errorMessage);
    } finally {
      setActiveRunId(null);
      setPauseRequested(false);
      setRunning(false);
      if (!runSucceeded) {
        setProgressStartedAtMs(null);
      }
    }
  }

  async function handleSubmitReview() {
    if (!report?.historyPath) {
      setStatus(t("eval.review.historyRequired"));
      return;
    }
    if (reviewOverrideGate && !reviewOverrideReason.trim()) {
      setStatus(t("eval.review.overrideReasonRequired"));
      return;
    }
    setReviewSubmitting(true);
    try {
      await evalSubmitReview({
        path: report.historyPath,
        finalVerdict: reviewFinalVerdict.trim() || "pass",
        overrideGate: reviewOverrideGate,
        overrideReason: reviewOverrideReason.trim() || undefined,
        notes: reviewNotes.trim() || undefined,
        reviewer: reviewReviewer.trim() || undefined,
      });
      const reloaded = await evalLoadHistory(report.historyPath);
      setReport(reloaded);
      if (selectedSkill.trim()) {
        await refreshHistory(selectedSkill, "replace", 20);
      }
      setStatus(t("eval.review.saved"));
    } catch (error: unknown) {
      setStatus(`${t("eval.error.runFailed")}: ${String(error)}`);
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function handleGenerateFeedbackDrafts() {
    if (!report?.historyPath) {
      setStatus(t("eval.review.historyRequired"));
      return;
    }
    setFeedbackDrafting(true);
    try {
      const drafts = await evalGenerateFeedbackDrafts({
        path: report.historyPath,
        triggerCount: triggerDraftRows.length > 0 ? triggerDraftRows.length : undefined,
        functionalCount: functionalDraftRows.length > 0 ? functionalDraftRows.length : undefined,
      });
      const nextTriggerRows = parseTriggerDraftRows(drafts.triggerDraft);
      const nextFunctionalRows = parseFunctionalDraftRows(drafts.functionalDraft);
      setTriggerDraftRows(nextTriggerRows);
      setFunctionalDraftRows(nextFunctionalRows);
      setShowSamples(true);
      setShowHistory(false);
      setStatus(
        t("eval.review.feedbackGenerated", {
          trigger: nextTriggerRows.length,
          functional: nextFunctionalRows.length,
        }),
      );
    } catch (error: unknown) {
      setStatus(`${t("eval.error.runFailed")}: ${String(error)}`);
    } finally {
      setFeedbackDrafting(false);
    }
  }

  async function handlePreviewEvidenceCase() {
    if (!report?.historyPath || !reviewCaseId.trim()) {
      return;
    }
    setReviewEvidenceLoading(true);
    try {
      const payload = await evalReadEvidenceCase({
        path: report.historyPath,
        caseId: reviewCaseId.trim(),
      });
      setReviewEvidence(payload.content || payload.evidencePath || "");
    } catch (error: unknown) {
      setReviewEvidence(String(error));
    } finally {
      setReviewEvidenceLoading(false);
    }
  }

  function renderSummaryKpis() {
    if (!report) return null;

    const sortedHistory = [...historyEntries].sort((a, b) => b.savedAtUnix - a.savedAtUnix);
    let previousEntry: EvalHistoryEntry | null = null;
    if (sortedHistory.length > 0) {
      if (report.historyPath) {
        const currentIndex = sortedHistory.findIndex((item) => item.path === report.historyPath);
        if (currentIndex >= 0) {
          previousEntry = sortedHistory[currentIndex + 1] ?? null;
        } else {
          previousEntry = sortedHistory[0] ?? null;
        }
      } else {
        previousEntry = sortedHistory[0] ?? null;
      }
    }

    const previousPassRate = previousEntry?.passRate ?? null;
    const passRateDelta = previousPassRate === null
      ? null
      : (report.summary.passRate - previousPassRate) * 100;
    const passRateDeltaDisplay = passRateDelta === null
      ? "--"
      : t("eval.kpi.passRateDelta.pp", { value: formatSignedNumber(passRateDelta, 2) });
    const passRateDeltaTone = passRateDelta === null
      ? "neutral"
      : passRateDelta > 0
        ? "positive"
        : passRateDelta < 0
          ? "negative"
          : "neutral";
    const previousSavedAtLabel = previousEntry
      ? formatBeijingDateTimeYmdHm(new Date(previousEntry.savedAtUnix * 1000))
      : null;
    const passRateDeltaDimension = previousSavedAtLabel
      ? t("eval.kpi.passRateDelta.baselineAt", { time: previousSavedAtLabel })
      : t("eval.kpi.passRateDelta.noBaseline");
    const quicklineToneClass =
      passRateDeltaTone === "positive"
        ? "is-positive"
        : passRateDeltaTone === "negative"
          ? "is-negative"
          : "is-neutral";

    const quicklineMain = previousSavedAtLabel
      ? t("eval.results.quickline.withBaseline", {
        passRate: formatPercent(report.summary.passRate, 2),
        delta: passRateDeltaDisplay,
        failed: formatInteger(report.summary.totalFailed),
        duration: formatDurationLabel(report.runMeta.elapsedMs / 1000),
      })
      : t("eval.results.quickline.noBaseline", {
        passRate: formatPercent(report.summary.passRate, 2),
        failed: formatInteger(report.summary.totalFailed),
        duration: formatDurationLabel(report.runMeta.elapsedMs / 1000),
      });

    return (
      <>
        <article className={`chart-card eval-result-quickline ${quicklineToneClass}`}>
          <span className="eval-result-quickline-label">{t("eval.results.quickline.label")}</span>
          <strong className="eval-result-quickline-main">{quicklineMain}</strong>
          <small className="eval-result-quickline-sub">
            {previousSavedAtLabel
              ? t("eval.results.quickline.baselineAt", { time: previousSavedAtLabel })
              : t("eval.results.quickline.noBaselineHint")}
          </small>
        </article>
        <div className="kpi-row">
          <KpiCard
            label={t("eval.kpi.overallPassRate")}
            value={formatPercent(report.summary.passRate, 2)}
            dimension={kpiHelp.overallPassRate.dimension}
            description={kpiHelp.overallPassRate.description}
          />
          <KpiCard
            label={t("eval.kpi.passRateDelta")}
            value={passRateDeltaDisplay}
            dimension={passRateDeltaDimension}
            description={kpiHelp.passRateDelta.description}
            valueTone={passRateDeltaTone}
          />
          <KpiCard
            label={t("eval.kpi.failedSamples")}
            value={formatInteger(report.summary.totalFailed)}
            dimension={kpiHelp.failedSamples.dimension}
            description={kpiHelp.failedSamples.description}
          />
          <KpiCard
            label={t("eval.kpi.evalDuration")}
            value={formatDurationLabel(report.runMeta.elapsedMs / 1000)}
            dimension={kpiHelp.evalDuration.dimension}
            description={kpiHelp.evalDuration.description}
          />
        </div>
      </>
    );
  }

  function renderModeKpis() {
    if (!report) return null;
    const overallStats = report.repeatStats?.overallPassRate;
    const overallStatsLabel = overallStats
      ? `${formatPercent(overallStats.mean, 2)} +/- ${formatPercent(overallStats.stdDev, 2)}`
      : "--";
    const valueAddedLabel = report.deltaVsNoSkill
      ? t("eval.kpi.passRateDelta.pp", {
        value: formatSignedNumber(report.deltaVsNoSkill.functionalPassRateDelta * 100, 2),
      })
      : "--";
    const valueAddedTone = report.deltaVsNoSkill
      ? report.deltaVsNoSkill.functionalPassRateDelta > 0
        ? "positive"
        : report.deltaVsNoSkill.functionalPassRateDelta < 0
          ? "negative"
          : "neutral"
      : "neutral";
    return (
      <div className="kpi-row">
        <KpiCard
          label={t("eval.kpi.precision")}
          value={formatPercent(report.triggerMetrics.precision, 2)}
          dimension={kpiHelp.precision.dimension}
          description={kpiHelp.precision.description}
        />
        <KpiCard
          label={t("eval.kpi.recall")}
          value={formatPercent(report.triggerMetrics.recall, 2)}
          dimension={kpiHelp.recall.dimension}
          description={kpiHelp.recall.description}
        />
        <KpiCard
          label={t("eval.kpi.fpr")}
          value={formatPercent(report.triggerMetrics.fpr, 2)}
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
          valueTone={valueAddedTone}
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

  function renderQuickCheckLabel(rawKey: string): string {
    switch (rawKey) {
      case "skill-shape-analysis":
        return t("eval.quickCheck.skillShape");
      case "taxonomy-validity":
        return t("eval.quickCheck.taxonomyValidity");
      case "structure-syntax":
        return t("eval.quickCheck.structureSyntax");
      case "generation-guardrail":
        return t("eval.quickCheck.generationGuardrail");
      case "ui-metadata-consistency":
        return t("eval.quickCheck.uiMetadataConsistency");
      case "script-smoke":
        return t("eval.quickCheck.scriptSmoke");
      case "trigger-bucket-coverage":
        return t("eval.quickCheck.triggerBucketCoverage");
      default:
        return rawKey;
    }
  }

  function renderQuickCheckDescription(rawKey: string): string {
    switch (rawKey) {
      case "skill-shape-analysis":
        return t("eval.quickCheck.desc.skillShape");
      case "taxonomy-validity":
        return t("eval.quickCheck.desc.taxonomyValidity");
      case "structure-syntax":
        return t("eval.quickCheck.desc.structureSyntax");
      case "generation-guardrail":
        return t("eval.quickCheck.desc.generationGuardrail");
      case "ui-metadata-consistency":
        return t("eval.quickCheck.desc.uiMetadataConsistency");
      case "script-smoke":
        return t("eval.quickCheck.desc.scriptSmoke");
      case "trigger-bucket-coverage":
        return t("eval.quickCheck.desc.triggerBucketCoverage");
      default:
        return t("eval.quickCheck.desc.generic");
    }
  }

  function renderQuickCheckMessage(rawKey: string, message: string): string {
    const normalized = message.trim();
    if (!normalized) {
      return t("eval.common.na");
    }
    if (rawKey === "skill-shape-analysis") {
      const shapeMatch = normalized.match(
        /^Detected skill shape '([^']+)' \(agents_dir=(true|false), openai_yaml=(true|false), scripts_dir=(true|false), references_dir=(true|false), assets_dir=(true|false)\)\.$/i,
      );
      if (shapeMatch) {
        return t("eval.quickCheck.msg.skillShape", {
          shape: shapeMatch[1],
          agents: shapeMatch[2],
          openaiYaml: shapeMatch[3],
          scripts: shapeMatch[4],
          references: shapeMatch[5],
          assets: shapeMatch[6],
        });
      }
    }
    if (normalized === "Taxonomy classification fields and enum values are valid.") {
      return t("eval.quickCheck.msg.taxonomyValid");
    }
    if (normalized === "SKILL.md frontmatter structure is valid.") {
      return t("eval.quickCheck.msg.structureValid");
    }
    if (normalized.startsWith("Skipped: skill shape")) {
      const skippedShape = normalized.match(/^Skipped: skill shape '([^']+)'/i);
      const suffix = rawKey === "generation-guardrail"
        ? t("eval.quickCheck.msg.skipGeneration")
        : rawKey === "ui-metadata-consistency"
          ? t("eval.quickCheck.msg.skipUiMetadata")
          : t("eval.quickCheck.msg.skipGeneric");
      return t("eval.quickCheck.msg.skipped", {
        shape: skippedShape?.[1] ?? t("eval.common.na"),
        detail: suffix,
      });
    }
    const scriptSmokeMatch = normalized.match(/^Script smoke requirement passed for (\d+) scripts\.$/i);
    if (scriptSmokeMatch) {
      return t("eval.quickCheck.msg.scriptSmokePassed", { count: scriptSmokeMatch[1] });
    }
    const triggerCoveragePassMatch = normalized.match(
      /^Trigger bucket coverage passed with minimum (\d+) per bucket\.$/i,
    );
    if (triggerCoveragePassMatch) {
      return t("eval.quickCheck.msg.triggerCoveragePassed", {
        minimum: triggerCoveragePassMatch[1],
      });
    }
    const triggerCoverageFailMatch = normalized.match(
      /^Trigger bucket coverage failed\. Buckets below minimum (\d+): (.+)$/i,
    );
    if (triggerCoverageFailMatch) {
      return t("eval.quickCheck.msg.triggerCoverageFailed", {
        minimum: triggerCoverageFailMatch[1],
        buckets: triggerCoverageFailMatch[2],
      });
    }
    return normalized;
  }

  function renderAdvisoryReason(reason: string): string {
    const normalized = reason.trim();
    if (!normalized) return t("eval.advisory.reason.missing");

    const triggerPrecisionPassMatch = normalized.match(
      /^Trigger precision ([+-]?\d*\.?\d+) is below pass threshold ([+-]?\d*\.?\d+)\.$/i,
    );
    if (triggerPrecisionPassMatch) {
      return t("eval.advisory.reason.triggerPrecisionBelowPass", {
        value: triggerPrecisionPassMatch[1],
        threshold: triggerPrecisionPassMatch[2],
      });
    }
    const triggerRecallPassMatch = normalized.match(
      /^Trigger recall ([+-]?\d*\.?\d+) is below pass threshold ([+-]?\d*\.?\d+)\.$/i,
    );
    if (triggerRecallPassMatch) {
      return t("eval.advisory.reason.triggerRecallBelowPass", {
        value: triggerRecallPassMatch[1],
        threshold: triggerRecallPassMatch[2],
      });
    }
    if (normalized === "Functional delta unavailable; compared using trigger metrics only.") {
      return t("eval.advisory.reason.functionalDeltaMissing");
    }
    const functionalDeltaRegressionMatch = normalized.match(
      /^Functional delta ([+-]?\d*\.?\d+) indicates regression vs no-skill baseline\.$/i,
    );
    if (functionalDeltaRegressionMatch) {
      return t("eval.advisory.reason.functionalDeltaRegression", {
        value: functionalDeltaRegressionMatch[1],
      });
    }
    const functionalDeltaNonNegativeMatch = normalized.match(
      /^Functional delta ([+-]?\d*\.?\d+) is non-negative vs no-skill baseline\.$/i,
    );
    if (functionalDeltaNonNegativeMatch) {
      return t("eval.advisory.reason.functionalDeltaNonNegative", {
        value: functionalDeltaNonNegativeMatch[1],
      });
    }
    const precisionHighRiskMatch = normalized.match(
      /^Precision ([+-]?\d*\.?\d+) is below high-risk threshold ([+-]?\d*\.?\d+)\.$/i,
    );
    if (precisionHighRiskMatch) {
      return t("eval.advisory.reason.precisionBelowHighRisk", {
        value: precisionHighRiskMatch[1],
        threshold: precisionHighRiskMatch[2],
      });
    }
    const recallHighRiskMatch = normalized.match(
      /^Recall ([+-]?\d*\.?\d+) is below high-risk threshold ([+-]?\d*\.?\d+)\.$/i,
    );
    if (recallHighRiskMatch) {
      return t("eval.advisory.reason.recallBelowHighRisk", {
        value: recallHighRiskMatch[1],
        threshold: recallHighRiskMatch[2],
      });
    }
    const functionalHighRiskMatch = normalized.match(
      /^Functional delta ([+-]?\d*\.?\d+) is below high-risk threshold ([+-]?\d*\.?\d+)\.$/i,
    );
    if (functionalHighRiskMatch) {
      return t("eval.advisory.reason.functionalDeltaBelowHighRisk", {
        value: functionalHighRiskMatch[1],
        threshold: functionalHighRiskMatch[2],
      });
    }
    if (normalized === "All advisory pass thresholds are satisfied; keep this skill available.") {
      return t("eval.advisory.reason.passThresholdsSatisfied");
    }
    if (normalized === "One or more pass thresholds are not met.") {
      return t("eval.advisory.reason.passThresholdsNotMet");
    }
    const quickChecksBlockedMatch = normalized.match(
      /^Quick checks failed; pipeline blocked\. Failed checks: (.+)$/i,
    );
    if (quickChecksBlockedMatch) {
      return t("eval.advisory.reason.quickChecksBlocked", {
        checks: quickChecksBlockedMatch[1],
      });
    }
    return normalized;
  }

  function renderAnalyzerPattern(raw: string): string {
    const normalized = raw.trim();
    if (!normalized) return t("eval.common.na");
    const match = normalized.match(/^([a-z_]+):([a-z0-9_]+)\s+\((\d+)\)$/i);
    if (!match) return normalized;
    const scope = match[1];
    const errorType = match[2];
    const count = match[3];
    const scopeLabel =
      scope === "trigger"
        ? t("eval.analysis.pattern.trigger")
        : scope === "functional_with_skill"
          ? t("eval.analysis.pattern.functionalWithSkill")
          : scope === "functional_without_skill"
            ? t("eval.analysis.pattern.functionalWithoutSkill")
            : scope;
    const errorLabel =
      errorType === "routing_mismatch"
        ? t("eval.analysis.error.routingMismatch")
        : errorType === "assertion_or_quality_failed"
          ? t("eval.analysis.error.assertionOrQualityFailed")
          : errorType.includes("network")
            ? t("eval.analysis.error.network")
            : errorType.includes("parse") || errorType.includes("json")
              ? t("eval.analysis.error.parse")
              : t("eval.analysis.error.generic", { type: errorType });
    return t("eval.analysis.pattern.localized", {
      scope: scopeLabel,
      error: errorLabel,
      count,
    });
  }

  function renderAnalyzerRecommendation(raw: string): string {
    const normalized = raw.trim();
    if (!normalized) return t("eval.common.na");
    const lower = normalized.toLowerCase();
    if (lower.includes("retry/backoff") || lower.includes("network-induced flakiness")) {
      return t("eval.analysis.recommendation.network");
    }
    if (lower.includes("structured-output parsing") || lower.includes("output-format assertions")) {
      return t("eval.analysis.recommendation.parse");
    }
    if (lower.includes("trigger boundary") || lower.includes("adjacent-skill confusion")) {
      return t("eval.analysis.recommendation.routing");
    }
    if (lower.includes("next-round regression dataset")) {
      return t("eval.analysis.recommendation.regressionSet");
    }
    if (lower.includes("no dominant failure pattern")) {
      return t("eval.analysis.recommendation.noDominant");
    }
    return normalized;
  }

  function renderAnalyzerReason(raw: string): string {
    const normalized = raw.trim();
    if (!normalized) return t("eval.common.na");
    const match = normalized.match(/^([a-z_]+):([a-z0-9_]+)\s+\((\d+)\)$/i);
    if (!match) return t("eval.analysis.reason.generic");
    const errorType = match[2];
    if (errorType === "routing_mismatch") {
      return t("eval.analysis.reason.routingMismatch");
    }
    if (errorType === "assertion_or_quality_failed") {
      return t("eval.analysis.reason.assertionOrQualityFailed");
    }
    if (errorType.includes("network") || errorType.includes("timeout")) {
      return t("eval.analysis.reason.network");
    }
    if (errorType.includes("parse") || errorType.includes("json")) {
      return t("eval.analysis.reason.parse");
    }
    return t("eval.analysis.reason.generic");
  }

  function renderComparatorHighlight(raw: string): string {
    const normalized = raw.trim();
    if (!normalized) return t("eval.common.na");
    const lower = normalized.toLowerCase();
    if (
      lower.includes("improved") &&
      lower.includes("regressed") &&
      lower.includes("unchanged")
    ) {
      return t("eval.analysis.highlight.distribution");
    }
    if (lower.includes("average delta")) {
      return t("eval.analysis.highlight.averageDelta");
    }
    if (lower.includes("with-skill")) {
      return t("eval.analysis.highlight.withSkill");
    }
    if (lower.includes("without-skill") || lower.includes("baseline")) {
      return t("eval.analysis.highlight.withoutSkill");
    }
    return normalized;
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
            <p className="eval-path-hint">{t("eval.quickCheck.legend")}</p>
            <ul>
              {quickChecks.checks.map((item) => (
                <li key={item.key} className={item.passed ? "eval-quick-pass" : "eval-quick-fail"}>
                  <strong title={item.key}>{renderQuickCheckLabel(item.key)}</strong>
                  <small>{renderQuickCheckDescription(item.key)}</small>
                  <span>{renderQuickCheckMessage(item.key, item.message)}</span>
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
                  {t("eval.modules.score")}: {formatPercent(item.score, 2)}
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
        {level === "high_risk" && <p className="eval-advisory-why">{t("eval.advisory.whyHighRisk")}</p>}
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
        <p className="eval-advisory-why">{t("eval.advisory.reasonLabel")}</p>
        <ul className="eval-advisory-reasons">
          {(advisory?.reasons ?? [t("eval.advisory.reason.missing")]).map((reason, index) => (
            <li key={`advisory-reason-${index}`}>{renderAdvisoryReason(reason)}</li>
          ))}
        </ul>
      </article>
    );
  }

  function renderComparatorAnalyzerPanel() {
    if (!report) return null;
    const comparator = report.comparator;
    const analyzer = report.analyzer;
    if (!comparator && !analyzer) return null;
    return (
      <article className="chart-card">
        <h3 className="chart-title">{t("eval.analysis.title")}</h3>
        <div className="eval-history-detail-grid">
          {comparator && (
            <>
              <div>
                <span className="eval-history-item-label">{t("eval.analysis.comparator")}</span>
                <strong>{`${comparator.improvedCases}/${comparator.regressedCases}/${comparator.unchangedCases}`}</strong>
              </div>
              <div>
                <span className="eval-history-item-label">{t("eval.analysis.averageDelta")}</span>
                <strong>{comparator.averageDelta.toFixed(4)}</strong>
              </div>
            </>
          )}
          {analyzer && (
            <div>
              <span className="eval-history-item-label">{t("eval.analysis.analyzer")}</span>
              <strong>
                {analyzer.topFailurePatterns.length > 0
                  ? analyzer.topFailurePatterns.map((item) => renderAnalyzerPattern(item)).join("；")
                  : naLabel}
              </strong>
            </div>
          )}
        </div>
        {comparator?.highlights?.length ? (
          <ul className="eval-advisory-reasons">
            {comparator.highlights.map((item, index) => (
              <li key={`cmp-${index}`}>{renderComparatorHighlight(item)}</li>
            ))}
          </ul>
        ) : null}
        {analyzer?.topFailurePatterns?.length ? (
          <ul className="eval-advisory-reasons">
            {analyzer.topFailurePatterns.map((item, index) => (
              <li key={`anlz-reason-${index}`}>{renderAnalyzerReason(item)}</li>
            ))}
          </ul>
        ) : null}
        {analyzer?.recommendations?.length ? (
          <ul className="eval-advisory-reasons">
            {analyzer.recommendations.map((item, index) => (
              <li key={`anlz-${index}`}>{renderAnalyzerRecommendation(item)}</li>
            ))}
          </ul>
        ) : null}
      </article>
    );
  }

  function renderReviewWorkbench() {
    if (!report) return null;
    const reviewed = Boolean(report.reviewSummary?.reviewed);
    const reviewedVerdict = report.reviewSummary?.finalVerdict || report.finalVerdict || naLabel;
    const failedCaseOptions = report.functional.results?.filter((item) => !item.passed) || [];
    const advisoryLevelLabel =
      report.advisory?.level === "high_risk"
        ? t("eval.advisory.level.highRisk")
        : report.advisory?.level === "warn"
          ? t("eval.advisory.level.warn")
          : report.advisory?.level === "pass"
            ? t("eval.advisory.level.pass")
            : naLabel;
    const riskReasonCount = report.advisory?.reasons?.length ?? 0;
    const evidenceReady = reviewEvidence.trim().length > 0;
    const verdictReady =
      reviewFinalVerdict.trim().length > 0 &&
      (!reviewOverrideGate || reviewOverrideReason.trim().length > 0);
    const selectedCaseLabel = reviewCaseId.trim() || t("eval.review.guideNoCaseSelected");
    const reviewGuideItems = [
      {
        key: "risk",
        done: true,
        title: t("eval.review.guideRiskTitle"),
        detail: t("eval.review.guideRiskDetail", {
          level: advisoryLevelLabel,
          count: riskReasonCount,
        }),
      },
      {
        key: "evidence",
        done: evidenceReady,
        title: t("eval.review.guideEvidenceTitle"),
        detail: reviewCaseId.trim()
          ? t("eval.review.guideEvidenceDetailWithCase", {
              caseId: selectedCaseLabel,
              count: failedCaseOptions.length,
            })
          : t("eval.review.guideEvidenceDetailNoCase", { count: failedCaseOptions.length }),
      },
      {
        key: "verdict",
        done: verdictReady,
        title: t("eval.review.guideVerdictTitle"),
        detail: t("eval.review.guideVerdictDetail"),
      },
    ];
    return (
      <article className="chart-card eval-review-card">
        <div className="eval-advisory-head">
          <h3 className="chart-title">{t("eval.review.title")}</h3>
          <span className={`eval-badge ${reviewed ? "eval-badge-pass" : "eval-badge-fail"}`}>
            {reviewed ? t("eval.review.reviewed") : t("eval.review.pending")}
          </span>
        </div>
        <section className="eval-review-guide" aria-label={t("eval.review.guideTitle")}>
          <h4 className="chart-title">{t("eval.review.guideTitle")}</h4>
          <p className="eval-path-hint">{t("eval.review.guideHint")}</p>
          <ol className="eval-review-guide-list">
            {reviewGuideItems.map((item) => (
              <li key={item.key} className="eval-review-guide-item">
                <div className="eval-review-guide-copy">
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </div>
                <span className={`eval-badge ${item.done ? "eval-badge-pass" : "eval-badge-fail"}`}>
                  {item.done ? t("eval.review.guideDone") : t("eval.review.guideTodo")}
                </span>
              </li>
            ))}
          </ol>
        </section>
        <div className="eval-history-detail-grid">
          <div>
            <span className="eval-history-item-label">{t("eval.review.currentVerdict")}</span>
            <strong>{reviewedVerdict}</strong>
          </div>
          <div>
            <span className="eval-history-item-label">{t("eval.review.reviewer")}</span>
            <strong>{report.reviewSummary?.reviewer || report.overrideBy || naLabel}</strong>
          </div>
          <div>
            <span className="eval-history-item-label">{t("eval.review.overrideReason")}</span>
            <strong>{report.overrideReason || naLabel}</strong>
          </div>
          <div>
            <span className="eval-history-item-label">{t("eval.review.decidedAt")}</span>
            <strong>
              {typeof report.overrideAt === "number"
                ? formatBeijingDateTime(new Date(report.overrideAt * 1000), locale)
                : naLabel}
            </strong>
          </div>
        </div>
        <div className="eval-draft-actions">
          <select
            className="filter-select"
            value={reviewCaseId}
            onChange={(event) => setReviewCaseId(event.target.value)}
          >
            <option value="">{t("eval.review.caseSelect")}</option>
            {failedCaseOptions.map((item) => (
              <option key={item.caseId} value={item.caseId}>
                {item.caseId}
              </option>
            ))}
          </select>
          <button
            className="btn btn-ghost"
            onClick={() => void handlePreviewEvidenceCase()}
            disabled={reviewEvidenceLoading || !reviewCaseId.trim()}
          >
            {reviewEvidenceLoading ? t("eval.review.loadingEvidence") : t("eval.review.previewEvidence")}
          </button>
        </div>
        {reviewEvidence.trim() && (
          <pre className="eval-draft-textarea" style={{ whiteSpace: "pre-wrap" }}>{reviewEvidence}</pre>
        )}
        <div className="eval-draft-grid">
          <div className="field">
            <label className="field-label">{t("eval.review.finalVerdict")}</label>
            <select
              className="filter-select"
              value={reviewFinalVerdict}
              onChange={(event) => setReviewFinalVerdict(event.target.value)}
            >
              <option value="pass">pass</option>
              <option value="fail">fail</option>
              <option value="warn">warn</option>
              <option value="blocked">blocked</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">{t("eval.review.reviewer")}</label>
            <input
              className="field-input"
              value={reviewReviewer}
              onChange={(event) => setReviewReviewer(event.target.value)}
              placeholder={t("eval.review.reviewerPlaceholder")}
            />
          </div>
          <div className="field eval-field-wide">
            <label className="field-label">
              <input
                type="checkbox"
                checked={reviewOverrideGate}
                onChange={(event) => setReviewOverrideGate(event.target.checked)}
              />{" "}
              {t("eval.review.overrideGate")}
            </label>
            <textarea
              className="eval-draft-textarea"
              value={reviewOverrideReason}
              onChange={(event) => setReviewOverrideReason(event.target.value)}
              placeholder={t("eval.review.overrideReason")}
            />
          </div>
          <div className="field eval-field-wide">
            <label className="field-label">{t("eval.review.notes")}</label>
            <textarea
              className="eval-draft-textarea"
              value={reviewNotes}
              onChange={(event) => setReviewNotes(event.target.value)}
            />
          </div>
        </div>
        <div className="eval-draft-actions">
          <button className="btn btn-ghost" onClick={() => void handleSubmitReview()} disabled={reviewSubmitting}>
            {reviewSubmitting ? t("eval.review.submitting") : t("eval.review.submit")}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => void handleGenerateFeedbackDrafts()}
            disabled={feedbackDrafting}
          >
            {feedbackDrafting
              ? t("eval.review.generatingFeedback")
              : t("eval.review.generateFeedbackDrafts")}
          </button>
        </div>
      </article>
    );
  }

  function renderTriggerChart(
    triggerReport: EvalPipelineOutput["triggerClean"] | undefined,
    title: string,
    panelKey: TriggerPanelKey,
  ) {
    const results = triggerReport?.results;
    if (!results || results.length === 0) return null;

    const panel = triggerPanels[panelKey];
    const anchorRef = panelKey === "clean" ? cleanTableAnchorRef : complexTableAnchorRef;
    const filtered = results.filter((item) => {
      if (panel.filter === "fail") return !item.pass;
      if (panel.filter === "pass") return item.pass;
      return true;
    });
    const total = results.length;
    const failed = results.filter((item) => !item.pass).length;
    const passRateRatio = total > 0 ? (total - failed) / total : 0;
    const passRateValue = formatPercentValue(passRateRatio, 2);
    const totalPages = Math.max(1, Math.ceil(filtered.length / panel.pageSize));
    const safePage = clampPage(panel.page, totalPages);
    const startIndex = (safePage - 1) * panel.pageSize;
    const pageRows = filtered.slice(startIndex, startIndex + panel.pageSize);

    return (
      <article className="chart-card eval-result-card">
        <div className="eval-result-card-head">
          <h3 className="chart-title">{title}</h3>
          <div className="eval-result-card-head-actions">
            <strong className="eval-result-card-summary">
              {t("eval.chart.summaryPassRate", { value: passRateValue })}
            </strong>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                updateTriggerPanel(panelKey, (current) => ({
                  ...current,
                  chartExpanded: !current.chartExpanded,
                }))
              }
            >
              {panel.chartExpanded ? t("eval.chart.collapse") : t("eval.chart.expand")}
            </button>
          </div>
        </div>

        <div className={`eval-chart-shell ${panel.chartExpanded ? "is-open" : ""}`}>
          <div className="eval-chart-shell-inner">
            {panel.chartExpanded && (
              <EvalChartErrorBoundary
                resetKey={`${panelKey}-${chartThemeName}-${results.length}`}
                fallback={<p className="eval-path-hint">{t("eval.chart.failedFallback")}</p>}
              >
                <DeferredEChart
                  variant="eval"
                  className="eval-chart"
                  placeholderHeight={220}
                  theme={chartThemeName}
                  option={{
                    animationDuration: 120,
                    animationDurationUpdate: 120,
                    tooltip: {
                      trigger: "axis",
                      formatter: (payload: unknown) => {
                        const entries = Array.isArray(payload) ? payload : [payload];
                        const first = entries[0] as { dataIndex?: number } | undefined;
                        const index = Number(first?.dataIndex ?? 0);
                        const item = results[index];
                        const qLabel = `Q${index + 1}`;
                        if (!item) return qLabel;
                        return [
                          qLabel,
                          truncatePreview(item.query, 90),
                          `${t("eval.trigger.expected")}: ${
                            item.shouldTrigger ? t("eval.option.yes") : t("eval.option.no")
                          }`,
                          `${t("eval.trigger.actual")}: ${
                            item.triggered ? t("eval.option.yes") : t("eval.option.no")
                          }`,
                        ].join("<br/>");
                      },
                    },
                    xAxis: {
                      type: "category",
                      data: results.map((_, index) => `Q${index + 1}`),
                      axisLabel: { rotate: 0 },
                    },
                    yAxis: {
                      type: "value",
                      min: 0,
                      max: 100,
                      axisLabel: { formatter: "{value}%" },
                    },
                    series: [
                      {
                        name: t("eval.trigger.expected"),
                        type: "bar",
                        data: results.map((item) => (item.shouldTrigger ? 100 : 0)),
                        itemStyle: { color: "var(--text-secondary)" },
                        barMaxWidth: 24,
                      },
                      {
                        name: t("eval.trigger.actual"),
                        type: "bar",
                        data: results.map((item) => (item.triggered ? 100 : 0)),
                        itemStyle: { color: "var(--accent)" },
                        barMaxWidth: 24,
                      },
                    ],
                    legend: {
                      data: [t("eval.trigger.expected"), t("eval.trigger.actual")],
                      top: 0,
                      right: 0,
                    },
                    grid: { left: 56, right: 24, top: 46, bottom: 34 },
                  }}
                />
              </EvalChartErrorBoundary>
            )}
          </div>
        </div>

        <div ref={anchorRef} />
        <button
          type="button"
          className="eval-results-summary-row"
          onClick={() =>
            updateTriggerPanel(panelKey, (current) => ({
              ...current,
              tableExpanded: !current.tableExpanded,
            }))
          }
        >
          <span>{t("eval.table.summary.total", { value: total })}</span>
          <span className="eval-results-summary-fail">{t("eval.table.summary.failed", { value: failed })}</span>
          <span>{t("eval.table.summary.passRate", { value: passRateValue })}</span>
          <span className={`eval-results-summary-arrow ${panel.tableExpanded ? "is-open" : ""}`}>▾</span>
        </button>

        <div className={`eval-results-table-shell ${panel.tableExpanded ? "is-open" : ""}`}>
          <div className="eval-results-table-shell-inner">
            <div className="eval-results-table-topbar">
              <div className="eval-result-filter-pills">
                {(["all", "fail", "pass"] as ResultFilter[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`eval-result-filter-pill ${panel.filter === key ? "is-active" : ""}`}
                    onClick={() =>
                      updateTriggerPanel(panelKey, (current) => ({
                        ...current,
                        filter: key,
                        page: 1,
                      }))
                    }
                  >
                    {t(`eval.table.filter.${key}` as Parameters<typeof t>[0])}
                  </button>
                ))}
              </div>
              <div className="eval-result-pagination">
                <span className="eval-result-page-range">
                  {t("eval.table.pageRange", {
                    start: filtered.length === 0 ? 0 : startIndex + 1,
                    end: filtered.length === 0 ? 0 : Math.min(startIndex + panel.pageSize, filtered.length),
                    total: filtered.length,
                  })}
                </span>
                <label className="eval-result-page-size">
                  <span>{t("eval.table.pageSize")}</span>
                  <select
                    className="filter-select"
                    value={panel.pageSize}
                    onChange={(event) =>
                      updateTriggerPanel(panelKey, (current) => ({
                        ...current,
                        page: 1,
                        pageSize: Number(event.target.value) as 20 | 50 | 100,
                      }))
                    }
                  >
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    updateTriggerPanel(panelKey, (current) => ({ ...current, page: clampPage(current.page - 1, totalPages) }));
                    scrollTableAnchor(anchorRef);
                  }}
                  disabled={safePage <= 1 || filtered.length === 0}
                >
                  {t("eval.table.prev")}
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    updateTriggerPanel(panelKey, (current) => ({ ...current, page: clampPage(current.page + 1, totalPages) }));
                    scrollTableAnchor(anchorRef);
                  }}
                  disabled={safePage >= totalPages || filtered.length === 0}
                >
                  {t("eval.table.next")}
                </button>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="eval-results-empty-state">
                <p className="eval-path-hint">{t("eval.table.emptyFiltered")}</p>
                {panel.filter !== "all" && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      updateTriggerPanel(panelKey, (current) => ({
                        ...current,
                        filter: "all",
                        page: 1,
                      }))
                    }
                  >
                    {t("eval.table.clearFilter")}
                  </button>
                )}
              </div>
            ) : (
              <>
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
                      {pageRows.map((item, index) => (
                        <tr key={`${item.query}-${index}`} className={item.pass ? "" : "eval-row-fail"}>
                          <td className="eval-query-cell eval-query-cell-two-line" title={item.query}>{item.query}</td>
                          <td>{item.shouldTrigger ? t("eval.option.yes") : t("eval.option.no")}</td>
                          <td>{item.triggered ? t("eval.option.yes") : t("eval.option.no")}</td>
                          <td>{item.triggeredSkillName ?? naLabel}</td>
                          <td className="eval-evidence-cell">
                            <span>
                              {(typeof item.latencyMs === "number" ? `${item.latencyMs}ms` : naLabel)} /{" "}
                              {formatTokenPair(item.inputTokens, item.outputTokens)} {t("eval.table.tokenPairSuffix")}
                            </span>
                            <button
                              type="button"
                              className="eval-evidence-path-btn"
                              title={item.rawResponsePath ?? undefined}
                              onClick={() => void handleCopyPath(item.rawResponsePath)}
                            >
                              {item.rawResponsePath ? compactPath(item.rawResponsePath) : naLabel}
                            </button>
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
                <div className="eval-results-table-bottombar">
                  <div className="eval-result-pagination">
                    <span className="eval-result-page-range">
                      {t("eval.table.pageRange", {
                        start: filtered.length === 0 ? 0 : startIndex + 1,
                        end: filtered.length === 0 ? 0 : Math.min(startIndex + panel.pageSize, filtered.length),
                        total: filtered.length,
                      })}
                    </span>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => {
                        updateTriggerPanel(panelKey, (current) => ({ ...current, page: clampPage(current.page - 1, totalPages) }));
                        scrollTableAnchor(anchorRef);
                      }}
                      disabled={safePage <= 1}
                    >
                      {t("eval.table.prev")}
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => {
                        updateTriggerPanel(panelKey, (current) => ({ ...current, page: clampPage(current.page + 1, totalPages) }));
                        scrollTableAnchor(anchorRef);
                      }}
                      disabled={safePage >= totalPages}
                    >
                      {t("eval.table.next")}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </article>
    );
  }

  function renderFunctionalChart() {
    if (report?.mode === "quick") return null;
    const results = report?.functional?.results;
    if (!results || results.length === 0) return null;

    const panel = functionalPanel;
    const filtered = results.filter((item) => {
      if (panel.filter === "fail") return !item.passed;
      if (panel.filter === "pass") return item.passed;
      return true;
    });
    const total = results.length;
    const failed = results.filter((item) => !item.passed).length;
    const passRateRatio = total > 0 ? (total - failed) / total : 0;
    const passRateValue = formatPercentValue(passRateRatio, 2);
    const totalPages = Math.max(1, Math.ceil(filtered.length / panel.pageSize));
    const safePage = clampPage(panel.page, totalPages);
    const startIndex = (safePage - 1) * panel.pageSize;
    const pageRows = filtered.slice(startIndex, startIndex + panel.pageSize);

    return (
      <article className="chart-card eval-result-card">
        <div className="eval-result-card-head">
          <h3 className="chart-title">{t("eval.functional.title")}</h3>
          <div className="eval-result-card-head-actions">
            <strong className="eval-result-card-summary">
              {t("eval.chart.summaryPassRate", { value: passRateValue })}
            </strong>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                updateFunctionalPanel((current) => ({
                  ...current,
                  chartExpanded: !current.chartExpanded,
                }))
              }
            >
              {panel.chartExpanded ? t("eval.chart.collapse") : t("eval.chart.expand")}
            </button>
          </div>
        </div>

        <div className={`eval-chart-shell ${panel.chartExpanded ? "is-open" : ""}`}>
          <div className="eval-chart-shell-inner">
            {panel.chartExpanded && (
              <EvalChartErrorBoundary
                resetKey={`functional-${chartThemeName}-${results.length}`}
                fallback={<p className="eval-path-hint">{t("eval.chart.failedFallback")}</p>}
              >
                <DeferredEChart
                  variant="eval"
                  className="eval-chart"
                  placeholderHeight={220}
                  theme={chartThemeName}
                  option={{
                    animationDuration: 120,
                    animationDurationUpdate: 120,
                    tooltip: {
                      trigger: "axis",
                      formatter: (payload: unknown) => {
                        const entries = Array.isArray(payload) ? payload : [payload];
                        const first = entries[0] as { dataIndex?: number } | undefined;
                        const index = Number(first?.dataIndex ?? 0);
                        const item = results[index];
                        if (!item) return t("eval.functional.passRate");
                        return `${item.caseId}<br/>${t("eval.functional.passRate")}: ${formatPercent(
                          item.passRate,
                          2,
                        )}`;
                      },
                    },
                    xAxis: {
                      type: "category",
                      data: results.map((item) => item.caseId),
                      axisLabel: {
                        formatter: (value: string) => truncatePreview(String(value), 12),
                        hideOverlap: true,
                      },
                    },
                    yAxis: {
                      type: "value",
                      min: 0,
                      max: 100,
                      axisLabel: { formatter: "{value}%" },
                    },
                    series: [
                      {
                        name: t("eval.functional.passRate"),
                        type: "bar",
                        data: results.map((item) => Number(formatPercentValue(item.passRate, 2))),
                        itemStyle: {
                          color: (params: { dataIndex: number }) =>
                            results[params.dataIndex].passed ? "var(--success)" : "var(--danger)",
                        },
                        barMaxWidth: 24,
                      },
                    ],
                    grid: { left: 56, right: 24, top: 46, bottom: 34 },
                  }}
                />
              </EvalChartErrorBoundary>
            )}
          </div>
        </div>

        <div ref={functionalTableAnchorRef} />
        <button
          type="button"
          className="eval-results-summary-row"
          onClick={() =>
            updateFunctionalPanel((current) => ({
              ...current,
              tableExpanded: !current.tableExpanded,
            }))
          }
        >
          <span>{t("eval.table.summary.total", { value: total })}</span>
          <span className="eval-results-summary-fail">{t("eval.table.summary.failed", { value: failed })}</span>
          <span>{t("eval.table.summary.passRate", { value: passRateValue })}</span>
          <span className={`eval-results-summary-arrow ${panel.tableExpanded ? "is-open" : ""}`}>▾</span>
        </button>

        <div className={`eval-results-table-shell ${panel.tableExpanded ? "is-open" : ""}`}>
          <div className="eval-results-table-shell-inner">
            <div className="eval-results-table-topbar">
              <div className="eval-result-filter-pills">
                {(["all", "fail", "pass"] as ResultFilter[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`eval-result-filter-pill ${panel.filter === key ? "is-active" : ""}`}
                    onClick={() =>
                      updateFunctionalPanel((current) => ({
                        ...current,
                        filter: key,
                        page: 1,
                      }))
                    }
                  >
                    {t(`eval.table.filter.${key}` as Parameters<typeof t>[0])}
                  </button>
                ))}
              </div>
              <div className="eval-result-pagination">
                <span className="eval-result-page-range">
                  {t("eval.table.pageRange", {
                    start: filtered.length === 0 ? 0 : startIndex + 1,
                    end: filtered.length === 0 ? 0 : Math.min(startIndex + panel.pageSize, filtered.length),
                    total: filtered.length,
                  })}
                </span>
                <label className="eval-result-page-size">
                  <span>{t("eval.table.pageSize")}</span>
                  <select
                    className="filter-select"
                    value={panel.pageSize}
                    onChange={(event) =>
                      updateFunctionalPanel((current) => ({
                        ...current,
                        page: 1,
                        pageSize: Number(event.target.value) as 20 | 50 | 100,
                      }))
                    }
                  >
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    updateFunctionalPanel((current) => ({ ...current, page: clampPage(current.page - 1, totalPages) }));
                    scrollTableAnchor(functionalTableAnchorRef);
                  }}
                  disabled={safePage <= 1 || filtered.length === 0}
                >
                  {t("eval.table.prev")}
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    updateFunctionalPanel((current) => ({ ...current, page: clampPage(current.page + 1, totalPages) }));
                    scrollTableAnchor(functionalTableAnchorRef);
                  }}
                  disabled={safePage >= totalPages || filtered.length === 0}
                >
                  {t("eval.table.next")}
                </button>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="eval-results-empty-state">
                <p className="eval-path-hint">{t("eval.table.emptyFiltered")}</p>
                {panel.filter !== "all" && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      updateFunctionalPanel((current) => ({
                        ...current,
                        filter: "all",
                        page: 1,
                      }))
                    }
                  >
                    {t("eval.table.clearFilter")}
                  </button>
                )}
              </div>
            ) : (
              <>
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
                      {pageRows.map((item) => (
                        <tr key={item.caseId} className={item.passed ? "" : "eval-row-fail"}>
                          <td title={item.caseId}>{truncatePreview(item.caseId, 32)}</td>
                          <td>{formatPercent(item.passRate, 2)}</td>
                          <td>{typeof item.qualityScore === "number" ? formatPercent(item.qualityScore, 2) : naLabel}</td>
                          <td className="eval-query-cell eval-query-cell-two-line" title={item.judgeRationale || naLabel}>
                            {item.judgeRationale || naLabel}
                          </td>
                          <td className="eval-query-cell eval-query-cell-two-line" title={item.judgeSuggestions?.join("; ") || naLabel}>
                            {item.judgeSuggestions && item.judgeSuggestions.length > 0
                              ? item.judgeSuggestions.join("; ")
                              : naLabel}
                          </td>
                          <td className="eval-evidence-cell">
                            <span>
                              {(typeof item.latencyMs === "number" ? `${item.latencyMs}ms` : naLabel)} /{" "}
                              {formatTokenPair(item.inputTokens, item.outputTokens)} {t("eval.table.tokenPairSuffix")}
                            </span>
                            <button
                              type="button"
                              className="eval-evidence-path-btn"
                              title={item.rawResponsePath ?? undefined}
                              onClick={() => void handleCopyPath(item.rawResponsePath)}
                            >
                              {item.rawResponsePath ? compactPath(item.rawResponsePath) : naLabel}
                            </button>
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
                <div className="eval-results-table-bottombar">
                  <div className="eval-result-pagination">
                    <span className="eval-result-page-range">
                      {t("eval.table.pageRange", {
                        start: filtered.length === 0 ? 0 : startIndex + 1,
                        end: filtered.length === 0 ? 0 : Math.min(startIndex + panel.pageSize, filtered.length),
                        total: filtered.length,
                      })}
                    </span>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => {
                        updateFunctionalPanel((current) => ({ ...current, page: clampPage(current.page - 1, totalPages) }));
                        scrollTableAnchor(functionalTableAnchorRef);
                      }}
                      disabled={safePage <= 1}
                    >
                      {t("eval.table.prev")}
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => {
                        updateFunctionalPanel((current) => ({ ...current, page: clampPage(current.page + 1, totalPages) }));
                        scrollTableAnchor(functionalTableAnchorRef);
                      }}
                      disabled={safePage >= totalPages}
                    >
                      {t("eval.table.next")}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </article>
    );
  }

  const elapsedSeconds = Math.floor(progressElapsedMs / 1000);
  const parsedRepeats = Number.parseInt(repeatsInput, 10);
  const configuredRepeats = Number.isFinite(parsedRepeats) && parsedRepeats > 0 ? parsedRepeats : 1;
  const totalSteps = Math.max(progressEvent?.totalSteps ?? 1, 1);
  const currentStep = Math.min(progressEvent?.stepIndex ?? 0, totalSteps);
  const isRunningProgress = progressEvent?.status === "running";
  const isCompletedProgress = progressEvent?.status === "completed";
  const isTerminalProgress =
    progressEvent?.status === "completed" ||
    progressEvent?.status === "cancelled" ||
    progressEvent?.status === "error";
  const runningStepInFlight =
    isRunningProgress && progressEvent?.stepName !== "repeat_complete" && progressEvent?.stepName !== "pipeline";
  const completedSteps = isRunningProgress
    ? runningStepInFlight
      ? Math.max(currentStep - 1, 0)
      : currentStep
      : currentStep;
  const inFlightFraction = runningStepInFlight ? 0.5 : 0;
  const runningProgressPercentRaw = Math.round(((completedSteps + inFlightFraction) / totalSteps) * 100);
  const stageProgressPercent = Math.round(
    Math.max(0, Math.min(100, progressEvent?.stageProgressPercent ?? runningProgressPercentRaw)),
  );
  const totalProgressPercentRaw = Math.round(
    Math.max(0, Math.min(100, progressEvent?.totalProgressPercent ?? runningProgressPercentRaw)),
  );
  const progressPercent = isCompletedProgress
    ? 100
    : running
      ? Math.min(99, Math.max(0, totalProgressPercentRaw))
      : report
        ? 100
        : 0;
  const stageCompletedCount = Math.max(0, progressEvent?.completedCount ?? 0);
  const stageActiveCount = Math.max(0, progressEvent?.activeCount ?? (running ? 1 : 0));
  const stageFailedCount = Math.max(0, progressEvent?.failedCount ?? 0);
  const stageTotalCount = Math.max(progressEvent?.totalCount ?? 0, stageCompletedCount + stageActiveCount);
  const remainingSeconds = progressEvent?.remainingSeconds;
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
  const hasSampleModel = sampleModel.trim().length > 0;
  const hasRunModel = model.trim().length > 0;
  const hasTriggerDataset = triggerSetPath.trim().length > 0;
  const hasFunctionalDataset = !requiresFunctionalByModules || functionalSetPath.trim().length > 0;
  const repeatsValid = Number.isFinite(parsedRepeats) && parsedRepeats >= 1;
  const budgetValue = maxCostUsdInput.trim() ? Number(maxCostUsdInput.trim()) : undefined;
  const budgetValid =
    budgetValue === undefined || (Number.isFinite(budgetValue) && budgetValue > 0);
  const setupReady = hasSelectedSkill;
  const datasetReady = hasTriggerDataset;
  const runConfigReady = hasRunModel && repeatsValid && budgetValid;
  const readyToRun = setupReady && datasetReady && runConfigReady && hasFunctionalDataset;
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
    : !hasTriggerDataset
        ? t("eval.error.datasetRequired", { type: t("eval.dataset.trigger") })
        : !hasRunModel
          ? t("eval.error.modelRequired")
          : !repeatsValid
        ? t("eval.error.repeatsInvalid")
        : !budgetValid
          ? t("eval.error.maxCostInvalid")
            : !hasFunctionalDataset
            ? t("eval.error.datasetRequired", { type: t("eval.dataset.functional") })
              : "";
  const flowCompletedCount = [setupReady, datasetReady, report !== null].filter(Boolean).length;
  const step1Status = resolveFlowStatus(1, activeStep, setupReady);
  const step2Status = resolveFlowStatus(2, activeStep, datasetReady);
  const step3Status = resolveFlowStatus(3, activeStep, report !== null);
  const generationEstimate = useMemo(
    () =>
      estimateSampleGenerationSeconds(
        sampleModel,
        DEFAULT_TRIGGER_SAMPLE_COUNT,
        FUNCTIONAL_MIN_SAMPLES,
        sampleTimingHistory,
      ),
    [sampleModel, sampleTimingHistory],
  );
  const sampleTimingHistoryForSkill = useMemo(
    () =>
      sampleTimingHistory
        .filter((item) => !selectedSkill.trim() || item.skillName === selectedSkill.trim())
        .slice(0, 4),
    [sampleTimingHistory, selectedSkill],
  );
  const flowNextMessage = readyToRun
    ? t("eval.flow.ready")
    : t("eval.flow.next", { reason: runBlockedReason || t("eval.flow.stageHint.step3") });
  const runPrimaryLabel = running ? t("eval.running") : t("eval.run");
  const naLabel = t("eval.common.na");
  const showSetupView = view === "setup";
  const showRunningView = view === "running";
  const showReviewView = view === "review";
  const showResultView = view === "result";
  const showFixedRunDock = showSetupView;
  const runtimeStageDefs = useMemo(
    () => {
      const stages = [
        {
          key: "prepare",
          title: t("eval.running.stage.prepare"),
          desc: t("eval.running.stage.prepareDesc"),
        },
        {
          key: "trigger_clean",
          title: t("eval.running.stage.triggerClean"),
          desc: t("eval.running.stage.triggerCleanDesc"),
        },
      ];
      if (runSnapshot?.mode !== "quick") {
        stages.push({
          key: "parallel_arms",
          title: t("eval.running.stage.parallelArms"),
          desc: t("eval.running.stage.parallelArmsDesc"),
        });
      }
      stages.push({
        key: "finalize",
        title: t("eval.running.stage.finalize"),
        desc: t("eval.running.stage.finalizeDesc"),
      });
      if (runSnapshot?.mode === "full") {
        stages.push({
          key: "review_queue",
          title: t("eval.running.stage.reviewQueue"),
          desc: t("eval.running.stage.reviewQueueDesc"),
        });
      }
      return stages;
    },
    [runSnapshot?.mode, t],
  );
  const activeRuntimeStageKey =
    progressEvent?.stageKey?.trim() ||
    (runtimeStageDefs.length > 0 ? runtimeStageDefs[0].key : "prepare");
  const activeRuntimeStageIndex = Math.max(
    0,
    runtimeStageDefs.findIndex((item) => item.key === activeRuntimeStageKey),
  );
  const runtimeStageStatuses: EvalFlowStatus[] = runtimeStageDefs.map((_, index) => {
    if (isCompletedProgress) {
      return "done";
    }
    if (activeRuntimeStageIndex < 0) {
      return index === 0 ? "active" : "pending";
    }
    if (index < activeRuntimeStageIndex) {
      return "done";
    }
    if (index === activeRuntimeStageIndex) {
      return isTerminalProgress ? "done" : "active";
    }
    return "pending";
  });
  const activeRuntimeStage = runtimeStageDefs[activeRuntimeStageIndex] || runtimeStageDefs[0];
  const runSnapshotModeLabel =
    runSnapshot?.mode === "quick" ? t("eval.config.mode.quick") : t("eval.config.mode.full");
  const runSnapshotModulesLabel =
    runSnapshot?.mode === "quick"
      ? t("eval.running.dimensions.quick")
      : runSnapshot?.selectedModules && runSnapshot.selectedModules.length > 0
        ? runSnapshot.selectedModules
            .map(
              (key) =>
                t(
                  (EVAL_MODULE_OPTIONS.find((option) => option.key === key)?.labelKey ??
                    "eval.common.na") as Parameters<typeof t>[0],
                ),
            )
            .join(" / ")
        : t("eval.common.na");
  const runParallelArms = progressEvent?.maxParallelArms ?? runSnapshot?.maxParallelArms ?? 0;
  const runTriggerWorkers = progressEvent?.triggerMaxWorkers ?? runSnapshot?.triggerMaxWorkers ?? 0;
  const runFunctionalWorkers =
    progressEvent?.functionalMaxWorkers ?? runSnapshot?.functionalMaxWorkers ?? 0;
  const stageCountersLabel =
    stageTotalCount > 0
      ? t("eval.running.stageCounters", {
          completed: stageCompletedCount,
          total: stageTotalCount,
          active: stageActiveCount,
          failed: stageFailedCount,
        })
      : t("eval.common.na");

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
    const dockEl = runDockRef.current;
    if (!dockEl) return;

    const updateOffsets = () => {
      const nextDockOffset = Math.max(220, Math.ceil(dockEl.getBoundingClientRect().height) + 24);
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
    observer.observe(dockEl);
    return () => {
      window.removeEventListener("resize", updateOffsets);
      observer.disconnect();
    };
  }, [activeStep, progressDetail, running, status, t]);

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
      setReport(null);
      setRunSnapshot(null);
      setShowSamples(false);
      setShowHistory(false);
      setPreflightEstimate(null);
      setPreflightEstimateError("");
      setView("setup");
    }
    setSelectedSkill(nextSkill);
    if (!nextSkill.trim()) {
      setStepOverride(1);
      return;
    }
    setStepOverride(2);
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

  function resolveHistoryReviewMeta(entry: EvalHistoryEntry): { label: string; tone: HistoryReviewTone } {
    if (!entry.reviewSummary?.reviewed) {
      return { label: t("eval.history.review.pending"), tone: "pending" };
    }
    const verdict = (entry.reviewSummary.finalVerdict || "").trim().toLowerCase();
    if (verdict.includes("pass")) {
      return { label: t("eval.history.review.pass"), tone: "pass" };
    }
    return { label: t("eval.history.review.warn"), tone: "warn" };
  }

  const pageStyle = useMemo<CSSProperties>(
    () =>
      ({
        "--eval-run-dock-offset": showFixedRunDock ? `${runDockOffsetPx}px` : "0px",
      }) as CSSProperties,
    [runDockOffsetPx, showFixedRunDock],
  );

  return (
    <div className="page animate-fadein eval-page" style={pageStyle}>
      <header className="page-header eval-page-header page-header-grid">
        <div className="eval-page-header-main page-header-copy">
          <h1 className="page-title eval-page-title">
            <span>{t("eval.title")}</span>
            <span className="eval-beta-badge">BETA</span>
          </h1>
          <p className="eval-page-header-hint">{flowNextMessage}</p>
        </div>
        <div className="eval-page-header-actions page-header-actions-grid">
          <div className="eval-page-header-actions-row page-header-actions-row">
            {showSetupView ? (
              <button
                className="btn btn-primary eval-page-run-btn"
                onClick={() => void handleRunEval()}
                disabled={running || generating || !readyToRun}
                title={!readyToRun ? runBlockedReason : undefined}
              >
                {runPrimaryLabel}
              </button>
            ) : (
              <button
                className="btn btn-ghost eval-page-run-btn"
                onClick={() => {
                  setView("setup");
                  setReport(null);
                  setRunSnapshot(null);
                  setStatus("");
                }}
                disabled={running}
              >
                {t("eval.running.backToSetup")}
              </button>
            )}
          </div>
        </div>
      </header>

      {showSetupView && (
        <article className="chart-card eval-config-card">
        <h3 className="chart-title">{t("eval.config.title")}</h3>
        <p className="eval-advisory-note">{t("eval.notice.nonBlocking")}</p>
        <div className="eval-flow-sticky">
          <div className="eval-flow-head">
            <span className="eval-flow-complete">
              {t("eval.flow.completed", { done: flowCompletedCount, total: 3 })}
            </span>
          </div>
          <section className="eval-flow-guide" aria-label={t("eval.flow.aria")}>
            <div className={`eval-flow-step is-${step1Status}`} aria-current={activeStep === 1 ? "step" : undefined}>
              <span className="eval-flow-index">1</span>
              <div>
                <strong>{t("eval.flow.step1.title")}</strong>
                <small>{t("eval.flow.step1.desc")}</small>
              </div>
              <span className={`eval-flow-state eval-flow-state-${step1Status}`}>
                {t(`eval.flow.state.${step1Status}` as Parameters<typeof t>[0])}
              </span>
            </div>
            <div className={`eval-flow-step is-${step2Status}`} aria-current={activeStep === 2 ? "step" : undefined}>
              <span className="eval-flow-index">2</span>
              <div>
                <strong>{t("eval.flow.step2.title")}</strong>
                <small>{t("eval.flow.step2.desc")}</small>
              </div>
              <span className={`eval-flow-state eval-flow-state-${step2Status}`}>
                {t(`eval.flow.state.${step2Status}` as Parameters<typeof t>[0])}
              </span>
            </div>
            <div className={`eval-flow-step is-${step3Status}`} aria-current={activeStep === 3 ? "step" : undefined}>
              <span className="eval-flow-index">3</span>
              <div>
                <strong>{t("eval.flow.step3.title")}</strong>
                <small>{t("eval.flow.step3.desc")}</small>
              </div>
              <span className={`eval-flow-state eval-flow-state-${step3Status}`}>
                {t(`eval.flow.state.${step3Status}` as Parameters<typeof t>[0])}
              </span>
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
            </>
          )}

          {activeStep === 2 && (
            <>
              <p className="eval-config-group-title">{t("eval.flow.group.step2")}</p>
              <div className="field eval-field-wide">
                <label className="field-label">{t("eval.config.generationModel")}</label>
                <input
                  className="field-input"
                  value={sampleModel}
                  onChange={(e) => setSampleModel(e.target.value)}
                  placeholder={t("eval.config.model.placeholder")}
                  list={EVAL_MODEL_DATALIST_ID}
                />
                {sampleModelGroupHint ? (
                  <p className="eval-path-hint">
                    {t("eval.config.modelGroupSource", { group: sampleModelGroupHint })}
                  </p>
                ) : sampleModel.trim() ? (
                  <p className="eval-path-hint">{t("eval.config.modelGroupMissing")}</p>
                ) : null}
                {sampleModelGroupOptions.length > 1 && (
                  <>
                    <label className="field-label">{t("eval.config.generationModelGroup")}</label>
                    <select
                      className="filter-select"
                      value={sampleModelGroupId}
                      onChange={(event) => setSampleModelGroupId(event.target.value)}
                      disabled={running || generating}
                    >
                      <option value="">{t("eval.config.modelGroupSelect.auto")}</option>
                      {sampleModelGroupOptions.map((group) => (
                        <option key={`sample-group-${group.id}`} value={group.id}>
                          {resolveModelGroupName(group)}
                        </option>
                      ))}
                    </select>
                    <p className="eval-path-hint">{t("eval.config.modelGroupAmbiguous")}</p>
                  </>
                )}
              </div>

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

              <section className="eval-sample-eta-card eval-field-wide">
                <div className="eval-sample-eta-head">
                  <h4 className="chart-title">{t("eval.samples.eta.title")}</h4>
                  <strong>{formatDurationLabel(generationEstimate.seconds)}</strong>
                </div>
                <p className="eval-path-hint">
                  {t("eval.samples.eta.meta", {
                    model: sampleModel.trim() || naLabel,
                    history: generationEstimate.historyMatches,
                    last:
                      typeof generationEstimate.lastSeconds === "number"
                        ? generationEstimate.lastSeconds
                        : naLabel,
                  })}
                </p>
                <div className="eval-sample-eta-history">
                  <span className="eval-history-item-label">{t("eval.samples.history.title")}</span>
                  {sampleTimingHistoryForSkill.length === 0 ? (
                    <p className="eval-path-hint">{t("eval.samples.history.empty")}</p>
                  ) : (
                    <ul>
                      {sampleTimingHistoryForSkill.map((item) => (
                        <li key={`sample-history-${item.recordedAtUnix}-${item.model}`}>
                          {t("eval.samples.history.item", {
                            model: item.model,
                            seconds: item.elapsedSeconds,
                            trigger: item.triggerCount,
                            functional: item.functionalCount,
                          })}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              <div className="eval-dataset-actions">
                <button
                  className="btn btn-ghost eval-action-btn"
                  onClick={() => void handleGenerateSamples()}
                  disabled={running || generating || !hasSelectedSkill || !hasSampleModel}
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
                <label className="field-label">{t("eval.config.runModel")}</label>
                <input
                  className="field-input"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={t("eval.config.model.placeholder")}
                  list={EVAL_MODEL_DATALIST_ID}
                />
                {runModelGroupHint ? (
                  <p className="eval-path-hint">
                    {t("eval.config.modelGroupSource", { group: runModelGroupHint })}
                  </p>
                ) : model.trim() ? (
                  <p className="eval-path-hint">{t("eval.config.modelGroupMissing")}</p>
                ) : null}
                {runModelGroupOptions.length > 1 && (
                  <>
                    <label className="field-label">{t("eval.config.runModelGroup")}</label>
                    <select
                      className="filter-select"
                      value={runModelGroupId}
                      onChange={(event) => setRunModelGroupId(event.target.value)}
                      disabled={running}
                    >
                      <option value="">{t("eval.config.modelGroupSelect.auto")}</option>
                      {runModelGroupOptions.map((group) => (
                        <option key={`run-group-${group.id}`} value={group.id}>
                          {resolveModelGroupName(group)}
                        </option>
                      ))}
                    </select>
                    <p className="eval-path-hint">{t("eval.config.modelGroupAmbiguous")}</p>
                  </>
                )}
              </div>

              <div className="field">
                <label className="field-label">{t("eval.config.maxParallelArms")}</label>
                <input
                  className="field-input"
                  type="number"
                  min={MIN_MAX_PARALLEL_ARMS}
                  max={MAX_MAX_PARALLEL_ARMS}
                  step={1}
                  value={maxParallelArmsInput}
                  onChange={(e) => setMaxParallelArmsInput(e.target.value)}
                />
              </div>

              <div className="field">
                <label className="field-label">{t("eval.config.triggerMaxWorkers")}</label>
                <input
                  className="field-input"
                  type="number"
                  min={MIN_EVAL_WORKERS}
                  max={MAX_EVAL_WORKERS}
                  step={1}
                  value={triggerMaxWorkersInput}
                  onChange={(e) => setTriggerMaxWorkersInput(e.target.value)}
                />
              </div>

              <div className="field">
                <label className="field-label">{t("eval.config.functionalMaxWorkers")}</label>
                <input
                  className="field-input"
                  type="number"
                  min={MIN_EVAL_WORKERS}
                  max={MAX_EVAL_WORKERS}
                  step={1}
                  value={functionalMaxWorkersInput}
                  onChange={(e) => setFunctionalMaxWorkersInput(e.target.value)}
                />
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

              <div className="field eval-field-wide">
                <label className="field-label">{t("eval.config.maxCostUsd", { currency: costCurrency })}</label>
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
                        void refreshHistory(selectedSkill, "replace", 20);
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
          {modelCatalog.length > 0 && (
            <datalist id={EVAL_MODEL_DATALIST_ID}>
              {modelCatalog.map((item) => (
                <option
                  key={`${item.groupId}-${item.model}`}
                  value={item.model}
                  label={`${item.groupName}`}
                />
              ))}
            </datalist>
          )}
        </div>
        </article>
      )}

      {showRunningView && runSnapshot && (
        <article className="chart-card eval-running-stage-card">
          <div className="eval-running-stage-head">
            <h3 className="chart-title">{t("eval.running.title")}</h3>
            <div className="eval-running-stage-actions">
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
            </div>
          </div>
          <p className="eval-running-stage-status">{progressDetail || status || t("eval.running")}</p>
          <div className="eval-running-stage-grid">
            <div>
              <span className="eval-history-item-label">{t("eval.config.skill")}</span>
              <strong>{runSnapshot.skillName || naLabel}</strong>
            </div>
            <div>
              <span className="eval-history-item-label">{t("eval.config.mode")}</span>
              <strong>{runSnapshotModeLabel}</strong>
            </div>
            <div>
              <span className="eval-history-item-label">{t("eval.config.runModel")}</span>
              <strong>{runSnapshot.model || naLabel}</strong>
            </div>
            <div>
              <span className="eval-history-item-label">{t("eval.config.repeats")}</span>
              <strong>{runSnapshot.repeats}</strong>
            </div>
            <div>
              <span className="eval-history-item-label">{t("eval.running.progressPercent")}</span>
              <strong>{`${progressPercent}%`}</strong>
            </div>
            <div>
              <span className="eval-history-item-label">{t("eval.running.stageProgress")}</span>
              <strong>{`${stageProgressPercent}%`}</strong>
            </div>
            <div>
              <span className="eval-history-item-label">{t("eval.runDock.elapsed", { seconds: elapsedSeconds })}</span>
              <strong>
                {t("eval.runDock.steps", {
                  current: progressEvent?.stepIndex ?? 0,
                  total: progressEvent?.totalSteps ?? 0,
                })}
              </strong>
            </div>
            <div>
              <span className="eval-history-item-label">{t("eval.running.activeStage")}</span>
              <strong>{activeRuntimeStage?.title ?? naLabel}</strong>
            </div>
            <div>
              <span className="eval-history-item-label">{t("eval.running.stageCountersLabel")}</span>
              <strong>{stageCountersLabel}</strong>
            </div>
            <div>
              <span className="eval-history-item-label">{t("eval.running.remaining")}</span>
              <strong>
                {typeof remainingSeconds === "number"
                  ? formatDurationLabel(remainingSeconds)
                  : t("eval.running.remainingCalculating")}
              </strong>
            </div>
            <div className="eval-running-stage-wide">
              <span className="eval-history-item-label">{t("eval.running.dimensions")}</span>
              <strong>{runSnapshotModulesLabel}</strong>
            </div>
            <div>
              <span className="eval-history-item-label">{t("eval.config.maxParallelArms")}</span>
              <strong>{runParallelArms}</strong>
            </div>
            <div>
              <span className="eval-history-item-label">{t("eval.config.triggerMaxWorkers")}</span>
              <strong>{runTriggerWorkers}</strong>
            </div>
            <div>
              <span className="eval-history-item-label">{t("eval.config.functionalMaxWorkers")}</span>
              <strong>{runFunctionalWorkers}</strong>
            </div>
            <div className="eval-running-stage-wide">
              <span className="eval-history-item-label">{t("eval.dataset.trigger")}</span>
              <strong title={runSnapshot.triggerSetPath}>{compactPath(runSnapshot.triggerSetPath) || naLabel}</strong>
            </div>
            {runSnapshot.mode !== "quick" && (
              <div className="eval-running-stage-wide">
                <span className="eval-history-item-label">{t("eval.dataset.functional")}</span>
                <strong title={runSnapshot.functionalSetPath}>
                  {compactPath(runSnapshot.functionalSetPath) || naLabel}
                </strong>
              </div>
            )}
          </div>
          <section className="eval-flow-guide eval-running-flow" aria-label={t("eval.running.flowAria")}>
            {runtimeStageDefs.map((stage, index) => {
              const flowStatus = runtimeStageStatuses[index] ?? "pending";
              return (
                <div key={stage.key} className={`eval-flow-step is-${flowStatus}`}>
                  <span className="eval-flow-index">{index + 1}</span>
                  <div>
                    <strong>{stage.title}</strong>
                    <small>{stage.desc}</small>
                  </div>
                  <span className={`eval-flow-state eval-flow-state-${flowStatus}`}>
                    {t(`eval.flow.state.${flowStatus}` as Parameters<typeof t>[0])}
                  </span>
                </div>
              );
            })}
          </section>
        </article>
      )}

      {showFixedRunDock && (
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
          <span style={{ transform: `scaleX(${progressPercent / 100})` }} />
        </div>
        </article>
      )}

      <EvalFloatingModal
        open={showSamples && (triggerDraftRows.length > 0 || functionalDraftRows.length > 0)}
      >
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
      </EvalFloatingModal>

      <EvalFloatingModal open={showHistory && Boolean(selectedSkill)}>
        <div
          className="eval-history-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t("eval.history.title", { skill: selectedSkill })}
          onClick={() => setShowHistory(false)}
        >
          <article className="eval-history-modal" onClick={(event) => event.stopPropagation()}>
            <div className="eval-history-modal-head">
              <div className="eval-history-modal-head-copy">
                <h3 className="chart-title">{t("eval.history.title", { skill: selectedSkill })}</h3>
                <p className="eval-path-hint eval-history-head-subtitle">
                  {t("eval.history.subtitle", { skill: selectedSkill })}
                </p>
              </div>
              <div className="eval-history-modal-actions">
                <button
                  className="btn btn-ghost"
                  onClick={() => void refreshHistory(selectedSkill, "replace", 20)}
                  disabled={historyRefreshing || historyLoadingPath !== null}
                >
                  {historyRefreshing ? t("eval.history.loading") : t("eval.history.refresh")}
                </button>
                <button className="btn btn-ghost" onClick={() => setShowHistory(false)}>
                  {t("eval.history.close")}
                </button>
              </div>
            </div>
            <p
              className="eval-path-hint eval-history-path-row"
              title={t("eval.history.path", { path: storagePaths?.historyDir ?? "--" })}
            >
              {t("eval.history.path", { path: storagePaths?.historyDir ?? "--" })}
            </p>

            <div className="eval-history-modal-body">
              {historyEntries.length === 0 ? (
                <div className="eval-history-empty">
                  <p className="eval-path-hint">
                    {historyRefreshError ? t("eval.history.loadFailed") : t("eval.history.empty")}
                  </p>
                  <button
                    className="btn btn-primary"
                    onClick={() => void refreshHistory(selectedSkill, "replace", 20)}
                    disabled={historyRefreshing}
                  >
                    {historyRefreshError ? t("eval.history.retryNow") : t("eval.history.refreshNow")}
                  </button>
                </div>
              ) : (
                <>
                  {historyRefreshError && (
                    <div className="eval-history-refresh-error">
                      <p className="settings-status">{`${t("eval.history.loadFailed")}: ${historyRefreshError}`}</p>
                      <button
                        className="btn btn-ghost"
                        onClick={() => void refreshHistory(selectedSkill, "replace", 20)}
                        disabled={historyRefreshing}
                      >
                        {t("eval.history.retryNow")}
                      </button>
                    </div>
                  )}
                  <div className="eval-history-list">
                    {historyEntries.map((item) => {
                      const expanded = expandedHistoryPath === item.path;
                      const detail = historyDetails[item.path];
                      const detailError = historyDetailErrors[item.path];
                      const detailLoading = historyDetailLoadingPath === item.path;
                      const loadingThisPath = historyLoadingPath === item.path;
                      const isCurrentBaseline = report?.historyPath === item.path;
                      const reviewMeta = resolveHistoryReviewMeta(item);
                      return (
                        <section className="eval-history-item" key={item.path}>
                          <div className="eval-history-item-main">
                            <div className="eval-history-item-copy">
                              <div className="eval-history-item-headline">
                                <strong className="eval-history-item-title">
                                  {formatBeijingDateTimeYmdHm(new Date(item.savedAtUnix * 1000))}
                                </strong>
                                {isCurrentBaseline && (
                                  <span className="eval-history-baseline-pill">
                                    {t("eval.history.currentBaseline")}
                                  </span>
                                )}
                              </div>
                              <div className="eval-history-item-summary-row">
                                <div>
                                  <span className="eval-history-item-label">{t("eval.table.passRate")}</span>
                                  <strong>{formatPercent(item.passRate, 2)}</strong>
                                </div>
                                <div>
                                  <span className="eval-history-item-label">{t("eval.kpi.totalCases")}</span>
                                  <strong>{formatInteger(item.totalCases)}</strong>
                                </div>
                                <div>
                                  <span className="eval-history-item-label">{t("eval.config.mode")}</span>
                                  <strong>{item.mode}</strong>
                                </div>
                              </div>
                              <div className="eval-history-item-summary-row">
                                <div>
                                  <span className="eval-history-item-label">{t("eval.history.repeats")}</span>
                                  <strong>{item.repeats}</strong>
                                </div>
                                <div>
                                  <span className="eval-history-item-label">{t("eval.config.model")}</span>
                                  <strong>{item.model}</strong>
                                </div>
                                <div>
                                  <span className="eval-history-item-label">{t("eval.history.reviewStatus")}</span>
                                  <span className={`eval-history-review-pill is-${reviewMeta.tone}`}>
                                    {reviewMeta.label}
                                  </span>
                                </div>
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
                                className="btn btn-primary"
                                onClick={() => void handleLoadHistory(item.path)}
                                disabled={historyLoadingPath !== null || historyRefreshing}
                              >
                                {loadingThisPath ? (
                                  <>
                                    <span className="eval-inline-spinner" aria-hidden="true" />
                                    {t("eval.history.loadingItem")}
                                  </>
                                ) : (
                                  t("eval.history.load")
                                )}
                              </button>
                            </div>
                          </div>

                          <div className={`eval-history-item-detail-shell ${expanded ? "is-open" : ""}`}>
                            <div className="eval-history-item-detail-inner">
                              <div className="eval-history-item-detail">
                                {detailLoading && (
                                  <div className="eval-history-detail-skeleton" aria-hidden="true">
                                    <span />
                                    <span />
                                    <span />
                                  </div>
                                )}
                                {!detailLoading && detailError && (
                                  <div className="eval-history-detail-error">
                                    <p className="settings-status">{`${t("eval.history.detailError")}: ${detailError}`}</p>
                                    <button
                                      className="btn btn-ghost"
                                      onClick={() => void handleRetryHistoryDetail(item.path)}
                                    >
                                      {t("eval.history.retryNow")}
                                    </button>
                                  </div>
                                )}
                                {!detailLoading && !detailError && detail && (
                                  <div className="eval-history-detail-groups">
                                    <section className="eval-history-detail-group">
                                      <h4 className="eval-history-detail-group-title">{t("eval.history.group.overall")}</h4>
                                      <div className="eval-history-detail-grid">
                                        <div>
                                          <span className="eval-history-item-label">{t("eval.kpi.totalCases")}</span>
                                          <strong>{formatInteger(detail.summary.totalCases)}</strong>
                                        </div>
                                        <div>
                                          <span className="eval-history-item-label">{t("eval.kpi.totalPassed")}</span>
                                          <strong>{formatInteger(detail.summary.totalPassed)}</strong>
                                        </div>
                                        <div>
                                          <span className="eval-history-item-label">{t("eval.table.passRate")}</span>
                                          <strong>{formatPercent(detail.summary.passRate, 2)}</strong>
                                        </div>
                                        <div>
                                          <span className="eval-history-item-label">{t("eval.kpi.repeatStats")}</span>
                                          <strong>
                                            {formatPercent(detail.repeatStats.overallPassRate.mean, 2)} +/-{" "}
                                            {formatPercent(detail.repeatStats.overallPassRate.stdDev, 2)}
                                          </strong>
                                        </div>
                                      </div>
                                    </section>

                                    <section className="eval-history-detail-group">
                                      <h4 className="eval-history-detail-group-title">{t("eval.history.group.trigger")}</h4>
                                      <div className="eval-history-detail-grid">
                                        <div>
                                          <span className="eval-history-item-label">{t("eval.kpi.precision")}</span>
                                          <strong>{formatPercent(detail.triggerMetrics.precision, 2)}</strong>
                                        </div>
                                        <div>
                                          <span className="eval-history-item-label">{t("eval.kpi.recall")}</span>
                                          <strong>{formatPercent(detail.triggerMetrics.recall, 2)}</strong>
                                        </div>
                                        <div>
                                          <span className="eval-history-item-label">{t("eval.kpi.fpr")}</span>
                                          <strong>{formatPercent(detail.triggerMetrics.fpr, 2)}</strong>
                                        </div>
                                      </div>
                                    </section>

                                    <section className="eval-history-detail-group">
                                      <h4 className="eval-history-detail-group-title">{t("eval.history.group.cost")}</h4>
                                      <div className="eval-history-detail-grid">
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
                                      </div>
                                    </section>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </section>
                      );
                    })}
                  </div>
                  <div className="eval-history-load-more">
                    <button
                      className="btn btn-ghost"
                      onClick={() => void handleLoadMoreHistory()}
                      disabled={historyRefreshing || !historyHasMore}
                    >
                      {historyRefreshing
                        ? t("eval.history.loading")
                        : historyHasMore
                          ? t("eval.history.loadMore")
                          : t("eval.history.allLoaded")}
                    </button>
                  </div>
                </>
              )}
            </div>
          </article>
        </div>
      </EvalFloatingModal>

      {showReviewView && report?.mode === "full" && (
        <>
          <article className="chart-card eval-review-entry-card">
            <div className="eval-review-entry-head">
              <h3 className="chart-title">{t("eval.review.entryTitle")}</h3>
              <button className="btn btn-primary" onClick={() => setView("result")}>
                {t("eval.review.enterResults")}
              </button>
            </div>
            <p className="eval-path-hint">{t("eval.review.entryHint")}</p>
          </article>
          {renderGateAndQuickChecks()}
          {renderEvidenceOverview()}
          {renderReviewWorkbench()}
        </>
      )}

      {showResultView && report && (
        <>
          {report.mode === "full" && (
            <article className="chart-card eval-review-entry-card">
              <div className="eval-review-entry-head">
                <h3 className="chart-title">{t("eval.results.title")}</h3>
                <button className="btn btn-ghost" onClick={() => setView("review")}>
                  {t("eval.results.backToReview")}
                </button>
              </div>
            </article>
          )}
          {renderSummaryKpis()}
          {renderGateAndQuickChecks()}
          {renderEvidenceOverview()}
          {renderEconomicsPanel()}
          {renderComparatorAnalyzerPanel()}
          {renderModuleResultsPanel()}
          {renderModeKpis()}
          <div className="chart-row">
            {renderTriggerChart(report.triggerClean, t("eval.trigger.titleClean"), "clean")}
            {renderFunctionalChart()}
          </div>
          {report.mode === "full" &&
            renderTriggerChart(report.triggerComplex, t("eval.trigger.titleComplex"), "complex")}
        </>
      )}

      {copyToast && (
        <div className="eval-copy-toast" role="status" aria-live="polite">
          {copyToast}
        </div>
      )}

      {showSetupView && !report && !running && !status && <div className="empty-state">{t("eval.empty")}</div>}
    </div>
  );
}



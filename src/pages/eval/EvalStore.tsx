/**
 * Unified eval state management for v6.0.
 *
 * Provides a React Context + useReducer store that replaces the ~60 useState
 * hooks in the legacy EvalPage.tsx. Components in the eval/ directory import
 * `useEvalStore()` to read state and `useEvalDispatch()` to update it.
 *
 * This module also re-exports the types and constants that child components need.
 */

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type {
  EvalHistoryEntry,
  EvalModuleKey,
  EvalPipelineEstimate,
  EvalPipelineOutput,
  EvalPipelineProgressEvent,
  EvalSampleGenerationTimingEntry,
  EvalStoragePaths,
  SkillMeta,
  CostCurrency,
} from "../../api/tauri";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvalMode = "quick" | "standard" | "full";
export type EvalControlAction = "pause" | "resume" | "cancel";
export type EvalDraftKind = "trigger" | "functional";
export type EvalFlowStatus = "active" | "done" | "pending";
export type EvalView = "setup" | "running" | "review" | "result";

export type TriggerBucketKey =
  | "positive_trigger"
  | "negative_trigger"
  | "boundary_ambiguous"
  | "adjacent_skill_confusion";

export type TriggerDraftRow = {
  query: string;
  shouldTrigger: boolean;
  testBucket: TriggerBucketKey;
};

export type FunctionalDraftRow = {
  id: string;
  prompt: string;
  assertionsText: string;
};

export type EvalRunSnapshot = {
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

/** v6.0: three-role model configuration */
export type ModelRoleConfig = {
  executor: string;
  judge: string;
  generator: string;
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface EvalState {
  // Skill selection
  selectedSkill: string;
  skills: SkillMeta[];
  skillsRootDir: string | undefined;

  // Config
  evalMode: EvalMode;
  sampleModel: string;
  model: string;
  costCurrency: CostCurrency;
  repeatsInput: string;
  maxCostUsdInput: string;
  maxParallelArmsInput: string;
  triggerMaxWorkersInput: string;
  functionalMaxWorkersInput: string;
  selectedModules: EvalModuleKey[];

  // v6.0: three-role model config
  judgeModel: string;
  generatorModel: string;

  // Dataset
  triggerSetPath: string;
  functionalSetPath: string;
  triggerDraftRows: TriggerDraftRow[];
  functionalDraftRows: FunctionalDraftRow[];

  // Pipeline execution
  running: boolean;
  activeRunId: string | null;
  progressEvent: EvalPipelineProgressEvent | null;
  progressStartedAtMs: number | null;
  progressElapsedMs: number;
  controlBusy: boolean;
  pauseRequested: boolean;
  generating: boolean;
  savingDraft: EvalDraftKind | null;
  status: string;

  // Output
  report: EvalPipelineOutput | null;

  // View
  view: EvalView;
  stepOverride: 1 | 2 | 3 | null;
  runSnapshot: EvalRunSnapshot | null;

  // Storage / history
  storagePaths: EvalStoragePaths | null;
  historyLoading: boolean;
  historyEntries: EvalHistoryEntry[];
  showSamples: boolean;
  showHistory: boolean;
  expandedHistoryPath: string | null;
  historyDetails: Record<string, EvalPipelineOutput>;
  historyDetailLoadingPath: string | null;
  historyDetailErrors: Record<string, string>;
  sampleTimingHistory: EvalSampleGenerationTimingEntry[];

  // Preflight
  preflightEstimate: EvalPipelineEstimate | null;
  preflightEstimateError: string;
  preflightEstimating: boolean;

  // Review
  reviewFinalVerdict: string;
  reviewOverrideGate: boolean;
  reviewOverrideReason: string;
  reviewNotes: string;
  reviewReviewer: string;
  reviewSubmitting: boolean;
  feedbackDrafting: boolean;
  reviewCaseId: string;
  reviewEvidence: string;
  reviewEvidenceLoading: boolean;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type EvalAction =
  | { type: "SET_SELECTED_SKILL"; payload: string }
  | { type: "SET_SKILLS"; payload: SkillMeta[] }
  | { type: "SET_MODE"; payload: EvalMode }
  | { type: "SET_MODEL"; payload: string }
  | { type: "SET_SAMPLE_MODEL"; payload: string }
  | { type: "SET_JUDGE_MODEL"; payload: string }
  | { type: "SET_GENERATOR_MODEL"; payload: string }
  | { type: "SET_VIEW"; payload: EvalView }
  | { type: "SET_RUNNING"; payload: boolean }
  | { type: "SET_ACTIVE_RUN_ID"; payload: string | null }
  | { type: "SET_PROGRESS_EVENT"; payload: EvalPipelineProgressEvent | null }
  | { type: "SET_REPORT"; payload: EvalPipelineOutput | null }
  | { type: "SET_STATUS"; payload: string }
  | { type: "SET_RUN_SNAPSHOT"; payload: EvalRunSnapshot | null }
  | { type: "SET_COST_CURRENCY"; payload: CostCurrency }
  | { type: "SET_REPEATS_INPUT"; payload: string }
  | { type: "SET_MAX_COST_USD_INPUT"; payload: string }
  | { type: "SET_SELECTED_MODULES"; payload: EvalModuleKey[] }
  | { type: "SET_TRIGGER_SET_PATH"; payload: string }
  | { type: "SET_FUNCTIONAL_SET_PATH"; payload: string }
  | { type: "SET_TRIGGER_DRAFT_ROWS"; payload: TriggerDraftRow[] }
  | { type: "SET_FUNCTIONAL_DRAFT_ROWS"; payload: FunctionalDraftRow[] }
  | { type: "SET_SHOW_SAMPLES"; payload: boolean }
  | { type: "SET_SHOW_HISTORY"; payload: boolean }
  | { type: "SET_HISTORY_ENTRIES"; payload: EvalHistoryEntry[] }
  | { type: "SET_PREFLIGHT_ESTIMATE"; payload: EvalPipelineEstimate | null }
  | { type: "SET_PREFLIGHT_ERROR"; payload: string }
  | { type: "SET_PREFLIGHT_ESTIMATING"; payload: boolean }
  | { type: "SET_STORAGE_PATHS"; payload: EvalStoragePaths | null }
  | { type: "SET_MAX_PARALLEL_ARMS_INPUT"; payload: string }
  | { type: "SET_TRIGGER_MAX_WORKERS_INPUT"; payload: string }
  | { type: "SET_FUNCTIONAL_MAX_WORKERS_INPUT"; payload: string }
  | {
    type: "LOAD_HISTORY_ENTRY";
    payload: {
      report: EvalPipelineOutput;
      runSnapshot: EvalRunSnapshot;
      view: EvalView;
      status: string;
    };
  }
  | { type: "PATCH"; payload: Partial<EvalState> };

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

function createInitialState(skills: SkillMeta[]): EvalState {
  return {
    selectedSkill: "",
    skills,
    skillsRootDir: undefined,
    evalMode: "full",
    sampleModel: "gpt-4o-mini",
    model: "gpt-4o-mini",
    costCurrency: "USD",
    repeatsInput: "1",
    maxCostUsdInput: "",
    maxParallelArmsInput: "2",
    triggerMaxWorkersInput: "6",
    functionalMaxWorkersInput: "3",
    selectedModules: ["trigger_accuracy", "execution_correctness", "robustness_security", "economics", "auditability"],
    judgeModel: "",
    generatorModel: "",
    triggerSetPath: "",
    functionalSetPath: "",
    triggerDraftRows: [],
    functionalDraftRows: [],
    running: false,
    activeRunId: null,
    progressEvent: null,
    progressStartedAtMs: null,
    progressElapsedMs: 0,
    controlBusy: false,
    pauseRequested: false,
    generating: false,
    savingDraft: null,
    status: "",
    report: null,
    view: "setup",
    stepOverride: null,
    runSnapshot: null,
    storagePaths: null,
    historyLoading: false,
    historyEntries: [],
    showSamples: false,
    showHistory: false,
    expandedHistoryPath: null,
    historyDetails: {},
    historyDetailLoadingPath: null,
    historyDetailErrors: {},
    sampleTimingHistory: [],
    preflightEstimate: null,
    preflightEstimateError: "",
    preflightEstimating: false,
    reviewFinalVerdict: "pass",
    reviewOverrideGate: false,
    reviewOverrideReason: "",
    reviewNotes: "",
    reviewReviewer: "",
    reviewSubmitting: false,
    feedbackDrafting: false,
    reviewCaseId: "",
    reviewEvidence: "",
    reviewEvidenceLoading: false,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function evalReducer(state: EvalState, action: EvalAction): EvalState {
  switch (action.type) {
    case "SET_SELECTED_SKILL":
      return { ...state, selectedSkill: action.payload };
    case "SET_SKILLS":
      return { ...state, skills: action.payload };
    case "SET_MODE":
      return { ...state, evalMode: action.payload };
    case "SET_MODEL":
      return { ...state, model: action.payload };
    case "SET_SAMPLE_MODEL":
      return { ...state, sampleModel: action.payload };
    case "SET_JUDGE_MODEL":
      return { ...state, judgeModel: action.payload };
    case "SET_GENERATOR_MODEL":
      return { ...state, generatorModel: action.payload };
    case "SET_VIEW":
      return { ...state, view: action.payload };
    case "SET_RUNNING":
      return { ...state, running: action.payload };
    case "SET_ACTIVE_RUN_ID":
      return { ...state, activeRunId: action.payload };
    case "SET_PROGRESS_EVENT":
      return { ...state, progressEvent: action.payload };
    case "SET_REPORT":
      return { ...state, report: action.payload };
    case "SET_STATUS":
      return { ...state, status: action.payload };
    case "SET_RUN_SNAPSHOT":
      return { ...state, runSnapshot: action.payload };
    case "SET_COST_CURRENCY":
      return { ...state, costCurrency: action.payload };
    case "SET_REPEATS_INPUT":
      return { ...state, repeatsInput: action.payload };
    case "SET_MAX_COST_USD_INPUT":
      return { ...state, maxCostUsdInput: action.payload };
    case "SET_SELECTED_MODULES":
      return { ...state, selectedModules: action.payload };
    case "SET_TRIGGER_SET_PATH":
      return { ...state, triggerSetPath: action.payload };
    case "SET_FUNCTIONAL_SET_PATH":
      return { ...state, functionalSetPath: action.payload };
    case "SET_TRIGGER_DRAFT_ROWS":
      return { ...state, triggerDraftRows: action.payload };
    case "SET_FUNCTIONAL_DRAFT_ROWS":
      return { ...state, functionalDraftRows: action.payload };
    case "SET_SHOW_SAMPLES":
      return { ...state, showSamples: action.payload };
    case "SET_SHOW_HISTORY":
      return { ...state, showHistory: action.payload };
    case "SET_HISTORY_ENTRIES":
      return { ...state, historyEntries: action.payload };
    case "SET_PREFLIGHT_ESTIMATE":
      return { ...state, preflightEstimate: action.payload };
    case "SET_PREFLIGHT_ERROR":
      return { ...state, preflightEstimateError: action.payload };
    case "SET_PREFLIGHT_ESTIMATING":
      return { ...state, preflightEstimating: action.payload };
    case "SET_STORAGE_PATHS":
      return { ...state, storagePaths: action.payload };
    case "SET_MAX_PARALLEL_ARMS_INPUT":
      return { ...state, maxParallelArmsInput: action.payload };
    case "SET_TRIGGER_MAX_WORKERS_INPUT":
      return { ...state, triggerMaxWorkersInput: action.payload };
    case "SET_FUNCTIONAL_MAX_WORKERS_INPUT":
      return { ...state, functionalMaxWorkersInput: action.payload };
    case "LOAD_HISTORY_ENTRY":
      return {
        ...state,
        report: action.payload.report,
        runSnapshot: action.payload.runSnapshot,
        view: action.payload.view,
        status: action.payload.status,
      };
    case "PATCH":
      return { ...state, ...action.payload };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const EvalStateContext = createContext<EvalState | null>(null);
const EvalDispatchContext = createContext<Dispatch<EvalAction> | null>(null);

export function EvalProvider({
  skills,
  children,
}: {
  skills: SkillMeta[];
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(evalReducer, skills, createInitialState);

  // Listen for backend pipeline progress events
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<EvalPipelineProgressEvent>("eval://pipeline-progress", (event) => {
        dispatch({ type: "SET_PROGRESS_EVENT", payload: event.payload });
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <EvalStateContext.Provider value={state}>
      <EvalDispatchContext.Provider value={dispatch}>
        {children}
      </EvalDispatchContext.Provider>
    </EvalStateContext.Provider>
  );
}

// Hooks are intentionally co-located with provider/context in this module.
// eslint-disable-next-line react-refresh/only-export-components
export function useEvalStore(): EvalState {
  const ctx = useContext(EvalStateContext);
  if (!ctx) throw new Error("useEvalStore must be used inside EvalProvider");
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useEvalDispatch(): Dispatch<EvalAction> {
  const ctx = useContext(EvalDispatchContext);
  if (!ctx) throw new Error("useEvalDispatch must be used inside EvalProvider");
  return ctx;
}

import { invoke } from "@tauri-apps/api/core";

export const APP_ERROR_EVENT = "myskills:error";

function normalizeInvokeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function reportGlobalError(message: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(APP_ERROR_EVENT, { detail: message }));
  }
}

type InvokeOptions = {
  reportGlobal?: boolean;
};

async function invokeWithError<T>(
  command: string,
  args?: Record<string, unknown>,
  options: InvokeOptions = {},
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    const message = normalizeInvokeError(error);
    if (options.reportGlobal ?? false) {
      reportGlobalError(message);
    }
    throw new Error(message);
  }
}

export type SkillMeta = {
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  taxonomy?: SkillTaxonomy;
  my_notes?: string;
  last_updated?: string;
  directory: string;
};

export type SkillTaxonomy = {
  sokRepresentation: string;
  sokScope: string;
  sokGroup: string;
  anthropicCategory: string;
  skillsbenchDomain: string;
  skillsbenchDifficultyCore: "Core" | "Extended" | "Extreme";
  skillsbenchDifficultyLevel: "Easy" | "Medium" | "Hard";
  classifiedAt: string;
  classifierModel: string;
};

export type SkillUsageInsight = {
  lastUsedAt: string | null;
  d7: number;
  d30: number;
  d90: number;
  d7Prev: number;
  d30Prev: number;
  d90Prev: number;
};

export type SkillEvalInsight = {
  latestRunAtUnix: number | null;
  latestStatus: string | null;
  latestAdvisoryLevel?: "pass" | "warn" | "high_risk" | null;
  latestPassRate: number | null;
  latestMode: string | null;
  latestModel: string | null;
  prevPassRate: number | null;
  runs90d: number;
};

export type SkillInsight = {
  skillName: string;
  usage: SkillUsageInsight;
  eval: SkillEvalInsight;
};

export type SkillDocument = {
  frontmatter: Record<string, unknown>;
  body: string;
};

export type SaveResult = {
  success: boolean;
};

export type SkillFileEntry = {
  path: string;
  size: number;
};

export type SkillDeleteFailure = {
  root: string;
  error: string;
};

export type SkillDeleteEverywhereResult = {
  skillName: string;
  scannedRoots: number;
  removedPaths: string[];
  failedRoots: SkillDeleteFailure[];
};

export type SkillShapeTagScanResult = {
  scannedSkills: number;
  updatedEntries: number;
  indexPath: string;
};

export type RulesContent = {
  content: string;
};

export type RulesSaveResult = {
  success: boolean;
};

export type LogEntry = {
  ts: string;
  skill: string;
  cwd: string;
  tool: string;
  session?: string;
};

export type LogsResult = {
  logs: LogEntry[];
  total: number;
};

export type NamedCount = {
  name: string;
  count: number;
};

export type DayCount = {
  date: string;
  count: number;
};

export type StatsResult = {
  total_invocations: number;
  by_skill: NamedCount[];
  by_tool: NamedCount[];
  by_day: DayCount[];
  recent: LogEntry[];
  unused_skills: string[];
  reliability_mode: string;
  reliability_note: string;
};

export type LogsQuery = {
  skill?: string;
  tool?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
};

export type GitStatus = {
  branch: string;
  changed: string[];
  staged: string[];
  not_added: string[];
  ahead: number;
  behind: number;
  recent_commits: GitRecentCommit[];
  latest_commit_hash?: string;
  latest_pushed_hash?: string;
};

export type GitRecentCommit = {
  hash: string;
  short_hash: string;
  summary: string;
  author_name: string;
  authored_at: string;
  is_pushed: boolean;
};

export type GitGraphCommit = {
  hash: string;
  short_hash: string;
  summary: string;
  author_name: string;
  authored_at: string;
  is_pushed: boolean;
  refs: string[];
  parent_hashes: string[];
};

export type GitCommitResult = {
  success: boolean;
  hash: string;
};

export type GitPushResult = {
  success: boolean;
  error?: string;
};

export type GitProvider = "github" | "gitlab" | "gitee" | "other";
export type GitSyncMode = "direct" | "mirror";

export type GitManagedRepository = {
  id: string;
  name: string;
  alias?: string;
  url: string;
  provider: GitProvider;
  syncMode: GitSyncMode;
  sourcePath: string;
  localPath: string;
  isSyncing: boolean;
  lastSyncAt?: string;
  lastSyncError?: string;
  scriptAfterAdd?: string;
  ignorePaths: string[];
};

export type GitSkillsSyncResult = {
  sourcePath: string;
  targetPath: string;
  copiedFiles: number;
  removedEntries: number;
};

export type GitSyncTreeEntry = {
  relativePath: string;
  name: string;
  entryType: "file" | "dir";
  hasChildren: boolean;
  ignored: boolean;
};

export type GitUpdateIgnoreResult = {
  repository: GitManagedRepository;
  syncResult?: GitSkillsSyncResult;
};

export type GitGuideDocument = {
  path: string;
  content: string;
};

export type ToolStatus = {
  name: string;
  id: string;
  icon?: string;
  skillsDir: string;
  rulesPath: string;
  pathSource: string;
  skillsDirExists: boolean;
  skillsDirWritable: boolean;
  rulesPathExists: boolean;
  rulesPathWritable: boolean;
  exists: boolean;
  configured: boolean;
  syncedSkills: number;
  syncMode: "symlink" | "copy" | "none" | string;
  lastSyncTime?: string;
  autoSync: boolean;
  trackingEnabled: boolean;
  hookConfigured: boolean;
  integrationMode: "native" | "fallback" | string;
  capabilities: ToolCapabilities;
  isCustom: boolean;
};

export type ToolCapabilities = {
  nativeSkillDiscovery: boolean;
  instructionChainSupported: boolean;
  startupInjectionSupported: boolean;
  hookConfigSupported: boolean;
};

export type ToolRouterHealthStatus = {
  toolId: string;
  toolName: string;
  discoverable: boolean;
  gatePresent: boolean;
  startupInjectionPresent?: boolean;
  lastUsageSeen?: string;
  health: "healthy" | "degraded" | "broken" | string;
  reason: string;
};

export type PathCandidateAudit = {
  skillsDir: string;
  rulesPath: string;
  skillsDirExists: boolean;
  skillsDirWritable: boolean;
  rulesPathExists: boolean;
  rulesPathWritable: boolean;
  selected: boolean;
};

export type BuiltInToolPathAudit = {
  name: string;
  id: string;
  selectedSkillsDir: string;
  selectedRulesPath: string;
  pathSource: string;
  selectedCandidateExists: boolean;
  needsManualReview: boolean;
  candidates: PathCandidateAudit[];
};

export type SetupApplyResult = {
  tool: string;
  success: boolean;
  action: string;
  syncMode: string;
  syncedCount: number;
  error?: string;
};

export type SkillSyncConfig = {
  skillName: string;
  enabledTools: string[];
};

export type CustomTool = {
  name: string;
  id: string;
  skillsDir: string;
  rulesFile?: string;
  icon?: string;
};

export type SetupMutationResult = {
  success: boolean;
};

export type SkillOverviewEntry = {
  name: string;
  contentHash: string;
  duplicateAcrossTools: boolean;
  inMySkills: boolean;
  hashMatchesMySkills: boolean;
  hashConflictsMySkills: boolean;
};

export type ToolSkillOverview = {
  toolId: string;
  toolName: string;
  skills: SkillOverviewEntry[];
  count: number;
};

export type LocalSkillsOverview = {
  tools: ToolSkillOverview[];
  duplicateNames: string[];
  totalSkills: number;
  uniqueSkills: number;
  matchedInMySkills: number;
  missingInMySkills: number;
  conflictWithMySkills: number;
};

export type SkillConflictVariant = {
  sourceId: string;
  sourceName: string;
  contentHash: string;
  inMySkills: boolean;
  hashMatchesMySkills: boolean;
  content: string;
  fileList: string[];
  sourceDir: string;
};

export type SkillConflictDetail = {
  skillName: string;
  variants: SkillConflictVariant[];
};

export type OnboardingState = {
  completed: boolean;
  skillsDir: string;
  autoSync: boolean;
};

export type OnboardingSetSkillsDirResult = {
  success: boolean;
  skills: SkillMeta[];
};

export type OnboardingCompleteResult = {
  success: boolean;
  autoSync: boolean;
  configuredTools: number;
};

export type ToolImportSummary = {
  toolId: string;
  toolName: string;
  detected: number;
  imported: number;
  skippedExisting: number;
  error?: string;
};

export type OnboardingImportSkillsResult = {
  success: boolean;
  detectedTotal: number;
  importedTotal: number;
  skippedExistingTotal: number;
  tools: ToolImportSummary[];
};

export type VscodeExtensionInstallResult = {
  success: boolean;
  vsixPath: string;
  vscodeCli: string;
  settingsPath: string;
};

export type VscodeSettingsSyncResult = {
  success: boolean;
  settingsPath: string;
  skillsDir: string;
};

export type VscodeExtensionStatusResult = {
  installed: boolean;
  detectedBy: string;
  vscodeCli?: string;
};

export type VscodeExtensionUninstallResult = {
  success: boolean;
  vscodeCli: string;
};

export type UpdateSettings = {
  auto_check: boolean;
  last_check_time: number;
  check_interval_hours: number;
  auto_install: boolean;
  last_run_version: string;
};

export type CostCurrency = "USD" | "CNY";

export type VersionJumpInfo = {
  previous_version: string;
  current_version: string;
  release_notes: string;
  release_notes_zh: string;
};

export type ModelGroup = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  isGateway: boolean;
  models: string[];
};

export type EvalConfig = {
  apiKey: string;
  provider: string;
  baseUrl?: string;
  sampleModel: string;
  runModel: string;
  defaultModel?: string;
  judgeModel?: string;
  sampleModelGroupId?: string;
  runModelGroupId?: string;
  costCurrency: CostCurrency;
  modelGroups?: ModelGroup[];
};

type TriggerEvalResultItemRaw = {
  query: string;
  should_trigger: boolean;
  triggered: boolean;
  triggered_skill_name?: string | null;
  pass: boolean;
  error?: string;
  raw_response_path?: string | null;
  latency_ms?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  judge_trace_id?: string | null;
  error_type?: string | null;
};

type TriggerEvalSummaryRaw = {
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
};

type TriggerEvalOutputRaw = {
  status: string;
  skill_name?: string;
  summary?: TriggerEvalSummaryRaw;
  results?: TriggerEvalResultItemRaw[];
  message?: string;
};

export type TriggerEvalResultItem = {
  query: string;
  shouldTrigger: boolean;
  triggered: boolean;
  triggeredSkillName: string | null;
  pass: boolean;
  error?: string;
  rawResponsePath?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  judgeTraceId?: string | null;
  errorType?: string | null;
};

export type TriggerEvalSummary = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
};

export type TriggerEvalOutput = {
  status: string;
  skillName?: string;
  summary?: TriggerEvalSummary;
  results?: TriggerEvalResultItem[];
  message?: string;
};

type FunctionalEvalResultItemRaw = {
  case_id: string;
  passed: boolean;
  pass_rate: number;
  error?: string;
  layer1_pass?: boolean;
  quality_score?: number;
  dimension_scores?: Record<string, number>;
  judge_rationale?: string;
  judge_suggestions?: string[];
  judge_source?: string;
  raw_response_path?: string | null;
  latency_ms?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  judge_trace_id?: string | null;
  error_type?: string | null;
};

type FunctionalEvalSummaryRaw = {
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
};

type FunctionalEvalOutputRaw = {
  status: string;
  skill_name?: string;
  summary?: FunctionalEvalSummaryRaw;
  dimension_scores?: Record<string, number>;
  results?: FunctionalEvalResultItemRaw[];
  message?: string;
};

export type FunctionalEvalResultItem = {
  caseId: string;
  passed: boolean;
  passRate: number;
  error?: string;
  layer1Pass?: boolean;
  qualityScore?: number;
  dimensionScores?: Record<string, number>;
  judgeRationale?: string;
  judgeSuggestions?: string[];
  judgeSource?: string;
  rawResponsePath?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  judgeTraceId?: string | null;
  errorType?: string | null;
};

export type FunctionalEvalSummary = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
};

export type FunctionalEvalOutput = {
  status: string;
  skillName?: string;
  summary?: FunctionalEvalSummary;
  dimensionScores?: Record<string, number>;
  results?: FunctionalEvalResultItem[];
  message?: string;
};

export type EvalSampleDrafts = {
  triggerDraft: string;
  functionalDraft: string;
  triggerCount: number;
  functionalCount: number;
};

export type EvalSampleGenerationTimingEntry = {
  recordedAtUnix: number;
  skillName: string;
  model: string;
  triggerCount: number;
  functionalCount: number;
  elapsedSeconds: number;
};

export type EvalDatasetKind = "trigger" | "functional";

export type EvalDatasetSaveRequest = {
  content: string;
  path?: string;
  kind?: "trigger" | "functional";
  skillName?: string;
};

export type EvalDatasetSaveResult = {
  success: boolean;
  path: string;
};

export type EvalStoragePaths = {
  datasetDir: string;
  historyDir: string;
  latestTriggerPath?: string;
  latestFunctionalPath?: string;
};

export type EvalHistoryEntry = {
  path: string;
  fileName: string;
  savedAtUnix: number;
  mode: string;
  repeats: number;
  passRate: number;
  totalCases: number;
  model: string;
  status: string;
  reviewSummary?: EvalReviewSummary;
};

export type EvalRunRequest = {
  skillName: string;
  model: string;
  evalSetPath: string;
  envType?: "clean" | "complex";
  installedSkillsDir?: string;
};

export type FunctionalEvalRunRequest = {
  skillName: string;
  skillPath: string;
  evalSetPath: string;
  compareMode?: "none" | "no_skill" | "without_skill";
  model: string;
};

export type EvalSampleGenerateRequest = {
  skillName: string;
  skillPath: string;
  model: string;
  triggerCount?: number;
  functionalCount?: number;
};

export type EvalSampleGenerationHistoryRequest = {
  skillName?: string;
  model?: string;
  limit?: number;
};

export type EvalPipelineMode = "quick" | "standard" | "full";

export type EvalPipelineSummary = {
  totalCases: number;
  totalPassed: number;
  totalFailed: number;
  passRate: number;
};

export type EvalTriggerMetrics = {
  precision: number;
  recall: number;
  fpr: number;
  truePositive: number;
  trueNegative: number;
  falsePositive: number;
  falseNegative: number;
};

export type EvalDimensionScores = {
  triggerAccuracy: number;
  functionalCorrectness: number;
  robustness: number;
  efficiency: number;
  valueAdded: number;
};

export type EvalCostEstimate = {
  estimatedUsd: number;
  estimatedUsdMin?: number;
  estimatedUsdMax?: number;
  actualUsdEstimate: number;
  triggerCases: number;
  functionalCases: number;
  apiCallsEstimate: number;
  budgetLimitUsd?: number;
  budgetExceeded: boolean;
};

export type EvalEstimateStep = {
  key: string;
  title: string;
  stage?: string;
  moduleKey?: EvalModuleKey;
  caseCount: number;
  runs: number;
  llmCalls: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  estimatedSeconds: number;
};

export type EvalModuleKey =
  | "trigger_accuracy"
  | "execution_correctness"
  | "robustness_security"
  | "economics"
  | "auditability";

export type EvalPipelineEstimate = {
  mode: EvalPipelineMode | string;
  model: string;
  judgeModels: string[];
  selectedModules: EvalModuleKey[];
  repeats: number;
  triggerCases: number;
  functionalCases: number;
  taxonomyPending: boolean;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  estimatedSeconds: number;
  estimatedMinutes: number;
  costEstimate: EvalCostEstimate;
  steps: EvalEstimateStep[];
};

export type EvalDeltaVsNoSkill = {
  withSkillPassRate: number;
  withoutSkillPassRate: number;
  functionalPassRateDelta: number;
};

export type EvalRunMeta = {
  mode: EvalPipelineMode | string;
  model: string;
  judgeModels: string[];
  repeats: number;
  maxParallelArms: number;
  triggerMaxWorkers: number;
  functionalMaxWorkers: number;
  seed?: number;
  temperature: number;
  executedSteps: number;
  elapsedMs: number;
  skillHash?: string;
};

export type EvalRateStats = {
  mean: number;
  median: number;
  stdDev: number;
};

export type EvalRepeatStats = {
  overallPassRate: EvalRateStats;
  triggerPassRate: EvalRateStats;
  functionalPassRate?: EvalRateStats;
  robustness: EvalRateStats;
  valueAdded?: EvalRateStats;
};

export type EvalAdvisory = {
  level: "pass" | "warn" | "high_risk";
  reasons: string[];
  nonBlocking: boolean;
};

export type EvalEvidenceSummary = {
  totalRuns: number;
  capturedTranscripts: number;
  capturedTiming: number;
  capturedTokens: number;
};

export type EvalReviewSummary = {
  reviewed: boolean;
  finalVerdict?: string;
  overrideGate: boolean;
  decidedAtUnix?: number;
  reviewer?: string;
};

export type EvalComparatorSummary = {
  evaluatedCases: number;
  improvedCases: number;
  regressedCases: number;
  unchangedCases: number;
  averageDelta: number;
  highlights: string[];
};

export type EvalAnalyzerSummary = {
  topFailurePatterns: string[];
  recommendations: string[];
  generatedAtUnix: number;
  improvementSuggestions?: string[];
  descriptionFeedback?: string;
};

export type EvalReviewDetail = {
  path: string;
  finalVerdict: string;
  overrideGate: boolean;
  overrideReason?: string;
  notes?: string;
  reviewer?: string;
  tags: string[];
  failedCaseIds: string[];
  decidedAtUnix: number;
};

export type EvalSubmitReviewResult = {
  success: boolean;
  review: EvalReviewDetail;
  reviewSummary: EvalReviewSummary;
  finalVerdict: string;
  overrideReason?: string;
  overrideBy?: string;
  overrideAt?: number;
};

export type EvalReviewQueueItem = {
  path: string;
  fileName: string;
  savedAtUnix: number;
  passRate: number;
  totalCases: number;
  model: string;
  gatePass?: boolean;
  reviewed: boolean;
  finalVerdict?: string;
  decidedAtUnix?: number;
};

export type EvalEvidenceCaseResult = {
  caseId: string;
  stage: string;
  evidencePath?: string;
  content?: string;
};

export type EvalQuickCheckItem = {
  key: string;
  title: string;
  blocking: boolean;
  passed: boolean;
  message: string;
  elapsedMs: number;
  evidencePath?: string;
};

export type EvalTriggerBucketCoverage = {
  minRequiredPerBucket: number;
  positiveTrigger: number;
  negativeTrigger: number;
  boundaryAmbiguous: number;
  adjacentSkillConfusion: number;
  allBucketsMet: boolean;
  failedBuckets: string[];
};

export type EvalQuickChecks = {
  allPassed: boolean;
  checks: EvalQuickCheckItem[];
  bucketCoverage?: EvalTriggerBucketCoverage;
};

export type EvalModuleResult = {
  key: EvalModuleKey | string;
  title: string;
  selected: boolean;
  status: "pass" | "fail" | "skipped" | string;
  passed?: boolean;
  score?: number;
  message?: string;
};

export type EvalGate = {
  quickBlockingPass: boolean;
  fullReleasePass?: boolean;
  partialRelease?: boolean;
  selectedModules: string[];
  failedModules: string[];
};

export type EvalEconomics = {
  grossTimeSavedMs: number;
  grossTokenSaved: number;
  negativeTimeWasteMs: number;
  negativeTokenWaste: number;
  netTimeSavedMs: number;
  netTokenSaved: number;
  netUsd?: number;
  baselineSamples: number;
  evaluatedPairs: number;
};

export type EvalPipelineOutput = {
  status: string;
  mode: EvalPipelineMode | string;
  summary: EvalPipelineSummary;
  quickChecks?: EvalQuickChecks;
  triggerClean: TriggerEvalOutput;
  triggerComplex?: TriggerEvalOutput;
  functional: FunctionalEvalOutput;
  functionalWithoutSkill?: FunctionalEvalOutput;
  moduleResults?: EvalModuleResult[];
  gate?: EvalGate;
  economics?: EvalEconomics;
  dimensionScores: EvalDimensionScores;
  triggerMetrics: EvalTriggerMetrics;
  costEstimate: EvalCostEstimate;
  deltaVsNoSkill?: EvalDeltaVsNoSkill;
  repeatStats: EvalRepeatStats;
  runMeta: EvalRunMeta;
  evidenceLevel?: "simulated" | "real";
  advisory?: EvalAdvisory;
  evidenceSummary?: EvalEvidenceSummary;
  reviewSummary?: EvalReviewSummary;
  finalVerdict?: string;
  overrideReason?: string;
  overrideAt?: number;
  overrideBy?: string;
  comparator?: EvalComparatorSummary;
  analyzer?: EvalAnalyzerSummary;
  taxonomyStatus?: "applied" | "skipped" | "failed";
  taxonomyMessage?: string;
  taxonomyApplied?: boolean;
  historyPath?: string;
  message?: string;
};

type EvalPipelineOutputRaw = {
  status: string;
  mode: EvalPipelineMode | string;
  summary: EvalPipelineSummary;
  quickChecks?: EvalQuickChecks;
  triggerClean: TriggerEvalOutputRaw;
  triggerComplex?: TriggerEvalOutputRaw;
  functional: FunctionalEvalOutputRaw;
  functionalWithoutSkill?: FunctionalEvalOutputRaw;
  moduleResults?: EvalModuleResult[];
  gate?: EvalGate;
  economics?: EvalEconomics;
  dimensionScores: EvalDimensionScores;
  triggerMetrics: EvalTriggerMetrics;
  costEstimate: EvalCostEstimate;
  deltaVsNoSkill?: EvalDeltaVsNoSkill;
  repeatStats: EvalRepeatStats;
  runMeta: EvalRunMeta;
  evidenceLevel?: "simulated" | "real";
  advisory?: EvalAdvisory;
  evidenceSummary?: EvalEvidenceSummary;
  reviewSummary?: EvalReviewSummary;
  finalVerdict?: string;
  overrideReason?: string;
  overrideAt?: number;
  overrideBy?: string;
  comparator?: EvalComparatorSummary;
  analyzer?: EvalAnalyzerSummary;
  taxonomyStatus?: "applied" | "skipped" | "failed";
  taxonomyMessage?: string;
  taxonomyApplied?: boolean;
  historyPath?: string;
  message?: string;
};

export type EvalPipelineRequest = {
  skillName: string;
  skillPath: string;
  triggerEvalSetPath: string;
  functionalEvalSetPath: string;
  mode: EvalPipelineMode;
  model: string;
  installedSkillsDir?: string;
  judgeModels?: string[];
  repeats?: number;
  seed?: number;
  temperature?: number;
  maxCostUsd?: number;
  selectedModules?: EvalModuleKey[];
  maxParallelArms?: number;
  triggerMaxWorkers?: number;
  functionalMaxWorkers?: number;
  runId?: string;
  judgeModel?: string;
  judgeApiKey?: string;
  judgeBaseUrl?: string;
  generatorModel?: string;
};

export type EvalSubmitReviewRequest = {
  path: string;
  finalVerdict: string;
  overrideGate?: boolean;
  overrideReason?: string;
  notes?: string;
  reviewer?: string;
  tags?: string[];
  failedCaseIds?: string[];
};

export type EvalPipelineEstimateRequest = {
  skillName: string;
  skillPath: string;
  triggerEvalSetPath: string;
  functionalEvalSetPath: string;
  mode: EvalPipelineMode;
  model: string;
  judgeModels?: string[];
  repeats?: number;
  maxCostUsd?: number;
  selectedModules?: EvalModuleKey[];
  maxParallelArms?: number;
  triggerMaxWorkers?: number;
  functionalMaxWorkers?: number;
};

export type EvalControlAction = "pause" | "resume" | "cancel";

export type EvalPipelineProgressEvent = {
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
  stageKey?: string;
  stageLabel?: string;
  stageIndex?: number;
  stageTotal?: number;
  stageProgressPercent?: number;
  totalProgressPercent?: number;
  totalCount?: number;
  completedCount?: number;
  activeCount?: number;
  failedCount?: number;
  maxParallelArms?: number;
  triggerMaxWorkers?: number;
  functionalMaxWorkers?: number;
  remainingSeconds?: number;
  reviewGateState?: "required" | "skipped" | "blocked" | string;
  caseStatuses?: Array<{ caseId: string; status: string; latencyMs?: number; tokens?: number }>;
};

function mapTriggerOutput(raw: TriggerEvalOutputRaw): TriggerEvalOutput {
  return {
    status: raw.status,
    skillName: raw.skill_name,
    message: raw.message,
    summary: raw.summary
      ? {
          total: raw.summary.total,
          passed: raw.summary.passed,
          failed: raw.summary.failed,
          passRate: raw.summary.pass_rate,
        }
      : undefined,
    results: raw.results?.map((item) => ({
      query: item.query,
      shouldTrigger: item.should_trigger,
      triggered: item.triggered,
      triggeredSkillName: item.triggered_skill_name ?? null,
      pass: item.pass,
      error: item.error,
      rawResponsePath: item.raw_response_path ?? null,
      latencyMs: item.latency_ms ?? null,
      inputTokens: item.input_tokens ?? null,
      outputTokens: item.output_tokens ?? null,
      judgeTraceId: item.judge_trace_id ?? null,
      errorType: item.error_type ?? null,
    })),
  };
}

function mapFunctionalOutput(raw: FunctionalEvalOutputRaw): FunctionalEvalOutput {
  return {
    status: raw.status,
    skillName: raw.skill_name,
    message: raw.message,
    summary: raw.summary
      ? {
          total: raw.summary.total,
          passed: raw.summary.passed,
          failed: raw.summary.failed,
          passRate: raw.summary.pass_rate,
        }
      : undefined,
    dimensionScores: raw.dimension_scores,
    results: raw.results?.map((item) => ({
      caseId: item.case_id,
      passed: item.passed,
      passRate: item.pass_rate,
      error: item.error,
      layer1Pass: item.layer1_pass,
      qualityScore: item.quality_score,
      dimensionScores: item.dimension_scores,
      judgeRationale: item.judge_rationale,
      judgeSuggestions: item.judge_suggestions,
      judgeSource: item.judge_source,
      rawResponsePath: item.raw_response_path ?? null,
      latencyMs: item.latency_ms ?? null,
      inputTokens: item.input_tokens ?? null,
      outputTokens: item.output_tokens ?? null,
      judgeTraceId: item.judge_trace_id ?? null,
      errorType: item.error_type ?? null,
    })),
  };
}

export async function appPing(): Promise<string> {
  return invokeWithError<string>("app_ping");
}

export async function skillsList(): Promise<SkillMeta[]> {
  return invokeWithError<SkillMeta[]>("skills_list");
}

export async function skillsRescanShapeTags(): Promise<SkillShapeTagScanResult> {
  return invokeWithError<SkillShapeTagScanResult>("skills_rescan_shape_tags");
}

export async function skillsGetInsights(): Promise<SkillInsight[]> {
  return invokeWithError<SkillInsight[]>("skills_get_insights");
}

export async function skillsGetContent(name: string): Promise<SkillDocument> {
  return invokeWithError<SkillDocument>("skills_get_content", { name });
}

export async function skillsSaveContent(
  name: string,
  content: string,
): Promise<SaveResult> {
  return invokeWithError<SaveResult>("skills_save_content", { name, content });
}

export async function skillsListFiles(name: string): Promise<SkillFileEntry[]> {
  return invokeWithError<SkillFileEntry[]>("skills_list_files", { name });
}

export async function skillsDeleteEverywhere(name: string): Promise<SkillDeleteEverywhereResult> {
  return invokeWithError<SkillDeleteEverywhereResult>("skills_delete_everywhere", { name });
}

export async function statsGet(days?: number): Promise<StatsResult> {
  return invokeWithError<StatsResult>("stats_get", { days });
}

export async function logsGet(query: LogsQuery): Promise<LogsResult> {
  return invokeWithError<LogsResult>("logs_get", query);
}

export async function rulesGet(): Promise<RulesContent> {
  return invokeWithError<RulesContent>("rules_get");
}

export async function rulesSave(content: string): Promise<RulesSaveResult> {
  return invokeWithError<RulesSaveResult>("rules_save", { content });
}

export async function gitListRepositories(): Promise<GitManagedRepository[]> {
  return invokeWithError<GitManagedRepository[]>("git_list_repositories");
}

export async function gitSyncSourcePath(): Promise<string> {
  return invokeWithError<string>("git_sync_source_path");
}

export async function gitGetGuideMarkdown(): Promise<GitGuideDocument> {
  return invokeWithError<GitGuideDocument>("git_get_guide_markdown");
}

export type GitAddRepositoryOptions = {
  alias?: string;
  scriptAfterAdd?: string;
  syncMode?: GitSyncMode;
  sourcePath?: string;
  localPath?: string;
};

export async function gitAddRepository(
  url: string,
  options: GitAddRepositoryOptions = {},
): Promise<GitManagedRepository> {
  const { alias, scriptAfterAdd, syncMode, sourcePath, localPath } = options;
  return invokeWithError<GitManagedRepository>("git_add_repository", {
    url,
    alias,
    scriptAfterAdd,
    script_after_add: scriptAfterAdd,
    syncMode,
    sync_mode: syncMode,
    sourcePath,
    source_path: sourcePath,
    localPath,
    local_path: localPath,
  });
}

export async function gitRemoveRepository(repositoryId: string): Promise<boolean> {
  return invokeWithError<boolean>("git_remove_repository", {
    repositoryId,
    repository_id: repositoryId,
  });
}

export async function gitUpdateRepositoryAlias(
  repositoryId: string,
  alias?: string,
): Promise<GitManagedRepository> {
  return invokeWithError<GitManagedRepository>("git_update_repository_alias", {
    repositoryId,
    repository_id: repositoryId,
    alias,
  });
}

export async function gitUpdateRepositorySyncPath(
  repositoryId: string,
  syncPath?: string,
): Promise<GitManagedRepository> {
  return invokeWithError<GitManagedRepository>("git_update_repository_sync_path", {
    repositoryId,
    repository_id: repositoryId,
    syncPath,
    sync_path: syncPath,
  });
}

export async function gitListSyncTree(
  repositoryId: string,
  parentRelativePath?: string,
): Promise<GitSyncTreeEntry[]> {
  return invokeWithError<GitSyncTreeEntry[]>("git_list_sync_tree", {
    repositoryId,
    repository_id: repositoryId,
    parentRelativePath,
    parent_relative_path: parentRelativePath,
  });
}

export async function gitUpdateRepositoryIgnoredPaths(
  repositoryId: string,
  ignorePaths: string[],
): Promise<GitUpdateIgnoreResult> {
  return invokeWithError<GitUpdateIgnoreResult>("git_update_repository_ignored_paths", {
    repositoryId,
    repository_id: repositoryId,
    ignorePaths,
    ignore_paths: ignorePaths,
  });
}

export async function gitOpenDirectory(path: string): Promise<boolean> {
  return invokeWithError<boolean>("git_open_directory", { path });
}

export async function gitOpenUrl(url: string): Promise<boolean> {
  return invokeWithError<boolean>("git_open_url", { url });
}

export async function gitSyncSkillsToRepo(
  repoPath: string,
  sourcePath?: string,
): Promise<GitSkillsSyncResult> {
  return invokeWithError<GitSkillsSyncResult>("git_sync_skills_to_repo", {
    repoPath,
    repo_path: repoPath,
    sourcePath,
    source_path: sourcePath,
  });
}

export async function gitStatus(repoPath?: string): Promise<GitStatus> {
  return invokeWithError<GitStatus>("git_status", {
    repoPath,
    repo_path: repoPath,
  });
}

export async function gitListCommitHistory(
  repoPath?: string,
  limit = 80,
): Promise<GitGraphCommit[]> {
  return invokeWithError<GitGraphCommit[]>("git_list_commit_history", {
    repoPath,
    repo_path: repoPath,
    limit,
  });
}

export async function gitCommit(message: string, repoPath?: string): Promise<GitCommitResult> {
  return invokeWithError<GitCommitResult>("git_commit", {
    message,
    repoPath,
    repo_path: repoPath,
  });
}

export async function gitPush(repoPath?: string): Promise<GitPushResult> {
  return invokeWithError<GitPushResult>("git_push", {
    repoPath,
    repo_path: repoPath,
  });
}

export async function setupStatus(): Promise<ToolStatus[]> {
  return invokeWithError<ToolStatus[]>("setup_status");
}

export async function setupRouterHealth(): Promise<ToolRouterHealthStatus[]> {
  return invokeWithError<ToolRouterHealthStatus[]>("setup_router_health");
}

export async function setupPathValidationMatrix(): Promise<BuiltInToolPathAudit[]> {
  return invokeWithError<BuiltInToolPathAudit[]>("setup_path_validation_matrix");
}

export async function setupLocalSkillsOverview(): Promise<LocalSkillsOverview> {
  return invokeWithError<LocalSkillsOverview>("setup_local_skills_overview");
}

export async function setupGetSkillConflictDetail(skillName: string): Promise<SkillConflictDetail> {
  return invokeWithError<SkillConflictDetail>("setup_get_skill_conflict_detail", { skillName });
}

export async function setupResolveSkillConflict(
  skillName: string,
  sourceId: string,
): Promise<SetupMutationResult> {
  return invokeWithError<SetupMutationResult>("setup_resolve_skill_conflict", {
    skillName,
    sourceId,
  });
}

export async function setupApply(
  tools: string[],
  skills?: SkillSyncConfig[],
): Promise<SetupApplyResult[]> {
  return invokeWithError<SetupApplyResult[]>("setup_apply", { tools, skills });
}

export async function setupGetCustomTools(): Promise<CustomTool[]> {
  return invokeWithError<CustomTool[]>("setup_get_custom_tools");
}

export async function setupAddCustomTool(tool: CustomTool): Promise<SetupMutationResult> {
  return invokeWithError<SetupMutationResult>("setup_add_custom_tool", {
    name: tool.name,
    id: tool.id,
    skills_dir: tool.skillsDir,
    rules_file: tool.rulesFile,
    icon: tool.icon,
  });
}

export async function setupRemoveCustomTool(id: string): Promise<SetupMutationResult> {
  return invokeWithError<SetupMutationResult>("setup_remove_custom_tool", { id });
}

export async function setupUpdateToolPaths(
  id: string,
  skillsDir: string,
  rulesFile?: string,
): Promise<SetupMutationResult> {
  return invokeWithError<SetupMutationResult>("setup_update_tool_paths", {
    id,
    skills_dir: skillsDir,
    rules_file: rulesFile,
  });
}

export async function setupSetToolAutoSync(
  id: string,
  enabled: boolean,
): Promise<SetupMutationResult> {
  return invokeWithError<SetupMutationResult>("setup_set_tool_auto_sync", { id, enabled });
}

export async function setupSetToolTrackingEnabled(
  id: string,
  enabled: boolean,
): Promise<SetupMutationResult> {
  return invokeWithError<SetupMutationResult>("setup_set_tool_tracking_enabled", { id, enabled });
}

export async function onboardingGetState(): Promise<OnboardingState> {
  return invokeWithError<OnboardingState>("onboarding_get_state");
}

export async function onboardingSetSkillsDir(
  dir: string,
  createIfMissing = false,
): Promise<OnboardingSetSkillsDirResult> {
  return invokeWithError<OnboardingSetSkillsDirResult>("onboarding_set_skills_dir", {
    dir,
    createIfMissing,
  });
}

export async function onboardingComplete(autoSync: boolean): Promise<OnboardingCompleteResult> {
  return invokeWithError<OnboardingCompleteResult>("onboarding_complete", { autoSync });
}

export async function onboardingImportInstalledSkills(): Promise<OnboardingImportSkillsResult> {
  return invokeWithError<OnboardingImportSkillsResult>("onboarding_import_installed_skills");
}

export async function setupGetImportMode(): Promise<string> {
  return invokeWithError<string>("setup_get_import_mode");
}

export async function setupSetImportMode(mode: string): Promise<SetupMutationResult> {
  return invokeWithError<SetupMutationResult>("setup_set_import_mode", { mode });
}

export async function installVscodeExtension(
  skillsDir: string,
): Promise<VscodeExtensionInstallResult> {
  return invokeWithError<VscodeExtensionInstallResult>("vscode_extension_install", {
    skillsDir,
    skills_dir: skillsDir,
  });
}

export async function syncVscodeSkillsRoot(
  skillsDir: string,
): Promise<VscodeSettingsSyncResult> {
  return invokeWithError<VscodeSettingsSyncResult>("vscode_extension_sync_skills_root", {
    skillsDir,
    skills_dir: skillsDir,
  });
}

export async function getVscodeExtensionStatus(): Promise<VscodeExtensionStatusResult> {
  return invokeWithError<VscodeExtensionStatusResult>("vscode_extension_status");
}

export async function uninstallVscodeExtension(): Promise<VscodeExtensionUninstallResult> {
  return invokeWithError<VscodeExtensionUninstallResult>("vscode_extension_uninstall");
}

export async function shouldCheckUpdates(): Promise<boolean> {
  return invokeWithError<boolean>("should_check_updates");
}

export async function getUpdateSettings(): Promise<UpdateSettings> {
  return invokeWithError<UpdateSettings>("get_update_settings");
}

export async function saveUpdateSettings(settings: UpdateSettings): Promise<void> {
  await invokeWithError<void>("save_update_settings", { settings });
}

export async function updateLastCheckTime(): Promise<void> {
  await invokeWithError<void>("update_last_check_time");
}

export async function savePendingUpdateNotes(
  version: string,
  releaseNotes: string,
  releaseNotesZh: string,
): Promise<void> {
  await invokeWithError<void>("save_pending_update_notes", {
    version,
    releaseNotes,
    release_notes: releaseNotes,
    releaseNotesZh,
    release_notes_zh: releaseNotesZh,
  });
}

export async function checkVersionJump(): Promise<VersionJumpInfo | null> {
  return invokeWithError<VersionJumpInfo | null>("check_version_jump");
}

export async function updateLog(
  level: "info" | "warn" | "error",
  message: string,
): Promise<void> {
  await invokeWithError<void>("update_log", {
    level,
    message,
  });
}

export async function evalGetConfig(): Promise<EvalConfig> {
  return invokeWithError<EvalConfig>("eval_get_config");
}

export async function evalGetStoragePaths(skillName?: string): Promise<EvalStoragePaths> {
  return invokeWithError<EvalStoragePaths>("eval_get_storage_paths", {
    skillName,
    skill_name: skillName,
  });
}

export async function evalListSampleGenerationHistory(
  request: EvalSampleGenerationHistoryRequest = {},
): Promise<EvalSampleGenerationTimingEntry[]> {
  return invokeWithError<EvalSampleGenerationTimingEntry[]>(
    "eval_list_sample_generation_history",
    {
      skillName: request.skillName,
      skill_name: request.skillName,
      model: request.model,
      limit: request.limit,
    },
    { reportGlobal: true },
  );
}

export async function evalEstimatePipeline(
  request: EvalPipelineEstimateRequest,
): Promise<EvalPipelineEstimate> {
  return invokeWithError<EvalPipelineEstimate>(
    "eval_estimate_pipeline",
    {
      skillName: request.skillName,
      skill_name: request.skillName,
      skillPath: request.skillPath,
      skill_path: request.skillPath,
      triggerEvalSetPath: request.triggerEvalSetPath,
      trigger_eval_set_path: request.triggerEvalSetPath,
      functionalEvalSetPath: request.functionalEvalSetPath,
      functional_eval_set_path: request.functionalEvalSetPath,
      mode: request.mode,
      model: request.model,
      judgeModels: request.judgeModels,
      judge_models: request.judgeModels,
      repeats: request.repeats,
      maxCostUsd: request.maxCostUsd,
      max_cost_usd: request.maxCostUsd,
      selectedModules: request.selectedModules,
      selected_modules: request.selectedModules,
      maxParallelArms: request.maxParallelArms,
      max_parallel_arms: request.maxParallelArms,
      triggerMaxWorkers: request.triggerMaxWorkers,
      trigger_max_workers: request.triggerMaxWorkers,
      functionalMaxWorkers: request.functionalMaxWorkers,
      functional_max_workers: request.functionalMaxWorkers,
    },
    { reportGlobal: true },
  );
}

export async function evalListHistory(
  skillName: string,
  limit = 20,
): Promise<EvalHistoryEntry[]> {
  return invokeWithError<EvalHistoryEntry[]>("eval_list_history", {
    skillName,
    skill_name: skillName,
    limit,
  });
}

export async function evalLoadHistory(path: string): Promise<EvalPipelineOutput> {
  const raw = await invokeWithError<EvalPipelineOutputRaw>(
    "eval_load_history",
    { path },
    { reportGlobal: true },
  );
  return {
    ...raw,
    evidenceLevel: raw.evidenceLevel ?? "simulated",
    triggerClean: mapTriggerOutput(raw.triggerClean),
    triggerComplex: raw.triggerComplex ? mapTriggerOutput(raw.triggerComplex) : undefined,
    functional: mapFunctionalOutput(raw.functional),
    functionalWithoutSkill: raw.functionalWithoutSkill
      ? mapFunctionalOutput(raw.functionalWithoutSkill)
      : undefined,
  };
}

export async function evalSubmitReview(
  request: EvalSubmitReviewRequest,
): Promise<EvalSubmitReviewResult> {
  return invokeWithError<EvalSubmitReviewResult>(
    "eval_submit_review",
    {
      path: request.path,
      finalVerdict: request.finalVerdict,
      final_verdict: request.finalVerdict,
      overrideGate: request.overrideGate,
      override_gate: request.overrideGate,
      overrideReason: request.overrideReason,
      override_reason: request.overrideReason,
      notes: request.notes,
      reviewer: request.reviewer,
      tags: request.tags,
      failedCaseIds: request.failedCaseIds,
      failed_case_ids: request.failedCaseIds,
    },
    { reportGlobal: true },
  );
}

export async function evalGetReview(path: string): Promise<EvalReviewDetail | null> {
  return invokeWithError<EvalReviewDetail | null>("eval_get_review", { path }, { reportGlobal: true });
}

export async function evalListReviewQueue(
  skillName: string,
  limit = 30,
): Promise<EvalReviewQueueItem[]> {
  return invokeWithError<EvalReviewQueueItem[]>(
    "eval_list_review_queue",
    {
      skillName,
      skill_name: skillName,
      limit,
    },
    { reportGlobal: true },
  );
}

export async function evalGenerateFeedbackDrafts(request: {
  path: string;
  triggerCount?: number;
  functionalCount?: number;
}): Promise<EvalSampleDrafts> {
  return invokeWithError<EvalSampleDrafts>(
    "eval_generate_feedback_drafts",
    {
      path: request.path,
      triggerCount: request.triggerCount,
      trigger_count: request.triggerCount,
      functionalCount: request.functionalCount,
      functional_count: request.functionalCount,
    },
    { reportGlobal: true },
  );
}

export async function evalReadEvidenceCase(request: {
  path: string;
  caseId: string;
  stage?: string;
}): Promise<EvalEvidenceCaseResult> {
  return invokeWithError<EvalEvidenceCaseResult>(
    "eval_read_evidence_case",
    {
      path: request.path,
      caseId: request.caseId,
      case_id: request.caseId,
      stage: request.stage,
    },
    { reportGlobal: true },
  );
}

export async function evalSaveConfig(config: EvalConfig): Promise<SetupMutationResult> {
  return invokeWithError<SetupMutationResult>("eval_save_config", {
    apiKey: config.apiKey,
    api_key: config.apiKey,
    provider: config.provider,
    baseUrl: config.baseUrl,
    base_url: config.baseUrl,
    sampleModel: config.sampleModel,
    sample_model: config.sampleModel,
    runModel: config.runModel,
    run_model: config.runModel,
    defaultModel: config.runModel,
    default_model: config.runModel,
    judgeModel: config.judgeModel ?? "",
    judge_model: config.judgeModel ?? "",
    sampleModelGroupId: config.sampleModelGroupId ?? "",
    sample_model_group_id: config.sampleModelGroupId ?? "",
    runModelGroupId: config.runModelGroupId ?? "",
    run_model_group_id: config.runModelGroupId ?? "",
    costCurrency: config.costCurrency,
    cost_currency: config.costCurrency,
    modelGroups: config.modelGroups ?? [],
    model_groups: config.modelGroups ?? [],
  });
}

export type ModelConnectionTestResult = {
  success: boolean;
  message: string;
};

export async function evalTestConnection(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
): Promise<ModelConnectionTestResult> {
  return invokeWithError<ModelConnectionTestResult>("eval_test_model_connection", {
    baseUrl,
    base_url: baseUrl,
    apiKey: apiKey || undefined,
    api_key: apiKey || undefined,
    model,
  });
}

export async function runTriggerEval(request: EvalRunRequest): Promise<TriggerEvalOutput> {
  const raw = await invokeWithError<TriggerEvalOutputRaw>(
    "run_trigger_eval",
    {
      skillName: request.skillName,
      evalSetPath: request.evalSetPath,
      envType: request.envType ?? "clean",
      installedSkillsDir: request.installedSkillsDir,
      model: request.model,
    },
    { reportGlobal: true },
  );
  return mapTriggerOutput(raw);
}

export async function runFunctionalEval(
  request: FunctionalEvalRunRequest,
): Promise<FunctionalEvalOutput> {
  const raw = await invokeWithError<FunctionalEvalOutputRaw>(
    "run_functional_eval",
    {
      skillName: request.skillName,
      skillPath: request.skillPath,
      evalSetPath: request.evalSetPath,
      compareMode: request.compareMode ?? "no_skill",
      model: request.model,
    },
    { reportGlobal: true },
  );
  return mapFunctionalOutput(raw);
}

export async function runEvalPipeline(request: EvalPipelineRequest): Promise<EvalPipelineOutput> {
  const raw = await invokeWithError<EvalPipelineOutputRaw>(
    "run_eval_pipeline",
    {
      skillName: request.skillName,
      skillPath: request.skillPath,
      triggerEvalSetPath: request.triggerEvalSetPath,
      functionalEvalSetPath: request.functionalEvalSetPath,
      mode: request.mode,
      model: request.model,
      installedSkillsDir: request.installedSkillsDir,
      judgeModels: request.judgeModels,
      repeats: request.repeats,
      seed: request.seed,
      temperature: request.temperature,
      maxCostUsd: request.maxCostUsd,
      maxParallelArms: request.maxParallelArms,
      max_parallel_arms: request.maxParallelArms,
      triggerMaxWorkers: request.triggerMaxWorkers,
      trigger_max_workers: request.triggerMaxWorkers,
      functionalMaxWorkers: request.functionalMaxWorkers,
      functional_max_workers: request.functionalMaxWorkers,
      selectedModules: request.selectedModules,
      selected_modules: request.selectedModules,
      runId: request.runId,
      run_id: request.runId,
      judgeModel: request.judgeModel,
      judge_model: request.judgeModel,
      judgeApiKey: request.judgeApiKey,
      judge_api_key: request.judgeApiKey,
      judgeBaseUrl: request.judgeBaseUrl,
      judge_base_url: request.judgeBaseUrl,
      generatorModel: request.generatorModel,
      generator_model: request.generatorModel,
    },
    { reportGlobal: true },
  );
  return {
    ...raw,
    evidenceLevel: raw.evidenceLevel ?? "simulated",
    triggerClean: mapTriggerOutput(raw.triggerClean),
    triggerComplex: raw.triggerComplex ? mapTriggerOutput(raw.triggerComplex) : undefined,
    functional: mapFunctionalOutput(raw.functional),
    functionalWithoutSkill: raw.functionalWithoutSkill
      ? mapFunctionalOutput(raw.functionalWithoutSkill)
      : undefined,
  };
}

export async function evalControl(runId: string, action: EvalControlAction): Promise<SetupMutationResult> {
  return invokeWithError<SetupMutationResult>("eval_control", {
    runId,
    action,
  });
}

export async function evalGenerateSamples(
  request: EvalSampleGenerateRequest,
): Promise<EvalSampleDrafts> {
  return invokeWithError<EvalSampleDrafts>(
    "eval_generate_samples",
    {
      skillName: request.skillName,
      skillPath: request.skillPath,
      model: request.model,
      triggerCount: request.triggerCount,
      functionalCount: request.functionalCount,
    },
    { reportGlobal: true },
  );
}

export async function evalSaveDataset(
  request: EvalDatasetSaveRequest,
): Promise<EvalDatasetSaveResult> {
  return invokeWithError<EvalDatasetSaveResult>("eval_save_dataset", {
    path: request.path,
    content: request.content,
    kind: request.kind,
    skillName: request.skillName,
    skill_name: request.skillName,
  });
}

export type EvalScorecard = {
  dimensions: Array<{ key: string; label: string; score: number; weight: number }>;
  overallScore: number;
  overallRating: number;
  radarData: number[];
  confidenceWarning?: string;
};

export async function evalRunAnalyzer(request: {
  resultPath: string;
  outputPath?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}): Promise<EvalAnalyzerSummary> {
  return invokeWithError<EvalAnalyzerSummary>("eval_run_analyzer", {
    result_path: request.resultPath,
    output_path: request.outputPath,
    model: request.model,
    api_key: request.apiKey,
    base_url: request.baseUrl,
  });
}

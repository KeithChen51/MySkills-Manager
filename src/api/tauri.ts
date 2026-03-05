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

async function invokeWithError<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    const message = normalizeInvokeError(error);
    reportGlobalError(message);
    throw new Error(message);
  }
}

export type SkillMeta = {
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  my_notes?: string;
  last_updated?: string;
  directory: string;
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
};

export type GitCommitResult = {
  success: boolean;
  hash: string;
};

export type GitPushResult = {
  success: boolean;
  error?: string;
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

export async function appPing(): Promise<string> {
  return invokeWithError<string>("app_ping");
}

export async function skillsList(): Promise<SkillMeta[]> {
  return invokeWithError<SkillMeta[]>("skills_list");
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

export async function gitStatus(): Promise<GitStatus> {
  return invokeWithError<GitStatus>("git_status");
}

export async function gitCommit(message: string): Promise<GitCommitResult> {
  return invokeWithError<GitCommitResult>("git_commit", { message });
}

export async function gitPush(): Promise<GitPushResult> {
  return invokeWithError<GitPushResult>("git_push");
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

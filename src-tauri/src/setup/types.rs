use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolCapabilities {
    pub native_skill_discovery: bool,
    pub instruction_chain_supported: bool,
    pub startup_injection_supported: bool,
    pub hook_config_supported: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub name: String,
    pub id: String,
    pub icon: Option<String>,
    pub skills_dir: String,
    pub rules_path: String,
    pub path_source: String,
    pub skills_dir_exists: bool,
    pub skills_dir_writable: bool,
    pub rules_path_exists: bool,
    pub rules_path_writable: bool,
    pub exists: bool,
    pub configured: bool,
    pub synced_skills: usize,
    pub sync_mode: String,
    pub last_sync_time: Option<String>,
    pub auto_sync: bool,
    pub tracking_enabled: bool,
    pub hook_configured: bool,
    pub integration_mode: String,
    pub capabilities: ToolCapabilities,
    pub is_custom: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillConflictVariant {
    pub source_id: String,
    pub source_name: String,
    pub content_hash: String,
    pub in_my_skills: bool,
    pub hash_matches_my_skills: bool,
    pub content: String,
    pub file_list: Vec<String>,
    pub source_dir: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillConflictDetail {
    pub skill_name: String,
    pub variants: Vec<SkillConflictVariant>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PathCandidateAudit {
    pub skills_dir: String,
    pub rules_path: String,
    pub skills_dir_exists: bool,
    pub skills_dir_writable: bool,
    pub rules_path_exists: bool,
    pub rules_path_writable: bool,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltInToolPathAudit {
    pub name: String,
    pub id: String,
    pub selected_skills_dir: String,
    pub selected_rules_path: String,
    pub path_source: String,
    pub selected_candidate_exists: bool,
    pub needs_manual_review: bool,
    pub candidates: Vec<PathCandidateAudit>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub tool: String,
    pub success: bool,
    pub action: String,
    pub sync_mode: String,
    pub synced_count: usize,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomTool {
    pub name: String,
    pub id: String,
    pub skills_dir: String,
    pub rules_file: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SetupMutationResult {
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillOverviewEntry {
    pub name: String,
    pub content_hash: String,
    pub duplicate_across_tools: bool,
    pub in_my_skills: bool,
    pub hash_matches_my_skills: bool,
    pub hash_conflicts_my_skills: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolSkillOverview {
    pub tool_id: String,
    pub tool_name: String,
    pub skills: Vec<SkillOverviewEntry>,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalSkillsOverview {
    pub tools: Vec<ToolSkillOverview>,
    pub duplicate_names: Vec<String>,
    pub total_skills: usize,
    pub unique_skills: usize,
    pub matched_in_my_skills: usize,
    pub missing_in_my_skills: usize,
    pub conflict_with_my_skills: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillSyncConfig {
    pub skill_name: String,
    pub enabled_tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolRouterHealthStatus {
    pub tool_id: String,
    pub tool_name: String,
    pub discoverable: bool,
    pub gate_present: bool,
    pub startup_injection_present: Option<bool>,
    pub last_usage_seen: Option<String>,
    pub health: String,
    pub reason: String,
}

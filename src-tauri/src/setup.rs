use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use config_store::{
    read_custom_tools, read_sync_config, read_tool_path_overrides, write_sync_config_file,
};
use tool_catalog::{built_in_tools, custom_tool_to_descriptor, ToolDescriptor};

mod config_store;
mod apply_engine;
mod rule_hook_ops;
mod sync_ops;
mod status_probe;
mod tool_registry;
mod tool_catalog;
mod skills_overview;
mod tool_mutations;
mod status_aggregation;
mod path_validation;
mod conflict_resolution;
mod router_health;
mod types;

pub use types::{
    ApplyResult, BuiltInToolPathAudit, CustomTool, LocalSkillsOverview, PathCandidateAudit,
    SetupMutationResult, SkillConflictDetail, SkillConflictVariant, SkillOverviewEntry,
    SkillSyncConfig, ToolCapabilities, ToolRouterHealthStatus, ToolSkillOverview, ToolStatus,
};

fn default_import_mode() -> String {
    "manual".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SyncConfigFile {
    #[serde(default = "default_sync_mode")]
    sync_mode: String,
    #[serde(default = "default_import_mode")]
    import_mode: String,
    #[serde(default)]
    skills: Vec<SkillSyncConfig>,
    #[serde(default)]
    auto_tools: Vec<String>,
    #[serde(default)]
    tracking_disabled_tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ToolPathOverride {
    id: String,
    skills_dir: String,
    rules_file: Option<String>,
}

#[derive(Debug, Clone)]
struct RollbackPath {
    path: PathBuf,
    existed: bool,
}

const TRACKER_BLOCK_START: &str =
    "<!-- [MySkills Manager] Skill usage tracking rule - DO NOT REMOVE -->";
const TRACKER_BLOCK_END: &str = "<!-- [/MySkills Manager] -->";
#[cfg(target_family = "windows")]
const CLAUDE_HOOK_REL_PATH: &str = ".claude/hooks/skill-tracker.ps1";
#[cfg(not(target_family = "windows"))]
const CLAUDE_HOOK_REL_PATH: &str = ".claude/hooks/skill-tracker.sh";

fn default_sync_mode() -> String {
    "symlink".to_string()
}

fn normalize_tool_ids(ids: Vec<String>) -> Vec<String> {
    let mut out = ids
        .into_iter()
        .map(|item| item.trim().to_lowercase())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    out.sort();
    out.dedup();
    out
}

fn write_sync_config(home: &Path, skills: &[SkillSyncConfig]) -> Result<(), String> {
    let existing = read_sync_config(home)?;

    let sync_mode = existing
        .as_ref()
        .map(|cfg| cfg.sync_mode.clone())
        .unwrap_or_else(default_sync_mode);
    let import_mode = existing
        .as_ref()
        .map(|cfg| cfg.import_mode.clone())
        .unwrap_or_else(default_import_mode);
    let auto_tools = existing
        .as_ref()
        .map(|cfg| cfg.auto_tools.clone())
        .unwrap_or_default();
    let tracking_disabled_tools = existing
        .map(|cfg| cfg.tracking_disabled_tools)
        .unwrap_or_default();
    write_sync_config_file(
        home,
        &SyncConfigFile {
            sync_mode,
            import_mode,
            skills: skills.to_vec(),
            auto_tools,
            tracking_disabled_tools,
        },
    )
}

fn all_tools(home: &Path) -> Result<Vec<ToolDescriptor>, String> {
    let overrides = read_tool_path_overrides(home)?;
    let mut tools = built_in_tools(home, &overrides);
    for custom in read_custom_tools(home)? {
        tools.push(custom_tool_to_descriptor(custom));
    }
    Ok(tools)
}

pub fn setup_skill_source_dirs_with_home(
    home: &Path,
) -> Result<Vec<(String, String, Vec<PathBuf>)>, String> {
    skills_overview::setup_skill_source_dirs_with_home(home)
}

pub fn local_skills_overview_with_home(home: &Path) -> Result<LocalSkillsOverview, String> {
    skills_overview::local_skills_overview_with_home(home)
}

pub fn setup_status_with_home(home: &Path) -> Result<Vec<ToolStatus>, String> {
    status_aggregation::setup_status_with_home(home)
}

pub fn setup_router_health_with_home(home: &Path) -> Result<Vec<ToolRouterHealthStatus>, String> {
    router_health::setup_router_health_with_home(home)
}

pub fn setup_path_validation_matrix_with_home(
    home: &Path,
) -> Result<Vec<BuiltInToolPathAudit>, String> {
    path_validation::setup_path_validation_matrix_with_home(home)
}

pub fn setup_get_skill_conflict_detail_with_home(
    home: &Path,
    skill_name: &str,
) -> Result<SkillConflictDetail, String> {
    conflict_resolution::setup_get_skill_conflict_detail_with_home(home, skill_name)
}

pub fn setup_resolve_skill_conflict_with_home(
    home: &Path,
    skill_name: &str,
    source_id: &str,
) -> Result<SetupMutationResult, String> {
    conflict_resolution::setup_resolve_skill_conflict_with_home(home, skill_name, source_id)
}

#[tauri::command]
pub fn setup_status() -> Result<Vec<ToolStatus>, String> {
    setup_status_with_home(&crate::root_dir::default_home_dir())
}

#[tauri::command]
pub fn setup_path_validation_matrix() -> Result<Vec<BuiltInToolPathAudit>, String> {
    setup_path_validation_matrix_with_home(&crate::root_dir::default_home_dir())
}

#[tauri::command]
pub fn setup_router_health() -> Result<Vec<ToolRouterHealthStatus>, String> {
    setup_router_health_with_home(&crate::root_dir::default_home_dir())
}

#[tauri::command]
pub fn setup_get_skill_conflict_detail(skill_name: String) -> Result<SkillConflictDetail, String> {
    setup_get_skill_conflict_detail_with_home(&crate::root_dir::default_home_dir(), &skill_name)
}

#[tauri::command]
pub fn setup_resolve_skill_conflict(
    skill_name: String,
    source_id: String,
) -> Result<SetupMutationResult, String> {
    setup_resolve_skill_conflict_with_home(
        &crate::root_dir::default_home_dir(),
        &skill_name,
        &source_id,
    )
}

#[tauri::command]
pub fn setup_local_skills_overview() -> Result<LocalSkillsOverview, String> {
    local_skills_overview_with_home(&crate::root_dir::default_home_dir())
}

pub fn get_custom_tools_with_home(home: &Path) -> Result<Vec<CustomTool>, String> {
    tool_mutations::get_custom_tools_with_home(home)
}

pub fn add_custom_tool_with_home(
    home: &Path,
    tool: CustomTool,
) -> Result<SetupMutationResult, String> {
    tool_mutations::add_custom_tool_with_home(home, tool)
}

pub fn remove_custom_tool_with_home(home: &Path, id: &str) -> Result<SetupMutationResult, String> {
    tool_mutations::remove_custom_tool_with_home(home, id)
}

pub fn update_tool_paths_with_home(
    home: &Path,
    id: &str,
    skills_dir: &str,
    rules_file: Option<&str>,
) -> Result<SetupMutationResult, String> {
    tool_mutations::update_tool_paths_with_home(home, id, skills_dir, rules_file)
}

pub fn set_tool_auto_sync_with_home(
    home: &Path,
    id: &str,
    enabled: bool,
) -> Result<SetupMutationResult, String> {
    tool_mutations::set_tool_auto_sync_with_home(home, id, enabled)
}

pub fn set_tool_tracking_enabled_with_home(
    home: &Path,
    id: &str,
    enabled: bool,
) -> Result<SetupMutationResult, String> {
    tool_mutations::set_tool_tracking_enabled_with_home(home, id, enabled)
}

#[tauri::command]
pub fn setup_get_custom_tools() -> Result<Vec<CustomTool>, String> {
    get_custom_tools_with_home(&crate::root_dir::default_home_dir())
}

#[tauri::command]
pub fn setup_add_custom_tool(
    name: String,
    id: String,
    skills_dir: String,
    rules_file: Option<String>,
    icon: Option<String>,
) -> Result<SetupMutationResult, String> {
    add_custom_tool_with_home(
        &crate::root_dir::default_home_dir(),
        CustomTool {
            name,
            id,
            skills_dir,
            rules_file,
            icon,
        },
    )
}

#[tauri::command]
pub fn setup_remove_custom_tool(id: String) -> Result<SetupMutationResult, String> {
    remove_custom_tool_with_home(&crate::root_dir::default_home_dir(), &id)
}

#[tauri::command]
pub fn setup_update_tool_paths(
    id: String,
    skills_dir: String,
    rules_file: Option<String>,
) -> Result<SetupMutationResult, String> {
    update_tool_paths_with_home(
        &crate::root_dir::default_home_dir(),
        &id,
        &skills_dir,
        rules_file.as_deref(),
    )
}

#[tauri::command]
pub fn setup_set_tool_auto_sync(id: String, enabled: bool) -> Result<SetupMutationResult, String> {
    set_tool_auto_sync_with_home(&crate::root_dir::default_home_dir(), &id, enabled)
}

#[tauri::command]
pub fn setup_set_tool_tracking_enabled(
    id: String,
    enabled: bool,
) -> Result<SetupMutationResult, String> {
    set_tool_tracking_enabled_with_home(&crate::root_dir::default_home_dir(), &id, enabled)
}

pub fn sync_saved_skill_to_copy_tools_with_home(
    home: &Path,
    skills_root: &Path,
    skill_name: &str,
) -> Result<usize, String> {
    apply_engine::sync_saved_skill_to_copy_tools_with_home(home, skills_root, skill_name)
}

pub fn apply_setup_with_paths(
    home: &Path,
    skills_root: &Path,
    tool_ids: &[String],
    skill_configs: Option<&[SkillSyncConfig]>,
) -> Result<Vec<ApplyResult>, String> {
    apply_engine::apply_setup_with_paths(home, skills_root, tool_ids, skill_configs)
}

#[tauri::command]
pub fn setup_apply(
    tools: Vec<String>,
    skills: Option<Vec<SkillSyncConfig>>,
) -> Result<Vec<ApplyResult>, String> {
    let home = crate::root_dir::default_home_dir();
    let skills_root = crate::root_dir::default_skills_root(&home);
    apply_setup_with_paths(&home, &skills_root, &tools, skills.as_deref())
}

fn get_import_mode_with_home(home: &Path) -> Result<String, String> {
    let config = read_sync_config(home)?;
    Ok(config
        .map(|cfg| cfg.import_mode)
        .unwrap_or_else(default_import_mode))
}

fn set_import_mode_with_home(home: &Path, mode: &str) -> Result<SetupMutationResult, String> {
    let valid_modes = ["manual", "prompt", "auto"];
    if !valid_modes.contains(&mode) {
        return Err(format!("Invalid import mode: {mode}. Valid modes: manual, prompt, auto"));
    }

    let mut config = read_sync_config(home)?.unwrap_or(SyncConfigFile {
        sync_mode: default_sync_mode(),
        import_mode: default_import_mode(),
        skills: Vec::new(),
        auto_tools: Vec::new(),
        tracking_disabled_tools: Vec::new(),
    });
    config.import_mode = mode.to_string();
    write_sync_config_file(home, &config)?;
    Ok(SetupMutationResult { success: true })
}

#[tauri::command]
pub fn setup_get_import_mode() -> Result<String, String> {
    get_import_mode_with_home(&crate::root_dir::default_home_dir())
}

#[tauri::command]
pub fn setup_set_import_mode(mode: String) -> Result<SetupMutationResult, String> {
    set_import_mode_with_home(&crate::root_dir::default_home_dir(), &mode)
}

#[cfg(test)]
mod tests;


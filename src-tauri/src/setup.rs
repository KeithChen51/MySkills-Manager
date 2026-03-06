use config_store::{
    read_custom_tools, read_sync_config, read_tool_path_overrides, with_sync_config_lock,
    write_sync_config_file,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tool_catalog::{built_in_tools, custom_tool_to_descriptor, ToolDescriptor};

mod apply_engine;
mod config_store;
mod conflict_resolution;
mod path_validation;
mod paths;
mod router_health;
mod rule_hook_ops;
mod skills_overview;
mod status_aggregation;
mod status_probe;
mod sync_ops;
mod tool_catalog;
mod tool_mutations;
mod tool_registry;
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

impl Default for SyncConfigFile {
    fn default() -> Self {
        Self {
            sync_mode: default_sync_mode(),
            import_mode: default_import_mode(),
            skills: Vec::new(),
            auto_tools: Vec::new(),
            tracking_disabled_tools: Vec::new(),
        }
    }
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
    with_sync_config_lock(|| {
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
    })
}

fn all_tools(home: &Path) -> Result<Vec<ToolDescriptor>, String> {
    let overrides = read_tool_path_overrides(home)?;
    let mut tools = built_in_tools(home, &overrides);
    for custom in read_custom_tools(home)? {
        tools.push(custom_tool_to_descriptor(custom));
    }
    Ok(tools)
}

pub fn all_tool_skill_dirs_with_home(home: &Path) -> Result<Vec<PathBuf>, String> {
    let overrides = read_tool_path_overrides(home)?;
    let built_in = tool_catalog::built_in_tool_resolutions(home, &overrides);
    let mut dirs = BTreeSet::<PathBuf>::new();

    for tool in built_in {
        dirs.insert(tool.descriptor.skills_dir);
        for candidate in tool.candidates {
            dirs.insert(candidate.skills_dir);
        }
    }

    for custom in read_custom_tools(home)? {
        let skills_dir = custom.skills_dir.trim();
        if !skills_dir.is_empty() {
            dirs.insert(PathBuf::from(skills_dir));
        }
    }

    Ok(dirs.into_iter().collect())
}

pub(crate) fn copy_skill_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    sync_ops::copy_dir_recursive(source, target)
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

const SETUP_BLOCKING_TIMEOUT_SECS: u64 = 60;

async fn run_setup_blocking<T, F>(task_name: &'static str, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let task = tauri::async_runtime::spawn_blocking(task);
    let joined = tokio::time::timeout(Duration::from_secs(SETUP_BLOCKING_TIMEOUT_SECS), task)
        .await
        .map_err(|_| format!("{task_name} timed out after {SETUP_BLOCKING_TIMEOUT_SECS}s"))?;
    joined.map_err(|e| format!("Run {task_name} task failed: {e}"))?
}

#[tauri::command]
pub async fn setup_status() -> Result<Vec<ToolStatus>, String> {
    let home = crate::root_dir::default_home_dir();
    run_setup_blocking("setup_status", move || setup_status_with_home(&home)).await
}

#[tauri::command]
pub async fn setup_path_validation_matrix() -> Result<Vec<BuiltInToolPathAudit>, String> {
    let home = crate::root_dir::default_home_dir();
    run_setup_blocking("setup_path_validation_matrix", move || {
        setup_path_validation_matrix_with_home(&home)
    })
    .await
}

#[tauri::command]
pub async fn setup_router_health() -> Result<Vec<ToolRouterHealthStatus>, String> {
    let home = crate::root_dir::default_home_dir();
    run_setup_blocking("setup_router_health", move || {
        setup_router_health_with_home(&home)
    })
    .await
}

#[tauri::command]
pub async fn setup_get_skill_conflict_detail(
    skill_name: String,
) -> Result<SkillConflictDetail, String> {
    let home = crate::root_dir::default_home_dir();
    run_setup_blocking("setup_get_skill_conflict_detail", move || {
        setup_get_skill_conflict_detail_with_home(&home, &skill_name)
    })
    .await
}

#[tauri::command]
pub async fn setup_resolve_skill_conflict(
    skill_name: String,
    source_id: String,
) -> Result<SetupMutationResult, String> {
    let home = crate::root_dir::default_home_dir();
    run_setup_blocking("setup_resolve_skill_conflict", move || {
        setup_resolve_skill_conflict_with_home(&home, &skill_name, &source_id)
    })
    .await
}

#[tauri::command]
pub async fn setup_local_skills_overview() -> Result<LocalSkillsOverview, String> {
    let home = crate::root_dir::default_home_dir();
    run_setup_blocking("setup_local_skills_overview", move || {
        local_skills_overview_with_home(&home)
    })
    .await
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
pub async fn setup_apply(
    tools: Vec<String>,
    skills: Option<Vec<SkillSyncConfig>>,
) -> Result<Vec<ApplyResult>, String> {
    let home = crate::root_dir::default_home_dir();
    let skills_root = crate::root_dir::default_skills_root(&home);
    run_setup_blocking("setup_apply", move || {
        apply_setup_with_paths(&home, &skills_root, &tools, skills.as_deref())
    })
    .await
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
        return Err(format!(
            "Invalid import mode: {mode}. Valid modes: manual, prompt, auto"
        ));
    }

    with_sync_config_lock(|| {
        let mut config = read_sync_config(home)?.unwrap_or_default();
        config.import_mode = mode.to_string();
        write_sync_config_file(home, &config)
    })?;
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

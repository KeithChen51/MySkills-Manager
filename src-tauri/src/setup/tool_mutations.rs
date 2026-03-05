use std::collections::HashSet;
use std::path::Path;

use super::config_store::{
    read_custom_tools, read_sync_config, read_tool_path_overrides, write_custom_tools,
    write_sync_config_file, write_tool_path_overrides,
};
use super::rule_hook_ops::{apply_hook_configuration, apply_instruction_gate};
use super::tool_catalog::is_built_in_tool_id;
use super::{
    all_tools, default_sync_mode, normalize_tool_ids, CustomTool, SetupMutationResult, SyncConfigFile,
    ToolPathOverride,
};

fn validate_tool_id(id: &str) -> Result<String, String> {
    let normalized = id.trim().to_lowercase();
    if normalized.is_empty() {
        return Err("Tool id is required".to_string());
    }
    let valid = normalized
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-' || ch == '_');
    if !valid {
        return Err("Tool id must use [a-z0-9_-]".to_string());
    }
    Ok(normalized)
}

pub(super) fn get_custom_tools_with_home(home: &Path) -> Result<Vec<CustomTool>, String> {
    read_custom_tools(home)
}

pub(super) fn add_custom_tool_with_home(
    home: &Path,
    mut tool: CustomTool,
) -> Result<SetupMutationResult, String> {
    tool.name = tool.name.trim().to_string();
    if tool.name.is_empty() {
        return Err("Tool name is required".to_string());
    }

    tool.id = validate_tool_id(&tool.id)?;
    tool.skills_dir = tool.skills_dir.trim().to_string();
    if tool.skills_dir.is_empty() {
        return Err("skillsDir is required".to_string());
    }
    tool.rules_file = tool.rules_file.map(|value| value.trim().to_string());
    if tool.rules_file.as_deref() == Some("") {
        tool.rules_file = None;
    }

    let mut custom = read_custom_tools(home)?;
    if is_built_in_tool_id(&tool.id) {
        return Err("Tool id conflicts with built-in tool".to_string());
    }
    if custom.iter().any(|item| item.id == tool.id) {
        return Err("Tool id already exists".to_string());
    }

    custom.push(tool);
    custom.sort_by(|a, b| a.id.cmp(&b.id));
    write_custom_tools(home, &custom)?;
    Ok(SetupMutationResult { success: true })
}

pub(super) fn remove_custom_tool_with_home(
    home: &Path,
    id: &str,
) -> Result<SetupMutationResult, String> {
    let tool_id = validate_tool_id(id)?;
    let mut custom = read_custom_tools(home)?;
    let before = custom.len();
    custom.retain(|item| item.id != tool_id);
    if custom.len() == before {
        return Ok(SetupMutationResult { success: true });
    }
    write_custom_tools(home, &custom)?;
    Ok(SetupMutationResult { success: true })
}

pub(super) fn update_tool_paths_with_home(
    home: &Path,
    id: &str,
    skills_dir: &str,
    rules_file: Option<&str>,
) -> Result<SetupMutationResult, String> {
    let tool_id = validate_tool_id(id)?;
    let normalized_skills_dir = skills_dir.trim();
    if normalized_skills_dir.is_empty() {
        return Err("skillsDir is required".to_string());
    }
    let normalized_rules_file = rules_file
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let mut custom_tools = read_custom_tools(home)?;
    if let Some(custom_tool) = custom_tools.iter_mut().find(|item| item.id == tool_id) {
        custom_tool.skills_dir = normalized_skills_dir.to_string();
        custom_tool.rules_file = normalized_rules_file;
        write_custom_tools(home, &custom_tools)?;

        let mut overrides = read_tool_path_overrides(home)?;
        let before = overrides.len();
        overrides.retain(|item| item.id != tool_id);
        if overrides.len() != before {
            write_tool_path_overrides(home, &overrides)?;
        }

        return Ok(SetupMutationResult { success: true });
    }

    if is_built_in_tool_id(&tool_id) {
        let mut overrides = read_tool_path_overrides(home)?;
        if let Some(existing) = overrides.iter_mut().find(|item| item.id == tool_id) {
            existing.skills_dir = normalized_skills_dir.to_string();
            existing.rules_file = normalized_rules_file;
        } else {
            overrides.push(ToolPathOverride {
                id: tool_id.clone(),
                skills_dir: normalized_skills_dir.to_string(),
                rules_file: normalized_rules_file,
            });
        }
        overrides.sort_by(|a, b| a.id.cmp(&b.id));
        write_tool_path_overrides(home, &overrides)?;
        return Ok(SetupMutationResult { success: true });
    }

    Err("Tool id not supported".to_string())
}

pub(super) fn set_tool_auto_sync_with_home(
    home: &Path,
    id: &str,
    enabled: bool,
) -> Result<SetupMutationResult, String> {
    let tool_id = validate_tool_id(id)?;
    let supported = all_tools(home)?.iter().any(|tool| tool.id == tool_id);
    if !supported {
        return Err("Tool id not supported".to_string());
    }

    let mut config = read_sync_config(home)?.unwrap_or(SyncConfigFile {
        sync_mode: default_sync_mode(),
        import_mode: super::default_import_mode(),
        skills: Vec::new(),
        auto_tools: Vec::new(),
        tracking_disabled_tools: Vec::new(),
    });

    let mut auto_tools = config.auto_tools.into_iter().collect::<HashSet<_>>();
    if enabled {
        auto_tools.insert(tool_id.clone());
    } else {
        auto_tools.remove(tool_id.as_str());
    }

    config.auto_tools = normalize_tool_ids(auto_tools.into_iter().collect());
    write_sync_config_file(home, &config)?;
    Ok(SetupMutationResult { success: true })
}

pub(super) fn set_tool_tracking_enabled_with_home(
    home: &Path,
    id: &str,
    enabled: bool,
) -> Result<SetupMutationResult, String> {
    let tool_id = validate_tool_id(id)?;
    let tools = all_tools(home)?;
    let Some(tool) = tools.iter().find(|item| item.id == tool_id) else {
        return Err("Tool id not supported".to_string());
    };

    let mut config = read_sync_config(home)?.unwrap_or(SyncConfigFile {
        sync_mode: default_sync_mode(),
        import_mode: super::default_import_mode(),
        skills: Vec::new(),
        auto_tools: Vec::new(),
        tracking_disabled_tools: Vec::new(),
    });

    let mut disabled_tools = config
        .tracking_disabled_tools
        .into_iter()
        .collect::<HashSet<_>>();
    if enabled {
        disabled_tools.remove(tool_id.as_str());
    } else {
        disabled_tools.insert(tool_id.clone());
    }

    config.tracking_disabled_tools = normalize_tool_ids(disabled_tools.into_iter().collect());
    write_sync_config_file(home, &config)?;

    if tool.capabilities.instruction_chain_supported {
        if let Some(rules_path) = tool.rules_path.as_ref() {
            apply_instruction_gate(&tool_id, rules_path, enabled)?;
        }
    }

    if tool.capabilities.hook_config_supported {
        apply_hook_configuration(home, &tool_id, enabled)?;
    }

    Ok(SetupMutationResult { success: true })
}

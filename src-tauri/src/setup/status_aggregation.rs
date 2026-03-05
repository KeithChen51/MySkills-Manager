use std::collections::HashSet;
use std::fs;
use std::path::Path;

use super::config_store::read_sync_config;
use super::status_probe::{detect_claude_hook, detect_sync_stats, file_contains_marker};
use super::{all_tools, ToolStatus};

fn integration_mode(capabilities: &super::ToolCapabilities) -> String {
    if capabilities.native_skill_discovery && capabilities.instruction_chain_supported {
        "native".to_string()
    } else {
        "fallback".to_string()
    }
}

fn detect_hook_configuration(home: &Path, tool: &super::tool_catalog::ToolDescriptor) -> bool {
    if !tool.capabilities.hook_config_supported {
        return false;
    }

    match tool.id.as_str() {
        "claude-code" => detect_claude_hook(home),
        _ => false,
    }
}

pub(super) fn path_writable(path: &Path) -> bool {
    if let Ok(metadata) = fs::metadata(path) {
        return !metadata.permissions().readonly();
    }

    path.parent()
        .and_then(|parent| fs::metadata(parent).ok())
        .map(|metadata| !metadata.permissions().readonly())
        .unwrap_or(false)
}

pub(super) fn setup_status_with_home(home: &Path) -> Result<Vec<ToolStatus>, String> {
    let sync_config = read_sync_config(home)?;
    let auto_tools = sync_config
        .as_ref()
        .map(|cfg| cfg.auto_tools.iter().cloned().collect::<HashSet<_>>())
        .unwrap_or_default();
    let tracking_disabled_tools = sync_config
        .map(|cfg| {
            cfg.tracking_disabled_tools
                .into_iter()
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let mut list = Vec::<ToolStatus>::new();
    for tool in all_tools(home)? {
        let skills_dir_exists = tool.skills_dir.is_dir();
        let skills_dir_writable = path_writable(&tool.skills_dir);
        let rules_path_exists = tool
            .rules_path
            .as_ref()
            .map(|path| path.exists())
            .unwrap_or(false);
        let rules_path_writable = tool
            .rules_path
            .as_ref()
            .map(|path| path_writable(path))
            .unwrap_or(false);
        let exists = tool
            .skills_dir
            .parent()
            .map(|parent| parent.exists())
            .unwrap_or(false);
        let configured = tool
            .rules_path
            .as_ref()
            .map(|path| file_contains_marker(path))
            .unwrap_or(false);
        let (synced_skills, sync_mode, last_sync_time) = detect_sync_stats(&tool.skills_dir)?;
        let hook_configured = detect_hook_configuration(home, &tool);

        list.push(ToolStatus {
            name: tool.name.clone(),
            id: tool.id.clone(),
            icon: tool.icon.clone(),
            skills_dir: tool.skills_dir.to_string_lossy().to_string(),
            rules_path: tool
                .rules_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_default(),
            path_source: tool.path_source.clone(),
            skills_dir_exists,
            skills_dir_writable,
            rules_path_exists,
            rules_path_writable,
            exists,
            configured,
            synced_skills,
            sync_mode,
            last_sync_time,
            auto_sync: auto_tools.contains(&tool.id),
            tracking_enabled: !tracking_disabled_tools.contains(&tool.id),
            hook_configured,
            integration_mode: integration_mode(&tool.capabilities),
            capabilities: tool.capabilities.clone(),
            is_custom: tool.is_custom,
        });
    }
    Ok(list)
}

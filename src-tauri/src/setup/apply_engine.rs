use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

const ANTIGRAVITY_MANAGED_WORKFLOW_MANIFEST: &str = ".myskills-managed-workflows.json";
const MYSKILLS_ROUTER_SKILL_NAME: &str = "myskills-router";
const MYSKILLS_ROUTER_SKILL_MD: &str =
    include_str!("../../../builtin-skills/myskills-router/SKILL.md");

fn is_skill_enabled_for_tool(
    skill_name: &str,
    tool_id: &str,
    config_skills: Option<&[super::SkillSyncConfig]>,
) -> bool {
    let Some(config_skills) = config_skills else {
        return true;
    };

    let Some(config) = config_skills
        .iter()
        .find(|item| item.skill_name == skill_name)
    else {
        return false;
    };

    config
        .enabled_tools
        .iter()
        .any(|enabled| enabled == tool_id)
}

fn configured_skills(
    stored_sync_config: Option<&super::SyncConfigFile>,
) -> Option<&[super::SkillSyncConfig]> {
    stored_sync_config.and_then(|cfg| {
        if cfg.skills.is_empty() {
            None
        } else {
            Some(cfg.skills.as_slice())
        }
    })
}

fn is_tracking_enabled_for_tool(tool_id: &str, tracking_disabled_tools: &HashSet<String>) -> bool {
    !tracking_disabled_tools.contains(tool_id)
}

fn antigravity_root_dir(home: &Path, skills_dir: &Path) -> PathBuf {
    if let Some(parent) = skills_dir.parent() {
        if parent
            .file_name()
            .map(|name| name.to_string_lossy().eq_ignore_ascii_case("antigravity"))
            .unwrap_or(false)
        {
            return parent.to_path_buf();
        }
    }
    home.join(".gemini").join("antigravity")
}

fn antigravity_workflows_dir(home: &Path, skills_dir: &Path) -> PathBuf {
    antigravity_root_dir(home, skills_dir).join("global_workflows")
}

fn antigravity_workflow_alias_file_name(skill_name: &str) -> String {
    let mut safe = String::with_capacity(skill_name.len());
    for ch in skill_name.chars() {
        if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
            safe.push('-');
        } else {
            safe.push(ch);
        }
    }
    let trimmed = safe.trim().trim_end_matches('.').to_string();
    let base = if trimmed.is_empty() {
        "skill".to_string()
    } else {
        trimmed
    };
    format!("{base}.md")
}

fn read_antigravity_managed_workflow_manifest(workflows_dir: &Path) -> HashSet<String> {
    let manifest_path = workflows_dir.join(ANTIGRAVITY_MANAGED_WORKFLOW_MANIFEST);
    if !manifest_path.exists() {
        return HashSet::new();
    }

    fs::read_to_string(manifest_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
        .map(|items| items.into_iter().collect::<HashSet<_>>())
        .unwrap_or_default()
}

fn write_antigravity_managed_workflow_manifest(
    workflows_dir: &Path,
    managed_files: &HashSet<String>,
) -> Result<(), String> {
    let mut sorted = managed_files.iter().cloned().collect::<Vec<_>>();
    sorted.sort();
    let raw =
        serde_json::to_string(&sorted).map_err(|e| format!("Serialize manifest failed: {e}"))?;
    let manifest_path = workflows_dir.join(ANTIGRAVITY_MANAGED_WORKFLOW_MANIFEST);
    fs::write(manifest_path, raw).map_err(|e| format!("Write manifest failed: {e}"))
}

fn sync_antigravity_single_workflow_alias(
    home: &Path,
    skills_dir: &Path,
    skill_name: &str,
    source_file: &Path,
) -> Result<(), String> {
    let workflows_dir = antigravity_workflows_dir(home, skills_dir);
    fs::create_dir_all(&workflows_dir).map_err(|e| format!("Create workflows dir failed: {e}"))?;

    let alias_name = antigravity_workflow_alias_file_name(skill_name);
    let target_file = workflows_dir.join(&alias_name);
    super::sync_ops::sync_skill_file(source_file, &target_file)?;

    let mut managed = read_antigravity_managed_workflow_manifest(&workflows_dir);
    managed.insert(alias_name);
    write_antigravity_managed_workflow_manifest(&workflows_dir, &managed)
}

fn sync_antigravity_workflow_aliases(
    home: &Path,
    skills_dir: &Path,
    aliases: &BTreeMap<String, PathBuf>,
) -> Result<usize, String> {
    let workflows_dir = antigravity_workflows_dir(home, skills_dir);
    fs::create_dir_all(&workflows_dir).map_err(|e| format!("Create workflows dir failed: {e}"))?;

    let previous_managed = read_antigravity_managed_workflow_manifest(&workflows_dir);
    let mut current_managed = HashSet::<String>::new();

    for (alias_name, source_file) in aliases {
        let target_file = workflows_dir.join(alias_name);
        super::sync_ops::sync_skill_file(source_file, &target_file)?;
        current_managed.insert(alias_name.clone());
    }

    for stale_file in previous_managed {
        if current_managed.contains(&stale_file) {
            continue;
        }
        super::sync_ops::remove_if_exists(&workflows_dir.join(stale_file))?;
    }

    write_antigravity_managed_workflow_manifest(&workflows_dir, &current_managed)?;
    Ok(current_managed.len())
}

fn ensure_router_skill_source(skills_root: &Path) -> Result<PathBuf, String> {
    let source_dir = skills_root.join(MYSKILLS_ROUTER_SKILL_NAME);
    let source_file = source_dir.join("SKILL.md");
    fs::create_dir_all(&source_dir)
        .map_err(|e| format!("Create myskills-router source dir failed: {e}"))?;

    let should_write = match fs::read_to_string(&source_file) {
        Ok(existing) => existing != MYSKILLS_ROUTER_SKILL_MD,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => true,
        Err(err) => return Err(format!("Read myskills-router source failed: {err}")),
    };
    if should_write {
        fs::write(&source_file, MYSKILLS_ROUTER_SKILL_MD)
            .map_err(|e| format!("Write myskills-router source failed: {e}"))?;
    }

    Ok(source_dir)
}

fn ensure_codex_router_seeded(skills_root: &Path, codex_skills_dir: &Path) -> Result<bool, String> {
    let target_dir = codex_skills_dir.join(MYSKILLS_ROUTER_SKILL_NAME);
    if target_dir.join("SKILL.md").exists() {
        return Ok(false);
    }

    let source_dir = ensure_router_skill_source(skills_root)?;
    super::sync_ops::copy_dir_recursive(&source_dir, &target_dir)?;
    Ok(true)
}

pub(super) fn sync_saved_skill_to_copy_tools_with_home(
    home: &Path,
    skills_root: &Path,
    skill_name: &str,
) -> Result<usize, String> {
    let tools = super::all_tools(home)?;
    let stored_sync_config = super::read_sync_config(home)?;
    let config_ref = configured_skills(stored_sync_config.as_ref());

    let source_dir = crate::skills::list_skills(skills_root)?
        .into_iter()
        .find(|item| item.name == skill_name)
        .map(|item| PathBuf::from(item.directory))
        .unwrap_or_else(|| skills_root.join(skill_name));

    let source_file = source_dir.join("SKILL.md");
    if !source_file.exists() {
        return Ok(0);
    }

    let mut synced = 0usize;
    for tool in tools {
        if !tool
            .skills_dir
            .parent()
            .map(|parent| parent.exists())
            .unwrap_or(false)
        {
            continue;
        }
        if !is_skill_enabled_for_tool(skill_name, &tool.id, config_ref) {
            continue;
        }

        let (_, mode, _) = super::status_probe::detect_sync_stats(&tool.skills_dir)?;
        if mode != "copy" {
            continue;
        }

        let target_dir = tool.skills_dir.join(skill_name);
        super::sync_ops::copy_dir_recursive(&source_dir, &target_dir)?;

        if tool.capabilities.startup_injection_supported && tool.id == "antigravity" {
            sync_antigravity_single_workflow_alias(
                home,
                &tool.skills_dir,
                skill_name,
                &source_file,
            )?;
        }
        synced += 1;
    }

    Ok(synced)
}

pub(super) fn apply_setup_with_paths(
    home: &Path,
    skills_root: &Path,
    tool_ids: &[String],
    skill_configs: Option<&[super::SkillSyncConfig]>,
) -> Result<Vec<super::ApplyResult>, String> {
    let tools = super::all_tools(home)?;
    let skills = crate::skills::list_skills(skills_root)?;
    if let Some(configs) = skill_configs {
        super::write_sync_config(home, configs)?;
    }
    let stored_sync_config = super::read_sync_config(home)?;
    let config_ref = configured_skills(stored_sync_config.as_ref());
    let tracking_disabled_tools = stored_sync_config
        .as_ref()
        .map(|cfg| {
            cfg.tracking_disabled_tools
                .iter()
                .cloned()
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let mut out = Vec::<super::ApplyResult>::new();
    let mut rollback_paths = Vec::<super::RollbackPath>::new();

    for tool_id in tool_ids {
        let Some(tool) = tools.iter().find(|item| item.id == tool_id.as_str()) else {
            return Ok(super::sync_ops::finalize_with_rollback(
                out,
                super::ApplyResult {
                    tool: tool_id.clone(),
                    success: false,
                    action: "unknown tool".to_string(),
                    sync_mode: "none".to_string(),
                    synced_count: 0,
                    error: Some("Tool id not supported".to_string()),
                },
                &rollback_paths,
            ));
        };

        if let Err(err) = fs::create_dir_all(&tool.skills_dir) {
            return Ok(super::sync_ops::finalize_with_rollback(
                out,
                super::ApplyResult {
                    tool: tool.id.clone(),
                    success: false,
                    action: "create target skills dir failed".to_string(),
                    sync_mode: "none".to_string(),
                    synced_count: 0,
                    error: Some(format!("{err}")),
                },
                &rollback_paths,
            ));
        }

        let mut synced_count = 0usize;
        let mut removed_count = 0usize;
        let sync_mode = "copy".to_string();
        let mut failure: Option<String> = None;
        let mut antigravity_aliases = BTreeMap::<String, PathBuf>::new();
        let should_manage_antigravity_workflows =
            tool.capabilities.startup_injection_supported && tool.id == "antigravity";

        // Stage A: sync skills content.
        for skill in &skills {
            let source_dir = PathBuf::from(&skill.directory);
            let source_file = source_dir.join("SKILL.md");
            let target_dir = tool.skills_dir.join(&skill.name);

            if !is_skill_enabled_for_tool(&skill.name, &tool.id, config_ref) {
                if target_dir.exists() {
                    if let Err(err) = super::sync_ops::remove_if_exists(&target_dir) {
                        failure = Some(err);
                        break;
                    }
                }
                removed_count += 1;
                continue;
            }

            match super::sync_ops::copy_dir_recursive(&source_dir, &target_dir) {
                Ok(()) => {
                    if should_manage_antigravity_workflows {
                        antigravity_aliases.insert(
                            antigravity_workflow_alias_file_name(&skill.name),
                            source_file,
                        );
                    }
                    synced_count += 1;
                }
                Err(err) => {
                    failure = Some(err);
                    break;
                }
            }
        }

        if let Some(error) = failure {
            let failure_result = super::ApplyResult {
                tool: tool.id.clone(),
                success: false,
                action: "skill sync stage failed".to_string(),
                sync_mode: if synced_count == 0 {
                    "none".to_string()
                } else {
                    sync_mode
                },
                synced_count,
                error: Some(error),
            };
            return Ok(super::sync_ops::finalize_with_rollback(
                out,
                failure_result,
                &rollback_paths,
            ));
        }

        let mut router_seeded = false;
        if tool.id == "codex" && tool.capabilities.native_skill_discovery {
            match ensure_codex_router_seeded(skills_root, &tool.skills_dir) {
                Ok(seed_applied) => {
                    if seed_applied {
                        synced_count += 1;
                        router_seeded = true;
                    }
                }
                Err(err) => {
                    let failure_result = super::ApplyResult {
                        tool: tool.id.clone(),
                        success: false,
                        action: "skill sync stage failed".to_string(),
                        sync_mode: if synced_count == 0 {
                            "none".to_string()
                        } else {
                            sync_mode.clone()
                        },
                        synced_count,
                        error: Some(err),
                    };
                    return Ok(super::sync_ops::finalize_with_rollback(
                        out,
                        failure_result,
                        &rollback_paths,
                    ));
                }
            }
        }

        let mut action_parts = vec![format!(
            "synced {synced_count} skills to {} (removed {removed_count})",
            tool.skills_dir.to_string_lossy()
        )];
        if router_seeded {
            action_parts.push("seeded myskills-router".to_string());
        }

        let tracking_enabled = is_tracking_enabled_for_tool(&tool.id, &tracking_disabled_tools);

        // Stage B: instruction-chain gate (rules block) if supported.
        if tool.capabilities.instruction_chain_supported {
            if let Some(rules_path) = tool.rules_path.as_ref() {
                super::sync_ops::register_rollback_path(&mut rollback_paths, rules_path);
                match super::rule_hook_ops::apply_instruction_gate(
                    &tool.id,
                    rules_path,
                    tracking_enabled,
                ) {
                    Ok(action) => action_parts.push(action),
                    Err(err) => {
                        let failure_result = super::ApplyResult {
                            tool: tool.id.clone(),
                            success: false,
                            action: "instruction gate stage failed".to_string(),
                            sync_mode: if synced_count == 0 {
                                "none".to_string()
                            } else {
                                sync_mode.clone()
                            },
                            synced_count,
                            error: Some(err),
                        };
                        return Ok(super::sync_ops::finalize_with_rollback(
                            out,
                            failure_result,
                            &rollback_paths,
                        ));
                    }
                }
            }
        }

        // Stage C: optional startup bootstrap (plugin/workflow/hook).
        if should_manage_antigravity_workflows {
            match sync_antigravity_workflow_aliases(home, &tool.skills_dir, &antigravity_aliases) {
                Ok(count) => action_parts.push(format!("updated {count} antigravity workflows")),
                Err(err) => action_parts.push(format!("startup bootstrap skipped: {err}")),
            }
        }

        if tool.capabilities.hook_config_supported {
            super::sync_ops::register_rollback_path(
                &mut rollback_paths,
                &home.join(super::CLAUDE_HOOK_REL_PATH),
            );
            super::sync_ops::register_rollback_path(
                &mut rollback_paths,
                &home.join(".claude").join("settings.json"),
            );
            match super::rule_hook_ops::apply_hook_configuration(home, &tool.id, tracking_enabled) {
                Ok(Some(action)) => action_parts.push(action),
                Ok(None) => {}
                Err(err) => action_parts.push(format!("hook setup skipped: {err}")),
            }
        }

        out.push(super::ApplyResult {
            tool: tool.id.clone(),
            success: true,
            action: action_parts.join("; "),
            sync_mode: if synced_count == 0 {
                "none".to_string()
            } else {
                sync_mode
            },
            synced_count,
            error: None,
        });
    }

    Ok(out)
}

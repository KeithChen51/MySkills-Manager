use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use super::tool_catalog::ToolDescriptor;
use super::{all_tools, LocalSkillsOverview, SkillOverviewEntry, ToolSkillOverview};

fn tool_skill_source_dirs(home: &Path, tool: &ToolDescriptor) -> Vec<PathBuf> {
    let mut dirs = vec![tool.skills_dir.clone(), tool.skills_dir.join(".system")];
    if tool.id == "codex" {
        let superpowers_dir = home.join(".codex").join("superpowers").join("skills");
        if !dirs.iter().any(|path| path == &superpowers_dir) {
            dirs.push(superpowers_dir);
        }
    }
    dirs
}

pub(super) fn setup_skill_source_dirs_with_home(
    home: &Path,
) -> Result<Vec<(String, String, Vec<PathBuf>)>, String> {
    let mut out = Vec::<(String, String, Vec<PathBuf>)>::new();
    for tool in all_tools(home)? {
        let sources = tool_skill_source_dirs(home, &tool);
        out.push((tool.id, tool.name, sources));
    }
    Ok(out)
}

fn skill_hashes_by_name(root: &Path) -> Result<HashMap<String, String>, String> {
    let mut out = HashMap::<String, String>::new();
    if !root.exists() {
        return Ok(out);
    }

    let skills = crate::skills::list_skills(root)?;
    for skill in skills {
        let skill_dir = PathBuf::from(&skill.directory);
        let hash = super::sync_ops::dir_content_hash(&skill_dir)?;
        out.insert(skill.name, hash);
    }

    Ok(out)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NameSyncState {
    Missing,
    Matched,
    Conflict,
}

pub(super) fn local_skills_overview_with_home(home: &Path) -> Result<LocalSkillsOverview, String> {
    let sources = setup_skill_source_dirs_with_home(home)?;
    let my_skill_hashes = skill_hashes_by_name(&crate::root_dir::default_skills_root(home))?;

    let mut raw_tools = Vec::<(String, String, Vec<(String, String)>)>::new();
    let mut name_to_tools = HashMap::<String, usize>::new();
    let mut name_to_hashes = HashMap::<String, HashSet<String>>::new();
    let mut total_skills = 0usize;

    for (tool_id, tool_name, source_dirs) in sources {
        let mut seen = HashMap::<String, String>::new();
        for source_dir in source_dirs {
            if !source_dir.exists() {
                continue;
            }
            let skills = crate::skills::list_skills(&source_dir)?;
            for skill in skills {
                if seen.contains_key(&skill.name) {
                    continue;
                }
                let skill_dir = PathBuf::from(&skill.directory);
                let hash = super::sync_ops::dir_content_hash(&skill_dir)?;
                seen.insert(skill.name, hash);
            }
        }

        if seen.is_empty() {
            continue;
        }

        let mut named_hashes = seen.into_iter().collect::<Vec<_>>();
        named_hashes.sort_by(|a, b| a.0.cmp(&b.0));
        total_skills += named_hashes.len();
        for (name, hash) in &named_hashes {
            *name_to_tools.entry(name.clone()).or_insert(0) += 1;
            name_to_hashes
                .entry(name.clone())
                .or_default()
                .insert(hash.clone());
        }

        raw_tools.push((tool_id, tool_name, named_hashes));
    }

    let mut duplicate_names = name_to_tools
        .iter()
        .filter(|(_, count)| **count > 1)
        .map(|(name, _)| name.clone())
        .collect::<Vec<_>>();
    duplicate_names.sort();
    let duplicate_name_set = duplicate_names.iter().cloned().collect::<HashSet<_>>();

    let mut name_states = HashMap::<String, NameSyncState>::new();
    for (name, hashes) in &name_to_hashes {
        let state = match my_skill_hashes.get(name) {
            None => NameSyncState::Missing,
            Some(my_hash) => {
                if hashes.iter().all(|hash| hash == my_hash) {
                    NameSyncState::Matched
                } else {
                    NameSyncState::Conflict
                }
            }
        };
        name_states.insert(name.clone(), state);
    }

    let matched_in_my_skills = name_states
        .values()
        .filter(|state| **state == NameSyncState::Matched)
        .count();
    let missing_in_my_skills = name_states
        .values()
        .filter(|state| **state == NameSyncState::Missing)
        .count();
    let conflict_with_my_skills = name_states
        .values()
        .filter(|state| **state == NameSyncState::Conflict)
        .count();

    let mut tools = Vec::<ToolSkillOverview>::new();
    for (tool_id, tool_name, named_hashes) in raw_tools {
        let skills = named_hashes
            .into_iter()
            .map(|(name, content_hash)| {
                let my_hash = my_skill_hashes.get(&name);
                let in_my_skills = my_hash.is_some();
                let hash_matches_my_skills =
                    my_hash.map(|hash| hash == &content_hash).unwrap_or(false);

                SkillOverviewEntry {
                    duplicate_across_tools: duplicate_name_set.contains(&name),
                    hash_conflicts_my_skills: in_my_skills && !hash_matches_my_skills,
                    hash_matches_my_skills,
                    in_my_skills,
                    name,
                    content_hash,
                }
            })
            .collect::<Vec<_>>();

        tools.push(ToolSkillOverview {
            count: skills.len(),
            skills,
            tool_id,
            tool_name,
        });
    }

    tools.sort_by(|a, b| a.tool_name.cmp(&b.tool_name));

    Ok(LocalSkillsOverview {
        conflict_with_my_skills,
        matched_in_my_skills,
        missing_in_my_skills,
        unique_skills: name_to_tools.len(),
        tools,
        duplicate_names,
        total_skills,
    })
}

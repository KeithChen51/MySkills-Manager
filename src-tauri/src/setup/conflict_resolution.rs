use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::{
    setup_skill_source_dirs_with_home, SetupMutationResult, SkillConflictDetail,
    SkillConflictVariant,
};

fn my_skill_dir(root: &Path, skill_name: &str) -> Option<PathBuf> {
    crate::skills::list_skills(root)
        .ok()
        .and_then(|skills| {
            skills
                .into_iter()
                .find(|skill| skill.name == skill_name)
                .map(|skill| PathBuf::from(skill.directory))
        })
        .filter(|dir| dir.join("SKILL.md").exists())
}

fn first_tool_skill_dir(source_dirs: &[PathBuf], skill_name: &str) -> Option<PathBuf> {
    for source_dir in source_dirs {
        if !source_dir.exists() {
            continue;
        }
        let Ok(skills) = crate::skills::list_skills(source_dir) else {
            continue;
        };
        if let Some(skill) = skills.into_iter().find(|item| item.name == skill_name) {
            let dir = PathBuf::from(skill.directory);
            if dir.join("SKILL.md").exists() {
                return Some(dir);
            }
        }
    }
    None
}

fn list_skill_files(dir: &Path) -> Vec<String> {
    // Collect relative file paths for display
    fn collect(dir: &Path, prefix: &Path) -> Vec<String> {
        let mut out = Vec::new();
        let Ok(entries) = std::fs::read_dir(dir) else {
            return out;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            if let Ok(rel) = path.strip_prefix(prefix) {
                let rel_str = rel.to_string_lossy().replace('\\', "/");
                if path.is_dir() {
                    out.extend(collect(&path, prefix));
                } else {
                    out.push(rel_str);
                }
            }
        }
        out
    }
    let mut files = collect(dir, dir);
    files.sort();
    files
}

pub(super) fn setup_get_skill_conflict_detail_with_home(
    home: &Path,
    skill_name: &str,
) -> Result<SkillConflictDetail, String> {
    let skill_name = skill_name.trim();
    if skill_name.is_empty() {
        return Err("skill name is required".to_string());
    }

    let skills_root = crate::root_dir::default_skills_root(home);
    let mut variants = Vec::<SkillConflictVariant>::new();

    let mut my_hash = None::<String>;
    if let Some(dir) = my_skill_dir(&skills_root, skill_name) {
        let content = fs::read_to_string(dir.join("SKILL.md"))
            .map_err(|e| format!("Read my skill failed: {e}"))?;
        let hash = super::sync_ops::dir_content_hash(&dir)?;
        let file_list = list_skill_files(&dir);
        my_hash = Some(hash.clone());
        variants.push(SkillConflictVariant {
            source_id: "my-skills".to_string(),
            source_name: "My Skills".to_string(),
            content_hash: hash,
            in_my_skills: true,
            hash_matches_my_skills: true,
            content,
            file_list,
            source_dir: dir.to_string_lossy().to_string(),
        });
    }

    let mut tool_sources = setup_skill_source_dirs_with_home(home)?;
    tool_sources.sort_by(|a, b| a.1.cmp(&b.1));
    for (tool_id, tool_name, source_dirs) in tool_sources {
        if let Some(dir) = first_tool_skill_dir(&source_dirs, skill_name) {
            let content = fs::read_to_string(dir.join("SKILL.md"))
                .map_err(|e| format!("Read skill from {tool_name} failed: {e}"))?;
            let hash = super::sync_ops::dir_content_hash(&dir)?;
            let file_list = list_skill_files(&dir);
            variants.push(SkillConflictVariant {
                source_id: tool_id,
                source_name: tool_name,
                content_hash: hash.clone(),
                in_my_skills: my_hash.is_some(),
                hash_matches_my_skills: my_hash
                    .as_ref()
                    .map(|value| value == &hash)
                    .unwrap_or(false),
                content,
                file_list,
                source_dir: dir.to_string_lossy().to_string(),
            });
        }
    }

    let mut dedup = HashMap::<String, SkillConflictVariant>::new();
    for variant in variants {
        dedup.entry(variant.source_id.clone()).or_insert(variant);
    }
    let mut variants = dedup.into_values().collect::<Vec<_>>();
    variants.sort_by(|a, b| a.source_name.cmp(&b.source_name));

    Ok(SkillConflictDetail {
        skill_name: skill_name.to_string(),
        variants,
    })
}

pub(super) fn setup_resolve_skill_conflict_with_home(
    home: &Path,
    skill_name: &str,
    source_id: &str,
) -> Result<SetupMutationResult, String> {
    let skill_name = skill_name.trim();
    if skill_name.is_empty() {
        return Err("skill name is required".to_string());
    }
    let source_id = source_id.trim();
    if source_id.is_empty() {
        return Err("source id is required".to_string());
    }

    let detail = setup_get_skill_conflict_detail_with_home(home, skill_name)?;
    let source = detail
        .variants
        .iter()
        .find(|variant| variant.source_id == source_id)
        .ok_or_else(|| format!("source variant not found: {source_id}"))?;

    let skills_root = crate::root_dir::default_skills_root(home);
    let target_dir = skills_root.join(skill_name);
    let source_dir = PathBuf::from(&source.source_dir);
    super::sync_ops::copy_dir_recursive(&source_dir, &target_dir)?;

    crate::setup::sync_saved_skill_to_copy_tools_with_home(home, &skills_root, skill_name)?;
    Ok(SetupMutationResult { success: true })
}

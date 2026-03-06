use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value as JsonValue;
use serde_yaml::{Mapping, Value as YamlValue};

#[derive(Debug, Serialize, Clone)]
pub struct SkillMeta {
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
    pub my_notes: Option<String>,
    pub last_updated: Option<String>,
    pub directory: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct SkillDocument {
    pub frontmatter: JsonValue,
    pub body: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct SaveResult {
    pub success: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillDeleteFailure {
    pub root: String,
    pub error: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillDeleteEverywhereResult {
    pub skill_name: String,
    pub scanned_roots: usize,
    pub removed_paths: Vec<String>,
    pub failed_roots: Vec<SkillDeleteFailure>,
}

fn validate_skill_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Skill name is required".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err("Invalid skill name".to_string());
    }
    Ok(trimmed.to_string())
}

fn split_frontmatter(raw: &str) -> Result<(Mapping, String), String> {
    let normalized = raw.replace("\r\n", "\n");
    let normalized = normalized.strip_prefix('\u{feff}').unwrap_or(&normalized);
    if !normalized.starts_with("---\n") {
        return Ok((Mapping::new(), normalized.to_string()));
    }

    let marker = "\n---\n";
    let rest = &normalized[4..];
    let Some(end) = rest.find(marker) else {
        return Err("Invalid frontmatter block".to_string());
    };

    let yaml_str = &rest[..end];
    let body = rest[end + marker.len()..].to_string();
    let frontmatter = if yaml_str.trim().is_empty() {
        Mapping::new()
    } else {
        serde_yaml::from_str::<Mapping>(yaml_str)
            .map_err(|e| format!("Invalid YAML frontmatter: {e}"))?
    };
    Ok((frontmatter, body))
}

fn build_markdown(frontmatter: &Mapping, body: &str) -> Result<String, String> {
    let yaml =
        serde_yaml::to_string(frontmatter).map_err(|e| format!("Serialize YAML failed: {e}"))?;
    Ok(format!(
        "---\n{}---\n\n{}",
        yaml,
        body.trim_start_matches('\n')
    ))
}

fn yaml_get_string(map: &Mapping, key: &str) -> Option<String> {
    map.get(YamlValue::String(key.to_string()))
        .and_then(|v| v.as_str().map(std::string::ToString::to_string))
}

fn yaml_get_tags(map: &Mapping) -> Option<Vec<String>> {
    map.get(YamlValue::String("tags".to_string()))
        .and_then(|value| value.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|item| item.as_str().map(std::string::ToString::to_string))
                .collect::<Vec<_>>()
        })
}

fn locate_skill_dir(root: &Path, name: &str) -> Result<PathBuf, String> {
    let entries = fs::read_dir(root).map_err(|e| format!("Read root dir failed: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Read entry failed: {e}"))?;
        let entry_path = entry.path();
        if !entry_path.is_dir() {
            continue;
        }
        let skill_file = entry_path.join("SKILL.md");
        if !skill_file.exists() {
            continue;
        }

        let raw =
            fs::read_to_string(&skill_file).map_err(|e| format!("Read SKILL.md failed: {e}"))?;
        let (frontmatter, _) = split_frontmatter(&raw)?;
        let skill_name = yaml_get_string(&frontmatter, "name")
            .unwrap_or_else(|| entry.file_name().to_string_lossy().to_string());
        if skill_name == name || entry.file_name().to_string_lossy() == name {
            return Ok(entry_path);
        }
    }

    Ok(root.join(name))
}

fn remove_path_if_exists(path: &Path) -> Result<bool, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return Ok(false),
    };

    if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path).map_err(|e| format!("Remove dir failed: {e}"))?;
    } else {
        fs::remove_file(path).map_err(|e| format!("Remove file failed: {e}"))?;
    }
    Ok(true)
}

fn delete_skill_from_root(root: &Path, skill_name: &str) -> Result<Option<PathBuf>, String> {
    if !root.exists() {
        return Ok(None);
    }
    let dir = locate_skill_dir(root, skill_name)?;
    if remove_path_if_exists(&dir)? {
        Ok(Some(dir))
    } else {
        Ok(None)
    }
}

fn delete_skill_everywhere_with_paths(
    home: &Path,
    skills_root: &Path,
    name: &str,
) -> Result<SkillDeleteEverywhereResult, String> {
    let skill_name = validate_skill_name(name)?;
    let mut roots = BTreeSet::<PathBuf>::new();
    roots.insert(skills_root.to_path_buf());
    for tool_dir in crate::setup::all_tool_skill_dirs_with_home(home)? {
        roots.insert(tool_dir);
    }

    let mut removed_paths = Vec::<String>::new();
    let mut failed_roots = Vec::<SkillDeleteFailure>::new();
    for root in &roots {
        match delete_skill_from_root(root, &skill_name) {
            Ok(Some(path)) => removed_paths.push(path.to_string_lossy().to_string()),
            Ok(None) => {}
            Err(error) => failed_roots.push(SkillDeleteFailure {
                root: root.to_string_lossy().to_string(),
                error,
            }),
        }
    }
    removed_paths.sort();
    removed_paths.dedup();

    Ok(SkillDeleteEverywhereResult {
        skill_name,
        scanned_roots: roots.len(),
        removed_paths,
        failed_roots,
    })
}

pub fn list_skills(root: &Path) -> Result<Vec<SkillMeta>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    let entries = fs::read_dir(root).map_err(|e| format!("Read root dir failed: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Read entry failed: {e}"))?;
        let entry_path = entry.path();
        if !entry_path.is_dir() {
            continue;
        }

        let file_path = entry_path.join("SKILL.md");
        if !file_path.exists() {
            continue;
        }

        let raw =
            fs::read_to_string(&file_path).map_err(|e| format!("Read SKILL.md failed: {e}"))?;
        let (frontmatter, _) = split_frontmatter(&raw)?;
        let name = yaml_get_string(&frontmatter, "name")
            .unwrap_or_else(|| entry.file_name().to_string_lossy().to_string());
        out.push(SkillMeta {
            name,
            description: yaml_get_string(&frontmatter, "description"),
            category: yaml_get_string(&frontmatter, "category"),
            tags: yaml_get_tags(&frontmatter),
            my_notes: yaml_get_string(&frontmatter, "my_notes"),
            last_updated: yaml_get_string(&frontmatter, "last_updated"),
            directory: entry_path.to_string_lossy().to_string(),
        });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub fn get_content(root: &Path, name: &str) -> Result<SkillDocument, String> {
    let dir = locate_skill_dir(root, name)?;
    let file_path = dir.join("SKILL.md");
    let raw = fs::read_to_string(file_path).map_err(|e| format!("Read SKILL.md failed: {e}"))?;
    let (frontmatter, body) = split_frontmatter(&raw)?;
    let frontmatter_json = serde_json::to_value(frontmatter)
        .map_err(|e| format!("Frontmatter conversion failed: {e}"))?;
    Ok(SkillDocument {
        frontmatter: frontmatter_json,
        body,
    })
}

pub fn save_content(
    root: &Path,
    name: &str,
    content: &str,
    today: &str,
) -> Result<SaveResult, String> {
    let dir = locate_skill_dir(root, name)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Create skill dir failed: {e}"))?;
    let file_path = dir.join("SKILL.md");

    let (mut frontmatter, body) = split_frontmatter(content)?;
    frontmatter.insert(
        YamlValue::String("last_updated".to_string()),
        YamlValue::String(today.to_string()),
    );
    let next = build_markdown(&frontmatter, &body)?;
    fs::write(file_path, next).map_err(|e| format!("Write SKILL.md failed: {e}"))?;
    Ok(SaveResult { success: true })
}

#[tauri::command]
pub fn skills_list() -> Result<Vec<SkillMeta>, String> {
    list_skills(&crate::root_dir::default_root_dir())
}

#[tauri::command]
pub fn skills_get_content(name: String) -> Result<SkillDocument, String> {
    get_content(&crate::root_dir::default_root_dir(), &name)
}

#[tauri::command]
pub fn skills_save_content(name: String, content: String) -> Result<SaveResult, String> {
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let skills_root = crate::root_dir::default_root_dir();
    let result = save_content(&skills_root, &name, &content, &today)?;
    let home = crate::root_dir::default_home_dir();
    if let Err(err) =
        crate::setup::sync_saved_skill_to_copy_tools_with_home(&home, &skills_root, &name)
    {
        eprintln!("copy-mode incremental sync failed: {err}");
    }
    Ok(result)
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillFileEntry {
    pub path: String,
    pub size: u64,
}

fn list_files_recursive(base: &Path, current: &Path) -> Vec<SkillFileEntry> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(current) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with('.') {
                continue;
            }
        }
        if path.is_dir() {
            out.extend(list_files_recursive(base, &path));
        } else if path.is_file() {
            let rel = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let size = path.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(SkillFileEntry { path: rel, size });
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

pub fn list_files(root: &Path, name: &str) -> Result<Vec<SkillFileEntry>, String> {
    let dir = locate_skill_dir(root, name)?;
    Ok(list_files_recursive(&dir, &dir))
}

#[tauri::command]
pub fn skills_list_files(name: String) -> Result<Vec<SkillFileEntry>, String> {
    list_files(&crate::root_dir::default_root_dir(), &name)
}

#[tauri::command]
pub fn skills_delete_everywhere(name: String) -> Result<SkillDeleteEverywhereResult, String> {
    let home = crate::root_dir::default_home_dir();
    let skills_root = crate::root_dir::default_root_dir();
    delete_skill_everywhere_with_paths(&home, &skills_root, &name)
}

#[cfg(test)]
mod tests {
    use crate::setup::{add_custom_tool_with_home, CustomTool};
    use crate::test_utils::temp_root;
    use std::fs;

    use super::*;

    #[test]
    fn list_skills_reads_skill_metadata() {
        let root = temp_root("myskills-tauri-skills-test");
        fs::create_dir_all(root.join("code-review")).expect("create skill dir");
        fs::write(
            root.join("code-review").join("SKILL.md"),
            r#"---
name: code-review
description: review code
category: quality
tags:
  - review
---

# Code Review
"#,
        )
        .expect("write skill");

        let skills = list_skills(&root).expect("list skills");
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "code-review");
    }

    #[test]
    fn list_skills_reads_metadata_with_utf8_bom() {
        let root = temp_root("myskills-tauri-skills-test");
        fs::create_dir_all(root.join("myskills-router")).expect("create skill dir");
        fs::write(
            root.join("myskills-router").join("SKILL.md"),
            "\u{feff}---\nname: myskills-router\ndescription: router\n---\n\n# Router\n",
        )
        .expect("write skill");

        let skills = list_skills(&root).expect("list skills");
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "myskills-router");
        assert_eq!(skills[0].description.as_deref(), Some("router"));
    }

    #[test]
    fn list_skills_includes_linked_skill_directories() {
        let root = temp_root("myskills-tauri-skills-test");
        fs::create_dir_all(&root).expect("create root");

        let external_root = temp_root("myskills-tauri-skills-test");
        let external_skill = external_root.join("linked-skill-target");
        fs::create_dir_all(&external_skill).expect("create external skill dir");
        fs::write(
            external_skill.join("SKILL.md"),
            r#"---
name: linked-skill
description: from link
---

# Linked Skill
"#,
        )
        .expect("write linked skill");

        let linked_entry = root.join("linked-skill");

        #[cfg(windows)]
        {
            if std::os::windows::fs::symlink_dir(&external_skill, &linked_entry).is_err() {
                let src = external_skill.to_string_lossy().replace('\'', "''");
                let dst = linked_entry.to_string_lossy().replace('\'', "''");
                let script =
                    format!("New-Item -ItemType Junction -Path '{dst}' -Target '{src}' | Out-Null");
                let status = std::process::Command::new("powershell")
                    .args(["-NoProfile", "-Command", &script])
                    .status()
                    .expect("create junction via powershell");
                assert!(status.success(), "junction creation should succeed");
            }
        }

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&external_skill, &linked_entry).expect("create symlink");
        }

        let skills = list_skills(&root).expect("list skills");
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "linked-skill");
    }

    #[test]
    fn get_content_reads_frontmatter_and_body() {
        let root = temp_root("myskills-tauri-skills-test");
        fs::create_dir_all(root.join("debug-helper")).expect("create skill dir");
        fs::write(
            root.join("debug-helper").join("SKILL.md"),
            r#"---
name: debug-helper
description: debug helper
---

## Steps
Do this.
"#,
        )
        .expect("write skill");

        let doc = get_content(&root, "debug-helper").expect("get content");
        assert_eq!(doc.frontmatter["name"], "debug-helper");
        assert!(doc.body.contains("## Steps"));
    }

    #[test]
    fn save_content_updates_last_updated() {
        let root = temp_root("myskills-tauri-skills-test");
        fs::create_dir_all(root.join("planner")).expect("create skill dir");
        fs::write(
            root.join("planner").join("SKILL.md"),
            r#"---
name: planner
description: old
last_updated: "2026-01-01"
---

old body
"#,
        )
        .expect("write skill");

        let result = save_content(
            &root,
            "planner",
            r#"---
name: planner
description: new
---

new body
"#,
            "2026-02-27",
        )
        .expect("save content");

        assert!(result.success);
        let stored = fs::read_to_string(root.join("planner").join("SKILL.md")).expect("read saved");
        assert!(stored.contains("last_updated: 2026-02-27"));
        assert!(stored.contains("new body"));
    }

    #[test]
    fn delete_skill_everywhere_removes_skill_from_root_and_tool_paths() {
        let home = temp_root("myskills-tauri-skills-test");
        let root = temp_root("myskills-tauri-skills-test");

        for dir in [
            root.join("keiths-skill-overlay"),
            home.join(".gemini")
                .join("antigravity")
                .join("skills")
                .join("keiths-skill-overlay"),
            home.join(".config")
                .join("opencode")
                .join("skills")
                .join("keiths-skill-overlay"),
            home.join(".trae")
                .join("skills")
                .join("keiths-skill-overlay"),
        ] {
            fs::create_dir_all(&dir).expect("create skill dir");
            fs::write(
                dir.join("SKILL.md"),
                "---\nname: keiths-skill-overlay\n---\n",
            )
            .expect("write skill");
        }

        add_custom_tool_with_home(
            &home,
            CustomTool {
                name: "LocalTool".to_string(),
                id: "localtool".to_string(),
                skills_dir: home
                    .join(".localtool")
                    .join("skills")
                    .to_string_lossy()
                    .to_string(),
                rules_file: None,
                icon: None,
            },
        )
        .expect("add custom tool");

        let custom_skill_dir = home
            .join(".localtool")
            .join("skills")
            .join("keiths-skill-overlay");
        fs::create_dir_all(&custom_skill_dir).expect("create custom skill dir");
        fs::write(
            custom_skill_dir.join("SKILL.md"),
            "---\nname: keiths-skill-overlay\n---\n",
        )
        .expect("write custom skill");

        let result = delete_skill_everywhere_with_paths(&home, &root, "keiths-skill-overlay")
            .expect("delete skill everywhere");
        assert!(result.failed_roots.is_empty());
        assert!(result.removed_paths.len() >= 5);
        assert!(!root.join("keiths-skill-overlay").exists());
        assert!(!home
            .join(".gemini")
            .join("antigravity")
            .join("skills")
            .join("keiths-skill-overlay")
            .exists());
        assert!(!home
            .join(".config")
            .join("opencode")
            .join("skills")
            .join("keiths-skill-overlay")
            .exists());
        assert!(!home
            .join(".trae")
            .join("skills")
            .join("keiths-skill-overlay")
            .exists());
        assert!(!custom_skill_dir.exists());
    }

    #[test]
    fn delete_skill_everywhere_rejects_invalid_skill_name() {
        let home = temp_root("myskills-tauri-skills-test");
        let root = temp_root("myskills-tauri-skills-test");

        let error = delete_skill_everywhere_with_paths(&home, &root, "../bad")
            .err()
            .expect("reject invalid name");
        assert!(error.contains("Invalid skill name"));
    }
}

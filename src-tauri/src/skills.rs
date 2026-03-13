use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use serde_yaml::{Mapping, Value as YamlValue};

#[derive(Debug, Serialize, Clone)]
pub struct SkillMeta {
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
    pub taxonomy: Option<SkillTaxonomy>,
    pub my_notes: Option<String>,
    pub last_updated: Option<String>,
    pub directory: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillTaxonomy {
    pub sok_representation: String,
    pub sok_scope: String,
    pub sok_group: String,
    pub anthropic_category: String,
    pub skillsbench_domain: String,
    pub skillsbench_difficulty_core: String,
    pub skillsbench_difficulty_level: String,
    pub classified_at: String,
    pub classifier_model: String,
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

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SkillTaxonomyRegistryEntry {
    skill_name: String,
    skill_path: String,
    taxonomy: SkillTaxonomy,
    updated_at: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SkillTaxonomyRegistry {
    version: u32,
    entries: HashMap<String, SkillTaxonomyRegistryEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SkillShapeTagRegistryEntry {
    skill_name: String,
    skill_path: String,
    tags: Vec<String>,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SkillShapeTagRegistry {
    version: u32,
    entries: HashMap<String, SkillShapeTagRegistryEntry>,
}

#[derive(Debug, Clone, Copy)]
struct SkillShapeClassification {
    shape: &'static str,
    anthropic_category: &'static str,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillShapeTagScanResult {
    pub scanned_skills: usize,
    pub updated_entries: usize,
    pub index_path: String,
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

fn yaml_get_string_any(map: &Mapping, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = yaml_get_string(map, key) {
            let trimmed = value.trim().to_string();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }
    None
}

fn yaml_get_tags(map: &Mapping) -> Option<Vec<String>> {
    map.get(YamlValue::String("tags".to_string()))
        .and_then(|value| value.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|item| item.as_str())
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .filter(|item| !item.to_lowercase().starts_with("taxonomy:"))
                .map(std::string::ToString::to_string)
                .collect::<Vec<_>>()
        })
        .and_then(|tags| if tags.is_empty() { None } else { Some(tags) })
}

fn slugify_tag_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut last_dash = false;
    for ch in value.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn infer_skill_shape(skill_dir: &Path) -> SkillShapeClassification {
    let has_agents_dir = skill_dir.join("agents").is_dir();
    let has_openai_yaml = skill_dir.join("agents").join("openai.yaml").is_file();
    let has_scripts_dir = skill_dir.join("scripts").is_dir();
    let has_references_dir = skill_dir.join("references").is_dir();
    let has_assets_dir = skill_dir.join("assets").is_dir();

    let shape = if has_agents_dir || has_openai_yaml {
        if has_scripts_dir || has_references_dir || has_assets_dir {
            "agent-hybrid"
        } else {
            "agent"
        }
    } else if has_scripts_dir && (has_references_dir || has_assets_dir) {
        "hybrid"
    } else if has_scripts_dir {
        "scripted"
    } else if has_references_dir || has_assets_dir {
        "resource"
    } else {
        "markdown-only"
    };

    let anthropic_category = if has_agents_dir || has_openai_yaml {
        "MCP Enhancement"
    } else if has_scripts_dir {
        "Workflow Automation"
    } else {
        "Document & Asset Creation"
    };

    SkillShapeClassification {
        shape,
        anthropic_category,
    }
}

fn infer_software_taxonomy_tags(skill_dir: &Path) -> Vec<String> {
    let shape = infer_skill_shape(skill_dir);
    vec![
        format!(
            "taxonomy:anthropic-category:{}",
            slugify_tag_value(shape.anthropic_category)
        ),
        format!("taxonomy:shape:{}", slugify_tag_value(shape.shape)),
    ]
}

fn merge_skill_tags(base_tags: Option<Vec<String>>, inferred_tags: Vec<String>) -> Option<Vec<String>> {
    let mut merged = base_tags.unwrap_or_default();
    for tag in inferred_tags {
        if !merged.iter().any(|existing| existing == &tag) {
            merged.push(tag);
        }
    }
    if merged.is_empty() {
        None
    } else {
        Some(merged)
    }
}

fn normalize_difficulty_core(value: &str) -> Option<String> {
    match value.trim().to_lowercase().as_str() {
        "core" => Some("Core".to_string()),
        "extended" => Some("Extended".to_string()),
        "extreme" => Some("Extreme".to_string()),
        _ => None,
    }
}

fn normalize_difficulty_level(value: &str) -> Option<String> {
    match value.trim().to_lowercase().as_str() {
        "easy" => Some("Easy".to_string()),
        "medium" => Some("Medium".to_string()),
        "hard" => Some("Hard".to_string()),
        _ => None,
    }
}

fn level_from_core(core: &str) -> Option<String> {
    match core {
        "Core" => Some("Easy".to_string()),
        "Extended" => Some("Medium".to_string()),
        "Extreme" => Some("Hard".to_string()),
        _ => None,
    }
}

fn core_from_level(level: &str) -> Option<String> {
    match level {
        "Easy" => Some("Core".to_string()),
        "Medium" => Some("Extended".to_string()),
        "Hard" => Some("Extreme".to_string()),
        _ => None,
    }
}

fn yaml_get_taxonomy(map: &Mapping) -> Option<SkillTaxonomy> {
    let taxonomy_value = map
        .get(YamlValue::String("skillar_taxonomy".to_string()))
        .or_else(|| map.get(YamlValue::String("skillarTaxonomy".to_string())))?;
    let taxonomy = taxonomy_value.as_mapping()?;

    let sok_representation =
        yaml_get_string_any(taxonomy, &["sokRepresentation", "sok_representation"])?;
    let sok_scope = yaml_get_string_any(taxonomy, &["sokScope", "sok_scope"])?;
    let sok_group = yaml_get_string_any(taxonomy, &["sokGroup", "sok_group"])
        .or_else(|| Some(format!("{sok_representation} × {sok_scope}")))?;
    let anthropic_category =
        yaml_get_string_any(taxonomy, &["anthropicCategory", "anthropic_category"])?;
    let skillsbench_domain =
        yaml_get_string_any(taxonomy, &["skillsbenchDomain", "skillsbench_domain"])?;

    let raw_core = yaml_get_string_any(
        taxonomy,
        &["skillsbenchDifficultyCore", "skillsbench_difficulty_core"],
    );
    let raw_level = yaml_get_string_any(
        taxonomy,
        &["skillsbenchDifficultyLevel", "skillsbench_difficulty_level"],
    );

    let skillsbench_difficulty_core = raw_core
        .as_deref()
        .and_then(normalize_difficulty_core)
        .or_else(|| {
            raw_level
                .as_deref()
                .and_then(normalize_difficulty_level)
                .and_then(|level| core_from_level(&level))
        })?;
    let skillsbench_difficulty_level = raw_level
        .as_deref()
        .and_then(normalize_difficulty_level)
        .or_else(|| level_from_core(&skillsbench_difficulty_core))?;

    let classified_at = yaml_get_string_any(taxonomy, &["classifiedAt", "classified_at"])?;
    let classifier_model = yaml_get_string_any(taxonomy, &["classifierModel", "classifier_model"])?;

    Some(SkillTaxonomy {
        sok_representation,
        sok_scope,
        sok_group,
        anthropic_category,
        skillsbench_domain,
        skillsbench_difficulty_core,
        skillsbench_difficulty_level,
        classified_at,
        classifier_model,
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

fn taxonomy_registry_file(home: &Path) -> PathBuf {
    crate::root_dir::app_config_dir(home).join("skill-taxonomy-index.json")
}

fn shape_tag_registry_file(home: &Path) -> PathBuf {
    crate::root_dir::app_config_dir(home).join("skill-shape-tag-index.json")
}

fn normalize_skill_path_key(skill_path: &Path) -> String {
    let absolute = if skill_path.is_absolute() {
        skill_path.to_path_buf()
    } else {
        crate::root_dir::default_root_dir().join(skill_path)
    };
    let canonical = absolute.canonicalize().unwrap_or(absolute);
    let normalized = canonical.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        normalized.to_lowercase()
    } else {
        normalized
    }
}

fn load_taxonomy_overrides(home: &Path) -> HashMap<String, SkillTaxonomy> {
    let path = taxonomy_registry_file(home);
    let Ok(raw) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    if raw.trim().is_empty() {
        return HashMap::new();
    }
    let Ok(parsed) = serde_json::from_str::<SkillTaxonomyRegistry>(&raw) else {
        return HashMap::new();
    };
    let _version = parsed.version;
    parsed
        .entries
        .into_iter()
        .map(|(key, entry)| {
            let _skill_name = &entry.skill_name;
            let _skill_path = &entry.skill_path;
            let _updated_at = &entry.updated_at;
            (key, entry.taxonomy)
        })
        .collect::<HashMap<_, _>>()
}

fn load_shape_tag_overrides(home: &Path) -> HashMap<String, Vec<String>> {
    let path = shape_tag_registry_file(home);
    let Ok(raw) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    if raw.trim().is_empty() {
        return HashMap::new();
    }
    let Ok(parsed) = serde_json::from_str::<SkillShapeTagRegistry>(&raw) else {
        return HashMap::new();
    };
    let _version = parsed.version;
    parsed
        .entries
        .into_iter()
        .filter_map(|(key, entry)| {
            let _skill_name = &entry.skill_name;
            let _skill_path = &entry.skill_path;
            let _updated_at = &entry.updated_at;
            let tags = entry
                .tags
                .into_iter()
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>();
            if tags.is_empty() {
                None
            } else {
                Some((key, tags))
            }
        })
        .collect::<HashMap<_, _>>()
}

fn write_shape_tag_registry(home: &Path, registry: &SkillShapeTagRegistry) -> Result<(), String> {
    fs::create_dir_all(crate::root_dir::app_config_dir(home))
        .map_err(|e| format!("Create app config dir failed: {e}"))?;
    let content = serde_json::to_string_pretty(registry)
        .map_err(|e| format!("Serialize shape tag index failed: {e}"))?;
    fs::write(shape_tag_registry_file(home), format!("{content}\n"))
        .map_err(|e| format!("Write shape tag index failed: {e}"))
}

fn rescan_shape_tags_with_home_and_root(
    home: &Path,
    root: &Path,
) -> Result<SkillShapeTagScanResult, String> {
    let mut entries = HashMap::<String, SkillShapeTagRegistryEntry>::new();
    if root.exists() {
        let root_entries = fs::read_dir(root).map_err(|e| format!("Read root dir failed: {e}"))?;
        for entry in root_entries {
            let entry = entry.map_err(|e| format!("Read entry failed: {e}"))?;
            let entry_path = entry.path();
            if !entry_path.is_dir() {
                continue;
            }
            let file_path = entry_path.join("SKILL.md");
            if !file_path.exists() {
                continue;
            }
            let raw = fs::read_to_string(&file_path)
                .map_err(|e| format!("Read SKILL.md failed: {e}"))?;
            let (frontmatter, _) = split_frontmatter(&raw)?;
            let skill_name = yaml_get_string(&frontmatter, "name")
                .unwrap_or_else(|| entry.file_name().to_string_lossy().to_string());
            let key = normalize_skill_path_key(&file_path);
            let tags = infer_software_taxonomy_tags(&entry_path);
            let updated_at = chrono::Utc::now().to_rfc3339();
            entries.insert(
                key,
                SkillShapeTagRegistryEntry {
                    skill_name,
                    skill_path: file_path.to_string_lossy().to_string(),
                    tags,
                    updated_at,
                },
            );
        }
    }

    let scanned_skills = entries.len();
    let registry = SkillShapeTagRegistry {
        version: 1,
        entries,
    };
    write_shape_tag_registry(home, &registry)?;
    let index_path = shape_tag_registry_file(home).to_string_lossy().to_string();
    Ok(SkillShapeTagScanResult {
        scanned_skills,
        updated_entries: scanned_skills,
        index_path,
    })
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

fn list_skills_with_home(root: &Path, home: &Path) -> Result<Vec<SkillMeta>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }

    let taxonomy_overrides = load_taxonomy_overrides(home);
    let shape_tag_overrides = load_shape_tag_overrides(home);
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
        let taxonomy_key = normalize_skill_path_key(&file_path);
        let inferred_tags = shape_tag_overrides
            .get(&taxonomy_key)
            .cloned()
            .unwrap_or_else(|| infer_software_taxonomy_tags(&entry_path));
        out.push(SkillMeta {
            name,
            description: yaml_get_string(&frontmatter, "description"),
            category: yaml_get_string(&frontmatter, "category"),
            tags: merge_skill_tags(yaml_get_tags(&frontmatter), inferred_tags),
            taxonomy: taxonomy_overrides
                .get(&taxonomy_key)
                .cloned()
                .or_else(|| yaml_get_taxonomy(&frontmatter)),
            my_notes: yaml_get_string(&frontmatter, "my_notes"),
            last_updated: yaml_get_string(&frontmatter, "last_updated"),
            directory: entry_path.to_string_lossy().to_string(),
        });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub fn list_skills(root: &Path) -> Result<Vec<SkillMeta>, String> {
    list_skills_with_home(root, &crate::root_dir::default_home_dir())
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
pub fn skills_rescan_shape_tags() -> Result<SkillShapeTagScanResult, String> {
    let home = crate::root_dir::default_home_dir();
    let root = crate::root_dir::default_root_dir();
    rescan_shape_tags_with_home_and_root(&home, &root)
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
    fn list_skills_reads_taxonomy_metadata() {
        let root = temp_root("myskills-tauri-skills-test");
        fs::create_dir_all(root.join("taxonomy-skill")).expect("create skill dir");
        fs::write(
            root.join("taxonomy-skill").join("SKILL.md"),
            r#"---
name: taxonomy-skill
description: taxonomy demo
skillar_taxonomy:
  sokRepresentation: Natural-language
  sokScope: Single-tool
  sokGroup: Natural-language × Single-tool
  anthropicCategory: Workflow Automation
  skillsbenchDomain: Software Engineering
  skillsbenchDifficultyCore: Core
  skillsbenchDifficultyLevel: Easy
  classifiedAt: "2026-03-12T00:00:00Z"
  classifierModel: gpt-4o-mini
---

# Taxonomy
"#,
        )
        .expect("write skill");

        let skills = list_skills(&root).expect("list skills");
        assert_eq!(skills.len(), 1);
        let taxonomy = skills[0].taxonomy.clone().expect("taxonomy");
        assert_eq!(taxonomy.sok_representation, "Natural-language");
        assert_eq!(taxonomy.sok_scope, "Single-tool");
        assert_eq!(taxonomy.skillsbench_difficulty_core, "Core");
        assert_eq!(taxonomy.skillsbench_difficulty_level, "Easy");
    }

    #[test]
    fn list_skills_infers_software_taxonomy_tags_from_shape_scan() {
        let root = temp_root("myskills-tauri-skills-test");
        let skill_dir = root.join("script-automation");
        fs::create_dir_all(skill_dir.join("scripts")).expect("create scripts dir");
        fs::write(
            skill_dir.join("SKILL.md"),
            r#"---
name: script-automation
description: run scripted automation
---

# Script Automation
"#,
        )
        .expect("write skill");
        fs::write(skill_dir.join("scripts").join("run.py"), "print('ok')\n")
            .expect("write script");

        let skills = list_skills(&root).expect("list skills");
        assert_eq!(skills.len(), 1);
        let tags = skills[0].tags.clone().unwrap_or_default();
        assert!(tags
            .iter()
            .any(|tag| tag == "taxonomy:anthropic-category:workflow-automation"));
        assert!(tags.iter().any(|tag| tag == "taxonomy:shape:scripted"));
    }

    #[test]
    fn rescan_shape_tags_writes_registry_for_all_skills() {
        let home = temp_root("myskills-tauri-skills-test");
        let root = temp_root("myskills-tauri-skills-test");
        let skill_dir = root.join("script-automation");
        fs::create_dir_all(skill_dir.join("scripts")).expect("create scripts dir");
        fs::write(
            skill_dir.join("SKILL.md"),
            r#"---
name: script-automation
description: run scripted automation
---

# Script Automation
"#,
        )
        .expect("write skill");
        fs::write(skill_dir.join("scripts").join("run.py"), "print('ok')\n")
            .expect("write script");

        let result = rescan_shape_tags_with_home_and_root(&home, &root).expect("rescan tags");
        assert_eq!(result.scanned_skills, 1);
        assert_eq!(result.updated_entries, 1);

        let overrides = load_shape_tag_overrides(&home);
        assert_eq!(overrides.len(), 1);
        let inferred = overrides.values().next().cloned().unwrap_or_default();
        assert!(inferred
            .iter()
            .any(|tag| tag == "taxonomy:anthropic-category:workflow-automation"));
        assert!(inferred.iter().any(|tag| tag == "taxonomy:shape:scripted"));
    }

    #[test]
    fn list_skills_prefers_cached_shape_tags_when_available() {
        let home = temp_root("myskills-tauri-skills-test");
        let root = temp_root("myskills-tauri-skills-test");
        let skill_dir = root.join("cache-tag-skill");
        fs::create_dir_all(&skill_dir).expect("create skill dir");
        let skill_path = skill_dir.join("SKILL.md");
        fs::write(
            &skill_path,
            r#"---
name: cache-tag-skill
description: cache tag test
---

# Cache Tag Skill
"#,
        )
        .expect("write skill");

        let key = normalize_skill_path_key(&skill_path);
        let mut entries = HashMap::new();
        entries.insert(
            key,
            SkillShapeTagRegistryEntry {
                skill_name: "cache-tag-skill".to_string(),
                skill_path: skill_path.to_string_lossy().to_string(),
                tags: vec!["taxonomy:shape:cached-shape".to_string()],
                updated_at: "2026-03-13T00:00:00Z".to_string(),
            },
        );
        let registry = SkillShapeTagRegistry { version: 1, entries };
        fs::create_dir_all(crate::root_dir::app_config_dir(&home)).expect("create app config dir");
        fs::write(
            shape_tag_registry_file(&home),
            format!(
                "{}\n",
                serde_json::to_string_pretty(&registry).expect("serialize registry")
            ),
        )
        .expect("write shape tag registry");

        let skills = list_skills_with_home(&root, &home).expect("list skills with home");
        assert_eq!(skills.len(), 1);
        let tags = skills[0].tags.clone().unwrap_or_default();
        assert!(tags.iter().any(|tag| tag == "taxonomy:shape:cached-shape"));
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

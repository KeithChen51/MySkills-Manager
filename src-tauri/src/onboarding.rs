use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    onboarding_completed: bool,
    skills_dir: String,
    auto_sync: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAppConfig {
    onboarding_completed: Option<bool>,
    skills_dir: Option<String>,
    auto_sync: Option<bool>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingState {
    pub completed: bool,
    pub skills_dir: String,
    pub auto_sync: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct OnboardingSetSkillsDirResult {
    pub success: bool,
    pub skills: Vec<crate::skills::SkillMeta>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingCompleteResult {
    pub success: bool,
    pub auto_sync: bool,
    pub configured_tools: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolImportSummary {
    pub tool_id: String,
    pub tool_name: String,
    pub detected: usize,
    pub imported: usize,
    pub skipped_existing: usize,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingImportSkillsResult {
    pub success: bool,
    pub detected_total: usize,
    pub imported_total: usize,
    pub skipped_existing_total: usize,
    pub tools: Vec<ToolImportSummary>,
}

fn config_file(home: &Path) -> PathBuf {
    crate::root_dir::app_config_dir(home).join("config.json")
}

fn default_config(home: &Path) -> AppConfig {
    AppConfig {
        onboarding_completed: false,
        skills_dir: crate::root_dir::default_skills_root(home)
            .to_string_lossy()
            .to_string(),
        auto_sync: false,
    }
}

fn ensure_dir_exists(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    fs::create_dir_all(path).map_err(|e| format!("create directory failed: {e}"))
}

fn ensure_builtin_skill_seeded(skills_root: &Path) -> Result<(), String> {
    crate::router_seed::ensure_router_skill_seeded(skills_root)?;
    Ok(())
}

fn read_config(home: &Path) -> Result<AppConfig, String> {
    let path = config_file(home);
    if !path.exists() {
        let config = default_config(home);
        ensure_dir_exists(&PathBuf::from(&config.skills_dir))?;
        write_config(home, &config)?;
        return Ok(config);
    }

    let raw =
        fs::read_to_string(path).map_err(|e| format!("Read onboarding config failed: {e}"))?;
    if raw.trim().is_empty() {
        let config = default_config(home);
        ensure_dir_exists(&PathBuf::from(&config.skills_dir))?;
        write_config(home, &config)?;
        return Ok(config);
    }

    let parsed = serde_json::from_str::<RawAppConfig>(&raw)
        .map_err(|e| format!("Invalid onboarding config: {e}"))?;
    let defaults = default_config(home);
    let config = AppConfig {
        onboarding_completed: parsed
            .onboarding_completed
            .unwrap_or(defaults.onboarding_completed),
        skills_dir: parsed.skills_dir.unwrap_or(defaults.skills_dir),
        auto_sync: parsed.auto_sync.unwrap_or(false),
    };
    Ok(config)
}

fn write_config(home: &Path, config: &AppConfig) -> Result<(), String> {
    fs::create_dir_all(crate::root_dir::app_config_dir(home))
        .map_err(|e| format!("Create app config dir failed: {e}"))?;
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Serialize onboarding config failed: {e}"))?;
    fs::write(config_file(home), format!("{content}\n"))
        .map_err(|e| format!("Write onboarding config failed: {e}"))
}

fn is_package_source_dir(path: &Path) -> bool {
    let normalized = path.to_string_lossy().replace('\\', "/").to_lowercase();
    normalized.contains("/.codex/superpowers/skills") || normalized.contains("/.agents/skills")
}

pub fn apply_bootstrap_env() -> Result<(), String> {
    let home = crate::root_dir::default_home_dir();
    let config = read_config(&home)?;
    if !config.skills_dir.trim().is_empty() {
        let skills_root = PathBuf::from(&config.skills_dir);
        ensure_dir_exists(&skills_root)?;
        ensure_builtin_skill_seeded(&skills_root)?;
        crate::root_dir::set_runtime_skills_root(Some(skills_root));
    }
    Ok(())
}

pub fn onboarding_get_state_with_home(home: &Path) -> Result<OnboardingState, String> {
    let config = read_config(home)?;
    Ok(OnboardingState {
        completed: config.onboarding_completed,
        skills_dir: config.skills_dir,
        auto_sync: config.auto_sync,
    })
}

pub fn onboarding_set_skills_dir_with_home(
    home: &Path,
    dir: &str,
    create_if_missing: bool,
) -> Result<OnboardingSetSkillsDirResult, String> {
    let normalized = dir.trim();
    if normalized.is_empty() {
        return Err("skills dir is required".to_string());
    }

    let path = PathBuf::from(normalized);
    if !path.exists() {
        if create_if_missing {
            fs::create_dir_all(&path).map_err(|e| format!("create skills dir failed: {e}"))?;
        } else {
            return Err("skills dir does not exist".to_string());
        }
    }
    ensure_builtin_skill_seeded(&path)?;

    let mut config = read_config(home)?;
    config.skills_dir = path.to_string_lossy().to_string();
    config.onboarding_completed = false;
    write_config(home, &config)?;

    let skills = crate::skills::list_skills(&path)?;
    Ok(OnboardingSetSkillsDirResult {
        success: true,
        skills,
    })
}

pub fn onboarding_complete_with_home(
    home: &Path,
    auto_sync: bool,
) -> Result<OnboardingCompleteResult, String> {
    let mut config = read_config(home)?;
    let skills_dir = PathBuf::from(&config.skills_dir);
    if !skills_dir.exists() {
        return Err("skills dir does not exist".to_string());
    }

    config.onboarding_completed = true;
    config.auto_sync = auto_sync;
    write_config(home, &config)?;

    let mut configured_tools = 0usize;
    if auto_sync {
        let status = crate::setup::setup_status_with_home(home)?;
        let selected_tools = status
            .into_iter()
            .filter(|item| item.exists)
            .map(|item| item.id)
            .collect::<Vec<_>>();

        if !selected_tools.is_empty() {
            let results =
                crate::setup::apply_setup_with_paths(home, &skills_dir, &selected_tools, None)?;
            configured_tools = results.iter().filter(|item| item.success).count();
        }
    }

    Ok(OnboardingCompleteResult {
        success: true,
        auto_sync,
        configured_tools,
    })
}

pub fn onboarding_import_installed_skills_with_home(
    home: &Path,
) -> Result<OnboardingImportSkillsResult, String> {
    let config = read_config(home)?;
    let target_root = PathBuf::from(&config.skills_dir);
    fs::create_dir_all(&target_root)
        .map_err(|e| format!("Create target skills dir failed: {e}"))?;

    let existing = crate::skills::list_skills(&target_root)?;
    let mut existing_names = existing
        .into_iter()
        .map(|skill| skill.name)
        .collect::<HashSet<_>>();

    let tool_sources = crate::setup::setup_skill_source_dirs_with_home(home)?;
    let mut summaries = Vec::<ToolImportSummary>::new();
    let mut detected_total = 0usize;
    let mut imported_total = 0usize;
    let mut skipped_existing_total = 0usize;

    for (tool_id, tool_name, source_dirs) in tool_sources {
        let mut detected = 0usize;
        let mut imported = 0usize;
        let mut skipped_existing = 0usize;
        let mut error = None;
        let mut seen_in_tool = HashSet::<String>::new();

        for source_dir in source_dirs {
            if !source_dir.exists() {
                continue;
            }
            if is_package_source_dir(&source_dir) {
                continue;
            }

            match crate::skills::list_skills(&source_dir) {
                Ok(skills) => {
                    for skill in skills {
                        let skill_name = skill.name;
                        if !seen_in_tool.insert(skill_name.clone()) {
                            continue;
                        }
                        detected += 1;
                        if existing_names.contains(&skill_name) {
                            skipped_existing += 1;
                            continue;
                        }

                        let source_dir = PathBuf::from(skill.directory);
                        let target_dir = target_root.join(&skill_name);
                        if let Err(err) =
                            crate::setup::copy_skill_dir_recursive(&source_dir, &target_dir)
                        {
                            error = Some(err);
                            break;
                        }
                        existing_names.insert(skill_name);
                        imported += 1;
                    }
                }
                Err(err) => {
                    error = Some(err);
                }
            }

            if error.is_some() {
                break;
            }
        }

        detected_total += detected;
        imported_total += imported;
        skipped_existing_total += skipped_existing;
        summaries.push(ToolImportSummary {
            tool_id,
            tool_name,
            detected,
            imported,
            skipped_existing,
            error,
        });
    }

    Ok(OnboardingImportSkillsResult {
        success: true,
        detected_total,
        imported_total,
        skipped_existing_total,
        tools: summaries,
    })
}

#[tauri::command]
pub fn onboarding_get_state() -> Result<OnboardingState, String> {
    onboarding_get_state_with_home(&crate::root_dir::default_home_dir())
}

#[tauri::command]
pub fn onboarding_set_skills_dir(
    dir: String,
    create_if_missing: Option<bool>,
) -> Result<OnboardingSetSkillsDirResult, String> {
    let home = crate::root_dir::default_home_dir();
    let result =
        onboarding_set_skills_dir_with_home(&home, &dir, create_if_missing.unwrap_or(false))?;
    let state = onboarding_get_state_with_home(&home)?;
    if !state.skills_dir.trim().is_empty() {
        crate::root_dir::set_runtime_skills_root(Some(PathBuf::from(state.skills_dir)));
    }
    Ok(result)
}

#[tauri::command]
pub fn onboarding_complete(auto_sync: bool) -> Result<OnboardingCompleteResult, String> {
    let home = crate::root_dir::default_home_dir();
    let result = onboarding_complete_with_home(&home, auto_sync)?;
    let state = onboarding_get_state_with_home(&home)?;
    if !state.skills_dir.trim().is_empty() {
        crate::root_dir::set_runtime_skills_root(Some(PathBuf::from(state.skills_dir)));
    }
    Ok(result)
}

#[tauri::command]
pub fn onboarding_import_installed_skills() -> Result<OnboardingImportSkillsResult, String> {
    onboarding_import_installed_skills_with_home(&crate::root_dir::default_home_dir())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn lock_env() -> std::sync::MutexGuard<'static, ()> {
        let guard = ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        crate::root_dir::set_runtime_skills_root(None);
        guard
    }

    fn restore_env_var(key: &str, value: Option<String>) {
        match value {
            Some(v) => unsafe {
                std::env::set_var(key, v);
            },
            None => unsafe {
                std::env::remove_var(key);
            },
        }
    }

    fn temp_home() -> PathBuf {
        let mut root = std::env::temp_dir();
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        root.push(format!("myskills-tauri-onboarding-test-{ts}-{n}"));
        root
    }

    #[test]
    fn onboarding_get_state_returns_default_when_missing() {
        let _guard = lock_env();
        let home = temp_home();
        let state = onboarding_get_state_with_home(&home).expect("get state");
        assert!(!state.completed);
        assert!(!state.skills_dir.is_empty());
        assert!(!state.auto_sync);
        assert!(PathBuf::from(state.skills_dir).exists());
    }

    #[test]
    fn onboarding_set_skills_dir_returns_skill_list_and_persists() {
        let _guard = lock_env();
        let home = temp_home();
        let skills_root = home.join("my-skills");
        fs::create_dir_all(skills_root.join("code-review")).expect("create skill dir");
        fs::write(
            skills_root.join("code-review").join("SKILL.md"),
            "---\nname: code-review\n---\n",
        )
        .expect("write skill");

        let result =
            onboarding_set_skills_dir_with_home(&home, &skills_root.to_string_lossy(), false)
                .expect("set skills dir");
        assert!(result.success);
        assert_eq!(result.skills.len(), 2);
        assert!(result
            .skills
            .iter()
            .any(|skill| skill.name == "code-review"));
        assert!(result
            .skills
            .iter()
            .any(|skill| skill.name == "myskills-router"));

        let state = onboarding_get_state_with_home(&home).expect("get state");
        assert_eq!(PathBuf::from(state.skills_dir), skills_root);
        assert!(!state.completed);
    }

    #[test]
    fn onboarding_complete_manual_only_updates_state() {
        let _guard = lock_env();
        let home = temp_home();
        let skills_root = home.join("my-skills");
        fs::create_dir_all(skills_root.join("code-review")).expect("create skill dir");
        fs::write(
            skills_root.join("code-review").join("SKILL.md"),
            "---\nname: code-review\n---\n",
        )
        .expect("write skill");
        onboarding_set_skills_dir_with_home(&home, &skills_root.to_string_lossy(), false)
            .expect("set dir");

        let result = onboarding_complete_with_home(&home, false).expect("complete");
        assert!(result.success);
        assert!(!result.auto_sync);
        assert_eq!(result.configured_tools, 0);

        let state = onboarding_get_state_with_home(&home).expect("get state");
        assert!(state.completed);
        assert!(!state.auto_sync);
    }

    #[test]
    fn onboarding_set_skills_dir_returns_error_when_missing_and_not_allowed_to_create() {
        let _guard = lock_env();
        let home = temp_home();
        let missing = home.join("missing-skills");
        let err = onboarding_set_skills_dir_with_home(&home, &missing.to_string_lossy(), false)
            .expect_err("should fail");
        assert!(err.contains("skills dir does not exist"));
        assert!(!missing.exists());
    }

    #[test]
    fn onboarding_set_skills_dir_creates_missing_directory_when_allowed() {
        let _guard = lock_env();
        let home = temp_home();
        let skills_root = home.join("new-skills-root");
        assert!(!skills_root.exists());

        let result =
            onboarding_set_skills_dir_with_home(&home, &skills_root.to_string_lossy(), true)
                .expect("set skills dir");
        assert!(result.success);
        assert!(skills_root.exists());
        assert_eq!(result.skills.len(), 1);
        assert_eq!(result.skills[0].name, "myskills-router");
    }

    #[test]
    fn onboarding_set_skills_dir_seeds_myskills_router_skill() {
        let _guard = lock_env();
        let home = temp_home();
        let skills_root = home.join("empty-skills-root");
        fs::create_dir_all(&skills_root).expect("create empty skills root");

        let result =
            onboarding_set_skills_dir_with_home(&home, &skills_root.to_string_lossy(), false)
                .expect("set skills dir");
        assert!(result.success);

        let skill_file = skills_root.join("myskills-router").join("SKILL.md");
        assert!(
            skill_file.exists(),
            "myskills-router skill should be generated"
        );

        let raw = fs::read_to_string(&skill_file).expect("read generated skill");
        assert!(raw.contains("name: myskills-router"));
    }

    #[test]
    fn onboarding_set_skills_dir_refreshes_builtin_skill_when_outdated() {
        let _guard = lock_env();
        let home = temp_home();
        let skills_root = home.join("existing-skills-root");
        let builtin_skill_file = skills_root.join("myskills-router").join("SKILL.md");
        fs::create_dir_all(
            builtin_skill_file
                .parent()
                .expect("myskills-router parent directory"),
        )
        .expect("create builtin skill directory");
        fs::write(
            &builtin_skill_file,
            "---\nname: myskills-router\n---\n# old\n",
        )
        .expect("write outdated builtin skill");

        let result =
            onboarding_set_skills_dir_with_home(&home, &skills_root.to_string_lossy(), false)
                .expect("set skills dir");
        assert!(result.success);

        let raw = fs::read_to_string(&builtin_skill_file).expect("read refreshed skill");
        assert_eq!(raw, crate::router_seed::router_skill_markdown());
    }

    #[test]
    fn onboarding_set_skills_dir_migrates_legacy_myskills_command_to_router() {
        let _guard = lock_env();
        let home = temp_home();
        let skills_root = home.join("legacy-name-skills-root");
        let legacy_skill_file = skills_root.join("myskills-command").join("SKILL.md");
        fs::create_dir_all(
            legacy_skill_file
                .parent()
                .expect("legacy skill parent directory"),
        )
        .expect("create legacy skill directory");
        fs::write(
            &legacy_skill_file,
            "---\nname: myskills-command\n---\n# legacy\n",
        )
        .expect("write legacy skill");

        let result =
            onboarding_set_skills_dir_with_home(&home, &skills_root.to_string_lossy(), false)
                .expect("set skills dir");
        assert!(result.success);
        assert!(!skills_root.join("myskills-command").exists());
        assert!(result
            .skills
            .iter()
            .any(|skill| skill.name == "myskills-router"));
        assert!(!result
            .skills
            .iter()
            .any(|skill| skill.name == "myskills-command"));

        let router_skill_file = skills_root.join("myskills-router").join("SKILL.md");
        assert!(
            router_skill_file.exists(),
            "router skill should exist after migration"
        );
        let raw = fs::read_to_string(&router_skill_file).expect("read migrated router skill");
        assert_eq!(raw, crate::router_seed::router_skill_markdown());
    }

    #[test]
    fn apply_bootstrap_env_seeds_builtin_skill_for_existing_config() {
        let _guard = lock_env();
        let home = temp_home();
        let skills_root = home.join("legacy-skills");
        fs::create_dir_all(&skills_root).expect("create skills root");

        let config = AppConfig {
            onboarding_completed: true,
            skills_dir: skills_root.to_string_lossy().to_string(),
            auto_sync: false,
        };
        write_config(&home, &config).expect("write onboarding config");

        let old_home = std::env::var("HOME").ok();
        let old_userprofile = std::env::var("USERPROFILE").ok();

        unsafe {
            std::env::set_var("HOME", home.to_string_lossy().to_string());
            std::env::remove_var("USERPROFILE");
        }

        apply_bootstrap_env().expect("bootstrap env");

        let skill_file = skills_root.join("myskills-router").join("SKILL.md");
        assert!(
            skill_file.exists(),
            "bootstrap should seed myskills-router for existing config"
        );
        assert_eq!(crate::root_dir::default_skills_root(&home), skills_root);

        restore_env_var("HOME", old_home);
        restore_env_var("USERPROFILE", old_userprofile);
        crate::root_dir::set_runtime_skills_root(None);
    }

    #[test]
    fn onboarding_import_installed_skills_copies_skills_from_detected_tools() {
        let _guard = lock_env();
        let home = temp_home();
        let codex_skill = home.join(".codex").join("skills").join("code-review");
        fs::create_dir_all(&codex_skill).expect("create codex skill dir");
        fs::write(
            codex_skill.join("SKILL.md"),
            "---\nname: code-review\n---\n",
        )
        .expect("write codex skill");

        let state = onboarding_get_state_with_home(&home).expect("get onboarding state");
        let target_root = PathBuf::from(state.skills_dir);

        let result =
            onboarding_import_installed_skills_with_home(&home).expect("import installed skills");
        assert!(result.success);
        assert_eq!(result.detected_total, 1);
        assert_eq!(result.imported_total, 1);
        assert_eq!(result.skipped_existing_total, 0);
        assert!(target_root.join("code-review").join("SKILL.md").exists());
    }

    #[test]
    fn onboarding_import_installed_skills_skips_hidden_files_when_copying() {
        let _guard = lock_env();
        let home = temp_home();
        let codex_skill = home.join(".codex").join("skills").join("code-review");
        fs::create_dir_all(codex_skill.join(".git")).expect("create hidden dir");
        fs::write(
            codex_skill.join("SKILL.md"),
            "---\nname: code-review\n---\n",
        )
        .expect("write codex skill");
        fs::write(codex_skill.join("extra.md"), "# extra\n").expect("write extra file");
        fs::write(codex_skill.join(".git").join("HEAD"), "ref: main\n").expect("write hidden file");

        let state = onboarding_get_state_with_home(&home).expect("get onboarding state");
        let target_root = PathBuf::from(state.skills_dir);

        let result =
            onboarding_import_installed_skills_with_home(&home).expect("import installed skills");
        assert!(result.success);
        assert!(target_root.join("code-review").join("SKILL.md").exists());
        assert!(target_root.join("code-review").join("extra.md").exists());
        assert!(!target_root.join("code-review").join(".git").exists());
    }

    #[test]
    fn onboarding_import_installed_skills_skips_existing_skill_names() {
        let _guard = lock_env();
        let home = temp_home();
        let codex_skill = home.join(".codex").join("skills").join("code-review");
        fs::create_dir_all(&codex_skill).expect("create codex skill dir");
        fs::write(
            codex_skill.join("SKILL.md"),
            "---\nname: code-review\n---\n",
        )
        .expect("write codex skill");

        let state = onboarding_get_state_with_home(&home).expect("get onboarding state");
        let target_skill = PathBuf::from(state.skills_dir).join("code-review");
        fs::create_dir_all(&target_skill).expect("create target skill dir");
        fs::write(
            target_skill.join("SKILL.md"),
            "---\nname: code-review\n---\n",
        )
        .expect("write existing target skill");

        let result =
            onboarding_import_installed_skills_with_home(&home).expect("import installed skills");
        assert!(result.success);
        assert_eq!(result.detected_total, 1);
        assert_eq!(result.imported_total, 0);
        assert_eq!(result.skipped_existing_total, 1);
    }

    #[test]
    fn onboarding_import_installed_skills_ignores_package_paths() {
        let _guard = lock_env();
        let home = temp_home();
        fs::create_dir_all(
            home.join(".codex")
                .join("superpowers")
                .join("skills")
                .join("brainstorming"),
        )
        .expect("create codex superpowers skill");
        fs::write(
            home.join(".codex")
                .join("superpowers")
                .join("skills")
                .join("brainstorming")
                .join("SKILL.md"),
            "---\nname: brainstorming\n---\n",
        )
        .expect("write codex superpowers skill");

        fs::create_dir_all(
            home.join(".agents")
                .join("skills")
                .join("mckinsey-consultant"),
        )
        .expect("create agents skill");
        fs::write(
            home.join(".agents")
                .join("skills")
                .join("mckinsey-consultant")
                .join("SKILL.md"),
            "---\nname: mckinsey-consultant\n---\n",
        )
        .expect("write agents skill");

        let result =
            onboarding_import_installed_skills_with_home(&home).expect("import installed skills");
        assert!(result.success);
        assert_eq!(result.detected_total, 0);
        assert_eq!(result.imported_total, 0);
        assert_eq!(result.skipped_existing_total, 0);
    }
}

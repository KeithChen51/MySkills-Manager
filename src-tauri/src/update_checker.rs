use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const UPDATE_SETTINGS_FILE: &str = "update_settings.json";
const PENDING_UPDATE_NOTES_FILE: &str = "pending_update_notes.json";
const DEFAULT_CHECK_INTERVAL_HOURS: u64 = 24;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct UpdateSettings {
    pub auto_check: bool,
    pub last_check_time: u64,
    pub check_interval_hours: u64,
    pub auto_install: bool,
    pub last_run_version: String,
}

impl Default for UpdateSettings {
    fn default() -> Self {
        Self {
            auto_check: true,
            last_check_time: 0,
            check_interval_hours: DEFAULT_CHECK_INTERVAL_HOURS,
            auto_install: false,
            last_run_version: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VersionJumpInfo {
    pub previous_version: String,
    pub current_version: String,
    pub release_notes: String,
    pub release_notes_zh: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct PendingUpdateNotes {
    pub version: String,
    #[serde(default)]
    pub release_notes: String,
    #[serde(default)]
    pub release_notes_zh: String,
}

fn app_config_dir_with_home(home: &Path) -> PathBuf {
    crate::root_dir::app_config_dir(home)
}

fn update_settings_path_with_home(home: &Path) -> PathBuf {
    app_config_dir_with_home(home).join(UPDATE_SETTINGS_FILE)
}

fn pending_update_notes_path_with_home(home: &Path) -> PathBuf {
    app_config_dir_with_home(home).join(PENDING_UPDATE_NOTES_FILE)
}

fn ensure_config_dir_with_home(home: &Path) -> Result<(), String> {
    fs::create_dir_all(app_config_dir_with_home(home))
        .map_err(|e| format!("Create app config dir failed: {e}"))
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn normalize_settings(mut settings: UpdateSettings) -> UpdateSettings {
    if settings.check_interval_hours == 0 {
        settings.check_interval_hours = DEFAULT_CHECK_INTERVAL_HOURS;
    }
    settings
}

fn parse_numeric_prefix(raw: &str) -> u64 {
    let digits: String = raw.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return 0;
    }
    digits.parse::<u64>().unwrap_or(0)
}

fn parse_version_parts(version: &str) -> Vec<u64> {
    version
        .split('.')
        .map(parse_numeric_prefix)
        .collect::<Vec<_>>()
}

fn is_newer_version(candidate: &str, baseline: &str) -> bool {
    let candidate_parts = parse_version_parts(candidate);
    let baseline_parts = parse_version_parts(baseline);
    let max_len = candidate_parts.len().max(baseline_parts.len());
    for idx in 0..max_len {
        let candidate_part = *candidate_parts.get(idx).unwrap_or(&0);
        let baseline_part = *baseline_parts.get(idx).unwrap_or(&0);
        if candidate_part > baseline_part {
            return true;
        }
        if candidate_part < baseline_part {
            return false;
        }
    }
    false
}

fn load_pending_update_notes_with_home(home: &Path) -> Result<Option<PendingUpdateNotes>, String> {
    let path = pending_update_notes_path_with_home(home);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Read pending update notes failed: {e}"))?;
    if raw.trim().is_empty() {
        return Ok(None);
    }
    let parsed = serde_json::from_str::<PendingUpdateNotes>(&raw)
        .map_err(|e| format!("Parse pending update notes failed: {e}"))?;
    Ok(Some(parsed))
}

fn remove_pending_update_notes_file_with_home(home: &Path) -> Result<(), String> {
    let path = pending_update_notes_path_with_home(home);
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("Remove pending update notes failed: {e}"))?;
    }
    Ok(())
}

pub fn should_check_for_updates(settings: &UpdateSettings) -> bool {
    if !settings.auto_check {
        return false;
    }
    if settings.last_check_time == 0 {
        return true;
    }
    let now = now_unix_secs();
    let elapsed_hours = now.saturating_sub(settings.last_check_time) / 3600;
    let interval = if settings.check_interval_hours > 0 {
        settings.check_interval_hours
    } else {
        DEFAULT_CHECK_INTERVAL_HOURS
    };
    elapsed_hours >= interval
}

pub fn load_update_settings_with_home(home: &Path) -> Result<UpdateSettings, String> {
    let path = update_settings_path_with_home(home);
    if !path.exists() {
        return Ok(UpdateSettings::default());
    }

    let raw = fs::read_to_string(path).map_err(|e| format!("Read update settings failed: {e}"))?;
    if raw.trim().is_empty() {
        return Ok(UpdateSettings::default());
    }

    let parsed =
        serde_json::from_str::<UpdateSettings>(&raw).map_err(|e| format!("Parse update settings failed: {e}"))?;
    let normalized = normalize_settings(parsed.clone());
    if normalized != parsed {
        save_update_settings_with_home(home, &normalized)?;
    }
    Ok(normalized)
}

pub fn save_update_settings_with_home(home: &Path, settings: &UpdateSettings) -> Result<(), String> {
    ensure_config_dir_with_home(home)?;
    let normalized = normalize_settings(settings.clone());
    let content = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("Serialize update settings failed: {e}"))?;
    fs::write(update_settings_path_with_home(home), format!("{content}\n"))
        .map_err(|e| format!("Write update settings failed: {e}"))
}

pub fn update_last_check_time_with_home(home: &Path) -> Result<(), String> {
    let mut settings = load_update_settings_with_home(home)?;
    settings.last_check_time = now_unix_secs();
    save_update_settings_with_home(home, &settings)
}

pub fn save_pending_update_notes_with_home(
    home: &Path,
    version: String,
    release_notes: String,
    release_notes_zh: String,
) -> Result<(), String> {
    let normalized_version = version.trim().to_string();
    if normalized_version.is_empty() {
        return Err("Version cannot be empty".to_string());
    }
    ensure_config_dir_with_home(home)?;
    let payload = PendingUpdateNotes {
        version: normalized_version,
        release_notes,
        release_notes_zh,
    };
    let content = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("Serialize pending update notes failed: {e}"))?;
    fs::write(
        pending_update_notes_path_with_home(home),
        format!("{content}\n"),
    )
    .map_err(|e| format!("Write pending update notes failed: {e}"))
}

pub fn check_version_jump_with_home(home: &Path) -> Result<Option<VersionJumpInfo>, String> {
    let mut settings = load_update_settings_with_home(home)?;
    let current_version = CURRENT_VERSION.to_string();

    if settings.last_run_version.is_empty() {
        settings.last_run_version = current_version;
        save_update_settings_with_home(home, &settings)?;
        return Ok(None);
    }

    if settings.last_run_version == current_version {
        return Ok(None);
    }

    let previous_version = settings.last_run_version.clone();
    settings.last_run_version = current_version.clone();
    save_update_settings_with_home(home, &settings)?;

    if !is_newer_version(&current_version, &previous_version) {
        if let Ok(Some(notes)) = load_pending_update_notes_with_home(home) {
            if notes.version == current_version || is_newer_version(&current_version, &notes.version) {
                let _ = remove_pending_update_notes_file_with_home(home);
            }
        }
        return Ok(None);
    }

    let mut release_notes = String::new();
    let mut release_notes_zh = String::new();

    match load_pending_update_notes_with_home(home) {
        Ok(Some(notes)) => {
            if notes.version == current_version {
                release_notes = notes.release_notes;
                release_notes_zh = notes.release_notes_zh;
                let _ = remove_pending_update_notes_file_with_home(home);
            } else if is_newer_version(&current_version, &notes.version) {
                let _ = remove_pending_update_notes_file_with_home(home);
            }
        }
        Ok(None) => {}
        Err(_) => {}
    }

    Ok(Some(VersionJumpInfo {
        previous_version,
        current_version,
        release_notes,
        release_notes_zh,
    }))
}

pub fn load_update_settings_default_home() -> Result<UpdateSettings, String> {
    load_update_settings_with_home(&crate::root_dir::default_home_dir())
}

pub fn save_update_settings_default_home(settings: &UpdateSettings) -> Result<(), String> {
    save_update_settings_with_home(&crate::root_dir::default_home_dir(), settings)
}

pub fn update_last_check_time_default_home() -> Result<(), String> {
    update_last_check_time_with_home(&crate::root_dir::default_home_dir())
}

pub fn save_pending_update_notes_default_home(
    version: String,
    release_notes: String,
    release_notes_zh: String,
) -> Result<(), String> {
    save_pending_update_notes_with_home(
        &crate::root_dir::default_home_dir(),
        version,
        release_notes,
        release_notes_zh,
    )
}

pub fn check_version_jump_default_home() -> Result<Option<VersionJumpInfo>, String> {
    check_version_jump_with_home(&crate::root_dir::default_home_dir())
}

#[tauri::command]
pub fn should_check_updates() -> Result<bool, String> {
    let settings = load_update_settings_default_home()?;
    Ok(should_check_for_updates(&settings))
}

#[tauri::command]
pub fn get_update_settings() -> Result<UpdateSettings, String> {
    load_update_settings_default_home()
}

#[tauri::command]
pub fn save_update_settings(settings: UpdateSettings) -> Result<(), String> {
    save_update_settings_default_home(&settings)
}

#[tauri::command]
pub fn update_last_check_time() -> Result<(), String> {
    update_last_check_time_default_home()
}

#[tauri::command]
pub fn save_pending_update_notes(
    version: String,
    release_notes: String,
    release_notes_zh: String,
) -> Result<(), String> {
    save_pending_update_notes_default_home(version, release_notes, release_notes_zh)
}

#[tauri::command]
pub fn check_version_jump() -> Result<Option<VersionJumpInfo>, String> {
    check_version_jump_default_home()
}

#[tauri::command]
pub fn update_log(level: String, message: String) -> Result<(), String> {
    let normalized_level = level.trim().to_lowercase();
    let normalized_message = message.trim();
    if normalized_message.is_empty() {
        return Ok(());
    }
    let line = format!("[Updater] {}", normalized_message);
    match normalized_level.as_str() {
        "error" => log::error!("{line}"),
        "warn" | "warning" => log::warn!("{line}"),
        _ => log::info!("{line}"),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn temp_home() -> PathBuf {
        let mut root = std::env::temp_dir();
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        root.push(format!("myskills-update-test-{ts}-{n}"));
        root
    }

    fn write_update_settings_raw(home: &Path, raw: &str) {
        fs::create_dir_all(app_config_dir_with_home(home)).expect("create config dir");
        fs::write(update_settings_path_with_home(home), raw).expect("write update settings");
    }

    #[test]
    fn load_update_settings_returns_defaults_when_file_missing() {
        let home = temp_home();
        let settings = load_update_settings_with_home(&home).expect("load settings");
        assert_eq!(settings, UpdateSettings::default());
    }

    #[test]
    fn load_update_settings_normalizes_zero_interval() {
        let home = temp_home();
        write_update_settings_raw(
            &home,
            r#"{
  "auto_check": false,
  "last_check_time": 123,
  "check_interval_hours": 0,
  "auto_install": true,
  "last_run_version": "0.1.0"
}"#,
        );
        let settings = load_update_settings_with_home(&home).expect("load settings");
        assert_eq!(settings.auto_check, false);
        assert_eq!(settings.last_check_time, 123);
        assert_eq!(settings.check_interval_hours, DEFAULT_CHECK_INTERVAL_HOURS);
        assert_eq!(settings.auto_install, true);
        assert_eq!(settings.last_run_version, "0.1.0");
    }

    #[test]
    fn should_check_for_updates_respects_interval_and_toggle() {
        let mut settings = UpdateSettings::default();
        assert!(should_check_for_updates(&settings));

        settings.auto_check = false;
        assert!(!should_check_for_updates(&settings));

        settings.auto_check = true;
        settings.last_check_time = now_unix_secs();
        settings.check_interval_hours = 24;
        assert!(!should_check_for_updates(&settings));

        settings.last_check_time = now_unix_secs().saturating_sub(60 * 60 * 26);
        assert!(should_check_for_updates(&settings));
    }

    #[test]
    fn update_last_check_time_persists_timestamp() {
        let home = temp_home();
        save_update_settings_with_home(&home, &UpdateSettings::default()).expect("save default settings");
        update_last_check_time_with_home(&home).expect("update check time");
        let settings = load_update_settings_with_home(&home).expect("reload settings");
        assert!(settings.last_check_time > 0);
    }

    #[test]
    fn check_version_jump_first_run_only_records_version() {
        let home = temp_home();
        save_update_settings_with_home(&home, &UpdateSettings::default()).expect("save default settings");
        let jump = check_version_jump_with_home(&home).expect("check version jump");
        assert!(jump.is_none());
        let settings = load_update_settings_with_home(&home).expect("load settings");
        assert_eq!(settings.last_run_version, CURRENT_VERSION);
    }

    #[test]
    fn check_version_jump_returns_release_notes_for_upgrade() {
        let home = temp_home();
        let settings = UpdateSettings {
            last_run_version: "0.0.1".to_string(),
            ..UpdateSettings::default()
        };
        save_update_settings_with_home(&home, &settings).expect("save initial settings");
        save_pending_update_notes_with_home(
            &home,
            CURRENT_VERSION.to_string(),
            "English notes".to_string(),
            "Chinese notes".to_string(),
        )
        .expect("save pending notes");

        let jump = check_version_jump_with_home(&home)
            .expect("check version jump")
            .expect("jump info");
        assert_eq!(jump.previous_version, "0.0.1");
        assert_eq!(jump.current_version, CURRENT_VERSION);
        assert_eq!(jump.release_notes, "English notes");
        assert_eq!(jump.release_notes_zh, "Chinese notes");

        let pending = load_pending_update_notes_with_home(&home).expect("load pending notes");
        assert!(pending.is_none());
    }

    #[test]
    fn check_version_jump_ignores_downgrade() {
        let home = temp_home();
        let settings = UpdateSettings {
            last_run_version: "99.0.0".to_string(),
            ..UpdateSettings::default()
        };
        save_update_settings_with_home(&home, &settings).expect("save settings");
        let jump = check_version_jump_with_home(&home).expect("check version jump");
        assert!(jump.is_none());
        let reloaded = load_update_settings_with_home(&home).expect("reload settings");
        assert_eq!(reloaded.last_run_version, CURRENT_VERSION);
    }

    #[test]
    fn version_compare_treats_longer_segments_as_newer() {
        assert!(is_newer_version("1.0.0.1", "1.0.0"));
        assert!(!is_newer_version("1.0.0", "1.0.0.1"));
        assert!(is_newer_version("2.0.0", "1.9.9"));
        assert!(!is_newer_version("1.0.0", "1.0.0"));
    }
}

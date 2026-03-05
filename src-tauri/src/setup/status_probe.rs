use chrono::{DateTime, Utc};
use std::fs;
use std::path::Path;

pub(super) fn file_contains_marker(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    match fs::read_to_string(path) {
        Ok(content) => content.contains("[MySkills Manager]"),
        Err(_) => false,
    }
}

pub(super) fn detect_sync_stats(skills_dir: &Path) -> Result<(usize, String, Option<String>), String> {
    if !skills_dir.exists() {
        return Ok((0, "none".to_string(), None));
    }

    let mut count = 0usize;
    let mut has_symlink = false;
    let mut latest_modified = None::<std::time::SystemTime>;
    let entries = fs::read_dir(skills_dir).map_err(|e| format!("Read skills dir failed: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Read skills entry failed: {e}"))?;
        let skill_file = entry.path().join("SKILL.md");
        if !skill_file.exists() {
            continue;
        }
        count += 1;
        let metadata =
            fs::symlink_metadata(&skill_file).map_err(|e| format!("Read skills metadata failed: {e}"))?;
        if metadata.file_type().is_symlink() {
            has_symlink = true;
        }
        if let Ok(modified) = fs::metadata(&skill_file).and_then(|item| item.modified()) {
            latest_modified = Some(match latest_modified {
                Some(current) if current > modified => current,
                _ => modified,
            });
        }
    }

    let mode = if count == 0 {
        "none"
    } else if has_symlink {
        "symlink"
    } else {
        "copy"
    };

    let last_sync_time = if mode == "copy" {
        latest_modified.map(|value| {
            let dt: DateTime<Utc> = value.into();
            dt.to_rfc3339()
        })
    } else {
        None
    };

    Ok((count, mode.to_string(), last_sync_time))
}

pub(super) fn detect_claude_hook(home: &Path) -> bool {
    let settings = home.join(".claude").join("settings.json");
    if !settings.exists() {
        return false;
    }
    match fs::read_to_string(settings) {
        Ok(content) => content.contains("skill-tracker.sh") || content.contains("skill-tracker.ps1"),
        Err(_) => false,
    }
}

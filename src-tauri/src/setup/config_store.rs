use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static SYNC_CONFIG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn sync_config_lock() -> &'static Mutex<()> {
    SYNC_CONFIG_LOCK.get_or_init(|| Mutex::new(()))
}

pub(super) fn with_sync_config_lock<T>(
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _guard = sync_config_lock()
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    operation()
}

fn custom_tools_file(home: &Path) -> PathBuf {
    crate::root_dir::app_config_dir(home).join("custom-tools.json")
}

fn tool_path_overrides_file(home: &Path) -> PathBuf {
    crate::root_dir::app_config_dir(home).join("tool-path-overrides.json")
}

fn sync_config_file(home: &Path) -> PathBuf {
    crate::root_dir::app_config_dir(home).join("sync-config.json")
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Config path parent is missing".to_string())?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Build atomic write timestamp failed: {e}"))?
        .as_nanos();
    let tmp = parent.join(format!(".sync-config.tmp-{ts}"));

    fs::write(&tmp, content).map_err(|e| format!("Write sync config temp file failed: {e}"))?;
    if let Err(first_rename_err) = fs::rename(&tmp, path) {
        if path.exists() {
            fs::remove_file(path).map_err(|e| format!("Replace sync config failed: {e}"))?;
            fs::rename(&tmp, path)
                .map_err(|e| format!("Finalize sync config replace failed: {e}"))?;
        } else {
            return Err(format!(
                "Move sync config temp file failed: {first_rename_err}"
            ));
        }
    }
    Ok(())
}

pub(super) fn read_custom_tools(home: &Path) -> Result<Vec<super::CustomTool>, String> {
    let path = custom_tools_file(home);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(path).map_err(|e| format!("Read custom tools failed: {e}"))?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }

    serde_json::from_str::<Vec<super::CustomTool>>(&raw)
        .map_err(|e| format!("Invalid custom tools config: {e}"))
}

pub(super) fn write_custom_tools(home: &Path, tools: &[super::CustomTool]) -> Result<(), String> {
    fs::create_dir_all(crate::root_dir::app_config_dir(home))
        .map_err(|e| format!("Create app config dir failed: {e}"))?;
    let content = serde_json::to_string_pretty(tools)
        .map_err(|e| format!("Serialize custom tools failed: {e}"))?;
    fs::write(custom_tools_file(home), format!("{content}\n"))
        .map_err(|e| format!("Write custom tools failed: {e}"))
}

pub(super) fn read_tool_path_overrides(
    home: &Path,
) -> Result<Vec<super::ToolPathOverride>, String> {
    let path = tool_path_overrides_file(home);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw =
        fs::read_to_string(path).map_err(|e| format!("Read tool path overrides failed: {e}"))?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }

    serde_json::from_str::<Vec<super::ToolPathOverride>>(&raw)
        .map_err(|e| format!("Invalid tool path overrides config: {e}"))
}

pub(super) fn write_tool_path_overrides(
    home: &Path,
    overrides: &[super::ToolPathOverride],
) -> Result<(), String> {
    fs::create_dir_all(crate::root_dir::app_config_dir(home))
        .map_err(|e| format!("Create app config dir failed: {e}"))?;
    let content = serde_json::to_string_pretty(overrides)
        .map_err(|e| format!("Serialize tool path overrides failed: {e}"))?;
    fs::write(tool_path_overrides_file(home), format!("{content}\n"))
        .map_err(|e| format!("Write tool path overrides failed: {e}"))
}

pub(super) fn read_sync_config(home: &Path) -> Result<Option<super::SyncConfigFile>, String> {
    let path = sync_config_file(home);
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|e| format!("Read sync config failed: {e}"))?;
    if raw.trim().is_empty() {
        return Ok(None);
    }

    let mut parsed = serde_json::from_str::<super::SyncConfigFile>(&raw)
        .map_err(|e| format!("Invalid sync config: {e}"))?;
    parsed.auto_tools = super::normalize_tool_ids(parsed.auto_tools);
    parsed.tracking_disabled_tools = super::normalize_tool_ids(parsed.tracking_disabled_tools);
    Ok(Some(parsed))
}

pub(super) fn write_sync_config_file(
    home: &Path,
    config: &super::SyncConfigFile,
) -> Result<(), String> {
    fs::create_dir_all(crate::root_dir::app_config_dir(home))
        .map_err(|e| format!("Create app config dir failed: {e}"))?;
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Serialize sync config failed: {e}"))?;
    atomic_write(&sync_config_file(home), &format!("{content}\n"))
}

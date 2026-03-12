use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;
use tauri::path::BaseDirectory;
use tauri::Manager;

const SKILLAR_VSCODE_EXTENSION_ID: &str = "keithchen51.skillar-vscode-extension";

fn push_unique_candidate(
    candidates: &mut Vec<String>,
    seen: &mut HashSet<String>,
    candidate: impl Into<String>,
) {
    let candidate = candidate.into();
    if seen.insert(candidate.to_ascii_lowercase()) {
        candidates.push(candidate);
    }
}

fn parse_where_output(raw: &str) -> Vec<String> {
    raw.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExtensionPresence {
    Installed,
    PendingUninstall,
    NotInstalled,
}

fn decode_text_file_lossy(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    if bytes.is_empty() {
        return Some(String::new());
    }
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Some(String::from_utf8_lossy(&bytes[3..]).to_string());
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let mut code_units = Vec::<u16>::new();
        for pair in bytes[2..].chunks_exact(2) {
            code_units.push(u16::from_le_bytes([pair[0], pair[1]]));
        }
        return Some(String::from_utf16_lossy(&code_units));
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let mut code_units = Vec::<u16>::new();
        for pair in bytes[2..].chunks_exact(2) {
            code_units.push(u16::from_be_bytes([pair[0], pair[1]]));
        }
        return Some(String::from_utf16_lossy(&code_units));
    }
    Some(String::from_utf8_lossy(&bytes).to_string())
}

fn normalize_obsolete_entry(raw: &str) -> Option<String> {
    let normalized = raw
        .trim()
        .trim_matches(',')
        .trim_matches('"')
        .trim()
        .to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized)
}

fn parse_obsolete_entries_from_text(raw: &str) -> HashSet<String> {
    let mut result = HashSet::<String>::new();
    let trimmed = raw.trim().trim_start_matches('\u{FEFF}');
    if trimmed.is_empty() {
        return result;
    }

    if let Ok(parsed) = serde_json::from_str::<Value>(trimmed) {
        match parsed {
            Value::Object(object) => {
                for key in object.keys() {
                    if let Some(normalized) = normalize_obsolete_entry(key) {
                        result.insert(normalized.clone());
                        if let Some(base_name) = normalized.rsplit(['/', '\\']).next() {
                            result.insert(base_name.to_string());
                        }
                    }
                }
                return result;
            }
            Value::Array(items) => {
                for item in items {
                    if let Some(text) = item.as_str().and_then(normalize_obsolete_entry) {
                        result.insert(text.clone());
                        if let Some(base_name) = text.rsplit(['/', '\\']).next() {
                            result.insert(base_name.to_string());
                        }
                    }
                }
                return result;
            }
            Value::String(value) => {
                if let Some(text) = normalize_obsolete_entry(&value) {
                    result.insert(text.clone());
                    if let Some(base_name) = text.rsplit(['/', '\\']).next() {
                        result.insert(base_name.to_string());
                    }
                }
                return result;
            }
            _ => {}
        }
    }

    for line in trimmed.lines() {
        if let Some(normalized) = normalize_obsolete_entry(line) {
            result.insert(normalized.clone());
            if let Some(base_name) = normalized.rsplit(['/', '\\']).next() {
                result.insert(base_name.to_string());
            }
        }
    }
    result
}

fn read_obsolete_extension_entries(dir: &Path) -> HashSet<String> {
    let obsolete_path = dir.join(".obsolete");
    let Some(content) = decode_text_file_lossy(&obsolete_path) else {
        return HashSet::new();
    };
    parse_obsolete_entries_from_text(&content)
}

fn extension_presence_in_dir(dir: &Path, extension_id: &str) -> ExtensionPresence {
    let Ok(entries) = fs::read_dir(dir) else {
        return ExtensionPresence::NotInstalled;
    };
    let obsolete_entries = read_obsolete_extension_entries(dir);
    let extension_prefix = extension_id.to_ascii_lowercase();
    let mut saw_pending = false;

    for entry in entries.filter_map(Result::ok) {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let lowered = name.to_string_lossy().to_ascii_lowercase();
        if !lowered.starts_with(&extension_prefix) {
            continue;
        }
        if obsolete_entries.contains(&lowered) {
            saw_pending = true;
            continue;
        }
        return ExtensionPresence::Installed;
    }

    if saw_pending {
        ExtensionPresence::PendingUninstall
    } else {
        ExtensionPresence::NotInstalled
    }
}

fn extension_directories_with_home(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".vscode").join("extensions"),
        home.join(".vscode-insiders").join("extensions"),
        home.join(".vscode-oss").join("extensions"),
    ]
}

fn extension_presence_in_home(home: &Path, extension_id: &str) -> ExtensionPresence {
    let mut saw_pending = false;
    for dir in extension_directories_with_home(home) {
        match extension_presence_in_dir(&dir, extension_id) {
            ExtensionPresence::Installed => return ExtensionPresence::Installed,
            ExtensionPresence::PendingUninstall => saw_pending = true,
            ExtensionPresence::NotInstalled => {}
        }
    }
    if saw_pending {
        ExtensionPresence::PendingUninstall
    } else {
        ExtensionPresence::NotInstalled
    }
}

fn extension_installed_in_home(home: &Path, extension_id: &str) -> bool {
    extension_presence_in_home(home, extension_id) == ExtensionPresence::Installed
}

fn is_supported_vscode_cli_command(candidate: &str) -> bool {
    let trimmed = candidate.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lowered = trimmed.to_ascii_lowercase();
    if lowered.ends_with(".exe") {
        return false;
    }
    let file_name = Path::new(trimmed)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(trimmed)
        .to_ascii_lowercase();
    matches!(
        file_name.as_str(),
        "code"
            | "code.cmd"
            | "code-insiders"
            | "code-insiders.cmd"
            | "codium"
            | "codium.cmd"
            | "cursor"
            | "cursor.cmd"
    )
}

fn push_cli_candidate(
    candidates: &mut Vec<String>,
    seen: &mut HashSet<String>,
    candidate: impl Into<String>,
) {
    let candidate = candidate.into();
    if is_supported_vscode_cli_command(&candidate) {
        push_unique_candidate(candidates, seen, candidate);
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VscodeExtensionInstallResult {
    pub success: bool,
    pub vsix_path: String,
    pub vscode_cli: String,
    pub settings_path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VscodeSettingsSyncResult {
    pub success: bool,
    pub settings_path: String,
    pub skills_dir: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VscodeExtensionStatusResult {
    pub installed: bool,
    pub detected_by: String,
    pub vscode_cli: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VscodeExtensionUninstallResult {
    pub success: bool,
    pub vscode_cli: String,
}

fn vscode_extension_status_with_home(home: &Path) -> VscodeExtensionStatusResult {
    let presence = extension_presence_in_home(home, SKILLAR_VSCODE_EXTENSION_ID);
    VscodeExtensionStatusResult {
        installed: presence == ExtensionPresence::Installed,
        detected_by: match presence {
            ExtensionPresence::Installed => "filesystem".to_string(),
            ExtensionPresence::PendingUninstall => "pending-uninstall".to_string(),
            ExtensionPresence::NotInstalled => "none".to_string(),
        },
        vscode_cli: None,
    }
}

fn vscode_settings_path_with_home(home: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        return home
            .join("AppData")
            .join("Roaming")
            .join("Code")
            .join("User")
            .join("settings.json");
    }

    #[cfg(target_os = "macos")]
    {
        return home
            .join("Library")
            .join("Application Support")
            .join("Code")
            .join("User")
            .join("settings.json");
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        return home.join(".config").join("Code").join("User").join("settings.json");
    }
}

fn read_settings_object(path: &Path) -> Result<Map<String, Value>, String> {
    if !path.exists() {
        return Ok(Map::new());
    }

    let raw = fs::read_to_string(path).map_err(|e| format!("Read VS Code settings failed: {e}"))?;
    if raw.trim().is_empty() {
        return Ok(Map::new());
    }

    let parsed =
        serde_json::from_str::<Value>(&raw).map_err(|e| format!("Parse VS Code settings failed: {e}"))?;
    let object = parsed
        .as_object()
        .ok_or_else(|| "VS Code settings JSON root must be an object".to_string())?;
    Ok(object.clone())
}

fn write_settings_object(path: &Path, object: &Map<String, Value>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Create VS Code settings directory failed: {e}"))?;
    }

    let content = serde_json::to_string_pretty(&Value::Object(object.clone()))
        .map_err(|e| format!("Serialize VS Code settings failed: {e}"))?;
    fs::write(path, format!("{content}\n"))
        .map_err(|e| format!("Write VS Code settings failed: {e}"))
}

pub fn sync_vscode_settings_with_home(home: &Path, skills_dir: &Path) -> Result<PathBuf, String> {
    let settings_path = vscode_settings_path_with_home(home);
    let mut object = read_settings_object(&settings_path)?;
    object.insert(
        "skillar.skillsRoot".to_string(),
        Value::String(skills_dir.to_string_lossy().to_string()),
    );
    write_settings_object(&settings_path, &object)?;
    Ok(settings_path)
}

fn vscode_cli_candidates_with_home(home: &Path) -> Vec<String> {
    let mut candidates = Vec::<String>::new();
    let mut seen = HashSet::<String>::new();

    #[cfg(target_os = "windows")]
    {
        let local_programs = home.join("AppData").join("Local").join("Programs");
        for (folder, bin_cmd) in [
            ("Microsoft VS Code", "code.cmd"),
            ("Microsoft VS Code Insiders", "code-insiders.cmd"),
            ("VSCodium", "codium.cmd"),
            ("Cursor", "cursor.cmd"),
        ] {
            push_cli_candidate(
                &mut candidates,
                &mut seen,
                local_programs
                    .join(folder)
                    .join("bin")
                    .join(bin_cmd)
                    .to_string_lossy()
                    .to_string(),
            );
        }

        for env_key in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Ok(program_files) = std::env::var(env_key) {
                let base = PathBuf::from(program_files);
                for (folder, bin_cmd) in [
                    ("Microsoft VS Code", "code.cmd"),
                    ("Microsoft VS Code Insiders", "code-insiders.cmd"),
                    ("VSCodium", "codium.cmd"),
                    ("Cursor", "cursor.cmd"),
                ] {
                    push_cli_candidate(
                        &mut candidates,
                        &mut seen,
                        base.join(folder)
                            .join("bin")
                            .join(bin_cmd)
                            .to_string_lossy()
                            .to_string(),
                    );
                }
            }
        }

        for probe in [
            "code",
            "code.cmd",
            "code-insiders",
            "code-insiders.cmd",
            "codium",
            "codium.cmd",
            "cursor",
            "cursor.cmd",
        ] {
            if let Ok(output) = Command::new("where").arg(probe).output() {
                if output.status.success() {
                    for path in parse_where_output(&String::from_utf8_lossy(&output.stdout)) {
                        push_cli_candidate(&mut candidates, &mut seen, path);
                    }
                }
            }
        }

        for fallback in [
            "code.cmd",
            "code",
            "code-insiders.cmd",
            "code-insiders",
            "codium.cmd",
            "codium",
            "cursor.cmd",
            "cursor",
        ] {
            push_cli_candidate(&mut candidates, &mut seen, fallback.to_string());
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        for candidate in ["code", "code-insiders", "codium", "cursor"] {
            push_cli_candidate(&mut candidates, &mut seen, candidate.to_string());
        }
    }

    candidates
}

fn extension_list_contains(raw: &str, extension_id: &str) -> bool {
    raw.lines().any(|line| {
        let normalized = line
            .trim()
            .split_once('@')
            .map(|(id, _)| id)
            .unwrap_or(line.trim());
        normalized.eq_ignore_ascii_case(extension_id)
    })
}

fn command_failure_message(prefix: &str, program: &str, output: &std::process::Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let code = output
        .status
        .code()
        .map(|value| value.to_string())
        .unwrap_or_else(|| "terminated".to_string());
    format!("{prefix} ({program}, code {code}). stdout: {stdout}. stderr: {stderr}")
}

fn run_install_command(program: &str, vsix_path: &Path) -> Result<(), String> {
    let output = Command::new(program)
        .arg("--install-extension")
        .arg(vsix_path)
        .arg("--force")
        .output()
        .map_err(|e| format!("Run VS Code install command failed ({program}): {e}"))?;
    if output.status.success() {
        return Ok(());
    }

    Err(command_failure_message(
        "VS Code install command failed",
        program,
        &output,
    ))
}

fn run_uninstall_command(program: &str, extension_id: &str) -> Result<(), String> {
    let output = Command::new(program)
        .arg("--uninstall-extension")
        .arg(extension_id)
        .output()
        .map_err(|e| format!("Run VS Code uninstall command failed ({program}): {e}"))?;
    if output.status.success() {
        return Ok(());
    }

    Err(command_failure_message(
        "VS Code uninstall command failed",
        program,
        &output,
    ))
}

fn read_extension_list(program: &str) -> Result<String, String> {
    let with_versions = Command::new(program)
        .arg("--list-extensions")
        .arg("--show-versions")
        .output()
        .map_err(|e| format!("Run VS Code list command failed ({program}): {e}"))?;
    if with_versions.status.success() {
        return Ok(String::from_utf8_lossy(&with_versions.stdout).to_string());
    }

    let plain = Command::new(program)
        .arg("--list-extensions")
        .output()
        .map_err(|e| format!("Run VS Code list command fallback failed ({program}): {e}"))?;
    if plain.status.success() {
        return Ok(String::from_utf8_lossy(&plain.stdout).to_string());
    }

    Err(format!(
        "{} | {}",
        command_failure_message(
            "VS Code list command failed (--show-versions)",
            program,
            &with_versions
        ),
        command_failure_message("VS Code list command failed", program, &plain)
    ))
}

fn verify_extension_installed(program: &str, extension_id: &str) -> Result<(), String> {
    let raw_list = read_extension_list(program)?;
    if extension_list_contains(&raw_list, extension_id) {
        return Ok(());
    }

    Err(format!(
        "VS Code reported install success but extension {extension_id} was not found in list for {program}"
    ))
}

fn verify_extension_removed(program: &str, extension_id: &str) -> Result<(), String> {
    let raw_list = read_extension_list(program)?;
    if !extension_list_contains(&raw_list, extension_id) {
        return Ok(());
    }
    Err(format!(
        "VS Code reported uninstall success but extension {extension_id} is still listed for {program}"
    ))
}

fn build_install_failure_message(vsix_path: &Path, errors: &[String]) -> String {
    let sample = errors.iter().take(4).cloned().collect::<Vec<String>>();
    let detail = if sample.is_empty() {
        "no command output".to_string()
    } else {
        sample.join(" | ")
    };
    let more = errors.len().saturating_sub(sample.len());
    let suffix = if more > 0 {
        format!(" | ... {} more error(s)", more)
    } else {
        String::new()
    };
    let quoted_vsix = vsix_path.to_string_lossy();
    format!(
        "Unable to install VS Code extension automatically. VSIX: {quoted_vsix}. Manual install: \
code --install-extension \"{quoted_vsix}\" --force (or code-insiders/codium/cursor). Details: {detail}{suffix}"
    )
}

fn build_uninstall_failure_message(errors: &[String]) -> String {
    let sample = errors.iter().take(4).cloned().collect::<Vec<String>>();
    let detail = if sample.is_empty() {
        "no command output".to_string()
    } else {
        sample.join(" | ")
    };
    let more = errors.len().saturating_sub(sample.len());
    let suffix = if more > 0 {
        format!(" | ... {} more error(s)", more)
    } else {
        String::new()
    };
    format!(
        "Unable to uninstall VS Code extension automatically. Manual uninstall: \
code --uninstall-extension {SKILLAR_VSCODE_EXTENSION_ID} (or code-insiders/codium/cursor). Details: {detail}{suffix}"
    )
}

fn is_not_installed_uninstall_error(error: &str) -> bool {
    let lowered = error.to_ascii_lowercase();
    lowered.contains("not installed")
        || lowered.contains("is not installed")
        || error.contains("未安装")
}

fn install_vsix_with_home(home: &Path, vsix_path: &Path) -> Result<String, String> {
    let candidates = vscode_cli_candidates_with_home(home);
    let mut errors = Vec::<String>::new();

    for candidate in candidates {
        match run_install_command(&candidate, vsix_path)
            .and_then(|_| verify_extension_installed(&candidate, SKILLAR_VSCODE_EXTENSION_ID))
        {
            Ok(()) => return Ok(candidate),
            Err(err) => errors.push(err),
        }
    }

    Err(build_install_failure_message(vsix_path, &errors))
}

fn uninstall_extension_with_home(home: &Path) -> Result<String, String> {
    let candidates = vscode_cli_candidates_with_home(home);
    let mut errors = Vec::<String>::new();
    let mut found_not_installed = false;

    for candidate in candidates {
        match run_uninstall_command(&candidate, SKILLAR_VSCODE_EXTENSION_ID)
            .and_then(|_| verify_extension_removed(&candidate, SKILLAR_VSCODE_EXTENSION_ID))
        {
            Ok(()) => return Ok(candidate),
            Err(err) => {
                if is_not_installed_uninstall_error(&err) {
                    found_not_installed = true;
                }
                errors.push(err);
            }
        }
    }

    if found_not_installed {
        return Ok("not-installed".to_string());
    }

    Err(build_uninstall_failure_message(&errors))
}

fn normalize_skills_dir(skills_dir: &str) -> Result<PathBuf, String> {
    let normalized = skills_dir.trim();
    if normalized.is_empty() {
        return Err("skills dir is required".to_string());
    }
    let path = PathBuf::from(normalized);
    if !path.exists() {
        return Err(format!("skills dir does not exist: {}", path.to_string_lossy()));
    }
    if !path.is_dir() {
        return Err(format!("skills dir is not a directory: {}", path.to_string_lossy()));
    }
    Ok(fs::canonicalize(&path).unwrap_or(path))
}

pub fn sync_skills_root_with_home(
    home: &Path,
    skills_dir: &str,
) -> Result<VscodeSettingsSyncResult, String> {
    let normalized_skills_dir = normalize_skills_dir(skills_dir)?;
    let settings_path = sync_vscode_settings_with_home(home, &normalized_skills_dir)?;
    Ok(VscodeSettingsSyncResult {
        success: true,
        settings_path: settings_path.to_string_lossy().to_string(),
        skills_dir: normalized_skills_dir.to_string_lossy().to_string(),
    })
}

fn push_unique_path(candidates: &mut Vec<PathBuf>, seen: &mut HashSet<String>, path: PathBuf) {
    let key = path.to_string_lossy().to_ascii_lowercase();
    if seen.insert(key) {
        candidates.push(path);
    }
}

fn find_preferred_existing_vsix_path(candidates: &[PathBuf]) -> Option<PathBuf> {
    let mut preferred: Option<(PathBuf, SystemTime, usize)> = None;

    for (index, path) in candidates.iter().enumerate() {
        if !path.exists() {
            continue;
        }
        let modified_at = fs::metadata(path)
            .and_then(|meta| meta.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);

        match &preferred {
            None => {
                preferred = Some((path.clone(), modified_at, index));
            }
            Some((_, current_modified_at, current_index)) => {
                if modified_at > *current_modified_at
                    || (modified_at == *current_modified_at && index < *current_index)
                {
                    preferred = Some((path.clone(), modified_at, index));
                }
            }
        }
    }

    preferred.map(|(path, _, _)| path)
}

fn resolve_vsix_fallback_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::<PathBuf>::new();
    let mut seen = HashSet::<String>::new();

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            push_unique_path(
                &mut candidates,
                &mut seen,
                exe_dir.join("skillar-vscode.vsix"),
            );
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    push_unique_path(
        &mut candidates,
        &mut seen,
        manifest_dir.join("resources").join("skillar-vscode.vsix"),
    );
    if let Some(project_root) = manifest_dir.parent() {
        push_unique_path(
            &mut candidates,
            &mut seen,
            project_root.join("release").join("skillar-vscode.vsix"),
        );
    }

    if let Ok(current_dir) = std::env::current_dir() {
        push_unique_path(
            &mut candidates,
            &mut seen,
            current_dir
                .join("src-tauri")
                .join("resources")
                .join("skillar-vscode.vsix"),
        );
        push_unique_path(
            &mut candidates,
            &mut seen,
            current_dir.join("release").join("skillar-vscode.vsix"),
        );
    }

    candidates
}

fn resolve_vsix_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::<PathBuf>::new();
    let mut seen = HashSet::<String>::new();

    if let Ok(resource_path) = app_handle
        .path()
        .resolve("skillar-vscode.vsix", BaseDirectory::Resource)
    {
        push_unique_path(&mut candidates, &mut seen, resource_path);
    }
    for fallback in resolve_vsix_fallback_candidates() {
        push_unique_path(&mut candidates, &mut seen, fallback);
    }

    if let Some(path) = find_preferred_existing_vsix_path(&candidates) {
        return Ok(path);
    }

    let tried = candidates
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<String>>()
        .join(" | ");
    Err(format!("Bundled VSIX not found. Tried: {tried}"))
}

#[tauri::command]
pub fn vscode_extension_install(
    app_handle: tauri::AppHandle,
    skills_dir: String,
) -> Result<VscodeExtensionInstallResult, String> {
    let home = crate::root_dir::default_home_dir();
    let sync_result = sync_skills_root_with_home(&home, &skills_dir)?;
    let vsix_path = resolve_vsix_path(&app_handle)?;
    let vscode_cli = install_vsix_with_home(&home, &vsix_path)?;
    Ok(VscodeExtensionInstallResult {
        success: true,
        vsix_path: vsix_path.to_string_lossy().to_string(),
        vscode_cli,
        settings_path: sync_result.settings_path,
    })
}

#[tauri::command]
pub fn vscode_extension_sync_skills_root(
    skills_dir: String,
) -> Result<VscodeSettingsSyncResult, String> {
    sync_skills_root_with_home(&crate::root_dir::default_home_dir(), &skills_dir)
}

#[tauri::command]
pub fn vscode_extension_status() -> Result<VscodeExtensionStatusResult, String> {
    Ok(vscode_extension_status_with_home(
        &crate::root_dir::default_home_dir(),
    ))
}

#[tauri::command]
pub fn vscode_extension_uninstall() -> Result<VscodeExtensionUninstallResult, String> {
    let home = crate::root_dir::default_home_dir();
    if !extension_installed_in_home(&home, SKILLAR_VSCODE_EXTENSION_ID) {
        return Ok(VscodeExtensionUninstallResult {
            success: true,
            vscode_cli: "not-installed".to_string(),
        });
    }

    let vscode_cli = uninstall_extension_with_home(&home)?;
    Ok(VscodeExtensionUninstallResult {
        success: true,
        vscode_cli,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn temp_home() -> PathBuf {
        let mut root = std::env::temp_dir();
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        root.push(format!("myskills-vscode-extension-test-{ts}-{n}"));
        root
    }

    #[test]
    fn sync_vscode_settings_writes_skills_root() {
        let home = temp_home();
        let skills_dir = home.join("my-skills");
        fs::create_dir_all(&skills_dir).expect("create skills dir");

        let settings_path =
            sync_vscode_settings_with_home(&home, &skills_dir).expect("sync vscode settings");
        let raw = fs::read_to_string(settings_path).expect("read settings");
        let parsed = serde_json::from_str::<Value>(&raw).expect("parse settings");
        let skills_root = parsed
            .as_object()
            .and_then(|item| item.get("skillar.skillsRoot"))
            .and_then(|item| item.as_str())
            .expect("read skillar.skillsRoot");
        assert_eq!(skills_root, skills_dir.to_string_lossy().to_string());
    }

    #[test]
    fn sync_vscode_settings_preserves_existing_entries() {
        let home = temp_home();
        let skills_dir = home.join("my-skills");
        fs::create_dir_all(&skills_dir).expect("create skills dir");

        let settings_path = home
            .join("AppData")
            .join("Roaming")
            .join("Code")
            .join("User")
            .join("settings.json");
        fs::create_dir_all(settings_path.parent().expect("settings parent"))
            .expect("create settings parent");
        fs::write(
            &settings_path,
            r#"{
  "editor.fontSize": 14
}
"#,
        )
        .expect("seed settings");

        let output =
            sync_vscode_settings_with_home(&home, &skills_dir).expect("sync vscode settings");
        assert_eq!(output, settings_path);

        let raw = fs::read_to_string(output).expect("read settings");
        let parsed = serde_json::from_str::<Value>(&raw).expect("parse settings");
        let settings = parsed.as_object().expect("settings object");
        assert_eq!(
            settings
                .get("editor.fontSize")
                .and_then(|item| item.as_i64())
                .expect("editor.fontSize"),
            14
        );
        assert_eq!(
            settings
                .get("skillar.skillsRoot")
                .and_then(|item| item.as_str())
                .expect("skillar.skillsRoot"),
            skills_dir.to_string_lossy().to_string()
        );
    }

    #[test]
    fn sync_skills_root_with_home_returns_metadata() {
        let home = temp_home();
        let skills_dir = home.join("my-skills");
        fs::create_dir_all(&skills_dir).expect("create skills dir");

        let result =
            sync_skills_root_with_home(&home, &skills_dir.to_string_lossy()).expect("sync root");
        assert!(result.success);
        assert!(result.settings_path.ends_with("settings.json"));
        let expected = fs::canonicalize(&skills_dir)
            .unwrap_or(skills_dir.clone())
            .to_string_lossy()
            .to_string();
        assert_eq!(result.skills_dir, expected);
    }

    #[test]
    fn extension_list_contains_matches_exact_id() {
        let raw = "foo.bar\nkeithchen51.skillar-vscode-extension\n";
        assert!(extension_list_contains(raw, "keithchen51.skillar-vscode-extension"));
    }

    #[test]
    fn extension_list_contains_matches_id_with_version_suffix() {
        let raw = "foo.bar@1.0.0\nkeithchen51.skillar-vscode-extension@0.1.0\n";
        assert!(extension_list_contains(raw, "keithchen51.skillar-vscode-extension"));
    }

    #[test]
    fn extension_list_contains_is_case_insensitive() {
        let raw = "KEITHCHEN51.SKILLAR-VSCODE-EXTENSION\n";
        assert!(extension_list_contains(raw, "keithchen51.skillar-vscode-extension"));
    }

    #[test]
    fn extension_list_contains_returns_false_for_missing_extension() {
        let raw = "foo.bar\nbaz.qux\n";
        assert!(!extension_list_contains(
            raw,
            "keithchen51.skillar-vscode-extension"
        ));
    }

    #[test]
    fn build_install_failure_message_includes_manual_install_command() {
        let message = build_install_failure_message(
            Path::new("C:/tmp/skillar-vscode.vsix"),
            &[
                "Run VS Code install command failed (code.cmd): not found".to_string(),
                "Run VS Code install command failed (codium.cmd): not found".to_string(),
            ],
        );
        assert!(message.contains("Manual install"));
        assert!(message.contains("code --install-extension"));
        assert!(message.contains("C:/tmp/skillar-vscode.vsix"));
    }

    #[test]
    fn parse_where_output_trims_blank_lines() {
        let parsed = parse_where_output("C:\\a\\code.cmd\n\n  C:\\b\\code.cmd  \n");
        assert_eq!(
            parsed,
            vec!["C:\\a\\code.cmd".to_string(), "C:\\b\\code.cmd".to_string()]
        );
    }

    #[test]
    fn extension_installed_in_home_detects_extension_folder_prefix() {
        let home = temp_home();
        let extension_dir = home.join(".vscode").join("extensions");
        fs::create_dir_all(&extension_dir).expect("create extension dir");
        fs::create_dir_all(
            extension_dir.join("keithchen51.skillar-vscode-extension-0.1.1"),
        )
        .expect("create extension folder");

        assert!(extension_installed_in_home(
            &home,
            "keithchen51.skillar-vscode-extension"
        ));
    }

    #[test]
    fn extension_installed_in_home_returns_false_when_marked_obsolete() {
        let home = temp_home();
        let extension_dir = home.join(".vscode").join("extensions");
        fs::create_dir_all(&extension_dir).expect("create extension dir");
        let folder_name = "keithchen51.skillar-vscode-extension-0.1.2";
        fs::create_dir_all(extension_dir.join(folder_name)).expect("create extension folder");
        fs::write(
            extension_dir.join(".obsolete"),
            format!(r#"{{"{folder_name}":true}}"#),
        )
        .expect("write obsolete marker");

        assert!(!extension_installed_in_home(
            &home,
            "keithchen51.skillar-vscode-extension"
        ));
    }

    #[test]
    fn vscode_extension_status_with_home_reports_installed_from_filesystem() {
        let home = temp_home();
        let extension_dir = home.join(".vscode").join("extensions");
        fs::create_dir_all(&extension_dir).expect("create extension dir");
        fs::create_dir_all(
            extension_dir.join("keithchen51.skillar-vscode-extension-0.1.1"),
        )
        .expect("create extension folder");

        let status = vscode_extension_status_with_home(&home);
        assert!(status.installed);
        assert_eq!(status.detected_by, "filesystem");
        assert_eq!(status.vscode_cli, None);
    }

    #[test]
    fn vscode_extension_status_with_home_reports_pending_uninstall() {
        let home = temp_home();
        let extension_dir = home.join(".vscode").join("extensions");
        fs::create_dir_all(&extension_dir).expect("create extension dir");
        let folder_name = "keithchen51.skillar-vscode-extension-0.1.2";
        fs::create_dir_all(extension_dir.join(folder_name)).expect("create extension folder");
        fs::write(
            extension_dir.join(".obsolete"),
            format!(r#"{{"{folder_name}":true}}"#),
        )
        .expect("write obsolete marker");

        let status = vscode_extension_status_with_home(&home);
        assert!(!status.installed);
        assert_eq!(status.detected_by, "pending-uninstall");
        assert_eq!(status.vscode_cli, None);
    }

    #[test]
    fn vscode_extension_status_with_home_reports_pending_uninstall_with_utf8_bom_obsolete() {
        let home = temp_home();
        let extension_dir = home.join(".vscode").join("extensions");
        fs::create_dir_all(&extension_dir).expect("create extension dir");
        let folder_name = "keithchen51.skillar-vscode-extension-0.1.3";
        fs::create_dir_all(extension_dir.join(folder_name)).expect("create extension folder");
        fs::write(
            extension_dir.join(".obsolete"),
            format!("\u{FEFF}{{\"{folder_name}\":true}}"),
        )
        .expect("write obsolete marker with utf8 bom");

        let status = vscode_extension_status_with_home(&home);
        assert!(!status.installed);
        assert_eq!(status.detected_by, "pending-uninstall");
    }

    #[test]
    fn vscode_extension_status_with_home_reports_not_installed_without_extension_dir() {
        let home = temp_home();
        fs::create_dir_all(&home).expect("create home dir");

        let status = vscode_extension_status_with_home(&home);
        assert!(!status.installed);
        assert_eq!(status.detected_by, "none");
        assert_eq!(status.vscode_cli, None);
    }

    #[test]
    fn find_preferred_existing_vsix_path_returns_newest_candidate() {
        let home = temp_home();
        fs::create_dir_all(&home).expect("create home dir");
        let older = home.join("src-tauri").join("resources").join("skillar-vscode.vsix");
        let newer = home.join("release").join("skillar-vscode.vsix");
        fs::create_dir_all(older.parent().expect("older parent"))
            .expect("create parent");
        fs::create_dir_all(newer.parent().expect("newer parent"))
            .expect("create parent");
        fs::write(&older, "older").expect("write older vsix");
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&newer, "newer").expect("write newer vsix");

        let result = find_preferred_existing_vsix_path(&[older, newer.clone()]);
        assert_eq!(result, Some(newer));
    }

    #[test]
    fn resolve_vsix_fallback_candidates_include_manifest_resources_path() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let expected = manifest_dir.join("resources").join("skillar-vscode.vsix");
        let candidates = resolve_vsix_fallback_candidates();
        assert!(candidates.iter().any(|p| p == &expected));
    }

    #[test]
    fn is_supported_vscode_cli_command_filters_gui_executables() {
        assert!(is_supported_vscode_cli_command("code.cmd"));
        assert!(is_supported_vscode_cli_command("C:\\Tools\\Code\\bin\\code.cmd"));
        assert!(is_supported_vscode_cli_command("code"));

        assert!(!is_supported_vscode_cli_command(""));
        assert!(!is_supported_vscode_cli_command("C:\\Tools\\Code\\Code.exe"));
        assert!(!is_supported_vscode_cli_command("Code.exe"));
        assert!(!is_supported_vscode_cli_command("notepad.exe"));
    }

    #[test]
    fn is_not_installed_uninstall_error_detects_common_messages() {
        assert!(is_not_installed_uninstall_error(
            "VS Code uninstall command failed (code.cmd, code 1). stderr: Extension 'keithchen51.skillar-vscode-extension' is not installed."
        ));
        assert!(is_not_installed_uninstall_error("扩展未安装，无法卸载"));
        assert!(!is_not_installed_uninstall_error(
            "VS Code uninstall command failed (code.cmd): permission denied"
        ));
    }
}

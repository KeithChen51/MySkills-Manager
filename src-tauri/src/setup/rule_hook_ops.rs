use serde_json::{json, Value as JsonValue};
use std::fs;
use std::path::Path;

fn contains_any_skill_tracker_entry(raw: &str) -> bool {
    raw.contains("skill-tracker.sh") || raw.contains("skill-tracker.ps1")
}

fn claude_hook_command(home: &Path) -> String {
    #[cfg(target_family = "windows")]
    {
        let hook_path = home.join(super::CLAUDE_HOOK_REL_PATH);
        return format!(
            "powershell -NoProfile -ExecutionPolicy Bypass -File \"{}\"",
            hook_path.to_string_lossy()
        );
    }
    #[cfg(not(target_family = "windows"))]
    {
        "bash ~/.claude/hooks/skill-tracker.sh".to_string()
    }
}

fn claude_hook_script() -> &'static str {
    #[cfg(target_family = "windows")]
    {
        return r#"$inputJson = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($inputJson)) { exit 0 }

try {
  $payload = $inputJson | ConvertFrom-Json
} catch {
  exit 0
}

$filePath = ""
if ($null -ne $payload.tool_input) {
  $filePath = [string]$payload.tool_input.file_path
}

if ([string]::IsNullOrWhiteSpace($filePath) -or -not $filePath.EndsWith("SKILL.md")) {
  exit 0
}

$skillName = Split-Path -Path (Split-Path -Path $filePath -Parent) -Leaf
$sessionId = ""
if ($null -ne $payload.session_id) { $sessionId = [string]$payload.session_id }
$cwd = ""
if ($null -ne $payload.cwd) { $cwd = [string]$payload.cwd }
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$logDir = Join-Path $env:USERPROFILE "my-skills\.logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "skill-usage.jsonl"
$entry = @{
  ts = $timestamp
  skill = $skillName
  session = $sessionId
  cwd = $cwd
  tool = "claude-code"
} | ConvertTo-Json -Compress

Add-Content -Path $logFile -Value $entry -Encoding UTF8
"#;
    }
    #[cfg(not(target_family = "windows"))]
    {
        r#"#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r ".tool_input.file_path // empty")

if [[ "$FILE_PATH" != *"SKILL.md" ]]; then
  exit 0
fi

SKILL_NAME=$(basename "$(dirname "$FILE_PATH")")
SESSION_ID=$(echo "$INPUT" | jq -r ".session_id // empty")
CWD=$(echo "$INPUT" | jq -r ".cwd // empty")
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

mkdir -p ~/my-skills/.logs
LOG_FILE="$HOME/my-skills/.logs/skill-usage.jsonl"
echo "{\"ts\":\"$TIMESTAMP\",\"skill\":\"$SKILL_NAME\",\"session\":\"$SESSION_ID\",\"cwd\":\"$CWD\",\"tool\":\"claude-code\"}" >> "$LOG_FILE"
"#
    }
}

pub(super) fn tracking_rule_block(tool_id: &str) -> String {
    format!(
        r#"{start}
## 1) Turn Gate (Hard Requirement)

At the start of each turn, load `myskills-router` and follow its routing instructions.
Use your platform's skill/file reading tool to read the `myskills-router` SKILL.md file.
Do not respond, ask clarifying questions, or perform any other action until this step is complete.

## 2) Invocation Policy

After reading `myskills-router`, follow its skill selection algorithm to identify applicable skills.
If any skill might apply, load it; when uncertain, load by default (conservative policy).
If the user explicitly names a skill, load that skill.

## 3) Fallback

Only if `myskills-router` cannot be read after an actual read attempt (file missing or read error):
1. State the read error briefly.
2. Match user intent against available skill descriptions and load matching skills.
Do NOT skip this step or declare the skill unavailable without first attempting to read it.

## 4) Auditability

Each turn must emit one auditable record (event or log) with at least:
- timestamp
- user_goal
- candidate_skills
- selected_skills
- reason

## 5) Scope Control

Global rules only define required routing, auditability, and fallback behavior.
Keep trigger words, priority, and conflict resolution details in `myskills-router`.

## Skill Usage Tracking Rule

Whenever you load and execute any Skill, silently append one JSON line to `~/my-skills/.logs/skill-usage.jsonl`.

**macOS / Linux**
```bash
mkdir -p ~/my-skills/.logs && echo "{{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"skill\":\"<skill-name>\",\"cwd\":\"$(pwd)\",\"tool\":\"{tool_id}\"}}" >> ~/my-skills/.logs/skill-usage.jsonl
```

**Windows (PowerShell)**
```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\my-skills\.logs" | Out-Null
$ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$cwd = (Get-Location).Path.Replace('\', '\\')
Add-Content -Path "$env:USERPROFILE\my-skills\.logs\skill-usage.jsonl" -Value "{{`"ts`":`"$ts`",`"skill`":`"<skill-name>`",`"cwd`":`"$cwd`",`"tool`":`"{tool_id}`"}}" -Encoding UTF8
```
{end}
"#,
        start = super::TRACKER_BLOCK_START,
        tool_id = tool_id,
        end = super::TRACKER_BLOCK_END
    )
}

fn build_rule_block(tool_id: &str, rules_path: &Path, existing: &str) -> String {
    let block = tracking_rule_block(tool_id);
    let is_cursor = tool_id == "cursor"
        || rules_path
            .extension()
            .map(|ext| ext.to_string_lossy().eq_ignore_ascii_case("mdc"))
            .unwrap_or(false);
    if !is_cursor {
        return block;
    }

    if existing.trim_start().starts_with("---\n") {
        return block;
    }

    format!(
        "---\ndescription: MySkills Manager global routing and tracking rules\nglobs:\nalwaysApply: true\n---\n\n{}",
        block
    )
}

fn upsert_marker_block(existing: &str, block: &str) -> String {
    let block = block.trim_end_matches('\n');
    if let Some(start) = existing.find(super::TRACKER_BLOCK_START) {
        if let Some(end_offset) = existing[start..].find(super::TRACKER_BLOCK_END) {
            let end = start + end_offset + super::TRACKER_BLOCK_END.len();
            let prefix = existing[..start].trim_end_matches('\n');
            let suffix = existing[end..].trim_start_matches('\n');
            let mut out = String::new();
            if !prefix.is_empty() {
                out.push_str(prefix);
                out.push_str("\n\n");
            }
            out.push_str(block);
            if !suffix.is_empty() {
                out.push_str("\n\n");
                out.push_str(suffix);
            }
            out.push('\n');
            return out;
        }
    }

    if existing.trim().is_empty() {
        return format!("{block}\n");
    }
    format!("{}\n\n{block}\n", existing.trim_end_matches('\n'))
}

pub(super) fn ensure_rules_injected(tool_id: &str, rules_path: &Path) -> Result<(), String> {
    if let Some(parent) = rules_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Create rules dir failed: {e}"))?;
    }
    super::sync_ops::backup_if_exists(rules_path)?;

    let existing = if rules_path.exists() {
        fs::read_to_string(rules_path).map_err(|e| format!("Read rules file failed: {e}"))?
    } else {
        String::new()
    };

    let block = build_rule_block(tool_id, rules_path, &existing);
    let next = upsert_marker_block(&existing, &block);
    fs::write(rules_path, next).map_err(|e| format!("Write rules file failed: {e}"))
}

fn remove_marker_block(existing: &str) -> String {
    if let Some(start) = existing.find(super::TRACKER_BLOCK_START) {
        if let Some(end_offset) = existing[start..].find(super::TRACKER_BLOCK_END) {
            let end = start + end_offset + super::TRACKER_BLOCK_END.len();
            let prefix = existing[..start].trim_end_matches('\n');
            let suffix = existing[end..].trim_start_matches('\n');
            let mut out = String::new();
            if !prefix.is_empty() {
                out.push_str(prefix);
            }
            if !prefix.is_empty() && !suffix.is_empty() {
                out.push_str("\n\n");
            }
            if !suffix.is_empty() {
                out.push_str(suffix);
            }
            if !out.is_empty() {
                out.push('\n');
            }
            return out;
        }
    }
    existing.to_string()
}

pub(super) fn ensure_rules_removed(rules_path: &Path) -> Result<(), String> {
    if !rules_path.exists() {
        return Ok(());
    }
    super::sync_ops::backup_if_exists(rules_path)?;
    let existing =
        fs::read_to_string(rules_path).map_err(|e| format!("Read rules file failed: {e}"))?;
    let next = remove_marker_block(&existing);
    if next == existing {
        return Ok(());
    }
    fs::write(rules_path, next).map_err(|e| format!("Write rules file failed: {e}"))
}

pub(super) fn apply_instruction_gate(
    tool_id: &str,
    rules_path: &Path,
    tracking_enabled: bool,
) -> Result<String, String> {
    if tracking_enabled {
        ensure_rules_injected(tool_id, rules_path)?;
        return Ok(format!(
            "rules injected into {}",
            rules_path.to_string_lossy()
        ));
    }

    ensure_rules_removed(rules_path)?;
    Ok(format!(
        "rules removed from {}",
        rules_path.to_string_lossy()
    ))
}

pub(super) fn ensure_claude_hook(home: &Path) -> Result<(), String> {
    let hook_path = home.join(super::CLAUDE_HOOK_REL_PATH);
    if let Some(parent) = hook_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Create claude hooks dir failed: {e}"))?;
    }
    super::sync_ops::backup_if_exists(&hook_path)?;

    fs::write(&hook_path, claude_hook_script())
        .map_err(|e| format!("Write claude hook failed: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&hook_path, fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Set claude hook permissions failed: {e}"))?;
    }

    let settings_path = home.join(".claude").join("settings.json");
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Create claude settings dir failed: {e}"))?;
    }
    super::sync_ops::backup_if_exists(&settings_path)?;
    let mut settings = if settings_path.exists() {
        fs::read_to_string(&settings_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<JsonValue>(&raw).ok())
            .unwrap_or_else(|| json!({}))
    } else {
        json!({})
    };
    if !settings.is_object() {
        settings = json!({});
    }

    let root = settings.as_object_mut().expect("settings object");
    if !root
        .get("hooks")
        .map(|item| item.is_object())
        .unwrap_or(false)
    {
        root.insert("hooks".to_string(), json!({}));
    }
    let hooks = root
        .get_mut("hooks")
        .and_then(JsonValue::as_object_mut)
        .ok_or_else(|| "Invalid claude hooks config".to_string())?;
    if !hooks
        .get("PostToolUse")
        .map(|item| item.is_array())
        .unwrap_or(false)
    {
        hooks.insert("PostToolUse".to_string(), json!([]));
    }
    let post_tool_use = hooks
        .get_mut("PostToolUse")
        .and_then(JsonValue::as_array_mut)
        .ok_or_else(|| "Invalid claude PostToolUse config".to_string())?;

    post_tool_use.retain(|entry| !contains_any_skill_tracker_entry(&entry.to_string()));
    post_tool_use.push(json!({
      "matcher": "Read",
      "hooks": [
        {
          "type": "command",
          "command": claude_hook_command(home)
        }
      ]
    }));

    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Serialize settings failed: {e}"))?;
    fs::write(settings_path, format!("{content}\n"))
        .map_err(|e| format!("Write claude settings failed: {e}"))
}

pub(super) fn ensure_claude_hook_removed(home: &Path) -> Result<(), String> {
    let hook_path = home.join(super::CLAUDE_HOOK_REL_PATH);
    super::sync_ops::backup_if_exists(&hook_path)?;
    if hook_path.exists() {
        super::sync_ops::remove_if_exists(&hook_path)?;
    }

    let settings_path = home.join(".claude").join("settings.json");
    if !settings_path.exists() {
        return Ok(());
    }
    super::sync_ops::backup_if_exists(&settings_path)?;
    let raw =
        fs::read_to_string(&settings_path).map_err(|e| format!("Read claude settings failed: {e}"))?;
    let mut settings = serde_json::from_str::<JsonValue>(&raw)
        .map_err(|e| format!("Parse claude settings failed: {e}"))?;

    let Some(root) = settings.as_object_mut() else {
        return Ok(());
    };
    let Some(hooks) = root.get_mut("hooks").and_then(JsonValue::as_object_mut) else {
        return Ok(());
    };
    let Some(post_tool_use) = hooks
        .get_mut("PostToolUse")
        .and_then(JsonValue::as_array_mut)
    else {
        return Ok(());
    };

    let before = post_tool_use.len();
    post_tool_use.retain(|entry| !contains_any_skill_tracker_entry(&entry.to_string()));
    if post_tool_use.len() == before {
        return Ok(());
    }

    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Serialize settings failed: {e}"))?;
    fs::write(settings_path, format!("{content}\n"))
        .map_err(|e| format!("Write claude settings failed: {e}"))
}

pub(super) fn apply_hook_configuration(
    home: &Path,
    tool_id: &str,
    tracking_enabled: bool,
) -> Result<Option<String>, String> {
    match tool_id {
        "claude-code" => {
            if tracking_enabled {
                ensure_claude_hook(home)?;
                Ok(Some("claude hook configured".to_string()))
            } else {
                ensure_claude_hook_removed(home)?;
                Ok(Some("claude hook removed".to_string()))
            }
        }
        _ => Ok(None),
    }
}

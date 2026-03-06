use chrono::{DateTime, Utc};
use std::path::{Path, PathBuf};

const ROUTER_SKILL_NAME: &str = "myskills-router";

fn router_skill_file(tool: &super::tool_catalog::ToolDescriptor) -> PathBuf {
    tool.skills_dir.join(ROUTER_SKILL_NAME).join("SKILL.md")
}

fn detect_gate_present(tool: &super::tool_catalog::ToolDescriptor) -> bool {
    if !tool.capabilities.instruction_chain_supported {
        return true;
    }

    tool.rules_path
        .as_ref()
        .map(|path| super::status_probe::file_contains_marker(path))
        .unwrap_or(false)
}

fn detect_startup_bootstrap_present(
    home: &Path,
    tool: &super::tool_catalog::ToolDescriptor,
) -> Option<bool> {
    let supported =
        tool.capabilities.startup_injection_supported || tool.capabilities.hook_config_supported;
    if !supported {
        return None;
    }

    let present = match tool.id.as_str() {
        "antigravity" => super::paths::antigravity_root_dir(home, &tool.skills_dir)
            .join("global_workflows")
            .join(format!("{ROUTER_SKILL_NAME}.md"))
            .exists(),
        "claude-code" => super::status_probe::detect_claude_hook(home),
        _ => false,
    };
    Some(present)
}

fn parse_rfc3339_utc(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn detect_last_router_usage(home: &Path, tool_id: &str) -> Option<String> {
    let root = crate::root_dir::default_skills_root(home);
    let mut latest = None::<(DateTime<Utc>, String)>;
    let mut latest_fallback = None::<String>;

    let _ = crate::logs::for_each_log(&root, |log| {
        if log.skill != ROUTER_SKILL_NAME || log.tool != tool_id {
            return;
        }

        if let Some(ts) = parse_rfc3339_utc(&log.ts) {
            if latest
                .as_ref()
                .map(|(current, _)| current >= &ts)
                .unwrap_or(false)
            {
                return;
            }
            latest = Some((ts, log.ts));
            return;
        }

        if latest_fallback
            .as_ref()
            .map(|current| current >= &log.ts)
            .unwrap_or(false)
        {
            return;
        }
        latest_fallback = Some(log.ts);
    });

    latest.map(|(_, raw)| raw).or(latest_fallback)
}

fn classify_health(
    tool: &super::tool_catalog::ToolDescriptor,
    discoverable: bool,
    gate_present: bool,
    startup_injection_present: Option<bool>,
) -> (String, String) {
    if !discoverable {
        return (
            "broken".to_string(),
            format!(
                "myskills-router not discoverable in active skills path: {}",
                tool.skills_dir.to_string_lossy()
            ),
        );
    }

    if tool.capabilities.instruction_chain_supported && !gate_present {
        return (
            "degraded".to_string(),
            format!(
                "instruction gate missing in rules file: {}",
                tool.rules_path
                    .as_ref()
                    .map(|path| path.to_string_lossy().to_string())
                    .unwrap_or_else(|| "(unset)".to_string())
            ),
        );
    }

    let bootstrap_supported =
        tool.capabilities.startup_injection_supported || tool.capabilities.hook_config_supported;
    if bootstrap_supported && startup_injection_present == Some(false) {
        return (
            "degraded".to_string(),
            "startup bootstrap is missing for this tool; re-apply setup to recover".to_string(),
        );
    }

    (
        "healthy".to_string(),
        "router discoverable and required checks passed".to_string(),
    )
}

pub(super) fn setup_router_health_with_home(
    home: &Path,
) -> Result<Vec<super::ToolRouterHealthStatus>, String> {
    let mut tools = super::all_tools(home)?;
    tools.sort_by(|a, b| a.id.cmp(&b.id));

    let mut out = Vec::<super::ToolRouterHealthStatus>::new();
    for tool in tools {
        let discoverable = router_skill_file(&tool).exists();
        let gate_present = detect_gate_present(&tool);
        let startup_injection_present = detect_startup_bootstrap_present(home, &tool);
        let last_usage_seen = detect_last_router_usage(home, &tool.id);
        let (health, reason) =
            classify_health(&tool, discoverable, gate_present, startup_injection_present);

        out.push(super::ToolRouterHealthStatus {
            tool_id: tool.id,
            tool_name: tool.name,
            discoverable,
            gate_present,
            startup_injection_present,
            last_usage_seen,
            health,
            reason,
        });
    }

    Ok(out)
}

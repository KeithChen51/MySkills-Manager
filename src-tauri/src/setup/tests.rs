use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use super::rule_hook_ops::{ensure_claude_hook, ensure_rules_injected};
use super::*;

static COUNTER: AtomicUsize = AtomicUsize::new(0);

fn temp_home() -> PathBuf {
    let mut root = std::env::temp_dir();
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock")
        .as_nanos();
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    root.push(format!("myskills-tauri-setup-test-{ts}-{n}"));
    root
}

fn find_tool<'a>(list: &'a [ToolStatus], id: &str) -> &'a ToolStatus {
    list.iter()
        .find(|item| item.id == id)
        .expect("find tool status")
}

fn find_path_audit<'a>(list: &'a [BuiltInToolPathAudit], id: &str) -> &'a BuiltInToolPathAudit {
    list.iter()
        .find(|item| item.id == id)
        .expect("find path audit")
}

fn find_router_health<'a>(
    list: &'a [ToolRouterHealthStatus],
    id: &str,
) -> &'a ToolRouterHealthStatus {
    list.iter()
        .find(|item| item.tool_id == id)
        .expect("find tool router health")
}

fn marker_count(raw: &str) -> usize {
    raw.matches(super::TRACKER_BLOCK_START).count()
}

#[test]
fn custom_tool_registry_adds_and_removes_tool() {
    let home = temp_home();
    let custom = CustomTool {
        name: "Aider".to_string(),
        id: "aider".to_string(),
        skills_dir: home
            .join(".aider")
            .join("skills")
            .to_string_lossy()
            .to_string(),
        rules_file: Some(
            home.join(".aider")
                .join("AGENTS.md")
                .to_string_lossy()
                .to_string(),
        ),
        icon: None,
    };

    let add_result = add_custom_tool_with_home(&home, custom).expect("add custom tool");
    assert!(add_result.success);

    let list = get_custom_tools_with_home(&home).expect("get custom tools");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, "aider");

    let remove_result = remove_custom_tool_with_home(&home, "aider").expect("remove custom");
    assert!(remove_result.success);

    let after_remove = get_custom_tools_with_home(&home).expect("get custom tools");
    assert!(after_remove.is_empty());
}

#[test]
fn setup_status_reads_codex_configuration_and_copy_sync_mode() {
    let home = temp_home();
    let codex_skills = home.join(".codex").join("skills");
    fs::create_dir_all(&codex_skills).expect("create codex skills");
    fs::create_dir_all(codex_skills.join("skill-a")).expect("create skill-a dir");
    fs::write(
        codex_skills.join("skill-a").join("SKILL.md"),
        "---\nname: skill-a\n---\n",
    )
    .expect("write skill-a");
    fs::create_dir_all(codex_skills.join("skill-b")).expect("create skill-b dir");
    fs::write(
        codex_skills.join("skill-b").join("SKILL.md"),
        "---\nname: skill-b\n---\n",
    )
    .expect("write skill-b");
    fs::create_dir_all(codex_skills.join(".system")).expect("create non-skill dir");

    let codex_rules = home.join(".codex").join("AGENTS.md");
    fs::write(
        &codex_rules,
        "<!-- [MySkills Manager] Skill 使用追踪规则 -->\n",
    )
    .expect("write rules file");

    let list = setup_status_with_home(&home).expect("setup status");
    let codex = find_tool(&list, "codex");
    assert!(codex.exists);
    assert!(codex.configured);
    assert_eq!(codex.synced_skills, 2);
    assert_eq!(codex.sync_mode, "copy");
    assert!(!codex.hook_configured);
    assert_eq!(codex.integration_mode, "native");
    assert!(codex.capabilities.native_skill_discovery);
    assert!(codex.capabilities.instruction_chain_supported);
    assert!(!codex.capabilities.startup_injection_supported);
    assert!(!codex.capabilities.hook_config_supported);
    assert!(!codex.is_custom);
}

#[test]
fn setup_status_exposes_capability_model_for_builtin_and_custom_tools() {
    let home = temp_home();
    let codex_skills = home.join(".codex").join("skills");
    fs::create_dir_all(codex_skills.join("code-review")).expect("create codex skill dir");
    fs::write(
        codex_skills.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\n",
    )
    .expect("write codex skill");

    add_custom_tool_with_home(
        &home,
        CustomTool {
            name: "Aider".to_string(),
            id: "aider".to_string(),
            skills_dir: home
                .join(".aider")
                .join("skills")
                .to_string_lossy()
                .to_string(),
            rules_file: None,
            icon: None,
        },
    )
    .expect("add custom tool");

    let list = setup_status_with_home(&home).expect("setup status");
    let codex = find_tool(&list, "codex");
    let aider = find_tool(&list, "aider");

    assert_eq!(codex.integration_mode, "native");
    assert!(codex.capabilities.native_skill_discovery);
    assert!(codex.capabilities.instruction_chain_supported);
    assert!(!codex.capabilities.startup_injection_supported);
    assert!(!codex.capabilities.hook_config_supported);

    assert_eq!(aider.integration_mode, "fallback");
    assert!(aider.capabilities.native_skill_discovery);
    assert!(!aider.capabilities.instruction_chain_supported);
    assert!(!aider.capabilities.startup_injection_supported);
    assert!(!aider.capabilities.hook_config_supported);
}

#[test]
fn setup_status_exposes_last_sync_time_for_copy_mode() {
    let home = temp_home();
    let codex_skills = home.join(".codex").join("skills");
    fs::create_dir_all(codex_skills.join("code-review")).expect("create codex skill dir");
    fs::write(
        codex_skills.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\n",
    )
    .expect("write codex skill");

    let list = setup_status_with_home(&home).expect("setup status");
    let codex = find_tool(&list, "codex");
    assert_eq!(codex.sync_mode, "copy");
    assert!(codex.last_sync_time.is_some());
}

#[test]
fn setup_status_prefers_codex_agents_skills_when_available() {
    let home = temp_home();
    let agents_skills = home.join(".agents").join("skills");
    let codex_skills = home.join(".codex").join("skills");

    fs::create_dir_all(agents_skills.join("router-skill")).expect("create agents skill dir");
    fs::write(
        agents_skills.join("router-skill").join("SKILL.md"),
        "---\nname: router-skill\n---\n",
    )
    .expect("write agents skill");

    fs::create_dir_all(codex_skills.join("legacy-skill")).expect("create codex skill dir");
    fs::write(
        codex_skills.join("legacy-skill").join("SKILL.md"),
        "---\nname: legacy-skill\n---\n",
    )
    .expect("write codex skill");

    let list = setup_status_with_home(&home).expect("setup status");
    let codex = find_tool(&list, "codex");
    assert_eq!(
        codex.skills_dir,
        agents_skills.to_string_lossy().to_string()
    );
    assert_eq!(codex.path_source, "auto-detected");
}

#[test]
fn setup_status_falls_back_to_legacy_codex_skills_when_agents_missing() {
    let home = temp_home();
    let codex_skills = home.join(".codex").join("skills");

    fs::create_dir_all(codex_skills.join("legacy-skill")).expect("create codex skill dir");
    fs::write(
        codex_skills.join("legacy-skill").join("SKILL.md"),
        "---\nname: legacy-skill\n---\n",
    )
    .expect("write codex skill");

    let list = setup_status_with_home(&home).expect("setup status");
    let codex = find_tool(&list, "codex");
    assert_eq!(codex.skills_dir, codex_skills.to_string_lossy().to_string());
    assert_eq!(codex.path_source, "default");
}

#[test]
fn setup_status_autodetects_opencode_legacy_path() {
    let home = temp_home();
    let legacy_skills = home.join(".opencode").join("skills");
    fs::create_dir_all(legacy_skills.join("workflow")).expect("create legacy skill dir");
    fs::write(
        legacy_skills.join("workflow").join("SKILL.md"),
        "---\nname: workflow\n---\n",
    )
    .expect("write legacy skill");

    let list = setup_status_with_home(&home).expect("setup status");
    let opencode = find_tool(&list, "opencode");

    assert!(opencode.exists);
    assert_eq!(opencode.skills_dir, legacy_skills.to_string_lossy());
    assert_eq!(opencode.path_source, "auto-detected");
}

#[test]
fn setup_status_prefers_antigravity_skills_path_when_available() {
    let home = temp_home();
    let antigravity_skills = home.join(".gemini").join("antigravity").join("skills");
    let instructions_skills = home.join(".gemini").join("instructions");

    fs::create_dir_all(antigravity_skills.join("workflow")).expect("create antigravity skill dir");
    fs::write(
        antigravity_skills.join("workflow").join("SKILL.md"),
        "---\nname: workflow\n---\n",
    )
    .expect("write antigravity skill");

    fs::create_dir_all(instructions_skills.join("legacy")).expect("create legacy instruction dir");
    fs::write(
        instructions_skills.join("legacy").join("SKILL.md"),
        "---\nname: legacy\n---\n",
    )
    .expect("write legacy instruction skill");

    let list = setup_status_with_home(&home).expect("setup status");
    let antigravity = find_tool(&list, "antigravity");

    assert!(antigravity.exists);
    assert_eq!(
        antigravity.skills_dir,
        antigravity_skills.to_string_lossy().to_string()
    );
    assert_eq!(antigravity.path_source, "default");
}

#[test]
fn setup_status_autodetects_antigravity_instructions_fallback() {
    let home = temp_home();
    let instructions_skills = home.join(".gemini").join("instructions");

    fs::create_dir_all(instructions_skills.join("legacy")).expect("create legacy instruction dir");
    fs::write(
        instructions_skills.join("legacy").join("SKILL.md"),
        "---\nname: legacy\n---\n",
    )
    .expect("write legacy instruction skill");

    let list = setup_status_with_home(&home).expect("setup status");
    let antigravity = find_tool(&list, "antigravity");

    assert!(antigravity.exists);
    assert_eq!(
        antigravity.skills_dir,
        instructions_skills.to_string_lossy().to_string()
    );
    assert_eq!(antigravity.path_source, "auto-detected");
}

#[test]
fn setup_status_prefers_cursor_skills_path_when_both_rules_and_skills_exist() {
    let home = temp_home();
    let cursor_rules = home.join(".cursor").join("rules");
    let cursor_skills = home.join(".cursor").join("skills");

    fs::create_dir_all(cursor_rules.join("legacy-rule-as-skill"))
        .expect("create cursor rules legacy dir");
    fs::write(
        cursor_rules.join("legacy-rule-as-skill").join("SKILL.md"),
        "---\nname: legacy-rule-as-skill\n---\n",
    )
    .expect("write legacy skill under rules");

    fs::create_dir_all(cursor_skills.join("actual-skill")).expect("create cursor skills dir");
    fs::write(
        cursor_skills.join("actual-skill").join("SKILL.md"),
        "---\nname: actual-skill\n---\n",
    )
    .expect("write actual skill under skills");

    let list = setup_status_with_home(&home).expect("setup status");
    let cursor = find_tool(&list, "cursor");

    assert!(cursor.exists);
    assert_eq!(
        cursor.skills_dir,
        cursor_skills.to_string_lossy().to_string()
    );
    assert_eq!(cursor.path_source, "default");
}

#[test]
fn setup_status_marks_builtin_override_path_source() {
    let home = temp_home();
    let custom_codex_skills = home.join("custom").join("codex-skills");
    let custom_codex_skills_str = custom_codex_skills.to_string_lossy().to_string();
    update_tool_paths_with_home(&home, "codex", &custom_codex_skills_str, None)
        .expect("set codex override");

    let list = setup_status_with_home(&home).expect("setup status");
    let codex = find_tool(&list, "codex");

    assert_eq!(codex.skills_dir, custom_codex_skills.to_string_lossy());
    assert_eq!(codex.path_source, "override");
}

#[test]
fn setup_status_exposes_path_diagnostics() {
    let home = temp_home();
    let skills_dir = home.join("verified").join("codex-skills");
    let rules_dir = home.join("verified");
    let rules_file = rules_dir.join("CODERULES.md");
    fs::create_dir_all(&skills_dir).expect("create skills dir");
    fs::create_dir_all(&rules_dir).expect("create rules dir");

    let skills_dir_str = skills_dir.to_string_lossy().to_string();
    let rules_file_str = rules_file.to_string_lossy().to_string();
    update_tool_paths_with_home(&home, "codex", &skills_dir_str, Some(&rules_file_str))
        .expect("update tool paths");

    let list = setup_status_with_home(&home).expect("setup status");
    let codex = find_tool(&list, "codex");

    assert!(codex.skills_dir_exists);
    assert!(codex.skills_dir_writable);
    assert!(!codex.rules_path_exists);
    assert!(codex.rules_path_writable);
}

#[test]
fn setup_path_validation_matrix_reports_candidates_and_review_flags() {
    let home = temp_home();
    fs::create_dir_all(home.join(".opencode").join("skills")).expect("create opencode legacy path");

    let matrix = setup_path_validation_matrix_with_home(&home).expect("path validation matrix");
    let opencode = find_path_audit(&matrix, "opencode");
    let codex = find_path_audit(&matrix, "codex");

    assert_eq!(opencode.path_source, "auto-detected");
    assert!(opencode.selected_candidate_exists);
    assert!(!opencode.needs_manual_review);
    assert!(opencode
        .candidates
        .iter()
        .any(|candidate| candidate.skills_dir.contains(".config")));
    assert!(opencode
        .candidates
        .iter()
        .any(|candidate| candidate.skills_dir.contains(".opencode")));
    assert!(opencode
        .candidates
        .iter()
        .any(|candidate| candidate.selected));

    assert_eq!(codex.path_source, "default");
    assert!(!codex.selected_candidate_exists);
    assert!(codex.needs_manual_review);
    assert!(codex
        .candidates
        .iter()
        .any(|candidate| candidate.skills_dir.contains(".agents")));
}

#[test]
fn setup_status_detects_claude_hook() {
    let home = temp_home();
    fs::create_dir_all(home.join(".claude")).expect("create claude dir");
    fs::write(
  home.join(".claude").join("settings.json"),
  r#"{"hooks":{"PostToolUse":[{"hooks":[{"command":"bash ~/.claude/hooks/skill-tracker.sh"}]}]}}"#,
)
.expect("write settings");

    let list = setup_status_with_home(&home).expect("setup status");
    let claude = find_tool(&list, "claude-code");
    assert!(claude.hook_configured);
    assert!(claude.capabilities.hook_config_supported);
    assert_eq!(claude.integration_mode, "native");
}

#[test]
fn setup_router_health_reports_broken_when_router_not_discoverable() {
    let home = temp_home();
    fs::create_dir_all(home.join(".codex").join("skills").join("code-review"))
        .expect("create codex skill dir");
    fs::write(
        home.join(".codex")
            .join("skills")
            .join("code-review")
            .join("SKILL.md"),
        "---\nname: code-review\n---\n",
    )
    .expect("write codex skill");

    let health = setup_router_health_with_home(&home).expect("router health");
    let codex = find_router_health(&health, "codex");

    assert_eq!(codex.health, "broken");
    assert!(!codex.discoverable);
    assert!(codex.reason.contains("not discoverable"));
}

#[test]
fn setup_router_health_reports_healthy_and_last_usage_when_ready() {
    let home = temp_home();
    let codex_skills = home.join(".codex").join("skills");
    fs::create_dir_all(codex_skills.join("myskills-router")).expect("create router dir");
    fs::write(
        codex_skills.join("myskills-router").join("SKILL.md"),
        "---\nname: myskills-router\n---\n",
    )
    .expect("write router skill");

    let codex_rules = home.join(".codex").join("AGENTS.md");
    ensure_rules_injected("codex", &codex_rules).expect("inject codex rules");

    let logs_dir = home.join("my-skills").join(".logs");
    fs::create_dir_all(&logs_dir).expect("create logs dir");
    fs::write(
        logs_dir.join("skill-usage.jsonl"),
        r#"{"ts":"2026-03-05T01:00:00Z","skill":"myskills-router","cwd":"/tmp/a","tool":"codex"}"#,
    )
    .expect("write router usage logs");

    let health = setup_router_health_with_home(&home).expect("router health");
    let codex = find_router_health(&health, "codex");

    assert_eq!(codex.health, "healthy");
    assert!(codex.discoverable);
    assert!(codex.gate_present);
    assert_eq!(
        codex.last_usage_seen.as_deref(),
        Some("2026-03-05T01:00:00Z")
    );
}

#[test]
fn setup_router_health_reports_degraded_when_startup_bootstrap_missing() {
    let home = temp_home();
    let claude_skills = home.join(".claude").join("skills");
    fs::create_dir_all(claude_skills.join("myskills-router")).expect("create router dir");
    fs::write(
        claude_skills.join("myskills-router").join("SKILL.md"),
        "---\nname: myskills-router\n---\n",
    )
    .expect("write router skill");

    let claude_rules = home.join(".claude").join("CLAUDE.md");
    ensure_rules_injected("claude-code", &claude_rules).expect("inject claude rules");

    let health = setup_router_health_with_home(&home).expect("router health");
    let claude = find_router_health(&health, "claude-code");

    assert_eq!(claude.health, "degraded");
    assert!(claude.discoverable);
    assert!(claude.gate_present);
    assert_eq!(claude.startup_injection_present, Some(false));
    assert!(claude.reason.contains("startup bootstrap"));
}

#[test]
fn capability_contract_native_only_tool_keeps_path_selection_router_and_gate_idempotent() {
    let home = temp_home();
    let skills_root = temp_home();
    let codex_agents_skills = home.join(".agents").join("skills");
    fs::create_dir_all(&codex_agents_skills).expect("create .agents skills");

    fs::create_dir_all(skills_root.join("myskills-router")).expect("create router skill dir");
    fs::write(
        skills_root.join("myskills-router").join("SKILL.md"),
        "---\nname: myskills-router\n---\n",
    )
    .expect("write router skill");
    fs::create_dir_all(skills_root.join("code-review")).expect("create code-review skill dir");
    fs::write(
        skills_root.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\n",
    )
    .expect("write code-review skill");

    let first = apply_setup_with_paths(&home, &skills_root, &["codex".to_string()], None)
        .expect("first apply");
    let second = apply_setup_with_paths(&home, &skills_root, &["codex".to_string()], None)
        .expect("second apply");
    assert!(first[0].success);
    assert!(second[0].success);

    let status = setup_status_with_home(&home).expect("setup status");
    let codex = find_tool(&status, "codex");
    assert_eq!(
        codex.skills_dir,
        codex_agents_skills.to_string_lossy().to_string()
    );
    assert!(home
        .join(".agents")
        .join("skills")
        .join("myskills-router")
        .join("SKILL.md")
        .exists());

    let codex_rules =
        fs::read_to_string(home.join(".codex").join("AGENTS.md")).expect("read codex rules");
    assert_eq!(marker_count(&codex_rules), 1);

    let health = setup_router_health_with_home(&home).expect("router health");
    let codex_health = find_router_health(&health, "codex");
    assert_eq!(codex_health.health, "healthy");
    assert!(codex_health.discoverable);
    assert!(codex_health.gate_present);
}

#[test]
fn capability_contract_native_hook_tool_covers_router_gate_and_hook_bootstrap() {
    let home = temp_home();
    let skills_root = temp_home();
    fs::create_dir_all(skills_root.join("myskills-router")).expect("create router skill dir");
    fs::write(
        skills_root.join("myskills-router").join("SKILL.md"),
        "---\nname: myskills-router\n---\n",
    )
    .expect("write router skill");

    let result = apply_setup_with_paths(&home, &skills_root, &["claude-code".to_string()], None)
        .expect("apply setup");
    assert!(result[0].success);
    assert!(home.join(super::CLAUDE_HOOK_REL_PATH).exists());

    let settings_raw = fs::read_to_string(home.join(".claude").join("settings.json"))
        .expect("read claude settings");
    assert_eq!(settings_raw.matches("skill-tracker").count(), 1);

    let health = setup_router_health_with_home(&home).expect("router health");
    let claude = find_router_health(&health, "claude-code");
    assert_eq!(claude.health, "healthy");
    assert!(claude.discoverable);
    assert!(claude.gate_present);
    assert_eq!(claude.startup_injection_present, Some(true));
}

#[test]
fn capability_contract_fallback_tool_still_syncs_router_without_gate_dependencies() {
    let home = temp_home();
    let skills_root = temp_home();
    fs::create_dir_all(skills_root.join("myskills-router")).expect("create router skill dir");
    fs::write(
        skills_root.join("myskills-router").join("SKILL.md"),
        "---\nname: myskills-router\n---\n",
    )
    .expect("write router skill");
    fs::create_dir_all(skills_root.join("code-review")).expect("create code-review skill dir");
    fs::write(
        skills_root.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\n",
    )
    .expect("write code-review skill");

    add_custom_tool_with_home(
        &home,
        CustomTool {
            name: "Aider".to_string(),
            id: "aider".to_string(),
            skills_dir: home
                .join(".aider")
                .join("skills")
                .to_string_lossy()
                .to_string(),
            rules_file: None,
            icon: None,
        },
    )
    .expect("add custom tool");

    let result = apply_setup_with_paths(&home, &skills_root, &["aider".to_string()], None)
        .expect("apply setup");
    assert!(result[0].success);
    assert!(home
        .join(".aider")
        .join("skills")
        .join("myskills-router")
        .join("SKILL.md")
        .exists());

    let status = setup_status_with_home(&home).expect("setup status");
    let aider = find_tool(&status, "aider");
    assert_eq!(aider.integration_mode, "fallback");
    assert!(!aider.capabilities.instruction_chain_supported);

    let health = setup_router_health_with_home(&home).expect("router health");
    let aider_health = find_router_health(&health, "aider");
    assert_eq!(aider_health.health, "healthy");
    assert!(aider_health.discoverable);
}

#[test]
fn setup_apply_syncs_skills_to_codex() {
    let home = temp_home();
    let skills_root = temp_home();

    fs::create_dir_all(home.join(".codex")).expect("create codex parent");
    fs::create_dir_all(skills_root.join("code-review")).expect("create skill dir");
    fs::write(
        skills_root.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\n",
    )
    .expect("write skill");
    fs::create_dir_all(skills_root.join("debug-helper")).expect("create skill dir");
    fs::write(
        skills_root.join("debug-helper").join("SKILL.md"),
        "---\nname: debug-helper\n---\n",
    )
    .expect("write skill");

    let result = apply_setup_with_paths(&home, &skills_root, &["codex".to_string()], None)
        .expect("apply setup");
    assert_eq!(result.len(), 1);
    assert!(result[0].success);
    assert_eq!(result[0].synced_count, 3);
    assert!(result[0].sync_mode == "symlink" || result[0].sync_mode == "copy");

    assert!(home
        .join(".codex")
        .join("skills")
        .join("code-review")
        .join("SKILL.md")
        .exists());
    assert!(home
        .join(".codex")
        .join("skills")
        .join("debug-helper")
        .join("SKILL.md")
        .exists());
    assert!(home
        .join(".codex")
        .join("skills")
        .join("myskills-router")
        .join("SKILL.md")
        .exists());
}

#[test]
fn setup_apply_honors_copy_sync_mode_from_config() {
    let home = temp_home();
    let skills_root = temp_home();
    fs::create_dir_all(home.join(".codex")).expect("create codex parent");
    fs::create_dir_all(home.join(".myskills-manager")).expect("create app config dir");
    fs::create_dir_all(skills_root.join("code-review")).expect("create skill dir");
    fs::write(
        skills_root.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\n",
    )
    .expect("write skill");

    let sync_config = serde_json::json!({
      "syncMode": "copy",
      "skills": [],
      "autoTools": [],
      "trackingDisabledTools": []
    });
    fs::write(
        home.join(".myskills-manager").join("sync-config.json"),
        serde_json::to_string(&sync_config).expect("serialize sync config"),
    )
    .expect("write sync config");

    let result = apply_setup_with_paths(&home, &skills_root, &["codex".to_string()], None)
        .expect("apply setup");
    assert!(result[0].success);
    assert_eq!(result[0].sync_mode, "copy");
}

#[test]
fn setup_apply_reports_symlink_fallback_when_symlink_mode_cannot_be_used() {
    let home = temp_home();
    let skills_root = temp_home();
    fs::create_dir_all(home.join(".codex")).expect("create codex parent");
    fs::create_dir_all(home.join(".myskills-manager")).expect("create app config dir");
    fs::create_dir_all(skills_root.join("code-review")).expect("create skill dir");
    fs::write(
        skills_root.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\n",
    )
    .expect("write skill");

    let sync_config = serde_json::json!({
      "syncMode": "symlink",
      "skills": [],
      "autoTools": [],
      "trackingDisabledTools": []
    });
    fs::write(
        home.join(".myskills-manager").join("sync-config.json"),
        serde_json::to_string(&sync_config).expect("serialize sync config"),
    )
    .expect("write sync config");

    let result = apply_setup_with_paths(&home, &skills_root, &["codex".to_string()], None)
        .expect("apply setup");
    assert!(result[0].success);
    assert!(result[0].sync_mode == "symlink" || result[0].sync_mode == "copy");
    if result[0].sync_mode == "copy" {
        assert!(result[0].action.contains("symlink fallback to copy"));
    }
}

#[test]
fn setup_apply_syncs_antigravity_workflow_aliases() {
    let home = temp_home();
    let skills_root = temp_home();

    fs::create_dir_all(home.join(".gemini").join("antigravity"))
        .expect("create antigravity parent");
    fs::create_dir_all(skills_root.join("code-review")).expect("create skill dir");
    fs::write(
        skills_root.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\ncode review body\n",
    )
    .expect("write code-review skill");
    fs::create_dir_all(skills_root.join("debug-helper")).expect("create skill dir");
    fs::write(
        skills_root.join("debug-helper").join("SKILL.md"),
        "---\nname: debug-helper\n---\ndebug helper body\n",
    )
    .expect("write debug-helper skill");

    let result = apply_setup_with_paths(&home, &skills_root, &["antigravity".to_string()], None)
        .expect("apply setup");
    assert_eq!(result.len(), 1);
    assert!(result[0].success);
    assert_eq!(result[0].synced_count, 2);

    let alias_dir = home
        .join(".gemini")
        .join("antigravity")
        .join("global_workflows");
    let code_review_alias = alias_dir.join("code-review.md");
    let debug_helper_alias = alias_dir.join("debug-helper.md");

    assert!(code_review_alias.exists());
    assert!(debug_helper_alias.exists());

    let code_review_content =
        fs::read_to_string(code_review_alias).expect("read code-review alias");
    let debug_helper_content =
        fs::read_to_string(debug_helper_alias).expect("read debug-helper alias");
    assert!(code_review_content.contains("code review body"));
    assert!(debug_helper_content.contains("debug helper body"));
}

#[test]
fn setup_apply_updates_only_managed_antigravity_workflow_aliases() {
    let home = temp_home();
    let skills_root = temp_home();
    let alias_dir = home
        .join(".gemini")
        .join("antigravity")
        .join("global_workflows");
    fs::create_dir_all(&alias_dir).expect("create alias dir");

    fs::write(alias_dir.join("manual-workflow.md"), "manual content\n")
        .expect("write manual alias");
    fs::write(alias_dir.join("old-managed.md"), "old managed\n").expect("write old managed alias");
    fs::write(
        alias_dir.join(".myskills-managed-workflows.json"),
        serde_json::to_string(&vec!["old-managed.md"]).expect("serialize manifest"),
    )
    .expect("write manifest");

    fs::create_dir_all(skills_root.join("new-skill")).expect("create skill dir");
    fs::write(
        skills_root.join("new-skill").join("SKILL.md"),
        "---\nname: new-skill\n---\nnew content\n",
    )
    .expect("write new skill");

    let result = apply_setup_with_paths(&home, &skills_root, &["antigravity".to_string()], None)
        .expect("apply setup");
    assert!(result[0].success);

    assert!(alias_dir.join("manual-workflow.md").exists());
    assert!(!alias_dir.join("old-managed.md").exists());
    assert!(alias_dir.join("new-skill.md").exists());
}

#[test]
fn setup_apply_degrades_gracefully_when_claude_hook_stage_fails() {
    let home = temp_home();
    let skills_root = temp_home();

    fs::create_dir_all(skills_root.join("code-review")).expect("create skill dir");
    fs::write(
        skills_root.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\n",
    )
    .expect("write skill");

    let claude_dir = home.join(".claude");
    fs::create_dir_all(&claude_dir).expect("create claude dir");
    fs::create_dir_all(claude_dir.join("settings.json"))
        .expect("create directory where settings file should be");

    let result = apply_setup_with_paths(&home, &skills_root, &["claude-code".to_string()], None)
        .expect("apply setup");
    assert_eq!(result.len(), 1);
    assert!(result[0].success);
    assert!(result[0].action.contains("hook setup skipped"));

    let rules_path = home.join(".claude").join("CLAUDE.md");
    let rules = fs::read_to_string(rules_path).expect("read CLAUDE.md");
    assert!(rules.contains("[MySkills Manager]"));
    assert!(home
        .join(".claude")
        .join("skills")
        .join("code-review")
        .join("SKILL.md")
        .exists());
}

#[test]
fn setup_apply_respects_per_tool_skill_config() {
    let home = temp_home();
    let skills_root = temp_home();
    fs::create_dir_all(home.join(".codex")).expect("create codex parent");
    fs::create_dir_all(home.join(".myskills-manager")).expect("create app config dir");

    fs::create_dir_all(skills_root.join("code-review")).expect("create code-review skill dir");
    fs::write(
        skills_root.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\n",
    )
    .expect("write code-review skill");

    fs::create_dir_all(skills_root.join("debug-helper")).expect("create debug-helper skill dir");
    fs::write(
        skills_root.join("debug-helper").join("SKILL.md"),
        "---\nname: debug-helper\n---\n",
    )
    .expect("write debug-helper skill");

    let sync_config = serde_json::json!({
      "syncMode": "symlink",
      "skills": [
        { "skillName": "code-review", "enabledTools": ["codex"] }
      ]
    });
    fs::write(
        home.join(".myskills-manager").join("sync-config.json"),
        serde_json::to_string(&sync_config).expect("serialize sync config"),
    )
    .expect("write sync config");

    let result = apply_setup_with_paths(&home, &skills_root, &["codex".to_string()], None)
        .expect("apply setup");

    assert!(result[0].success);
    assert_eq!(result[0].synced_count, 2);
    assert!(home
        .join(".codex")
        .join("skills")
        .join("code-review")
        .join("SKILL.md")
        .exists());
    assert!(!home
        .join(".codex")
        .join("skills")
        .join("debug-helper")
        .join("SKILL.md")
        .exists());
    assert!(home
        .join(".codex")
        .join("skills")
        .join("myskills-router")
        .join("SKILL.md")
        .exists());
}

#[test]
fn setup_apply_treats_empty_skill_config_as_unconfigured() {
    let home = temp_home();
    let skills_root = temp_home();
    fs::create_dir_all(home.join(".codex")).expect("create codex parent");
    fs::create_dir_all(home.join(".myskills-manager")).expect("create app config dir");

    fs::create_dir_all(skills_root.join("code-review")).expect("create code-review skill dir");
    fs::write(
        skills_root.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\n",
    )
    .expect("write code-review skill");

    fs::create_dir_all(skills_root.join("debug-helper")).expect("create debug-helper skill dir");
    fs::write(
        skills_root.join("debug-helper").join("SKILL.md"),
        "---\nname: debug-helper\n---\n",
    )
    .expect("write debug-helper skill");

    let sync_config = serde_json::json!({
      "syncMode": "symlink",
      "skills": [],
      "autoTools": [],
      "trackingDisabledTools": []
    });
    fs::write(
        home.join(".myskills-manager").join("sync-config.json"),
        serde_json::to_string(&sync_config).expect("serialize sync config"),
    )
    .expect("write sync config");

    let result = apply_setup_with_paths(&home, &skills_root, &["codex".to_string()], None)
        .expect("apply setup");

    assert!(result[0].success);
    assert_eq!(result[0].synced_count, 3);
    assert!(home
        .join(".codex")
        .join("skills")
        .join("code-review")
        .join("SKILL.md")
        .exists());
    assert!(home
        .join(".codex")
        .join("skills")
        .join("debug-helper")
        .join("SKILL.md")
        .exists());
    assert!(home
        .join(".codex")
        .join("skills")
        .join("myskills-router")
        .join("SKILL.md")
        .exists());
}

#[test]
fn setup_apply_returns_error_for_unknown_tool() {
    let home = temp_home();
    let skills_root = temp_home();

    let result = apply_setup_with_paths(&home, &skills_root, &["unknown".to_string()], None)
        .expect("apply setup");
    assert_eq!(result.len(), 1);
    assert!(!result[0].success);
    assert_eq!(result[0].tool, "unknown");
    assert!(result[0].error.is_some());
}

#[test]
fn setup_status_includes_custom_tools_from_config() {
    let home = temp_home();
    let custom_skills_dir = home.join(".aider").join("skills");
    let custom_rules = home.join(".aider").join("AGENTS.md");
    fs::create_dir_all(custom_skills_dir.parent().expect("custom parent"))
        .expect("create custom parent");
    fs::create_dir_all(&custom_skills_dir).expect("create custom skills");
    fs::create_dir_all(home.join(".myskills-manager")).expect("create app config dir");
    let config = serde_json::json!([{
      "name": "Aider",
      "id": "aider",
      "skillsDir": custom_skills_dir.to_string_lossy().to_string(),
      "rulesFile": custom_rules.to_string_lossy().to_string()
    }]);
    fs::write(
        home.join(".myskills-manager").join("custom-tools.json"),
        serde_json::to_string(&config).expect("serialize config"),
    )
    .expect("write custom tools");

    let list = setup_status_with_home(&home).expect("setup status");
    let aider = find_tool(&list, "aider");
    assert!(aider.is_custom);
    assert_eq!(aider.name, "Aider");
    assert_eq!(aider.skills_dir, custom_skills_dir.to_string_lossy());
    assert_eq!(aider.rules_path, custom_rules.to_string_lossy());
}

#[test]
fn local_skills_overview_detects_duplicates_across_tools() {
    let home = temp_home();

    fs::create_dir_all(home.join(".codex").join("skills").join("shared-skill"))
        .expect("create codex shared skill");
    fs::write(
        home.join(".codex")
            .join("skills")
            .join("shared-skill")
            .join("SKILL.md"),
        "---\nname: shared-skill\n---\n",
    )
    .expect("write codex shared skill");

    fs::create_dir_all(home.join(".codex").join("skills").join("codex-only"))
        .expect("create codex only skill");
    fs::write(
        home.join(".codex")
            .join("skills")
            .join("codex-only")
            .join("SKILL.md"),
        "---\nname: codex-only\n---\n",
    )
    .expect("write codex only skill");

    fs::create_dir_all(home.join(".claude").join("skills").join("shared-skill"))
        .expect("create claude shared skill");
    fs::write(
        home.join(".claude")
            .join("skills")
            .join("shared-skill")
            .join("SKILL.md"),
        "---\nname: shared-skill\n---\n",
    )
    .expect("write claude shared skill");

    let overview = local_skills_overview_with_home(&home).expect("local skills overview");
    assert_eq!(overview.tools.len(), 2);
    assert_eq!(overview.total_skills, 3);
    assert_eq!(overview.unique_skills, 2);
    assert_eq!(overview.duplicate_names, vec!["shared-skill".to_string()]);
    assert_eq!(overview.matched_in_my_skills, 0);
    assert_eq!(overview.missing_in_my_skills, 2);
    assert_eq!(overview.conflict_with_my_skills, 0);

    let codex = overview
        .tools
        .iter()
        .find(|tool| tool.tool_id == "codex")
        .expect("find codex overview");
    let shared = codex
        .skills
        .iter()
        .find(|skill| skill.name == "shared-skill")
        .expect("find shared skill");
    assert!(shared.duplicate_across_tools);
    assert!(!shared.in_my_skills);
    assert!(!shared.hash_matches_my_skills);
    assert!(!shared.hash_conflicts_my_skills);
}

#[test]
fn local_skills_overview_marks_match_conflict_and_missing_vs_my_skills() {
    let home = temp_home();

    fs::create_dir_all(home.join("my-skills").join("shared-skill")).expect("create my shared");
    fs::write(
        home.join("my-skills").join("shared-skill").join("SKILL.md"),
        "---\nname: shared-skill\nversion: 1\n---\n",
    )
    .expect("write my shared");

    fs::create_dir_all(home.join("my-skills").join("aligned-skill")).expect("create my aligned");
    fs::write(
        home.join("my-skills")
            .join("aligned-skill")
            .join("SKILL.md"),
        "---\nname: aligned-skill\nversion: 1\n---\n",
    )
    .expect("write my aligned");

    fs::create_dir_all(home.join(".codex").join("skills").join("shared-skill"))
        .expect("create codex shared");
    fs::write(
        home.join(".codex")
            .join("skills")
            .join("shared-skill")
            .join("SKILL.md"),
        "---\nname: shared-skill\nversion: 1\n---\n",
    )
    .expect("write codex shared");

    fs::create_dir_all(home.join(".codex").join("skills").join("aligned-skill"))
        .expect("create codex aligned");
    fs::write(
        home.join(".codex")
            .join("skills")
            .join("aligned-skill")
            .join("SKILL.md"),
        "---\nname: aligned-skill\nversion: 1\n---\n",
    )
    .expect("write codex aligned");

    fs::create_dir_all(home.join(".codex").join("skills").join("new-skill"))
        .expect("create codex new");
    fs::write(
        home.join(".codex")
            .join("skills")
            .join("new-skill")
            .join("SKILL.md"),
        "---\nname: new-skill\n---\n",
    )
    .expect("write codex new");

    fs::create_dir_all(home.join(".claude").join("skills").join("shared-skill"))
        .expect("create claude shared");
    fs::write(
        home.join(".claude")
            .join("skills")
            .join("shared-skill")
            .join("SKILL.md"),
        "---\nname: shared-skill\nversion: 2\n---\n",
    )
    .expect("write claude shared");

    let overview = local_skills_overview_with_home(&home).expect("local skills overview");
    assert_eq!(overview.duplicate_names, vec!["shared-skill".to_string()]);
    assert_eq!(overview.unique_skills, 3);
    assert_eq!(overview.matched_in_my_skills, 1);
    assert_eq!(overview.missing_in_my_skills, 1);
    assert_eq!(overview.conflict_with_my_skills, 1);

    let codex = overview
        .tools
        .iter()
        .find(|tool| tool.tool_id == "codex")
        .expect("find codex");
    let codex_shared = codex
        .skills
        .iter()
        .find(|skill| skill.name == "shared-skill")
        .expect("find codex shared");
    assert!(codex_shared.in_my_skills);
    assert!(codex_shared.hash_matches_my_skills);
    assert!(!codex_shared.hash_conflicts_my_skills);

    let codex_missing = codex
        .skills
        .iter()
        .find(|skill| skill.name == "new-skill")
        .expect("find codex new");
    assert!(!codex_missing.in_my_skills);
    assert!(!codex_missing.hash_matches_my_skills);
    assert!(!codex_missing.hash_conflicts_my_skills);

    let claude = overview
        .tools
        .iter()
        .find(|tool| tool.tool_id == "claude-code")
        .expect("find claude");
    let claude_shared = claude
        .skills
        .iter()
        .find(|skill| skill.name == "shared-skill")
        .expect("find claude shared");
    assert!(claude_shared.in_my_skills);
    assert!(!claude_shared.hash_matches_my_skills);
    assert!(claude_shared.hash_conflicts_my_skills);
}

#[test]
fn local_skills_overview_includes_codex_superpowers_skills() {
    let home = temp_home();

    fs::create_dir_all(home.join(".codex").join("skills").join("find-skills"))
        .expect("create codex base skill");
    fs::write(
        home.join(".codex")
            .join("skills")
            .join("find-skills")
            .join("SKILL.md"),
        "---\nname: find-skills\n---\n",
    )
    .expect("write codex base skill");

    fs::create_dir_all(
        home.join(".codex")
            .join("superpowers")
            .join("skills")
            .join("systematic-debugging"),
    )
    .expect("create codex superpowers skill");
    fs::write(
        home.join(".codex")
            .join("superpowers")
            .join("skills")
            .join("systematic-debugging")
            .join("SKILL.md"),
        "---\nname: systematic-debugging\n---\n",
    )
    .expect("write codex superpowers skill");

    let overview = local_skills_overview_with_home(&home).expect("local skills overview");
    let codex = overview
        .tools
        .iter()
        .find(|tool| tool.tool_id == "codex")
        .expect("find codex");

    assert!(
        codex.skills.iter().any(|skill| skill.name == "find-skills"),
        "codex overview should include base skills directory"
    );
    assert!(
        codex
            .skills
            .iter()
            .any(|skill| skill.name == "systematic-debugging"),
        "codex overview should include superpowers skills directory"
    );
}

#[test]
fn setup_get_skill_conflict_detail_includes_my_skills_and_tool_variants() {
    let home = temp_home();
    let my_skill_dir = home.join("my-skills").join("ui-ux-pro-max");
    fs::create_dir_all(&my_skill_dir).expect("create my skill dir");
    fs::write(
        my_skill_dir.join("SKILL.md"),
        "---\nname: ui-ux-pro-max\nsource: my-skills\n---\n",
    )
    .expect("write my skill");

    let codex_superpowers_skill = home
        .join(".codex")
        .join("superpowers")
        .join("skills")
        .join("ui-ux-pro-max");
    fs::create_dir_all(&codex_superpowers_skill).expect("create codex superpowers skill dir");
    fs::write(
        codex_superpowers_skill.join("SKILL.md"),
        "---\nname: ui-ux-pro-max\nsource: codex\n---\n",
    )
    .expect("write codex superpowers skill");

    let detail =
        setup_get_skill_conflict_detail_with_home(&home, "ui-ux-pro-max").expect("get detail");

    assert_eq!(detail.skill_name, "ui-ux-pro-max");
    assert!(detail
        .variants
        .iter()
        .any(|variant| variant.source_id == "my-skills"));
    let codex = detail
        .variants
        .iter()
        .find(|variant| variant.source_id == "codex")
        .expect("find codex variant");
    assert!(!codex.hash_matches_my_skills);
}

#[test]
fn setup_resolve_skill_conflict_writes_selected_source_into_my_skills() {
    let home = temp_home();
    let my_skill_dir = home.join("my-skills").join("ui-ux-pro-max");
    fs::create_dir_all(&my_skill_dir).expect("create my skill dir");
    fs::write(
        my_skill_dir.join("SKILL.md"),
        "---\nname: ui-ux-pro-max\nsource: my-skills\n---\n",
    )
    .expect("write my skill");

    let codex_superpowers_skill = home
        .join(".codex")
        .join("superpowers")
        .join("skills")
        .join("ui-ux-pro-max");
    fs::create_dir_all(&codex_superpowers_skill).expect("create codex superpowers skill dir");
    fs::write(
        codex_superpowers_skill.join("SKILL.md"),
        "---\nname: ui-ux-pro-max\nsource: codex\n---\n",
    )
    .expect("write codex superpowers skill");

    let result = setup_resolve_skill_conflict_with_home(&home, "ui-ux-pro-max", "codex")
        .expect("resolve conflict");
    assert!(result.success);

    let updated =
        fs::read_to_string(my_skill_dir.join("SKILL.md")).expect("read updated my skills content");
    assert!(updated.contains("source: codex"));
}

#[test]
fn setup_apply_syncs_skills_to_custom_tool() {
    let home = temp_home();
    let skills_root = temp_home();
    let custom_skills_dir = home.join(".aider").join("skills");
    fs::create_dir_all(custom_skills_dir.parent().expect("custom parent"))
        .expect("create custom parent");
    fs::create_dir_all(skills_root.join("debug-helper")).expect("create skill dir");
    fs::write(
        skills_root.join("debug-helper").join("SKILL.md"),
        "---\nname: debug-helper\n---\n",
    )
    .expect("write skill");
    fs::create_dir_all(home.join(".myskills-manager")).expect("create app config dir");
    let config = serde_json::json!([{
      "name": "Aider",
      "id": "aider",
      "skillsDir": custom_skills_dir.to_string_lossy().to_string()
    }]);

    fs::write(
        home.join(".myskills-manager").join("custom-tools.json"),
        serde_json::to_string(&config).expect("serialize config"),
    )
    .expect("write custom tools");

    let result = apply_setup_with_paths(&home, &skills_root, &["aider".to_string()], None)
        .expect("apply setup");
    assert_eq!(result.len(), 1);
    assert!(result[0].success);
    assert_eq!(result[0].tool, "aider");
    assert_eq!(result[0].synced_count, 1);
    assert!(custom_skills_dir
        .join("debug-helper")
        .join("SKILL.md")
        .exists());
}

#[test]
fn setup_apply_injects_rules_once_for_codex() {
    let home = temp_home();
    let skills_root = temp_home();
    fs::create_dir_all(skills_root.join("code-review")).expect("create skill dir");
    fs::write(
        skills_root.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\n",
    )
    .expect("write skill");

    let first = apply_setup_with_paths(&home, &skills_root, &["codex".to_string()], None)
        .expect("apply setup");
    assert!(first[0].success);

    let second = apply_setup_with_paths(&home, &skills_root, &["codex".to_string()], None)
        .expect("apply setup");
    assert!(second[0].success);

    let rules_content =
        fs::read_to_string(home.join(".codex").join("AGENTS.md")).expect("read codex rules");
    let marker_count = rules_content.matches("[MySkills Manager]").count();
    assert_eq!(marker_count, 1);
    assert!(rules_content.contains("codex"));
    assert!(rules_content.contains("## 1) Turn Gate (Hard Requirement)"));
    assert!(rules_content.contains("`myskills-router`"));
}

#[test]
fn setup_apply_cursor_rules_do_not_duplicate_frontmatter() {
    let home = temp_home();
    let skills_root = temp_home();
    fs::create_dir_all(skills_root.join("code-review")).expect("create skill dir");
    fs::write(
        skills_root.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\n",
    )
    .expect("write skill");

    let first = apply_setup_with_paths(&home, &skills_root, &["cursor".to_string()], None)
        .expect("apply setup");
    assert!(first[0].success);

    let second = apply_setup_with_paths(&home, &skills_root, &["cursor".to_string()], None)
        .expect("apply setup");
    assert!(second[0].success);

    let rules_path = home
        .join(".cursor")
        .join("rules")
        .join("myskills-tracker.mdc");
    let rules_content = fs::read_to_string(rules_path).expect("read cursor rules");
    let marker_count = rules_content.matches("[MySkills Manager]").count();
    assert_eq!(marker_count, 1);
    let frontmatter_count = rules_content
        .matches("description: MySkills Manager global routing and tracking rules")
        .count();
    assert_eq!(frontmatter_count, 1);
    assert!(rules_content.contains("## 1) Turn Gate (Hard Requirement)"));
}

#[test]
fn setup_apply_configures_claude_hook() {
    let home = temp_home();
    let skills_root = temp_home();
    fs::create_dir_all(skills_root.join("code-review")).expect("create skill dir");
    fs::write(
        skills_root.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\n",
    )
    .expect("write skill");

    let result = apply_setup_with_paths(&home, &skills_root, &["claude-code".to_string()], None)
        .expect("apply setup");
    assert!(result[0].success);

    let hook_script = home.join(super::CLAUDE_HOOK_REL_PATH);
    assert!(hook_script.exists());
    let hook_content = fs::read_to_string(&hook_script).expect("read hook script");

    let settings = fs::read_to_string(home.join(".claude").join("settings.json"))
        .expect("read claude settings");
    #[cfg(target_family = "windows")]
    {
        assert!(settings.contains("powershell"));
        assert!(settings.contains("skill-tracker.ps1"));
        assert!(!settings.contains("skill-tracker.sh"));
        assert!(hook_content.contains("ConvertFrom-Json"));
        assert!(!hook_content.contains("jq -r"));
        assert!(!hook_content.contains("#!/bin/bash"));
    }
    #[cfg(not(target_family = "windows"))]
    {
        assert!(settings.contains("skill-tracker.sh"));
        assert!(hook_content.contains("#!/bin/bash"));
    }
}

#[test]
fn update_tool_paths_persists_override_for_builtin_tool() {
    let home = temp_home();
    let new_skills = home.join("custom").join("codex-skills");
    let new_rules = home.join("custom").join("CODERULES.md");
    let new_skills_str = new_skills.to_string_lossy().to_string();
    let new_rules_str = new_rules.to_string_lossy().to_string();

    let result = update_tool_paths_with_home(&home, "codex", &new_skills_str, Some(&new_rules_str))
        .expect("update built-in tool paths");
    assert!(result.success);

    let status = setup_status_with_home(&home).expect("setup status");
    let codex = find_tool(&status, "codex");
    assert_eq!(codex.skills_dir, new_skills.to_string_lossy());
    assert_eq!(codex.rules_path, new_rules.to_string_lossy());
}

#[test]
fn update_tool_paths_updates_custom_tool_registry() {
    let home = temp_home();
    let custom = CustomTool {
        name: "Aider".to_string(),
        id: "aider".to_string(),
        skills_dir: home
            .join(".aider")
            .join("skills")
            .to_string_lossy()
            .to_string(),
        rules_file: Some(
            home.join(".aider")
                .join("AGENTS.md")
                .to_string_lossy()
                .to_string(),
        ),
        icon: None,
    };
    add_custom_tool_with_home(&home, custom).expect("add custom");

    let new_skills = home.join(".aider").join("instructions");
    let new_rules = home.join(".aider").join("AIDER.md");
    let new_skills_str = new_skills.to_string_lossy().to_string();
    let new_rules_str = new_rules.to_string_lossy().to_string();
    let result = update_tool_paths_with_home(&home, "aider", &new_skills_str, Some(&new_rules_str))
        .expect("update custom paths");
    assert!(result.success);

    let custom_tools = get_custom_tools_with_home(&home).expect("read custom tools");
    assert_eq!(custom_tools.len(), 1);
    assert_eq!(custom_tools[0].skills_dir, new_skills.to_string_lossy());
    assert_eq!(
        custom_tools[0].rules_file.as_deref(),
        Some(new_rules_str.as_str())
    );

    let status = setup_status_with_home(&home).expect("setup status");
    let aider = find_tool(&status, "aider");
    assert_eq!(aider.skills_dir, new_skills.to_string_lossy());
    assert_eq!(aider.rules_path, new_rules.to_string_lossy());
}

#[test]
fn setup_auto_sync_toggle_persists_in_status() {
    let home = temp_home();

    let before = setup_status_with_home(&home).expect("setup status before");
    let codex_before = find_tool(&before, "codex");
    assert!(!codex_before.auto_sync);

    let enable = set_tool_auto_sync_with_home(&home, "codex", true).expect("enable auto sync");
    assert!(enable.success);

    let after_enable = setup_status_with_home(&home).expect("setup status after enable");
    let codex_enabled = find_tool(&after_enable, "codex");
    assert!(codex_enabled.auto_sync);

    let disable = set_tool_auto_sync_with_home(&home, "codex", false).expect("disable auto sync");
    assert!(disable.success);

    let after_disable = setup_status_with_home(&home).expect("setup status after disable");
    let codex_disabled = find_tool(&after_disable, "codex");
    assert!(!codex_disabled.auto_sync);
}

#[test]
fn set_tool_auto_sync_rejects_unknown_tool() {
    let home = temp_home();
    let err = set_tool_auto_sync_with_home(&home, "not-a-tool", true)
        .expect_err("unknown tool should fail");
    assert!(err.contains("Tool id not supported"));
}

#[test]
fn setup_tracking_toggle_persists_in_status() {
    let home = temp_home();

    let before = setup_status_with_home(&home).expect("setup status before");
    let codex_before = find_tool(&before, "codex");
    assert!(codex_before.tracking_enabled);

    let disable =
        set_tool_tracking_enabled_with_home(&home, "codex", false).expect("disable tracking");
    assert!(disable.success);

    let after_disable = setup_status_with_home(&home).expect("setup status after disable");
    let codex_disabled = find_tool(&after_disable, "codex");
    assert!(!codex_disabled.tracking_enabled);

    let enable =
        set_tool_tracking_enabled_with_home(&home, "codex", true).expect("enable tracking");
    assert!(enable.success);

    let after_enable = setup_status_with_home(&home).expect("setup status after enable");
    let codex_enabled = find_tool(&after_enable, "codex");
    assert!(codex_enabled.tracking_enabled);
}

#[test]
fn sync_config_mutations_are_serialized_under_concurrency() {
    let home = std::sync::Arc::new(temp_home());
    let mut tasks = Vec::new();
    for worker in 0..6usize {
        let home = home.clone();
        tasks.push(std::thread::spawn(move || {
            for round in 0..24usize {
                let auto_sync = (worker + round) % 2 == 0;
                set_tool_auto_sync_with_home(&home, "codex", auto_sync).expect("toggle auto sync");

                let mode = match (worker + round) % 3 {
                    0 => "manual",
                    1 => "prompt",
                    _ => "auto",
                };
                set_import_mode_with_home(&home, mode).expect("set import mode");
            }
        }));
    }

    for task in tasks {
        task.join().expect("join worker");
    }

    let raw = fs::read_to_string(home.join(".myskills-manager").join("sync-config.json"))
        .expect("read sync config");
    let parsed = serde_json::from_str::<serde_json::Value>(&raw).expect("parse sync config");
    assert!(parsed.get("syncMode").is_some());
    assert!(parsed.get("importMode").is_some());
    assert!(parsed.get("autoTools").is_some());
    assert!(parsed.get("trackingDisabledTools").is_some());

    let status = setup_status_with_home(&home).expect("setup status");
    let codex = find_tool(&status, "codex");
    assert!(codex.id == "codex");
}

#[test]
fn setup_apply_removes_rules_block_when_tracking_disabled() {
    let home = temp_home();
    let skills_root = temp_home();
    fs::create_dir_all(skills_root.join("code-review")).expect("create skill dir");
    fs::write(
        skills_root.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\n",
    )
    .expect("write skill");

    let rules_path = home.join(".codex").join("AGENTS.md");
    ensure_rules_injected("codex", &rules_path).expect("inject rules first");
    let with_marker = fs::read_to_string(&rules_path).expect("read rules");
    assert!(with_marker.contains("[MySkills Manager]"));

    set_tool_tracking_enabled_with_home(&home, "codex", false).expect("disable tracking");
    let result = apply_setup_with_paths(&home, &skills_root, &["codex".to_string()], None)
        .expect("apply setup");
    assert!(result[0].success);

    let after = fs::read_to_string(&rules_path).expect("read rules after");
    assert!(!after.contains("[MySkills Manager]"));
}

#[test]
fn set_tool_tracking_disabled_removes_claude_hook() {
    let home = temp_home();
    ensure_claude_hook(&home).expect("ensure hook");
    assert!(home.join(super::CLAUDE_HOOK_REL_PATH).exists());

    set_tool_tracking_enabled_with_home(&home, "claude-code", false)
        .expect("disable claude tracking");

    assert!(!home.join(super::CLAUDE_HOOK_REL_PATH).exists());
}

#[test]
fn setup_apply_creates_backup_before_modifying_rules_file() {
    let home = temp_home();
    let skills_root = temp_home();
    fs::create_dir_all(skills_root.join("code-review")).expect("create skill dir");
    fs::write(
        skills_root.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\n",
    )
    .expect("write skill");

    let rules_path = home.join(".codex").join("AGENTS.md");
    fs::create_dir_all(rules_path.parent().expect("rules parent")).expect("create rules dir");
    fs::write(&rules_path, "legacy rules\n").expect("write legacy rules");

    let result = apply_setup_with_paths(&home, &skills_root, &["codex".to_string()], None)
        .expect("apply setup");
    assert!(result[0].success);

    let backup_path = home.join(".codex").join("AGENTS.md.bak");
    assert!(backup_path.exists(), "expected AGENTS.md.bak to exist");
    let backup_content = fs::read_to_string(backup_path).expect("read backup");
    assert_eq!(backup_content, "legacy rules\n");
}

#[test]
fn setup_apply_rolls_back_previous_config_writes_when_later_tool_fails() {
    let home = temp_home();
    let skills_root = temp_home();
    fs::create_dir_all(skills_root.join("code-review")).expect("create skill dir");
    fs::write(
        skills_root.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\n",
    )
    .expect("write skill");

    let codex_rules = home.join(".codex").join("AGENTS.md");
    fs::create_dir_all(codex_rules.parent().expect("codex rules parent"))
        .expect("create codex rules parent");
    fs::write(&codex_rules, "codex old rules\n").expect("write old codex rules");

    let broken_rules_dir = home.join(".broken").join("rules-as-dir");
    fs::create_dir_all(&broken_rules_dir).expect("create broken rules dir");
    fs::create_dir_all(home.join(".myskills-manager")).expect("create app config dir");
    let custom_tool = serde_json::json!([{
      "name": "BrokenTool",
      "id": "broken",
      "skillsDir": home.join(".broken").join("skills").to_string_lossy().to_string(),
      "rulesFile": broken_rules_dir.to_string_lossy().to_string()
    }]);
    fs::write(
        home.join(".myskills-manager").join("custom-tools.json"),
        serde_json::to_string(&custom_tool).expect("serialize custom tools"),
    )
    .expect("write custom tools");

    let result = apply_setup_with_paths(
        &home,
        &skills_root,
        &["codex".to_string(), "broken".to_string()],
        None,
    )
    .expect("apply setup");

    assert!(!result.iter().all(|item| item.success));
    let codex_after = fs::read_to_string(&codex_rules).expect("read codex rules after");
    assert_eq!(codex_after, "codex old rules\n");
}

#[test]
fn sync_saved_skill_to_copy_tools_updates_existing_copy_targets() {
    let home = temp_home();
    let skills_root = temp_home();

    fs::create_dir_all(skills_root.join("code-review")).expect("create skill dir");
    fs::write(
        skills_root.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\nnew content\n",
    )
    .expect("write source skill");

    let codex_skill_dir = home.join(".codex").join("skills").join("code-review");
    fs::create_dir_all(&codex_skill_dir).expect("create codex skill dir");
    fs::write(
        codex_skill_dir.join("SKILL.md"),
        "---\nname: code-review\n---\nold content\n",
    )
    .expect("write old copied skill");

    let synced = sync_saved_skill_to_copy_tools_with_home(&home, &skills_root, "code-review")
        .expect("sync saved skill");

    assert_eq!(synced, 1);
    let updated = fs::read_to_string(codex_skill_dir.join("SKILL.md")).expect("read updated");
    assert!(updated.contains("new content"));
    assert!(!updated.contains("old content"));
}

#[test]
fn sync_saved_skill_to_copy_tools_updates_antigravity_workflow_alias() {
    let home = temp_home();
    let skills_root = temp_home();

    fs::create_dir_all(skills_root.join("code-review")).expect("create skill dir");
    fs::write(
        skills_root.join("code-review").join("SKILL.md"),
        "---\nname: code-review\n---\nnew content\n",
    )
    .expect("write source skill");

    let antigravity_skill_dir = home
        .join(".gemini")
        .join("antigravity")
        .join("skills")
        .join("code-review");
    fs::create_dir_all(&antigravity_skill_dir).expect("create antigravity skill dir");
    fs::write(
        antigravity_skill_dir.join("SKILL.md"),
        "---\nname: code-review\n---\nold content\n",
    )
    .expect("write old copied skill");

    let alias_dir = home
        .join(".gemini")
        .join("antigravity")
        .join("global_workflows");
    fs::create_dir_all(&alias_dir).expect("create alias dir");
    fs::write(alias_dir.join("code-review.md"), "old workflow alias\n").expect("write old alias");
    fs::write(
        alias_dir.join(".myskills-managed-workflows.json"),
        serde_json::to_string(&vec!["code-review.md"]).expect("serialize manifest"),
    )
    .expect("write manifest");

    let synced = sync_saved_skill_to_copy_tools_with_home(&home, &skills_root, "code-review")
        .expect("sync saved skill");

    assert_eq!(synced, 1);
    let updated_alias =
        fs::read_to_string(alias_dir.join("code-review.md")).expect("read updated alias");
    assert!(updated_alias.contains("new content"));
    assert!(!updated_alias.contains("old workflow alias"));
}

#[test]
fn path_helpers_must_not_be_duplicated_across_modules() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let setup_source =
        fs::read_to_string(manifest_dir.join("src").join("setup.rs")).expect("read setup.rs");
    let onboarding_source = fs::read_to_string(manifest_dir.join("src").join("onboarding.rs"))
        .expect("read onboarding.rs");
    let setup_main = setup_source
        .split("#[cfg(test)]")
        .next()
        .expect("setup main section");

    for signature in [
        "fn default_home_dir() -> PathBuf {",
        "fn default_skills_root(home: &Path) -> PathBuf {",
        "fn app_config_dir(home: &Path) -> PathBuf {",
    ] {
        assert!(
            !setup_main.contains(signature),
            "duplicate helper in setup.rs: {signature}"
        );
        assert!(
            !onboarding_source.contains(signature),
            "duplicate helper in onboarding.rs: {signature}"
        );
    }
}

#[test]
fn tool_catalog_must_be_extracted_from_setup_module() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let setup_source =
        fs::read_to_string(manifest_dir.join("src").join("setup.rs")).expect("read setup.rs");
    let setup_main = setup_source
        .split("#[cfg(test)]")
        .next()
        .expect("setup main section");

    for signature in [
        "struct ToolDescriptor {",
        "fn built_in_tools(home: &Path) -> Vec<ToolDescriptor> {",
    ] {
        assert!(
            !setup_main.contains(signature),
            "tool catalog should live outside setup.rs: {signature}"
        );
    }
}

#[test]
fn tool_registry_must_own_builtin_tool_definitions() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let catalog_source = fs::read_to_string(
        manifest_dir
            .join("src")
            .join("setup")
            .join("tool_catalog.rs"),
    )
    .expect("read tool_catalog.rs");
    let registry_source = fs::read_to_string(
        manifest_dir
            .join("src")
            .join("setup")
            .join("tool_registry.rs"),
    )
    .expect("read tool_registry.rs");

    assert!(
        !catalog_source.contains("fn built_in_defaults("),
        "built-in tool defaults should live in tool_registry.rs"
    );
    assert!(
        catalog_source.contains("super::tool_registry::built_in_tool_definitions(home)"),
        "tool_catalog should consume definitions from tool_registry.rs"
    );
    assert!(
        registry_source.contains("pub(super) fn built_in_tool_definitions(home: &Path)"),
        "tool_registry.rs should expose built-in tool definitions"
    );
}

#[test]
fn config_store_must_be_extracted_from_setup_module() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let setup_source =
        fs::read_to_string(manifest_dir.join("src").join("setup.rs")).expect("read setup.rs");
    let setup_main = setup_source
        .split("#[cfg(test)]")
        .next()
        .expect("setup main section");

    for signature in [
        "fn read_custom_tools(home: &Path) -> Result<Vec<CustomTool>, String> {",
        "fn read_tool_path_overrides(home: &Path) -> Result<Vec<ToolPathOverride>, String> {",
        "fn read_sync_config(home: &Path) -> Result<Option<SyncConfigFile>, String> {",
    ] {
        assert!(
            !setup_main.contains(signature),
            "config store should live outside setup.rs: {signature}"
        );
    }
}

#[test]
fn status_probe_must_be_extracted_from_setup_module() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let setup_source =
        fs::read_to_string(manifest_dir.join("src").join("setup.rs")).expect("read setup.rs");
    let setup_main = setup_source
        .split("#[cfg(test)]")
        .next()
        .expect("setup main section");

    for signature in [
        "fn file_contains_marker(path: &Path) -> bool {",
        "fn detect_sync_stats(skills_dir: &Path) -> Result<(usize, String, Option<String>), String> {",
        "fn detect_claude_hook(home: &Path) -> bool {",
    ] {
        assert!(
            !setup_main.contains(signature),
            "status probe should live outside setup.rs: {signature}"
        );
    }
}

#[test]
fn sync_ops_must_be_extracted_from_setup_module() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let setup_source =
        fs::read_to_string(manifest_dir.join("src").join("setup.rs")).expect("read setup.rs");
    let setup_main = setup_source
        .split("#[cfg(test)]")
        .next()
        .expect("setup main section");

    for signature in [
        "fn remove_if_exists(path: &Path) -> Result<(), String> {",
        "fn backup_if_exists(path: &Path) -> Result<(), String> {",
        "fn finalize_with_rollback(",
        "fn sync_skill_file(source: &Path, target: &Path) -> Result<String, String> {",
        "fn remove_skill_target(target_dir: &Path, target_file: &Path) -> Result<(), String> {",
    ] {
        assert!(
            !setup_main.contains(signature),
            "sync ops should live outside setup.rs: {signature}"
        );
    }
}

#[test]
fn rule_and_hook_ops_must_be_extracted_from_setup_module() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let setup_source =
        fs::read_to_string(manifest_dir.join("src").join("setup.rs")).expect("read setup.rs");
    let setup_main = setup_source
        .split("#[cfg(test)]")
        .next()
        .expect("setup main section");

    for signature in [
        "fn tracking_rule_block(tool_id: &str) -> String {",
        "fn build_rule_block(tool_id: &str, rules_path: &Path) -> String {",
        "fn upsert_marker_block(existing: &str, block: &str) -> String {",
        "fn remove_marker_block(existing: &str) -> String {",
        "fn ensure_rules_injected(tool_id: &str, rules_path: &Path) -> Result<(), String> {",
        "fn ensure_rules_removed(rules_path: &Path) -> Result<(), String> {",
        "fn ensure_claude_hook(home: &Path) -> Result<(), String> {",
        "fn ensure_claude_hook_removed(home: &Path) -> Result<(), String> {",
    ] {
        assert!(
            !setup_main.contains(signature),
            "rule/hook ops should live outside setup.rs: {signature}"
        );
    }
}

#[test]
fn apply_engine_must_be_extracted_from_setup_module() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let setup_source =
        fs::read_to_string(manifest_dir.join("src").join("setup.rs")).expect("read setup.rs");
    let setup_main = setup_source
        .split("#[cfg(test)]")
        .next()
        .expect("setup main section");

    for signature in [
        "fn is_skill_enabled_for_tool(",
        "fn is_tracking_enabled_for_tool(tool_id: &str, tracking_disabled_tools: &HashSet<String>) -> bool {",
    ] {
        assert!(
            !setup_main.contains(signature),
            "apply engine should live outside setup.rs: {signature}"
        );
    }
    assert!(setup_main.contains("apply_engine::sync_saved_skill_to_copy_tools_with_home("));
    assert!(setup_main.contains("apply_engine::apply_setup_with_paths("));
}

#[test]
fn local_skills_overview_must_be_extracted_from_setup_module() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let setup_source =
        fs::read_to_string(manifest_dir.join("src").join("setup.rs")).expect("read setup.rs");
    let setup_main = setup_source
        .split("#[cfg(test)]")
        .next()
        .expect("setup main section");

    for signature in [
        "fn tool_skill_source_dirs(tool: &ToolDescriptor) -> Vec<PathBuf> {",
        "fn skill_file_hash(skill_file: &Path) -> Result<String, String> {",
        "fn skill_hashes_by_name(root: &Path) -> Result<HashMap<String, String>, String> {",
        "enum NameSyncState {",
    ] {
        assert!(
            !setup_main.contains(signature),
            "local skills overview should live outside setup.rs: {signature}"
        );
    }

    assert!(setup_main.contains("skills_overview::setup_skill_source_dirs_with_home(home)"));
    assert!(setup_main.contains("skills_overview::local_skills_overview_with_home(home)"));
}

#[test]
fn tool_mutations_must_be_extracted_from_setup_module() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let setup_source =
        fs::read_to_string(manifest_dir.join("src").join("setup.rs")).expect("read setup.rs");
    let setup_main = setup_source
        .split("#[cfg(test)]")
        .next()
        .expect("setup main section");

    for signature in [
        "fn validate_tool_id(id: &str) -> Result<String, String> {",
        "tool.name = tool.name.trim().to_string();",
        "if is_built_in_tool_id(&tool.id) {",
        "let mut auto_tools = config.auto_tools.into_iter().collect::<HashSet<_>>();",
        "if tool_id == \"claude-code\" {",
    ] {
        assert!(
            !setup_main.contains(signature),
            "tool mutation logic should live outside setup.rs: {signature}"
        );
    }

    assert!(setup_main.contains("tool_mutations::get_custom_tools_with_home(home)"));
    assert!(setup_main.contains("tool_mutations::add_custom_tool_with_home(home, tool)"));
    assert!(setup_main.contains("tool_mutations::remove_custom_tool_with_home(home, id)"));
    assert!(setup_main.contains("tool_mutations::update_tool_paths_with_home("));
    assert!(setup_main.contains("tool_mutations::set_tool_auto_sync_with_home("));
    assert!(setup_main.contains("tool_mutations::set_tool_tracking_enabled_with_home("));
}

#[test]
fn status_aggregation_must_be_extracted_from_setup_module() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let setup_source =
        fs::read_to_string(manifest_dir.join("src").join("setup.rs")).expect("read setup.rs");
    let setup_main = setup_source
        .split("#[cfg(test)]")
        .next()
        .expect("setup main section");

    for signature in [
        "let sync_config = read_sync_config(home)?;",
        "let (synced_skills, sync_mode, last_sync_time) = detect_sync_stats(&tool.skills_dir)?;",
        "let hook_configured = if tool.id == \"claude-code\" {",
    ] {
        assert!(
            !setup_main.contains(signature),
            "status aggregation should live outside setup.rs: {signature}"
        );
    }

    assert!(setup_main.contains("status_aggregation::setup_status_with_home(home)"));
}

#[test]
fn setup_types_must_be_extracted_from_setup_module() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let setup_source =
        fs::read_to_string(manifest_dir.join("src").join("setup.rs")).expect("read setup.rs");
    let setup_main = setup_source
        .split("#[cfg(test)]")
        .next()
        .expect("setup main section");

    for signature in [
        "pub struct ToolStatus {",
        "pub struct ApplyResult {",
        "pub struct CustomTool {",
        "pub struct SetupMutationResult {",
        "pub struct SkillSyncConfig {",
    ] {
        assert!(
            !setup_main.contains(signature),
            "setup types should live outside setup.rs: {signature}"
        );
    }

    assert!(setup_main.contains("pub use types::{"));
}

#[test]
fn setup_tests_must_be_moved_to_dedicated_module() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let setup_source =
        fs::read_to_string(manifest_dir.join("src").join("setup.rs")).expect("read setup.rs");
    assert!(
        !setup_source.contains("mod tests {"),
        "setup.rs should use #[cfg(test)] mod tests; with tests in src/setup/tests.rs"
    );
}

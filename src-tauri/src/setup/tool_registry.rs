use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub(super) struct RegistryPathCandidate {
    pub skills_dir: PathBuf,
    pub rules_path: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub(super) struct BuiltInToolDefinition {
    pub name: &'static str,
    pub id: &'static str,
    pub default_skills_dir: PathBuf,
    pub default_rules_path: Option<PathBuf>,
    pub capabilities: super::ToolCapabilities,
    pub candidates: Vec<RegistryPathCandidate>,
}

pub(super) fn is_built_in_tool_id(id: &str) -> bool {
    matches!(
        id,
        "antigravity" | "codex" | "claude-code" | "cursor" | "windsurf" | "trae" | "opencode"
    )
}

fn capabilities(
    native_skill_discovery: bool,
    instruction_chain_supported: bool,
    startup_injection_supported: bool,
    hook_config_supported: bool,
) -> super::ToolCapabilities {
    super::ToolCapabilities {
        native_skill_discovery,
        instruction_chain_supported,
        startup_injection_supported,
        hook_config_supported,
    }
}

pub(super) fn built_in_tool_definitions(home: &Path) -> Vec<BuiltInToolDefinition> {
    // Extension point: adding a new built-in tool should only require one new entry here
    // plus tests, without touching setup apply logic.
    let codex_rules = Some(home.join(".codex").join("AGENTS.md"));
    let cursor_rules = Some(
        home.join(".cursor")
            .join("rules")
            .join("myskills-tracker.mdc"),
    );

    vec![
        BuiltInToolDefinition {
            name: "Antigravity",
            id: "antigravity",
            default_skills_dir: home.join(".gemini").join("antigravity").join("skills"),
            default_rules_path: Some(home.join(".gemini").join("GEMINI.md")),
            capabilities: capabilities(true, true, true, false),
            candidates: vec![
                RegistryPathCandidate {
                    skills_dir: home.join(".gemini").join("antigravity").join("skills"),
                    rules_path: Some(home.join(".gemini").join("GEMINI.md")),
                },
                RegistryPathCandidate {
                    skills_dir: home.join(".gemini").join("instructions"),
                    rules_path: Some(home.join(".gemini").join("GEMINI.md")),
                },
            ],
        },
        BuiltInToolDefinition {
            name: "Codex",
            id: "codex",
            default_skills_dir: home.join(".codex").join("skills"),
            default_rules_path: codex_rules.clone(),
            capabilities: capabilities(true, true, false, false),
            candidates: vec![
                RegistryPathCandidate {
                    skills_dir: home.join(".agents").join("skills"),
                    rules_path: codex_rules.clone(),
                },
                RegistryPathCandidate {
                    skills_dir: home.join(".codex").join("skills"),
                    rules_path: codex_rules,
                },
            ],
        },
        BuiltInToolDefinition {
            name: "Claude Code",
            id: "claude-code",
            default_skills_dir: home.join(".claude").join("skills"),
            default_rules_path: Some(home.join(".claude").join("CLAUDE.md")),
            capabilities: capabilities(true, true, false, true),
            candidates: vec![RegistryPathCandidate {
                skills_dir: home.join(".claude").join("skills"),
                rules_path: Some(home.join(".claude").join("CLAUDE.md")),
            }],
        },
        BuiltInToolDefinition {
            name: "Cursor",
            id: "cursor",
            default_skills_dir: home.join(".cursor").join("skills"),
            default_rules_path: cursor_rules.clone(),
            capabilities: capabilities(true, true, false, false),
            candidates: vec![
                RegistryPathCandidate {
                    skills_dir: home.join(".cursor").join("skills"),
                    rules_path: cursor_rules.clone(),
                },
                RegistryPathCandidate {
                    skills_dir: home.join(".cursor").join("rules"),
                    rules_path: cursor_rules,
                },
            ],
        },
        BuiltInToolDefinition {
            name: "Windsurf",
            id: "windsurf",
            default_skills_dir: home.join(".codeium").join("windsurf").join("skills"),
            default_rules_path: Some(
                home.join(".codeium")
                    .join("windsurf")
                    .join("memories")
                    .join("global_rules.md"),
            ),
            capabilities: capabilities(true, true, false, false),
            candidates: vec![
                RegistryPathCandidate {
                    skills_dir: home.join(".codeium").join("windsurf").join("skills"),
                    rules_path: Some(
                        home.join(".codeium")
                            .join("windsurf")
                            .join("memories")
                            .join("global_rules.md"),
                    ),
                },
                RegistryPathCandidate {
                    skills_dir: home.join(".windsurf").join("skills"),
                    rules_path: Some(home.join(".windsurf").join("global_rules.md")),
                },
            ],
        },
        BuiltInToolDefinition {
            name: "Trae",
            id: "trae",
            default_skills_dir: home.join(".trae").join("skills"),
            default_rules_path: Some(home.join(".trae").join("AGENTS.md")),
            capabilities: capabilities(true, true, false, false),
            candidates: vec![RegistryPathCandidate {
                skills_dir: home.join(".trae").join("skills"),
                rules_path: Some(home.join(".trae").join("AGENTS.md")),
            }],
        },
        BuiltInToolDefinition {
            name: "OpenCode",
            id: "opencode",
            default_skills_dir: home.join(".config").join("opencode").join("skills"),
            default_rules_path: Some(home.join(".config").join("opencode").join("AGENTS.md")),
            capabilities: capabilities(true, true, false, false),
            candidates: vec![
                RegistryPathCandidate {
                    skills_dir: home.join(".config").join("opencode").join("skills"),
                    rules_path: Some(home.join(".config").join("opencode").join("AGENTS.md")),
                },
                RegistryPathCandidate {
                    skills_dir: home.join(".opencode").join("skills"),
                    rules_path: Some(home.join(".opencode").join("AGENTS.md")),
                },
            ],
        },
    ]
}

use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub(super) struct ToolDescriptor {
    pub name: String,
    pub id: String,
    pub icon: Option<String>,
    pub skills_dir: PathBuf,
    pub rules_path: Option<PathBuf>,
    pub capabilities: super::ToolCapabilities,
    pub path_source: String,
    pub is_custom: bool,
}

#[derive(Debug, Clone)]
pub(super) struct ToolPathCandidate {
    pub skills_dir: PathBuf,
    pub rules_path: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub(super) struct BuiltInToolResolution {
    pub descriptor: ToolDescriptor,
    pub candidates: Vec<ToolPathCandidate>,
}

pub(super) fn is_built_in_tool_id(id: &str) -> bool {
    super::tool_registry::is_built_in_tool_id(id)
}

pub(super) fn built_in_tools(
    home: &Path,
    overrides: &[super::ToolPathOverride],
) -> Vec<ToolDescriptor> {
    built_in_tool_resolutions(home, overrides)
        .into_iter()
        .map(|item| item.descriptor)
        .collect()
}

pub(super) fn built_in_tool_resolutions(
    home: &Path,
    overrides: &[super::ToolPathOverride],
) -> Vec<BuiltInToolResolution> {
    let mut matrix = Vec::<BuiltInToolResolution>::new();

    for defaults in super::tool_registry::built_in_tool_definitions(home) {
        let candidates = defaults
            .candidates
            .iter()
            .map(|candidate| ToolPathCandidate {
                skills_dir: candidate.skills_dir.clone(),
                rules_path: candidate.rules_path.clone(),
            })
            .collect::<Vec<_>>();

        if let Some(override_item) = overrides.iter().find(|item| item.id == defaults.id) {
            let skills_dir = override_item.skills_dir.trim();
            if !skills_dir.is_empty() {
                let rules_path = override_item
                    .rules_file
                    .as_ref()
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                    .map(PathBuf::from);
                let descriptor = ToolDescriptor {
                    name: defaults.name.to_string(),
                    id: defaults.id.to_string(),
                    icon: None,
                    skills_dir: PathBuf::from(skills_dir),
                    rules_path,
                    capabilities: defaults.capabilities.clone(),
                    path_source: "override".to_string(),
                    is_custom: false,
                };
                matrix.push(BuiltInToolResolution {
                    candidates,
                    descriptor: descriptor.clone(),
                });
                continue;
            }
        }

        let selected = candidates
            .iter()
            .find(|candidate| candidate.skills_dir.exists())
            .cloned();

        let (skills_dir, rules_path, path_source) = if let Some(candidate) = selected {
            let source = if candidate.skills_dir == defaults.default_skills_dir {
                "default"
            } else {
                "auto-detected"
            };
            (candidate.skills_dir, candidate.rules_path, source.to_string())
        } else {
            (
                defaults.default_skills_dir.clone(),
                defaults.default_rules_path.clone(),
                "default".to_string(),
            )
        };

        let descriptor = ToolDescriptor {
            name: defaults.name.to_string(),
            id: defaults.id.to_string(),
            icon: None,
            skills_dir,
            rules_path,
            capabilities: defaults.capabilities.clone(),
            path_source,
            is_custom: false,
        };
        matrix.push(BuiltInToolResolution {
            descriptor: descriptor.clone(),
            candidates,
        });
    }

    matrix
}

pub(super) fn custom_tool_to_descriptor(custom: super::CustomTool) -> ToolDescriptor {
    let rules_path = custom.rules_file.map(PathBuf::from);
    let capabilities = super::ToolCapabilities {
        native_skill_discovery: true,
        instruction_chain_supported: rules_path.is_some(),
        startup_injection_supported: false,
        hook_config_supported: false,
    };
    ToolDescriptor {
        name: custom.name,
        id: custom.id,
        icon: custom.icon,
        skills_dir: PathBuf::from(custom.skills_dir),
        rules_path,
        capabilities,
        path_source: "custom".to_string(),
        is_custom: true,
    }
}

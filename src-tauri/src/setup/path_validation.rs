use std::path::Path;

use super::config_store::read_tool_path_overrides;
use super::tool_catalog::built_in_tool_resolutions;
use super::{BuiltInToolPathAudit, PathCandidateAudit};

pub(super) fn setup_path_validation_matrix_with_home(
    home: &Path,
) -> Result<Vec<BuiltInToolPathAudit>, String> {
    let overrides = read_tool_path_overrides(home)?;
    let mut out = Vec::<BuiltInToolPathAudit>::new();

    for resolution in built_in_tool_resolutions(home, &overrides) {
        let selected_skills_dir = resolution.descriptor.skills_dir.clone();
        let selected_rules_path = resolution.descriptor.rules_path.clone();
        let mut selected_candidate_exists = false;

        let mut candidates = Vec::<PathCandidateAudit>::new();
        for candidate in resolution.candidates {
            let skills_dir_exists = candidate.skills_dir.is_dir();
            let selected = candidate.skills_dir == selected_skills_dir
                && candidate.rules_path == selected_rules_path;
            if selected && skills_dir_exists {
                selected_candidate_exists = true;
            }

            candidates.push(PathCandidateAudit {
                skills_dir: candidate.skills_dir.to_string_lossy().to_string(),
                rules_path: candidate
                    .rules_path
                    .as_ref()
                    .map(|path| path.to_string_lossy().to_string())
                    .unwrap_or_default(),
                skills_dir_exists,
                skills_dir_writable: super::status_aggregation::path_writable(
                    &candidate.skills_dir,
                ),
                rules_path_exists: candidate
                    .rules_path
                    .as_ref()
                    .map(|path| path.exists())
                    .unwrap_or(false),
                rules_path_writable: candidate
                    .rules_path
                    .as_ref()
                    .map(|path| super::status_aggregation::path_writable(path))
                    .unwrap_or(false),
                selected,
            });
        }

        out.push(BuiltInToolPathAudit {
            name: resolution.descriptor.name,
            id: resolution.descriptor.id,
            selected_skills_dir: selected_skills_dir.to_string_lossy().to_string(),
            selected_rules_path: selected_rules_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_default(),
            path_source: resolution.descriptor.path_source,
            selected_candidate_exists,
            needs_manual_review: !selected_candidate_exists,
            candidates,
        });
    }

    Ok(out)
}

use std::fs;
use std::path::{Path, PathBuf};

pub(crate) const ROUTER_SKILL_NAME: &str = "myskills-router";
const LEGACY_ROUTER_SKILL_NAME: &str = "myskills-command";
const ROUTER_SKILL_MD: &str = include_str!("../../builtin-skills/myskills-router/SKILL.md");

fn migrate_legacy_router_skill_name(skills_root: &Path) -> Result<(), String> {
    let legacy_dir = skills_root.join(LEGACY_ROUTER_SKILL_NAME);
    let legacy_skill_file = legacy_dir.join("SKILL.md");
    if !legacy_skill_file.exists() {
        return Ok(());
    }

    let router_dir = skills_root.join(ROUTER_SKILL_NAME);
    if router_dir.exists() {
        return Ok(());
    }

    fs::rename(&legacy_dir, &router_dir)
        .map_err(|e| format!("migrate legacy builtin skill failed: {e}"))
}

pub(crate) fn ensure_router_skill_seeded(skills_root: &Path) -> Result<PathBuf, String> {
    migrate_legacy_router_skill_name(skills_root)?;

    let skill_dir = skills_root.join(ROUTER_SKILL_NAME);
    let skill_file = skill_dir.join("SKILL.md");
    fs::create_dir_all(&skill_dir).map_err(|e| format!("create builtin skill dir failed: {e}"))?;
    let should_write = match fs::read_to_string(&skill_file) {
        Ok(existing) => existing != ROUTER_SKILL_MD,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => true,
        Err(err) => return Err(format!("read builtin skill failed: {err}")),
    };
    if should_write {
        fs::write(&skill_file, ROUTER_SKILL_MD)
            .map_err(|e| format!("write builtin skill failed: {e}"))?;
    }

    Ok(skill_dir)
}

#[cfg(test)]
pub(crate) fn router_skill_markdown() -> &'static str {
    ROUTER_SKILL_MD
}

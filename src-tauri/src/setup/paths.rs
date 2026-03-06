use std::path::{Path, PathBuf};

pub(super) fn antigravity_root_dir(home: &Path, skills_dir: &Path) -> PathBuf {
    if let Some(parent) = skills_dir.parent() {
        if parent
            .file_name()
            .map(|name| name.to_string_lossy().eq_ignore_ascii_case("antigravity"))
            .unwrap_or(false)
        {
            return parent.to_path_buf();
        }
    }
    home.join(".gemini").join("antigravity")
}

use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};

static RUNTIME_SKILLS_ROOT: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();

fn runtime_skills_root_cell() -> &'static RwLock<Option<PathBuf>> {
    RUNTIME_SKILLS_ROOT.get_or_init(|| RwLock::new(None))
}

pub fn runtime_skills_root() -> Option<PathBuf> {
    runtime_skills_root_cell()
        .read()
        .ok()
        .and_then(|guard| guard.clone())
}

pub fn set_runtime_skills_root(path: Option<PathBuf>) {
    if let Ok(mut guard) = runtime_skills_root_cell().write() {
        *guard = path;
    }
}

pub fn default_home_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home);
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        return PathBuf::from(home);
    }
    PathBuf::from("./")
}

pub fn default_skills_root(home: &Path) -> PathBuf {
    if let Some(path) = runtime_skills_root() {
        return path;
    }
    if let Ok(path) = std::env::var("MYSKILLS_ROOT_DIR") {
        return PathBuf::from(path);
    }
    home.join("my-skills")
}

pub fn app_config_dir(home: &Path) -> PathBuf {
    home.join(".myskills-manager")
}

pub fn default_root_dir() -> PathBuf {
    default_skills_root(&default_home_dir())
}

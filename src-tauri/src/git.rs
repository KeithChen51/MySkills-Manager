use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GitStatusResult {
    pub branch: String,
    pub changed: Vec<String>,
    pub staged: Vec<String>,
    pub not_added: Vec<String>,
    pub ahead: usize,
    pub behind: usize,
    pub recent_commits: Vec<GitRecentCommit>,
    pub latest_commit_hash: Option<String>,
    pub latest_pushed_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GitRecentCommit {
    pub hash: String,
    pub short_hash: String,
    pub summary: String,
    pub author_name: String,
    pub authored_at: String,
    pub is_pushed: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GitGraphCommit {
    pub hash: String,
    pub short_hash: String,
    pub summary: String,
    pub author_name: String,
    pub authored_at: String,
    pub is_pushed: bool,
    pub refs: Vec<String>,
    pub parent_hashes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GitCommitResult {
    pub success: bool,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GitPushResult {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitSkillsSyncResult {
    pub source_path: String,
    pub target_path: String,
    pub copied_files: usize,
    pub removed_entries: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitGuideDocument {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitSyncTreeEntry {
    pub relative_path: String,
    pub name: String,
    pub entry_type: String,
    pub has_children: bool,
    pub ignored: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitUpdateIgnoreResult {
    pub repository: ManagedGitRepository,
    pub sync_result: Option<GitSkillsSyncResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitProvider {
    Github,
    Gitlab,
    Gitee,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitSyncMode {
    Direct,
    Mirror,
}

fn default_sync_mode_for_legacy() -> GitSyncMode {
    GitSyncMode::Mirror
}

fn default_provider_for_legacy() -> GitProvider {
    GitProvider::Other
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedGitRepository {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub alias: Option<String>,
    pub url: String,
    #[serde(default = "default_provider_for_legacy")]
    pub provider: GitProvider,
    #[serde(default = "default_sync_mode_for_legacy")]
    pub sync_mode: GitSyncMode,
    #[serde(default)]
    pub source_path: String,
    pub local_path: String,
    pub is_syncing: bool,
    pub last_sync_at: Option<String>,
    pub last_sync_error: Option<String>,
    pub script_after_add: Option<String>,
    #[serde(default)]
    pub ignore_paths: Vec<String>,
}

static GIT_REPOSITORY_CONFIG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn repository_config_lock() -> &'static Mutex<()> {
    GIT_REPOSITORY_CONFIG_LOCK.get_or_init(|| Mutex::new(()))
}

fn with_repository_config_lock<T>(
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _guard = repository_config_lock()
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    operation()
}

fn managed_repositories_root(home: &Path) -> PathBuf {
    crate::root_dir::app_config_dir(home).join("git-repositories")
}

fn managed_repositories_file(home: &Path) -> PathBuf {
    crate::root_dir::app_config_dir(home).join("git-repositories.json")
}

fn git_guide_markdown_file(home: &Path) -> PathBuf {
    crate::root_dir::app_config_dir(home).join("git-guide.md")
}

const DEFAULT_GIT_GUIDE_MARKDOWN: &str = r#"# Skillar Git 使用流程

## 1. 这个页面能做什么
- 管理多个远端仓库（GitHub / GitLab / Gitee / 其他 Git）。
- 让不同仓库绑定不同本地目录（不仅是 `my-skills`，也可以是笔记目录、知识库目录等）。
- 执行提交、推送、状态查看，并在需要时同步本地目录内容。

## 2. 快速上手
1. 点击 **新增仓库**。
2. 选择同步模式：
   - `直连`：直接在你指定的本地目录上初始化/连接 Git 仓库。
   - `安全镜像`：在管理目录创建镜像仓库，源目录与仓库目录分离。
3. 填写远端地址、可选的仓库别名、源目录/本地目录。
4. 添加后进入仓库详情，按需执行提交与推送。

## 3. 字段说明
- **仓库别名**：仅用于在 Skillar 内显示，便于区分多个仓库。
- **Skills 源目录**：要被同步管理的本地目录。
- **本地仓库目录**：Git 仓库所在目录；直连模式可与源目录相同。
- **添加后执行脚本**：添加仓库后自动执行，例如 `npm install`。

## 4. 常见流程建议
- 维护 skills：源目录指向 `my-skills`，定期提交并推送。
- 同步笔记：源目录指向 Obsidian/文档目录，用同样流程做版本管理与分享。
- 多仓库管理：给每个仓库设置清晰别名，避免误操作。

## 5. 你可以自定义本文档
- 当前文档路径：`~/.myskills-manager/git-guide.md`
- 直接编辑该文件并保存，回到 Git 页面重新打开“使用流程”即可看到更新。
"#;

const GITIGNORE_MANAGED_START: &str = "# >>> skillar managed ignores";
const GITIGNORE_MANAGED_END: &str = "# <<< skillar managed ignores";

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Managed repository config parent path is missing".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("Create repository config directory failed: {e}"))
}

fn read_managed_repositories_unlocked(home: &Path) -> Result<Vec<ManagedGitRepository>, String> {
    let path = managed_repositories_file(home);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw =
        fs::read_to_string(&path).map_err(|e| format!("Read managed repositories failed: {e}"))?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }

    let mut repositories = serde_json::from_str::<Vec<ManagedGitRepository>>(&raw)
        .map_err(|e| format!("Invalid managed repositories config: {e}"))?;

    let default_source = crate::root_dir::default_skills_root(home)
        .to_string_lossy()
        .to_string();
    for repository in &mut repositories {
        if repository.source_path.trim().is_empty() {
            repository.source_path = default_source.clone();
        }
        if repository.provider == GitProvider::Other {
            repository.provider = infer_repository_provider(&repository.url);
        }
    }

    Ok(repositories)
}

fn write_managed_repositories_unlocked(
    home: &Path,
    repositories: &[ManagedGitRepository],
) -> Result<(), String> {
    let path = managed_repositories_file(home);
    ensure_parent_dir(&path)?;
    let content = serde_json::to_string_pretty(repositories)
        .map_err(|e| format!("Serialize managed repositories failed: {e}"))?;
    fs::write(path, format!("{content}\n"))
        .map_err(|e| format!("Write managed repositories failed: {e}"))
}

pub fn list_managed_repositories(home: &Path) -> Result<Vec<ManagedGitRepository>, String> {
    with_repository_config_lock(|| read_managed_repositories_unlocked(home))
}

fn sanitize_repo_name(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else if (ch == '.' || ch == ' ') && !out.ends_with('-') {
            out.push('-');
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "repository".to_string()
    } else {
        out
    }
}

fn infer_repository_name(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/').trim_end_matches('\\');
    let as_path = Path::new(trimmed);
    if let Some(file_name) = as_path.file_name().and_then(|name| name.to_str()) {
        let candidate = file_name.strip_suffix(".git").unwrap_or(file_name);
        if !candidate.is_empty() {
            return sanitize_repo_name(candidate);
        }
    }

    let without_dot_git = trimmed.strip_suffix(".git").unwrap_or(trimmed);
    let normalized = without_dot_git.replace('\\', "/");
    let candidate = normalized
        .rsplit('/')
        .next()
        .unwrap_or(&normalized)
        .rsplit(':')
        .next()
        .unwrap_or(&normalized);
    sanitize_repo_name(candidate)
}

fn infer_repository_provider(url: &str) -> GitProvider {
    let normalized = url.trim().to_ascii_lowercase();
    if normalized.contains("github.com") {
        return GitProvider::Github;
    }
    if normalized.contains("gitee.com") {
        return GitProvider::Gitee;
    }
    if normalized.contains("gitlab.com") || normalized.contains("gitlab.") {
        return GitProvider::Gitlab;
    }
    GitProvider::Other
}

fn parse_sync_mode(value: Option<String>) -> Result<GitSyncMode, String> {
    let normalized = value
        .as_deref()
        .map(str::trim)
        .filter(|mode| !mode.is_empty())
        .unwrap_or("direct")
        .to_ascii_lowercase();

    match normalized.as_str() {
        "direct" => Ok(GitSyncMode::Direct),
        "mirror" | "safe" | "safe-mirror" => Ok(GitSyncMode::Mirror),
        _ => Err(format!("Unsupported sync mode: {normalized}")),
    }
}

fn normalize_input_path(raw: &str) -> Result<PathBuf, String> {
    let input = PathBuf::from(raw.trim());
    if input.as_os_str().is_empty() {
        return Err("Path is required".to_string());
    }

    if input.is_absolute() {
        return Ok(input);
    }

    let cwd = std::env::current_dir().map_err(|e| format!("Read current directory failed: {e}"))?;
    Ok(cwd.join(input))
}

fn build_repository_id(name: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{name}-{nanos}")
}

fn pick_local_repository_path(
    home: &Path,
    name: &str,
    existing: &[ManagedGitRepository],
) -> PathBuf {
    let root = managed_repositories_root(home);
    let mut suffix = 0usize;
    loop {
        let candidate = if suffix == 0 {
            root.join(name)
        } else {
            root.join(format!("{name}-{suffix}"))
        };
        let candidate_str = candidate.to_string_lossy();
        let tracked = existing.iter().any(|repo| repo.local_path == candidate_str);
        if !tracked && !candidate.exists() {
            return candidate;
        }
        suffix += 1;
    }
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn build_remote_callbacks_for_push(
    repo: &git2::Repository,
) -> Result<git2::RemoteCallbacks<'_>, String> {
    let git_config = repo
        .config()
        .map_err(|e| format!("Read git config failed: {e}"))?;
    let env_username = std::env::var("GIT_USERNAME").ok();
    let env_password = std::env::var("GIT_PASSWORD")
        .ok()
        .or_else(|| std::env::var("GIT_TOKEN").ok())
        .or_else(|| std::env::var("GH_TOKEN").ok())
        .or_else(|| std::env::var("GITHUB_TOKEN").ok());

    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(move |url, username, allowed| {
        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            if let Some(password) = env_password.as_deref() {
                let user = env_username.as_deref().or(username).unwrap_or("git");
                if let Ok(cred) = git2::Cred::userpass_plaintext(user, password) {
                    return Ok(cred);
                }
            }
        }

        if let Ok(cred) = git2::Cred::credential_helper(&git_config, url, username) {
            return Ok(cred);
        }

        if allowed.contains(git2::CredentialType::SSH_KEY) {
            if let Some(name) = username {
                if let Ok(cred) = git2::Cred::ssh_key_from_agent(name) {
                    return Ok(cred);
                }
            }
        }

        if allowed.contains(git2::CredentialType::DEFAULT) {
            if let Ok(cred) = git2::Cred::default() {
                return Ok(cred);
            }
        }

        if allowed.contains(git2::CredentialType::USERNAME) {
            if let Some(name) = username {
                if let Ok(cred) = git2::Cred::username(name) {
                    return Ok(cred);
                }
            }
        }

        Err(git2::Error::from_str(
            "No supported git credentials found for push",
        ))
    });
    Ok(callbacks)
}

fn clone_or_fetch_repository(url: &str, local_path: &Path) -> Result<(), String> {
    if local_path.exists() {
        let repo = git2::Repository::open(local_path)
            .map_err(|e| format!("Open local repository failed: {e}"))?;
        let mut remote = repo
            .find_remote("origin")
            .map_err(|e| format!("Find repository remote 'origin' failed: {e}"))?;

        let callbacks = build_remote_callbacks_for_push(&repo)?;
        let mut fetch_options = git2::FetchOptions::new();
        fetch_options.remote_callbacks(callbacks);
        remote
            .fetch(&[] as &[&str], Some(&mut fetch_options), None)
            .map_err(|e| format!("Fetch repository failed: {e}"))?;
        return Ok(());
    }

    if let Some(parent) = local_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Create repository directory failed: {e}"))?;
    }

    git2::Repository::clone(url, local_path)
        .map_err(|e| format!("Clone repository failed: {e}"))?;
    Ok(())
}

fn init_or_open_repository(path: &Path) -> Result<git2::Repository, String> {
    if path.exists() {
        if !path.is_dir() {
            return Err(format!(
                "Repository path is not a directory: {}",
                path.to_string_lossy()
            ));
        }
        if let Ok(repo) = git2::Repository::open(path) {
            return Ok(repo);
        }
    } else {
        fs::create_dir_all(path).map_err(|e| {
            format!(
                "Create repository directory failed ({}): {e}",
                path.to_string_lossy()
            )
        })?;
    }

    git2::Repository::init(path).map_err(|e| format!("Initialize git repository failed: {e}"))
}

fn ensure_origin_remote(repo: &git2::Repository, url: &str) -> Result<(), String> {
    match repo.find_remote("origin") {
        Ok(remote) => {
            let current = remote.url().unwrap_or_default().trim().to_string();
            if current == url {
                Ok(())
            } else {
                Err(format!(
                    "Remote 'origin' already points to {current}; use another local path or update remote first"
                ))
            }
        }
        Err(_) => {
            repo.remote("origin", url)
                .map_err(|e| format!("Create git remote 'origin' failed: {e}"))?;
            Ok(())
        }
    }
}

fn fetch_origin(repo: &git2::Repository) -> Result<(), String> {
    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| format!("Find repository remote 'origin' failed: {e}"))?;
    let callbacks = build_remote_callbacks_for_push(repo)?;
    let mut fetch_options = git2::FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);
    remote
        .fetch(&[] as &[&str], Some(&mut fetch_options), None)
        .map_err(|e| format!("Fetch repository failed: {e}"))?;
    Ok(())
}

fn setup_direct_repository(url: &str, local_path: &Path) -> Result<(), String> {
    let repo = init_or_open_repository(local_path)?;
    ensure_origin_remote(&repo, url)?;
    fetch_origin(&repo)
}

fn run_post_add_script(local_path: &Path, script_after_add: Option<&str>) -> Result<(), String> {
    let Some(script) = script_after_add
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", script]);
        command
    };

    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut command = Command::new("sh");
        command.args(["-lc", script]);
        command
    };

    let output = command
        .current_dir(local_path)
        .output()
        .map_err(|e| format!("Run post-add script failed: {e}"))?;
    if output.status.success() {
        return Ok(());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let code = output
        .status
        .code()
        .map(|value| value.to_string())
        .unwrap_or_else(|| "terminated".to_string());
    Err(format!(
        "Post-add script exited with code {code}. stdout: {stdout}. stderr: {stderr}"
    ))
}

fn update_repository_record(home: &Path, record: &ManagedGitRepository) -> Result<(), String> {
    with_repository_config_lock(|| {
        let mut repositories = read_managed_repositories_unlocked(home)?;
        if let Some(existing) = repositories.iter_mut().find(|entry| entry.id == record.id) {
            *existing = record.clone();
        } else {
            repositories.push(record.clone());
        }
        write_managed_repositories_unlocked(home, &repositories)
    })
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn normalize_repository_alias(alias: Option<String>) -> Option<String> {
    alias
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn load_git_guide_markdown(home: &Path) -> Result<GitGuideDocument, String> {
    let path = git_guide_markdown_file(home);
    ensure_parent_dir(&path)?;

    if !path.exists() {
        fs::write(&path, format!("{DEFAULT_GIT_GUIDE_MARKDOWN}\n"))
            .map_err(|e| format!("Write default git guide markdown failed: {e}"))?;
    }

    let content =
        fs::read_to_string(&path).map_err(|e| format!("Read git guide markdown failed: {e}"))?;

    Ok(GitGuideDocument {
        path: path_to_string(&path),
        content,
    })
}

fn normalize_for_storage(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn resolve_source_path(home: &Path, source_path: Option<String>) -> Result<PathBuf, String> {
    let resolved = if let Some(path) = source_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        normalize_input_path(path)?
    } else {
        crate::root_dir::default_skills_root(home)
    };

    if !resolved.exists() {
        return Err(format!(
            "Source directory does not exist: {}",
            resolved.to_string_lossy()
        ));
    }
    if !resolved.is_dir() {
        return Err(format!(
            "Source path is not a directory: {}",
            resolved.to_string_lossy()
        ));
    }

    Ok(normalize_for_storage(&resolved))
}

fn resolve_direct_local_path(
    source_path: &Path,
    local_path: Option<String>,
) -> Result<PathBuf, String> {
    let local = if let Some(path) = local_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        normalize_input_path(path)?
    } else {
        source_path.to_path_buf()
    };
    Ok(normalize_for_storage(&local))
}

fn is_sub_path(parent: &Path, candidate: &Path) -> bool {
    let parent = fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
    let candidate = fs::canonicalize(candidate).unwrap_or_else(|_| candidate.to_path_buf());
    candidate.starts_with(parent)
}

pub fn remove_managed_repository(home: &Path, repository_id: &str) -> Result<(), String> {
    let repository_id = repository_id.trim();
    if repository_id.is_empty() {
        return Err("Repository id is required".to_string());
    }

    let mut removed: Option<ManagedGitRepository> = None;
    with_repository_config_lock(|| {
        let mut repositories = read_managed_repositories_unlocked(home)?;
        let original_len = repositories.len();
        repositories.retain(|entry| {
            let keep = entry.id != repository_id;
            if !keep {
                removed = Some(entry.clone());
            }
            keep
        });
        if repositories.len() == original_len {
            return Err("Repository not found".to_string());
        }
        write_managed_repositories_unlocked(home, &repositories)
    })?;

    if let Some(repository) = removed {
        if repository.sync_mode == GitSyncMode::Mirror && !repository.local_path.trim().is_empty() {
            let path = PathBuf::from(&repository.local_path);
            let root = managed_repositories_root(home);
            if path.exists() && is_sub_path(&root, &path) {
                fs::remove_dir_all(&path).map_err(|e| {
                    format!(
                        "Remove managed mirror repository failed ({}): {e}",
                        path.to_string_lossy()
                    )
                })?;
            }
        }
    }

    Ok(())
}

pub fn update_managed_repository_alias(
    home: &Path,
    repository_id: &str,
    alias: Option<String>,
) -> Result<ManagedGitRepository, String> {
    let repository_id = repository_id.trim();
    if repository_id.is_empty() {
        return Err("Repository id is required".to_string());
    }
    let alias = normalize_repository_alias(alias);

    with_repository_config_lock(|| {
        let mut repositories = read_managed_repositories_unlocked(home)?;
        let repository = repositories
            .iter_mut()
            .find(|entry| entry.id == repository_id)
            .ok_or_else(|| "Repository not found".to_string())?;

        repository.alias = alias.clone();
        let updated = repository.clone();
        write_managed_repositories_unlocked(home, &repositories)?;
        Ok(updated)
    })
}

pub fn update_managed_repository_sync_path(
    home: &Path,
    repository_id: &str,
    sync_path: Option<String>,
) -> Result<ManagedGitRepository, String> {
    let repository_id = repository_id.trim();
    if repository_id.is_empty() {
        return Err("Repository id is required".to_string());
    }

    let resolved_sync_path = resolve_source_path(home, sync_path)?;
    let normalized_sync_path = path_to_string(&resolved_sync_path);

    with_repository_config_lock(|| {
        let mut repositories = read_managed_repositories_unlocked(home)?;
        let repository = repositories
            .iter_mut()
            .find(|entry| entry.id == repository_id)
            .ok_or_else(|| "Repository not found".to_string())?;

        repository.source_path = normalized_sync_path.clone();
        if repository.sync_mode == GitSyncMode::Direct {
            repository.local_path = normalized_sync_path.clone();
        }

        let updated = repository.clone();
        write_managed_repositories_unlocked(home, &repositories)?;
        Ok(updated)
    })
}

pub fn update_managed_repository_ignored_paths(
    home: &Path,
    repository_id: &str,
    ignore_paths: Vec<String>,
) -> Result<GitUpdateIgnoreResult, String> {
    let repository_id = repository_id.trim();
    if repository_id.is_empty() {
        return Err("Repository id is required".to_string());
    }

    let mut updated = with_repository_config_lock(|| {
        let mut repositories = read_managed_repositories_unlocked(home)?;
        let repository = repositories
            .iter_mut()
            .find(|entry| entry.id == repository_id)
            .ok_or_else(|| "Repository not found".to_string())?;
        let source_root = resolve_source_path(home, Some(repository.source_path.clone()))?;
        repository.ignore_paths = normalize_repository_ignore_paths(&source_root, &ignore_paths);
        let updated = repository.clone();
        write_managed_repositories_unlocked(home, &repositories)?;
        Ok(updated)
    })?;

    let repository_root = PathBuf::from(&updated.local_path);
    git2::Repository::open(&repository_root)
        .map_err(|e| format!("Target path is not a git repository: {e}"))?;
    write_repository_gitignore_managed_block(&repository_root, &updated.ignore_paths)?;

    let mut sync_result = None;
    if updated.sync_mode == GitSyncMode::Mirror {
        let source_root = resolve_source_path(home, Some(updated.source_path.clone()))?;
        match sync_skills_dir_to_repository_with_ignores(
            &source_root,
            &repository_root,
            &updated.ignore_paths,
        ) {
            Ok(result) => {
                updated.last_sync_at = Some(now_rfc3339());
                updated.last_sync_error = None;
                sync_result = Some(result);
            }
            Err(err) => {
                updated.last_sync_error = Some(err.clone());
                update_repository_record(home, &updated)?;
                return Err(err);
            }
        }
    }

    update_repository_record(home, &updated)?;
    Ok(GitUpdateIgnoreResult {
        repository: updated,
        sync_result,
    })
}

pub fn add_repository_and_sync(
    home: &Path,
    url: &str,
    alias: Option<String>,
    script_after_add: Option<String>,
    sync_mode: GitSyncMode,
    source_path: Option<String>,
    local_path: Option<String>,
) -> Result<ManagedGitRepository, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("Repository URL is required".to_string());
    }

    let normalized_alias = normalize_repository_alias(alias);
    let normalized_script = script_after_add
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let normalized_source_path = source_path
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let normalized_local_path = local_path
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let source_root = resolve_source_path(home, normalized_source_path.clone())?;
    let direct_local = if sync_mode == GitSyncMode::Direct {
        Some(resolve_direct_local_path(
            &source_root,
            normalized_local_path.clone(),
        )?)
    } else {
        None
    };

    let mut record = with_repository_config_lock(|| {
        let mut repositories = read_managed_repositories_unlocked(home)?;
        let name = infer_repository_name(url);
        let id = build_repository_id(&name);
        let local_path = match sync_mode {
            GitSyncMode::Direct => path_to_string(
                direct_local
                    .as_ref()
                    .expect("direct local path should be resolved"),
            ),
            GitSyncMode::Mirror => {
                if let Some(path) = normalized_local_path
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    path_to_string(&normalize_for_storage(&normalize_input_path(path)?))
                } else {
                    path_to_string(&pick_local_repository_path(home, &name, &repositories))
                }
            }
        };

        if repositories
            .iter()
            .any(|entry| entry.url == url && entry.local_path == local_path)
        {
            return Err("Repository already exists".to_string());
        }

        let record = ManagedGitRepository {
            id,
            name,
            alias: normalized_alias.clone(),
            url: url.to_string(),
            provider: infer_repository_provider(url),
            sync_mode: sync_mode.clone(),
            source_path: path_to_string(&source_root),
            local_path,
            is_syncing: true,
            last_sync_at: None,
            last_sync_error: None,
            script_after_add: normalized_script.clone(),
            ignore_paths: Vec::new(),
        };
        repositories.push(record.clone());
        write_managed_repositories_unlocked(home, &repositories)?;
        Ok(record)
    })?;

    let sync_result = match record.sync_mode {
        GitSyncMode::Direct => {
            setup_direct_repository(&record.url, Path::new(&record.local_path))?;
            run_post_add_script(Path::new(&record.local_path), normalized_script.as_deref())
        }
        GitSyncMode::Mirror => {
            clone_or_fetch_repository(&record.url, Path::new(&record.local_path))?;
            run_post_add_script(Path::new(&record.local_path), normalized_script.as_deref())
        }
    };

    record.is_syncing = false;
    record.last_sync_at = Some(now_rfc3339());
    record.last_sync_error = sync_result.as_ref().err().cloned();
    update_repository_record(home, &record)?;
    sync_result?;

    Ok(record)
}

fn should_skip_sync_entry(name: &str) -> bool {
    name.starts_with('.')
}

fn should_skip_sync_tree_entry(name: &str) -> bool {
    name == ".git"
}

fn normalize_relative_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn normalize_sync_relative_path(raw: &str) -> Option<String> {
    let normalized = raw
        .trim()
        .replace('\\', "/")
        .trim_start_matches("./")
        .trim_matches('/')
        .to_string();
    if normalized.is_empty() {
        return None;
    }
    if normalized
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return None;
    }
    Some(normalized)
}

fn normalize_ignore_rule(raw: &str) -> Option<String> {
    let has_dir_suffix = raw.trim().ends_with('/') || raw.trim().ends_with('\\');
    let mut normalized = normalize_sync_relative_path(raw)?;
    if has_dir_suffix {
        normalized.push('/');
    }
    Some(normalized)
}

#[derive(Debug, Clone, Default)]
struct IgnoreMatcher {
    exact_paths: HashSet<String>,
    dir_prefixes: Vec<String>,
}

impl IgnoreMatcher {
    fn from_rules(ignore_paths: &[String]) -> Self {
        let mut exact_paths = HashSet::new();
        let mut dir_prefixes = Vec::new();
        for rule in ignore_paths {
            let Some(normalized) = normalize_ignore_rule(rule) else {
                continue;
            };
            if normalized.ends_with('/') {
                dir_prefixes.push(normalized);
            } else {
                exact_paths.insert(normalized);
            }
        }
        dir_prefixes.sort();
        dir_prefixes.dedup();
        Self {
            exact_paths,
            dir_prefixes,
        }
    }

    fn matches(&self, relative_path: &str) -> bool {
        let Some(normalized) = normalize_sync_relative_path(relative_path) else {
            return false;
        };
        if self.exact_paths.contains(&normalized) {
            return true;
        }
        self.dir_prefixes.iter().any(|prefix| {
            let trimmed = prefix.trim_end_matches('/');
            normalized == trimmed || normalized.starts_with(prefix)
        })
    }
}

fn relative_to_path(root: &Path, relative: &str) -> PathBuf {
    root.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR))
}

fn normalize_repository_ignore_paths(source_root: &Path, ignore_paths: &[String]) -> Vec<String> {
    let mut normalized_paths = Vec::<String>::new();
    for raw in ignore_paths {
        let Some(mut normalized) = normalize_ignore_rule(raw) else {
            continue;
        };
        let had_dir_suffix = normalized.ends_with('/');
        if had_dir_suffix {
            normalized = normalized.trim_end_matches('/').to_string();
        }
        if normalized.is_empty() {
            continue;
        }
        let source_entry_path = relative_to_path(source_root, &normalized);
        let is_dir = had_dir_suffix || source_entry_path.is_dir();
        let final_rule = if is_dir {
            format!("{normalized}/")
        } else {
            normalized
        };
        if !normalized_paths.iter().any(|item| item == &final_rule) {
            normalized_paths.push(final_rule);
        }
    }
    normalized_paths.sort();
    normalized_paths
}

fn directory_has_visible_children(path: &Path) -> Result<bool, String> {
    let entries = fs::read_dir(path).map_err(|e| format!("Read directory failed: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Read directory entry failed: {e}"))?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if should_skip_sync_tree_entry(&file_name) {
            continue;
        }
        return Ok(true);
    }
    Ok(false)
}

fn list_sync_tree_entries(
    source_root: &Path,
    ignore_paths: &[String],
    parent_relative_path: Option<String>,
) -> Result<Vec<GitSyncTreeEntry>, String> {
    let source_root = fs::canonicalize(source_root)
        .map_err(|e| format!("Resolve skills source path failed: {e}"))?;
    let parent_relative_path = parent_relative_path
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    let normalized_parent = if parent_relative_path.is_empty() {
        String::new()
    } else {
        normalize_sync_relative_path(&parent_relative_path)
            .ok_or_else(|| "Invalid parent_relative_path".to_string())?
    };
    let parent_path = if normalized_parent.is_empty() {
        source_root.clone()
    } else {
        relative_to_path(&source_root, &normalized_parent)
    };
    let parent_path = fs::canonicalize(&parent_path)
        .map_err(|e| format!("Resolve parent directory failed: {e}"))?;
    if !parent_path.starts_with(&source_root) {
        return Err("parent_relative_path escapes source root".to_string());
    }
    if !parent_path.is_dir() {
        return Err(format!(
            "parent_relative_path is not a directory: {}",
            parent_path.to_string_lossy()
        ));
    }

    let ignore_matcher = IgnoreMatcher::from_rules(ignore_paths);
    let mut result = Vec::<GitSyncTreeEntry>::new();
    let entries = fs::read_dir(&parent_path).map_err(|e| format!("Read directory failed: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Read directory entry failed: {e}"))?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if should_skip_sync_tree_entry(&file_name) {
            continue;
        }
        let path = entry.path();
        let rel = path
            .strip_prefix(&source_root)
            .map_err(|e| format!("Resolve relative path failed: {e}"))?;
        let rel_normalized = normalize_relative_path(rel);
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Read file type failed: {e}"))?;
        let is_dir = file_type.is_dir();
        let has_children = if is_dir {
            directory_has_visible_children(&path)?
        } else {
            false
        };
        result.push(GitSyncTreeEntry {
            relative_path: rel_normalized.clone(),
            name: file_name,
            entry_type: if is_dir {
                "dir".to_string()
            } else {
                "file".to_string()
            },
            has_children,
            ignored: ignore_matcher.matches(&rel_normalized),
        });
    }
    result.sort_by(
        |a, b| match (a.entry_type.as_str(), b.entry_type.as_str()) {
            ("dir", "file") => std::cmp::Ordering::Less,
            ("file", "dir") => std::cmp::Ordering::Greater,
            _ => a
                .name
                .to_ascii_lowercase()
                .cmp(&b.name.to_ascii_lowercase())
                .then_with(|| a.name.cmp(&b.name)),
        },
    );
    Ok(result)
}

fn read_repository_by_id(home: &Path, repository_id: &str) -> Result<ManagedGitRepository, String> {
    with_repository_config_lock(|| {
        let repositories = read_managed_repositories_unlocked(home)?;
        repositories
            .into_iter()
            .find(|entry| entry.id == repository_id)
            .ok_or_else(|| "Repository not found".to_string())
    })
}

fn path_equivalent(left: &Path, right: &Path) -> bool {
    let left = fs::canonicalize(left).unwrap_or_else(|_| left.to_path_buf());
    let right = fs::canonicalize(right).unwrap_or_else(|_| right.to_path_buf());
    left == right
}

fn write_repository_gitignore_managed_block(
    repository_root: &Path,
    ignore_paths: &[String],
) -> Result<(), String> {
    let gitignore_path = repository_root.join(".gitignore");
    let existing_raw = if gitignore_path.exists() {
        fs::read_to_string(&gitignore_path).map_err(|e| {
            format!(
                "Read .gitignore failed ({}): {e}",
                gitignore_path.to_string_lossy()
            )
        })?
    } else {
        String::new()
    };
    let newline = if existing_raw.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let normalized_existing = existing_raw.replace("\r\n", "\n");
    let mut kept_lines = Vec::<String>::new();
    let mut in_managed_block = false;
    for line in normalized_existing.lines() {
        let trimmed = line.trim();
        if trimmed == GITIGNORE_MANAGED_START {
            in_managed_block = true;
            continue;
        }
        if trimmed == GITIGNORE_MANAGED_END {
            in_managed_block = false;
            continue;
        }
        if !in_managed_block {
            kept_lines.push(line.to_string());
        }
    }
    while kept_lines.last().is_some_and(|line| line.trim().is_empty()) {
        kept_lines.pop();
    }

    let mut output_lines = kept_lines;
    if !ignore_paths.is_empty() {
        if !output_lines.is_empty() {
            output_lines.push(String::new());
        }
        output_lines.push(GITIGNORE_MANAGED_START.to_string());
        for rule in ignore_paths {
            output_lines.push(rule.clone());
        }
        output_lines.push(GITIGNORE_MANAGED_END.to_string());
    }
    let mut output = output_lines.join(newline);
    if !output.is_empty() {
        output.push_str(newline);
    }
    fs::write(&gitignore_path, output).map_err(|e| {
        format!(
            "Write .gitignore failed ({}): {e}",
            gitignore_path.to_string_lossy()
        )
    })
}

fn collect_relative_entries(
    root: &Path,
    dir: &Path,
    files: &mut HashSet<String>,
    dirs: &mut HashSet<String>,
    ignore_matcher: Option<&IgnoreMatcher>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("Read directory failed: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Read directory entry failed: {e}"))?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if should_skip_sync_entry(&file_name) {
            continue;
        }

        let path = entry.path();
        let rel = path
            .strip_prefix(root)
            .map_err(|e| format!("Resolve relative path failed: {e}"))?;
        let rel_normalized = normalize_relative_path(rel);
        if ignore_matcher.is_some_and(|matcher| matcher.matches(&rel_normalized)) {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Read file type failed: {e}"))?;

        if file_type.is_dir() {
            dirs.insert(rel_normalized);
            collect_relative_entries(root, &path, files, dirs, ignore_matcher)?;
        } else {
            files.insert(rel_normalized);
        }
    }
    Ok(())
}

pub fn sync_skills_dir_to_repository(
    source_root: &Path,
    target_repo_root: &Path,
) -> Result<GitSkillsSyncResult, String> {
    sync_skills_dir_to_repository_with_ignores(source_root, target_repo_root, &[])
}

pub fn sync_skills_dir_to_repository_with_ignores(
    source_root: &Path,
    target_repo_root: &Path,
    ignore_paths: &[String],
) -> Result<GitSkillsSyncResult, String> {
    if !source_root.exists() {
        return Err(format!(
            "Skills source directory does not exist: {}",
            source_root.to_string_lossy()
        ));
    }
    if !source_root.is_dir() {
        return Err(format!(
            "Skills source path is not a directory: {}",
            source_root.to_string_lossy()
        ));
    }
    git2::Repository::open(target_repo_root)
        .map_err(|e| format!("Target path is not a git repository: {e}"))?;

    let source_root = fs::canonicalize(source_root)
        .map_err(|e| format!("Resolve skills source path failed: {e}"))?;
    let target_repo_root = fs::canonicalize(target_repo_root)
        .map_err(|e| format!("Resolve target repository path failed: {e}"))?;

    if source_root == target_repo_root {
        return Err("Skills source and target repository cannot be the same directory".to_string());
    }

    let normalized_ignore_paths = normalize_repository_ignore_paths(&source_root, ignore_paths);
    let ignore_matcher = IgnoreMatcher::from_rules(&normalized_ignore_paths);
    let mut source_files = HashSet::<String>::new();
    let mut source_dirs = HashSet::<String>::new();
    collect_relative_entries(
        &source_root,
        &source_root,
        &mut source_files,
        &mut source_dirs,
        Some(&ignore_matcher),
    )?;

    let mut target_files = HashSet::<String>::new();
    let mut target_dirs = HashSet::<String>::new();
    collect_relative_entries(
        &target_repo_root,
        &target_repo_root,
        &mut target_files,
        &mut target_dirs,
        None,
    )?;

    let mut removed_entries = 0usize;
    let stale_files: Vec<String> = target_files.difference(&source_files).cloned().collect();
    for rel in stale_files {
        let stale_path = relative_to_path(&target_repo_root, &rel);
        fs::remove_file(&stale_path).map_err(|e| {
            format!(
                "Remove stale file failed ({}): {e}",
                stale_path.to_string_lossy()
            )
        })?;
        removed_entries += 1;
    }

    let mut stale_dirs: Vec<String> = target_dirs.difference(&source_dirs).cloned().collect();
    stale_dirs.sort_by(|a, b| b.cmp(a));
    for rel in stale_dirs {
        let stale_dir = relative_to_path(&target_repo_root, &rel);
        fs::remove_dir_all(&stale_dir).map_err(|e| {
            format!(
                "Remove stale directory failed ({}): {e}",
                stale_dir.to_string_lossy()
            )
        })?;
        removed_entries += 1;
    }

    let mut source_dir_list: Vec<String> = source_dirs.into_iter().collect();
    source_dir_list.sort();
    for rel in source_dir_list {
        let target_dir = relative_to_path(&target_repo_root, &rel);
        fs::create_dir_all(&target_dir).map_err(|e| {
            format!(
                "Create target directory failed ({}): {e}",
                target_dir.to_string_lossy()
            )
        })?;
    }

    let mut source_file_list: Vec<String> = source_files.into_iter().collect();
    source_file_list.sort();
    let mut copied_files = 0usize;
    for rel in source_file_list {
        let source_file = relative_to_path(&source_root, &rel);
        let target_file = relative_to_path(&target_repo_root, &rel);
        if let Some(parent) = target_file.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Create target parent directory failed ({}): {e}",
                    parent.to_string_lossy()
                )
            })?;
        }
        fs::copy(&source_file, &target_file).map_err(|e| {
            format!(
                "Copy source file failed ({} -> {}): {e}",
                source_file.to_string_lossy(),
                target_file.to_string_lossy()
            )
        })?;
        copied_files += 1;
    }

    Ok(GitSkillsSyncResult {
        source_path: source_root.to_string_lossy().to_string(),
        target_path: target_repo_root.to_string_lossy().to_string(),
        copied_files,
        removed_entries,
    })
}

fn push_unique(list: &mut Vec<String>, value: String) {
    if !list.iter().any(|item| item == &value) {
        list.push(value);
    }
}

fn format_short_hash(hash: &str) -> String {
    hash.chars().take(8).collect()
}

fn format_git_time(time: git2::Time) -> String {
    let Some(utc_time) = chrono::DateTime::<chrono::Utc>::from_timestamp(time.seconds(), 0) else {
        return String::new();
    };

    let offset_seconds = time.offset_minutes().saturating_mul(60);
    if let Some(offset) = chrono::FixedOffset::east_opt(offset_seconds) {
        utc_time.with_timezone(&offset).to_rfc3339()
    } else {
        utc_time.to_rfc3339()
    }
}

fn resolve_upstream_oid(repo: &git2::Repository, branch_name: Option<&str>) -> Option<git2::Oid> {
    let branch_name = branch_name?;
    let local_branch = repo
        .find_branch(branch_name, git2::BranchType::Local)
        .ok()?;
    let upstream = local_branch.upstream().ok()?;
    upstream.into_reference().target()
}

fn resolve_origin_upstream_branch_name(
    repo: &git2::Repository,
    local_branch: &str,
) -> Option<String> {
    let local_branch = repo
        .find_branch(local_branch, git2::BranchType::Local)
        .ok()?;
    let upstream = local_branch.upstream().ok()?;
    let upstream_name = upstream.name().ok().flatten()?;
    let (remote_name, branch_name) = upstream_name.split_once('/')?;
    if remote_name != "origin" || branch_name.trim().is_empty() {
        return None;
    }
    Some(branch_name.to_string())
}

fn has_origin_tracking_branch(repo: &git2::Repository, branch_name: &str) -> bool {
    repo.find_reference(&format!("refs/remotes/origin/{branch_name}"))
        .is_ok()
}

fn resolve_origin_default_branch_name(repo: &git2::Repository) -> Option<String> {
    let origin_head = repo.find_reference("refs/remotes/origin/HEAD").ok()?;
    let symbolic_target = origin_head.symbolic_target()?;
    symbolic_target
        .strip_prefix("refs/remotes/origin/")
        .map(|name| name.to_string())
}

fn resolve_push_target_branch(repo: &git2::Repository, local_branch: &str) -> String {
    if let Some(upstream_branch) = resolve_origin_upstream_branch_name(repo, local_branch) {
        return upstream_branch;
    }
    if has_origin_tracking_branch(repo, local_branch) {
        return local_branch.to_string();
    }

    if matches!(local_branch, "main" | "master") {
        if let Some(default_branch) = resolve_origin_default_branch_name(repo) {
            return default_branch;
        }
        let alternate = if local_branch == "main" {
            "master"
        } else {
            "main"
        };
        if has_origin_tracking_branch(repo, alternate) {
            return alternate.to_string();
        }
    }

    local_branch.to_string()
}

fn is_commit_pushed(
    repo: &git2::Repository,
    commit_oid: git2::Oid,
    upstream_oid: Option<git2::Oid>,
) -> bool {
    let Some(upstream_oid) = upstream_oid else {
        return false;
    };
    if upstream_oid == commit_oid {
        return true;
    }
    repo.graph_descendant_of(upstream_oid, commit_oid)
        .unwrap_or(false)
}

fn collect_commit_ref_labels(repo: &git2::Repository) -> HashMap<git2::Oid, Vec<String>> {
    let mut labels = HashMap::<git2::Oid, Vec<String>>::new();

    if let Ok(head) = repo.head() {
        if let Some(oid) = head.target() {
            if let Some(name) = head.shorthand() {
                push_unique(labels.entry(oid).or_default(), format!("HEAD -> {name}"));
            } else {
                push_unique(labels.entry(oid).or_default(), "HEAD".to_string());
            }
        }
    }

    if let Ok(branches) = repo.branches(None) {
        for branch in branches.flatten() {
            let (branch_ref, branch_type) = branch;
            let Some(oid) = branch_ref.get().target() else {
                continue;
            };
            let Ok(Some(name)) = branch_ref.name() else {
                continue;
            };
            let label = match branch_type {
                git2::BranchType::Local => name.to_string(),
                git2::BranchType::Remote => name.to_string(),
            };
            push_unique(labels.entry(oid).or_default(), label);
        }
    }

    if let Ok(tag_names) = repo.tag_names(None) {
        for tag_name in tag_names.iter().flatten() {
            let full_ref = format!("refs/tags/{tag_name}");
            let Ok(object) = repo.revparse_single(&full_ref) else {
                continue;
            };
            let Ok(commit) = object.peel_to_commit() else {
                continue;
            };
            push_unique(
                labels.entry(commit.id()).or_default(),
                format!("tag: {tag_name}"),
            );
        }
    }

    labels
}

fn collect_recent_commits(
    repo: &git2::Repository,
    head_oid: Option<git2::Oid>,
    upstream_oid: Option<git2::Oid>,
    limit: usize,
) -> Result<Vec<GitRecentCommit>, String> {
    let Some(head_oid) = head_oid else {
        return Ok(Vec::new());
    };
    if limit == 0 {
        return Ok(Vec::new());
    }

    let mut walk = repo
        .revwalk()
        .map_err(|e| format!("Create git revision walk failed: {e}"))?;
    walk.push(head_oid)
        .map_err(|e| format!("Walk git commits failed: {e}"))?;
    let _ = walk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME);

    let mut commits = Vec::new();
    for oid in walk.take(limit) {
        let oid = oid.map_err(|e| format!("Read git revision entry failed: {e}"))?;
        let commit = repo
            .find_commit(oid)
            .map_err(|e| format!("Read git commit failed: {e}"))?;
        let hash = oid.to_string();
        commits.push(GitRecentCommit {
            short_hash: format_short_hash(&hash),
            hash,
            summary: commit.summary().unwrap_or("(no message)").to_string(),
            author_name: commit.author().name().unwrap_or("unknown").to_string(),
            authored_at: format_git_time(commit.time()),
            is_pushed: is_commit_pushed(repo, oid, upstream_oid),
        });
    }
    Ok(commits)
}

fn collect_commit_history(
    repo: &git2::Repository,
    head_oid: Option<git2::Oid>,
    upstream_oid: Option<git2::Oid>,
    limit: usize,
) -> Result<Vec<GitGraphCommit>, String> {
    let Some(head_oid) = head_oid else {
        return Ok(Vec::new());
    };
    if limit == 0 {
        return Ok(Vec::new());
    }

    let mut walk = repo
        .revwalk()
        .map_err(|e| format!("Create git revision walk failed: {e}"))?;
    walk.push(head_oid)
        .map_err(|e| format!("Walk git commits failed: {e}"))?;
    let _ = walk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME);

    let ref_labels = collect_commit_ref_labels(repo);
    let mut commits = Vec::<GitGraphCommit>::new();
    for oid in walk.take(limit) {
        let oid = oid.map_err(|e| format!("Read git revision entry failed: {e}"))?;
        let commit = repo
            .find_commit(oid)
            .map_err(|e| format!("Read git commit failed: {e}"))?;
        let hash = oid.to_string();
        let parent_hashes = commit.parent_ids().map(|id| id.to_string()).collect();
        let refs = ref_labels.get(&oid).cloned().unwrap_or_default();
        commits.push(GitGraphCommit {
            short_hash: format_short_hash(&hash),
            hash,
            summary: commit.summary().unwrap_or("(no message)").to_string(),
            author_name: commit.author().name().unwrap_or("unknown").to_string(),
            authored_at: format_git_time(commit.time()),
            is_pushed: is_commit_pushed(repo, oid, upstream_oid),
            refs,
            parent_hashes,
        });
    }
    Ok(commits)
}

pub fn get_git_status(root: &Path) -> Result<GitStatusResult, String> {
    let repo =
        git2::Repository::open(root).map_err(|e| format!("Open git repository failed: {e}"))?;

    let head_ref = repo.head().ok();
    let branch = head_ref
        .as_ref()
        .and_then(|head| head.shorthand().map(|name| name.to_string()))
        .unwrap_or_else(|| "HEAD".to_string());
    let head_oid = head_ref.as_ref().and_then(|head| head.target());
    let branch_name = head_ref.as_ref().and_then(|head| head.shorthand());
    let upstream_oid = resolve_upstream_oid(&repo, branch_name);

    let mut changed = Vec::<String>::new();
    let mut staged = Vec::<String>::new();
    let mut not_added = Vec::<String>::new();

    let mut options = git2::StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    let statuses = repo
        .statuses(Some(&mut options))
        .map_err(|e| format!("Read git status failed: {e}"))?;

    for entry in statuses.iter() {
        let Some(path) = entry.path() else {
            continue;
        };
        let path = path.to_string();
        let status = entry.status();

        if status.contains(git2::Status::WT_NEW) {
            push_unique(&mut not_added, path.clone());
        }

        if status.intersects(
            git2::Status::INDEX_NEW
                | git2::Status::INDEX_MODIFIED
                | git2::Status::INDEX_DELETED
                | git2::Status::INDEX_RENAMED
                | git2::Status::INDEX_TYPECHANGE,
        ) {
            push_unique(&mut staged, path.clone());
        }

        if status.intersects(
            git2::Status::WT_MODIFIED
                | git2::Status::WT_DELETED
                | git2::Status::WT_RENAMED
                | git2::Status::WT_TYPECHANGE,
        ) {
            push_unique(&mut changed, path);
        }
    }

    changed.sort();
    staged.sort();
    not_added.sort();

    let (ahead, behind) = {
        let mut result = (0usize, 0usize);
        if let (Some(local_oid), Some(upstream_oid)) = (head_oid, upstream_oid) {
            if let Ok((ahead, behind)) = repo.graph_ahead_behind(local_oid, upstream_oid) {
                result = (ahead, behind);
            }
        }
        result
    };

    let recent_commits = collect_recent_commits(&repo, head_oid, upstream_oid, 3)?;
    let latest_commit_hash = recent_commits.first().map(|entry| entry.hash.clone());
    let latest_pushed_hash = recent_commits
        .iter()
        .find(|entry| entry.is_pushed)
        .map(|entry| entry.hash.clone());

    Ok(GitStatusResult {
        branch,
        changed,
        staged,
        not_added,
        ahead,
        behind,
        recent_commits,
        latest_commit_hash,
        latest_pushed_hash,
    })
}

pub fn get_git_commit_history(root: &Path, limit: usize) -> Result<Vec<GitGraphCommit>, String> {
    let repo =
        git2::Repository::open(root).map_err(|e| format!("Open git repository failed: {e}"))?;
    let head_ref = repo.head().ok();
    let head_oid = head_ref.as_ref().and_then(|head| head.target());
    let branch_name = head_ref.as_ref().and_then(|head| head.shorthand());
    let upstream_oid = resolve_upstream_oid(&repo, branch_name);
    collect_commit_history(&repo, head_oid, upstream_oid, limit)
}

pub fn commit_all(_root: &Path, _message: &str) -> Result<GitCommitResult, String> {
    let message = _message.trim();
    if message.is_empty() {
        return Err("Commit message is required".to_string());
    }

    let repo =
        git2::Repository::open(_root).map_err(|e| format!("Open git repository failed: {e}"))?;

    let mut status_options = git2::StatusOptions::new();
    status_options
        .include_untracked(true)
        .recurse_untracked_dirs(true);
    let statuses = repo
        .statuses(Some(&mut status_options))
        .map_err(|e| format!("Read git status failed: {e}"))?;
    if statuses.is_empty() {
        return Err("No changes to commit".to_string());
    }

    let mut index = repo
        .index()
        .map_err(|e| format!("Open git index failed: {e}"))?;
    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| format!("Stage files failed: {e}"))?;
    index
        .write()
        .map_err(|e| format!("Write git index failed: {e}"))?;

    let tree_oid = index
        .write_tree()
        .map_err(|e| format!("Write git tree failed: {e}"))?;
    let tree = repo
        .find_tree(tree_oid)
        .map_err(|e| format!("Read git tree failed: {e}"))?;

    let signature = repo
        .signature()
        .or_else(|_| git2::Signature::now("MySkills Manager", "noreply@myskills-manager.local"))
        .map_err(|e| format!("Build git signature failed: {e}"))?;

    let parent = repo
        .head()
        .ok()
        .and_then(|head| head.target())
        .and_then(|oid| repo.find_commit(oid).ok());

    let commit_oid = if let Some(parent) = parent.as_ref() {
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &[parent],
        )
        .map_err(|e| format!("Create git commit failed: {e}"))?
    } else {
        repo.commit(Some("HEAD"), &signature, &signature, message, &tree, &[])
            .map_err(|e| format!("Create initial git commit failed: {e}"))?
    };

    Ok(GitCommitResult {
        success: true,
        hash: commit_oid.to_string(),
    })
}

pub fn push_origin(_root: &Path) -> Result<GitPushResult, String> {
    let repo =
        git2::Repository::open(_root).map_err(|e| format!("Open git repository failed: {e}"))?;

    if repo.is_empty().unwrap_or(false) {
        return Err(
            "Repository has no commits yet. Commit your changes first, then push.".to_string(),
        );
    }

    let head = repo.head().map_err(|e| format!("Read HEAD failed: {e}"))?;
    let local_branch = head
        .shorthand()
        .ok_or_else(|| "Current HEAD is detached".to_string())?
        .to_string();
    let _ = fetch_origin(&repo);
    let target_branch = resolve_push_target_branch(&repo, &local_branch);

    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| format!("Find git remote 'origin' failed: {e}"))?;

    let mut push_options = git2::PushOptions::new();
    push_options.remote_callbacks(build_remote_callbacks_for_push(&repo)?);

    let refspec = format!("refs/heads/{local_branch}:refs/heads/{target_branch}");
    remote
        .push(&[&refspec], Some(&mut push_options))
        .map_err(|e| format!("Push to origin failed ({local_branch} -> {target_branch}): {e}"))?;

    if let Some(head_oid) = head.target() {
        let _ = repo.reference(
            &format!("refs/remotes/origin/{target_branch}"),
            head_oid,
            true,
            "update origin tracking ref after push",
        );
    }
    if let Ok(mut branch) = repo.find_branch(&local_branch, git2::BranchType::Local) {
        let _ = branch.set_upstream(Some(&format!("origin/{target_branch}")));
    }

    Ok(GitPushResult {
        success: true,
        error: None,
    })
}

#[cfg(target_os = "windows")]
fn normalize_path_for_system_open(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{}", stripped));
    }
    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }
    path.to_path_buf()
}

#[cfg(not(target_os = "windows"))]
fn normalize_path_for_system_open(path: &Path) -> PathBuf {
    path.to_path_buf()
}

fn open_directory_in_file_manager(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!(
            "Directory does not exist: {}",
            path.to_string_lossy()
        ));
    }
    if !path.is_dir() {
        return Err(format!(
            "Path is not a directory: {}",
            path.to_string_lossy()
        ));
    }

    let open_path = normalize_path_for_system_open(path);

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&open_path)
            .spawn()
            .map_err(|e| format!("Open directory failed: {e}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        #[cfg(target_os = "macos")]
        let mut command = {
            let mut command = Command::new("open");
            command.arg(&open_path);
            command
        };

        #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
        let mut command = {
            let mut command = Command::new("xdg-open");
            command.arg(&open_path);
            command
        };

        let status = command
            .status()
            .map_err(|e| format!("Open directory failed: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "Open directory command exited with code: {:?}",
                status.code()
            ))
        }
    }
}

fn open_url_in_browser(url: &str) -> Result<(), String> {
    let normalized_url = url.trim();
    if normalized_url.is_empty() {
        return Err("URL is required".to_string());
    }
    if !normalized_url.starts_with("http://") && !normalized_url.starts_with("https://") {
        return Err("Only http/https URLs are supported".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", normalized_url])
            .spawn()
            .map_err(|e| format!("Open URL failed: {e}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        #[cfg(target_os = "macos")]
        let mut command = {
            let mut command = Command::new("open");
            command.arg(normalized_url);
            command
        };

        #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
        let mut command = {
            let mut command = Command::new("xdg-open");
            command.arg(normalized_url);
            command
        };

        let status = command
            .status()
            .map_err(|e| format!("Open URL failed: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "Open URL command exited with code: {:?}",
                status.code()
            ))
        }
    }
}

fn resolve_repo_root(repo_path: Option<String>) -> PathBuf {
    if let Some(path) = repo_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return PathBuf::from(path);
    }
    crate::root_dir::default_root_dir()
}

#[tauri::command]
pub async fn git_sync_source_path() -> Result<String, String> {
    Ok(crate::root_dir::default_root_dir()
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
pub async fn git_get_guide_markdown() -> Result<GitGuideDocument, String> {
    let home = crate::root_dir::default_home_dir();
    let task = tauri::async_runtime::spawn_blocking(move || load_git_guide_markdown(&home));
    let joined = tokio::time::timeout(Duration::from_secs(15), task)
        .await
        .map_err(|_| "git_get_guide_markdown timed out after 15s".to_string())?;
    joined.map_err(|e| format!("Run git_get_guide_markdown task failed: {e}"))?
}

#[tauri::command]
pub async fn git_list_repositories() -> Result<Vec<ManagedGitRepository>, String> {
    let home = crate::root_dir::default_home_dir();
    let task = tauri::async_runtime::spawn_blocking(move || list_managed_repositories(&home));
    let joined = tokio::time::timeout(Duration::from_secs(15), task)
        .await
        .map_err(|_| "git_list_repositories timed out after 15s".to_string())?;
    joined.map_err(|e| format!("Run git_list_repositories task failed: {e}"))?
}

#[tauri::command]
pub async fn git_add_repository(
    url: String,
    alias: Option<String>,
    script_after_add: Option<String>,
    sync_mode: Option<String>,
    source_path: Option<String>,
    local_path: Option<String>,
) -> Result<ManagedGitRepository, String> {
    let mode = parse_sync_mode(sync_mode)?;
    let home = crate::root_dir::default_home_dir();
    let task = tauri::async_runtime::spawn_blocking(move || {
        add_repository_and_sync(
            &home,
            &url,
            alias,
            script_after_add,
            mode,
            source_path,
            local_path,
        )
    });
    let joined = tokio::time::timeout(Duration::from_secs(180), task)
        .await
        .map_err(|_| "git_add_repository timed out after 180s".to_string())?;
    joined.map_err(|e| format!("Run git_add_repository task failed: {e}"))?
}

#[tauri::command]
pub async fn git_remove_repository(repository_id: String) -> Result<bool, String> {
    let home = crate::root_dir::default_home_dir();
    let task = tauri::async_runtime::spawn_blocking(move || {
        remove_managed_repository(&home, &repository_id)
    });
    let joined = tokio::time::timeout(Duration::from_secs(30), task)
        .await
        .map_err(|_| "git_remove_repository timed out after 30s".to_string())?;
    joined
        .map_err(|e| format!("Run git_remove_repository task failed: {e}"))?
        .map(|_| true)
}

#[tauri::command]
pub async fn git_update_repository_alias(
    repository_id: String,
    alias: Option<String>,
) -> Result<ManagedGitRepository, String> {
    let home = crate::root_dir::default_home_dir();
    let task = tauri::async_runtime::spawn_blocking(move || {
        update_managed_repository_alias(&home, &repository_id, alias)
    });
    let joined = tokio::time::timeout(Duration::from_secs(30), task)
        .await
        .map_err(|_| "git_update_repository_alias timed out after 30s".to_string())?;
    joined.map_err(|e| format!("Run git_update_repository_alias task failed: {e}"))?
}

#[tauri::command]
pub async fn git_update_repository_sync_path(
    repository_id: String,
    sync_path: Option<String>,
) -> Result<ManagedGitRepository, String> {
    let home = crate::root_dir::default_home_dir();
    let task = tauri::async_runtime::spawn_blocking(move || {
        update_managed_repository_sync_path(&home, &repository_id, sync_path)
    });
    let joined = tokio::time::timeout(Duration::from_secs(30), task)
        .await
        .map_err(|_| "git_update_repository_sync_path timed out after 30s".to_string())?;
    joined.map_err(|e| format!("Run git_update_repository_sync_path task failed: {e}"))?
}

#[tauri::command]
pub async fn git_list_sync_tree(
    repository_id: String,
    parent_relative_path: Option<String>,
) -> Result<Vec<GitSyncTreeEntry>, String> {
    let repository_id = repository_id.trim().to_string();
    if repository_id.is_empty() {
        return Err("Repository id is required".to_string());
    }
    let home = crate::root_dir::default_home_dir();
    let task = tauri::async_runtime::spawn_blocking(move || {
        let repository = read_repository_by_id(&home, &repository_id)?;
        let source_root = resolve_source_path(&home, Some(repository.source_path.clone()))?;
        list_sync_tree_entries(&source_root, &repository.ignore_paths, parent_relative_path)
    });
    let joined = tokio::time::timeout(Duration::from_secs(60), task)
        .await
        .map_err(|_| "git_list_sync_tree timed out after 60s".to_string())?;
    joined.map_err(|e| format!("Run git_list_sync_tree task failed: {e}"))?
}

#[tauri::command]
pub async fn git_update_repository_ignored_paths(
    repository_id: String,
    ignore_paths: Vec<String>,
) -> Result<GitUpdateIgnoreResult, String> {
    let repository_id = repository_id.trim().to_string();
    if repository_id.is_empty() {
        return Err("Repository id is required".to_string());
    }
    let home = crate::root_dir::default_home_dir();
    let task = tauri::async_runtime::spawn_blocking(move || {
        update_managed_repository_ignored_paths(&home, &repository_id, ignore_paths)
    });
    let joined = tokio::time::timeout(Duration::from_secs(180), task)
        .await
        .map_err(|_| "git_update_repository_ignored_paths timed out after 180s".to_string())?;
    joined.map_err(|e| format!("Run git_update_repository_ignored_paths task failed: {e}"))?
}

#[tauri::command]
pub async fn git_open_directory(path: String) -> Result<bool, String> {
    let normalized_path = path.trim().to_string();
    if normalized_path.is_empty() {
        return Err("Path is required".to_string());
    }

    let task = tauri::async_runtime::spawn_blocking(move || {
        open_directory_in_file_manager(Path::new(&normalized_path))
    });
    let joined = tokio::time::timeout(Duration::from_secs(15), task)
        .await
        .map_err(|_| "git_open_directory timed out after 15s".to_string())?;
    joined
        .map_err(|e| format!("Run git_open_directory task failed: {e}"))?
        .map(|_| true)
}

#[tauri::command]
pub async fn git_open_url(url: String) -> Result<bool, String> {
    let normalized_url = url.trim().to_string();
    if normalized_url.is_empty() {
        return Err("URL is required".to_string());
    }

    let task = tauri::async_runtime::spawn_blocking(move || open_url_in_browser(&normalized_url));
    let joined = tokio::time::timeout(Duration::from_secs(15), task)
        .await
        .map_err(|_| "git_open_url timed out after 15s".to_string())?;
    joined
        .map_err(|e| format!("Run git_open_url task failed: {e}"))?
        .map(|_| true)
}

#[tauri::command]
pub async fn git_sync_skills_to_repo(
    repo_path: String,
    source_path: Option<String>,
) -> Result<GitSkillsSyncResult, String> {
    let repo_path = repo_path.trim().to_string();
    if repo_path.is_empty() {
        return Err("Repository path is required".to_string());
    }

    let home = crate::root_dir::default_home_dir();
    let source_root = resolve_source_path(&home, source_path)?;
    let target_repo_root = PathBuf::from(repo_path);
    let ignore_paths = with_repository_config_lock(|| {
        let repositories = read_managed_repositories_unlocked(&home)?;
        let resolved_target =
            fs::canonicalize(&target_repo_root).unwrap_or_else(|_| target_repo_root.clone());
        let matched = repositories.into_iter().find(|entry| {
            if entry.local_path.trim().is_empty() {
                return false;
            }
            path_equivalent(Path::new(&entry.local_path), &resolved_target)
        });
        Ok(matched.map(|entry| entry.ignore_paths).unwrap_or_default())
    })?;
    let task = tauri::async_runtime::spawn_blocking(move || {
        if ignore_paths.is_empty() {
            sync_skills_dir_to_repository(&source_root, &target_repo_root)
        } else {
            sync_skills_dir_to_repository_with_ignores(
                &source_root,
                &target_repo_root,
                &ignore_paths,
            )
        }
    });
    let joined = tokio::time::timeout(Duration::from_secs(180), task)
        .await
        .map_err(|_| "git_sync_skills_to_repo timed out after 180s".to_string())?;
    joined.map_err(|e| format!("Run git_sync_skills_to_repo task failed: {e}"))?
}

#[tauri::command]
pub async fn git_status(repo_path: Option<String>) -> Result<GitStatusResult, String> {
    let root = resolve_repo_root(repo_path);
    let task = tauri::async_runtime::spawn_blocking(move || get_git_status(&root));
    let joined = tokio::time::timeout(Duration::from_secs(15), task)
        .await
        .map_err(|_| "git_status timed out after 15s".to_string())?;
    joined.map_err(|e| format!("Run git_status task failed: {e}"))?
}

#[tauri::command]
pub async fn git_list_commit_history(
    repo_path: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<GitGraphCommit>, String> {
    let root = resolve_repo_root(repo_path);
    let limit = limit.unwrap_or(80).clamp(1, 200);
    let task = tauri::async_runtime::spawn_blocking(move || get_git_commit_history(&root, limit));
    let joined = tokio::time::timeout(Duration::from_secs(30), task)
        .await
        .map_err(|_| "git_list_commit_history timed out after 30s".to_string())?;
    joined.map_err(|e| format!("Run git_list_commit_history task failed: {e}"))?
}

#[tauri::command]
pub async fn git_commit(
    message: String,
    repo_path: Option<String>,
) -> Result<GitCommitResult, String> {
    let root = resolve_repo_root(repo_path);
    let task = tauri::async_runtime::spawn_blocking(move || commit_all(&root, &message));
    let joined = tokio::time::timeout(Duration::from_secs(30), task)
        .await
        .map_err(|_| "git_commit timed out after 30s".to_string())?;
    joined.map_err(|e| format!("Run git_commit task failed: {e}"))?
}

#[tauri::command]
pub async fn git_push(repo_path: Option<String>) -> Result<GitPushResult, String> {
    let root = resolve_repo_root(repo_path);
    let task = tauri::async_runtime::spawn_blocking(move || push_origin(&root));
    let joined = tokio::time::timeout(Duration::from_secs(120), task)
        .await
        .map_err(|_| "git_push timed out after 120s".to_string())?;
    joined.map_err(|e| format!("Run git_push task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use crate::test_utils::temp_root;
    use std::fs;
    use std::path::{Path, PathBuf};

    use super::*;

    fn init_repo(root: &Path) -> git2::Repository {
        fs::create_dir_all(root).expect("create root");
        git2::Repository::init(root).expect("init repo")
    }

    fn init_bare_repo(root: &Path) -> git2::Repository {
        fs::create_dir_all(root).expect("create root");
        git2::Repository::init_bare(root).expect("init bare repo")
    }

    fn ensure_local_branch_name(repo: &git2::Repository, target: &str) {
        let head = repo.head().expect("read head");
        let current = head.shorthand().unwrap_or("HEAD");
        if current == target {
            return;
        }

        let head_oid = head.target().expect("head oid");
        let commit = repo.find_commit(head_oid).expect("find head commit");
        if repo.find_branch(target, git2::BranchType::Local).is_err() {
            repo.branch(target, &commit, true)
                .expect("create local branch");
        }
        repo.set_head(&format!("refs/heads/{target}"))
            .expect("set local branch head");
    }

    #[test]
    fn get_git_status_returns_error_for_non_repo() {
        let root = temp_root("myskills-tauri-git-test");
        fs::create_dir_all(&root).expect("create root");

        let err = get_git_status(&root).expect_err("expected non-repo error");
        assert!(err.to_lowercase().contains("repository"));
    }

    #[test]
    fn get_git_status_reads_untracked_and_staged_files() {
        let root = temp_root("myskills-tauri-git-test");
        let repo = init_repo(&root);

        fs::write(root.join("untracked.md"), "hello").expect("write untracked");
        fs::write(root.join("staged.md"), "hello").expect("write staged");
        let mut index = repo.index().expect("open index");
        index
            .add_path(Path::new("staged.md"))
            .expect("add staged file");
        index.write().expect("write index");

        let status = get_git_status(&root).expect("get git status");
        assert!(!status.branch.is_empty());
        assert!(status.not_added.iter().any(|file| file == "untracked.md"));
        assert!(status.staged.iter().any(|file| file == "staged.md"));
    }

    #[test]
    fn commit_all_creates_commit_and_returns_hash() {
        let root = temp_root("myskills-tauri-git-test");
        init_repo(&root);
        fs::write(root.join("note.md"), "hello").expect("write file");

        let result = commit_all(&root, "feat: add note").expect("commit");
        assert!(result.success);
        assert!(!result.hash.is_empty());
    }

    #[test]
    fn get_git_status_includes_recent_commit_and_latest_hash() {
        let root = temp_root("myskills-tauri-git-test");
        init_repo(&root);
        fs::write(root.join("note.md"), "hello").expect("write file");
        let committed = commit_all(&root, "feat: add note").expect("commit");

        let status = get_git_status(&root).expect("status");
        assert_eq!(status.latest_commit_hash, Some(committed.hash.clone()));
        assert!(status.latest_pushed_hash.is_none());
        assert_eq!(status.recent_commits.len(), 1);
        assert_eq!(status.recent_commits[0].hash, committed.hash);
        assert_eq!(status.recent_commits[0].short_hash.len(), 8);
        assert_eq!(status.recent_commits[0].summary, "feat: add note");
        assert!(!status.recent_commits[0].is_pushed);
    }

    #[test]
    fn get_git_status_marks_commit_as_pushed_when_upstream_contains_head() {
        let root = temp_root("myskills-tauri-git-test");
        let local = init_repo(&root);
        let remote_root = temp_root("myskills-tauri-git-test");
        init_bare_repo(&remote_root);

        let remote_path = remote_root
            .to_str()
            .expect("remote path utf8")
            .replace('\\', "/");
        local
            .remote("origin", &remote_path)
            .expect("add remote origin");

        fs::write(root.join("push.md"), "to remote").expect("write file");
        let commit_result = commit_all(&root, "feat: push").expect("commit");
        push_origin(&root).expect("push");

        let repo = git2::Repository::open(&root).expect("open local repo");
        let head = repo.head().expect("read head");
        let branch = head.shorthand().expect("branch name").to_string();
        let head_oid = head.target().expect("head oid");
        repo.reference(
            &format!("refs/remotes/origin/{branch}"),
            head_oid,
            true,
            "sync origin ref for status",
        )
        .expect("set origin ref");
        let mut local_branch = repo
            .find_branch(&branch, git2::BranchType::Local)
            .expect("find local branch");
        local_branch
            .set_upstream(Some(&format!("origin/{branch}")))
            .expect("set upstream");

        let status = get_git_status(&root).expect("status");
        assert_eq!(status.latest_pushed_hash, Some(commit_result.hash.clone()));
        assert_eq!(status.latest_commit_hash, Some(commit_result.hash));
        assert!(status
            .recent_commits
            .first()
            .map(|entry| entry.is_pushed)
            .unwrap_or(false));
    }

    #[test]
    fn get_git_commit_history_returns_refs_and_parent_hashes() {
        let root = temp_root("myskills-tauri-git-test");
        init_repo(&root);
        fs::write(root.join("first.md"), "first").expect("write first file");
        let first = commit_all(&root, "feat: first").expect("first commit");

        fs::write(root.join("second.md"), "second").expect("write second file");
        let second = commit_all(&root, "feat: second").expect("second commit");

        let history = get_git_commit_history(&root, 20).expect("history");
        assert!(history.len() >= 2);
        assert_eq!(history[0].hash, second.hash);
        assert_eq!(history[1].hash, first.hash);
        assert_eq!(history[0].parent_hashes.len(), 1);
        assert_eq!(history[1].parent_hashes.len(), 0);
        assert!(history[0].refs.iter().any(|label| label.contains("HEAD")));
    }

    #[test]
    fn push_origin_pushes_current_branch_to_remote() {
        let root = temp_root("myskills-tauri-git-test");
        let local = init_repo(&root);
        let remote_root = temp_root("myskills-tauri-git-test");
        init_bare_repo(&remote_root);

        let remote_path = remote_root
            .to_str()
            .expect("remote path utf8")
            .replace('\\', "/");
        local
            .remote("origin", &remote_path)
            .expect("add remote origin");

        fs::write(root.join("push.md"), "to remote").expect("write file");
        let commit_result = commit_all(&root, "feat: push").expect("commit");
        let push_result = push_origin(&root).expect("push");

        assert!(push_result.success);
        assert!(push_result.error.is_none());

        let local_repo = git2::Repository::open(&root).expect("open local repo");
        let branch = local_repo
            .head()
            .ok()
            .and_then(|head| head.shorthand().map(|name| name.to_string()))
            .expect("read branch");

        let remote_repo = git2::Repository::open_bare(&remote_root).expect("open bare remote");
        let ref_name = format!("refs/heads/{branch}");
        let remote_ref = remote_repo
            .find_reference(&ref_name)
            .expect("find remote branch");
        let remote_oid = remote_ref.target().expect("remote target");
        assert_eq!(remote_oid.to_string(), commit_result.hash);
    }

    #[test]
    fn push_origin_fails_with_clear_message_when_origin_missing() {
        let root = temp_root("myskills-tauri-git-test");
        init_repo(&root);
        fs::write(root.join("note.md"), "hello").expect("write file");
        commit_all(&root, "feat: init").expect("create commit");

        let err = push_origin(&root).expect_err("expected missing origin error");
        assert!(err.to_lowercase().contains("origin"));
    }

    #[test]
    fn push_origin_fails_with_helpful_message_when_repo_has_no_commit() {
        let root = temp_root("myskills-tauri-git-test");
        let local = init_repo(&root);
        let remote_root = temp_root("myskills-tauri-git-test");
        init_bare_repo(&remote_root);

        let remote_path = remote_root
            .to_str()
            .expect("remote path utf8")
            .replace('\\', "/");
        local
            .remote("origin", &remote_path)
            .expect("add remote origin");

        let err = push_origin(&root).expect_err("expected unborn branch push error");
        assert!(
            err.to_lowercase().contains("no commits"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn push_origin_uses_origin_upstream_branch_when_names_differ() {
        let root = temp_root("myskills-tauri-git-test");
        let local = init_repo(&root);
        fs::write(root.join("seed.md"), "seed").expect("write seed file");
        commit_all(&root, "feat: seed").expect("seed commit");
        ensure_local_branch_name(&local, "master");

        let remote_root = temp_root("myskills-tauri-git-test");
        init_bare_repo(&remote_root);
        let remote_path = remote_root
            .to_str()
            .expect("remote path utf8")
            .replace('\\', "/");
        local
            .remote("origin", &remote_path)
            .expect("add remote origin");

        let mut remote = local.find_remote("origin").expect("find origin");
        remote
            .push(&["refs/heads/master:refs/heads/main"], None)
            .expect("seed origin main");

        let local_repo = git2::Repository::open(&root).expect("open local repo");
        let seed_oid = local_repo
            .head()
            .ok()
            .and_then(|head| head.target())
            .expect("seed head oid");
        local_repo
            .reference(
                "refs/remotes/origin/main",
                seed_oid,
                true,
                "seed origin/main tracking ref",
            )
            .expect("seed origin tracking ref");
        let mut master_branch = local_repo
            .find_branch("master", git2::BranchType::Local)
            .expect("find master branch");
        master_branch
            .set_upstream(Some("origin/main"))
            .expect("set upstream");

        fs::write(root.join("next.md"), "next").expect("write next file");
        let second = commit_all(&root, "feat: next").expect("second commit");
        push_origin(&root).expect("push to upstream branch");

        let remote_repo = git2::Repository::open_bare(&remote_root).expect("open remote");
        let main_ref = remote_repo
            .find_reference("refs/heads/main")
            .expect("find remote main");
        assert_eq!(
            main_ref.target().expect("main target").to_string(),
            second.hash
        );
        assert!(remote_repo.find_reference("refs/heads/master").is_err());
    }

    #[test]
    fn push_origin_maps_local_master_to_remote_main_without_upstream() {
        let root = temp_root("myskills-tauri-git-test");
        let local = init_repo(&root);
        fs::write(root.join("seed.md"), "seed").expect("write seed file");
        commit_all(&root, "feat: seed").expect("seed commit");
        ensure_local_branch_name(&local, "master");

        let remote_root = temp_root("myskills-tauri-git-test");
        init_bare_repo(&remote_root);
        let remote_path = remote_root
            .to_str()
            .expect("remote path utf8")
            .replace('\\', "/");
        local
            .remote("origin", &remote_path)
            .expect("add remote origin");

        let mut remote = local.find_remote("origin").expect("find origin");
        remote
            .push(&["refs/heads/master:refs/heads/main"], None)
            .expect("seed origin main");

        let local_repo = git2::Repository::open(&root).expect("open local repo");
        if let Ok(mut branch) = local_repo.find_branch("master", git2::BranchType::Local) {
            let _ = branch.set_upstream(None);
        }

        fs::write(root.join("next.md"), "next").expect("write next file");
        let second = commit_all(&root, "feat: next").expect("second commit");
        push_origin(&root).expect("push with branch adaptation");

        let remote_repo = git2::Repository::open_bare(&remote_root).expect("open remote");
        let main_ref = remote_repo
            .find_reference("refs/heads/main")
            .expect("find remote main");
        assert_eq!(
            main_ref.target().expect("main target").to_string(),
            second.hash
        );
        assert!(remote_repo.find_reference("refs/heads/master").is_err());
    }

    fn init_repo_with_commit(root: &Path) {
        init_repo(root);
        fs::write(root.join("README.md"), "# source\n").expect("write source README");
        commit_all(root, "feat: seed source").expect("seed source commit");
    }

    fn script_for_sync_marker() -> String {
        if cfg!(target_os = "windows") {
            "echo synced> post-add.txt".to_string()
        } else {
            "echo synced > post-add.txt".to_string()
        }
    }

    fn repo_path_from_record(record: &ManagedGitRepository) -> PathBuf {
        PathBuf::from(&record.local_path)
    }

    #[test]
    fn add_repository_and_sync_clones_repo_and_runs_post_add_script() {
        let home = temp_root("myskills-tauri-git-home");
        let source = temp_root("myskills-tauri-git-source");
        init_repo_with_commit(&source);

        let added = add_repository_and_sync(
            &home,
            source.to_str().expect("source path utf8"),
            Some("skills-main".to_string()),
            Some(script_for_sync_marker()),
            GitSyncMode::Mirror,
            Some(source.to_string_lossy().to_string()),
            None,
        )
        .expect("add repository");

        assert!(!added.id.is_empty());
        assert!(added.name.contains("myskills-tauri-git-source"));
        assert_eq!(added.alias, Some("skills-main".to_string()));
        assert_eq!(added.sync_mode, GitSyncMode::Mirror);
        assert_eq!(added.provider, GitProvider::Other);
        assert!(!added.is_syncing);
        assert!(added.last_sync_error.is_none());
        assert!(added.last_sync_at.is_some());

        let local_path = repo_path_from_record(&added);
        assert!(local_path.join(".git").exists());
        assert!(local_path.join("post-add.txt").exists());

        let listed = list_managed_repositories(&home).expect("list repositories");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].url, source.to_string_lossy());
        assert_eq!(listed[0].local_path, added.local_path);
        assert_eq!(listed[0].source_path, added.source_path);
        assert_eq!(listed[0].sync_mode, GitSyncMode::Mirror);
        assert_eq!(listed[0].alias, Some("skills-main".to_string()));
        assert_eq!(listed[0].script_after_add, added.script_after_add);
        assert!(!listed[0].is_syncing);
    }

    #[test]
    fn add_repository_and_sync_direct_mode_uses_selected_local_folder() {
        let home = temp_root("myskills-tauri-git-home");
        let working = temp_root("myskills-tauri-git-working");
        fs::create_dir_all(&working).expect("create working directory");
        fs::write(working.join("README.md"), "hello").expect("write local file");

        let remote_root = temp_root("myskills-tauri-git-remote");
        init_bare_repo(&remote_root);
        let remote_url = remote_root
            .to_str()
            .expect("remote path utf8")
            .replace('\\', "/");

        let added = add_repository_and_sync(
            &home,
            &remote_url,
            None,
            None,
            GitSyncMode::Direct,
            Some(working.to_string_lossy().to_string()),
            Some(working.to_string_lossy().to_string()),
        )
        .expect("add direct repository");

        let canonical_working = fs::canonicalize(&working).expect("canonical working");
        let canonical_working_str = canonical_working.to_string_lossy().to_string();
        assert_eq!(added.sync_mode, GitSyncMode::Direct);
        assert_eq!(added.provider, GitProvider::Other);
        assert_eq!(added.local_path, canonical_working_str);
        assert_eq!(added.source_path, canonical_working_str);
        assert!(added.last_sync_error.is_none());

        let local_repo = git2::Repository::open(&working).expect("open local repo");
        let origin = local_repo.find_remote("origin").expect("find origin");
        assert_eq!(origin.url(), Some(remote_url.as_str()));
    }

    #[test]
    fn remove_managed_repository_removes_record_and_mirror_repo_folder() {
        let home = temp_root("myskills-tauri-git-home");
        let source = temp_root("myskills-tauri-git-source");
        init_repo_with_commit(&source);

        let added = add_repository_and_sync(
            &home,
            source.to_str().expect("source path utf8"),
            None,
            None,
            GitSyncMode::Mirror,
            Some(source.to_string_lossy().to_string()),
            None,
        )
        .expect("add repository");

        let mirror_path = PathBuf::from(&added.local_path);
        assert!(mirror_path.exists());

        remove_managed_repository(&home, &added.id).expect("remove repository");

        let listed = list_managed_repositories(&home).expect("list repositories");
        assert!(listed.is_empty());
        assert!(!mirror_path.exists());
    }

    #[test]
    fn list_managed_repositories_returns_empty_when_config_missing() {
        let home = temp_root("myskills-tauri-git-home");
        let listed = list_managed_repositories(&home).expect("list repositories");
        assert!(listed.is_empty());
    }

    #[test]
    fn load_git_guide_markdown_creates_default_file_when_missing() {
        let home = temp_root("myskills-tauri-git-home");
        let document = load_git_guide_markdown(&home).expect("load git guide");

        assert!(document.path.ends_with("git-guide.md"));
        assert!(document.content.contains("Skillar Git"));
        assert!(PathBuf::from(&document.path).exists());
    }

    #[test]
    fn update_managed_repository_alias_updates_existing_record() {
        let home = temp_root("myskills-tauri-git-home");
        let source = temp_root("myskills-tauri-git-source");
        init_repo_with_commit(&source);

        let added = add_repository_and_sync(
            &home,
            source.to_str().expect("source path utf8"),
            None,
            None,
            GitSyncMode::Mirror,
            Some(source.to_string_lossy().to_string()),
            None,
        )
        .expect("add repository");

        let updated =
            update_managed_repository_alias(&home, &added.id, Some("notes-main".to_string()))
                .expect("update alias");
        assert_eq!(updated.alias, Some("notes-main".to_string()));

        let listed = list_managed_repositories(&home).expect("list repositories");
        assert_eq!(listed[0].alias, Some("notes-main".to_string()));
    }

    #[test]
    fn update_managed_repository_sync_path_updates_source_for_mirror_mode() {
        let home = temp_root("myskills-tauri-git-home");
        let source = temp_root("myskills-tauri-git-source");
        init_repo_with_commit(&source);

        let added = add_repository_and_sync(
            &home,
            source.to_str().expect("source path utf8"),
            None,
            None,
            GitSyncMode::Mirror,
            Some(source.to_string_lossy().to_string()),
            None,
        )
        .expect("add repository");

        let next_sync_path = temp_root("myskills-tauri-git-next-sync");
        fs::create_dir_all(&next_sync_path).expect("create next sync path");
        let canonical_sync = fs::canonicalize(&next_sync_path).expect("canonical sync path");
        let canonical_sync_str = canonical_sync.to_string_lossy().to_string();

        let updated = update_managed_repository_sync_path(
            &home,
            &added.id,
            Some(next_sync_path.to_string_lossy().to_string()),
        )
        .expect("update sync path");

        assert_eq!(updated.sync_mode, GitSyncMode::Mirror);
        assert_eq!(updated.source_path, canonical_sync_str.as_str());
        assert_eq!(updated.local_path, added.local_path);

        let listed = list_managed_repositories(&home).expect("list repositories");
        assert_eq!(listed[0].source_path, canonical_sync_str.as_str());
        assert_eq!(listed[0].local_path, added.local_path);
    }

    #[test]
    fn update_managed_repository_sync_path_updates_local_for_direct_mode() {
        let home = temp_root("myskills-tauri-git-home");
        let working = temp_root("myskills-tauri-git-working");
        fs::create_dir_all(&working).expect("create working directory");
        fs::write(working.join("README.md"), "hello").expect("write local file");

        let remote_root = temp_root("myskills-tauri-git-remote");
        init_bare_repo(&remote_root);
        let remote_url = remote_root
            .to_str()
            .expect("remote path utf8")
            .replace('\\', "/");

        let added = add_repository_and_sync(
            &home,
            &remote_url,
            None,
            None,
            GitSyncMode::Direct,
            Some(working.to_string_lossy().to_string()),
            Some(working.to_string_lossy().to_string()),
        )
        .expect("add direct repository");

        let next_sync_path = temp_root("myskills-tauri-git-next-direct");
        fs::create_dir_all(&next_sync_path).expect("create next sync path");
        let canonical_sync = fs::canonicalize(&next_sync_path).expect("canonical sync path");
        let canonical_sync_str = canonical_sync.to_string_lossy().to_string();

        let updated = update_managed_repository_sync_path(
            &home,
            &added.id,
            Some(next_sync_path.to_string_lossy().to_string()),
        )
        .expect("update sync path");

        assert_eq!(updated.sync_mode, GitSyncMode::Direct);
        assert_eq!(updated.source_path, canonical_sync_str.as_str());
        assert_eq!(updated.local_path, canonical_sync_str.as_str());

        let listed = list_managed_repositories(&home).expect("list repositories");
        assert_eq!(listed[0].source_path, canonical_sync_str.as_str());
        assert_eq!(listed[0].local_path, canonical_sync_str.as_str());
    }

    #[test]
    fn managed_repository_deserializes_legacy_without_ignore_paths() {
        let raw = r#"{
            "id":"repo-1",
            "name":"repo",
            "url":"https://example.com/repo.git",
            "provider":"other",
            "syncMode":"direct",
            "sourcePath":"C:/tmp",
            "localPath":"C:/tmp",
            "isSyncing":false,
            "lastSyncAt":null,
            "lastSyncError":null,
            "scriptAfterAdd":null
        }"#;
        let repository: ManagedGitRepository =
            serde_json::from_str(raw).expect("deserialize repository");
        assert!(repository.ignore_paths.is_empty());
    }

    #[test]
    fn write_repository_gitignore_managed_block_updates_only_managed_section() {
        let root = temp_root("myskills-tauri-git-target");
        init_repo(&root);
        let gitignore = root.join(".gitignore");
        fs::write(&gitignore, "node_modules/\n# custom ignore\n").expect("seed gitignore");

        write_repository_gitignore_managed_block(
            &root,
            &vec!["logs/".to_string(), "draft.md".to_string()],
        )
        .expect("write managed section");
        let first = fs::read_to_string(&gitignore).expect("read gitignore first");
        assert!(first.contains("node_modules/"));
        assert!(first.contains("# custom ignore"));
        assert!(first.contains(GITIGNORE_MANAGED_START));
        assert!(first.contains("logs/"));
        assert!(first.contains("draft.md"));

        write_repository_gitignore_managed_block(&root, &vec!["cache/".to_string()])
            .expect("rewrite managed section");
        let second = fs::read_to_string(&gitignore).expect("read gitignore second");
        assert!(second.contains("cache/"));
        assert!(!second.contains("logs/"));
        assert!(!second.contains("draft.md"));

        write_repository_gitignore_managed_block(&root, &Vec::new())
            .expect("clear managed section");
        let third = fs::read_to_string(&gitignore).expect("read gitignore third");
        assert!(third.contains("node_modules/"));
        assert!(third.contains("# custom ignore"));
        assert!(!third.contains(GITIGNORE_MANAGED_START));
        assert!(!third.contains(GITIGNORE_MANAGED_END));
    }

    #[test]
    fn update_managed_repository_ignored_paths_persists_and_syncs_for_mirror_mode() {
        let home = temp_root("myskills-tauri-git-home");
        let source = temp_root("myskills-tauri-git-source");
        init_repo(&source);
        fs::create_dir_all(source.join("notes")).expect("create notes directory");
        fs::write(source.join("notes").join("a.md"), "note").expect("write notes file");
        fs::write(source.join("todo.md"), "todo").expect("write todo file");
        commit_all(&source, "feat: seed source").expect("seed source");

        let added = add_repository_and_sync(
            &home,
            source.to_str().expect("source path utf8"),
            None,
            None,
            GitSyncMode::Mirror,
            Some(source.to_string_lossy().to_string()),
            None,
        )
        .expect("add mirror repository");

        let update_result = update_managed_repository_ignored_paths(
            &home,
            &added.id,
            vec!["notes".to_string(), "todo.md".to_string()],
        )
        .expect("update ignored paths");

        assert_eq!(
            update_result.repository.ignore_paths,
            vec!["notes/".to_string(), "todo.md".to_string()]
        );
        assert!(update_result.sync_result.is_some());

        let listed = list_managed_repositories(&home).expect("list repositories");
        assert_eq!(
            listed[0].ignore_paths,
            update_result.repository.ignore_paths
        );

        let mirror_root = PathBuf::from(&added.local_path);
        assert!(!mirror_root.join("notes").exists());
        assert!(!mirror_root.join("todo.md").exists());

        let gitignore = fs::read_to_string(mirror_root.join(".gitignore")).expect("read gitignore");
        assert!(gitignore.contains(GITIGNORE_MANAGED_START));
        assert!(gitignore.contains("notes/"));
        assert!(gitignore.contains("todo.md"));
    }

    #[test]
    fn sync_skills_dir_to_repository_with_ignores_filters_and_removes_stale_entries() {
        let source = temp_root("myskills-tauri-git-source");
        fs::create_dir_all(source.join("kept")).expect("create kept dir");
        fs::create_dir_all(source.join("ignored-dir")).expect("create ignored dir");
        fs::write(source.join("kept").join("keep.md"), "keep").expect("write kept file");
        fs::write(source.join("ignored-dir").join("drop.md"), "drop").expect("write ignored file");
        fs::write(source.join("ignored.md"), "drop").expect("write ignored root file");

        let target = temp_root("myskills-tauri-git-target");
        init_repo(&target);
        fs::create_dir_all(target.join("ignored-dir")).expect("create target ignored dir");
        fs::write(target.join("ignored-dir").join("drop.md"), "old")
            .expect("seed target ignored file");
        fs::write(target.join("ignored.md"), "old").expect("seed target ignored root file");

        let result = sync_skills_dir_to_repository_with_ignores(
            &source,
            &target,
            &vec!["ignored-dir/".to_string(), "ignored.md".to_string()],
        )
        .expect("sync with ignores");

        assert!(result.copied_files >= 1);
        assert!(target.join("kept").join("keep.md").exists());
        assert!(!target.join("ignored-dir").exists());
        assert!(!target.join("ignored.md").exists());
    }

    #[test]
    fn list_sync_tree_entries_returns_sorted_entries_with_ignored_flags() {
        let source = temp_root("myskills-tauri-git-source");
        fs::create_dir_all(source.join("alpha")).expect("create alpha dir");
        fs::create_dir_all(source.join("beta")).expect("create beta dir");
        fs::write(source.join("alpha").join("a.md"), "alpha").expect("write alpha file");
        fs::write(source.join("beta").join("b.md"), "beta").expect("write beta file");
        fs::write(source.join("readme.md"), "readme").expect("write readme");
        fs::write(source.join("todo.md"), "todo").expect("write todo");
        fs::create_dir_all(source.join(".logs")).expect("create hidden logs");
        fs::write(source.join(".logs").join("skip.log"), "skip").expect("write hidden file");

        let root_entries = list_sync_tree_entries(
            &source,
            &vec!["alpha/".to_string(), "todo.md".to_string()],
            None,
        )
        .expect("list root entries");

        assert_eq!(root_entries.len(), 5);
        let dir_count = root_entries
            .iter()
            .filter(|entry| entry.entry_type == "dir")
            .count();
        let file_count = root_entries
            .iter()
            .filter(|entry| entry.entry_type == "file")
            .count();
        assert_eq!(dir_count, 3);
        assert_eq!(file_count, 2);

        let hidden_logs = root_entries
            .iter()
            .find(|entry| entry.relative_path == ".logs")
            .expect("find hidden logs entry");
        assert_eq!(hidden_logs.entry_type, "dir");
        assert!(hidden_logs.has_children);
        assert!(!hidden_logs.ignored);

        let alpha = root_entries
            .iter()
            .find(|entry| entry.relative_path == "alpha")
            .expect("find alpha entry");
        assert!(alpha.ignored);
        let todo = root_entries
            .iter()
            .find(|entry| entry.relative_path == "todo.md")
            .expect("find todo entry");
        assert!(todo.ignored);
        let readme = root_entries
            .iter()
            .find(|entry| entry.relative_path == "readme.md")
            .expect("find readme entry");
        assert!(!readme.ignored);

        let beta_children = list_sync_tree_entries(&source, &Vec::new(), Some("beta".to_string()))
            .expect("list beta children");
        assert_eq!(beta_children.len(), 1);
        assert_eq!(beta_children[0].relative_path, "beta/b.md");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn normalize_path_for_system_open_strips_verbatim_prefix() {
        let input = Path::new(r"\\?\C:\Users\Keith\my-skills");
        let normalized = normalize_path_for_system_open(input);
        assert_eq!(normalized, PathBuf::from(r"C:\Users\Keith\my-skills"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn normalize_path_for_system_open_strips_verbatim_unc_prefix() {
        let input = Path::new(r"\\?\UNC\server\share\notes");
        let normalized = normalize_path_for_system_open(input);
        assert_eq!(normalized, PathBuf::from(r"\\server\share\notes"));
    }

    #[test]
    fn sync_skills_dir_to_repository_copies_source_and_removes_stale_files() {
        let source = temp_root("myskills-tauri-git-source");
        fs::create_dir_all(source.join("demo-skill")).expect("create source skill dir");
        fs::write(source.join("demo-skill").join("SKILL.md"), "# demo\n")
            .expect("write skill file");
        fs::create_dir_all(source.join(".logs")).expect("create hidden source dir");
        fs::write(source.join(".logs").join("usage.log"), "debug")
            .expect("write hidden source file");

        let target = temp_root("myskills-tauri-git-target");
        init_repo(&target);
        fs::write(target.join("stale.txt"), "remove me").expect("write stale file");
        fs::create_dir_all(target.join("stale-dir")).expect("create stale dir");
        fs::write(target.join("stale-dir").join("old.md"), "remove me")
            .expect("write stale nested file");

        let result = sync_skills_dir_to_repository(&source, &target).expect("sync skills dir");
        let canonical_source = fs::canonicalize(&source).expect("canonical source");
        let canonical_target = fs::canonicalize(&target).expect("canonical target");
        assert_eq!(result.source_path, canonical_source.to_string_lossy());
        assert_eq!(result.target_path, canonical_target.to_string_lossy());
        assert!(result.copied_files >= 1);

        assert!(target.join("demo-skill").join("SKILL.md").exists());
        assert!(!target.join("stale.txt").exists());
        assert!(!target.join("stale-dir").exists());
        assert!(!target.join(".logs").exists());
        assert!(target.join(".git").exists());
    }
}

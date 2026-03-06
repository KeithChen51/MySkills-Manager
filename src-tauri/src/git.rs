use serde::Serialize;
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GitStatusResult {
    pub branch: String,
    pub changed: Vec<String>,
    pub staged: Vec<String>,
    pub not_added: Vec<String>,
    pub ahead: usize,
    pub behind: usize,
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

fn push_unique(list: &mut Vec<String>, value: String) {
    if !list.iter().any(|item| item == &value) {
        list.push(value);
    }
}

pub fn get_git_status(root: &Path) -> Result<GitStatusResult, String> {
    let repo =
        git2::Repository::open(root).map_err(|e| format!("Open git repository failed: {e}"))?;

    let branch = repo
        .head()
        .ok()
        .and_then(|head| head.shorthand().map(|name| name.to_string()))
        .unwrap_or_else(|| "HEAD".to_string());

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
        if let Ok(head_ref) = repo.head() {
            if let (Some(branch_name), Some(local_oid)) = (head_ref.shorthand(), head_ref.target())
            {
                if let Ok(local_branch) = repo.find_branch(branch_name, git2::BranchType::Local) {
                    if let Ok(upstream_branch) = local_branch.upstream() {
                        if let Some(upstream_oid) = upstream_branch.into_reference().target() {
                            if let Ok((ahead, behind)) =
                                repo.graph_ahead_behind(local_oid, upstream_oid)
                            {
                                result = (ahead, behind);
                            }
                        }
                    }
                }
            }
        }
        result
    };

    Ok(GitStatusResult {
        branch,
        changed,
        staged,
        not_added,
        ahead,
        behind,
    })
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

    let head = repo.head().map_err(|e| format!("Read HEAD failed: {e}"))?;
    let branch = head
        .shorthand()
        .ok_or_else(|| "Current HEAD is detached".to_string())?
        .to_string();

    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| format!("Find git remote 'origin' failed: {e}"))?;

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

    let mut push_options = git2::PushOptions::new();
    push_options.remote_callbacks(callbacks);

    let refspec = format!("refs/heads/{0}:refs/heads/{0}", branch);
    remote
        .push(&[&refspec], Some(&mut push_options))
        .map_err(|e| format!("Push to origin failed: {e}"))?;

    Ok(GitPushResult {
        success: true,
        error: None,
    })
}

#[tauri::command]
pub async fn git_status() -> Result<GitStatusResult, String> {
    let root = crate::root_dir::default_root_dir();
    let task = tauri::async_runtime::spawn_blocking(move || get_git_status(&root));
    let joined = tokio::time::timeout(Duration::from_secs(15), task)
        .await
        .map_err(|_| "git_status timed out after 15s".to_string())?;
    joined.map_err(|e| format!("Run git_status task failed: {e}"))?
}

#[tauri::command]
pub async fn git_commit(message: String) -> Result<GitCommitResult, String> {
    let root = crate::root_dir::default_root_dir();
    let task = tauri::async_runtime::spawn_blocking(move || commit_all(&root, &message));
    let joined = tokio::time::timeout(Duration::from_secs(30), task)
        .await
        .map_err(|_| "git_commit timed out after 30s".to_string())?;
    joined.map_err(|e| format!("Run git_commit task failed: {e}"))?
}

#[tauri::command]
pub async fn git_push() -> Result<GitPushResult, String> {
    let root = crate::root_dir::default_root_dir();
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
    use std::path::Path;

    use super::*;

    fn init_repo(root: &Path) -> git2::Repository {
        fs::create_dir_all(root).expect("create root");
        git2::Repository::init(root).expect("init repo")
    }

    fn init_bare_repo(root: &Path) -> git2::Repository {
        fs::create_dir_all(root).expect("create root");
        git2::Repository::init_bare(root).expect("init bare repo")
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
}

mod git;
mod log_index;
mod logs;
mod onboarding;
mod root_dir;
mod rules;
mod setup;
mod skills;
mod stats;

#[tauri::command]
fn app_ping() -> String {
    "pong".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Err(err) = onboarding::apply_bootstrap_env() {
                eprintln!("onboarding bootstrap failed: {err}");
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_ping,
            skills::skills_list,
            skills::skills_get_content,
            skills::skills_save_content,
            skills::skills_list_files,
            logs::logs_get,
            stats::stats_get,
            rules::rules_get,
            rules::rules_save,
            git::git_status,
            git::git_commit,
            git::git_push,
            setup::setup_status,
            setup::setup_router_health,
            setup::setup_path_validation_matrix,
            setup::setup_local_skills_overview,
            setup::setup_get_skill_conflict_detail,
            setup::setup_resolve_skill_conflict,
            setup::setup_apply,
            setup::setup_get_custom_tools,
            setup::setup_add_custom_tool,
            setup::setup_remove_custom_tool,
            setup::setup_update_tool_paths,
            setup::setup_set_tool_auto_sync,
            setup::setup_set_tool_tracking_enabled,
            setup::setup_get_import_mode,
            setup::setup_set_import_mode,
            onboarding::onboarding_get_state,
            onboarding::onboarding_set_skills_dir,
            onboarding::onboarding_import_installed_skills,
            onboarding::onboarding_complete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn app_ping_returns_pong() {
        assert_eq!(super::app_ping(), "pong");
    }
}

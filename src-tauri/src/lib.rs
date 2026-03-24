mod evals;
mod git;
mod log_index;
mod log_parse;
mod logs;
mod onboarding;
mod root_dir;
mod router_seed;
mod rules;
mod setup;
mod skill_insights;
mod skills;
mod stats;
#[cfg(test)]
mod test_utils;
mod update_checker;
mod vscode_extension;

#[tauri::command]
fn app_ping() -> String {
    "pong".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_process::init())?;

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
            skills::skills_rescan_shape_tags,
            skill_insights::skills_get_insights,
            skills::skills_get_content,
            skills::skills_save_content,
            skills::skills_list_files,
            skills::skills_delete_everywhere,
            logs::logs_get,
            stats::stats_get,
            rules::rules_get,
            rules::rules_save,
            git::git_sync_source_path,
            git::git_get_guide_markdown,
            git::git_list_repositories,
            git::git_add_repository,
            git::git_remove_repository,
            git::git_update_repository_alias,
            git::git_update_repository_sync_path,
            git::git_list_sync_tree,
            git::git_update_repository_ignored_paths,
            git::git_open_directory,
            git::git_open_url,
            git::git_sync_skills_to_repo,
            git::git_status,
            git::git_list_commit_history,
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
            update_checker::should_check_updates,
            update_checker::get_update_settings,
            update_checker::save_update_settings,
            update_checker::update_last_check_time,
            update_checker::save_pending_update_notes,
            update_checker::check_version_jump,
            update_checker::update_log,
            vscode_extension::vscode_extension_install,
            vscode_extension::vscode_extension_sync_skills_root,
            vscode_extension::vscode_extension_status,
            vscode_extension::vscode_extension_uninstall,
            onboarding::onboarding_get_state,
            onboarding::onboarding_set_skills_dir,
            onboarding::onboarding_import_installed_skills,
            onboarding::onboarding_complete,
            evals::eval_get_config,
            evals::eval_get_storage_paths,
            evals::eval_list_sample_generation_history,
            evals::eval_estimate_pipeline,
            evals::eval_list_history,
            evals::eval_load_history,
            evals::eval_get_review,
            evals::eval_submit_review,
            evals::eval_list_review_queue,
            evals::eval_generate_feedback_drafts,
            evals::eval_read_evidence_case,
            evals::eval_save_config,
            evals::eval_test_model_connection,
            evals::eval_control,
            evals::run_trigger_eval,
            evals::run_functional_eval,
            evals::run_eval_pipeline,
            evals::eval_generate_samples,
            evals::eval_save_dataset
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

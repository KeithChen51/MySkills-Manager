// src-tauri/src/evals.rs

use serde::{Deserialize, Serialize};
use std::process::{Command, Stdio};
use std::io::Read;
use std::path::PathBuf;

// --- Data Structures for Trigger Evaluation ---

#[derive(Serialize, Deserialize, Debug)]
pub struct TriggerEvalInputItem {
    query: String,
    should_trigger: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct TriggerEvalResultItem {
    query: String,
    should_trigger: bool,
    triggered: bool,
    triggered_skill_name: Option<String>,
    pass: bool,
    error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct TriggerEvalSummary {
    total: i32,
    passed: i32,
    failed: i32,
    pass_rate: f64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct TriggerEvalOutput {
    status: String,
    skill_name: Option<String>,
    summary: Option<TriggerEvalSummary>,
    results: Option<Vec<TriggerEvalResultItem>>,
    message: Option<String>,
}

// --- Data Structures for Functional Evaluation ---

#[derive(Serialize, Deserialize, Debug)]
pub struct FunctionalEvalInputItem {
    id: String,
    prompt: String,
    assertions: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FunctionalEvalResultItem {
    case_id: String,
    passed: bool,
    pass_rate: f64,
    error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FunctionalEvalSummary {
    total: i32,
    passed: i32,
    failed: i32,
    pass_rate: f64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FunctionalEvalOutput {
    status: String,
    skill_name: Option<String>,
    summary: Option<FunctionalEvalSummary>,
    results: Option<Vec<FunctionalEvalResultItem>>,
    message: Option<String>,
}

fn get_python_path() -> String {
    // In a real app, this might be configurable or discovered.
    // For now, we assume python3 is in the PATH.
    "python3".to_string()
}

// --- Tauri Commands ---

#[tauri::command]
pub async fn run_trigger_eval(
    skill_name: String,
    eval_set_path: PathBuf,
    output_path: PathBuf,
    env_type: String,
    installed_skills_dir: Option<PathBuf>,
    api_key: String,
    model: String,
) -> Result<TriggerEvalOutput, String> {
    let python_executable = get_python_path();
    let script_path = PathBuf::from("py/eval_engine"); // Assuming it's run from src-tauri

    let mut cmd_args = vec![
        "-m",
        "eval_engine",
        "trigger",
        "--skill-name",
        &skill_name,
        "--eval-set-path",
        eval_set_path.to_str().unwrap(),
        "--output-path",
        output_path.to_str().unwrap(),
        "--env-type",
        &env_type,
        "--api-key",
        &api_key,
        "--model",
        &model,
    ];

    let installed_skills_dir_str;
    if let Some(dir) = &installed_skills_dir {
        installed_skills_dir_str = dir.to_str().unwrap().to_string();
        cmd_args.push("--installed-skills-dir");
        cmd_args.push(&installed_skills_dir_str);
    }

    let output = Command::new(&python_executable)
        .args(&cmd_args)
        .current_dir(PathBuf::from("./py")) // Adjust if necessary
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to execute python script: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python script failed: {}", stderr));
    }

    let result_str = std::fs::read_to_string(&output_path)
        .map_err(|e| format!("Failed to read output file: {}", e))?;
    
    serde_json::from_str(&result_str)
        .map_err(|e| format!("Failed to parse JSON output: {}", e))
}

#[tauri::command]
pub async fn run_functional_eval(
    skill_name: String,
    skill_path: PathBuf,
    eval_set_path: PathBuf,
    output_dir: PathBuf,
    compare_mode: String,
    api_key: String,
    model: String,
) -> Result<FunctionalEvalOutput, String> {
    let python_executable = get_python_path();
    let script_path = PathBuf::from("py/eval_engine");

    let cmd_args = vec![
        "-m",
        "eval_engine",
        "functional",
        "--skill-name",
        &skill_name,
        "--skill-path",
        skill_path.to_str().unwrap(),
        "--eval-set-path",
        eval_set_path.to_str().unwrap(),
        "--output-dir",
        output_dir.to_str().unwrap(),
        "--compare-mode",
        &compare_mode,
        "--api-key",
        &api_key,
        "--model",
        &model,
    ];

    let output = Command::new(&python_executable)
        .args(&cmd_args)
        .current_dir(PathBuf::from("./py")) // Adjust if necessary
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to execute python script: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python script failed: {}", stderr));
    }

    let summary_path = output_dir.join("summary.json");
    let result_str = std::fs::read_to_string(&summary_path)
        .map_err(|e| format!("Failed to read summary file: {}", e))?;

    serde_json::from_str(&result_str)
        .map_err(|e| format!("Failed to parse JSON output: {}", e))
}

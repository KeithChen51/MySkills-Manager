use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value as YamlValue};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

const DEFAULT_PROVIDER: &str = "openai-compatible";
const DEFAULT_MODEL: &str = "gpt-4o-mini";
const EVAL_TIMEOUT_SECS: u64 = 300;
const MAX_EVAL_TIMEOUT_SECS: u64 = 10800;
const EVAL_TIMEOUT_PER_CASE_SECS: u64 = 12;
const TAXONOMY_TIMEOUT_SECS: u64 = 180;
const TAXONOMY_TAG_PREFIX: &str = "taxonomy:";
const DEFAULT_TRIGGER_CASE_COUNT: usize = 40;
const DEFAULT_FUNCTIONAL_CASE_COUNT: usize = 20;
const DEFAULT_PIPELINE_REPEATS: usize = 1;
const ESTIMATED_USD_PER_TRIGGER_CASE: f64 = 0.00001;
const ESTIMATED_USD_PER_FUNCTIONAL_CASE: f64 = 0.00003;
const EVAL_PROGRESS_EVENT: &str = "eval://pipeline-progress";
static EVAL_TMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub struct TriggerEvalResultItem {
    pub query: String,
    pub should_trigger: bool,
    pub triggered: bool,
    pub triggered_skill_name: Option<String>,
    pub pass: bool,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub struct TriggerEvalSummary {
    pub total: i32,
    pub passed: i32,
    pub failed: i32,
    pub pass_rate: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub struct TriggerEvalOutput {
    pub status: String,
    pub skill_name: Option<String>,
    pub summary: Option<TriggerEvalSummary>,
    pub results: Option<Vec<TriggerEvalResultItem>>,
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub struct FunctionalEvalResultItem {
    pub case_id: String,
    pub passed: bool,
    pub pass_rate: f64,
    pub error: Option<String>,
    pub layer1_pass: Option<bool>,
    pub quality_score: Option<f64>,
    pub dimension_scores: Option<HashMap<String, f64>>,
    pub judge_rationale: Option<String>,
    pub judge_suggestions: Option<Vec<String>>,
    pub judge_source: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub struct FunctionalEvalSummary {
    pub total: i32,
    pub passed: i32,
    pub failed: i32,
    pub pass_rate: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub struct FunctionalEvalOutput {
    pub status: String,
    pub skill_name: Option<String>,
    pub summary: Option<FunctionalEvalSummary>,
    pub dimension_scores: Option<HashMap<String, f64>>,
    pub results: Option<Vec<FunctionalEvalResultItem>>,
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalConfig {
    pub api_key: String,
    pub provider: String,
    pub base_url: Option<String>,
    pub default_model: String,
}

#[derive(Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct RawEvalConfig {
    api_key: Option<String>,
    provider: Option<String>,
    base_url: Option<String>,
    default_model: Option<String>,
}

impl Default for EvalConfig {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            provider: DEFAULT_PROVIDER.to_string(),
            base_url: None,
            default_model: DEFAULT_MODEL.to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalMutationResult {
    pub success: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalDatasetSaveResult {
    pub success: bool,
    pub path: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalStoragePaths {
    pub dataset_dir: String,
    pub history_dir: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalHistoryEntry {
    pub path: String,
    pub file_name: String,
    pub saved_at_unix: u64,
    pub mode: String,
    pub repeats: usize,
    pub pass_rate: f64,
    pub total_cases: i32,
    pub model: String,
    pub status: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalSampleDrafts {
    pub trigger_draft: String,
    pub functional_draft: String,
    pub trigger_count: usize,
    pub functional_count: usize,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalPipelineSummary {
    pub total_cases: i32,
    pub total_passed: i32,
    pub total_failed: i32,
    pub pass_rate: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalTriggerMetrics {
    pub precision: f64,
    pub recall: f64,
    pub fpr: f64,
    pub true_positive: i32,
    pub true_negative: i32,
    pub false_positive: i32,
    pub false_negative: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalDimensionScores {
    pub trigger_accuracy: f64,
    pub functional_correctness: f64,
    pub robustness: f64,
    pub efficiency: f64,
    pub value_added: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalCostEstimate {
    pub estimated_usd: f64,
    pub actual_usd_estimate: f64,
    pub trigger_cases: usize,
    pub functional_cases: usize,
    pub api_calls_estimate: usize,
    pub budget_limit_usd: Option<f64>,
    pub budget_exceeded: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalDeltaVsNoSkill {
    pub with_skill_pass_rate: f64,
    pub without_skill_pass_rate: f64,
    pub functional_pass_rate_delta: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalRunMeta {
    pub mode: String,
    pub model: String,
    pub judge_models: Vec<String>,
    pub repeats: usize,
    pub seed: Option<u64>,
    pub temperature: f64,
    pub executed_steps: usize,
    pub elapsed_ms: u128,
    pub skill_hash: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalRateStats {
    pub mean: f64,
    pub median: f64,
    pub std_dev: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalRepeatStats {
    pub overall_pass_rate: EvalRateStats,
    pub trigger_pass_rate: EvalRateStats,
    pub functional_pass_rate: Option<EvalRateStats>,
    pub robustness: EvalRateStats,
    pub value_added: Option<EvalRateStats>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalPipelineOutput {
    pub status: String,
    pub mode: String,
    pub summary: EvalPipelineSummary,
    pub trigger_clean: TriggerEvalOutput,
    pub trigger_complex: Option<TriggerEvalOutput>,
    pub functional: FunctionalEvalOutput,
    pub functional_without_skill: Option<FunctionalEvalOutput>,
    pub dimension_scores: EvalDimensionScores,
    pub trigger_metrics: EvalTriggerMetrics,
    pub cost_estimate: EvalCostEstimate,
    pub delta_vs_no_skill: Option<EvalDeltaVsNoSkill>,
    pub repeat_stats: EvalRepeatStats,
    pub run_meta: EvalRunMeta,
    pub taxonomy_status: Option<String>,
    pub taxonomy_message: Option<String>,
    pub taxonomy_applied: Option<bool>,
    pub history_path: Option<String>,
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct SkillTaxonomyClassification {
    sok_representation: String,
    sok_scope: String,
    sok_group: String,
    anthropic_category: String,
    skillsbench_domain: String,
    skillsbench_difficulty_core: String,
    skillsbench_difficulty_level: String,
    classified_at: String,
    classifier_model: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct TaxonomyClassifyOutput {
    status: String,
    taxonomy: Option<SkillTaxonomyClassification>,
    message: Option<String>,
}

#[derive(Debug, Clone)]
struct EnsureSkillTaxonomyResult {
    status: String,
    message: String,
    applied: bool,
    taxonomy: Option<SkillTaxonomyClassification>,
}

#[derive(Debug, Clone, Copy)]
enum EvalStrategy {
    Default,
}

#[derive(Default)]
struct EvalRunControl {
    paused: AtomicBool,
    cancelled: AtomicBool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct EvalPipelineProgressEvent {
    run_id: String,
    status: String,
    current_repeat: usize,
    total_repeats: usize,
    step_index: usize,
    total_steps: usize,
    step_name: String,
    message: String,
    elapsed_ms: u128,
}

#[derive(Clone)]
struct PythonRuntime {
    command: &'static str,
    pre_args: &'static [&'static str],
}

fn runtime_label(runtime: &PythonRuntime) -> String {
    if runtime.pre_args.is_empty() {
        runtime.command.to_string()
    } else {
        format!("{} {}", runtime.command, runtime.pre_args.join(" "))
    }
}

fn run_controls_registry() -> &'static Mutex<HashMap<String, Arc<EvalRunControl>>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<EvalRunControl>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_eval_run_control(run_id: &str) -> Result<Arc<EvalRunControl>, String> {
    let control = Arc::new(EvalRunControl::default());
    let mut guard = run_controls_registry()
        .lock()
        .map_err(|_| "Eval control registry lock poisoned".to_string())?;
    guard.insert(run_id.to_string(), control.clone());
    Ok(control)
}

fn get_eval_run_control(run_id: &str) -> Result<Arc<EvalRunControl>, String> {
    let guard = run_controls_registry()
        .lock()
        .map_err(|_| "Eval control registry lock poisoned".to_string())?;
    guard
        .get(run_id)
        .cloned()
        .ok_or_else(|| format!("Eval run '{run_id}' is not active"))
}

fn remove_eval_run_control(run_id: &str) {
    if let Ok(mut guard) = run_controls_registry().lock() {
        let _ = guard.remove(run_id);
    }
}

struct EvalRunControlGuard {
    run_id: String,
}

impl EvalRunControlGuard {
    fn new(run_id: String) -> Self {
        Self { run_id }
    }
}

impl Drop for EvalRunControlGuard {
    fn drop(&mut self) {
        remove_eval_run_control(&self.run_id);
    }
}

fn next_eval_run_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    let seq = EVAL_TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("eval-run-{ts}-{seq}")
}

fn emit_pipeline_progress(app_handle: &tauri::AppHandle, event: EvalPipelineProgressEvent) {
    let _ = app_handle.emit(EVAL_PROGRESS_EVENT, event);
}

#[allow(clippy::too_many_arguments)]
fn push_pipeline_progress(
    app_handle: &tauri::AppHandle,
    run_id: &str,
    status: &str,
    current_repeat: usize,
    total_repeats: usize,
    step_index: usize,
    total_steps: usize,
    step_name: &str,
    message: &str,
    elapsed_ms: u128,
) {
    emit_pipeline_progress(
        app_handle,
        EvalPipelineProgressEvent {
            run_id: run_id.to_string(),
            status: status.to_string(),
            current_repeat,
            total_repeats,
            step_index,
            total_steps,
            step_name: step_name.to_string(),
            message: message.to_string(),
            elapsed_ms,
        },
    );
}

#[allow(clippy::too_many_arguments)]
fn wait_if_paused_or_cancelled(
    control: &Arc<EvalRunControl>,
    app_handle: &tauri::AppHandle,
    run_id: &str,
    current_repeat: usize,
    total_repeats: usize,
    step_index: usize,
    total_steps: usize,
    step_name: &str,
    elapsed_ms: u128,
) -> Result<(), String> {
    let mut pause_notified = false;
    loop {
        if control.cancelled.load(Ordering::Relaxed) {
            push_pipeline_progress(
                app_handle,
                run_id,
                "cancelled",
                current_repeat,
                total_repeats,
                step_index,
                total_steps,
                step_name,
                "Evaluation cancelled by user.",
                elapsed_ms,
            );
            return Err("Evaluation cancelled by user.".to_string());
        }
        if !control.paused.load(Ordering::Relaxed) {
            if pause_notified {
                push_pipeline_progress(
                    app_handle,
                    run_id,
                    "running",
                    current_repeat,
                    total_repeats,
                    step_index,
                    total_steps,
                    step_name,
                    "Resume requested. Continuing with next step.",
                    elapsed_ms,
                );
            }
            return Ok(());
        }
        if !pause_notified {
            push_pipeline_progress(
                app_handle,
                run_id,
                "paused",
                current_repeat,
                total_repeats,
                step_index,
                total_steps,
                step_name,
                "Paused. Waiting for resume.",
                elapsed_ms,
            );
            pause_notified = true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn status_for_error(err: &str) -> &'static str {
    if err.to_ascii_lowercase().contains("cancelled") {
        "cancelled"
    } else {
        "error"
    }
}

fn eval_config_file(home: &Path) -> PathBuf {
    crate::root_dir::app_config_dir(home).join("eval-config.json")
}

fn sanitize_path_segment(raw: &str, fallback: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut last_dash = false;
    for ch in raw.trim().chars() {
        let valid = ch.is_ascii_alphanumeric() || ch == '-' || ch == '_';
        if valid {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let normalized = out.trim_matches('-').trim_matches('_').to_string();
    if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized
    }
}

fn eval_dataset_dir(home: &Path, skill_name: Option<&str>) -> PathBuf {
    let base = crate::root_dir::app_config_dir(home).join("eval-datasets");
    if let Some(skill) = skill_name {
        let normalized = sanitize_path_segment(skill, "skill");
        base.join(normalized)
    } else {
        base
    }
}

fn eval_history_root(home: &Path) -> PathBuf {
    home.join(".my-skills").join(".eval")
}

fn eval_history_dir(home: &Path, skill_name: Option<&str>) -> PathBuf {
    let base = eval_history_root(home);
    if let Some(skill) = skill_name {
        base.join(skill.trim())
    } else {
        base
    }
}

fn now_unix_secs() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .map_err(|e| format!("Read system clock failed: {e}"))
}

fn system_time_to_unix_secs(value: SystemTime) -> u64 {
    value
        .duration_since(UNIX_EPOCH)
        .map(|item| item.as_secs())
        .unwrap_or(0)
}

fn normalize_provider(value: &str) -> String {
    let normalized = value.trim();
    if normalized.is_empty() {
        DEFAULT_PROVIDER.to_string()
    } else {
        normalized.to_string()
    }
}

fn normalize_model(value: &str) -> String {
    let normalized = value.trim();
    if normalized.is_empty() {
        DEFAULT_MODEL.to_string()
    } else {
        normalized.to_string()
    }
}

fn normalize_base_url(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let normalized = item.trim().to_string();
        if normalized.is_empty() {
            None
        } else {
            Some(normalized)
        }
    })
}

fn sanitize_eval_config(raw: RawEvalConfig) -> EvalConfig {
    EvalConfig {
        api_key: raw.api_key.unwrap_or_default().trim().to_string(),
        provider: normalize_provider(raw.provider.as_deref().unwrap_or(DEFAULT_PROVIDER)),
        base_url: normalize_base_url(raw.base_url),
        default_model: normalize_model(raw.default_model.as_deref().unwrap_or(DEFAULT_MODEL)),
    }
}

fn read_eval_config_with_home(home: &Path) -> Result<EvalConfig, String> {
    let path = eval_config_file(home);
    if !path.exists() {
        return Ok(EvalConfig::default());
    }

    let raw = fs::read_to_string(&path).map_err(|e| format!("Read eval config failed: {e}"))?;
    if raw.trim().is_empty() {
        return Ok(EvalConfig::default());
    }

    let parsed = serde_json::from_str::<RawEvalConfig>(&raw)
        .map_err(|e| format!("Invalid eval config: {e}"))?;
    Ok(sanitize_eval_config(parsed))
}

fn write_eval_config_with_home(home: &Path, config: &EvalConfig) -> Result<(), String> {
    fs::create_dir_all(crate::root_dir::app_config_dir(home))
        .map_err(|e| format!("Create app config dir failed: {e}"))?;
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Serialize eval config failed: {e}"))?;
    fs::write(eval_config_file(home), format!("{content}\n"))
        .map_err(|e| format!("Write eval config failed: {e}"))
}

fn require_eval_config_with_api_key(home: &Path) -> Result<EvalConfig, String> {
    let config = read_eval_config_with_home(home)?;
    if config.api_key.trim().is_empty() {
        return Err(
            "Eval API key is not configured. Please set it in Settings -> API Configuration."
                .to_string(),
        );
    }
    Ok(config)
}

fn path_to_utf8(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(std::string::ToString::to_string)
        .ok_or_else(|| format!("Path is not valid UTF-8: {}", path.to_string_lossy()))
}

fn eval_tmp_dir(label: &str) -> Result<PathBuf, String> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Get system clock failed: {e}"))?
        .as_nanos();
    let n = EVAL_TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut dir = std::env::temp_dir();
    dir.push(format!("myskills-eval-{label}-{ts}-{n}"));
    fs::create_dir_all(&dir).map_err(|e| format!("Create temporary eval dir failed: {e}"))?;
    Ok(dir)
}

fn split_skill_frontmatter(raw: &str) -> Result<(Mapping, String), String> {
    let normalized = raw.replace("\r\n", "\n");
    let normalized = normalized.strip_prefix('\u{feff}').unwrap_or(&normalized);
    if !normalized.starts_with("---\n") {
        return Ok((Mapping::new(), normalized.to_string()));
    }
    let marker = "\n---\n";
    let rest = &normalized[4..];
    let Some(end) = rest.find(marker) else {
        return Err("Invalid frontmatter block".to_string());
    };
    let yaml_str = &rest[..end];
    let body = rest[end + marker.len()..].to_string();
    let frontmatter = if yaml_str.trim().is_empty() {
        Mapping::new()
    } else {
        serde_yaml::from_str::<Mapping>(yaml_str)
            .map_err(|e| format!("Invalid YAML frontmatter: {e}"))?
    };
    Ok((frontmatter, body))
}

fn build_skill_markdown(frontmatter: &Mapping, body: &str) -> Result<String, String> {
    let yaml =
        serde_yaml::to_string(frontmatter).map_err(|e| format!("Serialize YAML failed: {e}"))?;
    Ok(format!(
        "---\n{}---\n\n{}",
        yaml,
        body.trim_start_matches('\n')
    ))
}

fn yaml_get_string(map: &Mapping, key: &str) -> Option<String> {
    map.get(YamlValue::String(key.to_string()))
        .and_then(|v| v.as_str().map(std::string::ToString::to_string))
}

fn yaml_get_string_any(map: &Mapping, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = yaml_get_string(map, key) {
            let trimmed = value.trim().to_string();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }
    None
}

fn yaml_get_tags(map: &Mapping) -> Vec<String> {
    map.get(YamlValue::String("tags".to_string()))
        .and_then(|value| value.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|item| item.as_str().map(std::string::ToString::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn normalize_difficulty_core(value: &str) -> Option<String> {
    match value.trim().to_lowercase().as_str() {
        "core" => Some("Core".to_string()),
        "extended" => Some("Extended".to_string()),
        "extreme" => Some("Extreme".to_string()),
        _ => None,
    }
}

fn normalize_difficulty_level(value: &str) -> Option<String> {
    match value.trim().to_lowercase().as_str() {
        "easy" => Some("Easy".to_string()),
        "medium" => Some("Medium".to_string()),
        "hard" => Some("Hard".to_string()),
        _ => None,
    }
}

fn level_from_core(core: &str) -> Option<String> {
    match core {
        "Core" => Some("Easy".to_string()),
        "Extended" => Some("Medium".to_string()),
        "Extreme" => Some("Hard".to_string()),
        _ => None,
    }
}

fn core_from_level(level: &str) -> Option<String> {
    match level {
        "Easy" => Some("Core".to_string()),
        "Medium" => Some("Extended".to_string()),
        "Hard" => Some("Extreme".to_string()),
        _ => None,
    }
}

fn normalize_taxonomy(
    mut taxonomy: SkillTaxonomyClassification,
) -> Result<SkillTaxonomyClassification, String> {
    taxonomy.sok_representation = taxonomy.sok_representation.trim().to_string();
    taxonomy.sok_scope = taxonomy.sok_scope.trim().to_string();
    taxonomy.sok_group = taxonomy.sok_group.trim().to_string();
    taxonomy.anthropic_category = taxonomy.anthropic_category.trim().to_string();
    taxonomy.skillsbench_domain = taxonomy.skillsbench_domain.trim().to_string();
    taxonomy.classified_at = taxonomy.classified_at.trim().to_string();
    taxonomy.classifier_model = taxonomy.classifier_model.trim().to_string();

    if taxonomy.sok_group.is_empty()
        && !taxonomy.sok_representation.is_empty()
        && !taxonomy.sok_scope.is_empty()
    {
        taxonomy.sok_group = format!("{} × {}", taxonomy.sok_representation, taxonomy.sok_scope);
    }

    taxonomy.skillsbench_difficulty_core =
        normalize_difficulty_core(&taxonomy.skillsbench_difficulty_core)
            .or_else(|| {
                normalize_difficulty_level(&taxonomy.skillsbench_difficulty_level)
                    .and_then(|level| core_from_level(&level))
            })
            .ok_or_else(|| "Invalid skillsbenchDifficultyCore".to_string())?;
    taxonomy.skillsbench_difficulty_level =
        normalize_difficulty_level(&taxonomy.skillsbench_difficulty_level)
            .or_else(|| level_from_core(&taxonomy.skillsbench_difficulty_core))
            .ok_or_else(|| "Invalid skillsbenchDifficultyLevel".to_string())?;

    let required = [
        taxonomy.sok_representation.as_str(),
        taxonomy.sok_scope.as_str(),
        taxonomy.sok_group.as_str(),
        taxonomy.anthropic_category.as_str(),
        taxonomy.skillsbench_domain.as_str(),
        taxonomy.classified_at.as_str(),
        taxonomy.classifier_model.as_str(),
    ];
    if required.iter().any(|item| item.trim().is_empty()) {
        return Err("Taxonomy payload contains empty required fields".to_string());
    }
    Ok(taxonomy)
}

fn taxonomy_from_frontmatter(frontmatter: &Mapping) -> Option<SkillTaxonomyClassification> {
    let taxonomy_value = frontmatter
        .get(YamlValue::String("skillar_taxonomy".to_string()))
        .or_else(|| frontmatter.get(YamlValue::String("skillarTaxonomy".to_string())))?;
    let taxonomy = taxonomy_value.as_mapping()?;
    let raw = SkillTaxonomyClassification {
        sok_representation: yaml_get_string_any(
            taxonomy,
            &["sokRepresentation", "sok_representation"],
        )?,
        sok_scope: yaml_get_string_any(taxonomy, &["sokScope", "sok_scope"])?,
        sok_group: yaml_get_string_any(taxonomy, &["sokGroup", "sok_group"]).unwrap_or_default(),
        anthropic_category: yaml_get_string_any(
            taxonomy,
            &["anthropicCategory", "anthropic_category"],
        )?,
        skillsbench_domain: yaml_get_string_any(
            taxonomy,
            &["skillsbenchDomain", "skillsbench_domain"],
        )?,
        skillsbench_difficulty_core: yaml_get_string_any(
            taxonomy,
            &["skillsbenchDifficultyCore", "skillsbench_difficulty_core"],
        )
        .unwrap_or_default(),
        skillsbench_difficulty_level: yaml_get_string_any(
            taxonomy,
            &["skillsbenchDifficultyLevel", "skillsbench_difficulty_level"],
        )
        .unwrap_or_default(),
        classified_at: yaml_get_string_any(taxonomy, &["classifiedAt", "classified_at"])?,
        classifier_model: yaml_get_string_any(taxonomy, &["classifierModel", "classifier_model"])?,
    };
    normalize_taxonomy(raw).ok()
}

fn slugify_taxonomy_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut last_dash = false;
    for ch in value.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn taxonomy_tags(taxonomy: &SkillTaxonomyClassification) -> Vec<String> {
    vec![
        format!(
            "{TAXONOMY_TAG_PREFIX}sok-representation:{}",
            slugify_taxonomy_value(&taxonomy.sok_representation)
        ),
        format!(
            "{TAXONOMY_TAG_PREFIX}sok-scope:{}",
            slugify_taxonomy_value(&taxonomy.sok_scope)
        ),
        format!(
            "{TAXONOMY_TAG_PREFIX}sok-group:{}",
            slugify_taxonomy_value(&taxonomy.sok_group)
        ),
        format!(
            "{TAXONOMY_TAG_PREFIX}anthropic-category:{}",
            slugify_taxonomy_value(&taxonomy.anthropic_category)
        ),
        format!(
            "{TAXONOMY_TAG_PREFIX}skillsbench-domain:{}",
            slugify_taxonomy_value(&taxonomy.skillsbench_domain)
        ),
        format!(
            "{TAXONOMY_TAG_PREFIX}skillsbench-difficulty-core:{}",
            slugify_taxonomy_value(&taxonomy.skillsbench_difficulty_core)
        ),
        format!(
            "{TAXONOMY_TAG_PREFIX}skillsbench-difficulty-level:{}",
            slugify_taxonomy_value(&taxonomy.skillsbench_difficulty_level)
        ),
    ]
}

fn merge_taxonomy_tags(
    existing_tags: &[String],
    taxonomy: &SkillTaxonomyClassification,
) -> Vec<String> {
    let mut out = Vec::<String>::new();
    for tag in existing_tags {
        let trimmed = tag.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.to_lowercase().starts_with(TAXONOMY_TAG_PREFIX) {
            continue;
        }
        if !out.iter().any(|item| item == trimmed) {
            out.push(trimmed.to_string());
        }
    }
    for tag in taxonomy_tags(taxonomy) {
        if !out.iter().any(|item| item == &tag) {
            out.push(tag);
        }
    }
    out
}

fn build_taxonomy_mapping(taxonomy: &SkillTaxonomyClassification) -> Mapping {
    let mut mapping = Mapping::new();
    mapping.insert(
        YamlValue::String("sokRepresentation".to_string()),
        YamlValue::String(taxonomy.sok_representation.clone()),
    );
    mapping.insert(
        YamlValue::String("sokScope".to_string()),
        YamlValue::String(taxonomy.sok_scope.clone()),
    );
    mapping.insert(
        YamlValue::String("sokGroup".to_string()),
        YamlValue::String(taxonomy.sok_group.clone()),
    );
    mapping.insert(
        YamlValue::String("anthropicCategory".to_string()),
        YamlValue::String(taxonomy.anthropic_category.clone()),
    );
    mapping.insert(
        YamlValue::String("skillsbenchDomain".to_string()),
        YamlValue::String(taxonomy.skillsbench_domain.clone()),
    );
    mapping.insert(
        YamlValue::String("skillsbenchDifficultyCore".to_string()),
        YamlValue::String(taxonomy.skillsbench_difficulty_core.clone()),
    );
    mapping.insert(
        YamlValue::String("skillsbenchDifficultyLevel".to_string()),
        YamlValue::String(taxonomy.skillsbench_difficulty_level.clone()),
    );
    mapping.insert(
        YamlValue::String("classifiedAt".to_string()),
        YamlValue::String(taxonomy.classified_at.clone()),
    );
    mapping.insert(
        YamlValue::String("classifierModel".to_string()),
        YamlValue::String(taxonomy.classifier_model.clone()),
    );
    mapping
}

fn apply_taxonomy_to_frontmatter(
    frontmatter: &mut Mapping,
    taxonomy: &SkillTaxonomyClassification,
) {
    frontmatter.insert(
        YamlValue::String("skillar_taxonomy".to_string()),
        YamlValue::Mapping(build_taxonomy_mapping(taxonomy)),
    );
    let merged_tags = merge_taxonomy_tags(&yaml_get_tags(frontmatter), taxonomy);
    if merged_tags.is_empty() {
        frontmatter.remove(&YamlValue::String("tags".to_string()));
    } else {
        let tags = merged_tags
            .into_iter()
            .map(YamlValue::String)
            .collect::<Vec<_>>();
        frontmatter.insert(
            YamlValue::String("tags".to_string()),
            YamlValue::Sequence(tags),
        );
    }
}

fn python_workdir_candidates() -> Vec<PathBuf> {
    let mut out = Vec::<PathBuf>::new();
    if let Ok(cwd) = std::env::current_dir() {
        out.push(cwd.join("py"));
        out.push(cwd.join("src-tauri").join("py"));
    }
    out.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("py"));
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            out.push(parent.join("py"));
            out.push(parent.join("resources").join("py"));
        }
    }
    out.sort();
    out.dedup();
    out
}

fn resolve_python_workdir_from_candidates(candidates: &[PathBuf]) -> Option<PathBuf> {
    for candidate in candidates {
        if candidate.join("eval_engine").is_dir() {
            return Some(candidate.clone());
        }
    }
    None
}

fn resolve_python_workdir() -> Result<PathBuf, String> {
    let candidates = python_workdir_candidates();
    resolve_python_workdir_from_candidates(&candidates).ok_or_else(|| {
        format!(
            "Unable to locate eval_engine runtime directory. Checked: {}",
            candidates
                .iter()
                .map(|item| item.to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )
    })
}

fn python_runtimes() -> Vec<PythonRuntime> {
    #[cfg(target_family = "windows")]
    {
        vec![
            PythonRuntime {
                command: "py",
                pre_args: &["-3"],
            },
            PythonRuntime {
                command: "python",
                pre_args: &[],
            },
        ]
    }
    #[cfg(not(target_family = "windows"))]
    {
        vec![
            PythonRuntime {
                command: "python3",
                pre_args: &[],
            },
            PythonRuntime {
                command: "python",
                pre_args: &[],
            },
        ]
    }
}

fn detect_python_runtime(workdir: &Path) -> Result<PythonRuntime, String> {
    let mut launch_errors = Vec::<String>::new();
    for runtime in python_runtimes() {
        let probe = Command::new(runtime.command)
            .args(runtime.pre_args)
            .arg("-c")
            .arg("import sys; print(sys.version)")
            .current_dir(workdir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output();

        match probe {
            Ok(value) => {
                if value.status.success() {
                    return Ok(runtime);
                }
                let stderr = String::from_utf8_lossy(&value.stderr).trim().to_string();
                let stdout = String::from_utf8_lossy(&value.stdout).trim().to_string();
                let detail = if !stderr.is_empty() {
                    stderr
                } else if !stdout.is_empty() {
                    stdout
                } else {
                    "runtime probe failed".to_string()
                };
                launch_errors.push(format!("{}: {detail}", runtime_label(&runtime)));
            }
            Err(err) => launch_errors.push(format!("{}: {err}", runtime_label(&runtime))),
        }
    }

    Err(format!(
        "Failed to detect a usable Python runtime. {}",
        launch_errors.join("; ")
    ))
}

fn run_eval_engine(
    args: &[String],
    control: Option<&Arc<EvalRunControl>>,
    timeout_secs: u64,
) -> Result<std::process::Output, String> {
    let workdir = resolve_python_workdir()?;
    let runtime = detect_python_runtime(&workdir)?;
    let runtime_name = runtime_label(&runtime);
    let mut child = Command::new(runtime.command)
        .args(runtime.pre_args)
        .arg("-m")
        .arg("eval_engine")
        .args(args)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .current_dir(&workdir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to launch eval_engine via {runtime_name}: {e}"))?;

    let start = std::time::Instant::now();
    loop {
        if let Some(run_control) = control {
            if run_control.cancelled.load(Ordering::Relaxed) {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Evaluation cancelled by user.".to_string());
            }
        }

        match child
            .try_wait()
            .map_err(|e| format!("Failed to check eval_engine process state: {e}"))?
        {
            Some(_) => break,
            None => {
                if start.elapsed() > Duration::from_secs(timeout_secs) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("eval_engine timed out after {timeout_secs}s"));
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        }
    }

    child
        .wait_with_output()
        .map_err(|e| format!("Failed to collect eval_engine output via {runtime_name}: {e}"))
}

fn run_taxonomy_classify_impl(
    skill_name: String,
    skill_path: PathBuf,
    model: String,
    control: Option<&Arc<EvalRunControl>>,
) -> Result<SkillTaxonomyClassification, String> {
    let home = crate::root_dir::default_home_dir();
    let config = require_eval_config_with_api_key(&home)?;
    let output_dir = eval_tmp_dir("taxonomy")?;
    let output_path = output_dir.join("taxonomy-output.json");

    let mut cmd_args = vec![
        "classify".to_string(),
        "--skill-name".to_string(),
        skill_name,
        "--skill-path".to_string(),
        path_to_utf8(&skill_path)?,
        "--output-path".to_string(),
        path_to_utf8(&output_path)?,
        "--api-key".to_string(),
        config.api_key.clone(),
        "--model".to_string(),
        normalize_model(&model),
        "--provider".to_string(),
        config.provider.clone(),
    ];

    if let Some(base_url) = config.base_url.as_ref() {
        cmd_args.push("--base-url".to_string());
        cmd_args.push(base_url.clone());
    }

    let output = run_eval_engine(&cmd_args, control, TAXONOMY_TIMEOUT_SECS)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = fs::remove_dir_all(&output_dir);
        return Err(format!(
            "Python taxonomy classify failed: {}",
            stderr.trim()
        ));
    }

    let raw = fs::read_to_string(&output_path)
        .map_err(|e| format!("Read taxonomy output failed: {e}"))?;
    let parsed = serde_json::from_str::<TaxonomyClassifyOutput>(&raw)
        .map_err(|e| format!("Parse taxonomy output failed: {e}"))?;
    let _ = fs::remove_dir_all(&output_dir);
    if parsed.status.trim().eq_ignore_ascii_case("success") {
        let taxonomy = parsed
            .taxonomy
            .ok_or_else(|| "Taxonomy result missing `taxonomy` payload".to_string())?;
        normalize_taxonomy(taxonomy)
    } else {
        Err(parsed
            .message
            .unwrap_or_else(|| "taxonomy classification returned error status".to_string()))
    }
}

fn ensure_skill_taxonomy(
    skill_name: &str,
    skill_path: &Path,
    model: &str,
    control: Option<&Arc<EvalRunControl>>,
) -> EnsureSkillTaxonomyResult {
    let raw = match fs::read_to_string(skill_path) {
        Ok(value) => value,
        Err(err) => {
            return EnsureSkillTaxonomyResult {
                status: "failed".to_string(),
                message: format!("Read SKILL.md failed: {err}"),
                applied: false,
                taxonomy: None,
            };
        }
    };
    let (mut frontmatter, body) = match split_skill_frontmatter(&raw) {
        Ok(value) => value,
        Err(err) => {
            return EnsureSkillTaxonomyResult {
                status: "failed".to_string(),
                message: err,
                applied: false,
                taxonomy: None,
            };
        }
    };

    if let Some(existing) = taxonomy_from_frontmatter(&frontmatter) {
        return EnsureSkillTaxonomyResult {
            status: "skipped".to_string(),
            message: "Taxonomy already present.".to_string(),
            applied: false,
            taxonomy: Some(existing),
        };
    }

    let classified = match run_taxonomy_classify_impl(
        skill_name.to_string(),
        skill_path.to_path_buf(),
        model.to_string(),
        control,
    ) {
        Ok(value) => value,
        Err(err) => {
            return EnsureSkillTaxonomyResult {
                status: "failed".to_string(),
                message: format!("Taxonomy classification failed: {err}"),
                applied: false,
                taxonomy: None,
            };
        }
    };

    apply_taxonomy_to_frontmatter(&mut frontmatter, &classified);
    let next = match build_skill_markdown(&frontmatter, &body) {
        Ok(value) => value,
        Err(err) => {
            return EnsureSkillTaxonomyResult {
                status: "failed".to_string(),
                message: err,
                applied: false,
                taxonomy: None,
            };
        }
    };
    if let Err(err) = fs::write(skill_path, next) {
        return EnsureSkillTaxonomyResult {
            status: "failed".to_string(),
            message: format!("Write SKILL.md failed: {err}"),
            applied: false,
            taxonomy: None,
        };
    }
    let home = crate::root_dir::default_home_dir();
    let skills_root = crate::root_dir::default_root_dir();
    if let Err(err) =
        crate::setup::sync_saved_skill_to_copy_tools_with_home(&home, &skills_root, skill_name)
    {
        eprintln!("copy-mode incremental sync failed after taxonomy write: {err}");
    }

    EnsureSkillTaxonomyResult {
        status: "applied".to_string(),
        message: "Taxonomy applied from AI classifier.".to_string(),
        applied: true,
        taxonomy: Some(classified),
    }
}

fn select_eval_strategy_by_sok(_taxonomy: Option<&SkillTaxonomyClassification>) -> EvalStrategy {
    EvalStrategy::Default
}

async fn run_eval_blocking<T, F>(
    task_name: &'static str,
    timeout_secs: u64,
    task: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let task = tauri::async_runtime::spawn_blocking(move || {
        let (sender, receiver) = mpsc::sync_channel::<Result<T, String>>(1);
        std::thread::spawn(move || {
            let result = panic::catch_unwind(AssertUnwindSafe(task));
            let payload = match result {
                Ok(inner) => inner,
                Err(panic_payload) => {
                    let detail = if let Some(message) = panic_payload.downcast_ref::<&str>() {
                        (*message).to_string()
                    } else if let Some(message) = panic_payload.downcast_ref::<String>() {
                        message.clone()
                    } else {
                        "unknown panic payload".to_string()
                    };
                    Err(format!("panic in {task_name}: {detail}"))
                }
            };
            let _ = sender.send(payload);
        });

        match receiver.recv_timeout(Duration::from_secs(timeout_secs)) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => {
                Err(format!("{task_name} timed out after {timeout_secs}s"))
            }
            Err(RecvTimeoutError::Disconnected) => Err(format!(
                "{task_name} runner disconnected before returning a result"
            )),
        }
    });
    task.await
        .map_err(|e| format!("Run {task_name} task failed: {e}"))?
}

fn run_trigger_eval_impl(
    skill_name: String,
    eval_set_path: PathBuf,
    env_type: String,
    installed_skills_dir: Option<PathBuf>,
    model: String,
    control: Option<&Arc<EvalRunControl>>,
) -> Result<TriggerEvalOutput, String> {
    let home = crate::root_dir::default_home_dir();
    let config = require_eval_config_with_api_key(&home)?;
    let output_dir = eval_tmp_dir("trigger")?;
    let output_path = output_dir.join("trigger-output.json");
    let output_path_str = path_to_utf8(&output_path)?;

    let mut cmd_args = vec![
        "trigger".to_string(),
        "--skill-name".to_string(),
        skill_name,
        "--eval-set-path".to_string(),
        path_to_utf8(&eval_set_path)?,
        "--output-path".to_string(),
        output_path_str.clone(),
        "--env-type".to_string(),
        env_type,
        "--api-key".to_string(),
        config.api_key.clone(),
        "--model".to_string(),
        normalize_model(&model),
    ];

    if let Some(base_url) = config.base_url.as_ref() {
        cmd_args.push("--base-url".to_string());
        cmd_args.push(base_url.clone());
    }

    if let Some(dir) = installed_skills_dir {
        cmd_args.push("--installed-skills-dir".to_string());
        cmd_args.push(path_to_utf8(&dir)?);
    }

    let eval_case_count =
        read_eval_set_case_count(&eval_set_path).unwrap_or(DEFAULT_TRIGGER_CASE_COUNT);
    let timeout_secs = timeout_secs_for_case_count(eval_case_count);
    let output = run_eval_engine(&cmd_args, control, timeout_secs)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = fs::remove_dir_all(&output_dir);
        return Err(format!("Python trigger eval failed: {}", stderr.trim()));
    }

    let raw = fs::read_to_string(&output_path)
        .map_err(|e| format!("Read trigger eval output failed: {e}"))?;
    let parsed = serde_json::from_str::<TriggerEvalOutput>(&raw)
        .map_err(|e| format!("Parse trigger eval output failed: {e}"))?;
    let _ = fs::remove_dir_all(&output_dir);
    Ok(parsed)
}

fn run_functional_eval_impl(
    skill_name: String,
    skill_path: PathBuf,
    eval_set_path: PathBuf,
    compare_mode: String,
    model: String,
    judge_models: Option<Vec<String>>,
    control: Option<&Arc<EvalRunControl>>,
) -> Result<FunctionalEvalOutput, String> {
    let home = crate::root_dir::default_home_dir();
    let config = require_eval_config_with_api_key(&home)?;
    let output_dir = eval_tmp_dir("functional")?;
    let summary_path = output_dir.join("summary.json");

    let mut cmd_args = vec![
        "functional".to_string(),
        "--skill-name".to_string(),
        skill_name,
        "--skill-path".to_string(),
        path_to_utf8(&skill_path)?,
        "--eval-set-path".to_string(),
        path_to_utf8(&eval_set_path)?,
        "--output-dir".to_string(),
        path_to_utf8(&output_dir)?,
        "--compare-mode".to_string(),
        compare_mode,
        "--api-key".to_string(),
        config.api_key.clone(),
        "--model".to_string(),
        normalize_model(&model),
        "--provider".to_string(),
        config.provider.clone(),
    ];

    if let Some(base_url) = config.base_url.as_ref() {
        cmd_args.push("--base-url".to_string());
        cmd_args.push(base_url.clone());
    }

    if let Some(models) = judge_models {
        let normalized = models
            .into_iter()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect::<Vec<_>>();
        if !normalized.is_empty() {
            cmd_args.push("--judge-models".to_string());
            cmd_args.push(normalized.join(","));
        }
    }

    let eval_case_count =
        read_eval_set_case_count(&eval_set_path).unwrap_or(DEFAULT_FUNCTIONAL_CASE_COUNT);
    let timeout_secs = timeout_secs_for_case_count(eval_case_count);
    let output = run_eval_engine(&cmd_args, control, timeout_secs)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = fs::remove_dir_all(&output_dir);
        return Err(format!("Python functional eval failed: {}", stderr.trim()));
    }

    let raw = fs::read_to_string(&summary_path)
        .map_err(|e| format!("Read functional eval output failed: {e}"))?;
    let parsed = serde_json::from_str::<FunctionalEvalOutput>(&raw)
        .map_err(|e| format!("Parse functional eval output failed: {e}"))?;
    let _ = fs::remove_dir_all(&output_dir);
    Ok(parsed)
}

fn normalize_eval_mode(value: &str) -> Result<&'static str, String> {
    match value.trim().to_lowercase().as_str() {
        "quick" => Ok("quick"),
        "standard" => Ok("standard"),
        "full" => Ok("full"),
        other => Err(format!(
            "Unsupported eval mode '{other}'. Expected one of: quick, standard, full."
        )),
    }
}

fn functional_compare_mode_for_mode(mode: &str) -> &'static str {
    let _ = mode;
    "no_skill"
}

fn safe_trigger_summary(output: &TriggerEvalOutput) -> TriggerEvalSummary {
    output.summary.clone().unwrap_or(TriggerEvalSummary {
        total: 0,
        passed: 0,
        failed: 0,
        pass_rate: 0.0,
    })
}

fn safe_functional_summary(output: &FunctionalEvalOutput) -> FunctionalEvalSummary {
    output.summary.clone().unwrap_or(FunctionalEvalSummary {
        total: 0,
        passed: 0,
        failed: 0,
        pass_rate: 0.0,
    })
}

fn skipped_functional_output(skill_name: &str, message: &str) -> FunctionalEvalOutput {
    FunctionalEvalOutput {
        status: "skipped".to_string(),
        skill_name: Some(skill_name.to_string()),
        summary: Some(FunctionalEvalSummary {
            total: 0,
            passed: 0,
            failed: 0,
            pass_rate: 0.0,
        }),
        dimension_scores: Some(HashMap::new()),
        results: Some(Vec::new()),
        message: Some(message.to_string()),
    }
}

fn combine_trigger_results_for_metrics(
    clean: &TriggerEvalOutput,
    complex: Option<&TriggerEvalOutput>,
) -> Vec<TriggerEvalResultItem> {
    let mut out = clean.results.clone().unwrap_or_default();
    if let Some(extra) = complex {
        out.extend(extra.results.clone().unwrap_or_default());
    }
    out
}

fn compute_trigger_metrics(results: &[TriggerEvalResultItem]) -> EvalTriggerMetrics {
    let mut tp = 0_i32;
    let mut tn = 0_i32;
    let mut fp = 0_i32;
    let mut fn_count = 0_i32;

    for item in results {
        let should = item.should_trigger;
        let triggered_target =
            item.triggered && item.triggered_skill_name.as_deref().is_some() && item.pass;
        let triggered_any = item.triggered;
        if should && triggered_target {
            tp += 1;
        } else if should && !triggered_target {
            fn_count += 1;
        } else if !should && triggered_any {
            fp += 1;
        } else {
            tn += 1;
        }
    }

    let precision = if tp + fp > 0 {
        tp as f64 / (tp + fp) as f64
    } else {
        0.0
    };
    let recall = if tp + fn_count > 0 {
        tp as f64 / (tp + fn_count) as f64
    } else {
        0.0
    };
    let fpr = if fp + tn > 0 {
        fp as f64 / (fp + tn) as f64
    } else {
        0.0
    };

    EvalTriggerMetrics {
        precision,
        recall,
        fpr,
        true_positive: tp,
        true_negative: tn,
        false_positive: fp,
        false_negative: fn_count,
    }
}

fn round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

fn mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        0.0
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    }
}

fn median(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = sorted.len() / 2;
    if sorted.len() % 2 == 0 {
        (sorted[mid - 1] + sorted[mid]) / 2.0
    } else {
        sorted[mid]
    }
}

fn std_dev(values: &[f64], avg: f64) -> f64 {
    if values.len() <= 1 {
        return 0.0;
    }
    let variance = values
        .iter()
        .map(|value| {
            let delta = value - avg;
            delta * delta
        })
        .sum::<f64>()
        / values.len() as f64;
    variance.sqrt()
}

fn summarize_rates(values: &[f64]) -> EvalRateStats {
    let avg = mean(values);
    EvalRateStats {
        mean: round4(avg),
        median: round4(median(values)),
        std_dev: round4(std_dev(values, avg)),
    }
}

fn parse_json_file_case_count(path: &Path) -> Result<usize, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("Read JSON file failed: {e}"))?;
    parse_json_case_count(&raw)
}

fn normalize_judge_models(
    primary_model: &str,
    mode: &str,
    judge_models: Option<Vec<String>>,
) -> Vec<String> {
    let mut out = judge_models
        .unwrap_or_default()
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    if out.is_empty() {
        out.push(primary_model.to_string());
    }
    if mode == "full" && out.len() < 2 {
        let fallback = DEFAULT_MODEL.to_string();
        if !out.iter().any(|item| item == &fallback) {
            out.push(fallback);
        }
    }
    out
}

fn estimate_cost(
    trigger_cases: usize,
    functional_cases: usize,
    trigger_runs: usize,
    functional_runs: usize,
    budget_limit: Option<f64>,
) -> EvalCostEstimate {
    let api_calls_estimate = (trigger_cases * trigger_runs) + (functional_cases * functional_runs);
    let estimated_usd = (trigger_cases * trigger_runs) as f64 * ESTIMATED_USD_PER_TRIGGER_CASE
        + (functional_cases * functional_runs) as f64 * ESTIMATED_USD_PER_FUNCTIONAL_CASE;

    EvalCostEstimate {
        estimated_usd,
        actual_usd_estimate: estimated_usd,
        trigger_cases,
        functional_cases,
        api_calls_estimate,
        budget_limit_usd: budget_limit,
        budget_exceeded: budget_limit.is_some_and(|limit| estimated_usd > limit),
    }
}

fn compute_skill_hash(skill_path: &Path) -> Option<String> {
    let Ok(bytes) = fs::read(skill_path) else {
        return None;
    };
    let digest = Sha256::digest(bytes);
    Some(format!("{digest:x}"))
}

fn persist_pipeline_history(
    home: &Path,
    skill_name: &str,
    output: &EvalPipelineOutput,
) -> Result<Option<String>, String> {
    let history_dir = eval_history_dir(home, Some(skill_name));
    fs::create_dir_all(&history_dir).map_err(|e| format!("Create eval history dir failed: {e}"))?;

    let iteration = fs::read_dir(&history_dir)
        .map_err(|e| format!("Read eval history dir failed: {e}"))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().extension().and_then(|item| item.to_str()) == Some("json"))
        .count()
        + 1;

    let ts = now_unix_secs()?;
    let file_path = history_dir.join(format!("iteration-{iteration}-{ts}.json"));
    let raw = serde_json::to_string_pretty(output)
        .map_err(|e| format!("Serialize eval pipeline output failed: {e}"))?;
    fs::write(&file_path, format!("{raw}\n"))
        .map_err(|e| format!("Write eval pipeline history failed: {e}"))?;
    Ok(Some(path_to_utf8(&file_path)?))
}

#[allow(clippy::too_many_arguments)]
fn run_eval_pipeline_impl(
    app_handle: tauri::AppHandle,
    run_id: String,
    control: Arc<EvalRunControl>,
    skill_name: String,
    skill_path: PathBuf,
    trigger_eval_set_path: PathBuf,
    functional_eval_set_path: PathBuf,
    mode: String,
    model: String,
    installed_skills_dir: Option<PathBuf>,
    judge_models: Option<Vec<String>>,
    repeats: Option<usize>,
    seed: Option<u64>,
    temperature: Option<f64>,
    max_cost_usd: Option<f64>,
) -> Result<EvalPipelineOutput, String> {
    let home = crate::root_dir::default_home_dir();
    let mode = normalize_eval_mode(&mode)?.to_string();
    let primary_model = normalize_model(&model);
    let judge_models = normalize_judge_models(&primary_model, &mode, judge_models);
    let repeats = repeats.unwrap_or(DEFAULT_PIPELINE_REPEATS).max(1);
    let temp = temperature.unwrap_or(0.0);
    let taxonomy_result =
        ensure_skill_taxonomy(&skill_name, &skill_path, &primary_model, Some(&control));
    match select_eval_strategy_by_sok(taxonomy_result.taxonomy.as_ref()) {
        EvalStrategy::Default => {}
    }
    let total_steps_per_repeat = match mode.as_str() {
        "quick" => 1,
        "standard" => 3,
        "full" => 4,
        _ => 1,
    };
    let total_steps = total_steps_per_repeat * repeats;

    let trigger_cases = parse_json_file_case_count(&trigger_eval_set_path)?;
    let functional_cases = if mode == "quick" {
        0
    } else {
        parse_json_file_case_count(&functional_eval_set_path)?
    };
    let trigger_runs_per_repeat = if mode == "full" { 2 } else { 1 };
    let functional_runs_per_repeat = if mode == "quick" { 0 } else { 2 };
    let estimated = estimate_cost(
        trigger_cases,
        functional_cases,
        trigger_runs_per_repeat * repeats,
        functional_runs_per_repeat * repeats,
        max_cost_usd,
    );
    if estimated.budget_exceeded {
        return Err(format!(
            "Estimated cost ${:.4} exceeds budget limit ${:.4}.",
            estimated.estimated_usd,
            max_cost_usd.unwrap_or_default()
        ));
    }

    let start = std::time::Instant::now();
    let mut executed_steps = 0usize;
    push_pipeline_progress(
        &app_handle,
        &run_id,
        "running",
        0,
        repeats,
        0,
        total_steps,
        "pipeline",
        "Evaluation pipeline started.",
        start.elapsed().as_millis(),
    );
    if taxonomy_result.status == "failed" {
        push_pipeline_progress(
            &app_handle,
            &run_id,
            "running",
            0,
            repeats,
            0,
            total_steps,
            "taxonomy",
            &format!(
                "Taxonomy classification warning: {}",
                taxonomy_result.message
            ),
            start.elapsed().as_millis(),
        );
    }
    let mut last_trigger_clean: Option<TriggerEvalOutput> = None;
    let mut last_trigger_complex: Option<TriggerEvalOutput> = None;
    let mut last_functional: Option<FunctionalEvalOutput> = None;
    let mut last_functional_without_skill: Option<FunctionalEvalOutput> = None;
    let mut trigger_rows_for_metrics: Vec<TriggerEvalResultItem> = Vec::new();
    let mut overall_pass_rates: Vec<f64> = Vec::with_capacity(repeats);
    let mut trigger_pass_rates: Vec<f64> = Vec::with_capacity(repeats);
    let mut robustness_rates: Vec<f64> = Vec::with_capacity(repeats);
    let mut functional_pass_rates: Vec<f64> = Vec::new();
    let mut without_skill_pass_rates: Vec<f64> = Vec::new();
    let mut value_added_rates: Vec<f64> = Vec::new();

    for repeat_index in 0..repeats {
        let current_repeat = repeat_index + 1;

        let next_step = executed_steps + 1;
        wait_if_paused_or_cancelled(
            &control,
            &app_handle,
            &run_id,
            current_repeat,
            repeats,
            next_step,
            total_steps,
            "trigger_clean",
            start.elapsed().as_millis(),
        )?;
        push_pipeline_progress(
            &app_handle,
            &run_id,
            "running",
            current_repeat,
            repeats,
            next_step,
            total_steps,
            "trigger_clean",
            &format!("Round {current_repeat}/{repeats}: running trigger eval (clean)."),
            start.elapsed().as_millis(),
        );
        let trigger_clean = run_trigger_eval_impl(
            skill_name.clone(),
            trigger_eval_set_path.clone(),
            "clean".to_string(),
            installed_skills_dir.clone(),
            primary_model.clone(),
            Some(&control),
        )
        .map_err(|err| {
            push_pipeline_progress(
                &app_handle,
                &run_id,
                status_for_error(&err),
                current_repeat,
                repeats,
                next_step,
                total_steps,
                "trigger_clean",
                &format!("Round {current_repeat}/{repeats}: trigger clean failed: {err}"),
                start.elapsed().as_millis(),
            );
            err
        })?;
        executed_steps += 1;
        if let Some(rows) = trigger_clean.results.clone() {
            trigger_rows_for_metrics.extend(rows);
        }
        let clean_summary = safe_trigger_summary(&trigger_clean);
        trigger_pass_rates.push(clean_summary.pass_rate);
        let mut repeat_trigger_total = clean_summary.total;
        let mut repeat_trigger_passed = clean_summary.passed;
        last_trigger_clean = Some(trigger_clean);

        if mode == "full" {
            let next_step = executed_steps + 1;
            wait_if_paused_or_cancelled(
                &control,
                &app_handle,
                &run_id,
                current_repeat,
                repeats,
                next_step,
                total_steps,
                "trigger_complex",
                start.elapsed().as_millis(),
            )?;
            push_pipeline_progress(
                &app_handle,
                &run_id,
                "running",
                current_repeat,
                repeats,
                next_step,
                total_steps,
                "trigger_complex",
                &format!("Round {current_repeat}/{repeats}: running trigger eval (complex)."),
                start.elapsed().as_millis(),
            );
            let trigger_complex = run_trigger_eval_impl(
                skill_name.clone(),
                trigger_eval_set_path.clone(),
                "complex".to_string(),
                installed_skills_dir.clone(),
                primary_model.clone(),
                Some(&control),
            )
            .map_err(|err| {
                push_pipeline_progress(
                    &app_handle,
                    &run_id,
                    status_for_error(&err),
                    current_repeat,
                    repeats,
                    next_step,
                    total_steps,
                    "trigger_complex",
                    &format!("Round {current_repeat}/{repeats}: trigger complex failed: {err}"),
                    start.elapsed().as_millis(),
                );
                err
            })?;
            executed_steps += 1;
            if let Some(rows) = trigger_complex.results.clone() {
                trigger_rows_for_metrics.extend(rows);
            }
            let summary = safe_trigger_summary(&trigger_complex);
            repeat_trigger_total += summary.total;
            repeat_trigger_passed += summary.passed;
            robustness_rates.push(summary.pass_rate);
            last_trigger_complex = Some(trigger_complex);
        } else {
            robustness_rates.push(clean_summary.pass_rate);
        }

        if mode == "quick" {
            last_functional = Some(skipped_functional_output(
                &skill_name,
                "Skipped in quick mode (trigger + structure gate only).",
            ));
            let repeat_total = repeat_trigger_total;
            let repeat_passed = repeat_trigger_passed;
            overall_pass_rates.push(if repeat_total > 0 {
                repeat_passed as f64 / repeat_total as f64
            } else {
                0.0
            });
        } else {
            let next_step = executed_steps + 1;
            wait_if_paused_or_cancelled(
                &control,
                &app_handle,
                &run_id,
                current_repeat,
                repeats,
                next_step,
                total_steps,
                "functional_with_skill",
                start.elapsed().as_millis(),
            )?;
            push_pipeline_progress(
                &app_handle,
                &run_id,
                "running",
                current_repeat,
                repeats,
                next_step,
                total_steps,
                "functional_with_skill",
                &format!("Round {current_repeat}/{repeats}: running functional eval (with skill)."),
                start.elapsed().as_millis(),
            );
            let functional = run_functional_eval_impl(
                skill_name.clone(),
                skill_path.clone(),
                functional_eval_set_path.clone(),
                functional_compare_mode_for_mode(&mode).to_string(),
                primary_model.clone(),
                Some(judge_models.clone()),
                Some(&control),
            )
            .map_err(|err| {
                push_pipeline_progress(
                    &app_handle,
                    &run_id,
                    status_for_error(&err),
                    current_repeat,
                    repeats,
                    next_step,
                    total_steps,
                    "functional_with_skill",
                    &format!(
                        "Round {current_repeat}/{repeats}: functional(with skill) failed: {err}"
                    ),
                    start.elapsed().as_millis(),
                );
                err
            })?;
            executed_steps += 1;
            let functional_summary = safe_functional_summary(&functional);
            functional_pass_rates.push(functional_summary.pass_rate);
            last_functional = Some(functional);

            let next_step = executed_steps + 1;
            wait_if_paused_or_cancelled(
                &control,
                &app_handle,
                &run_id,
                current_repeat,
                repeats,
                next_step,
                total_steps,
                "functional_without_skill",
                start.elapsed().as_millis(),
            )?;
            push_pipeline_progress(
                &app_handle,
                &run_id,
                "running",
                current_repeat,
                repeats,
                next_step,
                total_steps,
                "functional_without_skill",
                &format!(
                    "Round {current_repeat}/{repeats}: running functional eval (without skill)."
                ),
                start.elapsed().as_millis(),
            );
            let functional_without_skill = run_functional_eval_impl(
                skill_name.clone(),
                skill_path.clone(),
                functional_eval_set_path.clone(),
                "without_skill".to_string(),
                primary_model.clone(),
                Some(judge_models.clone()),
                Some(&control),
            )
            .map_err(|err| {
                push_pipeline_progress(
                    &app_handle,
                    &run_id,
                    status_for_error(&err),
                    current_repeat,
                    repeats,
                    next_step,
                    total_steps,
                    "functional_without_skill",
                    &format!(
                        "Round {current_repeat}/{repeats}: functional(without skill) failed: {err}"
                    ),
                    start.elapsed().as_millis(),
                );
                err
            })?;
            executed_steps += 1;
            let without_summary = safe_functional_summary(&functional_without_skill);
            without_skill_pass_rates.push(without_summary.pass_rate);
            value_added_rates.push(functional_summary.pass_rate - without_summary.pass_rate);
            last_functional_without_skill = Some(functional_without_skill);

            let repeat_total = repeat_trigger_total + functional_summary.total;
            let repeat_passed = repeat_trigger_passed + functional_summary.passed;
            overall_pass_rates.push(if repeat_total > 0 {
                repeat_passed as f64 / repeat_total as f64
            } else {
                0.0
            });
        }

        push_pipeline_progress(
            &app_handle,
            &run_id,
            "running",
            current_repeat,
            repeats,
            executed_steps,
            total_steps,
            "repeat_complete",
            &format!("Round {current_repeat}/{repeats} completed."),
            start.elapsed().as_millis(),
        );
    }

    let trigger_clean =
        last_trigger_clean.ok_or_else(|| "Missing trigger clean report".to_string())?;
    let trigger_complex = last_trigger_complex;
    let functional = last_functional.ok_or_else(|| "Missing functional report".to_string())?;
    let functional_without_skill = last_functional_without_skill;

    let clean_summary = safe_trigger_summary(&trigger_clean);
    let functional_summary = safe_functional_summary(&functional);
    let complex_summary = trigger_complex.as_ref().map(safe_trigger_summary);
    let overall_stats = summarize_rates(&overall_pass_rates);
    let trigger_stats = summarize_rates(&trigger_pass_rates);
    let robustness_stats = summarize_rates(&robustness_rates);
    let functional_stats = if functional_pass_rates.is_empty() {
        None
    } else {
        Some(summarize_rates(&functional_pass_rates))
    };
    let without_skill_stats = if without_skill_pass_rates.is_empty() {
        None
    } else {
        Some(summarize_rates(&without_skill_pass_rates))
    };
    let value_added_stats = if value_added_rates.is_empty() {
        None
    } else {
        Some(summarize_rates(&value_added_rates))
    };

    let trigger_total = clean_summary.total + complex_summary.as_ref().map_or(0, |item| item.total);
    let total_cases = trigger_total + functional_summary.total;
    let total_passed =
        ((overall_stats.mean * total_cases as f64).round() as i32).clamp(0, total_cases);
    let total_failed = total_cases - total_passed;

    let trigger_metrics = if trigger_rows_for_metrics.is_empty() {
        compute_trigger_metrics(&combine_trigger_results_for_metrics(
            &trigger_clean,
            trigger_complex.as_ref(),
        ))
    } else {
        compute_trigger_metrics(&trigger_rows_for_metrics)
    };

    let delta_vs_no_skill = match (functional_stats.as_ref(), without_skill_stats.as_ref()) {
        (Some(with_skill), Some(without_skill)) => Some(EvalDeltaVsNoSkill {
            with_skill_pass_rate: with_skill.mean,
            without_skill_pass_rate: without_skill.mean,
            functional_pass_rate_delta: round4(with_skill.mean - without_skill.mean),
        }),
        _ => None,
    };

    let robustness = robustness_stats.mean;
    let efficiency =
        (1.0 - (estimated.actual_usd_estimate / (estimated.actual_usd_estimate + 0.01))).max(0.0);
    let value_added = value_added_stats.as_ref().map_or(0.0, |item| item.mean);

    let mut output = EvalPipelineOutput {
        status: "success".to_string(),
        mode: mode.clone(),
        summary: EvalPipelineSummary {
            total_cases,
            total_passed,
            total_failed,
            pass_rate: overall_stats.mean,
        },
        trigger_clean,
        trigger_complex,
        functional,
        functional_without_skill,
        dimension_scores: EvalDimensionScores {
            trigger_accuracy: trigger_stats.mean,
            functional_correctness: if mode == "quick" {
                0.0
            } else {
                functional_stats.as_ref().map_or(0.0, |item| item.mean)
            },
            robustness,
            efficiency,
            value_added,
        },
        trigger_metrics,
        cost_estimate: estimated,
        delta_vs_no_skill,
        repeat_stats: EvalRepeatStats {
            overall_pass_rate: overall_stats.clone(),
            trigger_pass_rate: trigger_stats,
            functional_pass_rate: functional_stats,
            robustness: robustness_stats,
            value_added: value_added_stats,
        },
        run_meta: EvalRunMeta {
            mode: mode.clone(),
            model: primary_model,
            judge_models,
            repeats,
            seed,
            temperature: temp,
            executed_steps,
            elapsed_ms: start.elapsed().as_millis(),
            skill_hash: compute_skill_hash(&skill_path),
        },
        taxonomy_status: Some(taxonomy_result.status.clone()),
        taxonomy_message: Some(taxonomy_result.message.clone()),
        taxonomy_applied: Some(taxonomy_result.applied),
        history_path: None,
        message: None,
    };

    output.history_path = persist_pipeline_history(&home, &skill_name, &output)?;
    push_pipeline_progress(
        &app_handle,
        &run_id,
        "completed",
        repeats,
        repeats,
        total_steps,
        total_steps,
        "pipeline",
        "Evaluation pipeline completed.",
        start.elapsed().as_millis(),
    );
    Ok(output)
}

fn parse_json_case_count(raw: &str) -> Result<usize, String> {
    let value = serde_json::from_str::<serde_json::Value>(raw)
        .map_err(|e| format!("Parse JSON failed: {e}"))?;
    let Some(items) = value.as_array() else {
        return Err("Expected top-level JSON array".to_string());
    };
    Ok(items.len())
}

fn read_eval_set_case_count(path: &Path) -> Result<usize, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("Read eval set failed: {e}"))?;
    parse_json_case_count(&raw)
}

fn timeout_secs_for_case_count(case_count: usize) -> u64 {
    let safe_cases = case_count.max(1) as u64;
    let computed =
        EVAL_TIMEOUT_SECS.saturating_add(safe_cases.saturating_mul(EVAL_TIMEOUT_PER_CASE_SECS));
    computed.clamp(EVAL_TIMEOUT_SECS, MAX_EVAL_TIMEOUT_SECS)
}

fn estimate_pipeline_case_count(
    mode: &str,
    trigger_cases: usize,
    functional_cases: usize,
    repeats: usize,
) -> usize {
    let trigger_runs_per_repeat = if mode == "full" { 2 } else { 1 };
    let functional_runs_per_repeat = match mode {
        "quick" => 0,
        "full" => 2,
        _ => 1,
    };

    let per_repeat = trigger_cases
        .saturating_mul(trigger_runs_per_repeat)
        .saturating_add(functional_cases.saturating_mul(functional_runs_per_repeat))
        .max(1);
    per_repeat.saturating_mul(repeats.max(1))
}

fn eval_generate_samples_impl(
    skill_name: String,
    skill_path: PathBuf,
    model: String,
    trigger_count: Option<usize>,
    functional_count: Option<usize>,
) -> Result<EvalSampleDrafts, String> {
    let home = crate::root_dir::default_home_dir();
    let config = require_eval_config_with_api_key(&home)?;
    if config.provider != DEFAULT_PROVIDER {
        return Err(format!(
            "Unsupported provider '{}' for sample generation. Current version supports {DEFAULT_PROVIDER} only.",
            config.provider
        ));
    }

    let trigger_count = trigger_count.unwrap_or(DEFAULT_TRIGGER_CASE_COUNT).max(2);
    let functional_count = functional_count
        .unwrap_or(DEFAULT_FUNCTIONAL_CASE_COUNT)
        .max(1);
    let output_dir = eval_tmp_dir("samples")?;
    let trigger_path = output_dir.join("trigger.json");
    let functional_path = output_dir.join("functional.json");

    let mut cmd_args = vec![
        "generate-samples".to_string(),
        "--skill-name".to_string(),
        skill_name,
        "--skill-path".to_string(),
        path_to_utf8(&skill_path)?,
        "--trigger-count".to_string(),
        trigger_count.to_string(),
        "--functional-count".to_string(),
        functional_count.to_string(),
        "--api-key".to_string(),
        config.api_key.clone(),
        "--model".to_string(),
        normalize_model(&model),
        "--provider".to_string(),
        config.provider.clone(),
        "--output-dir".to_string(),
        path_to_utf8(&output_dir)?,
    ];

    if let Some(base_url) = config.base_url.as_ref() {
        cmd_args.push("--base-url".to_string());
        cmd_args.push(base_url.clone());
    }

    let timeout_secs = timeout_secs_for_case_count(trigger_count.saturating_add(functional_count));
    let output = run_eval_engine(&cmd_args, None, timeout_secs)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = fs::remove_dir_all(&output_dir);
        return Err(format!(
            "Python sample generation failed: {}",
            stderr.trim()
        ));
    }

    let trigger_draft = fs::read_to_string(&trigger_path)
        .map_err(|e| format!("Read trigger sample draft failed: {e}"))?;
    let functional_draft = fs::read_to_string(&functional_path)
        .map_err(|e| format!("Read functional sample draft failed: {e}"))?;

    let trigger_case_count = parse_json_case_count(&trigger_draft)?;
    let functional_case_count = parse_json_case_count(&functional_draft)?;
    let _ = fs::remove_dir_all(&output_dir);

    Ok(EvalSampleDrafts {
        trigger_draft,
        functional_draft,
        trigger_count: trigger_case_count,
        functional_count: functional_case_count,
    })
}

fn resolve_eval_dataset_path(
    home: &Path,
    requested: Option<PathBuf>,
    kind: Option<&str>,
    skill_name: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(path) = requested {
        return Ok(path);
    }
    let dataset_dir = eval_dataset_dir(home, skill_name);
    fs::create_dir_all(&dataset_dir).map_err(|e| format!("Create dataset dir failed: {e}"))?;
    let kind_segment = sanitize_path_segment(kind.unwrap_or("dataset"), "dataset");
    let skill_segment = sanitize_path_segment(skill_name.unwrap_or("skill"), "skill");
    let ts = now_unix_secs()?;
    Ok(dataset_dir.join(format!("{skill_segment}-{kind_segment}-{ts}.json")))
}

fn eval_save_dataset_impl(
    home: &Path,
    path: Option<PathBuf>,
    content: String,
    kind: Option<String>,
    skill_name: Option<String>,
) -> Result<EvalDatasetSaveResult, String> {
    let normalized = content.trim();
    if normalized.is_empty() {
        return Err("Dataset content is required".to_string());
    }
    serde_json::from_str::<serde_json::Value>(normalized)
        .map_err(|e| format!("Dataset JSON is invalid: {e}"))?;

    let resolved_path =
        resolve_eval_dataset_path(home, path, kind.as_deref(), skill_name.as_deref())?;

    if let Some(parent) = resolved_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Create dataset parent dir failed: {e}"))?;
    }
    fs::write(&resolved_path, format!("{normalized}\n"))
        .map_err(|e| format!("Write dataset failed: {e}"))?;
    Ok(EvalDatasetSaveResult {
        success: true,
        path: path_to_utf8(&resolved_path)?,
    })
}

fn build_eval_history_entry(
    path: &Path,
    output: EvalPipelineOutput,
) -> Result<EvalHistoryEntry, String> {
    let metadata = fs::metadata(path).map_err(|e| format!("Read history metadata failed: {e}"))?;
    let saved_at_unix = metadata
        .modified()
        .map(system_time_to_unix_secs)
        .unwrap_or(0);
    let file_name = path
        .file_name()
        .map(|item| item.to_string_lossy().to_string())
        .unwrap_or_else(|| "history.json".to_string());
    Ok(EvalHistoryEntry {
        path: path_to_utf8(path)?,
        file_name,
        saved_at_unix,
        mode: output.mode,
        repeats: output.run_meta.repeats,
        pass_rate: output.summary.pass_rate,
        total_cases: output.summary.total_cases,
        model: output.run_meta.model,
        status: output.status,
    })
}

fn list_eval_history_impl(
    home: &Path,
    skill_name: String,
    limit: Option<usize>,
) -> Result<Vec<EvalHistoryEntry>, String> {
    if skill_name.trim().is_empty() {
        return Ok(Vec::new());
    }
    let history_dir = eval_history_dir(home, Some(skill_name.trim()));
    if !history_dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::<EvalHistoryEntry>::new();
    for item in
        fs::read_dir(&history_dir).map_err(|e| format!("Read eval history dir failed: {e}"))?
    {
        let Ok(item) = item else {
            continue;
        };
        let path = item.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(output) = serde_json::from_str::<EvalPipelineOutput>(&raw) else {
            continue;
        };
        let Ok(entry) = build_eval_history_entry(&path, output) else {
            continue;
        };
        entries.push(entry);
    }

    entries.sort_by(|a, b| {
        b.saved_at_unix
            .cmp(&a.saved_at_unix)
            .then_with(|| b.path.cmp(&a.path))
    });
    if let Some(max_items) = limit {
        entries.truncate(max_items.max(1));
    }
    Ok(entries)
}

fn load_eval_history_impl(path: PathBuf) -> Result<EvalPipelineOutput, String> {
    let raw = fs::read_to_string(&path).map_err(|e| format!("Read eval history failed: {e}"))?;
    serde_json::from_str::<EvalPipelineOutput>(&raw)
        .map_err(|e| format!("Parse eval history failed: {e}"))
}

#[tauri::command]
pub fn eval_get_config() -> Result<EvalConfig, String> {
    read_eval_config_with_home(&crate::root_dir::default_home_dir())
}

#[tauri::command]
pub fn eval_get_storage_paths(skill_name: Option<String>) -> Result<EvalStoragePaths, String> {
    let home = crate::root_dir::default_home_dir();
    let dataset_dir = eval_dataset_dir(&home, skill_name.as_deref());
    let history_dir = eval_history_dir(&home, skill_name.as_deref());
    Ok(EvalStoragePaths {
        dataset_dir: path_to_utf8(&dataset_dir)?,
        history_dir: path_to_utf8(&history_dir)?,
    })
}

#[tauri::command]
pub fn eval_list_history(
    skill_name: String,
    limit: Option<usize>,
) -> Result<Vec<EvalHistoryEntry>, String> {
    list_eval_history_impl(&crate::root_dir::default_home_dir(), skill_name, limit)
}

#[tauri::command]
pub fn eval_load_history(path: PathBuf) -> Result<EvalPipelineOutput, String> {
    load_eval_history_impl(path)
}

#[tauri::command]
pub fn eval_save_config(
    api_key: String,
    provider: Option<String>,
    base_url: Option<String>,
    default_model: String,
) -> Result<EvalMutationResult, String> {
    let config = EvalConfig {
        api_key: api_key.trim().to_string(),
        provider: normalize_provider(provider.as_deref().unwrap_or(DEFAULT_PROVIDER)),
        base_url: normalize_base_url(base_url),
        default_model: normalize_model(&default_model),
    };
    write_eval_config_with_home(&crate::root_dir::default_home_dir(), &config)?;
    Ok(EvalMutationResult { success: true })
}

#[tauri::command]
pub fn eval_control(run_id: String, action: String) -> Result<EvalMutationResult, String> {
    let control = get_eval_run_control(&run_id)?;
    match action.trim().to_lowercase().as_str() {
        "pause" => {
            control.paused.store(true, Ordering::Relaxed);
            Ok(EvalMutationResult { success: true })
        }
        "resume" => {
            control.paused.store(false, Ordering::Relaxed);
            Ok(EvalMutationResult { success: true })
        }
        "cancel" | "stop" => {
            control.cancelled.store(true, Ordering::Relaxed);
            Ok(EvalMutationResult { success: true })
        }
        other => Err(format!(
            "Unsupported eval control action '{other}'. Expected: pause, resume, cancel."
        )),
    }
}

#[tauri::command]
pub async fn run_trigger_eval(
    skill_name: String,
    eval_set_path: PathBuf,
    env_type: String,
    installed_skills_dir: Option<PathBuf>,
    model: String,
) -> Result<TriggerEvalOutput, String> {
    let timeout_secs = timeout_secs_for_case_count(
        read_eval_set_case_count(&eval_set_path).unwrap_or(DEFAULT_TRIGGER_CASE_COUNT),
    );
    run_eval_blocking("run_trigger_eval", timeout_secs, move || {
        run_trigger_eval_impl(
            skill_name,
            eval_set_path,
            env_type,
            installed_skills_dir,
            model,
            None,
        )
    })
    .await
}

#[tauri::command]
pub async fn run_functional_eval(
    skill_name: String,
    skill_path: PathBuf,
    eval_set_path: PathBuf,
    compare_mode: String,
    model: String,
) -> Result<FunctionalEvalOutput, String> {
    let timeout_secs = timeout_secs_for_case_count(
        read_eval_set_case_count(&eval_set_path).unwrap_or(DEFAULT_FUNCTIONAL_CASE_COUNT),
    );
    run_eval_blocking("run_functional_eval", timeout_secs, move || {
        run_functional_eval_impl(
            skill_name,
            skill_path,
            eval_set_path,
            compare_mode,
            model,
            None,
            None,
        )
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn run_eval_pipeline(
    app_handle: tauri::AppHandle,
    skill_name: String,
    skill_path: PathBuf,
    trigger_eval_set_path: PathBuf,
    functional_eval_set_path: PathBuf,
    mode: String,
    model: String,
    installed_skills_dir: Option<PathBuf>,
    judge_models: Option<Vec<String>>,
    repeats: Option<usize>,
    seed: Option<u64>,
    temperature: Option<f64>,
    max_cost_usd: Option<f64>,
    run_id: Option<String>,
) -> Result<EvalPipelineOutput, String> {
    let resolved_run_id = run_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(next_eval_run_id);
    let app_handle_for_task = app_handle.clone();
    let run_id_for_task = resolved_run_id.clone();
    let expected_repeats = repeats.unwrap_or(DEFAULT_PIPELINE_REPEATS).max(1);
    let mode_for_timeout = normalize_eval_mode(&mode).unwrap_or("standard");
    let trigger_case_count =
        read_eval_set_case_count(&trigger_eval_set_path).unwrap_or(DEFAULT_TRIGGER_CASE_COUNT);
    let functional_case_count = read_eval_set_case_count(&functional_eval_set_path)
        .unwrap_or(DEFAULT_FUNCTIONAL_CASE_COUNT);
    let timeout_secs = timeout_secs_for_case_count(estimate_pipeline_case_count(
        mode_for_timeout,
        trigger_case_count,
        functional_case_count,
        expected_repeats,
    ));
    run_eval_blocking("run_eval_pipeline", timeout_secs, move || {
        let control = register_eval_run_control(&run_id_for_task)?;
        let _guard = EvalRunControlGuard::new(run_id_for_task.clone());
        let result = run_eval_pipeline_impl(
            app_handle_for_task.clone(),
            run_id_for_task.clone(),
            control,
            skill_name,
            skill_path,
            trigger_eval_set_path,
            functional_eval_set_path,
            mode,
            model,
            installed_skills_dir,
            judge_models,
            repeats,
            seed,
            temperature,
            max_cost_usd,
        );

        if let Err(err) = result.as_ref() {
            push_pipeline_progress(
                &app_handle_for_task,
                &run_id_for_task,
                status_for_error(err),
                0,
                expected_repeats,
                0,
                0,
                "pipeline",
                err,
                0,
            );
        }
        result
    })
    .await
}

#[tauri::command]
pub async fn eval_generate_samples(
    skill_name: String,
    skill_path: PathBuf,
    model: String,
    trigger_count: Option<usize>,
    functional_count: Option<usize>,
) -> Result<EvalSampleDrafts, String> {
    let planned_case_count = trigger_count
        .unwrap_or(DEFAULT_TRIGGER_CASE_COUNT)
        .max(2)
        .saturating_add(
            functional_count
                .unwrap_or(DEFAULT_FUNCTIONAL_CASE_COUNT)
                .max(1),
        );
    let timeout_secs = timeout_secs_for_case_count(planned_case_count);
    run_eval_blocking("eval_generate_samples", timeout_secs, move || {
        eval_generate_samples_impl(
            skill_name,
            skill_path,
            model,
            trigger_count,
            functional_count,
        )
    })
    .await
}

#[tauri::command]
pub fn eval_save_dataset(
    path: Option<PathBuf>,
    content: String,
    kind: Option<String>,
    skill_name: Option<String>,
) -> Result<EvalDatasetSaveResult, String> {
    eval_save_dataset_impl(
        &crate::root_dir::default_home_dir(),
        path,
        content,
        kind,
        skill_name,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::temp_root;
    use std::path::PathBuf;

    fn sample_pipeline_output() -> EvalPipelineOutput {
        EvalPipelineOutput {
            status: "success".to_string(),
            mode: "standard".to_string(),
            summary: EvalPipelineSummary {
                total_cases: 10,
                total_passed: 8,
                total_failed: 2,
                pass_rate: 0.8,
            },
            trigger_clean: TriggerEvalOutput {
                status: "success".to_string(),
                skill_name: Some("demo".to_string()),
                summary: Some(TriggerEvalSummary {
                    total: 4,
                    passed: 3,
                    failed: 1,
                    pass_rate: 0.75,
                }),
                results: Some(Vec::new()),
                message: None,
            },
            trigger_complex: None,
            functional: FunctionalEvalOutput {
                status: "success".to_string(),
                skill_name: Some("demo".to_string()),
                summary: Some(FunctionalEvalSummary {
                    total: 6,
                    passed: 5,
                    failed: 1,
                    pass_rate: 0.8333,
                }),
                dimension_scores: None,
                results: Some(Vec::new()),
                message: None,
            },
            functional_without_skill: None,
            dimension_scores: EvalDimensionScores {
                trigger_accuracy: 0.75,
                functional_correctness: 0.8333,
                robustness: 0.8,
                efficiency: 0.9,
                value_added: 0.1,
            },
            trigger_metrics: EvalTriggerMetrics {
                precision: 0.8,
                recall: 0.75,
                fpr: 0.1,
                true_positive: 3,
                true_negative: 1,
                false_positive: 0,
                false_negative: 1,
            },
            cost_estimate: EvalCostEstimate {
                estimated_usd: 0.01,
                actual_usd_estimate: 0.01,
                trigger_cases: 4,
                functional_cases: 6,
                api_calls_estimate: 10,
                budget_limit_usd: None,
                budget_exceeded: false,
            },
            delta_vs_no_skill: None,
            repeat_stats: EvalRepeatStats {
                overall_pass_rate: EvalRateStats {
                    mean: 0.8,
                    median: 0.8,
                    std_dev: 0.0,
                },
                trigger_pass_rate: EvalRateStats {
                    mean: 0.75,
                    median: 0.75,
                    std_dev: 0.0,
                },
                functional_pass_rate: Some(EvalRateStats {
                    mean: 0.8333,
                    median: 0.8333,
                    std_dev: 0.0,
                }),
                robustness: EvalRateStats {
                    mean: 0.8,
                    median: 0.8,
                    std_dev: 0.0,
                },
                value_added: None,
            },
            run_meta: EvalRunMeta {
                mode: "standard".to_string(),
                model: "gpt-4o-mini".to_string(),
                judge_models: vec!["gpt-4o-mini".to_string()],
                repeats: 1,
                seed: Some(1),
                temperature: 0.0,
                executed_steps: 3,
                elapsed_ms: 1234,
                skill_hash: Some("abc".to_string()),
            },
            taxonomy_status: Some("skipped".to_string()),
            taxonomy_message: Some("Taxonomy already present.".to_string()),
            taxonomy_applied: Some(false),
            history_path: None,
            message: None,
        }
    }

    #[test]
    fn normalize_taxonomy_derives_group_and_difficulty_level() {
        let normalized = normalize_taxonomy(SkillTaxonomyClassification {
            sok_representation: "Natural-language".to_string(),
            sok_scope: "Single-tool".to_string(),
            sok_group: String::new(),
            anthropic_category: "Workflow Automation".to_string(),
            skillsbench_domain: "Software Engineering".to_string(),
            skillsbench_difficulty_core: "core".to_string(),
            skillsbench_difficulty_level: String::new(),
            classified_at: "2026-03-12T00:00:00Z".to_string(),
            classifier_model: "gpt-4o-mini".to_string(),
        })
        .expect("normalize taxonomy");

        assert_eq!(normalized.sok_group, "Natural-language × Single-tool");
        assert_eq!(normalized.skillsbench_difficulty_core, "Core");
        assert_eq!(normalized.skillsbench_difficulty_level, "Easy");
    }

    #[test]
    fn merge_taxonomy_tags_keeps_manual_tags_and_replaces_taxonomy_tags() {
        let taxonomy = normalize_taxonomy(SkillTaxonomyClassification {
            sok_representation: "Tool macros".to_string(),
            sok_scope: "Multi-tool".to_string(),
            sok_group: "Tool macros × Multi-tool".to_string(),
            anthropic_category: "MCP Enhancement".to_string(),
            skillsbench_domain: "Software Engineering".to_string(),
            skillsbench_difficulty_core: "Extended".to_string(),
            skillsbench_difficulty_level: "Medium".to_string(),
            classified_at: "2026-03-12T00:00:00Z".to_string(),
            classifier_model: "gpt-4o-mini".to_string(),
        })
        .expect("normalize taxonomy");

        let merged = merge_taxonomy_tags(
            &[
                "manual-tag".to_string(),
                "taxonomy:sok-scope:legacy".to_string(),
                "manual-tag".to_string(),
            ],
            &taxonomy,
        );

        assert_eq!(merged[0], "manual-tag");
        assert!(merged
            .iter()
            .any(|tag| tag == "taxonomy:sok-scope:multi-tool"));
        assert_eq!(merged.iter().filter(|tag| *tag == "manual-tag").count(), 1);
        assert!(merged.iter().all(|tag| tag != "taxonomy:sok-scope:legacy"));
    }

    #[test]
    fn taxonomy_from_frontmatter_parses_complete_payload() {
        let mut frontmatter = Mapping::new();
        let mut taxonomy_map = Mapping::new();
        taxonomy_map.insert(
            YamlValue::String("sokRepresentation".to_string()),
            YamlValue::String("Natural-language".to_string()),
        );
        taxonomy_map.insert(
            YamlValue::String("sokScope".to_string()),
            YamlValue::String("Single-tool".to_string()),
        );
        taxonomy_map.insert(
            YamlValue::String("sokGroup".to_string()),
            YamlValue::String("Natural-language × Single-tool".to_string()),
        );
        taxonomy_map.insert(
            YamlValue::String("anthropicCategory".to_string()),
            YamlValue::String("Workflow Automation".to_string()),
        );
        taxonomy_map.insert(
            YamlValue::String("skillsbenchDomain".to_string()),
            YamlValue::String("Software Engineering".to_string()),
        );
        taxonomy_map.insert(
            YamlValue::String("skillsbenchDifficultyCore".to_string()),
            YamlValue::String("Core".to_string()),
        );
        taxonomy_map.insert(
            YamlValue::String("skillsbenchDifficultyLevel".to_string()),
            YamlValue::String("Easy".to_string()),
        );
        taxonomy_map.insert(
            YamlValue::String("classifiedAt".to_string()),
            YamlValue::String("2026-03-12T00:00:00Z".to_string()),
        );
        taxonomy_map.insert(
            YamlValue::String("classifierModel".to_string()),
            YamlValue::String("gpt-4o-mini".to_string()),
        );
        frontmatter.insert(
            YamlValue::String("skillar_taxonomy".to_string()),
            YamlValue::Mapping(taxonomy_map),
        );

        let parsed = taxonomy_from_frontmatter(&frontmatter).expect("taxonomy parse");
        assert_eq!(parsed.sok_representation, "Natural-language");
        assert_eq!(parsed.skillsbench_difficulty_core, "Core");
        assert_eq!(parsed.skillsbench_difficulty_level, "Easy");
    }

    #[test]
    fn read_eval_config_returns_defaults_when_missing() {
        let home = temp_root("myskills-tauri-evals-test");
        let config = read_eval_config_with_home(&home).expect("read eval config");
        assert_eq!(config.provider, DEFAULT_PROVIDER);
        assert_eq!(config.default_model, DEFAULT_MODEL);
        assert!(config.api_key.is_empty());
        assert!(config.base_url.is_none());
    }

    #[test]
    fn write_then_read_eval_config_roundtrip() {
        let home = temp_root("myskills-tauri-evals-test");
        let config = EvalConfig {
            api_key: "  key-value  ".to_string(),
            provider: " openai-compatible ".to_string(),
            base_url: Some(" https://api.openai.com/v1 ".to_string()),
            default_model: " gpt-4.1-mini ".to_string(),
        };
        write_eval_config_with_home(&home, &config).expect("write eval config");
        let loaded = read_eval_config_with_home(&home).expect("read eval config");
        assert_eq!(loaded.api_key, "key-value");
        assert_eq!(loaded.provider, "openai-compatible");
        assert_eq!(
            loaded.base_url.as_deref(),
            Some("https://api.openai.com/v1")
        );
        assert_eq!(loaded.default_model, "gpt-4.1-mini");
    }

    #[test]
    fn resolve_python_workdir_picks_candidate_with_engine_dir() {
        let root = temp_root("myskills-tauri-evals-test");
        let py_dir = root.join("py");
        fs::create_dir_all(py_dir.join("eval_engine")).expect("create eval_engine dir");
        let picked = resolve_python_workdir_from_candidates(&[root.join("none"), py_dir.clone()])
            .expect("pick");
        assert_eq!(picked, py_dir);
    }

    #[test]
    fn eval_save_dataset_rejects_invalid_json() {
        let root = temp_root("myskills-tauri-evals-test");
        let err = eval_save_dataset_impl(
            &root,
            Some(root.join("bad.json")),
            "{not-json".to_string(),
            Some("trigger".to_string()),
            Some("demo".to_string()),
        )
        .err()
        .expect("should fail");
        assert!(err.contains("invalid"));
    }

    #[test]
    fn eval_save_dataset_uses_preset_path_when_missing() {
        let home = temp_root("myskills-tauri-evals-test");
        let saved = eval_save_dataset_impl(
            &home,
            None,
            "[]".to_string(),
            Some("trigger".to_string()),
            Some("demo-skill".to_string()),
        )
        .expect("save dataset");
        assert!(saved.success);
        let saved_path = PathBuf::from(&saved.path);
        assert!(saved_path.exists());
        assert!(saved_path.starts_with(eval_dataset_dir(&home, Some("demo-skill"))));
    }

    #[test]
    fn eval_history_list_and_load_roundtrip() {
        let home = temp_root("myskills-tauri-evals-test");
        let output = sample_pipeline_output();
        let saved_path = persist_pipeline_history(&home, "demo-skill", &output)
            .expect("persist history")
            .expect("history path");
        let history = list_eval_history_impl(&home, "demo-skill".to_string(), Some(10))
            .expect("list history");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].mode, "standard");
        assert_eq!(history[0].total_cases, 10);
        let loaded = load_eval_history_impl(PathBuf::from(saved_path)).expect("load history");
        assert_eq!(loaded.summary.total_cases, 10);
        assert_eq!(loaded.mode, "standard");
    }

    #[test]
    fn trigger_eval_output_parses_snake_case_json() {
        let raw = r#"{
            "status": "success",
            "skill_name": "myskill",
            "summary": { "total": 2, "passed": 1, "failed": 1, "pass_rate": 0.5 },
            "results": [
              {
                "query": "foo",
                "should_trigger": true,
                "triggered": true,
                "triggered_skill_name": "myskill",
                "pass": true
              }
            ]
        }"#;
        let parsed = serde_json::from_str::<TriggerEvalOutput>(raw).expect("parse trigger output");
        assert_eq!(parsed.status, "success");
        assert_eq!(parsed.skill_name.as_deref(), Some("myskill"));
        let summary = parsed.summary.expect("summary");
        assert_eq!(summary.total, 2);
        assert_eq!(summary.passed, 1);
        assert_eq!(summary.failed, 1);
        assert!((summary.pass_rate - 0.5).abs() < f64::EPSILON);
        let results = parsed.results.expect("results");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].query, "foo");
        assert!(results[0].should_trigger);
        assert!(results[0].triggered);
        assert_eq!(results[0].triggered_skill_name.as_deref(), Some("myskill"));
        assert!(results[0].pass);
    }

    #[test]
    fn functional_eval_output_parses_snake_case_json() {
        let raw = r#"{
            "status": "success",
            "skill_name": "myskill",
            "summary": { "total": 1, "passed": 1, "failed": 0, "pass_rate": 1.0 },
            "results": [
              {
                "case_id": "f-001",
                "passed": true,
                "pass_rate": 1.0
              }
            ]
        }"#;
        let parsed =
            serde_json::from_str::<FunctionalEvalOutput>(raw).expect("parse functional output");
        assert_eq!(parsed.status, "success");
        assert_eq!(parsed.skill_name.as_deref(), Some("myskill"));
        let summary = parsed.summary.expect("summary");
        assert_eq!(summary.total, 1);
        assert_eq!(summary.passed, 1);
        assert_eq!(summary.failed, 0);
        assert!((summary.pass_rate - 1.0).abs() < f64::EPSILON);
        let results = parsed.results.expect("results");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].case_id, "f-001");
        assert!(results[0].passed);
        assert!((results[0].pass_rate - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn normalize_eval_mode_accepts_known_values() {
        assert_eq!(normalize_eval_mode("quick").expect("quick"), "quick");
        assert_eq!(
            normalize_eval_mode("standard").expect("standard"),
            "standard"
        );
        assert_eq!(normalize_eval_mode("full").expect("full"), "full");
        assert!(normalize_eval_mode("unknown").is_err());
    }

    #[test]
    fn compute_trigger_metrics_builds_confusion_counts() {
        let rows = vec![
            TriggerEvalResultItem {
                query: "p1".to_string(),
                should_trigger: true,
                triggered: true,
                triggered_skill_name: Some("myskill".to_string()),
                pass: true,
                error: None,
            },
            TriggerEvalResultItem {
                query: "n1".to_string(),
                should_trigger: false,
                triggered: true,
                triggered_skill_name: Some("other".to_string()),
                pass: false,
                error: None,
            },
            TriggerEvalResultItem {
                query: "n2".to_string(),
                should_trigger: false,
                triggered: false,
                triggered_skill_name: None,
                pass: true,
                error: None,
            },
            TriggerEvalResultItem {
                query: "p2".to_string(),
                should_trigger: true,
                triggered: false,
                triggered_skill_name: None,
                pass: false,
                error: None,
            },
        ];
        let metrics = compute_trigger_metrics(&rows);
        assert_eq!(metrics.true_positive, 1);
        assert_eq!(metrics.false_positive, 1);
        assert_eq!(metrics.true_negative, 1);
        assert_eq!(metrics.false_negative, 1);
    }

    #[test]
    fn summarize_rates_reports_mean_median_and_std_dev() {
        let stats = summarize_rates(&[0.2, 0.4, 0.6, 0.8]);
        assert!((stats.mean - 0.5).abs() < f64::EPSILON);
        assert!((stats.median - 0.5).abs() < f64::EPSILON);
        assert!((stats.std_dev - 0.2236).abs() < 0.0001);
    }

    #[test]
    fn summarize_rates_handles_single_value_without_variance() {
        let stats = summarize_rates(&[0.75]);
        assert!((stats.mean - 0.75).abs() < f64::EPSILON);
        assert!((stats.median - 0.75).abs() < f64::EPSILON);
        assert!((stats.std_dev - 0.0).abs() < f64::EPSILON);
    }
}

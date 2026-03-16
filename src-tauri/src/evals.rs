use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value as YamlValue};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::fs;
use std::io::Write;
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
const DEFAULT_COST_CURRENCY: &str = "USD";
const EVAL_TIMEOUT_SECS: u64 = 300;
const MAX_EVAL_TIMEOUT_SECS: u64 = 10800;
const EVAL_TIMEOUT_PER_CASE_SECS: u64 = 12;
const EVAL_TIMEOUT_ESTIMATE_BUFFER_SECS: u64 = 120;
const EVAL_TIMEOUT_ESTIMATE_SCALE_NUM: u64 = 3;
const EVAL_TIMEOUT_ESTIMATE_SCALE_DEN: u64 = 2;
const TAXONOMY_TIMEOUT_SECS: u64 = 180;
const SAMPLE_GENERATION_REQUEST_TIMEOUT_BASE_SECS: u64 = 120;
const SAMPLE_GENERATION_REQUEST_TIMEOUT_PER_CASE_SECS: u64 = 6;
const SAMPLE_GENERATION_REQUEST_TIMEOUT_MIN_SECS: u64 = 180;
const SAMPLE_GENERATION_REQUEST_TIMEOUT_MAX_SECS: u64 = 900;
const DEFAULT_TRIGGER_CASE_COUNT: usize = 48;
const DEFAULT_FUNCTIONAL_CASE_COUNT: usize = 24;
const DEFAULT_PIPELINE_REPEATS: usize = 1;
const DEFAULT_MAX_PARALLEL_ARMS: usize = 2;
const MIN_MAX_PARALLEL_ARMS: usize = 1;
const MAX_MAX_PARALLEL_ARMS: usize = 4;
const DEFAULT_TRIGGER_MAX_WORKERS: usize = 6;
const DEFAULT_FUNCTIONAL_MAX_WORKERS: usize = 3;
const MIN_EVAL_WORKERS: usize = 1;
const MAX_EVAL_WORKERS: usize = 16;
const DEFAULT_REVIEW_QUEUE_LIMIT: usize = 30;
const DEFAULT_SAMPLE_TIMING_HISTORY_LIMIT: usize = 80;
const MAX_SAMPLE_TIMING_HISTORY_LIMIT: usize = 500;
const TRIGGER_BUCKET_MIN_SAMPLES: usize = 12;
const TRIGGER_BUCKET_POSITIVE: &str = "positive_trigger";
const TRIGGER_BUCKET_NEGATIVE: &str = "negative_trigger";
const TRIGGER_BUCKET_BOUNDARY: &str = "boundary_ambiguous";
const TRIGGER_BUCKET_ADJACENT: &str = "adjacent_skill_confusion";
const EVAL_MODULE_TRIGGER_ACCURACY: &str = "trigger_accuracy";
const EVAL_MODULE_EXECUTION_CORRECTNESS: &str = "execution_correctness";
const EVAL_MODULE_ROBUSTNESS_SECURITY: &str = "robustness_security";
const EVAL_MODULE_ECONOMICS: &str = "economics";
const EVAL_MODULE_AUDITABILITY: &str = "auditability";
const EVAL_ALL_MODULE_KEYS: [&str; 5] = [
    EVAL_MODULE_TRIGGER_ACCURACY,
    EVAL_MODULE_EXECUTION_CORRECTNESS,
    EVAL_MODULE_ROBUSTNESS_SECURITY,
    EVAL_MODULE_ECONOMICS,
    EVAL_MODULE_AUDITABILITY,
];
const ADVISORY_PASS_PRECISION_THRESHOLD: f64 = 0.80;
const ADVISORY_PASS_RECALL_THRESHOLD: f64 = 0.75;
const ADVISORY_HIGH_RISK_PRECISION_THRESHOLD: f64 = 0.60;
const ADVISORY_HIGH_RISK_RECALL_THRESHOLD: f64 = 0.55;
const ADVISORY_HIGH_RISK_DELTA_THRESHOLD: f64 = -0.05;
const ESTIMATED_USD_PER_TRIGGER_CASE: f64 = 0.00001;
const ESTIMATED_USD_PER_FUNCTIONAL_CASE: f64 = 0.00003;
const ESTIMATED_USD_PER_TOKEN: f64 = 0.0000005;
const ESTIMATED_COST_RANGE_LOW_FACTOR: f64 = 0.8;
const ESTIMATED_COST_RANGE_HIGH_FACTOR: f64 = 1.2;
const ESTIMATE_TRIGGER_INPUT_TOKENS_PER_CALL: usize = 900;
const ESTIMATE_TRIGGER_OUTPUT_TOKENS_PER_CALL: usize = 40;
const ESTIMATE_FUNCTIONAL_EXEC_INPUT_TOKENS_PER_CALL: usize = 2200;
const ESTIMATE_FUNCTIONAL_EXEC_OUTPUT_TOKENS_PER_CALL: usize = 450;
const ESTIMATE_FUNCTIONAL_BASELINE_INPUT_TOKENS_PER_CALL: usize = 700;
const ESTIMATE_FUNCTIONAL_BASELINE_OUTPUT_TOKENS_PER_CALL: usize = 420;
const ESTIMATE_JUDGE_INPUT_TOKENS_PER_CALL: usize = 1800;
const ESTIMATE_JUDGE_OUTPUT_TOKENS_PER_CALL: usize = 180;
const ESTIMATE_TAXONOMY_INPUT_TOKENS_PER_CALL: usize = 1600;
const ESTIMATE_TAXONOMY_OUTPUT_TOKENS_PER_CALL: usize = 120;
const ESTIMATE_TRIGGER_SECONDS_PER_CALL: u64 = 3;
const ESTIMATE_FUNCTIONAL_EXEC_SECONDS_PER_CALL: u64 = 8;
const ESTIMATE_FUNCTIONAL_BASELINE_SECONDS_PER_CALL: u64 = 6;
const ESTIMATE_JUDGE_SECONDS_PER_CALL: u64 = 5;
const ESTIMATE_TAXONOMY_SECONDS_PER_CALL: u64 = 8;
const EVAL_PROGRESS_EVENT: &str = "eval://pipeline-progress";
static EVAL_TMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

fn default_max_parallel_arms() -> usize {
    DEFAULT_MAX_PARALLEL_ARMS
}

fn default_trigger_max_workers() -> usize {
    DEFAULT_TRIGGER_MAX_WORKERS
}

fn default_functional_max_workers() -> usize {
    DEFAULT_FUNCTIONAL_MAX_WORKERS
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub struct TriggerEvalResultItem {
    pub query: String,
    pub should_trigger: bool,
    pub triggered: bool,
    pub triggered_skill_name: Option<String>,
    pub pass: bool,
    pub error: Option<String>,
    pub raw_response_path: Option<String>,
    pub latency_ms: Option<u64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub judge_trace_id: Option<String>,
    pub error_type: Option<String>,
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
    pub raw_response_path: Option<String>,
    pub latency_ms: Option<u64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub judge_trace_id: Option<String>,
    pub error_type: Option<String>,
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
    pub sample_model: String,
    pub run_model: String,
    pub default_model: String,
    pub cost_currency: String,
}

#[derive(Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct RawEvalConfig {
    api_key: Option<String>,
    provider: Option<String>,
    base_url: Option<String>,
    sample_model: Option<String>,
    run_model: Option<String>,
    default_model: Option<String>,
    cost_currency: Option<String>,
}

impl Default for EvalConfig {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            provider: DEFAULT_PROVIDER.to_string(),
            base_url: None,
            sample_model: DEFAULT_MODEL.to_string(),
            run_model: DEFAULT_MODEL.to_string(),
            default_model: DEFAULT_MODEL.to_string(),
            cost_currency: DEFAULT_COST_CURRENCY.to_string(),
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_trigger_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_functional_path: Option<String>,
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
    pub review_summary: Option<EvalReviewSummary>,
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
pub struct EvalSampleGenerationTimingEntry {
    pub recorded_at_unix: u64,
    pub skill_name: String,
    pub model: String,
    pub trigger_count: usize,
    pub functional_count: usize,
    pub elapsed_seconds: u64,
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
    pub estimated_usd_min: Option<f64>,
    pub estimated_usd_max: Option<f64>,
    pub actual_usd_estimate: f64,
    pub trigger_cases: usize,
    pub functional_cases: usize,
    pub api_calls_estimate: usize,
    pub budget_limit_usd: Option<f64>,
    pub budget_exceeded: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalEstimateStep {
    pub key: String,
    pub title: String,
    pub stage: Option<String>,
    pub module_key: Option<String>,
    pub case_count: usize,
    pub runs: usize,
    pub llm_calls: usize,
    pub estimated_input_tokens: usize,
    pub estimated_output_tokens: usize,
    pub estimated_total_tokens: usize,
    pub estimated_seconds: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalPipelineEstimate {
    pub mode: String,
    pub model: String,
    pub judge_models: Vec<String>,
    pub selected_modules: Vec<String>,
    pub repeats: usize,
    pub trigger_cases: usize,
    pub functional_cases: usize,
    pub taxonomy_pending: bool,
    pub estimated_input_tokens: usize,
    pub estimated_output_tokens: usize,
    pub estimated_total_tokens: usize,
    pub estimated_seconds: u64,
    pub estimated_minutes: f64,
    pub cost_estimate: EvalCostEstimate,
    pub steps: Vec<EvalEstimateStep>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalQuickCheckItem {
    pub key: String,
    pub title: String,
    pub blocking: bool,
    pub passed: bool,
    pub message: String,
    pub elapsed_ms: u128,
    pub evidence_path: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalTriggerBucketCoverage {
    pub min_required_per_bucket: usize,
    pub positive_trigger: usize,
    pub negative_trigger: usize,
    pub boundary_ambiguous: usize,
    pub adjacent_skill_confusion: usize,
    pub all_buckets_met: bool,
    pub failed_buckets: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalQuickChecks {
    pub all_passed: bool,
    pub checks: Vec<EvalQuickCheckItem>,
    pub bucket_coverage: Option<EvalTriggerBucketCoverage>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalModuleResult {
    pub key: String,
    pub title: String,
    pub selected: bool,
    pub status: String,
    pub passed: Option<bool>,
    pub score: Option<f64>,
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalGate {
    pub quick_blocking_pass: bool,
    pub full_release_pass: Option<bool>,
    pub partial_release: Option<bool>,
    pub selected_modules: Vec<String>,
    pub failed_modules: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalEconomics {
    pub gross_time_saved_ms: f64,
    pub gross_token_saved: f64,
    pub negative_time_waste_ms: f64,
    pub negative_token_waste: f64,
    pub net_time_saved_ms: f64,
    pub net_token_saved: f64,
    pub net_usd: Option<f64>,
    pub baseline_samples: usize,
    pub evaluated_pairs: usize,
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
    #[serde(default = "default_max_parallel_arms")]
    pub max_parallel_arms: usize,
    #[serde(default = "default_trigger_max_workers")]
    pub trigger_max_workers: usize,
    #[serde(default = "default_functional_max_workers")]
    pub functional_max_workers: usize,
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
    pub quick_checks: Option<EvalQuickChecks>,
    pub trigger_clean: TriggerEvalOutput,
    pub trigger_complex: Option<TriggerEvalOutput>,
    pub functional: FunctionalEvalOutput,
    pub functional_without_skill: Option<FunctionalEvalOutput>,
    pub module_results: Option<Vec<EvalModuleResult>>,
    pub gate: Option<EvalGate>,
    pub economics: Option<EvalEconomics>,
    pub dimension_scores: EvalDimensionScores,
    pub trigger_metrics: EvalTriggerMetrics,
    pub cost_estimate: EvalCostEstimate,
    pub delta_vs_no_skill: Option<EvalDeltaVsNoSkill>,
    pub repeat_stats: EvalRepeatStats,
    pub run_meta: EvalRunMeta,
    pub evidence_level: Option<String>,
    pub advisory: Option<EvalAdvisory>,
    pub evidence_summary: Option<EvalEvidenceSummary>,
    pub review_summary: Option<EvalReviewSummary>,
    pub final_verdict: Option<String>,
    pub override_reason: Option<String>,
    pub override_at: Option<u64>,
    pub override_by: Option<String>,
    pub comparator: Option<EvalComparatorSummary>,
    pub analyzer: Option<EvalAnalyzerSummary>,
    pub taxonomy_status: Option<String>,
    pub taxonomy_message: Option<String>,
    pub taxonomy_applied: Option<bool>,
    pub history_path: Option<String>,
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalAdvisory {
    pub level: String,
    pub reasons: Vec<String>,
    pub non_blocking: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalEvidenceSummary {
    pub total_runs: usize,
    pub captured_transcripts: usize,
    pub captured_timing: usize,
    pub captured_tokens: usize,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct EvalReviewSummary {
    pub reviewed: bool,
    pub final_verdict: Option<String>,
    pub override_gate: bool,
    pub decided_at_unix: Option<u64>,
    pub reviewer: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalComparatorSummary {
    pub evaluated_cases: usize,
    pub improved_cases: usize,
    pub regressed_cases: usize,
    pub unchanged_cases: usize,
    pub average_delta: f64,
    pub highlights: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalAnalyzerSummary {
    pub top_failure_patterns: Vec<String>,
    pub recommendations: Vec<String>,
    pub generated_at_unix: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalReviewQueueItem {
    pub path: String,
    pub file_name: String,
    pub saved_at_unix: u64,
    pub pass_rate: f64,
    pub total_cases: i32,
    pub model: String,
    pub gate_pass: Option<bool>,
    pub reviewed: bool,
    pub final_verdict: Option<String>,
    pub decided_at_unix: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalReviewDetail {
    pub path: String,
    pub final_verdict: String,
    pub override_gate: bool,
    pub override_reason: Option<String>,
    pub notes: Option<String>,
    pub reviewer: Option<String>,
    pub tags: Vec<String>,
    pub failed_case_ids: Vec<String>,
    pub decided_at_unix: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalSubmitReviewResult {
    pub success: bool,
    pub review: EvalReviewDetail,
    pub review_summary: EvalReviewSummary,
    pub final_verdict: String,
    pub override_reason: Option<String>,
    pub override_by: Option<String>,
    pub override_at: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalEvidenceCaseResult {
    pub case_id: String,
    pub stage: String,
    pub evidence_path: Option<String>,
    pub content: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct EvalReviewRecord {
    history_path: String,
    final_verdict: String,
    #[serde(default)]
    override_gate: bool,
    override_reason: Option<String>,
    notes: Option<String>,
    reviewer: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    failed_case_ids: Vec<String>,
    decided_at_unix: u64,
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

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct SkillTaxonomyRegistryEntry {
    skill_name: String,
    skill_path: String,
    taxonomy: SkillTaxonomyClassification,
    updated_at: String,
}

#[derive(Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct SkillTaxonomyRegistry {
    version: u32,
    entries: HashMap<String, SkillTaxonomyRegistryEntry>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    message_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message_args: Option<serde_json::Value>,
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

fn eval_engine_execution_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn lock_eval_engine_execution() -> std::sync::MutexGuard<'static, ()> {
    match eval_engine_execution_lock().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
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
    push_pipeline_progress_with_i18n(
        app_handle,
        run_id,
        status,
        current_repeat,
        total_repeats,
        step_index,
        total_steps,
        step_name,
        message,
        None,
        None,
        elapsed_ms,
    );
}

#[allow(clippy::too_many_arguments)]
fn push_pipeline_progress_with_i18n(
    app_handle: &tauri::AppHandle,
    run_id: &str,
    status: &str,
    current_repeat: usize,
    total_repeats: usize,
    step_index: usize,
    total_steps: usize,
    step_name: &str,
    message: &str,
    message_key: Option<&str>,
    message_args: Option<serde_json::Value>,
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
            message_key: message_key.map(|key| key.to_string()),
            message_args,
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
            push_pipeline_progress_with_i18n(
                app_handle,
                run_id,
                "cancelled",
                current_repeat,
                total_repeats,
                step_index,
                total_steps,
                step_name,
                "Evaluation cancelled by user.",
                Some("eval.progress.cancelled"),
                None,
                elapsed_ms,
            );
            return Err("Evaluation cancelled by user.".to_string());
        }
        if !control.paused.load(Ordering::Relaxed) {
            if pause_notified {
                push_pipeline_progress_with_i18n(
                    app_handle,
                    run_id,
                    "running",
                    current_repeat,
                    total_repeats,
                    step_index,
                    total_steps,
                    step_name,
                    "Resume requested. Continuing with next step.",
                    Some("eval.progress.resumed"),
                    None,
                    elapsed_ms,
                );
            }
            return Ok(());
        }
        if !pause_notified {
            push_pipeline_progress_with_i18n(
                app_handle,
                run_id,
                "paused",
                current_repeat,
                total_repeats,
                step_index,
                total_steps,
                step_name,
                "Paused. Waiting for resume.",
                Some("eval.progress.paused"),
                None,
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

fn taxonomy_registry_file(home: &Path) -> PathBuf {
    crate::root_dir::app_config_dir(home).join("skill-taxonomy-index.json")
}

fn normalize_skill_path_key(skill_path: &Path) -> String {
    let absolute = if skill_path.is_absolute() {
        skill_path.to_path_buf()
    } else {
        crate::root_dir::default_root_dir().join(skill_path)
    };
    let canonical = absolute.canonicalize().unwrap_or(absolute);
    let normalized = canonical.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        normalized.to_lowercase()
    } else {
        normalized
    }
}

fn read_taxonomy_registry_with_home(home: &Path) -> Result<SkillTaxonomyRegistry, String> {
    let path = taxonomy_registry_file(home);
    if !path.exists() {
        return Ok(SkillTaxonomyRegistry {
            version: 1,
            entries: HashMap::new(),
        });
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Read taxonomy index failed: {e}"))?;
    if raw.trim().is_empty() {
        return Ok(SkillTaxonomyRegistry {
            version: 1,
            entries: HashMap::new(),
        });
    }
    let mut parsed = serde_json::from_str::<SkillTaxonomyRegistry>(&raw)
        .map_err(|e| format!("Invalid taxonomy index file: {e}"))?;
    if parsed.version == 0 {
        parsed.version = 1;
    }
    Ok(parsed)
}

fn write_taxonomy_registry_with_home(
    home: &Path,
    registry: &SkillTaxonomyRegistry,
) -> Result<(), String> {
    fs::create_dir_all(crate::root_dir::app_config_dir(home))
        .map_err(|e| format!("Create app config dir failed: {e}"))?;
    let content = serde_json::to_string_pretty(registry)
        .map_err(|e| format!("Serialize taxonomy index failed: {e}"))?;
    fs::write(taxonomy_registry_file(home), format!("{content}\n"))
        .map_err(|e| format!("Write taxonomy index failed: {e}"))
}

fn load_registry_taxonomy(
    home: &Path,
    skill_path: &Path,
) -> Result<Option<SkillTaxonomyClassification>, String> {
    let registry = read_taxonomy_registry_with_home(home)?;
    let key = normalize_skill_path_key(skill_path);
    Ok(registry
        .entries
        .get(&key)
        .map(|entry| entry.taxonomy.clone()))
}

fn save_registry_taxonomy(
    home: &Path,
    skill_name: &str,
    skill_path: &Path,
    taxonomy: &SkillTaxonomyClassification,
) -> Result<(), String> {
    let mut registry = read_taxonomy_registry_with_home(home)?;
    if registry.version == 0 {
        registry.version = 1;
    }
    let key = normalize_skill_path_key(skill_path);
    let updated_at = now_unix_secs().unwrap_or(0).to_string();
    registry.entries.insert(
        key,
        SkillTaxonomyRegistryEntry {
            skill_name: skill_name.trim().to_string(),
            skill_path: skill_path.to_string_lossy().to_string(),
            taxonomy: taxonomy.clone(),
            updated_at,
        },
    );
    write_taxonomy_registry_with_home(home, &registry)
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

fn eval_pipeline_evidence_dir(home: &Path, skill_name: &str, run_id: &str) -> PathBuf {
    let safe_run_id = sanitize_path_segment(run_id, "run");
    let ts = now_unix_secs().unwrap_or(0);
    eval_history_dir(home, Some(skill_name))
        .join("evidence")
        .join(format!("{safe_run_id}-{ts}"))
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

fn normalize_cost_currency(value: &str) -> String {
    match value.trim().to_uppercase().as_str() {
        "CNY" => "CNY".to_string(),
        _ => DEFAULT_COST_CURRENCY.to_string(),
    }
}

fn sanitize_eval_config(raw: RawEvalConfig) -> EvalConfig {
    let sample_model = normalize_model(
        raw.sample_model
            .as_deref()
            .or(raw.default_model.as_deref())
            .or(raw.run_model.as_deref())
            .unwrap_or(DEFAULT_MODEL),
    );
    let run_model = normalize_model(
        raw.run_model
            .as_deref()
            .or(raw.default_model.as_deref())
            .or(raw.sample_model.as_deref())
            .unwrap_or(DEFAULT_MODEL),
    );
    EvalConfig {
        api_key: raw.api_key.unwrap_or_default().trim().to_string(),
        provider: normalize_provider(raw.provider.as_deref().unwrap_or(DEFAULT_PROVIDER)),
        base_url: normalize_base_url(raw.base_url),
        sample_model,
        run_model: run_model.clone(),
        default_model: run_model,
        cost_currency: normalize_cost_currency(
            raw.cost_currency
                .as_deref()
                .unwrap_or(DEFAULT_COST_CURRENCY),
        ),
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
        taxonomy.sok_group = format!("{} 脳 {}", taxonomy.sok_representation, taxonomy.sok_scope);
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
    serialize_engine: bool,
) -> Result<std::process::Output, String> {
    let _engine_guard = if serialize_engine {
        Some(lock_eval_engine_execution())
    } else {
        None
    };
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
        .env("PYTHONDONTWRITEBYTECODE", "1")
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

    let output = run_eval_engine(&cmd_args, control, TAXONOMY_TIMEOUT_SECS, true)?;
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
    let home = crate::root_dir::default_home_dir();
    match load_registry_taxonomy(&home, skill_path) {
        Ok(Some(existing)) => {
            return EnsureSkillTaxonomyResult {
                status: "skipped".to_string(),
                message: "Taxonomy already present in local software index.".to_string(),
                applied: false,
                taxonomy: Some(existing),
            };
        }
        Ok(None) => {}
        Err(err) => {
            return EnsureSkillTaxonomyResult {
                status: "failed".to_string(),
                message: format!("Read local taxonomy index failed: {err}"),
                applied: false,
                taxonomy: None,
            };
        }
    }

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
    let (frontmatter, _) = match split_skill_frontmatter(&raw) {
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
        if let Err(err) = save_registry_taxonomy(&home, skill_name, skill_path, &existing) {
            return EnsureSkillTaxonomyResult {
                status: "failed".to_string(),
                message: format!("Persist taxonomy to local index failed: {err}"),
                applied: false,
                taxonomy: None,
            };
        }
        return EnsureSkillTaxonomyResult {
            status: "skipped".to_string(),
            message: "Taxonomy loaded from SKILL.md and stored in local software index."
                .to_string(),
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

    if let Err(err) = save_registry_taxonomy(&home, skill_name, skill_path, &classified) {
        return EnsureSkillTaxonomyResult {
            status: "failed".to_string(),
            message: format!("Persist taxonomy to local index failed: {err}"),
            applied: false,
            taxonomy: None,
        };
    }

    EnsureSkillTaxonomyResult {
        status: "applied".to_string(),
        message: "Taxonomy classified and stored in local software index.".to_string(),
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
    skill_path: Option<PathBuf>,
    eval_set_path: PathBuf,
    env_type: String,
    installed_skills_dir: Option<PathBuf>,
    model: String,
    max_workers: Option<usize>,
    evidence_dir: Option<PathBuf>,
    control: Option<&Arc<EvalRunControl>>,
    serialize_engine: bool,
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

    if let Some(workers) = max_workers {
        cmd_args.push("--max-workers".to_string());
        cmd_args.push(workers.to_string());
    }

    if let Some(path) = skill_path.as_ref() {
        cmd_args.push("--skill-path".to_string());
        cmd_args.push(path_to_utf8(path)?);
    }

    if let Some(base_url) = config.base_url.as_ref() {
        cmd_args.push("--base-url".to_string());
        cmd_args.push(base_url.clone());
    }

    if let Some(dir) = installed_skills_dir {
        cmd_args.push("--installed-skills-dir".to_string());
        cmd_args.push(path_to_utf8(&dir)?);
    }

    if let Some(dir) = evidence_dir {
        cmd_args.push("--evidence-dir".to_string());
        cmd_args.push(path_to_utf8(&dir)?);
    }

    let eval_case_count =
        read_eval_set_case_count(&eval_set_path).unwrap_or(DEFAULT_TRIGGER_CASE_COUNT);
    let estimated_seconds =
        (eval_case_count.max(1) as u64).saturating_mul(ESTIMATE_TRIGGER_SECONDS_PER_CALL);
    let timeout_secs = timeout_secs_for_estimated_runtime(estimated_seconds);
    let output = run_eval_engine(&cmd_args, control, timeout_secs, serialize_engine)?;
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
    max_workers: Option<usize>,
    evidence_dir: Option<PathBuf>,
    control: Option<&Arc<EvalRunControl>>,
    serialize_engine: bool,
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
        compare_mode.clone(),
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

    let mut normalized_judge_models = judge_models
        .unwrap_or_default()
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    if normalized_judge_models.is_empty() {
        normalized_judge_models.push(normalize_model(&model));
    }
    if !normalized_judge_models.is_empty() {
        cmd_args.push("--judge-models".to_string());
        cmd_args.push(normalized_judge_models.join(","));
    }

    if let Some(workers) = max_workers {
        cmd_args.push("--max-workers".to_string());
        cmd_args.push(workers.to_string());
    }

    if let Some(dir) = evidence_dir {
        cmd_args.push("--evidence-dir".to_string());
        cmd_args.push(path_to_utf8(&dir)?);
    }

    let eval_case_count =
        read_eval_set_case_count(&eval_set_path).unwrap_or(DEFAULT_FUNCTIONAL_CASE_COUNT);
    let judge_model_count = normalized_judge_models.len().max(1) as u64;
    let functional_seconds_per_case =
        if compare_mode.trim().eq_ignore_ascii_case("without_skill") {
            ESTIMATE_FUNCTIONAL_BASELINE_SECONDS_PER_CALL
                + judge_model_count.saturating_mul(ESTIMATE_JUDGE_SECONDS_PER_CALL)
        } else {
            ESTIMATE_FUNCTIONAL_EXEC_SECONDS_PER_CALL
                + ESTIMATE_FUNCTIONAL_BASELINE_SECONDS_PER_CALL
                + judge_model_count.saturating_mul(ESTIMATE_JUDGE_SECONDS_PER_CALL)
        };
    let estimated_seconds =
        (eval_case_count.max(1) as u64).saturating_mul(functional_seconds_per_case);
    let timeout_secs = timeout_secs_for_estimated_runtime(estimated_seconds);
    let output = run_eval_engine(&cmd_args, control, timeout_secs, serialize_engine)?;
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

fn normalize_eval_module_key(value: &str) -> Option<&'static str> {
    let normalized = value
        .trim()
        .to_lowercase()
        .replace('-', "_")
        .replace(' ', "_");
    match normalized.as_str() {
        EVAL_MODULE_TRIGGER_ACCURACY => Some(EVAL_MODULE_TRIGGER_ACCURACY),
        EVAL_MODULE_EXECUTION_CORRECTNESS => Some(EVAL_MODULE_EXECUTION_CORRECTNESS),
        EVAL_MODULE_ROBUSTNESS_SECURITY => Some(EVAL_MODULE_ROBUSTNESS_SECURITY),
        EVAL_MODULE_ECONOMICS => Some(EVAL_MODULE_ECONOMICS),
        EVAL_MODULE_AUDITABILITY => Some(EVAL_MODULE_AUDITABILITY),
        _ => None,
    }
}

fn normalize_selected_modules(mode: &str, selected_modules: Option<Vec<String>>) -> Vec<String> {
    if mode == "quick" {
        return Vec::new();
    }
    let mut out = selected_modules
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| normalize_eval_module_key(&item).map(std::string::ToString::to_string))
        .collect::<Vec<_>>();
    out.sort();
    out.dedup();
    if out.is_empty() {
        EVAL_ALL_MODULE_KEYS
            .iter()
            .map(|item| (*item).to_string())
            .collect::<Vec<_>>()
    } else {
        out
    }
}

fn module_title(module_key: &str) -> &'static str {
    match module_key {
        EVAL_MODULE_TRIGGER_ACCURACY => "Trigger Accuracy",
        EVAL_MODULE_EXECUTION_CORRECTNESS => "Execution Correctness",
        EVAL_MODULE_ROBUSTNESS_SECURITY => "Robustness & Security",
        EVAL_MODULE_ECONOMICS => "Economics",
        EVAL_MODULE_AUDITABILITY => "Auditability",
        _ => "Unknown Module",
    }
}

fn contains_module(selected_modules: &[String], module_key: &str) -> bool {
    selected_modules.iter().any(|item| item == module_key)
}

fn should_run_trigger_complex(mode: &str, selected_modules: &[String]) -> bool {
    mode == "full"
        && (contains_module(selected_modules, EVAL_MODULE_TRIGGER_ACCURACY)
            || contains_module(selected_modules, EVAL_MODULE_ROBUSTNESS_SECURITY))
}

fn should_run_functional_with_skill(mode: &str, selected_modules: &[String]) -> bool {
    mode != "quick"
        && (contains_module(selected_modules, EVAL_MODULE_EXECUTION_CORRECTNESS)
            || contains_module(selected_modules, EVAL_MODULE_ECONOMICS))
}

fn should_run_functional_without_skill(mode: &str, selected_modules: &[String]) -> bool {
    mode != "quick" && contains_module(selected_modules, EVAL_MODULE_ECONOMICS)
}

fn ensure_functional_case_floor(case_count: usize) -> Result<(), String> {
    if case_count < DEFAULT_FUNCTIONAL_CASE_COUNT {
        return Err(format!(
            "Functional eval dataset requires at least {} cases in current modular mode, got {}.",
            DEFAULT_FUNCTIONAL_CASE_COUNT, case_count
        ));
    }
    Ok(())
}

fn normalize_trigger_bucket(value: &str) -> Option<&'static str> {
    let normalized = value
        .trim()
        .to_lowercase()
        .replace('-', "_")
        .replace(' ', "_");
    match normalized.as_str() {
        "positive_trigger" | "positive" => Some(TRIGGER_BUCKET_POSITIVE),
        "negative_trigger" | "negative" => Some(TRIGGER_BUCKET_NEGATIVE),
        "boundary_ambiguous" | "boundary" | "ambiguous" => Some(TRIGGER_BUCKET_BOUNDARY),
        "adjacent_skill_confusion" | "adjacent" | "confusion" => Some(TRIGGER_BUCKET_ADJACENT),
        _ => None,
    }
}

fn parse_trigger_bucket_coverage(path: &Path) -> Result<EvalTriggerBucketCoverage, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("Read trigger eval set failed: {e}"))?;
    let value = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|e| format!("Parse trigger eval set failed: {e}"))?;
    let Some(items) = value.as_array() else {
        return Err("Expected trigger eval dataset top-level JSON array".to_string());
    };
    let mut positive = 0usize;
    let mut negative = 0usize;
    let mut boundary = 0usize;
    let mut adjacent = 0usize;
    for (index, item) in items.iter().enumerate() {
        let Some(obj) = item.as_object() else {
            return Err(format!(
                "Trigger dataset item #{} must be an object",
                index + 1
            ));
        };
        let query = obj
            .get("query")
            .and_then(|v| v.as_str())
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
            .ok_or_else(|| {
                format!(
                    "Trigger dataset item #{} missing non-empty query",
                    index + 1
                )
            })?;
        let _ = query;
        let should_trigger = obj
            .get("should_trigger")
            .and_then(|v| v.as_bool())
            .ok_or_else(|| {
                format!(
                    "Trigger dataset item #{} missing boolean should_trigger",
                    index + 1
                )
            })?;
        let bucket = obj
            .get("test_bucket")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("Trigger dataset item #{} missing test_bucket", index + 1))?;
        let normalized_bucket = normalize_trigger_bucket(bucket).ok_or_else(|| {
            format!(
                "Trigger dataset item #{} has invalid test_bucket '{}'",
                index + 1,
                bucket
            )
        })?;
        if normalized_bucket == TRIGGER_BUCKET_POSITIVE && !should_trigger {
            return Err(format!(
                "Trigger dataset item #{} bucket '{}' requires should_trigger=true",
                index + 1,
                normalized_bucket
            ));
        }
        if normalized_bucket == TRIGGER_BUCKET_NEGATIVE && should_trigger {
            return Err(format!(
                "Trigger dataset item #{} bucket '{}' requires should_trigger=false",
                index + 1,
                normalized_bucket
            ));
        }
        match normalized_bucket {
            TRIGGER_BUCKET_POSITIVE => positive += 1,
            TRIGGER_BUCKET_NEGATIVE => negative += 1,
            TRIGGER_BUCKET_BOUNDARY => boundary += 1,
            TRIGGER_BUCKET_ADJACENT => adjacent += 1,
            _ => {}
        }
    }
    let mut failed_buckets = Vec::<String>::new();
    if positive < TRIGGER_BUCKET_MIN_SAMPLES {
        failed_buckets.push(TRIGGER_BUCKET_POSITIVE.to_string());
    }
    if negative < TRIGGER_BUCKET_MIN_SAMPLES {
        failed_buckets.push(TRIGGER_BUCKET_NEGATIVE.to_string());
    }
    if boundary < TRIGGER_BUCKET_MIN_SAMPLES {
        failed_buckets.push(TRIGGER_BUCKET_BOUNDARY.to_string());
    }
    if adjacent < TRIGGER_BUCKET_MIN_SAMPLES {
        failed_buckets.push(TRIGGER_BUCKET_ADJACENT.to_string());
    }
    Ok(EvalTriggerBucketCoverage {
        min_required_per_bucket: TRIGGER_BUCKET_MIN_SAMPLES,
        positive_trigger: positive,
        negative_trigger: negative,
        boundary_ambiguous: boundary,
        adjacent_skill_confusion: adjacent,
        all_buckets_met: failed_buckets.is_empty(),
        failed_buckets,
    })
}

fn taxonomy_enum_allowed(value: &str, allowed: &[&str]) -> bool {
    allowed.iter().any(|item| value == *item)
}

fn validate_taxonomy_classification(taxonomy: &SkillTaxonomyClassification) -> Result<(), String> {
    if !taxonomy_enum_allowed(
        &taxonomy.sok_representation,
        &["Natural-language", "Tool macros", "Code-as-skill", "Hybrid"],
    ) {
        return Err(format!(
            "Invalid taxonomy.sok_representation '{}'",
            taxonomy.sok_representation
        ));
    }
    if !taxonomy_enum_allowed(
        &taxonomy.sok_scope,
        &[
            "Single-tool",
            "Multi-tool",
            "Web",
            "OS/Desktop",
            "Software Engineering",
            "Robotics/Physical",
        ],
    ) {
        return Err(format!(
            "Invalid taxonomy.sok_scope '{}'",
            taxonomy.sok_scope
        ));
    }
    if !taxonomy_enum_allowed(
        &taxonomy.anthropic_category,
        &[
            "Document & Asset Creation",
            "Workflow Automation",
            "MCP Enhancement",
        ],
    ) {
        return Err(format!(
            "Invalid taxonomy.anthropic_category '{}'",
            taxonomy.anthropic_category
        ));
    }
    if !taxonomy_enum_allowed(
        &taxonomy.skillsbench_domain,
        &[
            "Healthcare",
            "Manufacturing",
            "Cybersecurity",
            "Natural Science",
            "Energy",
            "Office & White Collar",
            "Finance",
            "Media & Content Production",
            "Robotics",
            "Mathematics",
            "Software Engineering",
        ],
    ) {
        return Err(format!(
            "Invalid taxonomy.skillsbench_domain '{}'",
            taxonomy.skillsbench_domain
        ));
    }
    if !taxonomy_enum_allowed(
        &taxonomy.skillsbench_difficulty_core,
        &["Core", "Extended", "Extreme"],
    ) {
        return Err(format!(
            "Invalid taxonomy.skillsbench_difficulty_core '{}'",
            taxonomy.skillsbench_difficulty_core
        ));
    }
    if !taxonomy_enum_allowed(
        &taxonomy.skillsbench_difficulty_level,
        &["Easy", "Medium", "Hard"],
    ) {
        return Err(format!(
            "Invalid taxonomy.skillsbench_difficulty_level '{}'",
            taxonomy.skillsbench_difficulty_level
        ));
    }
    Ok(())
}

fn is_skill_name_valid_for_generation(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 64
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
}

fn read_openai_interface_fields(skill_path: &Path) -> Result<(PathBuf, String, String), String> {
    let Some(skill_dir) = skill_path.parent() else {
        return Err("Skill path has no parent directory".to_string());
    };
    let openai_yaml_path = skill_dir.join("agents").join("openai.yaml");
    if !openai_yaml_path.exists() {
        return Err(format!(
            "Missing agents/openai.yaml at {}",
            openai_yaml_path.to_string_lossy()
        ));
    }
    let raw = fs::read_to_string(&openai_yaml_path)
        .map_err(|e| format!("Read openai.yaml failed: {e}"))?;
    let root = serde_yaml::from_str::<YamlValue>(&raw)
        .map_err(|e| format!("Parse openai.yaml failed: {e}"))?;
    let root_map = root
        .as_mapping()
        .ok_or_else(|| "openai.yaml root must be a mapping".to_string())?;
    let interface = root_map
        .get(YamlValue::String("interface".to_string()))
        .and_then(|value| value.as_mapping())
        .ok_or_else(|| "openai.yaml must include interface mapping".to_string())?;
    let display_name = yaml_get_string_any(interface, &["display_name", "displayName"])
        .ok_or_else(|| "openai.yaml interface.display_name is required".to_string())?;
    let short_description =
        yaml_get_string_any(interface, &["short_description", "shortDescription"])
            .ok_or_else(|| "openai.yaml interface.short_description is required".to_string())?;
    Ok((openai_yaml_path, display_name, short_description))
}

fn validate_structure_and_syntax(skill_path: &Path) -> Result<String, String> {
    let raw = fs::read_to_string(skill_path).map_err(|e| format!("Read SKILL.md failed: {e}"))?;
    let (frontmatter, _) = split_skill_frontmatter(&raw)?;
    let name = yaml_get_string_any(&frontmatter, &["name"])
        .ok_or_else(|| "SKILL.md frontmatter missing name".to_string())?;
    let description = yaml_get_string_any(&frontmatter, &["description"])
        .ok_or_else(|| "SKILL.md frontmatter missing description".to_string())?;
    if name.trim().is_empty() || description.trim().is_empty() {
        return Err("SKILL.md frontmatter has empty name/description".to_string());
    }
    Ok("SKILL.md frontmatter structure is valid.".to_string())
}

fn validate_generation_guardrail(skill_path: &Path) -> Result<String, String> {
    let raw = fs::read_to_string(skill_path).map_err(|e| format!("Read SKILL.md failed: {e}"))?;
    let (frontmatter, _) = split_skill_frontmatter(&raw)?;
    let name = yaml_get_string_any(&frontmatter, &["name"])
        .ok_or_else(|| "SKILL.md frontmatter missing name".to_string())?;
    if !is_skill_name_valid_for_generation(&name) {
        return Err(format!(
            "Skill name '{}' must use lowercase letters, digits, hyphens and <=64 chars",
            name
        ));
    }
    let (_path, display_name, short_description) = read_openai_interface_fields(skill_path)?;
    if display_name.trim().is_empty() || short_description.trim().is_empty() {
        return Err("openai.yaml interface fields must be non-empty".to_string());
    }
    Ok("Generation guardrails passed (name + openai interface fields).".to_string())
}

fn validate_ui_metadata_consistency(skill_path: &Path) -> Result<String, String> {
    let raw = fs::read_to_string(skill_path).map_err(|e| format!("Read SKILL.md failed: {e}"))?;
    let (frontmatter, _) = split_skill_frontmatter(&raw)?;
    let name = yaml_get_string_any(&frontmatter, &["name"])
        .ok_or_else(|| "SKILL.md frontmatter missing name".to_string())?;
    let description = yaml_get_string_any(&frontmatter, &["description"])
        .ok_or_else(|| "SKILL.md frontmatter missing description".to_string())?;
    let (_path, display_name, short_description) = read_openai_interface_fields(skill_path)?;
    if short_description.len() > 160 {
        return Err("openai.yaml short_description exceeds 160 characters".to_string());
    }
    let name_tokens = name
        .split('-')
        .filter(|token| !token.trim().is_empty())
        .collect::<Vec<_>>();
    if !name_tokens.is_empty() {
        let lowered_display = display_name.to_lowercase();
        let has_overlap = name_tokens
            .iter()
            .any(|token| lowered_display.contains(&token.to_lowercase()));
        if !has_overlap {
            return Err(
                "openai.yaml display_name should reflect SKILL.md name tokens for UI consistency"
                    .to_string(),
            );
        }
    }
    if description.trim().len() < 10 {
        return Err(
            "SKILL.md description is too short for reliable UI metadata alignment".to_string(),
        );
    }
    Ok("SKILL.md and openai.yaml metadata consistency checks passed.".to_string())
}

#[derive(Debug, Clone)]
struct SkillShapeProfile {
    shape: &'static str,
    has_agents_dir: bool,
    has_openai_yaml: bool,
    has_scripts_dir: bool,
    has_references_dir: bool,
    has_assets_dir: bool,
}

impl SkillShapeProfile {
    fn is_agent_shape(&self) -> bool {
        self.has_agents_dir || self.has_openai_yaml
    }
}

fn analyze_skill_shape(skill_path: &Path) -> Result<SkillShapeProfile, String> {
    let Some(skill_dir) = skill_path.parent() else {
        return Err("Skill path has no parent directory".to_string());
    };
    let has_agents_dir = skill_dir.join("agents").is_dir();
    let has_openai_yaml = skill_dir.join("agents").join("openai.yaml").is_file();
    let has_scripts_dir = skill_dir.join("scripts").is_dir();
    let has_references_dir = skill_dir.join("references").is_dir();
    let has_assets_dir = skill_dir.join("assets").is_dir();
    let extra_components = usize::from(has_scripts_dir)
        + usize::from(has_references_dir)
        + usize::from(has_assets_dir);
    let shape = if has_agents_dir || has_openai_yaml {
        if extra_components > 0 {
            "agent-hybrid"
        } else {
            "agent"
        }
    } else if has_scripts_dir && (has_references_dir || has_assets_dir) {
        "hybrid"
    } else if has_scripts_dir {
        "scripted"
    } else if has_references_dir || has_assets_dir {
        "resource"
    } else {
        "markdown-only"
    };
    Ok(SkillShapeProfile {
        shape,
        has_agents_dir,
        has_openai_yaml,
        has_scripts_dir,
        has_references_dir,
        has_assets_dir,
    })
}

fn validate_script_smoke_requirements(skill_path: &Path) -> Result<String, String> {
    let Some(skill_dir) = skill_path.parent() else {
        return Err("Skill path has no parent directory".to_string());
    };
    let scripts_dir = skill_dir.join("scripts");
    if !scripts_dir.exists() {
        return Ok("No scripts directory found; script smoke requirement skipped.".to_string());
    }
    let script_files = fs::read_dir(&scripts_dir)
        .map_err(|e| format!("Read scripts directory failed: {e}"))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_file())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| {
                    matches!(
                        ext.to_ascii_lowercase().as_str(),
                        "py" | "ps1" | "sh" | "bat" | "cmd"
                    )
                })
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    if script_files.is_empty() {
        return Ok("No executable scripts found; script smoke requirement skipped.".to_string());
    }
    let raw = fs::read_to_string(skill_path).map_err(|e| format!("Read SKILL.md failed: {e}"))?;
    let (_frontmatter, body) = split_skill_frontmatter(&raw)?;
    let mut missing_examples = Vec::<String>::new();
    for file in &script_files {
        let file_name = file.file_name().to_string_lossy().to_string();
        if !body.contains(&file_name) {
            missing_examples.push(file_name);
        }
    }
    if !missing_examples.is_empty() {
        return Err(format!(
            "Missing script-level usage examples in SKILL.md for: {}",
            missing_examples.join(", ")
        ));
    }
    Ok(format!(
        "Script smoke requirement passed for {} scripts.",
        script_files.len()
    ))
}

fn quick_check_item(
    key: &str,
    title: &str,
    blocking: bool,
    passed: bool,
    message: String,
    elapsed_ms: u128,
    evidence_path: Option<String>,
) -> EvalQuickCheckItem {
    EvalQuickCheckItem {
        key: key.to_string(),
        title: title.to_string(),
        blocking,
        passed,
        message,
        elapsed_ms,
        evidence_path,
    }
}

fn run_stage0_quick_checks(
    skill_path: &Path,
    trigger_eval_set_path: &Path,
    taxonomy_result: &EnsureSkillTaxonomyResult,
) -> EvalQuickChecks {
    let mut checks = Vec::<EvalQuickCheckItem>::new();
    let mut all_passed = true;
    let skill_evidence_path = path_to_utf8(skill_path).ok();
    let trigger_evidence_path = path_to_utf8(trigger_eval_set_path).ok();
    let mut bucket_coverage: Option<EvalTriggerBucketCoverage> = None;
    let mut skill_shape: Option<SkillShapeProfile> = None;

    {
        let started = std::time::Instant::now();
        let result = analyze_skill_shape(skill_path);
        let elapsed_ms = started.elapsed().as_millis();
        match result {
            Ok(profile) => {
                let message = format!(
                    "Detected skill shape '{}' (agents_dir={}, openai_yaml={}, scripts_dir={}, references_dir={}, assets_dir={}).",
                    profile.shape,
                    profile.has_agents_dir,
                    profile.has_openai_yaml,
                    profile.has_scripts_dir,
                    profile.has_references_dir,
                    profile.has_assets_dir
                );
                checks.push(quick_check_item(
                    "skill-shape-analysis",
                    "skill-shape-analysis",
                    true,
                    true,
                    message,
                    elapsed_ms,
                    skill_evidence_path.clone(),
                ));
                skill_shape = Some(profile);
            }
            Err(message) => {
                all_passed = false;
                checks.push(quick_check_item(
                    "skill-shape-analysis",
                    "skill-shape-analysis",
                    true,
                    false,
                    message,
                    elapsed_ms,
                    skill_evidence_path.clone(),
                ));
            }
        }
    }

    {
        let started = std::time::Instant::now();
        let result = if taxonomy_result.status == "failed" {
            Err(format!(
                "Taxonomy classification failed before quick checks: {}",
                taxonomy_result.message
            ))
        } else if let Some(taxonomy) = taxonomy_result.taxonomy.as_ref() {
            validate_taxonomy_classification(taxonomy)
                .map(|_| "Taxonomy classification fields and enum values are valid.".to_string())
        } else {
            Err("Taxonomy payload missing.".to_string())
        };
        let elapsed_ms = started.elapsed().as_millis();
        match result {
            Ok(message) => checks.push(quick_check_item(
                "taxonomy-validity",
                "taxonomy-validity",
                true,
                true,
                message,
                elapsed_ms,
                skill_evidence_path.clone(),
            )),
            Err(message) => {
                all_passed = false;
                checks.push(quick_check_item(
                    "taxonomy-validity",
                    "taxonomy-validity",
                    true,
                    false,
                    message,
                    elapsed_ms,
                    skill_evidence_path.clone(),
                ));
            }
        }
    }

    {
        let started = std::time::Instant::now();
        let result = validate_structure_and_syntax(skill_path);
        let elapsed_ms = started.elapsed().as_millis();
        match result {
            Ok(message) => checks.push(quick_check_item(
                "structure-syntax",
                "structure-syntax",
                true,
                true,
                message,
                elapsed_ms,
                skill_evidence_path.clone(),
            )),
            Err(message) => {
                all_passed = false;
                checks.push(quick_check_item(
                    "structure-syntax",
                    "structure-syntax",
                    true,
                    false,
                    message,
                    elapsed_ms,
                    skill_evidence_path.clone(),
                ));
            }
        }
    }

    let should_run_agent_checks = skill_shape
        .as_ref()
        .map(SkillShapeProfile::is_agent_shape)
        .unwrap_or(true);

    {
        let started = std::time::Instant::now();
        if should_run_agent_checks {
            let result = validate_generation_guardrail(skill_path);
            let elapsed_ms = started.elapsed().as_millis();
            match result {
                Ok(message) => checks.push(quick_check_item(
                    "generation-guardrail",
                    "generation-guardrail",
                    true,
                    true,
                    message,
                    elapsed_ms,
                    skill_evidence_path.clone(),
                )),
                Err(message) => {
                    all_passed = false;
                    checks.push(quick_check_item(
                        "generation-guardrail",
                        "generation-guardrail",
                        true,
                        false,
                        message,
                        elapsed_ms,
                        skill_evidence_path.clone(),
                    ));
                }
            }
        } else {
            let elapsed_ms = started.elapsed().as_millis();
            let shape = skill_shape
                .as_ref()
                .map(|profile| profile.shape)
                .unwrap_or("unknown");
            checks.push(quick_check_item(
                "generation-guardrail",
                "generation-guardrail",
                false,
                true,
                format!(
                    "Skipped: skill shape '{}' does not require agents/openai.yaml generation interface checks.",
                    shape
                ),
                elapsed_ms,
                skill_evidence_path.clone(),
            ));
        }
    }

    {
        let started = std::time::Instant::now();
        if should_run_agent_checks {
            let result = validate_ui_metadata_consistency(skill_path);
            let elapsed_ms = started.elapsed().as_millis();
            match result {
                Ok(message) => checks.push(quick_check_item(
                    "ui-metadata-consistency",
                    "ui-metadata-consistency",
                    true,
                    true,
                    message,
                    elapsed_ms,
                    skill_evidence_path.clone(),
                )),
                Err(message) => {
                    all_passed = false;
                    checks.push(quick_check_item(
                        "ui-metadata-consistency",
                        "ui-metadata-consistency",
                        true,
                        false,
                        message,
                        elapsed_ms,
                        skill_evidence_path.clone(),
                    ));
                }
            }
        } else {
            let elapsed_ms = started.elapsed().as_millis();
            let shape = skill_shape
                .as_ref()
                .map(|profile| profile.shape)
                .unwrap_or("unknown");
            checks.push(quick_check_item(
                "ui-metadata-consistency",
                "ui-metadata-consistency",
                false,
                true,
                format!(
                    "Skipped: skill shape '{}' does not require agents/openai.yaml UI metadata checks.",
                    shape
                ),
                elapsed_ms,
                skill_evidence_path.clone(),
            ));
        }
    }

    {
        let started = std::time::Instant::now();
        let result = validate_script_smoke_requirements(skill_path);
        let elapsed_ms = started.elapsed().as_millis();
        match result {
            Ok(message) => checks.push(quick_check_item(
                "script-smoke",
                "script-smoke",
                true,
                true,
                message,
                elapsed_ms,
                skill_evidence_path.clone(),
            )),
            Err(message) => {
                all_passed = false;
                checks.push(quick_check_item(
                    "script-smoke",
                    "script-smoke",
                    true,
                    false,
                    message,
                    elapsed_ms,
                    skill_evidence_path.clone(),
                ));
            }
        }
    }

    {
        let started = std::time::Instant::now();
        let result = parse_trigger_bucket_coverage(trigger_eval_set_path);
        let elapsed_ms = started.elapsed().as_millis();
        match result {
            Ok(coverage) => {
                let coverage_ok = coverage.all_buckets_met;
                bucket_coverage = Some(coverage.clone());
                if !coverage_ok {
                    all_passed = false;
                }
                let message = if coverage_ok {
                    format!(
                        "Trigger bucket coverage passed with minimum {} per bucket.",
                        TRIGGER_BUCKET_MIN_SAMPLES
                    )
                } else {
                    format!(
                        "Trigger bucket coverage failed. Buckets below minimum {}: {}",
                        TRIGGER_BUCKET_MIN_SAMPLES,
                        coverage.failed_buckets.join(", ")
                    )
                };
                checks.push(quick_check_item(
                    "trigger-bucket-coverage",
                    "trigger-bucket-coverage",
                    true,
                    coverage_ok,
                    message,
                    elapsed_ms,
                    trigger_evidence_path.clone(),
                ));
            }
            Err(message) => {
                all_passed = false;
                checks.push(quick_check_item(
                    "trigger-bucket-coverage",
                    "trigger-bucket-coverage",
                    true,
                    false,
                    message,
                    elapsed_ms,
                    trigger_evidence_path.clone(),
                ));
            }
        }
    }

    EvalQuickChecks {
        all_passed,
        checks,
        bucket_coverage,
    }
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

fn summarize_evidence(
    trigger_clean: &TriggerEvalOutput,
    trigger_complex: Option<&TriggerEvalOutput>,
    functional: &FunctionalEvalOutput,
    functional_without_skill: Option<&FunctionalEvalOutput>,
) -> EvalEvidenceSummary {
    let mut total_runs = 0usize;
    let mut captured_transcripts = 0usize;
    let mut captured_timing = 0usize;
    let mut captured_tokens = 0usize;

    let mut ingest_trigger_rows = |rows: &[TriggerEvalResultItem]| -> () {
        total_runs += rows.len();
        for row in rows {
            if row
                .raw_response_path
                .as_ref()
                .is_some_and(|path| !path.trim().is_empty())
            {
                captured_transcripts += 1;
            }
            if row.latency_ms.is_some() {
                captured_timing += 1;
            }
            if row.input_tokens.is_some() || row.output_tokens.is_some() {
                captured_tokens += 1;
            }
        }
    };

    if let Some(rows) = trigger_clean.results.as_ref() {
        ingest_trigger_rows(rows);
    }
    if let Some(extra) = trigger_complex {
        if let Some(rows) = extra.results.as_ref() {
            ingest_trigger_rows(rows);
        }
    }
    if let Some(rows) = functional.results.as_ref() {
        total_runs += rows.len();
        for row in rows {
            if row
                .raw_response_path
                .as_ref()
                .is_some_and(|path| !path.trim().is_empty())
            {
                captured_transcripts += 1;
            }
            if row.latency_ms.is_some() {
                captured_timing += 1;
            }
            if row.input_tokens.is_some() || row.output_tokens.is_some() {
                captured_tokens += 1;
            }
        }
    }
    if let Some(extra) = functional_without_skill {
        if let Some(rows) = extra.results.as_ref() {
            total_runs += rows.len();
            for row in rows {
                if row
                    .raw_response_path
                    .as_ref()
                    .is_some_and(|path| !path.trim().is_empty())
                {
                    captured_transcripts += 1;
                }
                if row.latency_ms.is_some() {
                    captured_timing += 1;
                }
                if row.input_tokens.is_some() || row.output_tokens.is_some() {
                    captured_tokens += 1;
                }
            }
        }
    }

    EvalEvidenceSummary {
        total_runs,
        captured_transcripts,
        captured_timing,
        captured_tokens,
    }
}

fn build_eval_advisory(
    mode: &str,
    metrics: &EvalTriggerMetrics,
    functional_delta: Option<f64>,
) -> EvalAdvisory {
    let precision = metrics.precision;
    let recall = metrics.recall;
    let delta_for_gate = functional_delta.unwrap_or(0.0);
    let has_functional_gate = mode != "quick";

    let is_high_risk = precision < ADVISORY_HIGH_RISK_PRECISION_THRESHOLD
        || recall < ADVISORY_HIGH_RISK_RECALL_THRESHOLD
        || functional_delta.is_some_and(|delta| delta < ADVISORY_HIGH_RISK_DELTA_THRESHOLD);

    let pass_trigger_gate =
        precision >= ADVISORY_PASS_PRECISION_THRESHOLD && recall >= ADVISORY_PASS_RECALL_THRESHOLD;
    let pass_delta_gate = !has_functional_gate || delta_for_gate >= 0.0;
    let is_pass = !is_high_risk && pass_trigger_gate && pass_delta_gate;

    let mut reasons = Vec::new();
    if precision < ADVISORY_PASS_PRECISION_THRESHOLD {
        reasons.push(format!(
            "Trigger precision {:.2} is below pass threshold {:.2}.",
            precision, ADVISORY_PASS_PRECISION_THRESHOLD
        ));
    }
    if recall < ADVISORY_PASS_RECALL_THRESHOLD {
        reasons.push(format!(
            "Trigger recall {:.2} is below pass threshold {:.2}.",
            recall, ADVISORY_PASS_RECALL_THRESHOLD
        ));
    }
    if has_functional_gate {
        if functional_delta.is_none() {
            reasons.push(
                "Functional delta unavailable; compared using trigger metrics only.".to_string(),
            );
        } else if delta_for_gate < 0.0 {
            reasons.push(format!(
                "Functional delta {:.3} indicates regression vs no-skill baseline.",
                delta_for_gate
            ));
        } else {
            reasons.push(format!(
                "Functional delta {:.3} is non-negative vs no-skill baseline.",
                delta_for_gate
            ));
        }
    }

    if is_high_risk {
        if precision < ADVISORY_HIGH_RISK_PRECISION_THRESHOLD {
            reasons.push(format!(
                "Precision {:.2} is below high-risk threshold {:.2}.",
                precision, ADVISORY_HIGH_RISK_PRECISION_THRESHOLD
            ));
        }
        if recall < ADVISORY_HIGH_RISK_RECALL_THRESHOLD {
            reasons.push(format!(
                "Recall {:.2} is below high-risk threshold {:.2}.",
                recall, ADVISORY_HIGH_RISK_RECALL_THRESHOLD
            ));
        }
        if functional_delta.is_some_and(|delta| delta < ADVISORY_HIGH_RISK_DELTA_THRESHOLD) {
            reasons.push(format!(
                "Functional delta {:.3} is below high-risk threshold {:.2}.",
                delta_for_gate, ADVISORY_HIGH_RISK_DELTA_THRESHOLD
            ));
        }
    } else if is_pass {
        reasons.push(
            "All advisory pass thresholds are satisfied; keep this skill available.".to_string(),
        );
    } else {
        reasons.push("One or more pass thresholds are not met.".to_string());
    }

    EvalAdvisory {
        level: if is_high_risk {
            "high_risk".to_string()
        } else if is_pass {
            "pass".to_string()
        } else {
            "warn".to_string()
        },
        reasons,
        non_blocking: true,
    }
}

fn compute_economics(
    functional_with_skill: Option<&FunctionalEvalOutput>,
    functional_without_skill: Option<&FunctionalEvalOutput>,
) -> EvalEconomics {
    let with_rows = functional_with_skill
        .and_then(|output| output.results.as_ref())
        .cloned()
        .unwrap_or_default();
    let without_rows = functional_without_skill
        .and_then(|output| output.results.as_ref())
        .cloned()
        .unwrap_or_default();
    let with_map = with_rows
        .into_iter()
        .map(|item| (item.case_id.clone(), item))
        .collect::<HashMap<_, _>>();
    let mut gross_time_saved_ms = 0.0_f64;
    let mut gross_token_saved = 0.0_f64;
    let mut negative_time_waste_ms = 0.0_f64;
    let mut negative_token_waste = 0.0_f64;
    let mut baseline_samples = 0usize;
    let mut evaluated_pairs = 0usize;
    for base in without_rows {
        if !base.passed {
            continue;
        }
        baseline_samples += 1;
        let Some(with_item) = with_map.get(&base.case_id) else {
            continue;
        };
        evaluated_pairs += 1;
        let t0 = base.latency_ms.unwrap_or(0) as f64;
        let u0 = (base.input_tokens.unwrap_or(0) + base.output_tokens.unwrap_or(0)) as f64;
        let t1 = with_item.latency_ms.unwrap_or(0) as f64;
        let u1 =
            (with_item.input_tokens.unwrap_or(0) + with_item.output_tokens.unwrap_or(0)) as f64;
        if with_item.passed {
            gross_time_saved_ms += t0 - t1;
            gross_token_saved += u0 - u1;
        } else {
            negative_time_waste_ms += t1;
            negative_token_waste += u1;
        }
    }
    let net_time_saved_ms = gross_time_saved_ms - negative_time_waste_ms;
    let net_token_saved = gross_token_saved - negative_token_waste;
    EvalEconomics {
        gross_time_saved_ms: round4(gross_time_saved_ms),
        gross_token_saved: round4(gross_token_saved),
        negative_time_waste_ms: round4(negative_time_waste_ms),
        negative_token_waste: round4(negative_token_waste),
        net_time_saved_ms: round4(net_time_saved_ms),
        net_token_saved: round4(net_token_saved),
        net_usd: Some(round4(net_token_saved * ESTIMATED_USD_PER_TOKEN)),
        baseline_samples,
        evaluated_pairs,
    }
}

fn build_module_results(
    mode: &str,
    selected_modules: &[String],
    quick_checks: &EvalQuickChecks,
    trigger_metrics: &EvalTriggerMetrics,
    functional_stats: Option<&EvalRateStats>,
    robustness_mean: f64,
    economics: &EvalEconomics,
    evidence_summary: &EvalEvidenceSummary,
) -> Vec<EvalModuleResult> {
    let mut out = Vec::<EvalModuleResult>::new();
    for key in EVAL_ALL_MODULE_KEYS {
        let selected = contains_module(selected_modules, key);
        if !selected {
            out.push(EvalModuleResult {
                key: key.to_string(),
                title: module_title(key).to_string(),
                selected: false,
                status: "skipped".to_string(),
                passed: None,
                score: None,
                message: Some("Module not selected.".to_string()),
            });
            continue;
        }
        match key {
            EVAL_MODULE_TRIGGER_ACCURACY => {
                let coverage_ok = quick_checks
                    .bucket_coverage
                    .as_ref()
                    .map(|item| item.all_buckets_met)
                    .unwrap_or(false);
                let passed = trigger_metrics.precision >= ADVISORY_PASS_PRECISION_THRESHOLD
                    && trigger_metrics.recall >= ADVISORY_PASS_RECALL_THRESHOLD
                    && coverage_ok;
                let score = round4(
                    (trigger_metrics.precision
                        + trigger_metrics.recall
                        + (1.0 - trigger_metrics.fpr))
                        / 3.0,
                );
                out.push(EvalModuleResult {
                    key: key.to_string(),
                    title: module_title(key).to_string(),
                    selected: true,
                    status: if passed { "pass" } else { "fail" }.to_string(),
                    passed: Some(passed),
                    score: Some(score),
                    message: Some(format!(
                        "precision={:.3}, recall={:.3}, fpr={:.3}, bucketCoverage={}",
                        trigger_metrics.precision,
                        trigger_metrics.recall,
                        trigger_metrics.fpr,
                        coverage_ok
                    )),
                });
            }
            EVAL_MODULE_EXECUTION_CORRECTNESS => {
                let maybe_rate = functional_stats.map(|item| item.mean);
                let passed = maybe_rate.is_some_and(|value| value >= 0.75);
                out.push(EvalModuleResult {
                    key: key.to_string(),
                    title: module_title(key).to_string(),
                    selected: true,
                    status: if maybe_rate.is_some() {
                        if passed {
                            "pass"
                        } else {
                            "fail"
                        }
                    } else {
                        "skipped"
                    }
                    .to_string(),
                    passed: maybe_rate.map(|_| passed),
                    score: maybe_rate.map(round4),
                    message: Some(match maybe_rate {
                        Some(value) => format!("functional pass rate mean={value:.3}"),
                        None => "Functional execution data unavailable.".to_string(),
                    }),
                });
            }
            EVAL_MODULE_ROBUSTNESS_SECURITY => {
                let passed = robustness_mean >= 0.70;
                out.push(EvalModuleResult {
                    key: key.to_string(),
                    title: module_title(key).to_string(),
                    selected: true,
                    status: if passed { "pass" } else { "fail" }.to_string(),
                    passed: Some(passed),
                    score: Some(round4(robustness_mean)),
                    message: Some(format!("robustness mean={:.3}", robustness_mean)),
                });
            }
            EVAL_MODULE_ECONOMICS => {
                let passed = economics.net_time_saved_ms >= 0.0 && economics.net_token_saved >= 0.0;
                out.push(EvalModuleResult {
                    key: key.to_string(),
                    title: module_title(key).to_string(),
                    selected: true,
                    status: if passed { "pass" } else { "fail" }.to_string(),
                    passed: Some(passed),
                    score: None,
                    message: Some(format!(
                        "net_time_saved_ms={:.1}, net_token_saved={:.1}",
                        economics.net_time_saved_ms, economics.net_token_saved
                    )),
                });
            }
            EVAL_MODULE_AUDITABILITY => {
                let has_runs = evidence_summary.total_runs > 0;
                let passed = has_runs
                    && evidence_summary.captured_transcripts > 0
                    && evidence_summary.captured_timing > 0
                    && evidence_summary.captured_tokens > 0;
                let score = if has_runs {
                    let denom = (evidence_summary.total_runs * 3) as f64;
                    Some(round4(
                        (evidence_summary.captured_transcripts
                            + evidence_summary.captured_timing
                            + evidence_summary.captured_tokens) as f64
                            / denom,
                    ))
                } else {
                    None
                };
                out.push(EvalModuleResult {
                    key: key.to_string(),
                    title: module_title(key).to_string(),
                    selected: true,
                    status: if passed { "pass" } else { "fail" }.to_string(),
                    passed: Some(passed),
                    score,
                    message: Some(format!(
                        "runs={}, transcripts={}, timing={}, tokens={}",
                        evidence_summary.total_runs,
                        evidence_summary.captured_transcripts,
                        evidence_summary.captured_timing,
                        evidence_summary.captured_tokens
                    )),
                });
            }
            _ => {}
        }
    }
    if mode == "quick" {
        return EVAL_ALL_MODULE_KEYS
            .iter()
            .map(|key| EvalModuleResult {
                key: (*key).to_string(),
                title: module_title(key).to_string(),
                selected: false,
                status: "skipped".to_string(),
                passed: None,
                score: None,
                message: Some("Quick mode does not run full modules.".to_string()),
            })
            .collect::<Vec<_>>();
    }
    out
}

fn build_eval_gate(
    mode: &str,
    quick_checks: &EvalQuickChecks,
    selected_modules: &[String],
    module_results: &[EvalModuleResult],
) -> EvalGate {
    if mode == "quick" {
        return EvalGate {
            quick_blocking_pass: quick_checks.all_passed,
            full_release_pass: None,
            partial_release: None,
            selected_modules: Vec::new(),
            failed_modules: Vec::new(),
        };
    }
    let failed_modules = module_results
        .iter()
        .filter(|item| item.selected && item.status != "pass")
        .map(|item| item.key.clone())
        .collect::<Vec<_>>();
    EvalGate {
        quick_blocking_pass: quick_checks.all_passed,
        full_release_pass: Some(failed_modules.is_empty()),
        partial_release: Some(selected_modules.len() < EVAL_ALL_MODULE_KEYS.len()),
        selected_modules: selected_modules.to_vec(),
        failed_modules,
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

fn normalize_max_parallel_arms(value: Option<usize>) -> usize {
    value
        .unwrap_or(DEFAULT_MAX_PARALLEL_ARMS)
        .clamp(MIN_MAX_PARALLEL_ARMS, MAX_MAX_PARALLEL_ARMS)
}

fn normalize_eval_workers(value: Option<usize>, default_value: usize) -> usize {
    value
        .unwrap_or(default_value)
        .clamp(MIN_EVAL_WORKERS, MAX_EVAL_WORKERS)
}

fn ceil_div_u64(value: u64, divisor: u64) -> u64 {
    if divisor <= 1 {
        return value;
    }
    value / divisor + u64::from(value % divisor != 0)
}

fn scale_seconds_for_workers(
    raw_seconds: u64,
    total_units: usize,
    configured_workers: usize,
) -> u64 {
    if raw_seconds <= 1 {
        return raw_seconds;
    }
    let bounded_workers = configured_workers.max(1).min(total_units.max(1));
    if bounded_workers <= 1 {
        return raw_seconds;
    }
    let efficiency_gain = 1.0 + ((bounded_workers - 1) as f64 * 0.82);
    ((raw_seconds as f64 / efficiency_gain).ceil() as u64).max(1)
}

fn estimate_parallel_chunk_wall_seconds(arm_seconds: &[u64], max_parallel_arms: usize) -> u64 {
    if arm_seconds.is_empty() {
        return 0;
    }
    let parallel = max_parallel_arms.max(1);
    let mut offset = 0usize;
    let mut total = 0u64;
    while offset < arm_seconds.len() {
        let chunk_end = (offset + parallel).min(arm_seconds.len());
        let chunk_max = arm_seconds[offset..chunk_end]
            .iter()
            .copied()
            .max()
            .unwrap_or(0);
        total = total.saturating_add(chunk_max);
        offset = chunk_end;
    }
    total
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
    let estimated_usd_min = round4(estimated_usd * ESTIMATED_COST_RANGE_LOW_FACTOR);
    let estimated_usd_max = round4(estimated_usd * ESTIMATED_COST_RANGE_HIGH_FACTOR);

    EvalCostEstimate {
        estimated_usd: round4(estimated_usd),
        estimated_usd_min: Some(estimated_usd_min),
        estimated_usd_max: Some(estimated_usd_max),
        actual_usd_estimate: estimated_usd,
        trigger_cases,
        functional_cases,
        api_calls_estimate,
        budget_limit_usd: budget_limit,
        budget_exceeded: budget_limit.is_some_and(|limit| estimated_usd_max > limit),
    }
}

fn estimate_step(
    key: &str,
    title: &str,
    stage: &str,
    module_key: Option<&str>,
    case_count: usize,
    runs: usize,
    calls_per_case: usize,
    input_tokens_per_case: usize,
    output_tokens_per_case: usize,
    seconds_per_case: u64,
) -> EvalEstimateStep {
    let total_units = case_count.saturating_mul(runs);
    let llm_calls = total_units.saturating_mul(calls_per_case);
    let estimated_input_tokens = total_units.saturating_mul(input_tokens_per_case);
    let estimated_output_tokens = total_units.saturating_mul(output_tokens_per_case);
    let estimated_total_tokens = estimated_input_tokens.saturating_add(estimated_output_tokens);
    let estimated_seconds = (total_units as u64).saturating_mul(seconds_per_case);
    EvalEstimateStep {
        key: key.to_string(),
        title: title.to_string(),
        stage: Some(stage.to_string()),
        module_key: module_key.map(std::string::ToString::to_string),
        case_count,
        runs,
        llm_calls,
        estimated_input_tokens,
        estimated_output_tokens,
        estimated_total_tokens,
        estimated_seconds,
    }
}

fn taxonomy_pending_for_skill(skill_path: &Path) -> bool {
    let home = crate::root_dir::default_home_dir();
    if let Ok(Some(_)) = load_registry_taxonomy(&home, skill_path) {
        return false;
    }
    let Ok(raw) = fs::read_to_string(skill_path) else {
        return false;
    };
    let Ok((frontmatter, _)) = split_skill_frontmatter(&raw) else {
        return false;
    };
    taxonomy_from_frontmatter(&frontmatter).is_none()
}

fn estimate_pipeline_plan(
    skill_path: &Path,
    mode: &str,
    model: &str,
    judge_models: &[String],
    selected_modules: &[String],
    repeats: usize,
    trigger_cases: usize,
    functional_cases: usize,
    max_cost_usd: Option<f64>,
    max_parallel_arms: usize,
    trigger_max_workers: usize,
    functional_max_workers: usize,
) -> EvalPipelineEstimate {
    let run_trigger_complex = should_run_trigger_complex(mode, selected_modules);
    let run_functional_with_skill = should_run_functional_with_skill(mode, selected_modules);
    let run_functional_without_skill = should_run_functional_without_skill(mode, selected_modules);
    let trigger_runs_per_repeat = 1 + usize::from(run_trigger_complex);
    let functional_runs_per_repeat =
        usize::from(run_functional_with_skill) + usize::from(run_functional_without_skill);
    let cost_estimate = estimate_cost(
        trigger_cases,
        functional_cases,
        trigger_runs_per_repeat * repeats,
        functional_runs_per_repeat * repeats,
        max_cost_usd,
    );

    let judge_count = judge_models.len().max(1);
    let mut steps: Vec<EvalEstimateStep> = Vec::new();
    let taxonomy_pending = taxonomy_pending_for_skill(skill_path);
    if taxonomy_pending {
        steps.push(estimate_step(
            "taxonomy",
            "taxonomy-classification",
            "stage0",
            None,
            1,
            1,
            1,
            ESTIMATE_TAXONOMY_INPUT_TOKENS_PER_CALL,
            ESTIMATE_TAXONOMY_OUTPUT_TOKENS_PER_CALL,
            ESTIMATE_TAXONOMY_SECONDS_PER_CALL,
        ));
    }

    for (key, title) in [
        ("quick-taxonomy-validity", "quick-taxonomy-validity"),
        ("quick-structure-syntax", "quick-structure-syntax"),
        ("quick-generation-guardrail", "quick-generation-guardrail"),
        (
            "quick-ui-metadata-consistency",
            "quick-ui-metadata-consistency",
        ),
        ("quick-script-smoke", "quick-script-smoke"),
        (
            "quick-trigger-bucket-coverage",
            "quick-trigger-bucket-coverage",
        ),
    ] {
        steps.push(estimate_step(key, title, "stage0", None, 1, 1, 0, 0, 0, 1));
    }

    steps.push(estimate_step(
        "trigger-clean",
        "trigger-clean",
        "stage1",
        Some(EVAL_MODULE_TRIGGER_ACCURACY),
        trigger_cases,
        repeats,
        1,
        ESTIMATE_TRIGGER_INPUT_TOKENS_PER_CALL,
        ESTIMATE_TRIGGER_OUTPUT_TOKENS_PER_CALL,
        ESTIMATE_TRIGGER_SECONDS_PER_CALL,
    ));

    if run_trigger_complex {
        steps.push(estimate_step(
            "trigger-complex",
            "trigger-complex",
            "stage2",
            Some(EVAL_MODULE_ROBUSTNESS_SECURITY),
            trigger_cases,
            repeats,
            1,
            ESTIMATE_TRIGGER_INPUT_TOKENS_PER_CALL,
            ESTIMATE_TRIGGER_OUTPUT_TOKENS_PER_CALL,
            ESTIMATE_TRIGGER_SECONDS_PER_CALL,
        ));
    }

    if run_functional_with_skill {
        let with_skill_calls_per_case = 2 + judge_count;
        let with_skill_input_tokens_per_case = ESTIMATE_FUNCTIONAL_EXEC_INPUT_TOKENS_PER_CALL
            + ESTIMATE_FUNCTIONAL_BASELINE_INPUT_TOKENS_PER_CALL
            + judge_count.saturating_mul(ESTIMATE_JUDGE_INPUT_TOKENS_PER_CALL);
        let with_skill_output_tokens_per_case = ESTIMATE_FUNCTIONAL_EXEC_OUTPUT_TOKENS_PER_CALL
            + ESTIMATE_FUNCTIONAL_BASELINE_OUTPUT_TOKENS_PER_CALL
            + judge_count.saturating_mul(ESTIMATE_JUDGE_OUTPUT_TOKENS_PER_CALL);
        let with_skill_seconds_per_case = ESTIMATE_FUNCTIONAL_EXEC_SECONDS_PER_CALL
            + ESTIMATE_FUNCTIONAL_BASELINE_SECONDS_PER_CALL
            + (judge_count as u64).saturating_mul(ESTIMATE_JUDGE_SECONDS_PER_CALL);
        let with_skill_module =
            if contains_module(selected_modules, EVAL_MODULE_EXECUTION_CORRECTNESS) {
                EVAL_MODULE_EXECUTION_CORRECTNESS
            } else {
                EVAL_MODULE_ECONOMICS
            };
        steps.push(estimate_step(
            "functional-with-skill",
            "functional-with-skill",
            "stage2",
            Some(with_skill_module),
            functional_cases,
            repeats,
            with_skill_calls_per_case,
            with_skill_input_tokens_per_case,
            with_skill_output_tokens_per_case,
            with_skill_seconds_per_case,
        ));
    }

    if run_functional_without_skill {
        let without_skill_calls_per_case = 1 + judge_count;
        let without_skill_input_tokens_per_case = ESTIMATE_FUNCTIONAL_BASELINE_INPUT_TOKENS_PER_CALL
            + judge_count.saturating_mul(ESTIMATE_JUDGE_INPUT_TOKENS_PER_CALL);
        let without_skill_output_tokens_per_case =
            ESTIMATE_FUNCTIONAL_BASELINE_OUTPUT_TOKENS_PER_CALL
                + judge_count.saturating_mul(ESTIMATE_JUDGE_OUTPUT_TOKENS_PER_CALL);
        let without_skill_seconds_per_case = ESTIMATE_FUNCTIONAL_BASELINE_SECONDS_PER_CALL
            + (judge_count as u64).saturating_mul(ESTIMATE_JUDGE_SECONDS_PER_CALL);
        steps.push(estimate_step(
            "functional-without-skill",
            "functional-without-skill",
            "stage2",
            Some(EVAL_MODULE_ECONOMICS),
            functional_cases,
            repeats,
            without_skill_calls_per_case,
            without_skill_input_tokens_per_case,
            without_skill_output_tokens_per_case,
            without_skill_seconds_per_case,
        ));
    }

    if mode != "quick" && contains_module(selected_modules, EVAL_MODULE_AUDITABILITY) {
        steps.push(estimate_step(
            "auditability-check",
            "auditability-check",
            "stage2",
            Some(EVAL_MODULE_AUDITABILITY),
            1,
            repeats,
            0,
            0,
            0,
            1,
        ));
    }

    for step in steps.iter_mut() {
        let total_units = step.case_count.saturating_mul(step.runs).max(1);
        let workers = match step.key.as_str() {
            "trigger-clean" | "trigger-complex" => trigger_max_workers,
            "functional-with-skill" | "functional-without-skill" => functional_max_workers,
            _ => 1,
        };
        step.estimated_seconds =
            scale_seconds_for_workers(step.estimated_seconds, total_units, workers);
    }

    let estimated_input_tokens = steps.iter().fold(0usize, |acc, item| {
        acc.saturating_add(item.estimated_input_tokens)
    });
    let estimated_output_tokens = steps.iter().fold(0usize, |acc, item| {
        acc.saturating_add(item.estimated_output_tokens)
    });
    let estimated_total_tokens = estimated_input_tokens.saturating_add(estimated_output_tokens);
    let repeats_u64 = repeats.max(1) as u64;
    let mut stage0_seconds = 0u64;
    let mut per_repeat_trigger_clean = 0u64;
    let mut per_repeat_parallel_arms: Vec<u64> = Vec::new();
    let mut per_repeat_sequential = 0u64;
    for step in &steps {
        if step.runs <= 1 {
            stage0_seconds = stage0_seconds.saturating_add(step.estimated_seconds);
            continue;
        }
        let per_repeat = ceil_div_u64(step.estimated_seconds, repeats_u64);
        match step.key.as_str() {
            "trigger-clean" => {
                per_repeat_trigger_clean = per_repeat;
            }
            "trigger-complex" | "functional-with-skill" | "functional-without-skill" => {
                per_repeat_parallel_arms.push(per_repeat);
            }
            _ => {
                per_repeat_sequential = per_repeat_sequential.saturating_add(per_repeat);
            }
        }
    }
    let per_repeat_parallel =
        estimate_parallel_chunk_wall_seconds(&per_repeat_parallel_arms, max_parallel_arms);
    let per_repeat_total = per_repeat_trigger_clean
        .saturating_add(per_repeat_sequential)
        .saturating_add(per_repeat_parallel);
    let estimated_seconds = stage0_seconds.saturating_add(per_repeat_total.saturating_mul(repeats_u64));

    EvalPipelineEstimate {
        mode: mode.to_string(),
        model: model.to_string(),
        judge_models: judge_models.to_vec(),
        selected_modules: selected_modules.to_vec(),
        repeats,
        trigger_cases,
        functional_cases,
        taxonomy_pending,
        estimated_input_tokens,
        estimated_output_tokens,
        estimated_total_tokens,
        estimated_seconds,
        estimated_minutes: round4(estimated_seconds as f64 / 60.0),
        cost_estimate,
        steps,
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

fn review_sidecar_path(history_path: &Path) -> PathBuf {
    let mut sidecar = history_path.to_path_buf();
    sidecar.set_extension("review.json");
    sidecar
}

fn sample_generation_sidecar_path(home: &Path) -> PathBuf {
    eval_history_root(home).join("sample-generation-history.sidecar.jsonl")
}

fn append_sample_generation_timing_record(
    home: &Path,
    record: &EvalSampleGenerationTimingEntry,
) -> Result<(), String> {
    let sidecar_path = sample_generation_sidecar_path(home);
    if let Some(parent) = sidecar_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Create sample timing sidecar dir failed: {e}"))?;
    }
    let serialized = serde_json::to_string(record)
        .map_err(|e| format!("Serialize sample timing sidecar failed: {e}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&sidecar_path)
        .map_err(|e| format!("Open sample timing sidecar failed: {e}"))?;
    file.write_all(serialized.as_bytes())
        .map_err(|e| format!("Write sample timing sidecar failed: {e}"))?;
    file.write_all(b"\n")
        .map_err(|e| format!("Write sample timing newline failed: {e}"))?;
    Ok(())
}

fn eval_list_sample_generation_history_impl(
    home: &Path,
    skill_name: Option<String>,
    model: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<EvalSampleGenerationTimingEntry>, String> {
    let sidecar_path = sample_generation_sidecar_path(home);
    if !sidecar_path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&sidecar_path)
        .map_err(|e| format!("Read sample timing sidecar failed: {e}"))?;
    let skill_filter = normalize_optional_text(skill_name);
    let model_filter = normalize_optional_text(model).map(|value| value.to_lowercase());
    let max_items = limit
        .unwrap_or(DEFAULT_SAMPLE_TIMING_HISTORY_LIMIT)
        .clamp(1, MAX_SAMPLE_TIMING_HISTORY_LIMIT);
    let mut items: Vec<EvalSampleGenerationTimingEntry> = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(item) = serde_json::from_str::<EvalSampleGenerationTimingEntry>(trimmed) else {
            continue;
        };
        if let Some(skill) = skill_filter.as_ref() {
            if item.skill_name != *skill {
                continue;
            }
        }
        if let Some(model_key) = model_filter.as_ref() {
            if item.model.to_lowercase() != *model_key {
                continue;
            }
        }
        items.push(item);
    }
    items.reverse();
    items.truncate(max_items);
    Ok(items)
}

fn normalize_final_verdict(value: &str) -> Result<String, String> {
    let normalized = value.trim().to_lowercase().replace('-', "_");
    if normalized.is_empty() {
        return Err("finalVerdict is required.".to_string());
    }
    Ok(normalized)
}

fn read_review_record(history_path: &Path) -> Result<Option<EvalReviewRecord>, String> {
    let sidecar_path = review_sidecar_path(history_path);
    if !sidecar_path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&sidecar_path)
        .map_err(|e| format!("Read review sidecar failed: {e}"))?;
    let parsed = serde_json::from_str::<EvalReviewRecord>(&raw)
        .map_err(|e| format!("Parse review sidecar failed: {e}"))?;
    Ok(Some(parsed))
}

fn write_review_record(history_path: &Path, review: &EvalReviewRecord) -> Result<(), String> {
    let sidecar_path = review_sidecar_path(history_path);
    let raw = serde_json::to_string_pretty(review)
        .map_err(|e| format!("Serialize review sidecar failed: {e}"))?;
    fs::write(sidecar_path, format!("{raw}\n"))
        .map_err(|e| format!("Write review sidecar failed: {e}"))?;
    Ok(())
}

fn build_review_summary(record: &EvalReviewRecord) -> EvalReviewSummary {
    EvalReviewSummary {
        reviewed: true,
        final_verdict: Some(record.final_verdict.clone()),
        override_gate: record.override_gate,
        decided_at_unix: Some(record.decided_at_unix),
        reviewer: record.reviewer.clone(),
    }
}

fn merge_review_into_output(output: &mut EvalPipelineOutput, review: Option<&EvalReviewRecord>) {
    if let Some(record) = review {
        output.review_summary = Some(build_review_summary(record));
        output.final_verdict = Some(record.final_verdict.clone());
        output.override_reason = record.override_reason.clone();
        output.override_at = Some(record.decided_at_unix);
        output.override_by = record.reviewer.clone();
    } else if output.review_summary.is_none() {
        output.review_summary = Some(EvalReviewSummary {
            reviewed: false,
            final_verdict: output.final_verdict.clone(),
            override_gate: false,
            decided_at_unix: None,
            reviewer: None,
        });
    }
}

fn build_comparator_summary(
    with_skill: &FunctionalEvalOutput,
    without_skill: Option<&FunctionalEvalOutput>,
) -> Option<EvalComparatorSummary> {
    let without_skill = without_skill?;
    let with_rows = with_skill.results.as_ref()?;
    let without_rows = without_skill.results.as_ref()?;
    if with_rows.is_empty() || without_rows.is_empty() {
        return None;
    }

    let without_map = without_rows
        .iter()
        .map(|item| (item.case_id.clone(), item.pass_rate))
        .collect::<HashMap<_, _>>();

    let mut deltas: Vec<(String, f64)> = Vec::new();
    let mut improved = 0usize;
    let mut regressed = 0usize;
    let mut unchanged = 0usize;
    for item in with_rows {
        let Some(without_rate) = without_map.get(&item.case_id) else {
            continue;
        };
        let delta = item.pass_rate - without_rate;
        if delta > 0.0001 {
            improved += 1;
        } else if delta < -0.0001 {
            regressed += 1;
        } else {
            unchanged += 1;
        }
        deltas.push((item.case_id.clone(), delta));
    }
    if deltas.is_empty() {
        return None;
    }
    deltas.sort_by(|a, b| {
        b.1.abs()
            .partial_cmp(&a.1.abs())
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let highlights = deltas
        .iter()
        .take(3)
        .map(|(case_id, delta)| format!("{case_id}: delta={:+.4}", delta))
        .collect::<Vec<_>>();
    let avg = mean(&deltas.iter().map(|(_, value)| *value).collect::<Vec<_>>());
    Some(EvalComparatorSummary {
        evaluated_cases: deltas.len(),
        improved_cases: improved,
        regressed_cases: regressed,
        unchanged_cases: unchanged,
        average_delta: round4(avg),
        highlights,
    })
}

fn build_analyzer_summary(
    trigger_clean: &TriggerEvalOutput,
    trigger_complex: Option<&TriggerEvalOutput>,
    functional_with_skill: &FunctionalEvalOutput,
    functional_without_skill: Option<&FunctionalEvalOutput>,
) -> EvalAnalyzerSummary {
    let mut buckets: HashMap<String, usize> = HashMap::new();

    for output in [Some(trigger_clean), trigger_complex].into_iter().flatten() {
        if let Some(rows) = output.results.as_ref() {
            for row in rows {
                if row.pass {
                    continue;
                }
                let key = row
                    .error_type
                    .as_deref()
                    .map(|item| item.trim())
                    .filter(|item| !item.is_empty())
                    .unwrap_or("routing_mismatch");
                *buckets.entry(format!("trigger:{key}")).or_insert(0) += 1;
            }
        }
    }

    for (output, prefix) in [
        (functional_with_skill, "functional_with_skill"),
        (
            functional_without_skill.unwrap_or(functional_with_skill),
            "functional_without_skill",
        ),
    ] {
        if prefix == "functional_without_skill" && functional_without_skill.is_none() {
            continue;
        }
        if let Some(rows) = output.results.as_ref() {
            for row in rows {
                if row.passed {
                    continue;
                }
                let key = row
                    .error_type
                    .as_deref()
                    .map(|item| item.trim())
                    .filter(|item| !item.is_empty())
                    .unwrap_or("assertion_or_quality_failed");
                *buckets.entry(format!("{prefix}:{key}")).or_insert(0) += 1;
            }
        }
    }

    let mut ranked = buckets.into_iter().collect::<Vec<_>>();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let top_failure_patterns = ranked
        .iter()
        .take(5)
        .map(|(name, count)| format!("{name} ({count})"))
        .collect::<Vec<_>>();

    let mut recommendations: Vec<String> = Vec::new();
    for (name, _) in ranked.iter().take(3) {
        if name.contains("network") {
            recommendations.push(
                "Add retry/backoff and timeout observability to reduce network-induced flakiness."
                    .to_string(),
            );
        } else if name.contains("parse") || name.contains("json") {
            recommendations.push(
                "Harden structured-output parsing and add stricter output-format assertions."
                    .to_string(),
            );
        } else if name.contains("routing_mismatch") {
            recommendations.push(
                "Expand trigger boundary and adjacent-skill confusion cases for disambiguation."
                    .to_string(),
            );
        } else {
            recommendations.push(
                "Promote representative failed cases into the next-round regression dataset."
                    .to_string(),
            );
        }
    }
    if recommendations.is_empty() {
        recommendations
            .push("No dominant failure pattern detected; keep monitoring variance.".to_string());
    }
    recommendations.dedup();

    EvalAnalyzerSummary {
        top_failure_patterns,
        recommendations,
        generated_at_unix: now_unix_secs().unwrap_or(0),
    }
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn normalize_string_list(value: Option<Vec<String>>) -> Vec<String> {
    let mut out = value
        .unwrap_or_default()
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    out.sort();
    out.dedup();
    out
}

fn review_record_to_detail(record: &EvalReviewRecord) -> EvalReviewDetail {
    EvalReviewDetail {
        path: record.history_path.clone(),
        final_verdict: record.final_verdict.clone(),
        override_gate: record.override_gate,
        override_reason: record.override_reason.clone(),
        notes: record.notes.clone(),
        reviewer: record.reviewer.clone(),
        tags: record.tags.clone(),
        failed_case_ids: record.failed_case_ids.clone(),
        decided_at_unix: record.decided_at_unix,
    }
}

fn collect_failed_case_ids_from_output(output: &EvalPipelineOutput) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    if let Some(results) = output.functional.results.as_ref() {
        for item in results {
            if !item.passed {
                ids.push(item.case_id.clone());
            }
        }
    }
    if let Some(without_skill) = output.functional_without_skill.as_ref() {
        if let Some(results) = without_skill.results.as_ref() {
            for item in results {
                if !item.passed {
                    ids.push(item.case_id.clone());
                }
            }
        }
    }
    if ids.is_empty() {
        if let Some(rows) = output.trigger_clean.results.as_ref() {
            for row in rows {
                if !row.pass {
                    ids.push(format!("trigger:{}", row.query));
                }
            }
        }
    }
    ids.sort();
    ids.dedup();
    ids
}

fn bucket_for_should_trigger(should_trigger: bool) -> &'static str {
    if should_trigger {
        TRIGGER_BUCKET_POSITIVE
    } else {
        TRIGGER_BUCKET_NEGATIVE
    }
}

fn build_feedback_drafts_from_history(
    output: &EvalPipelineOutput,
    review: Option<&EvalReviewRecord>,
    trigger_count: Option<usize>,
    functional_count: Option<usize>,
) -> Result<EvalSampleDrafts, String> {
    let requested_trigger = trigger_count.unwrap_or(DEFAULT_TRIGGER_CASE_COUNT).max(1);
    let requested_functional = functional_count
        .unwrap_or(DEFAULT_FUNCTIONAL_CASE_COUNT)
        .max(1);

    let mut trigger_rows: Vec<serde_json::Value> = Vec::new();
    for rows in [
        output.trigger_clean.results.as_ref(),
        output
            .trigger_complex
            .as_ref()
            .and_then(|item| item.results.as_ref()),
    ] {
        if let Some(rows) = rows {
            for row in rows {
                if !row.pass {
                    trigger_rows.push(serde_json::json!({
                        "query": row.query.clone(),
                        "should_trigger": row.should_trigger,
                        "test_bucket": bucket_for_should_trigger(row.should_trigger),
                    }));
                }
            }
        }
    }
    while trigger_rows.len() < requested_trigger {
        let idx = trigger_rows.len() + 1;
        let should_trigger = idx % 2 == 1;
        trigger_rows.push(serde_json::json!({
            "query": format!("Regression trigger case {idx}: verify routing boundary and adjacent-skill disambiguation."),
            "should_trigger": should_trigger,
            "test_bucket": bucket_for_should_trigger(should_trigger),
        }));
    }
    trigger_rows.truncate(requested_trigger);

    let mut functional_rows: Vec<serde_json::Value> = Vec::new();
    if let Some(rows) = output.functional.results.as_ref() {
        for row in rows {
            if row.passed {
                continue;
            }
            let suggestions = row.judge_suggestions.clone().unwrap_or_else(|| {
                vec!["Address the failed assertion and keep output deterministic.".to_string()]
            });
            functional_rows.push(serde_json::json!({
                "id": format!("{}-retry", row.case_id),
                "prompt": format!(
                    "Retry and fix functional case {}. Prior failure rationale: {}",
                    row.case_id,
                    row.judge_rationale.clone().unwrap_or_else(|| "missing rationale".to_string()),
                ),
                "assertions": suggestions,
            }));
        }
    }

    if let Some(review) = review {
        for case_id in &review.failed_case_ids {
            if functional_rows.len() >= requested_functional {
                break;
            }
            if case_id.starts_with("trigger:") {
                continue;
            }
            functional_rows.push(serde_json::json!({
                "id": format!("{case_id}-review"),
                "prompt": format!("Regenerate and verify {case_id} according to reviewer feedback."),
                "assertions": [
                    review
                        .override_reason
                        .clone()
                        .unwrap_or_else(|| "Fix failed quality checks from the previous run.".to_string())
                ],
            }));
        }
    }

    while functional_rows.len() < requested_functional {
        let idx = functional_rows.len() + 1;
        functional_rows.push(serde_json::json!({
            "id": format!("feedback-case-{idx:03}"),
            "prompt": format!("Create a regression case #{idx} from previous evaluation failures."),
            "assertions": [
                "Keep response deterministic and concise.",
                "Satisfy all constraints in the prompt.",
            ],
        }));
    }
    functional_rows.truncate(requested_functional);

    Ok(EvalSampleDrafts {
        trigger_count: trigger_rows.len(),
        functional_count: functional_rows.len(),
        trigger_draft: serde_json::to_string_pretty(&trigger_rows)
            .map_err(|e| format!("Serialize trigger feedback draft failed: {e}"))?,
        functional_draft: serde_json::to_string_pretty(&functional_rows)
            .map_err(|e| format!("Serialize functional feedback draft failed: {e}"))?,
    })
}

fn read_evidence_case_text(path: &Path) -> Result<String, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("Read evidence failed: {e}"))?;
    let max_chars = 200_000usize;
    if raw.chars().count() <= max_chars {
        return Ok(raw);
    }
    let prefix = raw.chars().take(max_chars).collect::<String>();
    Ok(format!(
        "{prefix}\n\n...<truncated, original too large for in-app preview>..."
    ))
}

fn find_evidence_case(
    output: &EvalPipelineOutput,
    case_id: &str,
    stage: Option<&str>,
) -> Option<EvalEvidenceCaseResult> {
    let wanted = case_id.trim();
    if wanted.is_empty() {
        return None;
    }
    let stage_filter = stage
        .map(|item| item.trim().to_lowercase())
        .filter(|item| !item.is_empty());

    let stage_allowed = |name: &str| -> bool {
        stage_filter
            .as_ref()
            .is_none_or(|filter| filter == &name.to_lowercase())
    };

    if stage_allowed("trigger_clean") {
        if let Some(rows) = output.trigger_clean.results.as_ref() {
            for row in rows {
                if row.query == wanted {
                    return Some(EvalEvidenceCaseResult {
                        case_id: row.query.clone(),
                        stage: "trigger_clean".to_string(),
                        evidence_path: row.raw_response_path.clone(),
                        content: None,
                    });
                }
            }
        }
    }
    if stage_allowed("trigger_complex") {
        if let Some(trigger_complex) = output.trigger_complex.as_ref() {
            if let Some(rows) = trigger_complex.results.as_ref() {
                for row in rows {
                    if row.query == wanted {
                        return Some(EvalEvidenceCaseResult {
                            case_id: row.query.clone(),
                            stage: "trigger_complex".to_string(),
                            evidence_path: row.raw_response_path.clone(),
                            content: None,
                        });
                    }
                }
            }
        }
    }
    if stage_allowed("functional") {
        if let Some(rows) = output.functional.results.as_ref() {
            for row in rows {
                if row.case_id == wanted {
                    return Some(EvalEvidenceCaseResult {
                        case_id: row.case_id.clone(),
                        stage: "functional".to_string(),
                        evidence_path: row.raw_response_path.clone(),
                        content: None,
                    });
                }
            }
        }
    }
    if stage_allowed("functional_without_skill") {
        if let Some(without_skill) = output.functional_without_skill.as_ref() {
            if let Some(rows) = without_skill.results.as_ref() {
                for row in rows {
                    if row.case_id == wanted {
                        return Some(EvalEvidenceCaseResult {
                            case_id: row.case_id.clone(),
                            stage: "functional_without_skill".to_string(),
                            evidence_path: row.raw_response_path.clone(),
                            content: None,
                        });
                    }
                }
            }
        }
    }
    None
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
    selected_modules: Option<Vec<String>>,
    max_parallel_arms: Option<usize>,
    trigger_max_workers: Option<usize>,
    functional_max_workers: Option<usize>,
) -> Result<EvalPipelineOutput, String> {
    let home = crate::root_dir::default_home_dir();
    let mode = normalize_eval_mode(&mode)?.to_string();
    let primary_model = normalize_model(&model);
    let judge_models = normalize_judge_models(&primary_model, &mode, judge_models);
    let selected_modules = normalize_selected_modules(&mode, selected_modules);
    let repeats = repeats.unwrap_or(DEFAULT_PIPELINE_REPEATS).max(1);
    let max_parallel_arms = normalize_max_parallel_arms(max_parallel_arms);
    let trigger_max_workers =
        normalize_eval_workers(trigger_max_workers, DEFAULT_TRIGGER_MAX_WORKERS);
    let functional_max_workers =
        normalize_eval_workers(functional_max_workers, DEFAULT_FUNCTIONAL_MAX_WORKERS);
    let temp = temperature.unwrap_or(0.0);
    let taxonomy_result =
        ensure_skill_taxonomy(&skill_name, &skill_path, &primary_model, Some(&control));
    match select_eval_strategy_by_sok(taxonomy_result.taxonomy.as_ref()) {
        EvalStrategy::Default => {}
    }
    let run_trigger_complex = should_run_trigger_complex(&mode, &selected_modules);
    let run_functional_with_skill = should_run_functional_with_skill(&mode, &selected_modules);
    let run_functional_without_skill =
        should_run_functional_without_skill(&mode, &selected_modules);
    let mut total_steps_per_repeat = 1usize;
    if run_trigger_complex {
        total_steps_per_repeat += 1;
    }
    if run_functional_with_skill {
        total_steps_per_repeat += 1;
    }
    if run_functional_without_skill {
        total_steps_per_repeat += 1;
    }
    let total_steps = total_steps_per_repeat * repeats;

    let trigger_cases = parse_json_file_case_count(&trigger_eval_set_path)?;
    let functional_cases =
        if mode == "quick" || (!run_functional_with_skill && !run_functional_without_skill) {
            0
        } else {
            parse_json_file_case_count(&functional_eval_set_path)?
        };
    if functional_cases > 0 {
        ensure_functional_case_floor(functional_cases)?;
    }
    let trigger_runs_per_repeat = 1 + usize::from(run_trigger_complex);
    let functional_runs_per_repeat =
        usize::from(run_functional_with_skill) + usize::from(run_functional_without_skill);
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

    let evidence_root = eval_pipeline_evidence_dir(&home, &skill_name, &run_id);
    fs::create_dir_all(&evidence_root)
        .map_err(|e| format!("Create eval evidence dir failed: {e}"))?;
    let quick_checks =
        run_stage0_quick_checks(&skill_path, &trigger_eval_set_path, &taxonomy_result);

    let start = std::time::Instant::now();
    let mut executed_steps = 0usize;
    push_pipeline_progress_with_i18n(
        &app_handle,
        &run_id,
        "running",
        0,
        repeats,
        0,
        total_steps,
        "pipeline",
        "Evaluation pipeline started.",
        Some("eval.progress.pipelineStarted"),
        None,
        start.elapsed().as_millis(),
    );
    if !quick_checks.all_passed {
        let failed_names = quick_checks
            .checks
            .iter()
            .filter(|item| !item.passed && item.blocking)
            .map(|item| item.key.clone())
            .collect::<Vec<_>>();
        let blocked_message = format!(
            "Quick checks failed; pipeline blocked. Failed checks: {}",
            failed_names.join(", ")
        );
        push_pipeline_progress(
            &app_handle,
            &run_id,
            "completed",
            0,
            repeats,
            0,
            total_steps,
            "quick_checks",
            &blocked_message,
            start.elapsed().as_millis(),
        );
        let trigger_metrics = EvalTriggerMetrics {
            precision: 0.0,
            recall: 0.0,
            fpr: 0.0,
            true_positive: 0,
            true_negative: 0,
            false_positive: 0,
            false_negative: 0,
        };
        let functional_placeholder =
            skipped_functional_output(&skill_name, "Pipeline blocked by Stage0 quick checks.");
        let evidence_summary = summarize_evidence(
            &TriggerEvalOutput {
                status: "skipped".to_string(),
                skill_name: Some(skill_name.clone()),
                summary: Some(TriggerEvalSummary {
                    total: 0,
                    passed: 0,
                    failed: 0,
                    pass_rate: 0.0,
                }),
                results: Some(Vec::new()),
                message: Some("Blocked by Stage0 quick checks.".to_string()),
            },
            None,
            &functional_placeholder,
            None,
        );
        let economics = compute_economics(None, None);
        let module_results = build_module_results(
            &mode,
            &selected_modules,
            &quick_checks,
            &trigger_metrics,
            None,
            0.0,
            &economics,
            &evidence_summary,
        );
        let gate = build_eval_gate(&mode, &quick_checks, &selected_modules, &module_results);
        let mut blocked_output = EvalPipelineOutput {
            status: "success".to_string(),
            mode: mode.clone(),
            summary: EvalPipelineSummary {
                total_cases: 0,
                total_passed: 0,
                total_failed: 0,
                pass_rate: 0.0,
            },
            quick_checks: Some(quick_checks),
            trigger_clean: TriggerEvalOutput {
                status: "skipped".to_string(),
                skill_name: Some(skill_name.clone()),
                summary: Some(TriggerEvalSummary {
                    total: 0,
                    passed: 0,
                    failed: 0,
                    pass_rate: 0.0,
                }),
                results: Some(Vec::new()),
                message: Some("Blocked by Stage0 quick checks.".to_string()),
            },
            trigger_complex: None,
            functional: functional_placeholder,
            functional_without_skill: None,
            module_results: Some(module_results),
            gate: Some(gate),
            economics: Some(economics),
            dimension_scores: EvalDimensionScores {
                trigger_accuracy: 0.0,
                functional_correctness: 0.0,
                robustness: 0.0,
                efficiency: 0.0,
                value_added: 0.0,
            },
            trigger_metrics,
            cost_estimate: estimated,
            delta_vs_no_skill: None,
            repeat_stats: EvalRepeatStats {
                overall_pass_rate: EvalRateStats {
                    mean: 0.0,
                    median: 0.0,
                    std_dev: 0.0,
                },
                trigger_pass_rate: EvalRateStats {
                    mean: 0.0,
                    median: 0.0,
                    std_dev: 0.0,
                },
                functional_pass_rate: None,
                robustness: EvalRateStats {
                    mean: 0.0,
                    median: 0.0,
                    std_dev: 0.0,
                },
                value_added: None,
            },
            run_meta: EvalRunMeta {
                mode: mode.clone(),
                model: primary_model.clone(),
                judge_models: judge_models.clone(),
                repeats,
                max_parallel_arms,
                trigger_max_workers,
                functional_max_workers,
                seed,
                temperature: temp,
                executed_steps: 0,
                elapsed_ms: start.elapsed().as_millis(),
                skill_hash: compute_skill_hash(&skill_path),
            },
            evidence_level: Some("real".to_string()),
            advisory: Some(EvalAdvisory {
                level: "high_risk".to_string(),
                reasons: vec![blocked_message.clone()],
                non_blocking: false,
            }),
            evidence_summary: Some(evidence_summary),
            review_summary: Some(EvalReviewSummary {
                reviewed: false,
                final_verdict: Some("blocked".to_string()),
                override_gate: false,
                decided_at_unix: None,
                reviewer: None,
            }),
            final_verdict: Some("blocked".to_string()),
            override_reason: None,
            override_at: None,
            override_by: None,
            comparator: None,
            analyzer: None,
            taxonomy_status: Some(taxonomy_result.status.clone()),
            taxonomy_message: Some(taxonomy_result.message.clone()),
            taxonomy_applied: Some(taxonomy_result.applied),
            history_path: None,
            message: Some(blocked_message),
        };
        blocked_output.history_path =
            persist_pipeline_history(&home, &skill_name, &blocked_output)?;
        return Ok(blocked_output);
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
        push_pipeline_progress_with_i18n(
            &app_handle,
            &run_id,
            "running",
            current_repeat,
            repeats,
            next_step,
            total_steps,
            "trigger_clean",
            &format!("Round {current_repeat}/{repeats}: running trigger eval (clean)."),
            None,
            None,
            start.elapsed().as_millis(),
        );
        let trigger_clean = run_trigger_eval_impl(
            skill_name.clone(),
            Some(skill_path.clone()),
            trigger_eval_set_path.clone(),
            "clean".to_string(),
            installed_skills_dir.clone(),
            primary_model.clone(),
            Some(trigger_max_workers),
            Some(
                evidence_root
                    .join(format!("repeat-{current_repeat:02}"))
                    .join("trigger-clean"),
            ),
            Some(&control),
            false,
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

        if mode == "quick" {
            robustness_rates.push(clean_summary.pass_rate);
            last_functional = Some(skipped_functional_output(
                &skill_name,
                "Skipped in quick mode (Stage0 + Stage1 only).",
            ));
            last_functional_without_skill = None;
            let repeat_total = repeat_trigger_total;
            let repeat_passed = repeat_trigger_passed;
            overall_pass_rates.push(if repeat_total > 0 {
                repeat_passed as f64 / repeat_total as f64
            } else {
                0.0
            });
        } else {
            #[derive(Clone)]
            enum RepeatArm {
                TriggerComplex,
                FunctionalWithSkill,
                FunctionalWithoutSkill,
            }

            #[derive(Clone)]
            struct ScheduledArm {
                step_index: usize,
                arm: RepeatArm,
            }

            enum ArmOutput {
                TriggerComplex(TriggerEvalOutput),
                FunctionalWithSkill(FunctionalEvalOutput),
                FunctionalWithoutSkill(FunctionalEvalOutput),
            }

            let arm_step_name = |arm: &RepeatArm| -> &'static str {
                match arm {
                    RepeatArm::TriggerComplex => "trigger_complex",
                    RepeatArm::FunctionalWithSkill => "functional_with_skill",
                    RepeatArm::FunctionalWithoutSkill => "functional_without_skill",
                }
            };
            let arm_start_message = |arm: &RepeatArm| -> String {
                match arm {
                    RepeatArm::TriggerComplex => {
                        format!("Round {current_repeat}/{repeats}: running trigger eval (complex).")
                    }
                    RepeatArm::FunctionalWithSkill => format!(
                        "Round {current_repeat}/{repeats}: running functional eval (with skill)."
                    ),
                    RepeatArm::FunctionalWithoutSkill => format!(
                        "Round {current_repeat}/{repeats}: running functional eval (without skill)."
                    ),
                }
            };
            let arm_failure_message = |arm: &RepeatArm, err: &str| -> String {
                match arm {
                    RepeatArm::TriggerComplex => {
                        format!("Round {current_repeat}/{repeats}: trigger complex failed: {err}")
                    }
                    RepeatArm::FunctionalWithSkill => format!(
                        "Round {current_repeat}/{repeats}: functional(with skill) failed: {err}"
                    ),
                    RepeatArm::FunctionalWithoutSkill => format!(
                        "Round {current_repeat}/{repeats}: functional(without skill) failed: {err}"
                    ),
                }
            };

            let mut scheduled_arms: Vec<ScheduledArm> = Vec::new();
            let mut next_step = executed_steps;
            if run_trigger_complex {
                next_step += 1;
                scheduled_arms.push(ScheduledArm {
                    step_index: next_step,
                    arm: RepeatArm::TriggerComplex,
                });
            }
            if run_functional_with_skill {
                next_step += 1;
                scheduled_arms.push(ScheduledArm {
                    step_index: next_step,
                    arm: RepeatArm::FunctionalWithSkill,
                });
            } else {
                last_functional = Some(skipped_functional_output(
                    &skill_name,
                    "Skipped because selected modules do not require functional(with skill).",
                ));
            }
            if run_functional_without_skill {
                next_step += 1;
                scheduled_arms.push(ScheduledArm {
                    step_index: next_step,
                    arm: RepeatArm::FunctionalWithoutSkill,
                });
            } else {
                last_functional_without_skill = None;
            }

            let mut offset = 0usize;
            while offset < scheduled_arms.len() {
                let chunk_end = (offset + max_parallel_arms).min(scheduled_arms.len());
                let chunk = scheduled_arms[offset..chunk_end].to_vec();
                let mut handles = Vec::with_capacity(chunk.len());

                for item in &chunk {
                    let step_name = arm_step_name(&item.arm);
                    wait_if_paused_or_cancelled(
                        &control,
                        &app_handle,
                        &run_id,
                        current_repeat,
                        repeats,
                        item.step_index,
                        total_steps,
                        step_name,
                        start.elapsed().as_millis(),
                    )?;
                    push_pipeline_progress(
                        &app_handle,
                        &run_id,
                        "running",
                        current_repeat,
                        repeats,
                        item.step_index,
                        total_steps,
                        step_name,
                        &arm_start_message(&item.arm),
                        start.elapsed().as_millis(),
                    );

                    let item_cloned = item.clone();
                    let run_control = control.clone();
                    let skill_name_cloned = skill_name.clone();
                    let skill_path_cloned = skill_path.clone();
                    let trigger_set_cloned = trigger_eval_set_path.clone();
                    let functional_set_cloned = functional_eval_set_path.clone();
                    let installed_skills_dir_cloned = installed_skills_dir.clone();
                    let model_cloned = primary_model.clone();
                    let judge_models_cloned = judge_models.clone();
                    let evidence_dir = evidence_root.join(format!("repeat-{current_repeat:02}"));
                    let functional_compare_mode =
                        functional_compare_mode_for_mode(&mode).to_string();
                    handles.push((
                        item_cloned.clone(),
                        std::thread::spawn(move || -> Result<ArmOutput, String> {
                            match item_cloned.arm {
                                RepeatArm::TriggerComplex => run_trigger_eval_impl(
                                    skill_name_cloned,
                                    Some(skill_path_cloned),
                                    trigger_set_cloned,
                                    "complex".to_string(),
                                    installed_skills_dir_cloned,
                                    model_cloned,
                                    Some(trigger_max_workers),
                                    Some(evidence_dir.join("trigger-complex")),
                                    Some(&run_control),
                                    false,
                                )
                                .map(ArmOutput::TriggerComplex),
                                RepeatArm::FunctionalWithSkill => run_functional_eval_impl(
                                    skill_name_cloned,
                                    skill_path_cloned,
                                    functional_set_cloned,
                                    functional_compare_mode,
                                    model_cloned,
                                    Some(judge_models_cloned),
                                    Some(functional_max_workers),
                                    Some(evidence_dir.join("functional-with-skill")),
                                    Some(&run_control),
                                    false,
                                )
                                .map(ArmOutput::FunctionalWithSkill),
                                RepeatArm::FunctionalWithoutSkill => run_functional_eval_impl(
                                    skill_name_cloned,
                                    skill_path_cloned,
                                    functional_set_cloned,
                                    "without_skill".to_string(),
                                    model_cloned,
                                    Some(judge_models_cloned),
                                    Some(functional_max_workers),
                                    Some(evidence_dir.join("functional-without-skill")),
                                    Some(&run_control),
                                    false,
                                )
                                .map(ArmOutput::FunctionalWithoutSkill),
                            }
                        }),
                    ));
                }

                for (item, handle) in handles {
                    let result = handle
                        .join()
                        .map_err(|_| format!("Eval arm '{}' panicked", arm_step_name(&item.arm)))?;
                    let output = result.map_err(|err| {
                        push_pipeline_progress(
                            &app_handle,
                            &run_id,
                            status_for_error(&err),
                            current_repeat,
                            repeats,
                            item.step_index,
                            total_steps,
                            arm_step_name(&item.arm),
                            &arm_failure_message(&item.arm, &err),
                            start.elapsed().as_millis(),
                        );
                        err
                    })?;
                    executed_steps += 1;
                    match output {
                        ArmOutput::TriggerComplex(trigger_complex) => {
                            if let Some(rows) = trigger_complex.results.clone() {
                                trigger_rows_for_metrics.extend(rows);
                            }
                            let summary = safe_trigger_summary(&trigger_complex);
                            repeat_trigger_total += summary.total;
                            repeat_trigger_passed += summary.passed;
                            robustness_rates.push(summary.pass_rate);
                            last_trigger_complex = Some(trigger_complex);
                        }
                        ArmOutput::FunctionalWithSkill(functional) => {
                            last_functional = Some(functional);
                        }
                        ArmOutput::FunctionalWithoutSkill(functional_without_skill) => {
                            last_functional_without_skill = Some(functional_without_skill);
                        }
                    }
                }
                offset = chunk_end;
            }

            if !run_trigger_complex {
                robustness_rates.push(clean_summary.pass_rate);
            }

            let functional = last_functional.clone().unwrap_or_else(|| {
                skipped_functional_output(
                    &skill_name,
                    "Skipped because selected modules do not require functional(with skill).",
                )
            });
            let functional_summary = safe_functional_summary(&functional);
            if run_functional_with_skill {
                functional_pass_rates.push(functional_summary.pass_rate);
            }
            last_functional = Some(functional);

            if run_functional_without_skill {
                if let Some(without_skill) = last_functional_without_skill.as_ref() {
                    let without_summary = safe_functional_summary(without_skill);
                    without_skill_pass_rates.push(without_summary.pass_rate);
                    value_added_rates
                        .push(functional_summary.pass_rate - without_summary.pass_rate);
                }
            }

            let repeat_total = repeat_trigger_total + functional_summary.total;
            let repeat_passed = repeat_trigger_passed + functional_summary.passed;
            overall_pass_rates.push(if repeat_total > 0 {
                repeat_passed as f64 / repeat_total as f64
            } else {
                0.0
            });
        }

        push_pipeline_progress_with_i18n(
            &app_handle,
            &run_id,
            "running",
            current_repeat,
            repeats,
            executed_steps,
            total_steps,
            "repeat_complete",
            &format!("Round {current_repeat}/{repeats} completed."),
            Some("eval.progress.repeatCompleted"),
            Some(serde_json::json!({
                "current": current_repeat,
                "total": repeats,
            })),
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
    let comparator = build_comparator_summary(&functional, functional_without_skill.as_ref());
    let analyzer = build_analyzer_summary(
        &trigger_clean,
        trigger_complex.as_ref(),
        &functional,
        functional_without_skill.as_ref(),
    );
    let advisory = build_eval_advisory(
        &mode,
        &trigger_metrics,
        delta_vs_no_skill
            .as_ref()
            .map(|item| item.functional_pass_rate_delta),
    );
    let evidence_summary = summarize_evidence(
        &trigger_clean,
        trigger_complex.as_ref(),
        &functional,
        functional_without_skill.as_ref(),
    );
    let economics = compute_economics(Some(&functional), functional_without_skill.as_ref());

    let robustness = robustness_stats.mean;
    let efficiency =
        (1.0 - (estimated.actual_usd_estimate / (estimated.actual_usd_estimate + 0.01))).max(0.0);
    let value_added = value_added_stats.as_ref().map_or(0.0, |item| item.mean);
    let module_results = build_module_results(
        &mode,
        &selected_modules,
        &quick_checks,
        &trigger_metrics,
        functional_stats.as_ref(),
        robustness,
        &economics,
        &evidence_summary,
    );
    let gate = build_eval_gate(&mode, &quick_checks, &selected_modules, &module_results);
    let gate_message = if mode == "quick" {
        None
    } else if gate.full_release_pass == Some(true) {
        Some("Selected modules passed release gate.".to_string())
    } else {
        Some(format!(
            "Release gate failed for selected modules: {}",
            gate.failed_modules.join(", ")
        ))
    };
    let default_final_verdict = if mode == "quick" {
        if quick_checks.all_passed {
            "pass".to_string()
        } else {
            "fail".to_string()
        }
    } else if gate.full_release_pass == Some(true) {
        "pass".to_string()
    } else {
        "fail".to_string()
    };

    let mut output = EvalPipelineOutput {
        status: "success".to_string(),
        mode: mode.clone(),
        summary: EvalPipelineSummary {
            total_cases,
            total_passed,
            total_failed,
            pass_rate: overall_stats.mean,
        },
        quick_checks: Some(quick_checks),
        trigger_clean,
        trigger_complex,
        functional,
        functional_without_skill,
        module_results: Some(module_results),
        gate: Some(gate),
        economics: Some(economics),
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
            max_parallel_arms,
            trigger_max_workers,
            functional_max_workers,
            seed,
            temperature: temp,
            executed_steps,
            elapsed_ms: start.elapsed().as_millis(),
            skill_hash: compute_skill_hash(&skill_path),
        },
        evidence_level: Some("real".to_string()),
        advisory: Some(advisory),
        evidence_summary: Some(evidence_summary),
        review_summary: Some(EvalReviewSummary {
            reviewed: false,
            final_verdict: Some(default_final_verdict.clone()),
            override_gate: false,
            decided_at_unix: None,
            reviewer: None,
        }),
        final_verdict: Some(default_final_verdict),
        override_reason: None,
        override_at: None,
        override_by: None,
        comparator,
        analyzer: Some(analyzer),
        taxonomy_status: Some(taxonomy_result.status.clone()),
        taxonomy_message: Some(taxonomy_result.message.clone()),
        taxonomy_applied: Some(taxonomy_result.applied),
        history_path: None,
        message: gate_message,
    };

    output.history_path = persist_pipeline_history(&home, &skill_name, &output)?;
    push_pipeline_progress_with_i18n(
        &app_handle,
        &run_id,
        "completed",
        repeats,
        repeats,
        total_steps,
        total_steps,
        "pipeline",
        "Evaluation pipeline completed.",
        Some("eval.progress.pipelineCompleted"),
        None,
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

fn timeout_secs_for_estimated_runtime(estimated_seconds: u64) -> u64 {
    let safe_estimated = estimated_seconds.max(1);
    let scaled = safe_estimated
        .saturating_mul(EVAL_TIMEOUT_ESTIMATE_SCALE_NUM)
        .saturating_add(EVAL_TIMEOUT_ESTIMATE_SCALE_DEN.saturating_sub(1))
        / EVAL_TIMEOUT_ESTIMATE_SCALE_DEN;
    let computed = scaled.saturating_add(EVAL_TIMEOUT_ESTIMATE_BUFFER_SECS);
    computed.clamp(EVAL_TIMEOUT_SECS, MAX_EVAL_TIMEOUT_SECS)
}

fn timeout_secs_for_case_count(case_count: usize) -> u64 {
    let safe_cases = case_count.max(1) as u64;
    let estimated = safe_cases.saturating_mul(EVAL_TIMEOUT_PER_CASE_SECS);
    timeout_secs_for_estimated_runtime(estimated)
}

fn sample_generation_request_timeout_secs(trigger_count: usize, functional_count: usize) -> u64 {
    let total_cases = trigger_count.saturating_add(functional_count).max(1) as u64;
    let computed = SAMPLE_GENERATION_REQUEST_TIMEOUT_BASE_SECS.saturating_add(
        total_cases.saturating_mul(SAMPLE_GENERATION_REQUEST_TIMEOUT_PER_CASE_SECS),
    );
    computed.clamp(
        SAMPLE_GENERATION_REQUEST_TIMEOUT_MIN_SECS,
        SAMPLE_GENERATION_REQUEST_TIMEOUT_MAX_SECS,
    )
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
        .max(DEFAULT_FUNCTIONAL_CASE_COUNT);
    let request_timeout_secs =
        sample_generation_request_timeout_secs(trigger_count, functional_count);
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
        "--request-timeout-secs".to_string(),
        request_timeout_secs.to_string(),
        "--output-dir".to_string(),
        path_to_utf8(&output_dir)?,
    ];

    if let Some(base_url) = config.base_url.as_ref() {
        cmd_args.push("--base-url".to_string());
        cmd_args.push(base_url.clone());
    }

    let timeout_secs = timeout_secs_for_case_count(trigger_count.saturating_add(functional_count));
    let output = run_eval_engine(&cmd_args, None, timeout_secs, true)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = fs::remove_dir_all(&output_dir);
        return Err(format!(
            "Python sample generation failed: {}",
            stderr.trim()
        ));
    }

    let result = (|| -> Result<EvalSampleDrafts, String> {
        let trigger_draft = fs::read_to_string(&trigger_path)
            .map_err(|e| format!("Read trigger sample draft failed: {e}"))?;
        let functional_draft = fs::read_to_string(&functional_path)
            .map_err(|e| format!("Read functional sample draft failed: {e}"))?;

        let trigger_case_count = parse_json_case_count(&trigger_draft)?;
        let functional_case_count = parse_json_case_count(&functional_draft)?;

        Ok(EvalSampleDrafts {
            trigger_draft,
            functional_draft,
            trigger_count: trigger_case_count,
            functional_count: functional_case_count,
        })
    })();
    let _ = fs::remove_dir_all(&output_dir);
    result
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
        review_summary: output.review_summary,
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
        let Ok(mut output) = serde_json::from_str::<EvalPipelineOutput>(&raw) else {
            continue;
        };
        let review = read_review_record(&path).ok().flatten();
        merge_review_into_output(&mut output, review.as_ref());
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
    let mut output = serde_json::from_str::<EvalPipelineOutput>(&raw)
        .map_err(|e| format!("Parse eval history failed: {e}"))?;
    let review = read_review_record(&path)?;
    merge_review_into_output(&mut output, review.as_ref());
    Ok(output)
}

fn eval_get_review_impl(path: PathBuf) -> Result<Option<EvalReviewDetail>, String> {
    let review = read_review_record(&path)?;
    Ok(review.as_ref().map(review_record_to_detail))
}

fn eval_submit_review_impl(
    path: PathBuf,
    final_verdict: String,
    override_gate: Option<bool>,
    override_reason: Option<String>,
    notes: Option<String>,
    reviewer: Option<String>,
    tags: Option<Vec<String>>,
    failed_case_ids: Option<Vec<String>>,
) -> Result<EvalSubmitReviewResult, String> {
    if !path.exists() {
        return Err("History file not found.".to_string());
    }
    let normalized_verdict = normalize_final_verdict(&final_verdict)?;
    let override_gate = override_gate.unwrap_or(false);
    let override_reason = normalize_optional_text(override_reason);
    if override_gate && override_reason.is_none() {
        return Err("overrideReason is required when overrideGate is true.".to_string());
    }

    let mut output = load_eval_history_impl(path.clone())?;
    let history_path = path_to_utf8(&path)?;
    let decided_at = now_unix_secs()?;
    let failed_case_ids = {
        let provided = normalize_string_list(failed_case_ids);
        if provided.is_empty() {
            collect_failed_case_ids_from_output(&output)
        } else {
            provided
        }
    };
    let review = EvalReviewRecord {
        history_path: history_path.clone(),
        final_verdict: normalized_verdict.clone(),
        override_gate,
        override_reason: override_reason.clone(),
        notes: normalize_optional_text(notes),
        reviewer: normalize_optional_text(reviewer),
        tags: normalize_string_list(tags),
        failed_case_ids,
        decided_at_unix: decided_at,
    };
    write_review_record(&path, &review)?;
    merge_review_into_output(&mut output, Some(&review));

    Ok(EvalSubmitReviewResult {
        success: true,
        review: review_record_to_detail(&review),
        review_summary: output.review_summary.unwrap_or(EvalReviewSummary {
            reviewed: true,
            final_verdict: Some(normalized_verdict.clone()),
            override_gate,
            decided_at_unix: Some(decided_at),
            reviewer: review.reviewer.clone(),
        }),
        final_verdict: normalized_verdict,
        override_reason,
        override_by: review.reviewer.clone(),
        override_at: Some(decided_at),
    })
}

fn eval_list_review_queue_impl(
    home: &Path,
    skill_name: String,
    limit: Option<usize>,
) -> Result<Vec<EvalReviewQueueItem>, String> {
    let max_items = limit.unwrap_or(DEFAULT_REVIEW_QUEUE_LIMIT).max(1);
    let history = list_eval_history_impl(home, skill_name, Some(max_items))?;
    let mut queue: Vec<EvalReviewQueueItem> = Vec::new();
    for item in history {
        let path = PathBuf::from(&item.path);
        let output = load_eval_history_impl(path).ok();
        let gate_pass = output.as_ref().and_then(|report| {
            report.gate.as_ref().and_then(|gate| {
                if report.mode == "quick" {
                    Some(gate.quick_blocking_pass)
                } else {
                    gate.full_release_pass
                }
            })
        });
        let review_summary = output
            .as_ref()
            .and_then(|report| report.review_summary.clone())
            .or(item.review_summary.clone())
            .unwrap_or(EvalReviewSummary {
                reviewed: false,
                final_verdict: None,
                override_gate: false,
                decided_at_unix: None,
                reviewer: None,
            });

        queue.push(EvalReviewQueueItem {
            path: item.path,
            file_name: item.file_name,
            saved_at_unix: item.saved_at_unix,
            pass_rate: item.pass_rate,
            total_cases: item.total_cases,
            model: item.model,
            gate_pass,
            reviewed: review_summary.reviewed,
            final_verdict: review_summary.final_verdict,
            decided_at_unix: review_summary.decided_at_unix,
        });
    }
    Ok(queue)
}

fn eval_generate_feedback_drafts_impl(
    path: PathBuf,
    trigger_count: Option<usize>,
    functional_count: Option<usize>,
) -> Result<EvalSampleDrafts, String> {
    let output = load_eval_history_impl(path.clone())?;
    let review = read_review_record(&path)?;
    build_feedback_drafts_from_history(&output, review.as_ref(), trigger_count, functional_count)
}

fn eval_read_evidence_case_impl(
    path: PathBuf,
    case_id: String,
    stage: Option<String>,
) -> Result<EvalEvidenceCaseResult, String> {
    let output = load_eval_history_impl(path)?;
    let mut found = find_evidence_case(&output, &case_id, stage.as_deref())
        .ok_or_else(|| format!("No evidence entry found for case '{case_id}'."))?;
    if let Some(evidence_path) = found.evidence_path.clone() {
        let evidence_path_buf = PathBuf::from(&evidence_path);
        if evidence_path_buf.exists() {
            found.content = Some(read_evidence_case_text(&evidence_path_buf)?);
        }
    }
    Ok(found)
}

fn dataset_file_matches_kind(path: &Path, kind: &str) -> bool {
    let Some(file_name) = path.file_name().and_then(|item| item.to_str()) else {
        return false;
    };
    let normalized_name = file_name.to_lowercase();
    match kind {
        "trigger" => normalized_name.contains("trigger"),
        "functional" => normalized_name.contains("functional"),
        _ => false,
    }
}

fn find_latest_dataset_for_kind(dataset_dir: &Path, kind: &str) -> Option<PathBuf> {
    if !dataset_dir.exists() {
        return None;
    }
    let mut best: Option<(SystemTime, PathBuf)> = None;
    let entries = fs::read_dir(dataset_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let is_json = path
            .extension()
            .and_then(|item| item.to_str())
            .map(|item| item.eq_ignore_ascii_case("json"))
            .unwrap_or(false);
        if !is_json || !dataset_file_matches_kind(&path, kind) {
            continue;
        }
        let modified = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .unwrap_or(UNIX_EPOCH);
        match &best {
            Some((current, _)) if modified <= *current => {}
            _ => {
                best = Some((modified, path));
            }
        }
    }
    best.map(|(_, path)| path)
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
    let latest_trigger_path = find_latest_dataset_for_kind(&dataset_dir, "trigger")
        .and_then(|path| path_to_utf8(&path).ok());
    let latest_functional_path = find_latest_dataset_for_kind(&dataset_dir, "functional")
        .and_then(|path| path_to_utf8(&path).ok());
    Ok(EvalStoragePaths {
        dataset_dir: path_to_utf8(&dataset_dir)?,
        history_dir: path_to_utf8(&history_dir)?,
        latest_trigger_path,
        latest_functional_path,
    })
}

#[tauri::command]
pub fn eval_list_sample_generation_history(
    skill_name: Option<String>,
    model: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<EvalSampleGenerationTimingEntry>, String> {
    eval_list_sample_generation_history_impl(
        &crate::root_dir::default_home_dir(),
        skill_name,
        model,
        limit,
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn eval_estimate_pipeline(
    _skill_name: String,
    skill_path: PathBuf,
    trigger_eval_set_path: PathBuf,
    functional_eval_set_path: PathBuf,
    mode: String,
    model: String,
    judge_models: Option<Vec<String>>,
    repeats: Option<usize>,
    max_cost_usd: Option<f64>,
    selected_modules: Option<Vec<String>>,
    max_parallel_arms: Option<usize>,
    trigger_max_workers: Option<usize>,
    functional_max_workers: Option<usize>,
) -> Result<EvalPipelineEstimate, String> {
    let mode = normalize_eval_mode(&mode)?.to_string();
    let primary_model = normalize_model(&model);
    let judge_models = normalize_judge_models(&primary_model, &mode, judge_models);
    let selected_modules = normalize_selected_modules(&mode, selected_modules);
    let repeats = repeats.unwrap_or(DEFAULT_PIPELINE_REPEATS).max(1);
    let max_parallel_arms = normalize_max_parallel_arms(max_parallel_arms);
    let trigger_max_workers =
        normalize_eval_workers(trigger_max_workers, DEFAULT_TRIGGER_MAX_WORKERS);
    let functional_max_workers =
        normalize_eval_workers(functional_max_workers, DEFAULT_FUNCTIONAL_MAX_WORKERS);
    let trigger_cases = parse_json_file_case_count(&trigger_eval_set_path)
        .map_err(|err| format!("Invalid trigger eval dataset: {err}"))?;
    let needs_functional = should_run_functional_with_skill(&mode, &selected_modules)
        || should_run_functional_without_skill(&mode, &selected_modules);
    let functional_cases = if mode == "quick" || !needs_functional {
        0
    } else {
        parse_json_file_case_count(&functional_eval_set_path)
            .map_err(|err| format!("Invalid functional eval dataset: {err}"))?
    };
    if functional_cases > 0 {
        ensure_functional_case_floor(functional_cases)?;
    }
    Ok(estimate_pipeline_plan(
        &skill_path,
        &mode,
        &primary_model,
        &judge_models,
        &selected_modules,
        repeats,
        trigger_cases,
        functional_cases,
        max_cost_usd,
        max_parallel_arms,
        trigger_max_workers,
        functional_max_workers,
    ))
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
pub fn eval_get_review(path: PathBuf) -> Result<Option<EvalReviewDetail>, String> {
    eval_get_review_impl(path)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn eval_submit_review(
    path: PathBuf,
    final_verdict: String,
    override_gate: Option<bool>,
    override_reason: Option<String>,
    notes: Option<String>,
    reviewer: Option<String>,
    tags: Option<Vec<String>>,
    failed_case_ids: Option<Vec<String>>,
) -> Result<EvalSubmitReviewResult, String> {
    eval_submit_review_impl(
        path,
        final_verdict,
        override_gate,
        override_reason,
        notes,
        reviewer,
        tags,
        failed_case_ids,
    )
}

#[tauri::command]
pub fn eval_list_review_queue(
    skill_name: String,
    limit: Option<usize>,
) -> Result<Vec<EvalReviewQueueItem>, String> {
    eval_list_review_queue_impl(&crate::root_dir::default_home_dir(), skill_name, limit)
}

#[tauri::command]
pub fn eval_generate_feedback_drafts(
    path: PathBuf,
    trigger_count: Option<usize>,
    functional_count: Option<usize>,
) -> Result<EvalSampleDrafts, String> {
    eval_generate_feedback_drafts_impl(path, trigger_count, functional_count)
}

#[tauri::command]
pub fn eval_read_evidence_case(
    path: PathBuf,
    case_id: String,
    stage: Option<String>,
) -> Result<EvalEvidenceCaseResult, String> {
    eval_read_evidence_case_impl(path, case_id, stage)
}

#[tauri::command]
pub fn eval_save_config(
    api_key: String,
    provider: Option<String>,
    base_url: Option<String>,
    sample_model: Option<String>,
    run_model: Option<String>,
    default_model: Option<String>,
    cost_currency: Option<String>,
) -> Result<EvalMutationResult, String> {
    let normalized_sample_model = normalize_model(
        sample_model
            .as_deref()
            .or(default_model.as_deref())
            .or(run_model.as_deref())
            .unwrap_or(DEFAULT_MODEL),
    );
    let normalized_run_model = normalize_model(
        run_model
            .as_deref()
            .or(default_model.as_deref())
            .or(sample_model.as_deref())
            .unwrap_or(DEFAULT_MODEL),
    );
    let config = EvalConfig {
        api_key: api_key.trim().to_string(),
        provider: normalize_provider(provider.as_deref().unwrap_or(DEFAULT_PROVIDER)),
        base_url: normalize_base_url(base_url),
        sample_model: normalized_sample_model,
        run_model: normalized_run_model.clone(),
        default_model: normalized_run_model,
        cost_currency: normalize_cost_currency(
            cost_currency.as_deref().unwrap_or(DEFAULT_COST_CURRENCY),
        ),
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
    let eval_case_count = read_eval_set_case_count(&eval_set_path).unwrap_or(DEFAULT_TRIGGER_CASE_COUNT);
    let estimated_seconds =
        (eval_case_count.max(1) as u64).saturating_mul(ESTIMATE_TRIGGER_SECONDS_PER_CALL);
    let timeout_secs = timeout_secs_for_estimated_runtime(estimated_seconds);
    run_eval_blocking("run_trigger_eval", timeout_secs, move || {
        run_trigger_eval_impl(
            skill_name,
            None,
            eval_set_path,
            env_type,
            installed_skills_dir,
            model,
            None,
            None,
            None,
            true,
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
    let eval_case_count = read_eval_set_case_count(&eval_set_path).unwrap_or(DEFAULT_FUNCTIONAL_CASE_COUNT);
    let functional_seconds_per_case = if compare_mode.trim().eq_ignore_ascii_case("without_skill") {
        ESTIMATE_FUNCTIONAL_BASELINE_SECONDS_PER_CALL + ESTIMATE_JUDGE_SECONDS_PER_CALL
    } else {
        ESTIMATE_FUNCTIONAL_EXEC_SECONDS_PER_CALL
            + ESTIMATE_FUNCTIONAL_BASELINE_SECONDS_PER_CALL
            + ESTIMATE_JUDGE_SECONDS_PER_CALL
    };
    let estimated_seconds =
        (eval_case_count.max(1) as u64).saturating_mul(functional_seconds_per_case);
    let timeout_secs = timeout_secs_for_estimated_runtime(estimated_seconds);
    run_eval_blocking("run_functional_eval", timeout_secs, move || {
        run_functional_eval_impl(
            skill_name,
            skill_path,
            eval_set_path,
            compare_mode,
            model,
            None,
            None,
            None,
            None,
            true,
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
    selected_modules: Option<Vec<String>>,
    max_parallel_arms: Option<usize>,
    trigger_max_workers: Option<usize>,
    functional_max_workers: Option<usize>,
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
    let primary_model_for_timeout = normalize_model(&model);
    let judge_models_for_timeout =
        normalize_judge_models(&primary_model_for_timeout, mode_for_timeout, judge_models.clone());
    let selected_modules_for_timeout =
        normalize_selected_modules(mode_for_timeout, selected_modules.clone());
    let max_parallel_arms_for_timeout = normalize_max_parallel_arms(max_parallel_arms);
    let trigger_max_workers_for_timeout =
        normalize_eval_workers(trigger_max_workers, DEFAULT_TRIGGER_MAX_WORKERS);
    let functional_max_workers_for_timeout =
        normalize_eval_workers(functional_max_workers, DEFAULT_FUNCTIONAL_MAX_WORKERS);
    let run_functional_with_for_timeout =
        should_run_functional_with_skill(mode_for_timeout, &selected_modules_for_timeout);
    let run_functional_without_for_timeout =
        should_run_functional_without_skill(mode_for_timeout, &selected_modules_for_timeout);
    let trigger_case_count =
        read_eval_set_case_count(&trigger_eval_set_path).unwrap_or(DEFAULT_TRIGGER_CASE_COUNT);
    let functional_case_count = if run_functional_with_for_timeout
        || run_functional_without_for_timeout
    {
        read_eval_set_case_count(&functional_eval_set_path).unwrap_or(DEFAULT_FUNCTIONAL_CASE_COUNT)
    } else {
        0
    };
    let timeout_plan = estimate_pipeline_plan(
        &skill_path,
        mode_for_timeout,
        &primary_model_for_timeout,
        &judge_models_for_timeout,
        &selected_modules_for_timeout,
        expected_repeats,
        trigger_case_count,
        functional_case_count,
        max_cost_usd,
        max_parallel_arms_for_timeout,
        trigger_max_workers_for_timeout,
        functional_max_workers_for_timeout,
    );
    let timeout_secs = timeout_secs_for_estimated_runtime(timeout_plan.estimated_seconds);
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
            selected_modules,
            max_parallel_arms,
            trigger_max_workers,
            functional_max_workers,
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
    let skill_name_for_record = skill_name.trim().to_string();
    let model_for_record = normalize_model(&model);
    let started = std::time::Instant::now();
    let drafts = run_eval_blocking("eval_generate_samples", timeout_secs, move || {
        eval_generate_samples_impl(
            skill_name,
            skill_path,
            model,
            trigger_count,
            functional_count,
        )
    })
    .await?;
    let elapsed_seconds = started.elapsed().as_secs().max(1);
    let record = EvalSampleGenerationTimingEntry {
        recorded_at_unix: now_unix_secs().unwrap_or(0),
        skill_name: skill_name_for_record,
        model: model_for_record,
        trigger_count: drafts.trigger_count,
        functional_count: drafts.functional_count,
        elapsed_seconds,
    };
    append_sample_generation_timing_record(&crate::root_dir::default_home_dir(), &record)?;
    Ok(drafts)
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
            quick_checks: Some(EvalQuickChecks {
                all_passed: true,
                checks: vec![],
                bucket_coverage: Some(EvalTriggerBucketCoverage {
                    min_required_per_bucket: TRIGGER_BUCKET_MIN_SAMPLES,
                    positive_trigger: 12,
                    negative_trigger: 12,
                    boundary_ambiguous: 12,
                    adjacent_skill_confusion: 12,
                    all_buckets_met: true,
                    failed_buckets: vec![],
                }),
            }),
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
            module_results: Some(vec![]),
            gate: Some(EvalGate {
                quick_blocking_pass: true,
                full_release_pass: Some(true),
                partial_release: Some(false),
                selected_modules: EVAL_ALL_MODULE_KEYS
                    .iter()
                    .map(|item| (*item).to_string())
                    .collect::<Vec<_>>(),
                failed_modules: vec![],
            }),
            economics: Some(EvalEconomics {
                gross_time_saved_ms: 120.0,
                gross_token_saved: 60.0,
                negative_time_waste_ms: 10.0,
                negative_token_waste: 5.0,
                net_time_saved_ms: 110.0,
                net_token_saved: 55.0,
                net_usd: Some(0.0001),
                baseline_samples: 6,
                evaluated_pairs: 6,
            }),
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
                estimated_usd_min: Some(0.008),
                estimated_usd_max: Some(0.012),
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
                max_parallel_arms: DEFAULT_MAX_PARALLEL_ARMS,
                trigger_max_workers: DEFAULT_TRIGGER_MAX_WORKERS,
                functional_max_workers: DEFAULT_FUNCTIONAL_MAX_WORKERS,
                seed: Some(1),
                temperature: 0.0,
                executed_steps: 3,
                elapsed_ms: 1234,
                skill_hash: Some("abc".to_string()),
            },
            evidence_level: Some("real".to_string()),
            advisory: Some(EvalAdvisory {
                level: "pass".to_string(),
                reasons: vec!["all good".to_string()],
                non_blocking: true,
            }),
            evidence_summary: Some(EvalEvidenceSummary {
                total_runs: 10,
                captured_transcripts: 10,
                captured_timing: 10,
                captured_tokens: 10,
            }),
            review_summary: Some(EvalReviewSummary {
                reviewed: false,
                final_verdict: None,
                override_gate: false,
                decided_at_unix: None,
                reviewer: None,
            }),
            final_verdict: None,
            override_reason: None,
            override_at: None,
            override_by: None,
            comparator: None,
            analyzer: None,
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

        assert_eq!(normalized.sok_group, "Natural-language 脳 Single-tool");
        assert_eq!(normalized.skillsbench_difficulty_core, "Core");
        assert_eq!(normalized.skillsbench_difficulty_level, "Easy");
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
            YamlValue::String("Natural-language 脳 Single-tool".to_string()),
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
        assert_eq!(config.sample_model, DEFAULT_MODEL);
        assert_eq!(config.run_model, DEFAULT_MODEL);
        assert_eq!(config.default_model, DEFAULT_MODEL);
        assert_eq!(config.cost_currency, DEFAULT_COST_CURRENCY);
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
            sample_model: " gpt-4.1-mini ".to_string(),
            run_model: " gpt-4.1 ".to_string(),
            default_model: " gpt-4.1 ".to_string(),
            cost_currency: " cny ".to_string(),
        };
        write_eval_config_with_home(&home, &config).expect("write eval config");
        let loaded = read_eval_config_with_home(&home).expect("read eval config");
        assert_eq!(loaded.api_key, "key-value");
        assert_eq!(loaded.provider, "openai-compatible");
        assert_eq!(
            loaded.base_url.as_deref(),
            Some("https://api.openai.com/v1")
        );
        assert_eq!(loaded.sample_model, "gpt-4.1-mini");
        assert_eq!(loaded.run_model, "gpt-4.1");
        assert_eq!(loaded.default_model, "gpt-4.1");
        assert_eq!(loaded.cost_currency, "CNY");
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
    fn sample_generation_sidecar_roundtrip_supports_filter_and_limit() {
        let home = temp_root("myskills-tauri-evals-test");
        append_sample_generation_timing_record(
            &home,
            &EvalSampleGenerationTimingEntry {
                recorded_at_unix: 10,
                skill_name: "skill-a".to_string(),
                model: "gpt-4o-mini".to_string(),
                trigger_count: 48,
                functional_count: 24,
                elapsed_seconds: 120,
            },
        )
        .expect("append first");
        append_sample_generation_timing_record(
            &home,
            &EvalSampleGenerationTimingEntry {
                recorded_at_unix: 20,
                skill_name: "skill-a".to_string(),
                model: "gpt-4.1-mini".to_string(),
                trigger_count: 48,
                functional_count: 24,
                elapsed_seconds: 180,
            },
        )
        .expect("append second");
        append_sample_generation_timing_record(
            &home,
            &EvalSampleGenerationTimingEntry {
                recorded_at_unix: 30,
                skill_name: "skill-b".to_string(),
                model: "gpt-4o-mini".to_string(),
                trigger_count: 48,
                functional_count: 24,
                elapsed_seconds: 90,
            },
        )
        .expect("append third");

        let skill_filtered = eval_list_sample_generation_history_impl(
            &home,
            Some("skill-a".to_string()),
            None,
            Some(10),
        )
        .expect("list by skill");
        assert_eq!(skill_filtered.len(), 2);
        assert_eq!(skill_filtered[0].recorded_at_unix, 20);

        let model_filtered = eval_list_sample_generation_history_impl(
            &home,
            Some("skill-a".to_string()),
            Some("gpt-4o-mini".to_string()),
            Some(10),
        )
        .expect("list by model");
        assert_eq!(model_filtered.len(), 1);
        assert_eq!(model_filtered[0].elapsed_seconds, 120);

        let limited =
            eval_list_sample_generation_history_impl(&home, None, None, Some(2)).expect("limit");
        assert_eq!(limited.len(), 2);
        assert_eq!(limited[0].recorded_at_unix, 30);
        assert_eq!(limited[1].recorded_at_unix, 20);
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
                raw_response_path: None,
                latency_ms: None,
                input_tokens: None,
                output_tokens: None,
                judge_trace_id: None,
                error_type: None,
            },
            TriggerEvalResultItem {
                query: "n1".to_string(),
                should_trigger: false,
                triggered: true,
                triggered_skill_name: Some("other".to_string()),
                pass: false,
                error: None,
                raw_response_path: None,
                latency_ms: None,
                input_tokens: None,
                output_tokens: None,
                judge_trace_id: None,
                error_type: None,
            },
            TriggerEvalResultItem {
                query: "n2".to_string(),
                should_trigger: false,
                triggered: false,
                triggered_skill_name: None,
                pass: true,
                error: None,
                raw_response_path: None,
                latency_ms: None,
                input_tokens: None,
                output_tokens: None,
                judge_trace_id: None,
                error_type: None,
            },
            TriggerEvalResultItem {
                query: "p2".to_string(),
                should_trigger: true,
                triggered: false,
                triggered_skill_name: None,
                pass: false,
                error: None,
                raw_response_path: None,
                latency_ms: None,
                input_tokens: None,
                output_tokens: None,
                judge_trace_id: None,
                error_type: None,
            },
        ];
        let metrics = compute_trigger_metrics(&rows);
        assert_eq!(metrics.true_positive, 1);
        assert_eq!(metrics.false_positive, 1);
        assert_eq!(metrics.true_negative, 1);
        assert_eq!(metrics.false_negative, 1);
    }

    #[test]
    fn build_eval_advisory_classifies_pass_warn_and_high_risk() {
        let pass_metrics = EvalTriggerMetrics {
            precision: 0.82,
            recall: 0.78,
            fpr: 0.1,
            true_positive: 10,
            true_negative: 10,
            false_positive: 2,
            false_negative: 3,
        };
        let pass = build_eval_advisory("standard", &pass_metrics, Some(0.02));
        assert_eq!(pass.level, "pass");
        assert!(pass.non_blocking);

        let warn = build_eval_advisory("standard", &pass_metrics, Some(-0.01));
        assert_eq!(warn.level, "warn");
        assert!(warn.non_blocking);

        let high_risk_metrics = EvalTriggerMetrics {
            precision: 0.58,
            recall: 0.78,
            ..pass_metrics
        };
        let high_risk = build_eval_advisory("standard", &high_risk_metrics, Some(-0.10));
        assert_eq!(high_risk.level, "high_risk");
        assert!(high_risk.non_blocking);
    }

    #[test]
    fn parse_trigger_bucket_coverage_enforces_bucket_minimum() {
        let home = temp_root("myskills-tauri-evals-test");
        fs::create_dir_all(&home).expect("create temp root");
        let path = home.join("trigger-bucket.json");
        let mut rows = Vec::<serde_json::Value>::new();
        for i in 0..12 {
            rows.push(serde_json::json!({
                "query": format!("positive-{i}"),
                "should_trigger": true,
                "test_bucket": "positive_trigger"
            }));
            rows.push(serde_json::json!({
                "query": format!("negative-{i}"),
                "should_trigger": false,
                "test_bucket": "negative_trigger"
            }));
            rows.push(serde_json::json!({
                "query": format!("boundary-{i}"),
                "should_trigger": i % 2 == 0,
                "test_bucket": "boundary_ambiguous"
            }));
            rows.push(serde_json::json!({
                "query": format!("adjacent-{i}"),
                "should_trigger": i % 2 == 1,
                "test_bucket": "adjacent_skill_confusion"
            }));
        }
        fs::write(
            &path,
            format!(
                "{}\n",
                serde_json::to_string_pretty(&rows).expect("serialize rows")
            ),
        )
        .expect("write trigger buckets");
        let coverage = parse_trigger_bucket_coverage(&path).expect("bucket coverage");
        assert!(coverage.all_buckets_met);
        assert_eq!(coverage.positive_trigger, 12);
        assert_eq!(coverage.failed_buckets.len(), 0);
    }

    #[test]
    fn stage0_quick_checks_skip_agent_yaml_checks_for_non_agent_skill() {
        let home = temp_root("myskills-tauri-evals-test");
        fs::create_dir_all(&home).expect("create temp root");
        let skill_dir = home.join("non-agent-skill");
        fs::create_dir_all(&skill_dir).expect("create skill dir");
        let skill_path = skill_dir.join("SKILL.md");
        fs::write(
            &skill_path,
            r#"---
name: non-agent-skill
description: A non-agent skill used for testing quick check shape routing.
---

# Non-agent
"#,
        )
        .expect("write skill");

        let trigger_path = home.join("trigger-bucket.json");
        let mut rows = Vec::<serde_json::Value>::new();
        for i in 0..12 {
            rows.push(serde_json::json!({
                "query": format!("positive-{i}"),
                "should_trigger": true,
                "test_bucket": "positive_trigger"
            }));
            rows.push(serde_json::json!({
                "query": format!("negative-{i}"),
                "should_trigger": false,
                "test_bucket": "negative_trigger"
            }));
            rows.push(serde_json::json!({
                "query": format!("boundary-{i}"),
                "should_trigger": i % 2 == 0,
                "test_bucket": "boundary_ambiguous"
            }));
            rows.push(serde_json::json!({
                "query": format!("adjacent-{i}"),
                "should_trigger": i % 2 == 1,
                "test_bucket": "adjacent_skill_confusion"
            }));
        }
        fs::write(
            &trigger_path,
            format!(
                "{}\n",
                serde_json::to_string_pretty(&rows).expect("serialize rows")
            ),
        )
        .expect("write trigger buckets");

        let taxonomy = normalize_taxonomy(SkillTaxonomyClassification {
            sok_representation: "Natural-language".to_string(),
            sok_scope: "Single-tool".to_string(),
            sok_group: "Natural-language × Single-tool".to_string(),
            anthropic_category: "MCP Enhancement".to_string(),
            skillsbench_domain: "Software Engineering".to_string(),
            skillsbench_difficulty_core: "Core".to_string(),
            skillsbench_difficulty_level: "Easy".to_string(),
            classified_at: "2026-03-12T00:00:00Z".to_string(),
            classifier_model: "gpt-4o-mini".to_string(),
        })
        .expect("normalize taxonomy");
        let taxonomy_result = EnsureSkillTaxonomyResult {
            status: "skipped".to_string(),
            message: "taxonomy already present".to_string(),
            applied: false,
            taxonomy: Some(taxonomy),
        };

        let quick_checks = run_stage0_quick_checks(&skill_path, &trigger_path, &taxonomy_result);
        let generation = quick_checks
            .checks
            .iter()
            .find(|item| item.key == "generation-guardrail")
            .expect("generation check");
        let ui = quick_checks
            .checks
            .iter()
            .find(|item| item.key == "ui-metadata-consistency")
            .expect("ui check");

        assert!(quick_checks.all_passed);
        assert!(generation.passed);
        assert!(ui.passed);
        assert!(generation.message.contains("Skipped"));
        assert!(ui.message.contains("Skipped"));
    }

    #[test]
    fn stage0_quick_checks_require_openai_yaml_for_agent_shape() {
        let home = temp_root("myskills-tauri-evals-test");
        fs::create_dir_all(&home).expect("create temp root");
        let skill_dir = home.join("agent-shape-skill");
        fs::create_dir_all(skill_dir.join("agents")).expect("create agents dir");
        let skill_path = skill_dir.join("SKILL.md");
        fs::write(
            &skill_path,
            r#"---
name: agent-shape-skill
description: A skill that declares agent shape but misses openai metadata.
---

# Agent shape without openai.yaml
"#,
        )
        .expect("write skill");

        let trigger_path = home.join("trigger-bucket-agent.json");
        let mut rows = Vec::<serde_json::Value>::new();
        for i in 0..12 {
            rows.push(serde_json::json!({
                "query": format!("positive-{i}"),
                "should_trigger": true,
                "test_bucket": "positive_trigger"
            }));
            rows.push(serde_json::json!({
                "query": format!("negative-{i}"),
                "should_trigger": false,
                "test_bucket": "negative_trigger"
            }));
            rows.push(serde_json::json!({
                "query": format!("boundary-{i}"),
                "should_trigger": i % 2 == 0,
                "test_bucket": "boundary_ambiguous"
            }));
            rows.push(serde_json::json!({
                "query": format!("adjacent-{i}"),
                "should_trigger": i % 2 == 1,
                "test_bucket": "adjacent_skill_confusion"
            }));
        }
        fs::write(
            &trigger_path,
            format!(
                "{}\n",
                serde_json::to_string_pretty(&rows).expect("serialize rows")
            ),
        )
        .expect("write trigger buckets");

        let taxonomy = normalize_taxonomy(SkillTaxonomyClassification {
            sok_representation: "Natural-language".to_string(),
            sok_scope: "Single-tool".to_string(),
            sok_group: "Natural-language 脳 Single-tool".to_string(),
            anthropic_category: "MCP Enhancement".to_string(),
            skillsbench_domain: "Software Engineering".to_string(),
            skillsbench_difficulty_core: "Core".to_string(),
            skillsbench_difficulty_level: "Easy".to_string(),
            classified_at: "2026-03-12T00:00:00Z".to_string(),
            classifier_model: "gpt-4o-mini".to_string(),
        })
        .expect("normalize taxonomy");
        let taxonomy_result = EnsureSkillTaxonomyResult {
            status: "skipped".to_string(),
            message: "taxonomy already present".to_string(),
            applied: false,
            taxonomy: Some(taxonomy),
        };

        let quick_checks = run_stage0_quick_checks(&skill_path, &trigger_path, &taxonomy_result);
        let generation = quick_checks
            .checks
            .iter()
            .find(|item| item.key == "generation-guardrail")
            .expect("generation check");
        let ui = quick_checks
            .checks
            .iter()
            .find(|item| item.key == "ui-metadata-consistency")
            .expect("ui check");

        assert!(!quick_checks.all_passed);
        assert!(!generation.passed);
        assert!(!ui.passed);
        assert!(generation.message.contains("Missing agents/openai.yaml"));
        assert!(ui.message.contains("Missing agents/openai.yaml"));
    }

    #[test]
    fn sample_generation_request_timeout_has_floor_and_cap() {
        let normal = sample_generation_request_timeout_secs(48, 24);
        assert!(normal >= 180);
        assert!(normal <= 900);

        let huge = sample_generation_request_timeout_secs(2_000, 2_000);
        assert_eq!(huge, 900);
    }

    #[test]
    fn compute_economics_counts_negative_when_with_skill_fails() {
        let with_skill = FunctionalEvalOutput {
            status: "success".to_string(),
            skill_name: Some("demo".to_string()),
            summary: Some(FunctionalEvalSummary {
                total: 2,
                passed: 1,
                failed: 1,
                pass_rate: 0.5,
            }),
            dimension_scores: None,
            results: Some(vec![
                FunctionalEvalResultItem {
                    case_id: "case-1".to_string(),
                    passed: true,
                    pass_rate: 1.0,
                    error: None,
                    layer1_pass: Some(true),
                    quality_score: None,
                    dimension_scores: None,
                    judge_rationale: None,
                    judge_suggestions: None,
                    judge_source: None,
                    raw_response_path: None,
                    latency_ms: Some(80),
                    input_tokens: Some(20),
                    output_tokens: Some(10),
                    judge_trace_id: None,
                    error_type: None,
                },
                FunctionalEvalResultItem {
                    case_id: "case-2".to_string(),
                    passed: false,
                    pass_rate: 0.0,
                    error: Some("failed".to_string()),
                    layer1_pass: Some(false),
                    quality_score: None,
                    dimension_scores: None,
                    judge_rationale: None,
                    judge_suggestions: None,
                    judge_source: None,
                    raw_response_path: None,
                    latency_ms: Some(120),
                    input_tokens: Some(30),
                    output_tokens: Some(20),
                    judge_trace_id: None,
                    error_type: None,
                },
            ]),
            message: None,
        };
        let without_skill = FunctionalEvalOutput {
            status: "success".to_string(),
            skill_name: Some("demo".to_string()),
            summary: Some(FunctionalEvalSummary {
                total: 2,
                passed: 2,
                failed: 0,
                pass_rate: 1.0,
            }),
            dimension_scores: None,
            results: Some(vec![
                FunctionalEvalResultItem {
                    case_id: "case-1".to_string(),
                    passed: true,
                    pass_rate: 1.0,
                    error: None,
                    layer1_pass: Some(true),
                    quality_score: None,
                    dimension_scores: None,
                    judge_rationale: None,
                    judge_suggestions: None,
                    judge_source: None,
                    raw_response_path: None,
                    latency_ms: Some(100),
                    input_tokens: Some(40),
                    output_tokens: Some(20),
                    judge_trace_id: None,
                    error_type: None,
                },
                FunctionalEvalResultItem {
                    case_id: "case-2".to_string(),
                    passed: true,
                    pass_rate: 1.0,
                    error: None,
                    layer1_pass: Some(true),
                    quality_score: None,
                    dimension_scores: None,
                    judge_rationale: None,
                    judge_suggestions: None,
                    judge_source: None,
                    raw_response_path: None,
                    latency_ms: Some(90),
                    input_tokens: Some(25),
                    output_tokens: Some(15),
                    judge_trace_id: None,
                    error_type: None,
                },
            ]),
            message: None,
        };
        let economics = compute_economics(Some(&with_skill), Some(&without_skill));
        assert!(economics.gross_time_saved_ms > 0.0);
        assert!(economics.negative_time_waste_ms > 0.0);
        assert!(economics.net_time_saved_ms < economics.gross_time_saved_ms);
        assert_eq!(economics.baseline_samples, 2);
        assert_eq!(economics.evaluated_pairs, 2);
    }

    #[test]
    fn build_eval_gate_uses_selected_modules_only() {
        let quick_checks = EvalQuickChecks {
            all_passed: true,
            checks: vec![],
            bucket_coverage: None,
        };
        let selected_modules = vec![EVAL_MODULE_TRIGGER_ACCURACY.to_string()];
        let module_results = vec![
            EvalModuleResult {
                key: EVAL_MODULE_TRIGGER_ACCURACY.to_string(),
                title: "Trigger Accuracy".to_string(),
                selected: true,
                status: "fail".to_string(),
                passed: Some(false),
                score: Some(0.5),
                message: None,
            },
            EvalModuleResult {
                key: EVAL_MODULE_ECONOMICS.to_string(),
                title: "Economics".to_string(),
                selected: false,
                status: "skipped".to_string(),
                passed: None,
                score: None,
                message: None,
            },
        ];
        let gate = build_eval_gate(
            "standard",
            &quick_checks,
            &selected_modules,
            &module_results,
        );
        assert_eq!(gate.quick_blocking_pass, true);
        assert_eq!(gate.full_release_pass, Some(false));
        assert_eq!(
            gate.failed_modules,
            vec![EVAL_MODULE_TRIGGER_ACCURACY.to_string()]
        );
        assert_eq!(gate.partial_release, Some(true));
    }

    #[test]
    fn summarize_evidence_counts_paths_timing_and_tokens() {
        let trigger_clean = TriggerEvalOutput {
            status: "success".to_string(),
            skill_name: Some("demo".to_string()),
            summary: Some(TriggerEvalSummary {
                total: 1,
                passed: 1,
                failed: 0,
                pass_rate: 1.0,
            }),
            results: Some(vec![TriggerEvalResultItem {
                query: "q1".to_string(),
                should_trigger: true,
                triggered: true,
                triggered_skill_name: Some("demo".to_string()),
                pass: true,
                error: None,
                raw_response_path: Some("/tmp/trigger.json".to_string()),
                latency_ms: Some(120),
                input_tokens: Some(16),
                output_tokens: Some(8),
                judge_trace_id: Some("trace-1".to_string()),
                error_type: None,
            }]),
            message: None,
        };
        let functional = FunctionalEvalOutput {
            status: "success".to_string(),
            skill_name: Some("demo".to_string()),
            summary: Some(FunctionalEvalSummary {
                total: 1,
                passed: 1,
                failed: 0,
                pass_rate: 1.0,
            }),
            dimension_scores: None,
            results: Some(vec![FunctionalEvalResultItem {
                case_id: "case-1".to_string(),
                passed: true,
                pass_rate: 1.0,
                error: None,
                layer1_pass: Some(true),
                quality_score: Some(0.9),
                dimension_scores: None,
                judge_rationale: None,
                judge_suggestions: None,
                judge_source: Some("llm".to_string()),
                raw_response_path: Some("/tmp/functional.json".to_string()),
                latency_ms: Some(200),
                input_tokens: Some(32),
                output_tokens: Some(24),
                judge_trace_id: Some("trace-2".to_string()),
                error_type: None,
            }]),
            message: None,
        };

        let summary = summarize_evidence(&trigger_clean, None, &functional, None);
        assert_eq!(summary.total_runs, 2);
        assert_eq!(summary.captured_transcripts, 2);
        assert_eq!(summary.captured_timing, 2);
        assert_eq!(summary.captured_tokens, 2);
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

    #[test]
    fn progress_event_serializes_message_key_and_args() {
        let event = EvalPipelineProgressEvent {
            run_id: "run-1".to_string(),
            status: "running".to_string(),
            current_repeat: 1,
            total_repeats: 2,
            step_index: 1,
            total_steps: 4,
            step_name: "pipeline".to_string(),
            message: "Evaluation pipeline started.".to_string(),
            message_key: Some("eval.progress.pipelineStarted".to_string()),
            message_args: Some(serde_json::json!({ "current": 1, "total": 2 })),
            elapsed_ms: 123,
        };
        let serialized = serde_json::to_value(event).expect("serialize progress event");
        assert_eq!(
            serialized
                .get("messageKey")
                .and_then(|value| value.as_str())
                .unwrap_or_default(),
            "eval.progress.pipelineStarted"
        );
        assert_eq!(
            serialized
                .get("messageArgs")
                .and_then(|value| value.get("current"))
                .and_then(|value| value.as_i64())
                .unwrap_or_default(),
            1
        );
    }

    #[test]
    fn progress_event_omits_message_key_fields_when_absent() {
        let event = EvalPipelineProgressEvent {
            run_id: "run-2".to_string(),
            status: "running".to_string(),
            current_repeat: 1,
            total_repeats: 1,
            step_index: 1,
            total_steps: 1,
            step_name: "pipeline".to_string(),
            message: "ok".to_string(),
            message_key: None,
            message_args: None,
            elapsed_ms: 1,
        };
        let serialized = serde_json::to_value(event).expect("serialize progress event");
        assert!(serialized.get("messageKey").is_none());
        assert!(serialized.get("messageArgs").is_none());
    }
}

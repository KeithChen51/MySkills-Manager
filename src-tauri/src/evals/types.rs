use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// Constants needed by type defaults
pub(crate) const DEFAULT_PROVIDER: &str = "openai-compatible";
pub(crate) const DEFAULT_MODEL: &str = "gpt-4o-mini";
pub(crate) const DEFAULT_COST_CURRENCY: &str = "USD";
pub(crate) const DEFAULT_MAX_PARALLEL_ARMS: usize = 2;
pub(crate) const DEFAULT_TRIGGER_MAX_WORKERS: usize = 6;
pub(crate) const DEFAULT_FUNCTIONAL_MAX_WORKERS: usize = 3;

fn default_max_parallel_arms() -> usize { DEFAULT_MAX_PARALLEL_ARMS }
fn default_trigger_max_workers() -> usize { DEFAULT_TRIGGER_MAX_WORKERS }
fn default_functional_max_workers() -> usize { DEFAULT_FUNCTIONAL_MAX_WORKERS }

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
pub struct ModelGroup {
    pub id: String,
    pub name: String,
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub is_gateway: bool,
    #[serde(default)]
    pub models: Vec<String>,
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
    pub judge_model: String,
    pub cost_currency: String,
    #[serde(default)]
    pub model_groups: Vec<ModelGroup>,
}

#[derive(Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawEvalConfig {
    pub(crate) api_key: Option<String>,
    pub(crate) provider: Option<String>,
    pub(crate) base_url: Option<String>,
    pub(crate) sample_model: Option<String>,
    pub(crate) run_model: Option<String>,
    pub(crate) default_model: Option<String>,
    pub(crate) judge_model: Option<String>,
    pub(crate) cost_currency: Option<String>,
    #[serde(default)]
    pub(crate) model_groups: Vec<ModelGroup>,
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
            judge_model: String::new(),
            cost_currency: DEFAULT_COST_CURRENCY.to_string(),
            model_groups: Vec::new(),
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub improvement_suggestions: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description_feedback: Option<String>,
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
/// Per-case real-time status for the v6.0 case grid view.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CaseStatus {
    pub case_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens: Option<u64>,
}

/// Five-dimensional Scorecard for the v6.0 unified result view.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalScorecard {
    pub dimensions: Vec<EvalScorecardDimension>,
    pub overall_score: f64,
    pub overall_rating: u8,
    pub radar_data: Vec<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence_warning: Option<String>,
}

/// A single dimension in the five-dimensional scorecard.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalScorecardDimension {
    pub key: String,
    pub label: String,
    pub score: f64,
    pub weight: f64,
}


use chrono::{DateTime, Utc};
use serde::Serialize;
use std::cmp::{Ordering, Reverse};
use std::collections::{BTreeMap, BinaryHeap, HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use std::time::UNIX_EPOCH;

use crate::log_parse::parse_ts_utc;
use crate::logs::LogEntry;
use crate::skills::list_skills;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NamedCount {
    pub name: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DayCount {
    pub date: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct StatsResult {
    pub total_invocations: usize,
    pub by_skill: Vec<NamedCount>,
    pub by_tool: Vec<NamedCount>,
    pub by_day: Vec<DayCount>,
    pub recent: Vec<LogEntry>,
    pub unused_skills: Vec<String>,
    pub reliability_mode: String,
    pub reliability_note: String,
}

#[derive(Debug, Clone)]
struct StatsCacheEntry {
    key: String,
    result: StatsResult,
}

static STATS_CACHE: OnceLock<Mutex<Option<StatsCacheEntry>>> = OnceLock::new();

fn compare_logs_desc(a: &LogEntry, b: &LogEntry) -> Ordering {
    match (parse_ts_utc(&a.ts), parse_ts_utc(&b.ts)) {
        (Some(a_ts), Some(b_ts)) => b_ts.cmp(&a_ts),
        _ => b.ts.cmp(&a.ts),
    }
}

fn compare_logs_asc(a: &LogEntry, b: &LogEntry) -> Ordering {
    compare_logs_desc(b, a)
}

fn collect_unused_skills(
    root: &Path,
    used_skills: &HashSet<String>,
) -> Result<Vec<String>, String> {
    let mut all_skills = list_skills(root)?
        .into_iter()
        .map(|skill| skill.name)
        .collect::<Vec<_>>();
    all_skills.sort();
    all_skills.dedup();
    Ok(all_skills
        .into_iter()
        .filter(|name| !used_skills.contains(name))
        .collect::<Vec<_>>())
}

fn metadata_signature(path: &Path) -> String {
    let Ok(meta) = fs::metadata(path) else {
        return "missing".to_string();
    };
    let modified = meta
        .modified()
        .ok()
        .and_then(|timestamp| timestamp.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{}:{modified}", meta.len())
}

fn stats_cache_key(root: &Path, days: u32) -> String {
    let log_signature = metadata_signature(&root.join(".logs").join("skill-usage.jsonl"));
    let root_signature = metadata_signature(root);
    format!(
        "{}|{days}|{log_signature}|{root_signature}",
        root.to_string_lossy()
    )
}

fn cached_stats_result(cache_key: &str) -> Option<StatsResult> {
    let cache = STATS_CACHE.get_or_init(|| Mutex::new(None));
    let guard = cache.lock().ok()?;
    let entry = guard.as_ref()?;
    if entry.key == cache_key {
        return Some(entry.result.clone());
    }
    None
}

fn store_stats_cache(cache_key: String, result: StatsResult) {
    let cache = STATS_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(mut guard) = cache.lock() {
        *guard = Some(StatsCacheEntry {
            key: cache_key,
            result,
        });
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RankedRecent(LogEntry);

impl Ord for RankedRecent {
    fn cmp(&self, other: &Self) -> Ordering {
        compare_logs_asc(&self.0, &other.0)
    }
}

impl PartialOrd for RankedRecent {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub fn compute_stats_with_now(
    root: &Path,
    days: u32,
    now: DateTime<Utc>,
) -> Result<StatsResult, String> {
    let days = if days == 0 { 30 } else { days };
    let cache_key = stats_cache_key(root, days);
    if let Some(cached) = cached_stats_result(&cache_key) {
        return Ok(cached);
    }

    if let Ok(indexed) = crate::log_index::query_stats_index(root, days, now) {
        let by_skill = indexed
            .by_skill
            .into_iter()
            .map(|(name, count)| NamedCount { name, count })
            .collect::<Vec<_>>();
        let by_tool = indexed
            .by_tool
            .into_iter()
            .map(|(name, count)| NamedCount { name, count })
            .collect::<Vec<_>>();
        let by_day = indexed
            .by_day
            .into_iter()
            .map(|(date, count)| DayCount { date, count })
            .collect::<Vec<_>>();
        let used_skills = by_skill
            .iter()
            .map(|item| item.name.clone())
            .collect::<HashSet<_>>();
        let unused_skills = collect_unused_skills(root, &used_skills)?;

        let result = StatsResult {
            total_invocations: indexed.total_invocations,
            by_skill,
            by_tool,
            by_day,
            recent: indexed.recent,
            unused_skills,
            reliability_mode: "best-effort".to_string(),
            reliability_note: "Usage metrics are lower-bound estimates based on tool logs."
                .to_string(),
        };
        store_stats_cache(cache_key, result.clone());
        return Ok(result);
    }

    let cutoff = now - chrono::Duration::days(days as i64);

    let mut by_skill_map = HashMap::<String, usize>::new();
    let mut by_tool_map = HashMap::<String, usize>::new();
    let mut by_day_map = BTreeMap::<String, usize>::new();
    let mut used_skills = HashSet::<String>::new();
    let mut total_invocations = 0usize;
    let mut recent_heap = BinaryHeap::<Reverse<RankedRecent>>::new();

    crate::logs::for_each_log(root, |log| {
        let Some(ts) = parse_ts_utc(&log.ts) else {
            return;
        };
        if ts < cutoff {
            return;
        }

        total_invocations += 1;
        *by_skill_map.entry(log.skill.clone()).or_insert(0) += 1;
        *by_tool_map.entry(log.tool.clone()).or_insert(0) += 1;
        used_skills.insert(log.skill.clone());
        let day = ts.format("%Y-%m-%d").to_string();
        *by_day_map.entry(day).or_insert(0) += 1;

        if recent_heap.len() < 10 {
            recent_heap.push(Reverse(RankedRecent(log)));
            return;
        }

        if let Some(oldest) = recent_heap.peek() {
            if compare_logs_desc(&log, &oldest.0 .0) == Ordering::Less {
                let _ = recent_heap.pop();
                recent_heap.push(Reverse(RankedRecent(log)));
            }
        }
    })?;

    let mut by_skill = by_skill_map
        .into_iter()
        .map(|(name, count)| NamedCount { name, count })
        .collect::<Vec<_>>();
    by_skill.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));

    let mut by_tool = by_tool_map
        .into_iter()
        .map(|(name, count)| NamedCount { name, count })
        .collect::<Vec<_>>();
    by_tool.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));

    let by_day = by_day_map
        .into_iter()
        .map(|(date, count)| DayCount { date, count })
        .collect::<Vec<_>>();

    let mut recent = recent_heap
        .into_iter()
        .map(|entry| entry.0 .0)
        .collect::<Vec<_>>();
    recent.sort_by(compare_logs_desc);

    let unused_skills = collect_unused_skills(root, &used_skills)?;

    let result = StatsResult {
        total_invocations,
        by_skill,
        by_tool,
        by_day,
        recent,
        unused_skills,
        reliability_mode: "best-effort".to_string(),
        reliability_note: "Usage metrics are lower-bound estimates based on tool logs.".to_string(),
    };
    store_stats_cache(cache_key, result.clone());
    Ok(result)
}

#[tauri::command]
pub async fn stats_get(days: Option<u32>) -> Result<StatsResult, String> {
    let root = crate::root_dir::default_root_dir();
    let days = days.unwrap_or(30);
    let task = tauri::async_runtime::spawn_blocking(move || {
        compute_stats_with_now(&root, days, Utc::now())
    });
    let joined = tokio::time::timeout(Duration::from_secs(30), task)
        .await
        .map_err(|_| "stats_get timed out after 30s".to_string())?;
    joined.map_err(|e| format!("Run stats_get task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use crate::test_utils::temp_root;
    use std::fs;
    use std::path::PathBuf;

    use chrono::TimeZone;

    use super::*;

    fn seed(root: &Path) {
        fs::create_dir_all(root.join(".logs")).expect("create logs dir");
        fs::write(
            root.join(".logs").join("skill-usage.jsonl"),
            r#"{"ts":"2026-02-25T01:00:00Z","skill":"code-review","cwd":"/tmp/a","tool":"codex"}
{"ts":"2026-02-26T02:00:00Z","skill":"debug-helper","cwd":"/tmp/b","tool":"claude-code"}
{"ts":"2026-02-27T03:00:00Z","skill":"code-review","cwd":"/tmp/c","tool":"codex"}
"#,
        )
        .expect("write logs");

        fs::create_dir_all(root.join("code-review")).expect("create skill");
        fs::write(
            root.join("code-review").join("SKILL.md"),
            r#"---
name: code-review
description: review
---
"#,
        )
        .expect("write skill");
        fs::create_dir_all(root.join("debug-helper")).expect("create skill");
        fs::write(
            root.join("debug-helper").join("SKILL.md"),
            r#"---
name: debug-helper
description: debug
---
"#,
        )
        .expect("write skill");
        fs::create_dir_all(root.join("planner")).expect("create skill");
        fs::write(
            root.join("planner").join("SKILL.md"),
            r#"---
name: planner
description: plan
---
"#,
        )
        .expect("write skill");
    }

    #[test]
    fn compute_stats_aggregates_expected_fields() {
        let root = temp_root("myskills-tauri-stats-test");
        seed(&root);
        let now = Utc.with_ymd_and_hms(2026, 2, 27, 12, 0, 0).unwrap();

        let stats = compute_stats_with_now(&root, 30, now).expect("compute stats");

        assert_eq!(stats.total_invocations, 3);
        assert_eq!(
            stats.by_skill[0],
            NamedCount {
                name: "code-review".to_string(),
                count: 2
            }
        );
        assert_eq!(stats.by_tool[0].name, "codex");
        assert_eq!(stats.by_tool[0].count, 2);
        assert_eq!(stats.by_day.len(), 3);
        assert_eq!(stats.recent.len(), 3);
        assert_eq!(stats.recent[0].ts, "2026-02-27T03:00:00Z");
        assert_eq!(stats.unused_skills, vec!["planner".to_string()]);
        assert_eq!(stats.reliability_mode, "best-effort");
        assert!(stats.reliability_note.contains("lower-bound"));
    }

    #[test]
    fn compute_stats_applies_days_window() {
        let root = temp_root("myskills-tauri-stats-test");
        seed(&root);
        let now = Utc.with_ymd_and_hms(2026, 2, 27, 12, 0, 0).unwrap();

        let stats = compute_stats_with_now(&root, 1, now).expect("compute stats");

        assert_eq!(stats.total_invocations, 1);
        assert_eq!(stats.by_day.len(), 1);
        assert_eq!(stats.by_day[0].date, "2026-02-27");
    }

    #[test]
    fn parse_ts_supports_rfc3339() {
        let parsed = parse_ts_utc("2026-02-27T03:00:00Z").expect("parse timestamp");
        assert_eq!(parsed.to_rfc3339(), "2026-02-27T03:00:00+00:00");
    }

    #[test]
    fn compute_stats_must_not_read_full_logs_vector() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let source =
            fs::read_to_string(manifest_dir.join("src").join("stats.rs")).expect("read stats.rs");
        let main = source
            .split("#[cfg(test)]")
            .next()
            .expect("stats main section");

        assert!(
            !main.contains("let logs = crate::logs::read_logs(root)?;"),
            "compute_stats_with_now should not read all logs into a full vector"
        );
    }

    #[test]
    fn compute_stats_should_define_cache_key_to_avoid_repeat_full_scans() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let source =
            fs::read_to_string(manifest_dir.join("src").join("stats.rs")).expect("read stats.rs");
        let main = source
            .split("#[cfg(test)]")
            .next()
            .expect("stats main section");

        assert!(
            main.contains("stats_cache_key("),
            "stats module should define a cache key helper for repeated stats queries"
        );
        assert!(
            main.contains("STATS_CACHE"),
            "stats module should maintain an in-process cache entry"
        );
        assert!(
            main.contains("crate::log_index::query_stats_index(root, days"),
            "compute_stats_with_now should try indexed stats query path before fallback scanning"
        );
    }
}

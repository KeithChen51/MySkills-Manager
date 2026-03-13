use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillUsageInsight {
    pub last_used_at: Option<String>,
    pub d7: usize,
    pub d30: usize,
    pub d90: usize,
    pub d7_prev: usize,
    pub d30_prev: usize,
    pub d90_prev: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillEvalInsight {
    pub latest_run_at_unix: Option<u64>,
    pub latest_status: Option<String>,
    pub latest_advisory_level: Option<String>,
    pub latest_pass_rate: Option<f64>,
    pub latest_mode: Option<String>,
    pub latest_model: Option<String>,
    pub prev_pass_rate: Option<f64>,
    pub runs90d: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillInsight {
    pub skill_name: String,
    pub usage: SkillUsageInsight,
    pub eval: SkillEvalInsight,
}

#[derive(Debug, Clone, Default)]
struct EvalHistorySnapshot {
    saved_at_unix: u64,
    path: String,
    status: Option<String>,
    advisory_level: Option<String>,
    pass_rate: Option<f64>,
    mode: Option<String>,
    model: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct UsageAccumulator {
    usage: SkillUsageInsight,
    last_epoch: i64,
}

impl UsageAccumulator {
    fn update_last_used(&mut self, ts_epoch: i64, ts_raw: &str) {
        if self.usage.last_used_at.is_none() || ts_epoch > self.last_epoch {
            self.last_epoch = ts_epoch;
            self.usage.last_used_at = Some(ts_raw.to_string());
        }
    }
}

fn eval_history_dir(home: &Path, skill_name: &str) -> std::path::PathBuf {
    home.join(".my-skills")
        .join(".eval")
        .join(skill_name.trim())
}

fn to_unix_secs(value: std::time::SystemTime) -> u64 {
    value
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn parse_eval_history_snapshot(path: &Path, saved_at_unix: u64) -> Option<EvalHistorySnapshot> {
    let raw = fs::read_to_string(path).ok()?;
    let parsed = serde_json::from_str::<JsonValue>(&raw).ok()?;
    let status = parsed
        .get("status")
        .and_then(|value| value.as_str())
        .map(std::string::ToString::to_string);
    let pass_rate = parsed
        .get("summary")
        .and_then(|summary| summary.get("passRate").or_else(|| summary.get("pass_rate")))
        .and_then(|value| value.as_f64());
    let advisory_level = parsed
        .get("advisory")
        .and_then(|advisory| advisory.get("level"))
        .and_then(|value| value.as_str())
        .map(std::string::ToString::to_string);
    let mode = parsed
        .get("mode")
        .and_then(|value| value.as_str())
        .map(std::string::ToString::to_string);
    let model = parsed
        .get("runMeta")
        .or_else(|| parsed.get("run_meta"))
        .and_then(|meta| meta.get("model"))
        .and_then(|value| value.as_str())
        .map(std::string::ToString::to_string);

    Some(EvalHistorySnapshot {
        saved_at_unix,
        path: path.to_string_lossy().to_string(),
        status,
        advisory_level,
        pass_rate,
        mode,
        model,
    })
}

fn collect_eval_insight_for_skill(
    home: &Path,
    skill_name: &str,
    now: DateTime<Utc>,
) -> SkillEvalInsight {
    let history_dir = eval_history_dir(home, skill_name);
    if !history_dir.exists() {
        return SkillEvalInsight::default();
    }

    let now_unix = now.timestamp().max(0) as u64;
    let cutoff_90d = now_unix.saturating_sub(90 * 24 * 60 * 60);

    let mut snapshots = Vec::<EvalHistorySnapshot>::new();
    let entries = match fs::read_dir(&history_dir) {
        Ok(entries) => entries,
        Err(_) => return SkillEvalInsight::default(),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        let saved_at_unix = metadata.modified().map(to_unix_secs).unwrap_or(0);
        let Some(snapshot) = parse_eval_history_snapshot(&path, saved_at_unix) else {
            continue;
        };
        snapshots.push(snapshot);
    }

    if snapshots.is_empty() {
        return SkillEvalInsight::default();
    }

    snapshots.sort_by(|a, b| {
        b.saved_at_unix
            .cmp(&a.saved_at_unix)
            .then_with(|| b.path.cmp(&a.path))
    });

    let latest = snapshots.first().cloned().unwrap_or_default();
    let prev = snapshots.get(1).cloned().unwrap_or_default();
    let runs90d = snapshots
        .iter()
        .filter(|snapshot| snapshot.saved_at_unix >= cutoff_90d)
        .count();

    SkillEvalInsight {
        latest_run_at_unix: Some(latest.saved_at_unix),
        latest_status: latest.status,
        latest_advisory_level: latest.advisory_level,
        latest_pass_rate: latest.pass_rate,
        latest_mode: latest.mode,
        latest_model: latest.model,
        prev_pass_rate: prev.pass_rate,
        runs90d,
    }
}

fn collect_usage_with_index(
    root: &Path,
    now: DateTime<Utc>,
) -> Result<HashMap<String, SkillUsageInsight>, String> {
    let rows = crate::log_index::query_skill_usage_windows_index(root, now)?;
    let mut by_skill = HashMap::<String, SkillUsageInsight>::new();
    for row in rows {
        by_skill.insert(
            row.skill,
            SkillUsageInsight {
                last_used_at: row.last_used_at,
                d7: row.d7,
                d30: row.d30,
                d90: row.d90,
                d7_prev: row.d7_prev,
                d30_prev: row.d30_prev,
                d90_prev: row.d90_prev,
            },
        );
    }
    Ok(by_skill)
}

fn collect_usage_fallback(
    root: &Path,
    now: DateTime<Utc>,
) -> Result<HashMap<String, SkillUsageInsight>, String> {
    let d7_start = now - chrono::Duration::days(7);
    let d30_start = now - chrono::Duration::days(30);
    let d90_start = now - chrono::Duration::days(90);
    let d7_prev_start = now - chrono::Duration::days(14);
    let d30_prev_start = now - chrono::Duration::days(60);
    let d90_prev_start = now - chrono::Duration::days(180);

    let mut by_skill = HashMap::<String, UsageAccumulator>::new();
    crate::logs::for_each_log(root, |log| {
        let Some(ts) = crate::log_parse::parse_ts_utc(&log.ts) else {
            return;
        };
        let ts_epoch = ts.timestamp();
        let entry = by_skill.entry(log.skill.clone()).or_default();

        if ts >= d7_start {
            entry.usage.d7 += 1;
        }
        if ts >= d30_start {
            entry.usage.d30 += 1;
        }
        if ts >= d90_start {
            entry.usage.d90 += 1;
        }
        if ts >= d7_prev_start && ts < d7_start {
            entry.usage.d7_prev += 1;
        }
        if ts >= d30_prev_start && ts < d30_start {
            entry.usage.d30_prev += 1;
        }
        if ts >= d90_prev_start && ts < d90_start {
            entry.usage.d90_prev += 1;
        }
        entry.update_last_used(ts_epoch, &log.ts);
    })?;

    Ok(by_skill
        .into_iter()
        .map(|(skill, acc)| (skill, acc.usage))
        .collect::<HashMap<_, _>>())
}

pub fn collect_skill_insights_with_now(
    root: &Path,
    home: &Path,
    now: DateTime<Utc>,
) -> Result<Vec<SkillInsight>, String> {
    let skills = crate::skills::list_skills(root)?;
    let usage_by_skill =
        collect_usage_with_index(root, now).or_else(|_| collect_usage_fallback(root, now))?;

    let mut insights = skills
        .into_iter()
        .map(|skill| {
            let usage = usage_by_skill
                .get(&skill.name)
                .cloned()
                .unwrap_or_else(SkillUsageInsight::default);
            let eval = collect_eval_insight_for_skill(home, &skill.name, now);
            SkillInsight {
                skill_name: skill.name,
                usage,
                eval,
            }
        })
        .collect::<Vec<_>>();
    insights.sort_by(|a, b| a.skill_name.cmp(&b.skill_name));
    Ok(insights)
}

#[tauri::command]
pub fn skills_get_insights() -> Result<Vec<SkillInsight>, String> {
    collect_skill_insights_with_now(
        &crate::root_dir::default_root_dir(),
        &crate::root_dir::default_home_dir(),
        Utc::now(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::temp_root;
    use chrono::TimeZone;
    use std::collections::HashMap;
    use std::fs;

    fn seed_skill(root: &Path, name: &str) {
        let skill_dir = root.join(name);
        fs::create_dir_all(&skill_dir).expect("create skill dir");
        fs::write(
            skill_dir.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: {name}\n---\n"),
        )
        .expect("write skill");
    }

    fn seed_logs(root: &Path) {
        let logs_dir = root.join(".logs");
        fs::create_dir_all(&logs_dir).expect("create logs dir");
        fs::write(
            logs_dir.join("skill-usage.jsonl"),
            r#"{"ts":"2026-03-10T01:00:00Z","skill":"alpha","cwd":"/tmp/a","tool":"codex"}
{"ts":"2026-03-05T02:00:00Z","skill":"alpha","cwd":"/tmp/a","tool":"codex"}
{"ts":"2026-03-02T03:00:00Z","skill":"alpha","cwd":"/tmp/a","tool":"codex"}
{"ts":"2026-02-20T03:00:00Z","skill":"alpha","cwd":"/tmp/a","tool":"codex"}
{"ts":"2025-12-20T03:00:00Z","skill":"alpha","cwd":"/tmp/a","tool":"codex"}
{"ts":"2025-11-30T03:00:00Z","skill":"alpha","cwd":"/tmp/a","tool":"codex"}
{"ts":"2026-02-01T03:00:00Z","skill":"beta","cwd":"/tmp/b","tool":"codex"}
"#,
        )
        .expect("write logs");
    }

    fn seed_eval_history(home: &Path) {
        let alpha_dir = home.join(".my-skills").join(".eval").join("alpha");
        fs::create_dir_all(&alpha_dir).expect("create alpha eval dir");
        fs::write(
            alpha_dir.join("iteration-1-1.json"),
            r#"{
  "status": "failed",
  "mode": "standard",
  "summary": { "passRate": 0.64 },
  "runMeta": { "model": "gpt-4o-mini" }
}"#,
        )
        .expect("write alpha history old");
        fs::write(
            alpha_dir.join("iteration-2-2.json"),
            r#"{
  "status": "success",
  "advisory": { "level": "warn", "reasons": ["sample"], "nonBlocking": true },
  "mode": "full",
  "summary": { "passRate": 0.82 },
  "runMeta": { "model": "gpt-4.1" }
}"#,
        )
        .expect("write alpha history new");
    }

    fn to_map(rows: Vec<SkillInsight>) -> HashMap<String, SkillInsight> {
        rows.into_iter()
            .map(|row| (row.skill_name.clone(), row))
            .collect::<HashMap<_, _>>()
    }

    #[test]
    fn collect_skill_insights_aggregates_usage_windows_and_eval_snapshot() {
        let root = temp_root("myskills-tauri-skill-insights-test");
        let home = temp_root("myskills-tauri-skill-insights-test");
        for name in ["alpha", "beta", "gamma"] {
            seed_skill(&root, name);
        }
        seed_logs(&root);
        seed_eval_history(&home);
        let now = Utc.with_ymd_and_hms(2026, 3, 11, 12, 0, 0).unwrap();

        let rows = collect_skill_insights_with_now(&root, &home, now).expect("collect insights");
        let map = to_map(rows);

        let alpha = map.get("alpha").expect("alpha insight");
        assert_eq!(alpha.usage.d7, 2);
        assert_eq!(alpha.usage.d7_prev, 1);
        assert_eq!(alpha.usage.d30, 4);
        assert_eq!(alpha.usage.d30_prev, 0);
        assert_eq!(alpha.usage.d90, 5);
        assert_eq!(alpha.usage.d90_prev, 1);
        assert_eq!(
            alpha.usage.last_used_at.as_deref(),
            Some("2026-03-10T01:00:00Z")
        );
        assert_eq!(alpha.eval.latest_status.as_deref(), Some("success"));
        assert_eq!(alpha.eval.latest_advisory_level.as_deref(), Some("warn"));
        assert_eq!(alpha.eval.latest_mode.as_deref(), Some("full"));
        assert_eq!(alpha.eval.latest_model.as_deref(), Some("gpt-4.1"));
        assert_eq!(alpha.eval.latest_pass_rate, Some(0.82));
        assert_eq!(alpha.eval.prev_pass_rate, Some(0.64));
        assert_eq!(alpha.eval.runs90d, 2);
        assert!(alpha.eval.latest_run_at_unix.is_some());
    }

    #[test]
    fn collect_skill_insights_keeps_empty_defaults_for_unseen_skill() {
        let root = temp_root("myskills-tauri-skill-insights-test");
        let home = temp_root("myskills-tauri-skill-insights-test");
        seed_skill(&root, "gamma");
        let now = Utc.with_ymd_and_hms(2026, 3, 11, 12, 0, 0).unwrap();

        let rows = collect_skill_insights_with_now(&root, &home, now).expect("collect insights");
        let map = to_map(rows);
        let gamma = map.get("gamma").expect("gamma insight");
        assert_eq!(gamma.usage.d7, 0);
        assert_eq!(gamma.usage.d30, 0);
        assert_eq!(gamma.usage.d90, 0);
        assert_eq!(gamma.usage.last_used_at, None);
        assert_eq!(gamma.eval.latest_pass_rate, None);
        assert_eq!(gamma.eval.latest_status, None);
        assert_eq!(gamma.eval.runs90d, 0);
    }
}

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use crate::log_parse::{parse_log_line, parse_ts_epoch};
use crate::logs::{LogEntry, LogsQuery, LogsResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct IndexedStatsRows {
    pub total_invocations: usize,
    pub by_skill: Vec<(String, usize)>,
    pub by_tool: Vec<(String, usize)>,
    pub by_day: Vec<(String, usize)>,
    pub recent: Vec<LogEntry>,
}

fn logs_file(root: &Path) -> PathBuf {
    root.join(".logs").join("skill-usage.jsonl")
}

fn index_file(root: &Path) -> PathBuf {
    root.join(".logs").join("skill-usage-index.sqlite3")
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS logs (
  line_no INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  ts_epoch INTEGER,
  skill TEXT NOT NULL,
  cwd TEXT NOT NULL,
  tool TEXT NOT NULL,
  session TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_ts_epoch ON logs(ts_epoch DESC);
CREATE INDEX IF NOT EXISTS idx_logs_skill ON logs(skill);
CREATE INDEX IF NOT EXISTS idx_logs_tool ON logs(tool);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
"#,
    )
    .map_err(|e| format!("Initialize log index schema failed: {e}"))
}

fn read_meta_i64(conn: &Connection, key: &str) -> Result<Option<i64>, String> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .optional()
    .map_err(|e| format!("Read log index meta failed: {e}"))
}

fn write_meta_i64(conn: &Connection, key: &str, value: i64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map(|_| ())
    .map_err(|e| format!("Write log index meta failed: {e}"))
}

fn file_signature(path: &Path) -> (i64, i64) {
    let Ok(metadata) = fs::metadata(path) else {
        return (0, 0);
    };
    let size = metadata.len() as i64;
    let modified_ns = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos() as i64)
        .unwrap_or_default();
    (size, modified_ns)
}

fn import_logs(conn: &mut Connection, file_path: &Path, start_line: usize) -> Result<(), String> {
    let file =
        File::open(file_path).map_err(|e| format!("Open source logs for index failed: {e}"))?;
    let reader = BufReader::new(file);
    let mut reader = reader;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Start log index transaction failed: {e}"))?;

    {
        let mut stmt = tx
            .prepare(
                "INSERT OR REPLACE INTO logs(line_no, ts, ts_epoch, skill, cwd, tool, session)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(|e| format!("Prepare log index insert failed: {e}"))?;

        let mut line_no = 0usize;
        let mut raw_line = Vec::<u8>::new();
        loop {
            raw_line.clear();
            let read = reader
                .read_until(b'\n', &mut raw_line)
                .map_err(|e| format!("Read source log line failed: {e}"))?;
            if read == 0 {
                break;
            }
            line_no += 1;
            if line_no < start_line {
                continue;
            }
            while matches!(raw_line.last(), Some(b'\n' | b'\r')) {
                raw_line.pop();
            }
            if raw_line.is_empty() {
                continue;
            }
            let line = String::from_utf8_lossy(&raw_line);
            if let Some(log) = parse_log_line(line.as_ref()) {
                stmt.execute(params![
                    line_no as i64,
                    log.ts,
                    parse_ts_epoch(&log.ts),
                    log.skill,
                    log.cwd,
                    log.tool,
                    log.session
                ])
                .map_err(|e| format!("Insert indexed log failed: {e}"))?;
            }
        }
    }

    tx.commit()
        .map_err(|e| format!("Commit log index transaction failed: {e}"))
}

fn sync_index(conn: &mut Connection, root: &Path) -> Result<(), String> {
    let source_path = logs_file(root);
    let (source_size, source_mtime_ns) = file_signature(&source_path);

    let previous_size = read_meta_i64(conn, "source_size")?.unwrap_or_default();
    let previous_mtime = read_meta_i64(conn, "source_mtime_ns")?.unwrap_or_default();

    if source_size == previous_size && source_mtime_ns == previous_mtime {
        return Ok(());
    }

    let mut start_line = 1usize;
    let should_rebuild = !source_path.exists()
        || source_size < previous_size
        || (source_size == previous_size && source_mtime_ns != previous_mtime);

    if should_rebuild {
        conn.execute("DELETE FROM logs", [])
            .map_err(|e| format!("Reset log index failed: {e}"))?;
    } else {
        let max_line = conn
            .query_row("SELECT COALESCE(MAX(line_no), 0) FROM logs", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|e| format!("Read indexed max line failed: {e}"))?;
        start_line = (max_line as usize).saturating_add(1);
    }

    if source_path.exists() {
        import_logs(conn, &source_path, start_line)?;
    }

    write_meta_i64(conn, "source_size", source_size)?;
    write_meta_i64(conn, "source_mtime_ns", source_mtime_ns)?;
    Ok(())
}

fn open_synced_index(root: &Path) -> Result<Connection, String> {
    fs::create_dir_all(root.join(".logs")).map_err(|e| format!("Create .logs dir failed: {e}"))?;
    let mut conn =
        Connection::open(index_file(root)).map_err(|e| format!("Open log index db failed: {e}"))?;
    conn.busy_timeout(Duration::from_millis(1000))
        .map_err(|e| format!("Set log index busy timeout failed: {e}"))?;
    init_schema(&conn)?;
    sync_index(&mut conn, root)?;
    Ok(conn)
}

pub(crate) fn query_logs_index(root: &Path, query: &LogsQuery) -> Result<LogsResult, String> {
    let conn = open_synced_index(root)?;
    let page = if query.page == 0 { 1 } else { query.page };
    let limit = if query.limit == 0 {
        100
    } else {
        query.limit.min(1000)
    };
    let offset = (page - 1).saturating_mul(limit);

    let skill = query.skill.as_deref();
    let tool = query.tool.as_deref();
    let from_epoch = query.from.as_deref().and_then(parse_ts_epoch);
    let to_epoch = query.to.as_deref().and_then(parse_ts_epoch);

    let total = conn
        .query_row(
            "SELECT COUNT(*) FROM logs
             WHERE (?1 IS NULL OR skill = ?1)
               AND (?2 IS NULL OR tool = ?2)
               AND (?3 IS NULL OR (ts_epoch IS NOT NULL AND ts_epoch >= ?3))
               AND (?4 IS NULL OR (ts_epoch IS NOT NULL AND ts_epoch <= ?4))",
            params![skill, tool, from_epoch, to_epoch],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| format!("Query indexed logs count failed: {e}"))?;

    let mut stmt = conn
        .prepare(
            "SELECT ts, skill, cwd, tool, session
             FROM logs
             WHERE (?1 IS NULL OR skill = ?1)
               AND (?2 IS NULL OR tool = ?2)
               AND (?3 IS NULL OR (ts_epoch IS NOT NULL AND ts_epoch >= ?3))
               AND (?4 IS NULL OR (ts_epoch IS NOT NULL AND ts_epoch <= ?4))
             ORDER BY ts DESC
             LIMIT ?5 OFFSET ?6",
        )
        .map_err(|e| format!("Prepare indexed logs query failed: {e}"))?;

    let mut logs = Vec::<LogEntry>::new();
    let rows = stmt
        .query_map(
            params![
                skill,
                tool,
                from_epoch,
                to_epoch,
                limit as i64,
                offset as i64
            ],
            |row| {
                Ok(LogEntry {
                    ts: row.get(0)?,
                    skill: row.get(1)?,
                    cwd: row.get(2)?,
                    tool: row.get(3)?,
                    session: row.get(4)?,
                })
            },
        )
        .map_err(|e| format!("Run indexed logs query failed: {e}"))?;
    for row in rows {
        logs.push(row.map_err(|e| format!("Read indexed logs row failed: {e}"))?);
    }

    Ok(LogsResult {
        logs,
        total: total.max(0) as usize,
    })
}

pub(crate) fn query_stats_index(
    root: &Path,
    days: u32,
    now: DateTime<Utc>,
) -> Result<IndexedStatsRows, String> {
    let conn = open_synced_index(root)?;
    let days = if days == 0 { 30 } else { days };
    let cutoff_epoch = (now - chrono::Duration::days(days as i64)).timestamp();

    let total_invocations = conn
        .query_row(
            "SELECT COUNT(*)
             FROM logs
             WHERE ts_epoch IS NOT NULL AND ts_epoch >= ?1",
            [cutoff_epoch],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| format!("Query indexed stats total failed: {e}"))?
        .max(0) as usize;

    let by_skill = query_named_counts(
        &conn,
        "SELECT skill, COUNT(*)
         FROM logs
         WHERE ts_epoch IS NOT NULL AND ts_epoch >= ?1
         GROUP BY skill
         ORDER BY COUNT(*) DESC, skill ASC",
        cutoff_epoch,
    )?;
    let by_tool = query_named_counts(
        &conn,
        "SELECT tool, COUNT(*)
         FROM logs
         WHERE ts_epoch IS NOT NULL AND ts_epoch >= ?1
         GROUP BY tool
         ORDER BY COUNT(*) DESC, tool ASC",
        cutoff_epoch,
    )?;
    let by_day = query_named_counts(
        &conn,
        "SELECT substr(ts, 1, 10) AS day, COUNT(*)
         FROM logs
         WHERE ts_epoch IS NOT NULL AND ts_epoch >= ?1
         GROUP BY day
         ORDER BY day ASC",
        cutoff_epoch,
    )?;

    let mut recent = Vec::<LogEntry>::new();
    let mut stmt = conn
        .prepare(
            "SELECT ts, skill, cwd, tool, session
             FROM logs
             WHERE ts_epoch IS NOT NULL AND ts_epoch >= ?1
             ORDER BY ts_epoch DESC, ts DESC
             LIMIT 10",
        )
        .map_err(|e| format!("Prepare indexed recent logs query failed: {e}"))?;
    let rows = stmt
        .query_map([cutoff_epoch], |row| {
            Ok(LogEntry {
                ts: row.get(0)?,
                skill: row.get(1)?,
                cwd: row.get(2)?,
                tool: row.get(3)?,
                session: row.get(4)?,
            })
        })
        .map_err(|e| format!("Run indexed recent logs query failed: {e}"))?;
    for row in rows {
        recent.push(row.map_err(|e| format!("Read indexed recent logs row failed: {e}"))?);
    }

    Ok(IndexedStatsRows {
        total_invocations,
        by_skill,
        by_tool,
        by_day,
        recent,
    })
}

fn query_named_counts(
    conn: &Connection,
    sql: &str,
    cutoff_epoch: i64,
) -> Result<Vec<(String, usize)>, String> {
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("Prepare indexed aggregate query failed: {e}"))?;
    let mut out = Vec::<(String, usize)>::new();
    let rows = stmt
        .query_map([cutoff_epoch], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| format!("Run indexed aggregate query failed: {e}"))?;
    for row in rows {
        let (name, count) = row.map_err(|e| format!("Read indexed aggregate row failed: {e}"))?;
        out.push((name, count.max(0) as usize));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::temp_root;
    use chrono::TimeZone;
    use std::fs::OpenOptions;
    use std::io::Write;

    fn seed(root: &Path) {
        fs::create_dir_all(root.join(".logs")).expect("create logs dir");
        fs::write(
            root.join(".logs").join("skill-usage.jsonl"),
            r#"{"ts":"2026-02-25T01:00:00Z","skill":"code-review","cwd":"/tmp/a","tool":"codex"}
{"ts":"2026-02-26T02:00:00Z","skill":"debug-helper","cwd":"/tmp/b","tool":"claude-code"}
"#,
        )
        .expect("write logs");
    }

    #[test]
    fn indexed_logs_query_supports_filter_and_pagination() {
        let root = temp_root("myskills-tauri-log-index-test");
        seed(&root);
        let result = query_logs_index(
            &root,
            &LogsQuery {
                skill: Some("code-review".to_string()),
                tool: Some("codex".to_string()),
                from: None,
                to: None,
                page: 1,
                limit: 10,
            },
        )
        .expect("query indexed logs");
        assert_eq!(result.total, 1);
        assert_eq!(result.logs.len(), 1);
        assert_eq!(result.logs[0].skill, "code-review");
    }

    #[test]
    fn indexed_stats_refreshes_after_log_append() {
        let root = temp_root("myskills-tauri-log-index-test");
        seed(&root);
        let now = Utc.with_ymd_and_hms(2026, 2, 27, 12, 0, 0).unwrap();

        let first = query_stats_index(&root, 30, now).expect("first indexed stats");
        assert_eq!(first.total_invocations, 2);

        let mut file = OpenOptions::new()
            .append(true)
            .open(root.join(".logs").join("skill-usage.jsonl"))
            .expect("open log file");
        writeln!(
            file,
            r#"{{"ts":"2026-02-27T03:00:00Z","skill":"code-review","cwd":"/tmp/c","tool":"codex"}}"#
        )
        .expect("append log line");

        let second = query_stats_index(&root, 30, now).expect("second indexed stats");
        assert_eq!(second.total_invocations, 3);
        assert_eq!(second.by_skill[0].0, "code-review");
        assert_eq!(second.by_skill[0].1, 2);
    }

    #[test]
    fn indexed_queries_tolerate_non_utf8_lines() {
        let root = temp_root("myskills-tauri-log-index-test");
        fs::create_dir_all(root.join(".logs")).expect("create logs dir");

        let mut raw = Vec::<u8>::new();
        raw.extend_from_slice(
            br#"{"ts":"2026-03-02T04:08:09Z","skill":"using-superpowers","cwd":"C:\Own Docm\Coding\My-Skills","tool":"codex"}"#,
        );
        raw.push(b'\n');
        raw.extend_from_slice(
            br#"{"ts":"2026-03-02T04:08:09Z","skill":"writing-plans","cwd":"C:\Own Docm\Coding\bad"#,
        );
        raw.push(0xB7);
        raw.extend_from_slice(br#"path","tool":"codex"}"#);
        raw.push(b'\n');
        fs::write(root.join(".logs").join("skill-usage.jsonl"), raw).expect("write mixed logs");

        let now = Utc.with_ymd_and_hms(2026, 3, 2, 12, 0, 0).unwrap();
        let stats = query_stats_index(&root, 30, now).expect("query indexed stats");
        assert_eq!(stats.total_invocations, 2);

        let logs = query_logs_index(
            &root,
            &LogsQuery {
                skill: None,
                tool: None,
                from: None,
                to: None,
                page: 1,
                limit: 10,
            },
        )
        .expect("query indexed logs");
        assert_eq!(logs.total, 2);
    }
}

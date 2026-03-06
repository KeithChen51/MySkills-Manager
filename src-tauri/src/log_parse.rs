use chrono::{DateTime, Utc};

pub(crate) fn parse_ts_utc(ts: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

pub(crate) fn parse_ts_epoch(ts: &str) -> Option<i64> {
    parse_ts_utc(ts).map(|dt| dt.timestamp())
}

pub(crate) fn parse_log_line(line: &str) -> Option<crate::logs::LogEntry> {
    if let Ok(log) = serde_json::from_str::<crate::logs::LogEntry>(line) {
        return Some(log);
    }

    if line.contains('\\') {
        let escaped = line.replace('\\', "\\\\");
        if let Ok(log) = serde_json::from_str::<crate::logs::LogEntry>(&escaped) {
            return Some(log);
        }
    }

    None
}

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static COUNTER: AtomicUsize = AtomicUsize::new(0);

pub(crate) fn temp_root(prefix: &str) -> PathBuf {
    let mut root = std::env::temp_dir();
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock")
        .as_nanos();
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    root.push(format!("{prefix}-{ts}-{n}"));
    root
}

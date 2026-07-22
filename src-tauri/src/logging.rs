//! File-based debug log in the user's temp folder: one file per app launch,
//! pruned to the 3 most recent, Python `logging`-style lines. The active
//! level is a plain `log::set_max_level` call, so it can change at runtime
//! (from the Settings screen) without re-installing the logger.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use log::{Level, LevelFilter, Log, Metadata, Record};

const KEEP_FILES: usize = 3;

struct FileLogger {
    file: Mutex<File>,
}

impl Log for FileLogger {
    fn enabled(&self, _metadata: &Metadata) -> bool {
        // The global max level (set via `set_level`) already gates which
        // records reach here; nothing more to filter.
        true
    }

    fn log(&self, record: &Record) {
        let line = format_line(record);
        eprint!("{line}");
        if let Ok(mut file) = self.file.lock() {
            let _ = file.write_all(line.as_bytes());
            let _ = file.flush();
        }
    }

    fn flush(&self) {
        if let Ok(mut file) = self.file.lock() {
            let _ = file.flush();
        }
    }
}

/// Python's default line shape:
/// `2005-03-19 15:10:26,618 - simple_example - DEBUG - debug message`
fn format_line(record: &Record) -> String {
    let level = match record.level() {
        Level::Warn => "WARNING",
        other => other.as_str(),
    };
    format!(
        "{} - performa - {} - {}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S,%3f"),
        level,
        record.args()
    )
}

/// `<temp>/performa-logs` — a dedicated subfolder so "open log folder" shows
/// only our files, not the whole shared system temp directory.
pub fn log_dir() -> PathBuf {
    std::env::temp_dir().join("performa-logs")
}

/// Parse a level name ("error" | "warn" | "info" | "debug", case-insensitive)
/// and apply it as the new global filter.
pub fn set_level(level: &str) -> Result<(), String> {
    let filter = match level.to_lowercase().as_str() {
        "error" => LevelFilter::Error,
        "warn" | "warning" => LevelFilter::Warn,
        "info" => LevelFilter::Info,
        "debug" => LevelFilter::Debug,
        other => return Err(format!("unknown log level '{other}'")),
    };
    log::set_max_level(filter);
    Ok(())
}

/// Create this session's log file (pruning older ones down to `KEEP_FILES`
/// total) and install it as the global logger. Call once, at startup.
pub fn init() -> std::io::Result<PathBuf> {
    let dir = log_dir();
    fs::create_dir_all(&dir)?;
    prune(&dir);

    let path = dir.join(format!(
        "performa_{}.log",
        chrono::Local::now().format("%Y%m%d_%H%M%S")
    ));
    let file = OpenOptions::new().create(true).append(true).open(&path)?;

    // Errors here just mean a previous call already installed a logger
    // (shouldn't happen in practice) — logging is best-effort either way.
    let _ = log::set_boxed_logger(Box::new(FileLogger {
        file: Mutex::new(file),
    }));
    log::set_max_level(LevelFilter::Error); // matches the Settings default
    log::info!("performa {} started", env!("CARGO_PKG_VERSION"));
    Ok(path)
}

/// Keep only the `KEEP_FILES - 1` most recent existing logs, making room for
/// the new one this session is about to create.
fn prune(dir: &std::path::Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("log"))
        .collect();
    // Filenames are `performa_YYYYMMDD_HHMMSS.log`, so lexicographic order
    // is chronological order.
    files.sort();
    if files.len() + 1 > KEEP_FILES {
        for old in &files[..files.len() + 1 - KEEP_FILES] {
            let _ = fs::remove_file(old);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_level_parses_known_names_case_insensitively() {
        assert!(set_level("Error").is_ok());
        assert!(set_level("WARN").is_ok());
        assert!(set_level("warning").is_ok());
        assert!(set_level("info").is_ok());
        assert!(set_level("Debug").is_ok());
        assert!(set_level("critical").is_err());
    }

    #[test]
    fn format_line_matches_python_logging_shape() {
        let record = Record::builder()
            .level(Level::Warn)
            .args(format_args!("disk almost full"))
            .build();
        let line = format_line(&record);
        // "2026-07-22 15:10:26,618 - performa - WARNING - disk almost full\n"
        assert!(line.contains(" - performa - WARNING - disk almost full"));
        assert!(line.ends_with('\n'));
        let timestamp = line.split(" - ").next().unwrap();
        assert!(
            timestamp.contains(','),
            "expected a comma-millis timestamp: {timestamp}"
        );
    }

    #[test]
    fn prune_keeps_only_the_most_recent_files() {
        let dir = std::env::temp_dir().join(format!(
            "performa-logs-test-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();

        for name in [
            "performa_20260101_000000.log",
            "performa_20260102_000000.log",
            "performa_20260103_000000.log",
            "performa_20260104_000000.log",
        ] {
            fs::write(dir.join(name), "").unwrap();
        }
        // Simulate a stray non-log file, which must survive untouched.
        fs::write(dir.join("notes.txt"), "").unwrap();

        prune(&dir);

        let mut remaining: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        remaining.sort();

        // KEEP_FILES - 1 = 2 oldest logs pruned to make room for this
        // session's new file, plus the untouched non-log file.
        assert_eq!(
            remaining,
            vec![
                "notes.txt".to_string(),
                "performa_20260103_000000.log".to_string(),
                "performa_20260104_000000.log".to_string(),
            ]
        );

        fs::remove_dir_all(&dir).unwrap();
    }
}

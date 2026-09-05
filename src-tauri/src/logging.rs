//! File-based debug log in the user's temp folder: one file per app launch,
//! pruned to the 3 most recent, Python `logging`-style lines. The active
//! level is a plain `log::set_max_level` call, so it can change at runtime
//! (from the Settings screen) without re-installing the logger.

use std::fs::{self, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use log::{Level, LevelFilter, Log, Metadata, Record};

const KEEP_FILES: usize = 3;

struct FileLogger<W: Write + Send> {
    /// Buffered rather than written straight through: `log` is called from
    /// the tokio workers the background scans run on, and a `write` + `flush`
    /// syscall pair per record blocked one of them every time — worst exactly
    /// when the user has turned debug logging on to find out why something is
    /// slow.
    ///
    /// The trade-off is that a hard crash can lose the tail of the buffer. So
    /// errors are still flushed the moment they are written (see [`Log::log`]):
    /// the records that explain a crash reach the disk immediately, and only
    /// info/debug chatter rides in the buffer.
    file: Mutex<BufWriter<W>>,
}

impl<W: Write + Send + 'static> Log for FileLogger<W> {
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
            // An error may be the last thing written before the process dies,
            // so it does not get to wait in the buffer.
            if record.level() <= Level::Error {
                let _ = file.flush();
            }
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

/// Fold text into a single bounded log line: all whitespace runs (newlines
/// above all) collapse to one space, and the result is capped at `max_chars`.
///
/// Anything that reaches the log from outside this process — the webview, a
/// Jira response body — goes through here first. One record must stay one
/// line: an embedded newline would otherwise let a caller forge additional
/// log entries, and an unbounded message could fill the disk.
pub fn one_line(text: &str, max_chars: usize) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= max_chars {
        return collapsed;
    }
    let cut: String = collapsed.chars().take(max_chars).collect();
    format!("{}…", cut.trim_end())
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
        file: Mutex::new(BufWriter::new(file)),
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

    /// A sink whose bytes stay observable after the logger has taken it.
    #[derive(Clone)]
    struct Sink(std::sync::Arc<Mutex<Vec<u8>>>);

    impl Write for Sink {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn logger_over(sink: Sink) -> FileLogger<Sink> {
        FileLogger {
            file: Mutex::new(BufWriter::new(sink)),
        }
    }

    fn record_at(level: Level, msg: &str) -> String {
        format_line(
            &Record::builder()
                .level(level)
                .args(format_args!("{msg}"))
                .build(),
        )
    }

    #[test]
    fn an_error_reaches_the_file_without_waiting_for_the_buffer() {
        // The reason the buffer is safe: whatever explains a crash is on disk
        // before the crash can happen.
        let sink = Sink(Default::default());
        let logger = logger_over(sink.clone());
        logger.log(
            &Record::builder()
                .level(Level::Error)
                .args(format_args!("boom"))
                .build(),
        );
        let written = String::from_utf8(sink.0.lock().unwrap().clone()).unwrap();
        assert!(
            written.contains("boom"),
            "error was left in the buffer: {written:?}"
        );
        assert!(written.contains("ERROR"));
    }

    #[test]
    fn chatter_waits_in_the_buffer_until_flushed() {
        // The point of the change: no syscall per info/debug record.
        let sink = Sink(Default::default());
        let logger = logger_over(sink.clone());
        logger.log(
            &Record::builder()
                .level(Level::Info)
                .args(format_args!("routine"))
                .build(),
        );
        assert!(
            sink.0.lock().unwrap().is_empty(),
            "an info record should not have been flushed on its own"
        );

        logger.flush();
        let written = String::from_utf8(sink.0.lock().unwrap().clone()).unwrap();
        assert!(written.contains("routine"), "flush lost the buffered line");
    }

    #[test]
    fn a_flush_carries_everything_buffered_before_it() {
        // What `open_log_folder` and the exit hook rely on: the user reads a
        // complete file, not one missing its last few lines.
        let sink = Sink(Default::default());
        let logger = logger_over(sink.clone());
        for i in 0..5 {
            logger.log(
                &Record::builder()
                    .level(Level::Debug)
                    .args(format_args!("line {i}"))
                    .build(),
            );
        }
        logger.flush();
        let written = String::from_utf8(sink.0.lock().unwrap().clone()).unwrap();
        for i in 0..5 {
            assert!(written.contains(&format!("line {i}")), "missing line {i}");
        }
    }

    #[test]
    fn warnings_render_as_python_style_warning() {
        assert!(record_at(Level::Warn, "careful").contains(" - WARNING - careful"));
    }
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
    fn one_line_folds_newlines_so_a_caller_cannot_forge_records() {
        // The attack this guards: a webview message that ends the current
        // record and appends a fabricated one.
        let forged = "oops\n2026-07-25 12:00:00,000 - performa - INFO - all good";
        let safe = one_line(forged, 200);
        assert!(!safe.contains('\n'));
        assert_eq!(
            safe,
            "oops 2026-07-25 12:00:00,000 - performa - INFO - all good"
        );
        // Carriage returns and tabs collapse too, and edges are trimmed.
        assert_eq!(one_line("  a\r\n\tb  ", 200), "a b");
        assert_eq!(one_line("", 200), "");
    }

    #[test]
    fn one_line_caps_length() {
        assert_eq!(one_line("short", 100), "short");
        assert_eq!(one_line(&"x".repeat(50), 10), "xxxxxxxxxx…");
        // Counted in chars, not bytes — must not split a multi-byte character.
        assert_eq!(one_line(&"ü".repeat(50), 3), "üüü…");
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

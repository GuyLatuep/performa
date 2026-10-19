//! Reading and writing a settings file, for moving performa to another
//! computer. What goes into the file is the webview's business; this side only
//! moves text to and from the path the user picked in a native dialog.

use std::path::Path;

/// Far more than every transferable setting together, which is a few
/// kilobytes. A file bigger than this was never written by performa, and
/// reading it whole into the webview would only be a slow way to reject it.
const MAX_SETTINGS_FILE_BYTES: u64 = 5 * 1024 * 1024;

/// Write an exported settings file to the path chosen in the save dialog.
#[tauri::command]
pub fn write_settings_file(path: String, contents: String) -> Result<(), String> {
    write(Path::new(&path), &contents)
}

/// Read a settings file chosen in the open dialog, for the webview to check.
#[tauri::command]
pub fn read_settings_file(path: String) -> Result<String, String> {
    read(Path::new(&path))
}

fn write(path: &Path, contents: &str) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|e| format!("could not save the file: {e}"))
}

fn read(path: &Path) -> Result<String, String> {
    let size = std::fs::metadata(path)
        .map_err(|e| format!("could not open the file: {e}"))?
        .len();
    if size > MAX_SETTINGS_FILE_BYTES {
        return Err("this is not a performa settings file".to_string());
    }
    std::fs::read_to_string(path).map_err(|e| format!("could not read the file: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("performa-transfer-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[test]
    fn what_is_written_reads_back_unchanged() {
        let path = scratch("roundtrip.json");
        let text = "{\"app\":\"performa\",\"settings\":{\"performa-theme\":\"dark\"}} – ü";

        write(&path, text).unwrap();

        assert_eq!(read(&path).unwrap(), text);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn a_missing_file_is_an_error_not_a_panic() {
        let err = read(&scratch("does-not-exist.json")).unwrap_err();

        assert!(err.starts_with("could not open the file"));
    }

    // Size is checked before reading: a multi-gigabyte file picked by mistake
    // must not be pulled into memory just to be turned away.
    #[test]
    fn an_oversized_file_is_turned_away() {
        let path = scratch("huge.json");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_SETTINGS_FILE_BYTES + 1).unwrap();

        assert_eq!(
            read(&path).unwrap_err(),
            "this is not a performa settings file"
        );
        std::fs::remove_file(path).ok();
    }
}

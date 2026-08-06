//! Startup housekeeping for the leftovers of the in-app updater.
//!
//! Installing an update leaves two things behind on Windows: the downloaded
//! `performa_<version>_x64-setup.exe` in the user's Downloads folder, and the
//! updater's own `performa-<version>-updater-<rand>` scratch directory in the
//! system temp folder (the plugin deliberately keeps it so the installer can
//! run after the app has exited). Nothing ever removes either, so they pile up
//! one per update. We sweep them at launch, when no installer of ours should
//! be running any more.
//!
//! Every step is best-effort: a file that is still locked (an installer that
//! just relaunched us) simply survives until the next start.

use std::fs;
use std::path::Path;

use tauri::{App, Manager};

/// Delete the installers and scratch directories left by earlier updates.
/// Called once from `setup`; failures are logged, never fatal.
pub fn sweep_update_leftovers(app: &App) {
    match app.path().download_dir() {
        Ok(dir) => sweep_dir(&dir, is_installer),
        Err(e) => log::debug!("no download dir to clean: {e}"),
    }
    sweep_dir(&std::env::temp_dir(), is_updater_scratch);
}

/// Remove every direct child of `dir` whose file name `matches`.
fn sweep_dir(dir: &Path, matches: fn(&str) -> bool) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !matches(name) {
            continue;
        }
        let removed = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        match removed {
            Ok(()) => log::info!("removed update leftover {}", path.display()),
            // Still in use, or not ours to delete — try again next launch.
            Err(e) => log::debug!("could not remove {}: {e}", path.display()),
        }
    }
}

/// A downloaded Performa installer, e.g. `performa_0.4.0_x64-setup.exe` — or
/// the `performa_0.4.0_x64-setup (1).exe` a browser writes for a re-download.
fn is_installer(name: &str) -> bool {
    let name = name.to_lowercase();
    name.starts_with("performa") && name.contains("x64-setup") && name.ends_with(".exe")
}

/// The updater plugin's scratch directory: `performa-0.4.0-updater-<rand>`.
fn is_updater_scratch(name: &str) -> bool {
    let name = name.to_lowercase();
    name.starts_with("performa-") && name.contains("-updater-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installer_names() {
        assert!(is_installer("performa_0.4.0_x64-setup.exe"));
        assert!(is_installer("Performa_0.4.0_x64-setup (1).exe"));
        assert!(!is_installer("performa_0.4.0_x64_en-US.msi"));
        assert!(!is_installer("other_0.4.0_x64-setup.exe"));
        assert!(!is_installer("performa-logs"));
    }

    #[test]
    fn scratch_dir_names() {
        assert!(is_updater_scratch("performa-0.4.0-updater-Ab12Cd"));
        assert!(!is_updater_scratch("performa-logs"));
    }

    #[test]
    fn sweeps_only_matching_entries() {
        let dir = std::env::temp_dir().join("performa-cleanup-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let hit = dir.join("performa_9.9.9_x64-setup.exe");
        let miss = dir.join("holiday-photo.exe");
        fs::write(&hit, b"").unwrap();
        fs::write(&miss, b"").unwrap();

        sweep_dir(&dir, is_installer);

        assert!(!hit.exists());
        assert!(miss.exists());
        let _ = fs::remove_dir_all(&dir);
    }
}

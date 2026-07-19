//! System tray (macOS menu bar): shows the running timer as a ticking
//! `▶ KEY h:mm:ss` title next to the icon (tooltip elsewhere) and offers
//! stop/open/quit. Timer state is owned by the webview and mirrored here via
//! the `timer_started` / `timer_stopped` commands.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Emitter, Manager, State, Wry,
};

pub struct TrayTimer {
    stop_item: MenuItem<Wry>,
    /// Ticker task updating the tray title while a timer runs.
    task: tokio::sync::Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

pub fn setup(app: &App) -> tauri::Result<()> {
    let stop = MenuItem::with_id(app, "stop-timer", "Stop timer…", false, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open performa", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit performa", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &stop,
            &PredefinedMenuItem::separator(app)?,
            &open,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "stop-timer" => {
                // The webview owns the timer; it reacts by opening the log modal.
                show_main(app);
                let _ = app.emit("stop-timer", ());
            }
            "open" => show_main(app),
            "quit" => quit_via_close(app),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;

    app.manage(TrayTimer {
        stop_item: stop,
        task: tokio::sync::Mutex::new(None),
    });
    Ok(())
}

/// Mirror a started timer: enable "Stop timer" and tick the tray title.
#[tauri::command]
pub async fn timer_started(
    app: AppHandle,
    state: State<'_, TrayTimer>,
    issue_key: String,
    started_at: i64,
) -> Result<(), String> {
    if !crate::jira::is_issue_key(&issue_key) {
        return Err(format!("invalid issue key '{issue_key}'"));
    }
    let _ = state.stop_item.set_enabled(true);
    let mut task = state.task.lock().await;
    if let Some(t) = task.take() {
        t.abort();
    }
    *task = Some(tauri::async_runtime::spawn(async move {
        loop {
            let elapsed = ((now_ms() - started_at) / 1000).max(0);
            set_tray_text(&app, Some(format!("▶ {issue_key} {}", clock(elapsed))));
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    }));
    Ok(())
}

/// Mirror a stopped timer: clear the tray title and disable "Stop timer".
#[tauri::command]
pub async fn timer_stopped(app: AppHandle, state: State<'_, TrayTimer>) -> Result<(), String> {
    let _ = state.stop_item.set_enabled(false);
    if let Some(t) = state.task.lock().await.take() {
        t.abort();
    }
    set_tray_text(&app, None);
    Ok(())
}

/// Title on macOS (text beside the icon), tooltip on the other platforms.
fn set_tray_text(app: &AppHandle, text: Option<String>) {
    if let Some(tray) = app.tray_by_id("main") {
        if cfg!(target_os = "macos") {
            let _ = tray.set_title(text);
        } else {
            let _ = tray.set_tooltip(text);
        }
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// `m:ss`, or `h:mm:ss` past an hour — mirrors `formatClock` in the webview.
fn clock(total_seconds: i64) -> String {
    let h = total_seconds / 3600;
    let m = (total_seconds % 3600) / 60;
    let s = total_seconds % 60;
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m:02}:{s:02}")
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Quit by closing the window (not exiting the process) so the webview's
/// CloseGuard can still intercept when a timer runs or unlogged work pends.
fn quit_via_close(app: &AppHandle) {
    match app.get_webview_window("main") {
        Some(w) => {
            show_main(app);
            let _ = w.close();
        }
        None => app.exit(0),
    }
}

#[cfg(test)]
mod tests {
    use super::clock;

    #[test]
    fn clock_formats() {
        assert_eq!(clock(0), "00:00");
        assert_eq!(clock(95), "01:35");
        assert_eq!(clock(3600), "1:00:00");
        assert_eq!(clock(3725), "1:02:05");
    }
}

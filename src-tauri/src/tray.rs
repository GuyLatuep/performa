//! System tray (macOS menu bar): shows the running timer as a ticking
//! `▶ KEY h:mm:ss` title next to the icon (tooltip elsewhere) and offers
//! pause-or-resume/stop/open/quit. A paused timer shows its frozen time as `⏸ KEY h:mm:ss`.
//! Timer state is owned by the webview and mirrored here via the
//! `timer_started` / `timer_paused` / `timer_stopped` commands.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Emitter, Manager, State, Wry,
};

const PAUSE_LABEL: &str = "Pause timer";
const RESUME_LABEL: &str = "Resume timer";

pub struct TrayTimer {
    stop_item: MenuItem<Wry>,
    /// Reads "Pause timer" or "Resume timer", whichever the timer allows.
    pause_item: MenuItem<Wry>,
    /// Ticker task updating the tray title while a timer runs.
    task: tokio::sync::Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

pub fn setup(app: &App) -> tauri::Result<()> {
    let pause = MenuItem::with_id(app, "pause-timer", PAUSE_LABEL, false, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop-timer", "Stop timer…", false, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open performa", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit performa", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &pause,
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
            // No window needed: the webview flips the timer, and the tray
            // title follows through `timer_paused` / `timer_started`.
            "pause-timer" => {
                let _ = app.emit("toggle-pause-timer", ());
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
        pause_item: pause,
        task: tokio::sync::Mutex::new(None),
    });
    Ok(())
}

/// Mirror a started (or resumed) timer: enable "Pause timer" and "Stop timer"
/// and tick the tray title.
#[tauri::command]
pub async fn timer_started(
    app: AppHandle,
    state: State<'_, TrayTimer>,
    issue_key: Option<String>,
    started_at: i64,
) -> Result<(), String> {
    let label = timer_label(issue_key)?;
    let _ = state.stop_item.set_enabled(true);
    let _ = state.pause_item.set_enabled(true);
    let _ = state.pause_item.set_text(PAUSE_LABEL);
    let mut task = state.task.lock().await;
    if let Some(t) = task.take() {
        t.abort();
    }
    *task = Some(tauri::async_runtime::spawn(async move {
        loop {
            let now = now_ms();
            let elapsed = ((now - started_at) / 1000).max(0);
            set_tray_text(&app, Some(format!("▶ {label} {}", clock(elapsed))));
            // Sleep to the moment the count next changes, not a flat second:
            // redrawing the title takes time, so a fixed interval wakes a
            // little later each round until the title skips a second. The
            // webview's `useElapsedSeconds` aims at the same boundaries, which
            // is what keeps the two clocks reading the same value.
            tokio::time::sleep(std::time::Duration::from_millis(
                ms_to_next_second(now, started_at) as u64,
            ))
            .await;
        }
    }));
    Ok(())
}

/// Mirror a paused timer: stop ticking and show the frozen time. "Stop timer"
/// stays enabled — paused time is still tracked time waiting to be logged.
#[tauri::command]
pub async fn timer_paused(
    app: AppHandle,
    state: State<'_, TrayTimer>,
    issue_key: Option<String>,
    elapsed_seconds: i64,
) -> Result<(), String> {
    let label = timer_label(issue_key)?;
    let _ = state.stop_item.set_enabled(true);
    let _ = state.pause_item.set_enabled(true);
    let _ = state.pause_item.set_text(RESUME_LABEL);
    if let Some(t) = state.task.lock().await.take() {
        t.abort();
    }
    set_tray_text(&app, Some(paused_title(&label, elapsed_seconds)));
    Ok(())
}

fn paused_title(label: &str, elapsed_seconds: i64) -> String {
    format!("⏸ {label} {}", clock(elapsed_seconds.max(0)))
}

/// What the tray calls the timer: its issue key, or "No ticket" for one
/// started before its ticket exists. The key is checked, since it ends up in
/// the menu bar verbatim.
fn timer_label(issue_key: Option<String>) -> Result<String, String> {
    match issue_key {
        None => Ok("No ticket".to_string()),
        Some(key) if crate::jira::is_issue_key(&key) => Ok(key),
        Some(key) => Err(format!("invalid issue key '{key}'")),
    }
}

/// Mirror a stopped timer: clear the tray title and disable both timer items.
#[tauri::command]
pub async fn timer_stopped(app: AppHandle, state: State<'_, TrayTimer>) -> Result<(), String> {
    let _ = state.stop_item.set_enabled(false);
    let _ = state.pause_item.set_enabled(false);
    let _ = state.pause_item.set_text(PAUSE_LABEL);
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

/// Milliseconds until the elapsed second count changes — mirrors
/// `msToNextSecond` in the webview. A `started_at` in the future (a clock
/// correction mid-timer) waits out the difference instead of going negative.
fn ms_to_next_second(now: i64, started_at: i64) -> i64 {
    let elapsed = now - started_at;
    if elapsed < 0 {
        -elapsed
    } else {
        1000 - elapsed % 1000
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
    use super::{clock, ms_to_next_second, paused_title, timer_label};

    #[test]
    fn a_timer_without_a_ticket_says_so() {
        assert_eq!(timer_label(None).unwrap(), "No ticket");
        assert_eq!(timer_label(Some("ABC-1".into())).unwrap(), "ABC-1");
        assert!(timer_label(Some("not a key".into())).is_err());
    }

    #[test]
    fn a_paused_timer_shows_its_frozen_time() {
        assert_eq!(paused_title("ABC-1", 95), "⏸ ABC-1 01:35");
        assert_eq!(paused_title("ABC-1", 3725), "⏸ ABC-1 1:02:05");
        // A clock correction must not print a negative clock.
        assert_eq!(paused_title("ABC-1", -4), "⏸ ABC-1 00:00");
    }

    #[test]
    fn clock_formats() {
        assert_eq!(clock(0), "00:00");
        assert_eq!(clock(95), "01:35");
        assert_eq!(clock(3600), "1:00:00");
        assert_eq!(clock(3725), "1:02:05");
    }

    // The tray title and the webview's timer bar are read at the same moment,
    // side by side, so the second they disagree is a bug the user sees. The
    // format changes shape here, which is where a drift between the two would
    // start: `formatClock` in `src/timer.ts` asserts the same pair, and its
    // "matches the Rust tray formatter" test is the other half of this one.
    #[test]
    fn the_shape_changes_only_once_the_hour_is_full() {
        assert_eq!(clock(3599), "59:59");
        assert_eq!(clock(3600), "1:00:00");
        // Minutes stay padded past the hour; the hour itself does not.
        assert_eq!(clock(3661), "1:01:01");
        assert_eq!(clock(36_000), "10:00:00");
    }

    #[test]
    fn sleeps_only_up_to_the_next_second_boundary() {
        // Woken mid-second: wait out the remainder, not a full second.
        assert_eq!(ms_to_next_second(1_400, 0), 600);
        assert_eq!(ms_to_next_second(1_999, 0), 1);
        // Exactly on a boundary: the count just changed, so the next one is a
        // whole second away.
        assert_eq!(ms_to_next_second(2_000, 0), 1000);
        // The offset is measured against the timer's own start, not the epoch.
        assert_eq!(ms_to_next_second(5_250, 4_000), 750);
        // The timer's very first tick, before any time has passed at all.
        assert_eq!(ms_to_next_second(0, 0), 1000);
    }

    // `timer_started` sleeps this long inside a bare `loop`, so the bounds are
    // not cosmetic: a zero would spin that loop hot for as long as the timer
    // runs, and anything past a second would let the tray title skip one. The
    // webview's own ticker asserts the same invariant over the same spread.
    #[test]
    fn the_sleep_stays_inside_one_second_however_long_the_timer_has_run() {
        for elapsed in [0, 1, 999, 1_000, 60_000, 3_600_500, 86_400_123] {
            let delay = ms_to_next_second(elapsed, 0);
            assert!(delay > 0, "elapsed {elapsed} would spin the ticker");
            assert!(delay <= 1000, "elapsed {elapsed} would skip a second");
        }
    }

    #[test]
    fn a_start_in_the_future_waits_rather_than_going_negative() {
        // A clock correction can leave `started_at` ahead of now; a negative
        // sleep would be cast to a nonsense u64.
        assert_eq!(ms_to_next_second(0, 3_000), 3_000);
        assert!(ms_to_next_second(0, 3_000) > 0);
    }
}

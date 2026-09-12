//! Horizontal swipe navigation on macOS.
//!
//! The obvious way to offer "go back" to a mouse is the fourth button, and the
//! webview does deliver that as a `mousedown` with `button === 3`. But a good
//! many Macs never produce one: Logitech's Options+ (and Razer's and
//! SteerMouse's equivalents) claim the thumb buttons and emit an
//! `NSEventTypeSwipe` instead, which is a gesture rather than a button and
//! reaches no webview event at all. The same event is what a two-finger swipe
//! on a trackpad produces — the standard macOS way back, which performa had no
//! answer to either.
//!
//! So it is caught here, where the events still exist, and handed to the
//! webview as an ordinary Tauri event. The front end already knows what "back"
//! means (see `src/back.ts`); this only has to say when.

#[cfg(target_os = "macos")]
pub use macos::watch;

/// Emitted on a swipe towards the right, or a mouse's back button where the
/// driver has made one of these out of it.
pub const NAVIGATE_BACK: &str = "navigate-back";
/// The same, the other way.
pub const NAVIGATE_FORWARD: &str = "navigate-forward";

/// Nothing to do off macOS: Windows delivers the thumb buttons to the webview
/// as the plain `button === 3` the front end already listens for.
#[cfg(not(target_os = "macos"))]
pub fn watch(_app: &tauri::AppHandle) {}

#[cfg(target_os = "macos")]
mod macos {
    use super::{NAVIGATE_BACK, NAVIGATE_FORWARD};
    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask};
    use std::ptr::NonNull;
    use tauri::{AppHandle, Emitter};

    /// A swipe carries ±1 along the axis it went, and a 0 on the way out of the
    /// gesture. Comparing against a half rather than against zero keeps the
    /// trailing 0 — and any stray diagonal — from counting as a direction.
    const THRESHOLD: f64 = 0.5;

    /// Start watching for horizontal swipes, forwarding each as a Tauri event.
    ///
    /// A *local* monitor, so this only ever fires while performa is the active
    /// app — a swipe meant for the browser in front must not quietly move the
    /// app behind it. The monitor returns the event untouched: it is being
    /// observed, not consumed, and swallowing it would break anything else that
    /// wanted the same gesture.
    pub fn watch(app: &AppHandle) {
        let app = app.clone();
        let handler = RcBlock::new(move |event: NonNull<NSEvent>| {
            // Safe: AppKit hands the monitor a live event for the duration of
            // the call, and it is only read here.
            let delta_x = unsafe { event.as_ref().deltaX() };
            if delta_x > THRESHOLD {
                let _ = app.emit(NAVIGATE_BACK, ());
            } else if delta_x < -THRESHOLD {
                let _ = app.emit(NAVIGATE_FORWARD, ());
            }
            event.as_ptr()
        });

        // Safe: the block matches the signature AppKit calls it with, and it
        // owns everything it touches.
        let monitor = unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::Swipe, &handler)
        };

        // The monitor lives as long as the app does, and removing it at exit
        // would mean holding it somewhere only to drop it as the process dies.
        std::mem::forget(monitor);
    }
}

//! The two readings behind the webview's idle watch: how long the machine has
//! gone without input — keyboard, mouse, trackpad — and how long it has spent
//! asleep. The webview decides what an away stretch was; this only reports.
//!
//! Sleep is its own reading because nothing else can tell it apart from a
//! throttled poller. A hidden webview's timers may be held back for minutes
//! (App Nap) while the user works on in another app — a long gap between two
//! readings proves nothing. The OS keeps two clocks that differ by exactly the
//! time asleep, though, and throttling never adds to that.
//!
//! Plain FFI rather than another crate: each platform has one call for each,
//! all stable for decades.

use serde::Serialize;

#[derive(Serialize)]
pub struct IdleReading {
    /// Seconds since the last input event, system-wide. Zero where the
    /// platform offers no reading — which the webview reads as "never idle",
    /// so the watch never fires rather than firing wrongly.
    #[serde(rename = "idleSeconds")]
    idle_seconds: f64,
    /// Milliseconds spent asleep since boot. Only its change between two
    /// readings means anything.
    #[serde(rename = "asleepMs")]
    asleep_ms: f64,
}

#[tauri::command]
pub fn idle_reading() -> IdleReading {
    IdleReading {
        idle_seconds: platform::idle_seconds().max(0.0),
        asleep_ms: platform::asleep_ms().max(0.0),
    }
}

#[cfg(target_os = "macos")]
mod platform {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
    }

    extern "C" {
        fn clock_gettime_nsec_np(clock_id: u32) -> u64;
    }

    /// Keeps counting while the machine sleeps.
    const CLOCK_MONOTONIC_RAW: u32 = 4;
    /// The same clock, stopped while it sleeps.
    const CLOCK_UPTIME_RAW: u32 = 8;

    pub fn asleep_ms() -> f64 {
        // SAFETY: a pure query with one integer argument.
        let (with_sleep, without) = unsafe {
            (
                clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW),
                clock_gettime_nsec_np(CLOCK_UPTIME_RAW),
            )
        };
        with_sleep.saturating_sub(without) as f64 / 1e6
    }

    /// `kCGEventSourceStateCombinedSessionState`: input from every source in
    /// the login session, not just this process.
    const COMBINED_SESSION_STATE: i32 = 0;
    /// `kCGAnyInputEventType`.
    const ANY_INPUT_EVENT: u32 = u32::MAX;

    pub fn idle_seconds() -> f64 {
        // SAFETY: a pure query with two plain integer arguments; no pointers
        // cross the boundary.
        unsafe { CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION_STATE, ANY_INPUT_EVENT) }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    #[repr(C)]
    struct LastInputInfo {
        cb_size: u32,
        dw_time: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetTickCount() -> u32;
        fn GetTickCount64() -> u64;
        fn QueryUnbiasedInterruptTime(unbiased_time: *mut u64) -> i32;
    }

    pub fn asleep_ms() -> f64 {
        let mut unbiased: u64 = 0;
        // SAFETY: `unbiased` is a valid, writable u64 for the call's duration.
        let ok = unsafe { QueryUnbiasedInterruptTime(&mut unbiased) };
        if ok == 0 {
            return 0.0;
        }
        // Milliseconds since boot, sleep included, against the same with sleep
        // left out (in 100 ns units).
        // SAFETY: no arguments, no pointers.
        let with_sleep = unsafe { GetTickCount64() };
        with_sleep.saturating_sub(unbiased / 10_000) as f64
    }

    pub fn idle_seconds() -> f64 {
        let mut info = LastInputInfo {
            cb_size: std::mem::size_of::<LastInputInfo>() as u32,
            dw_time: 0,
        };
        // SAFETY: `info` is a properly sized, initialised LASTINPUTINFO that
        // outlives the call; `cbSize` is set as the API requires.
        let ok = unsafe { GetLastInputInfo(&mut info) };
        if ok == 0 {
            return 0.0;
        }
        // SAFETY: no arguments, no pointers.
        let now = unsafe { GetTickCount() };
        // Both are milliseconds since boot in a u32 that wraps every ~49.7
        // days; the wrapping difference is still the right elapsed time.
        now.wrapping_sub(info.dw_time) as f64 / 1000.0
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    pub fn idle_seconds() -> f64 {
        0.0
    }

    pub fn asleep_ms() -> f64 {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::idle_reading;

    #[test]
    fn reads_finite_non_negative_values() {
        let r = idle_reading();
        assert!(r.idle_seconds.is_finite() && r.idle_seconds >= 0.0);
        assert!(r.asleep_ms.is_finite() && r.asleep_ms >= 0.0);
    }

    #[test]
    fn time_asleep_never_runs_backwards() {
        let a = idle_reading().asleep_ms;
        let b = idle_reading().asleep_ms;
        // Two reads a moment apart; the clocks are read separately, so allow
        // for a sliver of jitter between them.
        assert!(b + 1.0 >= a, "{b} < {a}");
    }
}

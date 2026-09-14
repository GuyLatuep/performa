//! Jira's timestamp spellings, in and out.
//!
//! Jira writes `2026-07-16T10:30:00.000+0200` and takes the same shape back;
//! the app works in epoch seconds and RFC3339. Everything that converts
//! between the two is here, so no caller carries a format string.

use chrono::{Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone};

/// Build a Jira `started` timestamp (`yyyy-MM-ddThh:mm:ss.SSSZ`, offset without
/// a colon) for the given local date (yyyy-MM-dd) and time (HH:mm).
pub(super) fn jira_started(date: &str, time: &str) -> Result<String, String> {
    let d = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| format!("invalid date '{date}', expected yyyy-MM-dd"))?;
    let t = NaiveTime::parse_from_str(time, "%H:%M")
        .map_err(|_| format!("invalid time '{time}', expected HH:mm"))?;
    let naive = NaiveDateTime::new(d, t);
    let dt = Local
        .from_local_datetime(&naive)
        .earliest()
        .ok_or_else(|| "invalid local time".to_string())?;
    Ok(dt.format("%Y-%m-%dT%H:%M:%S%.3f%z").to_string())
}

/// Parse a Jira timestamp (`2026-07-16T10:30:00.000+0200`) into epoch seconds.
pub(super) fn parse_jira_ts(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.3f%z")
        .ok()
        .map(|dt| dt.timestamp())
}

/// Epoch seconds as an RFC3339 string in the local timezone.
pub(super) fn format_rfc3339_local(ts: i64) -> String {
    Local
        .timestamp_opt(ts, 0)
        .single()
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default()
}

/// Epoch-millis at the start of `date`, used to narrow the worklog query.
pub(super) fn started_after_millis(date: &str) -> String {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .and_then(|naive| Local.from_local_datetime(&naive).single())
        .map(|dt| (dt.timestamp_millis() - 86_400_000).to_string())
        .unwrap_or_else(|| "0".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jira_started_validates_input() {
        assert!(jira_started("2026-07-16", "09:30").is_ok());
        assert!(jira_started("16.07.2026", "09:30").is_err());
        assert!(jira_started("2026-07-16", "9:75").is_err());
    }

    #[test]
    fn jira_ts_roundtrip() {
        let ts = parse_jira_ts("2026-07-16T10:30:00.000+0200").unwrap();
        assert_eq!(ts, 1784190600);
        assert!(parse_jira_ts("not a date").is_none());
    }
}

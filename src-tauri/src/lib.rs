mod creds;
mod jira;
mod logging;
mod tray;

use creds::{Credentials, CredentialsMeta};
use jira::{IssueSummary, JiraClient, MissingWorklog, Myself, WorklogEntry};
use tauri::State;

// Tuning for the missing-worklog reminder: how far back to look for own
// activity, how close a worklog must be to that activity to count, and how
// long freshly created activity is left unflagged.
const MISSING_LOOKBACK_DAYS: u32 = 1;
const MISSING_WINDOW_SECS: i64 = 3 * 3600;
const MISSING_GRACE_SECS: i64 = 10 * 60;
// Issues from this project log their time on the issue they are linked to
// with this link description (fallback: the issue itself).
const MISSING_ESCALATION_PROJECT: &str = "DEV";
const MISSING_ESCALATION_LINK: &str = "is an escalation for";
// Different projects use different workflows, so rather than list every
// project's "fully closed" status name, we allow-list the terminal statuses
// that still accept worklogs; every other statusCategory=Done status (e.g.
// "Geschlossen", "Closed", ...) is treated as no longer bookable.
const MISSING_BOOKABLE_DONE_STATUSES: &[&str] = &["Gelöst", "Resolved"];

// Status an issue is moved to when a timer starts on it (best-effort — see
// `start_issue_work`).
const TIMER_START_STATUS: &str = "In Arbeit";

/// Client + account id, built once from the stored credentials and cached so
/// commands neither re-read the keychain nor re-fetch `myself` on every call.
#[derive(Clone)]
struct Session {
    client: JiraClient,
    account_id: String,
}

#[derive(Default)]
struct AppState {
    session: tokio::sync::Mutex<Option<Session>>,
}

/// The cached session, or build (and cache) one from the stored credentials.
async fn session(state: &State<'_, AppState>) -> Result<Session, String> {
    let mut guard = state.session.lock().await;
    if let Some(s) = guard.as_ref() {
        return Ok(s.clone());
    }
    let creds = creds::load()?.ok_or_else(|| "not configured".to_string())?;
    let client = JiraClient::new(&creds);
    let me = client.myself().await?;
    let s = Session {
        client,
        account_id: me.account_id,
    };
    *guard = Some(s.clone());
    Ok(s)
}

// ----- Input validation at the IPC boundary -----
// The webview is untrusted by design (the token lives only in this process),
// so identifiers coming over IPC are validated before they reach a URL or JQL.

fn checked_issue_key(key: &str) -> Result<&str, String> {
    if jira::is_issue_key(key) {
        Ok(key)
    } else {
        Err(format!("invalid issue key '{key}'"))
    }
}

fn checked_worklog_id(id: &str) -> Result<&str, String> {
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
        Ok(id)
    } else {
        Err(format!("invalid worklog id '{id}'"))
    }
}

fn checked_date(s: &str) -> Result<&str, String> {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .map_err(|_| format!("invalid date '{s}', expected yyyy-MM-dd"))?;
    Ok(s)
}

/// Validate the given credentials against Jira and, if valid, persist them.
#[tauri::command]
async fn save_credentials(
    state: State<'_, AppState>,
    site: String,
    email: String,
    token: String,
) -> Result<Myself, String> {
    let site = normalize_site(&site);
    // An empty token means "keep the stored one" — the settings screen doesn't
    // force re-entering the key just to change site/email.
    let token = match token.trim() {
        "" => {
            creds::load()?
                .ok_or_else(|| "API token required".to_string())?
                .token
        }
        t => t.to_string(),
    };
    let creds = Credentials {
        site,
        email: email.trim().to_string(),
        token,
    };
    let client = JiraClient::new(&creds);
    let me = client.myself().await?;
    creds::save(&creds)?;
    *state.session.lock().await = Some(Session {
        client,
        account_id: me.account_id.clone(),
    });
    Ok(me)
}

/// Non-secret metadata about the stored credentials, or `null` if unset.
#[tauri::command]
fn credentials_status() -> Result<Option<CredentialsMeta>, String> {
    Ok(creds::load()?.as_ref().map(CredentialsMeta::from))
}

#[tauri::command]
async fn clear_credentials(state: State<'_, AppState>) -> Result<(), String> {
    *state.session.lock().await = None;
    creds::clear()
}

#[tauri::command]
async fn current_user(state: State<'_, AppState>) -> Result<Myself, String> {
    session(&state).await?.client.myself().await
}

/// Free-form issue search. The query is turned into JQL here — the webview
/// never supplies raw JQL.
#[tauri::command]
async fn search_issues(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<IssueSummary>, String> {
    let s = session(&state).await?;
    s.client
        .search_issues(&jira::build_search_jql(&query), 50)
        .await
}

/// Issues assigned to the current user with a due date between 7 days ago and
/// 14 days ahead (shown on the start tab).
#[tauri::command]
async fn due_issues(state: State<'_, AppState>) -> Result<Vec<IssueSummary>, String> {
    let s = session(&state).await?;
    s.client.due_issues().await
}

/// Move an issue to `TIMER_START_STATUS` when a timer starts on it. A no-op,
/// not an error, when the workflow has no direct transition there (e.g. the
/// issue is already in that status) — starting a timer must never fail just
/// because the status couldn't be nudged.
#[tauri::command]
async fn start_issue_work(state: State<'_, AppState>, issue_key: String) -> Result<(), String> {
    checked_issue_key(&issue_key)?;
    let s = session(&state).await?;
    s.client
        .transition_to_status(&issue_key, TIMER_START_STATUS)
        .await
}

#[tauri::command]
async fn log_work(
    state: State<'_, AppState>,
    issue_key: String,
    time_spent_seconds: i64,
    date: String,
    time: String,
    comment: String,
    billable: bool,
) -> Result<(), String> {
    checked_issue_key(&issue_key)?;
    let s = session(&state).await?;
    s.client
        .add_worklog(
            &issue_key,
            time_spent_seconds,
            &date,
            &time,
            &comment,
            billable,
        )
        .await
}

#[tauri::command]
async fn update_worklog(
    state: State<'_, AppState>,
    issue_key: String,
    worklog_id: String,
    time_spent_seconds: i64,
    date: String,
    time: String,
    comment: String,
    billable: bool,
) -> Result<(), String> {
    checked_issue_key(&issue_key)?;
    checked_worklog_id(&worklog_id)?;
    let s = session(&state).await?;
    s.client
        .update_worklog(
            &issue_key,
            &worklog_id,
            time_spent_seconds,
            &date,
            &time,
            &comment,
            billable,
        )
        .await
}

#[tauri::command]
async fn delete_worklog(
    state: State<'_, AppState>,
    issue_key: String,
    worklog_id: String,
) -> Result<(), String> {
    checked_issue_key(&issue_key)?;
    checked_worklog_id(&worklog_id)?;
    let s = session(&state).await?;
    s.client.delete_worklog(&issue_key, &worklog_id).await
}

#[tauri::command]
async fn list_worklogs(
    state: State<'_, AppState>,
    start: String,
    end: String,
) -> Result<Vec<WorklogEntry>, String> {
    checked_date(&start)?;
    checked_date(&end)?;
    let s = session(&state).await?;
    s.client.my_worklogs(&s.account_id, &start, &end).await
}

/// The current user's worklogs on one issue (shown on the log-work screen).
#[tauri::command]
async fn issue_worklogs(
    state: State<'_, AppState>,
    issue_key: String,
) -> Result<Vec<WorklogEntry>, String> {
    checked_issue_key(&issue_key)?;
    let s = session(&state).await?;
    s.client.my_issue_worklogs(&s.account_id, &issue_key).await
}

/// Issues with recent own activity (comment / status change) that have no
/// nearby worklog — the data behind the "Missing worklog" tab.
#[tauri::command]
async fn missing_worklogs(state: State<'_, AppState>) -> Result<Vec<MissingWorklog>, String> {
    let s = session(&state).await?;
    s.client
        .missing_worklogs(
            &s.account_id,
            MISSING_LOOKBACK_DAYS,
            MISSING_WINDOW_SECS,
            MISSING_GRACE_SECS,
            MISSING_ESCALATION_PROJECT,
            MISSING_ESCALATION_LINK,
            MISSING_BOOKABLE_DONE_STATUSES,
        )
        .await
}

/// Change the active log-file verbosity (Settings → Logging).
#[tauri::command]
fn set_log_level(level: String) -> Result<(), String> {
    logging::set_level(&level)
}

/// Reveal the folder holding the rotated debug log files in Finder/Explorer.
#[tauri::command]
fn open_log_folder() -> Result<(), String> {
    open::that(logging::log_dir()).map_err(|e| format!("could not open log folder: {e}"))
}

/// Append a line from the frontend (webview `console.error`-style catches)
/// to the same debug log, so both sides land in one place.
#[tauri::command]
fn frontend_log(level: String, message: String) {
    match level.to_lowercase().as_str() {
        "error" => log::error!("{message}"),
        "warn" | "warning" => log::warn!("{message}"),
        "info" => log::info!("{message}"),
        _ => log::debug!("{message}"),
    }
}

/// Normalize a user-entered site into `https://host` with no trailing slash.
fn normalize_site(input: &str) -> String {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .setup(|app| {
            if let Err(e) = logging::init() {
                eprintln!("logging::init failed: {e}");
            }
            tray::setup(app)?;
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            save_credentials,
            credentials_status,
            clear_credentials,
            current_user,
            search_issues,
            due_issues,
            start_issue_work,
            log_work,
            update_worklog,
            delete_worklog,
            list_worklogs,
            issue_worklogs,
            missing_worklogs,
            tray::timer_started,
            tray::timer_stopped,
            set_log_level,
            open_log_folder,
            frontend_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn site_normalization() {
        assert_eq!(normalize_site(" my.atlassian.net/ "), "https://my.atlassian.net");
        assert_eq!(normalize_site("https://x.example.com"), "https://x.example.com");
        assert_eq!(normalize_site("http://local.test"), "http://local.test");
    }

    #[test]
    fn ipc_input_checks() {
        assert!(checked_issue_key("ABC-12").is_ok());
        assert!(checked_issue_key("ABC-12/transitions").is_err());
        assert!(checked_issue_key("../secret").is_err());
        assert!(checked_worklog_id("10023").is_ok());
        assert!(checked_worklog_id("10023?x=1").is_err());
        assert!(checked_worklog_id("").is_err());
        assert!(checked_date("2026-07-16").is_ok());
        assert!(checked_date("2026-07-16\" OR project = X").is_err());
    }
}

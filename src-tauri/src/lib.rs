mod creds;
mod jira;
mod update;

use creds::{Credentials, CredentialsMeta};
use jira::{IssueSummary, JiraClient, MissingWorklog, Myself, WorklogEntry};

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

/// Build a client from stored credentials, or fail if the app isn't set up yet.
fn client() -> Result<JiraClient, String> {
    let creds = creds::load()?.ok_or_else(|| "not configured".to_string())?;
    Ok(JiraClient::new(&creds))
}

/// Validate the given credentials against Jira and, if valid, persist them.
#[tauri::command]
async fn save_credentials(site: String, email: String, token: String) -> Result<Myself, String> {
    let site = normalize_site(&site);
    let creds = Credentials {
        site,
        email: email.trim().to_string(),
        token: token.trim().to_string(),
    };
    let me = JiraClient::new(&creds).myself().await?;
    creds::save(&creds)?;
    Ok(me)
}

/// Non-secret metadata about the stored credentials, or `null` if unset.
#[tauri::command]
fn credentials_status() -> Result<Option<CredentialsMeta>, String> {
    Ok(creds::load()?.as_ref().map(CredentialsMeta::from))
}

#[tauri::command]
fn clear_credentials() -> Result<(), String> {
    creds::clear()
}

#[tauri::command]
async fn current_user() -> Result<Myself, String> {
    client()?.myself().await
}

#[tauri::command]
async fn search_issues(jql: String) -> Result<Vec<IssueSummary>, String> {
    client()?.search_issues(&jql, 50).await
}

#[tauri::command]
async fn log_work(
    issue_key: String,
    time_spent_seconds: i64,
    date: String,
    time: String,
    comment: String,
) -> Result<(), String> {
    client()?
        .add_worklog(&issue_key, time_spent_seconds, &date, &time, &comment)
        .await
}

#[tauri::command]
async fn update_worklog(
    issue_key: String,
    worklog_id: String,
    time_spent_seconds: i64,
    date: String,
    time: String,
    comment: String,
) -> Result<(), String> {
    client()?
        .update_worklog(
            &issue_key,
            &worklog_id,
            time_spent_seconds,
            &date,
            &time,
            &comment,
        )
        .await
}

#[tauri::command]
async fn delete_worklog(issue_key: String, worklog_id: String) -> Result<(), String> {
    client()?.delete_worklog(&issue_key, &worklog_id).await
}

#[tauri::command]
async fn list_worklogs(start: String, end: String) -> Result<Vec<WorklogEntry>, String> {
    let client = client()?;
    let me = client.myself().await?;
    client.my_worklogs(&me.account_id, &start, &end).await
}

/// The current user's worklogs on one issue (shown on the log-work screen).
#[tauri::command]
async fn issue_worklogs(issue_key: String) -> Result<Vec<WorklogEntry>, String> {
    let client = client()?;
    let me = client.myself().await?;
    client.my_issue_worklogs(&me.account_id, &issue_key).await
}

/// Issues with recent own activity (comment / status change) that have no
/// nearby worklog — the data behind the "Missing worklog" tab.
#[tauri::command]
async fn missing_worklogs() -> Result<Vec<MissingWorklog>, String> {
    let client = client()?;
    let me = client.myself().await?;
    client
        .missing_worklogs(
            &me.account_id,
            MISSING_LOOKBACK_DAYS,
            MISSING_WINDOW_SECS,
            MISSING_GRACE_SECS,
            MISSING_ESCALATION_PROJECT,
            MISSING_ESCALATION_LINK,
        )
        .await
}

/// Compare the running version against the latest GitHub release.
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<update::UpdateInfo, String> {
    update::check(&app.package_info().version.to_string()).await
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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_credentials,
            credentials_status,
            clear_credentials,
            current_user,
            search_issues,
            log_work,
            update_worklog,
            delete_worklog,
            list_worklogs,
            issue_worklogs,
            missing_worklogs,
            check_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

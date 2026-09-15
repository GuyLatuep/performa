mod checked;
mod cleanup;
mod creds;
mod gestures;
mod jira;
mod logging;
mod session;
mod tray;

use creds::{Credentials, CredentialsMeta};
use jira::{
    FieldMeta, IssueActivity, IssueDetail, IssueSummary, JiraClient, JiraUser, LinkRelation,
    MentionRef, MentionScan, MissingConfig, MissingWorklog, Myself, ProjectSummary, TodoConfig,
    Transition, WorklogEntry, WorklogInput,
};
use session::{AppState, Session};
use std::collections::BTreeMap;

use tauri::{Manager, State};
use tauri_plugin_window_state::{StateFlags, WindowExt};

// What the window remembers between launches. Deliberately not VISIBLE or
// DECORATIONS: a window that happened to be hidden at exit would come back
// hidden, with only the tray left to get it open again.
const WINDOW_STATE_FLAGS: StateFlags = StateFlags::POSITION
    .union(StateFlags::SIZE)
    .union(StateFlags::MAXIMIZED)
    .union(StateFlags::FULLSCREEN);

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

// How far the mentions inbox looks back. Two weeks covers the stretch a
// mention stays actionable without making the candidate scan expensive.
const MENTIONS_LOOKBACK_DAYS: u32 = 14;

// Status an issue is moved to when a timer starts on it (best-effort — see
// `start_issue_work`).
const TIMER_START_STATUS: &str = "In Arbeit";

// Generous enough for any genuine frontend log line (the longest are search
// labels carrying the user's query), short enough to bound the file.
const MAX_FRONTEND_LOG_CHARS: usize = 1000;

// Where downloaded attachments land. Beside the debug logs rather than in the
// user's Downloads folder: these are opened once and forgotten, and the app
// sweeps them at launch (see `cleanup`). A file the user wants to keep is
// theirs to save from whatever opened it.
fn attachment_dir() -> std::path::PathBuf {
    std::env::temp_dir().join("performa-attachments")
}

/// Validate the given credentials against Jira and, if valid, persist them.
#[tauri::command]
async fn save_credentials(
    state: State<'_, AppState>,
    site: String,
    email: String,
    token: String,
) -> Result<Myself, String> {
    let site = checked::site(&site)?;
    let email = email.trim().to_string();
    // An empty token means "keep the stored one" — the settings screen doesn't
    // force re-entering the key just to change site/email. That reuse is only
    // safe as long as the connection the token belongs to is unchanged: with a
    // different site, the very first call (`myself` below) would hand the
    // secret to a host it was never issued for. A mistyped site is enough to
    // trigger that, and it is exactly what a compromised webview would ask for.
    let token = match token.trim() {
        "" => {
            let stored = creds::load()?.ok_or_else(|| "API token required".to_string())?;
            if !checked::may_reuse_token(&stored, &site, &email) {
                return Err(
                    "API token required to connect to a different site or account".to_string(),
                );
            }
            stored.token
        }
        t => t.to_string(),
    };
    let creds = Credentials { site, email, token };
    let client = JiraClient::new(&creds);
    let me = client.myself().await?;
    creds::save(&creds)?;
    state.sign_in(Session::new(client, &me)).await;
    Ok(me)
}

/// Non-secret metadata about the stored credentials, or `null` if unset.
#[tauri::command]
fn credentials_status() -> Result<Option<CredentialsMeta>, String> {
    Ok(creds::load()?.as_ref().map(CredentialsMeta::from))
}

#[tauri::command]
async fn clear_credentials(state: State<'_, AppState>) -> Result<(), String> {
    state.sign_out().await;
    creds::clear()
}

#[tauri::command]
async fn current_user(state: State<'_, AppState>) -> Result<Myself, String> {
    state.session().await?.client.myself().await
}

/// Free-form issue search. The query is turned into JQL here — the webview
/// never supplies raw JQL.
#[tauri::command]
async fn search_issues(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<IssueSummary>, String> {
    let s = state.session().await?;
    s.client
        .search_issues(&jira::build_search_jql(&query), 50)
        .await
}

/// What a palette search found, and whether that was all of it.
///
/// A struct rather than a bare pair: this crosses to the webview, where a tuple
/// arrives as `[rows, true]` and every reader has to remember which end is
/// which.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResults {
    issues: Vec<IssueSummary>,
    /// Jira had more than the page we asked for. The view says so rather than
    /// letting a full page read as a complete answer.
    has_more: bool,
}

impl From<(Vec<IssueSummary>, bool)> for SearchResults {
    fn from((issues, has_more): (Vec<IssueSummary>, bool)) -> Self {
        Self { issues, has_more }
    }
}

/// The command palette's plain text search: the term in any field Jira will
/// search. The JQL is built here, as all of it is.
#[tauri::command]
async fn search_text(state: State<'_, AppState>, term: String) -> Result<SearchResults, String> {
    let term = checked::search_term(&term)?;
    if term.is_empty() {
        return Ok((Vec::new(), false).into());
    }
    let s = state.session().await?;
    Ok(s.client
        .search_issues_rows(&jira::build_text_jql(term))
        .await?
        .into())
}

/// One of the user's own searches, written as JQL with a placeholder for the
/// term.
///
/// The one command that runs JQL the webview supplies. That is safe to allow
/// because the query is the signed-in user's own, run with their own account,
/// against a read-only endpoint — nothing it can say reaches further than
/// Jira's search already lets them. The term is the part that is not theirs to
/// have written, so it is escaped into the query here.
#[tauri::command]
async fn search_jql(
    state: State<'_, AppState>,
    jql: String,
    term: String,
) -> Result<SearchResults, String> {
    let term = checked::search_term(&term)?;
    if term.is_empty() {
        return Ok((Vec::new(), false).into());
    }
    let jql = jira::fill_search_template(checked::search_jql(&jql)?, term)?;
    log::info!("saved search: jql = {jql}");
    let s = state.session().await?;
    Ok(s.client.search_issues_rows(&jql).await?.into())
}

/// Issues assigned to the current user with a due date between 7 days ago and
/// 14 days ahead (shown on the start tab).
#[tauri::command]
async fn due_issues(state: State<'_, AppState>) -> Result<Vec<IssueSummary>, String> {
    let s = state.session().await?;
    s.client.due_issues().await
}

/// Issues waiting on the current user: escalations they raised, plus
/// everything assigned to them, minus anything already done or in one of the
/// statuses they chose to ignore (shown on the todo tab).
///
/// `ignored_statuses` comes from the webview rather than a constant here:
/// every Jira workflow names its "somebody else's move" states differently,
/// so the list is a setting the user fills from their own site.
#[tauri::command]
async fn todo_issues(
    state: State<'_, AppState>,
    ignored_statuses: BTreeMap<String, Vec<String>>,
) -> Result<Vec<IssueSummary>, String> {
    let s = state.session().await?;
    // Opening the todo tab is the step before opening an issue from it, so
    // this is where the field catalog gets fetched — off to the side, while
    // the user is still reading the list, rather than in front of the first
    // issue view. Detached and best-effort: the list must not wait on it, and
    // `issue_detail` fetches it itself if this hasn't landed yet.
    let client = s.client.clone();
    tauri::async_runtime::spawn(async move { client.warm_field_catalog().await });
    s.client.todo_issues(&todo_config(ignored_statuses)).await
}

/// The projects the user can see — the scope picker behind the ignored-status
/// setting.
#[tauri::command]
async fn jira_projects(state: State<'_, AppState>) -> Result<Vec<ProjectSummary>, String> {
    let s = state.session().await?;
    s.client.projects().await
}

/// The still-open status names one project's workflows use. Done-category
/// statuses aren't offered: the todo query drops those anyway.
#[tauri::command]
async fn project_statuses(
    state: State<'_, AppState>,
    project_key: String,
) -> Result<Vec<String>, String> {
    checked::project_key(&project_key)?;
    let s = state.session().await?;
    s.client.project_open_statuses(&project_key).await
}

/// The todo-tab rules, alongside `missing_config`. Only the escalation project
/// is still shipped as a constant; the statuses come from settings.
fn todo_config(ignored_statuses: BTreeMap<String, Vec<String>>) -> TodoConfig {
    TodoConfig {
        author_project: MISSING_ESCALATION_PROJECT.to_string(),
        ignored_statuses: checked::ignored_statuses(ignored_statuses),
    }
}

/// Move an issue to `TIMER_START_STATUS` when a timer starts on it. A no-op,
/// not an error, when the workflow has no direct transition there (e.g. the
/// issue is already in that status) — starting a timer must never fail just
/// because the status couldn't be nudged.
#[tauri::command]
async fn start_issue_work(state: State<'_, AppState>, issue_key: String) -> Result<(), String> {
    checked::issue_key(&issue_key)?;
    let s = state.session().await?;
    s.client
        .transition_to_status(&issue_key, TIMER_START_STATUS)
        .await
}

#[tauri::command]
async fn log_work(
    state: State<'_, AppState>,
    issue_key: String,
    worklog: WorklogInput,
) -> Result<(), String> {
    checked::issue_key(&issue_key)?;
    let s = state.session().await?;
    s.client.add_worklog(&issue_key, &worklog).await
}

#[tauri::command]
async fn update_worklog(
    state: State<'_, AppState>,
    issue_key: String,
    worklog_id: String,
    worklog: WorklogInput,
) -> Result<(), String> {
    checked::issue_key(&issue_key)?;
    checked::jira_id("worklog", &worklog_id)?;
    let s = state.session().await?;
    s.client
        .update_worklog(&issue_key, &worklog_id, &worklog)
        .await
}

#[tauri::command]
async fn delete_worklog(
    state: State<'_, AppState>,
    issue_key: String,
    worklog_id: String,
) -> Result<(), String> {
    checked::issue_key(&issue_key)?;
    checked::jira_id("worklog", &worklog_id)?;
    let s = state.session().await?;
    s.client.delete_worklog(&issue_key, &worklog_id).await
}

#[tauri::command]
async fn list_worklogs(
    state: State<'_, AppState>,
    start: String,
    end: String,
) -> Result<Vec<WorklogEntry>, String> {
    checked::date(&start)?;
    checked::date(&end)?;
    let s = state.session().await?;
    s.client.my_worklogs(&s.account_id, &start, &end).await
}

/// The current user's worklogs on one issue (shown on the log-work screen).
#[tauri::command]
async fn issue_worklogs(
    state: State<'_, AppState>,
    issue_key: String,
) -> Result<Vec<WorklogEntry>, String> {
    checked::issue_key(&issue_key)?;
    let s = state.session().await?;
    s.client.my_issue_worklogs(&s.account_id, &issue_key).await
}

/// One issue as the in-app issue view shows it: the standard fields plus
/// whichever of `DETAIL_FIELD_NAMES` this site actually has.
#[tauri::command]
async fn issue_detail(
    state: State<'_, AppState>,
    issue_key: String,
    field_names: Vec<String>,
) -> Result<IssueDetail, String> {
    checked::issue_key(&issue_key)?;
    let names = checked::field_names(field_names)?;
    let wanted: Vec<&str> = names.iter().map(String::as_str).collect();
    let s = state.session().await?;
    s.client.issue_detail(&issue_key, &wanted).await
}

/// Every field name this Jira site defines — what the settings screen offers
/// so the configured names are picked rather than typed.
#[tauri::command]
async fn jira_field_names(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let s = state.session().await?;
    s.client.field_names().await
}

/// The fields this issue's edit form offers, in the same shape a transition
/// screen uses.
#[tauri::command]
async fn issue_edit_fields(
    state: State<'_, AppState>,
    issue_key: String,
) -> Result<Vec<FieldMeta>, String> {
    checked::issue_key(&issue_key)?;
    let s = state.session().await?;
    s.client.issue_edit_fields(&issue_key).await
}

/// Write field values back to the issue. Shaped by the webview, like a
/// transition screen's answers, and passed through for the same reason.
#[tauri::command]
async fn update_issue_fields(
    state: State<'_, AppState>,
    issue_key: String,
    fields: serde_json::Value,
) -> Result<(), String> {
    checked::issue_key(&issue_key)?;
    let s = state.session().await?;
    s.client.update_issue_fields(&issue_key, fields).await
}

/// That issue's history: comments, status changes and worklogs, each in its
/// own list for the webview to interleave.
#[tauri::command]
async fn issue_activity(
    state: State<'_, AppState>,
    issue_key: String,
) -> Result<IssueActivity, String> {
    checked::issue_key(&issue_key)?;
    let s = state.session().await?;
    s.client.issue_activity(&issue_key).await
}

/// Post a comment on an issue.
///
/// `public` is only meaningful on a service-desk request, where it decides
/// whether the customer sees the comment (a customer reply) or only the people
/// working the issue do (an internal note). Elsewhere Jira ignores it and the
/// comment is as visible as the issue itself — which is why the webview offers
/// no choice there rather than offering one that does nothing.
#[tauri::command]
async fn add_issue_comment(
    state: State<'_, AppState>,
    issue_key: String,
    text: String,
    public: bool,
    mentions: Vec<MentionRef>,
) -> Result<(), String> {
    checked::issue_key(&issue_key)?;
    let text = checked::comment_text(&text)?;
    let s = state.session().await?;
    s.client
        .add_comment(&issue_key, text, public, &mentions)
        .await
}

/// People matching `query`, for the comment box's mention picker.
#[tauri::command]
async fn search_users(state: State<'_, AppState>, query: String) -> Result<Vec<JiraUser>, String> {
    let Some(query) = checked::user_query(&query) else {
        return Ok(Vec::new());
    };
    let s = state.session().await?;
    s.client.search_users(query).await
}

/// The workflow moves available from this issue's current status, each with
/// the fields it insists on. A transition that names any is not runnable from
/// here yet — the view says so rather than offering a button that 400s.
#[tauri::command]
async fn issue_transitions(
    state: State<'_, AppState>,
    issue_key: String,
) -> Result<Vec<Transition>, String> {
    checked::issue_key(&issue_key)?;
    let s = state.session().await?;
    s.client.issue_transitions(&issue_key).await
}

/// Run one of them. Unlike the timer's status nudge, a failure here is the
/// user's to see: they pressed the button.
///
/// `fields` carries a transition screen's answers when the move has one. It
/// arrives already shaped for Jira — the webview knows the field types, this
/// layer does not — and is passed through rather than re-validated here: Jira
/// is the authority on what its own screen accepts, and its rejection carries
/// a better message than a guess made here would.
#[tauri::command]
async fn transition_issue(
    state: State<'_, AppState>,
    issue_key: String,
    transition_id: String,
    fields: Option<serde_json::Value>,
) -> Result<(), String> {
    checked::issue_key(&issue_key)?;
    checked::jira_id("transition", &transition_id)?;
    let s = state.session().await?;
    s.client
        .transition_issue(&issue_key, &transition_id, fields)
        .await
}

/// Download one attachment and hand it to whatever the OS opens it with.
///
/// The bytes travel through this process because that is where the credentials
/// live — the webview never sees a Jira URL it could fetch itself.
#[tauri::command]
async fn open_attachment(
    state: State<'_, AppState>,
    attachment_id: String,
    filename: String,
) -> Result<(), String> {
    checked::jira_id("attachment", &attachment_id)?;
    let filename = checked::filename(&filename)?;
    let s = state.session().await?;
    let path = s
        .client
        .download_attachment(&attachment_id, &filename, &attachment_dir())
        .await?;
    open::that(&path).map_err(|e| format!("could not open {}: {e}", path.display()))
}

/// One issue type's icon as a `data:` URL, for the icon cell on an issue row.
///
/// The URL is the one Jira put on the issue; the client checks it belongs to
/// the configured site before fetching it with the credentials.
#[tauri::command]
async fn issue_type_icon(state: State<'_, AppState>, url: String) -> Result<String, String> {
    let s = state.session().await?;
    s.client.issue_type_icon(&url).await
}

/// Remove an attachment from its issue. Irreversible in Jira, and visible to
/// everyone on the issue — the view asks before calling this.
#[tauri::command]
async fn delete_attachment(
    state: State<'_, AppState>,
    attachment_id: String,
) -> Result<(), String> {
    checked::jira_id("attachment", &attachment_id)?;
    let s = state.session().await?;
    s.client.delete_attachment(&attachment_id).await
}

/// Reveal the folder the downloads land in, for the file the user wants to
/// keep rather than glance at.
#[tauri::command]
fn open_attachment_folder() -> Result<(), String> {
    let dir = attachment_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create the download folder: {e}"))?;
    open::that(&dir).map_err(|e| format!("could not open the download folder: {e}"))
}

/// Attach files to an issue. The paths come from a file picker or a drop onto
/// the window, both of which are the user naming a file themselves.
#[tauri::command]
async fn attach_files(
    state: State<'_, AppState>,
    issue_key: String,
    paths: Vec<String>,
) -> Result<(), String> {
    checked::issue_key(&issue_key)?;
    if paths.is_empty() {
        return Err("no files to attach".to_string());
    }
    let s = state.session().await?;
    // One at a time, and stop at the first failure: a half-finished batch is
    // easier to reason about when the user can see which file it stopped on.
    for path in paths {
        s.client
            .upload_attachment(&issue_key, std::path::Path::new(&path))
            .await
            // Jira's message names no file, and with several in flight the
            // banner would otherwise say which error but not which file — nor
            // which of them did get through.
            .map_err(|e| {
                let name = std::path::Path::new(&path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(path.as_str());
                format!("{name}: {e}")
            })?;
    }
    Ok(())
}

/// Every relationship a link can be created with on this site, both halves of
/// each link type. Reference data, read once per app run by the webview.
#[tauri::command]
async fn link_relations(state: State<'_, AppState>) -> Result<Vec<LinkRelation>, String> {
    let s = state.session().await?;
    s.client.link_relations().await
}

/// Link two issues. `direction` names which half of `type_name` the user
/// picked, read from `issue_key`'s side — see `jira::links`.
#[tauri::command]
async fn link_issues(
    state: State<'_, AppState>,
    issue_key: String,
    other_key: String,
    type_name: String,
    direction: String,
) -> Result<(), String> {
    let type_name = checked::link(&issue_key, &other_key, &type_name, &direction)?;
    let s = state.session().await?;
    s.client
        .link_issues(&issue_key, &other_key, type_name, &direction)
        .await
}

/// Remove one link. Only the link goes — both issues stay as they are.
#[tauri::command]
async fn delete_issue_link(state: State<'_, AppState>, link_id: String) -> Result<(), String> {
    checked::jira_id("link", &link_id)?;
    let s = state.session().await?;
    s.client.delete_issue_link(&link_id).await
}

/// Issues with recent own activity (comment / status change) that have no
/// nearby worklog — the data behind the "Missing worklog" tab.
#[tauri::command]
async fn missing_worklogs(state: State<'_, AppState>) -> Result<Vec<MissingWorklog>, String> {
    let s = state.session().await?;
    s.client
        .missing_worklogs(&s.account_id, &missing_config())
        .await
}

/// Comments from the last two weeks that tag the current user — the data
/// behind the "Mentions" tab.
#[tauri::command]
async fn mentions(state: State<'_, AppState>) -> Result<MentionScan, String> {
    let s = state.session().await?;
    s.client
        .mentions(&s.account_id, &s.display_name, MENTIONS_LOOKBACK_DAYS)
        .await
}

/// The shipped missing-worklog tuning. A single place to swap for
/// user-configurable values once the workflow specifics move into settings.
fn missing_config() -> MissingConfig {
    MissingConfig {
        lookback_days: MISSING_LOOKBACK_DAYS,
        window_secs: MISSING_WINDOW_SECS,
        grace_secs: MISSING_GRACE_SECS,
        escalation_project: MISSING_ESCALATION_PROJECT.to_string(),
        escalation_link: MISSING_ESCALATION_LINK.to_string(),
        bookable_done_statuses: MISSING_BOOKABLE_DONE_STATUSES
            .iter()
            .map(|s| s.to_string())
            .collect(),
    }
}

/// Change the active log-file verbosity (Settings → Logging).
#[tauri::command]
fn set_log_level(level: String) -> Result<(), String> {
    logging::set_level(&level)
}

/// Reveal the folder holding the rotated debug log files in Finder/Explorer.
#[tauri::command]
fn open_log_folder() -> Result<(), String> {
    // The log file is buffered (see `logging::FileLogger`), and this command
    // exists so the user can go and *read* it — handing them a file missing
    // its last few lines would defeat the point.
    log::logger().flush();
    open::that(logging::log_dir()).map_err(|e| format!("could not open log folder: {e}"))
}

/// Append a line from the frontend (webview `console.error`-style catches)
/// to the same debug log, so both sides land in one place.
///
/// The message is folded to one bounded line first — it arrives from the
/// untrusted webview, which could otherwise forge extra log entries with
/// embedded newlines or flood the file with a single call.
#[tauri::command]
fn frontend_log(level: String, message: String) {
    let message = logging::one_line(&message, MAX_FRONTEND_LOG_CHARS);
    match level.to_lowercase().as_str() {
        "error" => log::error!("{message}"),
        "warn" | "warning" => log::warn!("{message}"),
        "info" => log::info!("{message}"),
        _ => log::debug!("{message}"),
    }
}

/// Show `count` on the app's badge, or clear it with `None`.
///
/// The dock badge is the indication that survives the window being behind
/// something else, which is the whole point: an in-window badge only helps
/// somebody already looking at the window.
///
/// Platform support is uneven — macOS puts it on the dock icon, and the other
/// platforms either ignore it or want an overlay icon instead — so a failure
/// here is logged and swallowed. A badge that cannot be drawn is not a reason
/// to fail the call that asked for it.
#[tauri::command]
fn set_badge(window: tauri::Window, count: Option<i64>) {
    if let Err(err) = window.set_badge_count(count) {
        log::debug!("set_badge_count({count:?}) failed: {err}");
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
            cleanup::sweep_update_leftovers(app);
            // Before the window exists: the monitor is app-wide, not per
            // window, and a swipe cannot arrive until there is something to
            // swipe at anyway.
            gestures::watch(app.handle());
            cleanup::sweep_downloaded_attachments(&attachment_dir());
            tray::setup(app)?;
            // The window is created hidden (`"visible": false` in
            // tauri.conf.json) and only shown once it sits where the user left
            // it — otherwise it appears at the size from the config and is
            // then visibly resized. Both steps are best-effort, but `show`
            // runs regardless: a failed restore must never leave the app
            // without a window.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.restore_state(WINDOW_STATE_FLAGS); // no-op on first run
                let _ = w.show();
            }
            Ok(())
        })
        // Remember how the window was left (size, position, maximized,
        // fullscreen) and restore it on the next launch; the width/height in
        // tauri.conf.json only apply until there is saved state.
        //
        // `skip_initial_state` turns off the plugin's *own* restore — it runs
        // from `on_window_ready`, which Tauri dispatches through
        // `run_on_main_thread`, so it lands an event-loop turn after the
        // window is already on screen and the move is visible. Restoring by
        // hand above (before the window is shown) is what avoids that; saving,
        // the state cache and the window listeners still come from the plugin.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(WINDOW_STATE_FLAGS)
                .skip_initial_state("main")
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
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
            search_text,
            search_jql,
            due_issues,
            todo_issues,
            jira_projects,
            project_statuses,
            start_issue_work,
            log_work,
            update_worklog,
            delete_worklog,
            list_worklogs,
            issue_worklogs,
            issue_detail,
            issue_activity,
            add_issue_comment,
            search_users,
            issue_transitions,
            transition_issue,
            jira_field_names,
            issue_edit_fields,
            update_issue_fields,
            open_attachment,
            issue_type_icon,
            open_attachment_folder,
            delete_attachment,
            attach_files,
            link_relations,
            link_issues,
            delete_issue_link,
            missing_worklogs,
            mentions,
            tray::timer_started,
            tray::timer_stopped,
            set_log_level,
            open_log_folder,
            frontend_log,
            set_badge,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        // `set_boxed_logger` leaks its box, so the buffered writer inside it is
        // never dropped and would take the tail of the log with it on a clean
        // exit. Flushing here is what keeps buffering an optimisation rather
        // than a way to lose the end of every session's log.
        .run(|_app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                log::logger().flush();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_todo_config_bounds_what_settings_can_push_into_the_jql() {
        let mut ignored = BTreeMap::new();
        ignored.insert("DEV".to_string(), vec!["Done".to_string()]);
        // Not a project key, so the whole entry goes.
        ignored.insert("../x".to_string(), vec!["Done".to_string()]);
        // A project that ends up ignoring nothing goes too.
        ignored.insert("OPS".to_string(), vec!["  ".to_string()]);

        let cfg = todo_config(ignored);

        assert_eq!(cfg.author_project, MISSING_ESCALATION_PROJECT);
        assert_eq!(cfg.ignored_statuses.len(), 1);
        assert_eq!(cfg.ignored_statuses["DEV"], ["Done"]);
    }

    // The one piece of `SearchResults` that exists only because serde was told
    // to rename it. The webview reads `hasMore` to decide whether to warn that
    // a full page is not the whole answer; without the rename the field crosses
    // as `has_more`, the view reads `undefined`, and every truncated search
    // silently reads as complete — the exact misreading the struct's own doc
    // comment says it exists to prevent.
    #[test]
    fn search_results_cross_to_the_webview_under_the_names_it_reads() {
        let json = serde_json::to_value(SearchResults::from((Vec::new(), true))).unwrap();

        assert_eq!(json["hasMore"], serde_json::json!(true));
        assert_eq!(json["issues"], serde_json::json!([]));
        assert!(json.get("has_more").is_none());
    }

    // Said out loud here because the omission is the decision: a window that
    // happened to be hidden at exit would come back hidden, leaving only the
    // tray to get it open again. Nothing else in the file would notice VISIBLE
    // being added to the set.
    #[test]
    fn the_window_does_not_remember_having_been_hidden() {
        assert!(!WINDOW_STATE_FLAGS.contains(StateFlags::VISIBLE));
        assert!(!WINDOW_STATE_FLAGS.contains(StateFlags::DECORATIONS));
        // What it does remember: where the window was, and how big.
        assert!(WINDOW_STATE_FLAGS.contains(StateFlags::POSITION));
        assert!(WINDOW_STATE_FLAGS.contains(StateFlags::SIZE));
    }

    #[test]
    fn fresh_activity_is_spared_for_less_time_than_a_worklog_reaches() {
        let cfg = missing_config();

        // The grace is how long new activity is left unflagged; the window is
        // how far a worklog reaches to cover activity. A grace wider than the
        // window would open a stretch that is neither too fresh to flag nor
        // near enough to any worklog to be cleared — a reminder nothing the
        // user does can answer.
        assert!(cfg.grace_secs < cfg.window_secs);
        assert!(cfg.lookback_days >= 1);
    }

    #[test]
    fn some_done_statuses_still_accept_worklogs() {
        let cfg = missing_config();

        // Not merely the shipped names: an *empty* list collapses
        // `missing::bookable_clause` to "not done at all", and the scan then
        // stops flagging anything resolved at all.
        assert_eq!(cfg.bookable_done_statuses, ["Gel\u{f6}st", "Resolved"]);
        assert_eq!(cfg.escalation_project, MISSING_ESCALATION_PROJECT);
        assert_eq!(cfg.escalation_link, MISSING_ESCALATION_LINK);
    }

    #[test]
    fn downloads_land_in_the_apps_own_scratch_folder() {
        // Beside the debug logs rather than in the user's Downloads: the app
        // sweeps these at launch, and sweeping Downloads would be a disaster.
        let dir = attachment_dir();

        assert!(dir.starts_with(std::env::temp_dir()));
        assert_eq!(dir.file_name().unwrap(), "performa-attachments");
    }
}

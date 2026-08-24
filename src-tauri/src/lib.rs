mod cleanup;
mod creds;
mod jira;
mod logging;
mod tray;

use creds::{Credentials, CredentialsMeta};
use jira::{
    FieldMeta, IssueActivity, IssueDetail, IssueSummary, JiraClient, JiraUser, LinkRelation,
    MentionRef, MentionScan, MissingConfig, MissingWorklog, Myself, ProjectSummary, TodoConfig,
    Transition, WorklogEntry, WorklogInput,
};
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

// Bounds on the todo tab's ignored-status list, which the webview supplies
// from local settings. Not a security boundary on its own (every name is still
// JQL-escaped) — just a cap on how much a corrupt settings entry can push into
// one query.
const MAX_IGNORED_PROJECTS: usize = 200;
const MAX_IGNORED_STATUSES: usize = 100;
const MAX_STATUS_NAME_CHARS: usize = 255;

// Status an issue is moved to when a timer starts on it (best-effort — see
// `start_issue_work`).
const TIMER_START_STATUS: &str = "In Arbeit";

// How many site-specific fields the issue view will ask for, and how long a
// field name may be. The names come from the webview now (they are a setting),
// and every one of them widens the issue request — so the bound is here rather
// than in the settings screen, which is only one of the ways they could
// arrive.
const MAX_DETAIL_FIELDS: usize = 30;
const MAX_FIELD_NAME_CHARS: usize = 100;

// Generous enough for any genuine frontend log line (the longest are search
// labels carrying the user's query), short enough to bound the file.
const MAX_FRONTEND_LOG_CHARS: usize = 1000;

// Jira rejects a comment body over 32767 characters with an unhelpful error.
// Refusing it here means the user is told what is wrong while their text is
// still in the box.
const MAX_COMMENT_CHARS: usize = 32_767;

// Where downloaded attachments land. Beside the debug logs rather than in the
// user's Downloads folder: these are opened once and forgotten, and the app
// sweeps them at launch (see `cleanup`). A file the user wants to keep is
// theirs to save from whatever opened it.
fn attachment_dir() -> std::path::PathBuf {
    std::env::temp_dir().join("performa-attachments")
}

/// Jira's attachment ids are its own numeric strings, and this one reaches a
/// URL path.
fn checked_attachment_id(id: &str) -> Result<&str, String> {
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
        Ok(id)
    } else {
        Err(format!("invalid attachment id '{id}'"))
    }
}

/// Link ids are Jira's own numeric strings and reach a URL path, like the
/// attachment ids above.
fn checked_link_id(id: &str) -> Result<&str, String> {
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
        Ok(id)
    } else {
        Err(format!("invalid link id '{id}'"))
    }
}

/// An attachment's name reaches the filesystem, so it must stay a *name*: no
/// separators, no parent-directory hops, nothing empty. Jira's own value is
/// normally fine; this is about what the webview could send instead.
fn checked_filename(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    let safe = !trimmed.is_empty()
        && trimmed.len() <= 200
        && !trimmed.contains(['/', '\\', '\0'])
        && trimmed != "."
        && trimmed != ".."
        && !trimmed.contains("..");
    if safe {
        Ok(trimmed.to_string())
    } else {
        Err(format!("unsafe attachment name '{name}'"))
    }
}

/// Client + account id, built once from the stored credentials and cached so
/// commands neither re-read the keychain nor re-fetch `myself` on every call.
#[derive(Clone)]
struct Session {
    client: JiraClient,
    account_id: String,
    /// How the user's mentions render in comment text — the mentions scan
    /// needs it to narrow its candidate search (see `jira::mentions`).
    display_name: String,
}

#[derive(Default)]
struct AppState {
    session: tokio::sync::Mutex<Option<Session>>,
}

/// The cached session, or build (and cache) one from the stored credentials.
///
/// The keychain read and the `myself` round-trip deliberately run *without*
/// the lock held. Holding it would make one command's session build block
/// every other command for the full 30s HTTP timeout, so an unreachable Jira
/// costs one stall per queued command instead of one overall — and the app
/// fires several commands at once on startup. The price is that commands
/// racing on a cold start may each fetch `myself` once; the first result to
/// land is kept and the rest reuse it.
async fn session(state: &State<'_, AppState>) -> Result<Session, String> {
    let cached = state.session.lock().await.clone();
    if let Some(s) = cached {
        return Ok(s);
    }
    let creds = creds::load()?.ok_or_else(|| "not configured".to_string())?;
    let client = JiraClient::new(&creds);
    let me = client.myself().await?;
    let mut guard = state.session.lock().await;
    Ok(guard
        .get_or_insert(Session {
            client,
            account_id: me.account_id,
            display_name: me.display_name,
        })
        .clone())
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

/// Project keys are interpolated into a URL path, so hold them to the shape
/// Jira actually allows.
fn checked_project_key(key: &str) -> Result<&str, String> {
    let mut chars = key.chars();
    let ok = key.len() >= 2
        && key.len() <= 20
        && matches!(chars.next(), Some(c) if c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_');
    if ok {
        Ok(key)
    } else {
        Err(format!("invalid project key '{key}'"))
    }
}

/// Bound what settings can push into the todo JQL: entries under a key that
/// isn't a project are dropped, as are projects that end up ignoring nothing,
/// and the number of projects is capped. Silently — a stale settings entry
/// must never break the tab.
fn checked_ignored_statuses(
    ignored: BTreeMap<String, Vec<String>>,
) -> BTreeMap<String, Vec<String>> {
    ignored
        .into_iter()
        .filter(|(project, _)| checked_project_key(project).is_ok())
        .map(|(project, names)| (project, checked_status_names(names)))
        .filter(|(_, names)| !names.is_empty())
        .take(MAX_IGNORED_PROJECTS)
        .collect()
}

/// Bound one project's list: blanks dropped, duplicates collapsed, over-long
/// names and an over-long list truncated. The names are JQL-escaped downstream
/// regardless — this only caps how much a corrupt entry can push into a query.
fn checked_status_names(names: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for name in names {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > MAX_STATUS_NAME_CHARS {
            continue;
        }
        if !out.iter().any(|kept| kept == name) {
            out.push(name.to_string());
        }
        if out.len() >= MAX_IGNORED_STATUSES {
            break;
        }
    }
    out
}

/// A comment body Jira will accept. Empty is a mis-click rather than a
/// request, and an over-long one is rejected by Jira after the round trip.
fn checked_comment_text(text: &str) -> Result<&str, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("a comment needs some text".to_string());
    }
    if trimmed.chars().count() > MAX_COMMENT_CHARS {
        return Err(format!(
            "comment is too long ({} characters; Jira allows {MAX_COMMENT_CHARS})",
            trimmed.chars().count()
        ));
    }
    Ok(trimmed)
}

/// The site-specific field names the issue view asks for. These are matched
/// against the site's own field catalog rather than interpolated anywhere, so
/// the check is about size, not shape: a very long list makes for a very wide
/// issue request.
fn checked_field_names(names: Vec<String>) -> Result<Vec<String>, String> {
    if names.len() > MAX_DETAIL_FIELDS {
        return Err(format!(
            "too many fields configured ({}; at most {MAX_DETAIL_FIELDS})",
            names.len()
        ));
    }
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for name in names {
        let name = name.trim().to_string();
        // Blank entries and repeats are settings-screen debris, not an error
        // worth refusing the whole view over.
        if name.is_empty() || name.chars().count() > MAX_FIELD_NAME_CHARS {
            continue;
        }
        if seen.insert(name.to_lowercase()) {
            out.push(name);
        }
    }
    Ok(out)
}

/// Transition ids are Jira's own numeric strings and reach a request body, so
/// hold them to that shape rather than passing the webview's word along.
fn checked_transition_id(id: &str) -> Result<&str, String> {
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
        Ok(id)
    } else {
        Err(format!("invalid transition id '{id}'"))
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
    let site = normalize_site(&site)?;
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
            if !may_reuse_token(&stored, &site, &email) {
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
    *state.session.lock().await = Some(Session {
        client,
        account_id: me.account_id.clone(),
        display_name: me.display_name.clone(),
    });
    Ok(me)
}

/// May the stored token be sent to this site/account without re-entering it?
/// Only when both are unchanged — host and address compare case-insensitively,
/// since neither DNS nor Jira's account addresses distinguish case.
fn may_reuse_token(stored: &Credentials, site: &str, email: &str) -> bool {
    stored.site.eq_ignore_ascii_case(site) && stored.email.eq_ignore_ascii_case(email)
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
    let s = session(&state).await?;
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
    let s = session(&state).await?;
    s.client.projects().await
}

/// The still-open status names one project's workflows use. Done-category
/// statuses aren't offered: the todo query drops those anyway.
#[tauri::command]
async fn project_statuses(
    state: State<'_, AppState>,
    project_key: String,
) -> Result<Vec<String>, String> {
    checked_project_key(&project_key)?;
    let s = session(&state).await?;
    s.client.project_open_statuses(&project_key).await
}

/// The todo-tab rules, alongside `missing_config`. Only the escalation project
/// is still shipped as a constant; the statuses come from settings.
fn todo_config(ignored_statuses: BTreeMap<String, Vec<String>>) -> TodoConfig {
    TodoConfig {
        author_project: MISSING_ESCALATION_PROJECT.to_string(),
        ignored_statuses: checked_ignored_statuses(ignored_statuses),
    }
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
    worklog: WorklogInput,
) -> Result<(), String> {
    checked_issue_key(&issue_key)?;
    let s = session(&state).await?;
    s.client.add_worklog(&issue_key, &worklog).await
}

#[tauri::command]
async fn update_worklog(
    state: State<'_, AppState>,
    issue_key: String,
    worklog_id: String,
    worklog: WorklogInput,
) -> Result<(), String> {
    checked_issue_key(&issue_key)?;
    checked_worklog_id(&worklog_id)?;
    let s = session(&state).await?;
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

/// One issue as the in-app issue view shows it: the standard fields plus
/// whichever of `DETAIL_FIELD_NAMES` this site actually has.
#[tauri::command]
async fn issue_detail(
    state: State<'_, AppState>,
    issue_key: String,
    field_names: Vec<String>,
) -> Result<IssueDetail, String> {
    checked_issue_key(&issue_key)?;
    let names = checked_field_names(field_names)?;
    let wanted: Vec<&str> = names.iter().map(String::as_str).collect();
    let s = session(&state).await?;
    s.client.issue_detail(&issue_key, &wanted).await
}

/// Every field name this Jira site defines — what the settings screen offers
/// so the configured names are picked rather than typed.
#[tauri::command]
async fn jira_field_names(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let s = session(&state).await?;
    s.client.field_names().await
}

/// The fields this issue's edit form offers, in the same shape a transition
/// screen uses.
#[tauri::command]
async fn issue_edit_fields(
    state: State<'_, AppState>,
    issue_key: String,
) -> Result<Vec<FieldMeta>, String> {
    checked_issue_key(&issue_key)?;
    let s = session(&state).await?;
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
    checked_issue_key(&issue_key)?;
    let s = session(&state).await?;
    s.client.update_issue_fields(&issue_key, fields).await
}

/// That issue's history: comments, status changes and worklogs, each in its
/// own list for the webview to interleave.
#[tauri::command]
async fn issue_activity(
    state: State<'_, AppState>,
    issue_key: String,
) -> Result<IssueActivity, String> {
    checked_issue_key(&issue_key)?;
    let s = session(&state).await?;
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
    checked_issue_key(&issue_key)?;
    let text = checked_comment_text(&text)?;
    let s = session(&state).await?;
    s.client
        .add_comment(&issue_key, text, public, &mentions)
        .await
}

/// People matching `query`, for the comment box's mention picker.
#[tauri::command]
async fn search_users(state: State<'_, AppState>, query: String) -> Result<Vec<JiraUser>, String> {
    let query = query.trim();
    // One character is enough for Jira and keeps the picker responsive from the
    // first keystroke; an empty query would ask it for everybody.
    if query.is_empty() || query.chars().count() > MAX_FIELD_NAME_CHARS {
        return Ok(Vec::new());
    }
    let s = session(&state).await?;
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
    checked_issue_key(&issue_key)?;
    let s = session(&state).await?;
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
    checked_issue_key(&issue_key)?;
    checked_transition_id(&transition_id)?;
    let s = session(&state).await?;
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
    checked_attachment_id(&attachment_id)?;
    let filename = checked_filename(&filename)?;
    let s = session(&state).await?;
    let path = s
        .client
        .download_attachment(&attachment_id, &filename, &attachment_dir())
        .await?;
    open::that(&path).map_err(|e| format!("could not open {}: {e}", path.display()))
}

/// Remove an attachment from its issue. Irreversible in Jira, and visible to
/// everyone on the issue — the view asks before calling this.
#[tauri::command]
async fn delete_attachment(
    state: State<'_, AppState>,
    attachment_id: String,
) -> Result<(), String> {
    checked_attachment_id(&attachment_id)?;
    let s = session(&state).await?;
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
    checked_issue_key(&issue_key)?;
    if paths.is_empty() {
        return Err("no files to attach".to_string());
    }
    let s = session(&state).await?;
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
    let s = session(&state).await?;
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
    checked_issue_key(&issue_key)?;
    checked_issue_key(&other_key)?;
    // Linking an issue to itself is a mis-click Jira answers with a 400; say
    // what happened instead of passing its wording on.
    if issue_key.eq_ignore_ascii_case(&other_key) {
        return Err("an issue cannot be linked to itself".to_string());
    }
    if direction != "inward" && direction != "outward" {
        return Err(format!("invalid link direction '{direction}'"));
    }
    let type_name = type_name.trim();
    if type_name.is_empty() {
        return Err("pick a relationship first".to_string());
    }
    let s = session(&state).await?;
    s.client
        .link_issues(&issue_key, &other_key, type_name, &direction)
        .await
}

/// Remove one link. Only the link goes — both issues stay as they are.
#[tauri::command]
async fn delete_issue_link(state: State<'_, AppState>, link_id: String) -> Result<(), String> {
    checked_link_id(&link_id)?;
    let s = session(&state).await?;
    s.client.delete_issue_link(&link_id).await
}

/// Issues with recent own activity (comment / status change) that have no
/// nearby worklog — the data behind the "Missing worklog" tab.
#[tauri::command]
async fn missing_worklogs(state: State<'_, AppState>) -> Result<Vec<MissingWorklog>, String> {
    let s = session(&state).await?;
    s.client
        .missing_worklogs(&s.account_id, &missing_config())
        .await
}

/// Comments from the last two weeks that tag the current user — the data
/// behind the "Mentions" tab.
#[tauri::command]
async fn mentions(state: State<'_, AppState>) -> Result<MentionScan, String> {
    let s = session(&state).await?;
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

/// Normalize a user-entered site into `https://host` with no trailing slash.
///
/// Plain `http` is refused: the API token rides along as a Basic-auth header
/// on every single request, so an unencrypted site would put it on the wire in
/// clear. Loopback is the one exception — that traffic never leaves the
/// machine, and it keeps a local test double usable.
fn normalize_site(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    // Split the scheme off before trimming slashes — otherwise a bare
    // "https://" would collapse into a "https:" hostname.
    let (scheme, host) = match trimmed.split_once("://") {
        None => ("https", trimmed),
        Some((scheme, rest)) => (scheme, rest),
    };
    let host = host.trim_end_matches('/');
    if host.is_empty() {
        return Err("Jira site required, e.g. your-team.atlassian.net".to_string());
    }
    if scheme.eq_ignore_ascii_case("http") && !is_loopback(host) {
        return Err(
            "refusing a plain http site: your API token is sent with every \
             request and would travel unencrypted — use https://"
                .to_string(),
        );
    }
    if !scheme.eq_ignore_ascii_case("https") && !scheme.eq_ignore_ascii_case("http") {
        return Err(format!("unsupported scheme '{scheme}://' — use https://"));
    }
    Ok(format!("{}://{host}", scheme.to_ascii_lowercase()))
}

/// Does this `host[:port][/path]` address the local machine?
fn is_loopback(host: &str) -> bool {
    let authority = host.split('/').next().unwrap_or("");
    let hostname = match authority.strip_prefix('[') {
        // Bracketed IPv6: `[::1]:8080` → `::1`
        Some(rest) => rest.split(']').next().unwrap_or(""),
        None => authority.split(':').next().unwrap_or(""),
    };
    matches!(hostname, "localhost" | "127.0.0.1" | "::1")
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comment_text_is_validated() {
        assert_eq!(checked_comment_text("  Pump stalled  "), Ok("Pump stalled"));
        // A mis-click, not a request.
        assert!(checked_comment_text("").is_err());
        assert!(checked_comment_text("   \n  ").is_err());
        // Counted in characters, not bytes: an umlaut is not two thirds of one.
        let umlauts = "ä".repeat(MAX_COMMENT_CHARS);
        assert!(checked_comment_text(&umlauts).is_ok());
        assert!(checked_comment_text(&"a".repeat(MAX_COMMENT_CHARS + 1)).is_err());
    }

    #[test]
    fn attachment_names_stay_file_names() {
        assert_eq!(checked_filename("  report.pdf "), Ok("report.pdf".into()));
        // The name reaches the filesystem, so a path must not survive in it.
        assert!(checked_filename("../../etc/passwd").is_err());
        assert!(checked_filename("a/b.txt").is_err());
        assert!(checked_filename("a\\b.txt").is_err());
        assert!(checked_filename("..").is_err());
        assert!(checked_filename("").is_err());
        assert!(checked_filename("   ").is_err());
        assert!(checked_filename(&"x".repeat(201)).is_err());
    }

    #[test]
    fn attachment_ids_are_validated() {
        assert!(checked_attachment_id("10042").is_ok());
        assert!(checked_attachment_id("").is_err());
        assert!(checked_attachment_id("../10042").is_err());
        assert!(checked_attachment_id("abc").is_err());
    }

    #[test]
    fn transition_ids_are_validated() {
        assert!(checked_transition_id("31").is_ok());
        assert!(checked_transition_id("").is_err());
        // The id reaches a request body; anything but Jira's own digits is a
        // webview that has been tampered with.
        assert!(checked_transition_id("31; drop").is_err());
        assert!(checked_transition_id("abc").is_err());
    }

    #[test]
    fn project_keys_are_validated() {
        assert!(checked_project_key("DEV").is_ok());
        assert!(checked_project_key("AB1").is_ok());
        assert!(checked_project_key("MY_PROJ").is_ok());
        // A key reaches a URL path, so path tricks must not survive.
        assert!(checked_project_key("").is_err());
        assert!(checked_project_key("A").is_err());
        assert!(checked_project_key("1DEV").is_err());
        assert!(checked_project_key("../secret").is_err());
        assert!(checked_project_key("DEV/statuses").is_err());
        assert!(checked_project_key("DEV%20").is_err());
    }

    #[test]
    fn ignored_projects_are_validated() {
        let map = |pairs: &[(&str, &[&str])]| -> BTreeMap<String, Vec<String>> {
            pairs
                .iter()
                .map(|(p, names)| (p.to_string(), names.iter().map(|s| s.to_string()).collect()))
                .collect()
        };
        let checked = checked_ignored_statuses(map(&[
            ("DEV", &["Backlog"]),
            // Not a project key — a settings entry can't smuggle one in.
            ("../secret", &["Backlog"]),
            // Nothing left to ignore, so no term is worth generating.
            ("OPS", &[]),
            ("SUP", &["   "]),
        ]));

        assert_eq!(checked.keys().collect::<Vec<_>>(), vec!["DEV"]);
    }

    #[test]
    fn ignored_status_names_are_bounded() {
        let owned =
            |names: &[&str]| -> Vec<String> { names.iter().map(|s| s.to_string()).collect() };
        assert_eq!(
            checked_status_names(owned(&["  Waiting  ", "", "   ", "Waiting"])),
            vec!["Waiting"],
        );
        // An over-long name is dropped, not truncated — a half-name would
        // silently filter on the wrong status.
        let long = "x".repeat(MAX_STATUS_NAME_CHARS + 1);
        assert!(checked_status_names(vec![long]).is_empty());

        let many: Vec<String> = (0..MAX_IGNORED_STATUSES + 20)
            .map(|i| format!("Status {i}"))
            .collect();
        assert_eq!(checked_status_names(many).len(), MAX_IGNORED_STATUSES);
    }

    #[test]
    fn site_normalization() {
        assert_eq!(
            normalize_site(" my.atlassian.net/ ").unwrap(),
            "https://my.atlassian.net"
        );
        assert_eq!(
            normalize_site("https://x.example.com").unwrap(),
            "https://x.example.com"
        );
        assert!(normalize_site("").is_err());
        assert!(normalize_site("https://").is_err());
    }

    #[test]
    fn site_must_be_encrypted_unless_loopback() {
        // The token travels as a Basic-auth header on every request.
        assert!(normalize_site("http://my.atlassian.net").is_err());
        assert!(normalize_site("http://evil.example/jira").is_err());
        assert!(normalize_site("ftp://my.atlassian.net").is_err());
        // Loopback never leaves the machine — kept usable for local doubles.
        assert_eq!(
            normalize_site("http://localhost:1234").unwrap(),
            "http://localhost:1234"
        );
        assert_eq!(
            normalize_site("http://127.0.0.1:1234/").unwrap(),
            "http://127.0.0.1:1234"
        );
        assert_eq!(
            normalize_site("http://[::1]:80").unwrap(),
            "http://[::1]:80"
        );
        // A loopback-lookalike hostname is a remote host like any other.
        assert!(normalize_site("http://localhost.evil.example").is_err());
        assert!(normalize_site("http://127.0.0.1.evil.example").is_err());
    }

    #[test]
    fn stored_token_is_reused_only_for_the_same_connection() {
        let stored = Credentials {
            site: "https://my.atlassian.net".to_string(),
            email: "me@example.com".to_string(),
            token: "secret".to_string(),
        };
        assert!(may_reuse_token(
            &stored,
            "https://my.atlassian.net",
            "me@example.com"
        ));
        // Case differences address the same host and account.
        assert!(may_reuse_token(
            &stored,
            "https://MY.atlassian.net",
            "Me@Example.com"
        ));
        // Anything else would send the token somewhere it was never issued for.
        assert!(!may_reuse_token(
            &stored,
            "https://evil.example",
            "me@example.com"
        ));
        assert!(!may_reuse_token(
            &stored,
            "https://my.atlassian.net.evil.example",
            "me@example.com"
        ));
        assert!(!may_reuse_token(
            &stored,
            "https://my.atlassian.net",
            "someone@else.com"
        ));
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

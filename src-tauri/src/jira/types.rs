//! Request and response types: the public ones exchanged with the frontend,
//! and the raw shapes used to deserialize Jira's API responses.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

// ----- Request types (deserialized from the frontend) -----

/// The editable fields of a worklog, as entered in the UI. Kept together so
/// they travel as one value from the IPC boundary down to the Jira call
/// instead of as a row of positional arguments.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorklogInput {
    pub time_spent_seconds: i64,
    /// Local start date, yyyy-MM-dd.
    pub date: String,
    /// Local start time, HH:mm.
    pub time: String,
    pub comment: String,
    /// When false, the `~` non-billable marker is prepended to the comment.
    pub billable: bool,
}

/// Which issues count as "waiting for me" on the todo tab. Two rules, OR'ed:
/// issues in `author_project` the user raised themselves, and issues assigned
/// to them anywhere. Both are narrowed by Jira's own `statusCategory != Done`
/// (which every workflow has, whatever it calls its statuses) plus the
/// statuses the user chose to ignore — the "open, but somebody else's move"
/// states Jira has no category for.
pub struct TodoConfig {
    /// Project the author rule applies to (the escalation project, "DEV").
    pub author_project: String,
    /// Ignored status names per project key. Per project because the same name
    /// can carry different weight in different workflows, and because the
    /// assignee rule spans every project the user works in. Sorted (it is a
    /// `BTreeMap`) so the generated JQL is stable, and already trimmed,
    /// deduped and bounded at the IPC boundary.
    pub ignored_statuses: BTreeMap<String, Vec<String>>,
}

/// Tuning for the missing-worklog heuristic: how far back to look for own
/// activity, how close a worklog must be to that activity to count, how long
/// freshly created activity is left unflagged, and the workflow specifics of
/// the Jira site in use.
pub struct MissingConfig {
    pub lookback_days: u32,
    pub window_secs: i64,
    pub grace_secs: i64,
    /// Issues from this project log their time on the issue they link to with
    /// `escalation_link` (fallback: the issue itself).
    pub escalation_project: String,
    pub escalation_link: String,
    /// Terminal statuses that still accept worklogs — every other
    /// statusCategory=Done status counts as no longer bookable.
    pub bookable_done_statuses: Vec<String>,
}

// ----- Public response types (serialized back to the frontend) -----

#[derive(Serialize, Deserialize, Clone)]
pub struct Myself {
    #[serde(rename = "accountId")]
    pub account_id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "emailAddress", default)]
    pub email_address: Option<String>,
}

#[derive(Serialize)]
pub struct IssueSummary {
    pub key: String,
    pub summary: String,
    /// Due date (yyyy-MM-dd); only populated by searches that request it.
    #[serde(rename = "dueDate", skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    /// When the issue was last touched; only populated by searches that
    /// request it (the missing-worklog scan, to skip unchanged issues).
    /// Backend-only — never sent to the frontend.
    #[serde(skip)]
    pub updated: Option<String>,
    /// Workflow status name; only populated by searches that request it
    /// (the todo tab, which shows what each issue is waiting on).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Priority name; only populated by searches that request it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
}

/// A project the user can see. Only the settings screen asks for these — it
/// uses the key to look up which statuses to offer.
#[derive(Serialize)]
pub struct ProjectSummary {
    pub key: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct WorklogEntry {
    pub id: String,
    #[serde(rename = "issueKey")]
    pub issue_key: String,
    #[serde(rename = "issueSummary")]
    pub issue_summary: String,
    #[serde(rename = "timeSpentSeconds")]
    pub time_spent_seconds: i64,
    /// Date portion (yyyy-MM-dd) of the worklog start.
    pub date: String,
    /// Time portion (HH:mm) of the worklog start.
    pub time: String,
    pub comment: String,
    /// False when the comment carries the `~` non-billable marker
    /// (ActivityTimeline's convention).
    pub billable: bool,
}

#[derive(Serialize)]
pub struct MissingWorklog {
    #[serde(rename = "issueKey")]
    pub issue_key: String,
    #[serde(rename = "issueSummary")]
    pub issue_summary: String,
    /// What the user did without logging time: "comment" or "status".
    pub kind: String,
    /// What that activity was: a comment excerpt, or "Old status → New
    /// status" — shown so the user remembers what they did.
    pub detail: String,
    /// RFC3339 timestamp of that activity.
    #[serde(rename = "activityAt")]
    pub activity_at: String,
    /// Issue the work should be logged on: the escalation source for issues
    /// from the escalation project, otherwise the issue itself.
    #[serde(rename = "logKey")]
    pub log_key: String,
    #[serde(rename = "logSummary")]
    pub log_summary: String,
}

/// The outcome of one mentions scan. Carries its own blind spots because the
/// scan cannot see every mention: it looks at a bounded number of candidate
/// issues, and it needs a display name to search comment text for. The inbox
/// says so rather than presenting a short list as the whole truth.
#[derive(Serialize, Clone)]
pub struct MentionScan {
    pub mentions: Vec<Mention>,
    /// A candidate search had a further page it never fetched, so there are
    /// issues this scan never opened.
    pub truncated: bool,
    /// The display-name net did not run at all (no display name on the
    /// account), so mentions on issues the user is not otherwise involved
    /// with cannot be found — a blind spot of a different shape from
    /// `truncated`, and one no amount of budget would close.
    #[serde(rename = "nameSearchSkipped")]
    pub name_search_skipped: bool,
}

/// One comment in which somebody tagged the current user — a row of the
/// mentions inbox.
#[derive(Serialize, Clone)]
pub struct Mention {
    #[serde(rename = "issueKey")]
    pub issue_key: String,
    #[serde(rename = "issueSummary")]
    pub issue_summary: String,
    /// Jira's id for the comment, so the row can link straight to it.
    #[serde(rename = "commentId")]
    pub comment_id: String,
    /// Display name of whoever wrote the comment.
    pub author: String,
    /// The comment text, collapsed to one bounded line.
    pub text: String,
    /// RFC3339 timestamp of the comment.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The same instant in epoch seconds. Backend-only: the lookback window
    /// moves with the clock, so cached mentions are re-judged against it
    /// without re-parsing `created_at`.
    #[serde(skip)]
    pub created_ts: i64,
}

// ----- Internal deserialization helpers -----

#[derive(Deserialize)]
pub struct SearchResp {
    pub issues: Vec<SearchIssue>,
    /// Set when the search has a further page. `/search/jql` is token
    /// paginated and may hand back fewer issues than `maxResults` while still
    /// having more to give, so this — not a full-looking page — is the only
    /// reliable "there is more" signal.
    #[serde(default, rename = "nextPageToken")]
    pub next_page_token: Option<String>,
}

#[derive(Deserialize)]
pub struct SearchIssue {
    pub key: String,
    pub fields: SearchFields,
}

#[derive(Deserialize)]
pub struct SearchFields {
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub duedate: Option<String>,
    #[serde(default)]
    pub updated: Option<String>,
    #[serde(default)]
    pub status: Option<NamedField>,
    #[serde(default)]
    pub priority: Option<NamedField>,
}

/// The shape Jira returns for the reference fields we only need the name of.
#[derive(Deserialize)]
pub struct NamedField {
    #[serde(default)]
    pub name: String,
}

/// One page of `/project/search`. Paged, so `is_last` decides whether to ask
/// for another.
#[derive(Deserialize)]
pub struct ProjectSearchResp {
    #[serde(default)]
    pub values: Vec<RawProject>,
    #[serde(rename = "isLast", default)]
    pub is_last: bool,
}

#[derive(Deserialize)]
pub struct RawProject {
    pub key: String,
    #[serde(default)]
    pub name: String,
}

/// `/project/{key}/statuses` answers per issue type, each carrying the full
/// status list for its own workflow — so the same status arrives once per type.
#[derive(Deserialize)]
pub struct RawIssueTypeStatuses {
    #[serde(default)]
    pub statuses: Vec<RawStatus>,
}

#[derive(Deserialize)]
pub struct RawStatus {
    #[serde(default)]
    pub name: String,
    #[serde(rename = "statusCategory", default)]
    pub status_category: Option<RawStatusCategory>,
}

#[derive(Deserialize)]
pub struct RawStatusCategory {
    /// Locale-independent: "new" | "indeterminate" | "done". The sibling
    /// `name` is translated, so only this may be compared against.
    #[serde(default)]
    pub key: String,
}

#[derive(Deserialize)]
pub struct TransitionsResp {
    #[serde(default)]
    pub transitions: Vec<RawTransition>,
}

#[derive(Deserialize)]
pub struct RawTransition {
    pub id: String,
    #[serde(default)]
    pub to: Option<TransitionTarget>,
}

#[derive(Deserialize)]
pub struct TransitionTarget {
    #[serde(default)]
    pub name: String,
}

#[derive(Deserialize)]
pub struct WorklogListResp {
    #[serde(default)]
    pub worklogs: Vec<RawWorklog>,
}

#[derive(Deserialize)]
pub struct RawWorklog {
    pub id: String,
    #[serde(default)]
    pub author: Option<WorklogAuthor>,
    #[serde(rename = "timeSpentSeconds", default)]
    pub time_spent_seconds: i64,
    #[serde(default)]
    pub started: String,
    #[serde(default)]
    pub comment: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct WorklogAuthor {
    #[serde(rename = "accountId", default)]
    pub account_id: String,
    /// Only read for comment authors (the mentions inbox names them); worklogs
    /// are the user's own, so there is nobody to name there.
    #[serde(rename = "displayName", default)]
    pub display_name: Option<String>,
}

#[derive(Deserialize)]
pub struct CommentListResp {
    #[serde(default)]
    pub comments: Vec<RawComment>,
}

#[derive(Deserialize)]
pub struct RawComment {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub author: Option<WorklogAuthor>,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub body: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct ChangelogPage {
    #[serde(default)]
    pub total: i64,
    #[serde(default)]
    pub values: Vec<ChangelogEntry>,
}

#[derive(Deserialize)]
pub struct ChangelogEntry {
    #[serde(default)]
    pub author: Option<WorklogAuthor>,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub items: Vec<ChangelogItem>,
}

#[derive(Deserialize)]
pub struct ChangelogItem {
    #[serde(default)]
    pub field: String,
    #[serde(rename = "fromString", default)]
    pub from: Option<String>,
    #[serde(rename = "toString", default)]
    pub to: Option<String>,
}

#[derive(Deserialize)]
pub struct IssueLinksResp {
    #[serde(default)]
    pub fields: Option<IssueLinksFields>,
}

#[derive(Deserialize)]
pub struct IssueLinksFields {
    #[serde(default)]
    pub issuelinks: Vec<IssueLink>,
}

#[derive(Deserialize)]
pub struct IssueLink {
    #[serde(rename = "type")]
    pub link_type: LinkType,
    #[serde(rename = "inwardIssue", default)]
    pub inward_issue: Option<LinkedIssue>,
    #[serde(rename = "outwardIssue", default)]
    pub outward_issue: Option<LinkedIssue>,
}

#[derive(Deserialize)]
pub struct LinkType {
    #[serde(default)]
    pub inward: String,
    #[serde(default)]
    pub outward: String,
}

#[derive(Deserialize)]
pub struct LinkedIssue {
    pub key: String,
    #[serde(default)]
    pub fields: Option<SearchFields>,
}

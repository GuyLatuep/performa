//! Request and response types: the public ones exchanged with the frontend,
//! and the raw shapes used to deserialize Jira's API responses.

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
/// issues in `author_project` the user raised themselves that are back in
/// their court, and issues assigned to them anywhere that are still open.
/// Both are expressed as status *exclusions* — every workflow has its own
/// names for "nothing to do here", so listing those is shorter and more
/// honest than trying to enumerate the actionable ones.
pub struct TodoConfig {
    /// Project the author rule applies to (the escalation project, "DEV").
    pub author_project: String,
    /// Statuses that mean "not mine to act on" for issues I raised.
    pub author_idle_statuses: Vec<String>,
    /// Statuses that mean "not mine to act on" for issues assigned to me.
    pub assignee_idle_statuses: Vec<String>,
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

// ----- Internal deserialization helpers -----

#[derive(Deserialize)]
pub struct SearchResp {
    pub issues: Vec<SearchIssue>,
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
}

#[derive(Deserialize)]
pub struct CommentListResp {
    #[serde(default)]
    pub comments: Vec<RawComment>,
}

#[derive(Deserialize)]
pub struct RawComment {
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

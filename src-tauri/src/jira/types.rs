//! Response types: the public ones serialized back to the frontend, and the
//! raw shapes used to deserialize Jira's API responses.

use serde::{Deserialize, Serialize};

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

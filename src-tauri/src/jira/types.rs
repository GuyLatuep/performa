//! Request and response types: the public ones exchanged with the frontend,
//! and the raw shapes used to deserialize Jira's API responses.

use std::collections::{BTreeMap, HashMap};

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

/// One named field of an issue, already rendered to display text — Jira's
/// custom fields come back in half a dozen shapes and the frontend should not
/// have to know any of them. See `issue::field_value`.
#[derive(Serialize)]
pub struct IssueField {
    /// The Jira field id ("customfield_10042"), for the React key.
    pub id: String,
    /// The field's name as configured on the site ("Plant-No.").
    pub label: String,
    pub value: String,
    /// When the field holds Assets objects: each one's name with the id it
    /// lives under, so the view can link to it. Empty for every other kind of
    /// field, which has nowhere to link to.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub assets: Vec<AssetLink>,
}

/// One Assets object, named and addressable.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetLink {
    pub name: String,
    pub object_id: String,
}

/// Everything the in-app issue view shows above the activity feed.
#[derive(Serialize)]
pub struct IssueDetail {
    pub key: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(rename = "issueType", skip_serializing_if = "Option::is_none")]
    pub issue_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reporter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    #[serde(rename = "dueDate", skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    /// RFC3339, local timezone.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    /// The description flattened to plain text (line breaks preserved).
    pub description: String,
    /// The site's configured fields worth showing, in the order asked for.
    /// Fields the site doesn't have — or that are empty on this issue — are
    /// simply absent.
    pub details: Vec<IssueField>,
    /// Whether this is a service-desk request, i.e. whether a comment can be
    /// public. Drives the "Reply to customer" button.
    #[serde(rename = "serviceDesk")]
    pub service_desk: bool,
    /// Files on the issue, newest first.
    pub attachments: Vec<Attachment>,
}

/// One file attached to an issue.
///
/// No URL travels to the webview: the content is fetched by id through this
/// process, which is where the credentials are. A URL handed over and handed
/// back would be one more thing to validate.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub filename: String,
    /// Bytes. Jira omits it on rare occasions; 0 then, rather than a lie.
    pub size: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    pub author: String,
    /// RFC3339, local timezone.
    pub created_at: String,
}

/// An issue's history. Three separate kinds of event, deliberately *not*
/// merged into one shape: a Comment is somebody talking, a Status change is
/// the workflow moving, a Worklog is time being recorded. They are shown on
/// one timeline, which is a rendering decision — see CONTEXT.md. The webview
/// interleaves them on `createdTs`.
#[derive(Serialize)]
pub struct IssueActivity {
    pub comments: Vec<IssueComment>,
    /// Whether older comments exist beyond the page that was read. Status
    /// changes and worklogs are always complete; comments are not, and a
    /// timeline that looks whole when it is not is worse than one that says so.
    #[serde(rename = "commentsTruncated")]
    pub comments_truncated: bool,
    #[serde(rename = "statusChanges")]
    pub status_changes: Vec<StatusChange>,
    pub worklogs: Vec<ActivityWorklog>,
}

/// A comment somebody wrote on the issue.
#[derive(Serialize)]
pub struct IssueComment {
    pub id: String,
    pub author: String,
    /// RFC3339, local timezone.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The same instant in epoch seconds. Sent on, unlike the other stamps:
    /// the three lists are interleaved in the webview, and sorting there on
    /// parsed dates would be needless work per render.
    #[serde(rename = "createdTs")]
    pub created_ts: i64,
    pub text: String,
    /// An internal (agent-only) service-desk comment. Always false outside
    /// service-desk projects, where every comment is as visible as the issue.
    pub internal: bool,
}

/// The workflow moving the issue from one status to another.
#[derive(Serialize)]
pub struct StatusChange {
    /// Several fields can change in one changelog entry, so the timestamp
    /// alone would not be unique.
    pub id: String,
    pub author: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "createdTs")]
    pub created_ts: i64,
    /// Absent when Jira reports no previous status (issue creation).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
}

/// Time somebody recorded against the issue. Distinct from [`WorklogEntry`],
/// which is the current user's own time as the timesheet needs it; this is
/// every user's, as the timeline shows it.
#[derive(Serialize)]
pub struct ActivityWorklog {
    pub id: String,
    pub author: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "createdTs")]
    pub created_ts: i64,
    #[serde(rename = "timeSpentSeconds")]
    pub time_spent_seconds: i64,
    /// The worklog comment with the non-billable marker stripped.
    pub comment: String,
}

/// A move the workflow currently permits from the issue's status.
///
/// Not "setting the status field": which Transitions exist depends on the
/// status the issue is in right now. See CONTEXT.md.
#[derive(Serialize)]
pub struct Transition {
    /// Jira's id for the transition, which is what running it needs.
    pub id: String,
    /// The transition's own name as the workflow spells it ("Start Progress"),
    /// which is not always the name of the status it leads to.
    pub name: String,
    /// The status the issue ends up in. Absent only if Jira omits it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    /// The transition's screen: every field it offers, required or not.
    /// Empty means it runs bare. What can actually be rendered from this is
    /// decided in the webview — see `issueFields.ts`.
    pub fields: Vec<FieldMeta>,
}

/// One field on a transition screen or an issue's edit form, passed through
/// close to the shape Jira describes it in.
///
/// Deliberately not interpreted here. Jira has no single notion of "a text
/// field": the base type, the array item type and the custom-field URI each
/// carry part of the answer, and which combination means "render a textarea"
/// is a presentation question. Rust's job is to hand over everything needed to
/// decide, not to decide.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldMeta {
    /// The field id a value is sent back under ("resolution",
    /// "customfield_10042").
    pub id: String,
    /// Display name ("Resolution"). Falls back to the id when Jira omits it.
    pub name: String,
    pub required: bool,
    /// `schema.type`: "string", "number", "date", "datetime", "option",
    /// "array", "user", …
    pub schema_type: String,
    /// `schema.items` — what an array holds ("option", "string", …).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_items: Option<String>,
    /// `schema.custom` — the custom-field type URI. The only thing that tells
    /// a textarea from a single-line text field, or radio buttons from a
    /// select.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_custom: Option<String>,
    /// `schema.system` — the built-in field this is ("description",
    /// "environment", …). Some of those are rich text even though their base
    /// type is only "string".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_system: Option<String>,
    /// What Jira says can be done to the field. A field that cannot be "set"
    /// is not one this app can fill in.
    pub operations: Vec<String>,
    /// The values Jira will accept, for the fields that constrain them.
    pub allowed_values: Vec<AllowedValue>,
}

/// Somebody who can be @-mentioned in a comment.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraUser {
    /// Jira's opaque account id — what a mention actually points at. Display
    /// names are neither unique nor stable; this is.
    pub account_id: String,
    pub display_name: String,
    /// Shown to tell two people with the same name apart. Absent when the site
    /// hides email addresses, which is the default on Jira Cloud.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

/// One person the webview wants mentioned, and the text standing in for them
/// in the comment body.
///
/// The name travels with the id because the comment is written as plain text:
/// this is what says "the characters `@Malte Polzin` in that text mean this
/// account", which the webview knows and Rust cannot work out for itself.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentionRef {
    pub account_id: String,
    /// The display name as it appears after the `@`, without it.
    pub name: String,
}

/// One permitted value of a constrained field.
#[derive(Serialize)]
pub struct AllowedValue {
    pub id: String,
    /// What to show. Jira spells it `value` on options and `name` on
    /// resolutions, priorities and the like.
    pub label: String,
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
    pub name: String,
    #[serde(default)]
    pub to: Option<TransitionTarget>,
    /// Only populated when the request expands `transitions.fields`; the
    /// timer's `transition_to_status` does not ask for it and gets an empty
    /// map, which is exactly what it wants.
    #[serde(default)]
    pub fields: HashMap<String, RawTransitionField>,
}

/// One field on a transition's screen as Jira describes it. The same shape
/// comes back from `/editmeta`, which is why one renderer serves both.
#[derive(Deserialize)]
pub struct RawTransitionField {
    #[serde(default)]
    pub required: bool,
    /// The field's display name ("Resolution"). Falls back to its id when Jira
    /// omits it.
    #[serde(default)]
    pub name: String,
    #[serde(rename = "fieldId", default)]
    pub field_id: Option<String>,
    #[serde(default)]
    pub schema: Option<RawFieldSchema>,
    #[serde(default)]
    pub operations: Vec<String>,
    #[serde(rename = "allowedValues", default)]
    pub allowed_values: Vec<RawAllowedValue>,
}

#[derive(Deserialize)]
pub struct RawFieldSchema {
    #[serde(rename = "type", default)]
    pub schema_type: String,
    #[serde(default)]
    pub items: Option<String>,
    #[serde(default)]
    pub custom: Option<String>,
    #[serde(default)]
    pub system: Option<String>,
}

/// Jira names the display text differently per field family, so take whichever
/// of them is present.
#[derive(Deserialize)]
pub struct RawAllowedValue {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
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

#[derive(Deserialize, Clone)]
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

#[derive(Deserialize, Clone)]
pub struct RawComment {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub author: Option<WorklogAuthor>,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub body: Option<serde_json::Value>,
    /// JSM's public/internal flag. Absent outside service-desk projects, which
    /// is why "internal" is `Some(false)` rather than "not public".
    #[serde(rename = "jsdPublic", default)]
    pub jsd_public: Option<bool>,
}

/// One entry of `/rest/api/3/user/search`.
#[derive(Deserialize)]
pub struct RawUser {
    #[serde(rename = "accountId", default)]
    pub account_id: String,
    #[serde(rename = "displayName", default)]
    pub display_name: String,
    #[serde(rename = "emailAddress", default)]
    pub email_address: Option<String>,
    /// Deactivated accounts still come back from the search and cannot be
    /// mentioned usefully.
    #[serde(default = "default_true")]
    pub active: bool,
}

fn default_true() -> bool {
    true
}

/// One entry of an issue's `attachment` field.
#[derive(Deserialize)]
pub struct RawAttachment {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub size: i64,
    #[serde(rename = "mimeType", default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub author: Option<WorklogAuthor>,
    #[serde(default)]
    pub created: String,
}

/// A reference to a Jira Assets (Insight) object, as an issue's fields carry
/// it. Deliberately nothing but pointers: the issue API does not include the
/// object's name, so it has to be fetched — see `JiraClient::asset_label`.
#[derive(Deserialize)]
pub struct RawAssetRef {
    #[serde(rename = "workspaceId", default)]
    pub workspace_id: String,
    #[serde(rename = "objectId", default)]
    pub object_id: String,
}

/// One object from the Assets API, which is where its name lives.
#[derive(Deserialize)]
pub struct RawAssetObject {
    #[serde(default)]
    pub label: Option<String>,
    #[serde(rename = "objectKey", default)]
    pub object_key: Option<String>,
}

/// One entry of `/rest/api/3/field` — the site's field catalog, which is what
/// turns a name like "Plant-No." into its `customfield_NNNNN` id.
#[derive(Deserialize)]
pub struct RawField {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
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

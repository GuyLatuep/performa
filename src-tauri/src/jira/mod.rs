//! Thin async client over the Jira Cloud REST API v3.
//! All HTTP happens here in Rust (never in the webview) so that the API token
//! stays out of the frontend and we sidestep browser CORS restrictions.
//!
//! Submodules: `types` holds the response shapes, `missing` the
//! missing-worklog reminder heuristic.

mod missing;
mod types;

use std::sync::OnceLock;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone};
use futures_util::{stream, StreamExt, TryStreamExt};
use serde::de::DeserializeOwned;

use types::*;
pub use types::{IssueSummary, MissingConfig, MissingWorklog, Myself, WorklogEntry, WorklogInput};

use crate::creds::Credentials;

const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

/// How long an unused connection is kept for reuse. reqwest's default is 90s,
/// which every missing-worklog poll outlives (it runs a quarter-hour apart —
/// see `POLL_MS` in the webview), so each scheduled scan would otherwise pay a
/// fresh TCP + TLS handshake. Kept just past the poll interval so consecutive
/// scans reuse the same connection.
const POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// Keepalive probes on those long-idle connections, so a NAT or firewall that
/// drops silent flows is noticed by us and not as a failed request.
const TCP_KEEPALIVE: Duration = Duration::from_secs(60);

// Jira's own error messages are a sentence or two; this only bites when the
// response isn't Jira's error JSON at all and the raw body stands in.
const MAX_ERROR_DETAIL_CHARS: usize = 500;

/// The one transport for the whole process, connection pool included.
///
/// `reqwest::Client` is an `Arc` handle, so cloning it shares that pool while
/// building a second one starts a rival pool that has to warm up from scratch.
/// That matters because a `JiraClient` gets built more than once: `session()`
/// deliberately builds one outside the lock, so several commands racing on a
/// cold start each construct their own, and all but one are dropped — taking
/// their freshly negotiated connections with them.
///
/// Nothing credential-bound lives here: the site and the `Authorization`
/// header are per-[`JiraClient`] fields, and reqwest keys pooled connections
/// by host, so one transport safely serves whichever site is configured.
fn shared_http() -> reqwest::Client {
    static HTTP: OnceLock<reqwest::Client> = OnceLock::new();
    HTTP.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(HTTP_TIMEOUT)
            .pool_idle_timeout(POOL_IDLE_TIMEOUT)
            .tcp_keepalive(TCP_KEEPALIVE)
            .build()
            .unwrap_or_default()
    })
    .clone()
}

#[derive(Clone)]
pub struct JiraClient {
    site: String,
    auth: String,
    /// A handle on the process-wide transport — see [`shared_http`]. Cheap to
    /// clone; every clone reuses the same connection pool.
    http: reqwest::Client,
    /// Scan cache for the missing-worklog check — the one piece of state this
    /// client holds. Shared across clones (the session hands out copies) so
    /// the cache survives for the whole app run. See [`missing`].
    activity_cache: missing::ActivityCache,
}

impl JiraClient {
    pub fn new(creds: &Credentials) -> Self {
        let raw = format!("{}:{}", creds.email, creds.token);
        let auth = format!("Basic {}", STANDARD.encode(raw));
        JiraClient {
            site: creds.site.trim_end_matches('/').to_string(),
            auth,
            http: shared_http(),
            activity_cache: missing::ActivityCache::default(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.site, path)
    }

    /// Turn a non-2xx response into a readable error including Jira's message.
    async fn check(resp: reqwest::Response) -> Result<reqwest::Response, String> {
        let status = resp.status();
        if status.is_success() {
            return Ok(resp);
        }
        let body = resp.text().await.unwrap_or_default();
        let detail = extract_error_message(&body).unwrap_or(body);
        // When Jira answers with something other than its usual error JSON —
        // a proxy's HTML page, say — `detail` is the whole raw body. Bound it
        // before it reaches either the log file or the error banner.
        let detail = crate::logging::one_line(&detail, MAX_ERROR_DETAIL_CHARS);
        log::error!("Jira returned {status}: {detail}");
        Err(format!("Jira returned {status}: {detail}"))
    }

    /// GET `path` with the standard headers and parse the JSON response.
    /// `what` names the call in error messages ("search", "worklog", …).
    async fn get_json<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, String)],
        what: &str,
    ) -> Result<T, String> {
        let resp = self
            .http
            .get(self.url(path))
            .header("Authorization", &self.auth)
            .header("Accept", "application/json")
            .query(query)
            .send()
            .await
            .map_err(net_err)?;
        Self::check(resp)
            .await?
            .json::<T>()
            .await
            .map_err(|e| format!("unexpected {what} response: {e}"))
    }

    /// Send a mutating request (POST/PUT/DELETE), succeeding on any 2xx.
    async fn send_ok(&self, req: reqwest::RequestBuilder) -> Result<(), String> {
        let resp = req
            .header("Authorization", &self.auth)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(net_err)?;
        Self::check(resp).await?;
        Ok(())
    }

    pub async fn myself(&self) -> Result<Myself, String> {
        self.get_json("/rest/api/3/myself", &[], "user").await
    }

    pub async fn search_issues(
        &self,
        jql: &str,
        max_results: u32,
    ) -> Result<Vec<IssueSummary>, String> {
        self.search_issues_fields(jql, max_results, "summary").await
    }

    /// Like [`Self::search_issues`], but also carries each issue's `updated`
    /// timestamp — what the missing-worklog scan keys its cache on.
    async fn search_issues_dated(
        &self,
        jql: &str,
        max_results: u32,
    ) -> Result<Vec<IssueSummary>, String> {
        self.search_issues_fields(jql, max_results, "summary,updated")
            .await
    }

    /// Issues assigned to the current user whose due date falls in a window
    /// around today — the data behind the dashboard's "due soon" list.
    pub async fn due_issues(&self) -> Result<Vec<IssueSummary>, String> {
        let jql = "assignee = currentUser() AND due >= -7d AND due <= 14d \
                   AND statusCategory != Done ORDER BY due ASC";
        self.search_issues_fields(jql, 50, "summary,duedate").await
    }

    async fn search_issues_fields(
        &self,
        jql: &str,
        max_results: u32,
        fields: &str,
    ) -> Result<Vec<IssueSummary>, String> {
        let parsed: SearchResp = self
            .get_json(
                "/rest/api/3/search/jql",
                &[
                    ("jql", jql.to_string()),
                    ("maxResults", max_results.to_string()),
                    ("fields", fields.to_string()),
                ],
                "search",
            )
            .await?;
        Ok(parsed
            .issues
            .into_iter()
            .map(|i| IssueSummary {
                key: i.key,
                summary: i.fields.summary,
                due_date: i.fields.duedate,
                updated: i.fields.updated,
            })
            .collect())
    }

    /// Move `issue_key` to the workflow status named `target_status`
    /// (case-insensitive), via whichever transition currently leads there.
    /// A deliberate no-op — not an error — when the issue is already in that
    /// status or no direct transition to it exists from the current one (a
    /// workflow without that status, or one that needs an intermediate step).
    pub async fn transition_to_status(
        &self,
        issue_key: &str,
        target_status: &str,
    ) -> Result<(), String> {
        let resp: TransitionsResp = self
            .get_json(
                &format!("/rest/api/3/issue/{issue_key}/transitions"),
                &[],
                "transitions",
            )
            .await?;
        let target = target_status.trim().to_lowercase();
        let Some(t) = resp.transitions.iter().find(|t| {
            t.to.as_ref()
                .map(|s| s.name.trim().to_lowercase() == target)
                .unwrap_or(false)
        }) else {
            // Best-effort feature — logged for diagnosis, not surfaced to the UI.
            let available: Vec<&str> = resp
                .transitions
                .iter()
                .map(|t| t.to.as_ref().map(|s| s.name.as_str()).unwrap_or("?"))
                .collect();
            log::debug!(
                "transition_to_status: no transition to '{target_status}' on {issue_key}; \
                 available targets: {available:?}"
            );
            return Ok(());
        };
        let result = self
            .send_ok(
                self.http
                    .post(self.url(&format!("/rest/api/3/issue/{issue_key}/transitions")))
                    .json(&serde_json::json!({ "transition": { "id": &t.id } })),
            )
            .await;
        match &result {
            Ok(()) => log::info!(
                "transition_to_status: moved {issue_key} to '{target_status}' (transition {})",
                t.id
            ),
            Err(e) => log::error!("transition_to_status: failed for {issue_key}: {e}"),
        }
        result
    }

    pub async fn add_worklog(&self, issue_key: &str, input: &WorklogInput) -> Result<(), String> {
        let comment = mark_billable(&input.comment, input.billable);
        let mut body = serde_json::json!({
            "timeSpentSeconds": input.time_spent_seconds,
            "started": jira_started(&input.date, &input.time)?,
        });
        if !comment.is_empty() {
            body["comment"] = adf_paragraph(&comment);
        }
        self.send_ok(
            self.http
                .post(self.url(&format!("/rest/api/3/issue/{issue_key}/worklog")))
                .json(&body),
        )
        .await
    }

    pub async fn update_worklog(
        &self,
        issue_key: &str,
        worklog_id: &str,
        input: &WorklogInput,
    ) -> Result<(), String> {
        let mut body = serde_json::json!({
            "timeSpentSeconds": input.time_spent_seconds,
            "started": jira_started(&input.date, &input.time)?,
        });
        // Send an (empty) ADF doc to clear the comment when blank.
        body["comment"] = adf_paragraph(&mark_billable(&input.comment, input.billable));
        self.send_ok(
            self.http
                .put(self.url(&format!(
                    "/rest/api/3/issue/{issue_key}/worklog/{worklog_id}"
                )))
                .json(&body),
        )
        .await
    }

    pub async fn delete_worklog(&self, issue_key: &str, worklog_id: &str) -> Result<(), String> {
        self.send_ok(self.http.delete(self.url(&format!(
            "/rest/api/3/issue/{issue_key}/worklog/{worklog_id}"
        ))))
        .await
    }

    /// Fetch the current user's worklogs between two dates (inclusive,
    /// yyyy-MM-dd). Finds candidate issues via JQL, then filters each issue's
    /// worklogs (fetched concurrently) to the current author and date window.
    pub async fn my_worklogs(
        &self,
        account_id: &str,
        start: &str,
        end: &str,
    ) -> Result<Vec<WorklogEntry>, String> {
        let jql = format!(
            "worklogAuthor = currentUser() AND worklogDate >= \"{start}\" AND worklogDate <= \"{end}\" ORDER BY updated DESC"
        );
        let issues = self.search_issues(&jql, 100).await?;
        log::debug!(
            "my_worklogs {start}..{end}: {} candidate issue(s) to fan out worklog fetches over",
            issues.len()
        );

        let started_after = started_after_millis(start);
        let per_issue: Vec<(IssueSummary, Vec<RawWorklog>)> = stream::iter(issues)
            .map(|issue| {
                let started_after = started_after.clone();
                async move {
                    let worklogs = self.issue_worklogs(&issue.key, &started_after).await?;
                    Ok::<_, String>((issue, worklogs))
                }
            })
            .buffer_unordered(8)
            .try_collect()
            .await?;

        let mut entries = Vec::new();
        for (issue, worklogs) in per_issue {
            for w in worklogs {
                let (billable, comment) =
                    split_billable(w.comment.as_ref().map(adf_to_text).unwrap_or_default());
                let author_id = w.author.map(|a| a.account_id).unwrap_or_default();
                if author_id != account_id {
                    continue;
                }
                let date = w.started.get(0..10).unwrap_or("").to_string();
                if date.as_str() < start || date.as_str() > end {
                    continue;
                }
                let time = w.started.get(11..16).unwrap_or("").to_string();
                entries.push(WorklogEntry {
                    billable,
                    id: w.id,
                    issue_key: issue.key.clone(),
                    issue_summary: issue.summary.clone(),
                    time_spent_seconds: w.time_spent_seconds,
                    date,
                    time,
                    comment,
                });
            }
        }
        entries.sort_by(|a, b| b.date.cmp(&a.date).then(b.time.cmp(&a.time)));
        log::debug!(
            "my_worklogs {start}..{end}: {} own worklog(s) after filtering",
            entries.len()
        );
        Ok(entries)
    }

    /// The current user's worklogs on a single issue, newest first.
    /// `issue_summary` is left empty — the caller already knows the issue.
    pub async fn my_issue_worklogs(
        &self,
        account_id: &str,
        issue_key: &str,
    ) -> Result<Vec<WorklogEntry>, String> {
        let worklogs = self.issue_worklogs(issue_key, "0").await?;
        let mut entries: Vec<WorklogEntry> = worklogs
            .into_iter()
            .filter(|w| w.author.as_ref().map(|a| a.account_id.as_str()) == Some(account_id))
            .map(|w| {
                let (billable, comment) =
                    split_billable(w.comment.as_ref().map(adf_to_text).unwrap_or_default());
                WorklogEntry {
                    billable,
                    id: w.id,
                    issue_key: issue_key.to_string(),
                    issue_summary: String::new(),
                    time_spent_seconds: w.time_spent_seconds,
                    date: w.started.get(0..10).unwrap_or("").to_string(),
                    time: w.started.get(11..16).unwrap_or("").to_string(),
                    comment,
                }
            })
            .collect();
        entries.sort_by(|a, b| b.date.cmp(&a.date).then(b.time.cmp(&a.time)));
        Ok(entries)
    }

    /// Raw worklogs on one issue that started after the given epoch-millis value.
    async fn issue_worklogs(
        &self,
        issue_key: &str,
        started_after: &str,
    ) -> Result<Vec<RawWorklog>, String> {
        let parsed: WorklogListResp = self
            .get_json(
                &format!("/rest/api/3/issue/{issue_key}/worklog"),
                &[("startedAfter", started_after.to_string())],
                "worklog",
            )
            .await?;
        Ok(parsed.worklogs)
    }
}

// ----- Billable marker -----
// ActivityTimeline's convention: a worklog whose Jira comment starts with `~`
// is categorized as non-billable; everything else counts as billable.

/// Prepend the non-billable marker to the comment when needed.
fn mark_billable(comment: &str, billable: bool) -> String {
    let trimmed = comment.trim();
    if billable {
        trimmed.to_string()
    } else {
        format!("~{trimmed}")
    }
}

/// Inverse of [`mark_billable`]: detect and strip the `~` marker.
fn split_billable(comment: String) -> (bool, String) {
    match comment.strip_prefix('~') {
        Some(rest) => (false, rest.trim_start().to_string()),
        None => (true, comment),
    }
}

// ----- Query building (kept in Rust so the webview never supplies raw JQL) -----

/// Turn the free-form search input into JQL: blank = my open issues, an
/// issue key = exact lookup, anything else = escaped text search.
pub fn build_search_jql(query: &str) -> String {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"
            .to_string();
    }
    if is_issue_key(trimmed) {
        return format!("key = \"{}\"", trimmed.to_uppercase());
    }
    let esc = escape_jql(trimmed);
    format!("(summary ~ \"{esc}*\" OR text ~ \"{esc}\") ORDER BY updated DESC")
}

/// `ABC-123` shape: alphanumeric project key starting with a letter, then a
/// numeric issue number.
pub fn is_issue_key(s: &str) -> bool {
    let Some((project, number)) = s.split_once('-') else {
        return false;
    };
    let mut chars = project.chars();
    project.len() >= 2
        && matches!(chars.next(), Some(c) if c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric())
        && !number.is_empty()
        && number.chars().all(|c| c.is_ascii_digit())
}

fn escape_jql(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

// ----- Small shared helpers -----

fn net_err(e: reqwest::Error) -> String {
    format!("network error: {e}")
}

/// Build a Jira `started` timestamp (`yyyy-MM-ddThh:mm:ss.SSSZ`, offset without
/// a colon) for the given local date (yyyy-MM-dd) and time (HH:mm).
fn jira_started(date: &str, time: &str) -> Result<String, String> {
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
fn parse_jira_ts(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.3f%z")
        .ok()
        .map(|dt| dt.timestamp())
}

/// Epoch seconds as an RFC3339 string in the local timezone.
fn format_rfc3339_local(ts: i64) -> String {
    Local
        .timestamp_opt(ts, 0)
        .single()
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default()
}

/// Epoch-millis at the start of `date`, used to narrow the worklog query.
fn started_after_millis(date: &str) -> String {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .and_then(|naive| Local.from_local_datetime(&naive).single())
        .map(|dt| (dt.timestamp_millis() - 86_400_000).to_string())
        .unwrap_or_else(|| "0".to_string())
}

/// Wrap plain text in a minimal Atlassian Document Format doc (required by v3).
fn adf_paragraph(text: &str) -> serde_json::Value {
    let content = if text.is_empty() {
        serde_json::json!([])
    } else {
        serde_json::json!([{ "type": "text", "text": text }])
    };
    serde_json::json!({
        "type": "doc",
        "version": 1,
        "content": [{ "type": "paragraph", "content": content }]
    })
}

/// Flatten an ADF document to plain text by collecting all `text` nodes.
fn adf_to_text(value: &serde_json::Value) -> String {
    fn walk(v: &serde_json::Value, out: &mut String) {
        match v {
            serde_json::Value::Object(map) => {
                if let Some(serde_json::Value::String(t)) = map.get("text") {
                    out.push_str(t);
                }
                if let Some(content) = map.get("content") {
                    walk(content, out);
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    walk(item, out);
                }
            }
            _ => {}
        }
    }
    let mut out = String::new();
    walk(value, &mut out);
    out
}

/// Pull `errorMessages[0]` / first `errors` value out of a Jira error body.
fn extract_error_message(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    if let Some(arr) = v.get("errorMessages").and_then(|m| m.as_array()) {
        if let Some(first) = arr.first().and_then(|m| m.as_str()) {
            return Some(first.to_string());
        }
    }
    if let Some(errors) = v.get("errors").and_then(|m| m.as_object()) {
        if let Some(first) = errors.values().next().and_then(|m| m.as_str()) {
            return Some(first.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issue_key_shapes() {
        assert!(is_issue_key("ABC-123"));
        assert!(is_issue_key("ab2-1"));
        assert!(!is_issue_key("ABC"));
        assert!(!is_issue_key("A-1")); // project keys are at least two chars
        assert!(!is_issue_key("1BC-1"));
        assert!(!is_issue_key("ABC-12x"));
        assert!(!is_issue_key("ABC-"));
        assert!(!is_issue_key("-123"));
    }

    #[test]
    fn search_jql_escapes_user_text() {
        let jql = build_search_jql(r#"quo"te \ back"#);
        assert!(jql.contains(r#"quo\"te \\ back"#));
        assert!(!jql.contains(r#" "quo""#));
    }

    #[test]
    fn search_jql_modes() {
        assert!(build_search_jql("").starts_with("assignee = currentUser()"));
        assert_eq!(build_search_jql(" abc-12 "), "key = \"ABC-12\"");
        assert!(build_search_jql("login bug").starts_with("(summary ~ \"login bug*\""));
    }

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

    #[test]
    fn worklog_input_matches_the_frontend_payload() {
        // Verbatim shape of the `worklog` argument api.ts sends over IPC —
        // guards the camelCase renames on both sides of the boundary.
        let json = r#"{
            "timeSpentSeconds": 5400,
            "date": "2026-07-16",
            "time": "09:30",
            "comment": "code review",
            "billable": false
        }"#;
        let input: WorklogInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.time_spent_seconds, 5400);
        assert_eq!(input.date, "2026-07-16");
        assert_eq!(input.time, "09:30");
        assert_eq!(input.comment, "code review");
        assert!(!input.billable);
    }

    #[test]
    fn adf_text_extraction() {
        let doc = adf_paragraph("hello world");
        assert_eq!(adf_to_text(&doc), "hello world");
        assert_eq!(adf_to_text(&adf_paragraph("")), "");
    }
}

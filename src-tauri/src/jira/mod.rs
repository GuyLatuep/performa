//! Thin async client over the Jira Cloud REST API v3.
//! All HTTP happens here in Rust (never in the webview) so that the API token
//! stays out of the frontend and we sidestep browser CORS restrictions.
//!
//! Submodules: `types` holds the response shapes, `missing` the
//! missing-worklog reminder heuristic.

mod missing;
mod types;

use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone};
use futures_util::{stream, StreamExt, TryStreamExt};
use serde::de::DeserializeOwned;

pub use types::{IssueSummary, MissingWorklog, Myself, WorklogEntry};
use types::*;

use crate::creds::Credentials;

const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone)]
pub struct JiraClient {
    site: String,
    auth: String,
    http: reqwest::Client,
}

impl JiraClient {
    pub fn new(creds: &Credentials) -> Self {
        let raw = format!("{}:{}", creds.email, creds.token);
        let auth = format!("Basic {}", STANDARD.encode(raw));
        JiraClient {
            site: creds.site.trim_end_matches('/').to_string(),
            auth,
            http: reqwest::Client::builder()
                .timeout(HTTP_TIMEOUT)
                .build()
                .unwrap_or_default(),
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
        let parsed: SearchResp = self
            .get_json(
                "/rest/api/3/search/jql",
                &[
                    ("jql", jql.to_string()),
                    ("maxResults", max_results.to_string()),
                    ("fields", "summary".to_string()),
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
            })
            .collect())
    }

    pub async fn add_worklog(
        &self,
        issue_key: &str,
        time_spent_seconds: i64,
        date: &str,
        time: &str,
        comment: &str,
    ) -> Result<(), String> {
        let mut body = serde_json::json!({
            "timeSpentSeconds": time_spent_seconds,
            "started": jira_started(date, time)?,
        });
        if !comment.trim().is_empty() {
            body["comment"] = adf_paragraph(comment);
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
        time_spent_seconds: i64,
        date: &str,
        time: &str,
        comment: &str,
    ) -> Result<(), String> {
        let mut body = serde_json::json!({
            "timeSpentSeconds": time_spent_seconds,
            "started": jira_started(date, time)?,
        });
        // Send an (empty) ADF doc to clear the comment when blank.
        body["comment"] = adf_paragraph(comment.trim());
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
                    id: w.id,
                    issue_key: issue.key.clone(),
                    issue_summary: issue.summary.clone(),
                    time_spent_seconds: w.time_spent_seconds,
                    date,
                    time,
                    comment: w.comment.as_ref().map(adf_to_text).unwrap_or_default(),
                });
            }
        }
        entries.sort_by(|a, b| b.date.cmp(&a.date).then(b.time.cmp(&a.time)));
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
            .filter(|w| {
                w.author.as_ref().map(|a| a.account_id.as_str()) == Some(account_id)
            })
            .map(|w| WorklogEntry {
                id: w.id,
                issue_key: issue_key.to_string(),
                issue_summary: String::new(),
                time_spent_seconds: w.time_spent_seconds,
                date: w.started.get(0..10).unwrap_or("").to_string(),
                time: w.started.get(11..16).unwrap_or("").to_string(),
                comment: w.comment.as_ref().map(adf_to_text).unwrap_or_default(),
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
    fn adf_text_extraction() {
        let doc = adf_paragraph("hello world");
        assert_eq!(adf_to_text(&doc), "hello world");
        assert_eq!(adf_to_text(&adf_paragraph("")), "");
    }
}

//! Thin async client over the Jira Cloud REST API v3.
//! All HTTP happens here in Rust (never in the webview) so that the API token
//! stays out of the frontend and we sidestep browser CORS restrictions.

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{Local, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};

use crate::creds::Credentials;

pub struct JiraClient {
    site: String,
    auth: String,
    http: reqwest::Client,
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
    pub comment: String,
}

// ----- Internal deserialization helpers -----

#[derive(Deserialize)]
struct SearchResp {
    issues: Vec<SearchIssue>,
}

#[derive(Deserialize)]
struct SearchIssue {
    key: String,
    fields: SearchFields,
}

#[derive(Deserialize)]
struct SearchFields {
    #[serde(default)]
    summary: String,
}

#[derive(Deserialize)]
struct WorklogListResp {
    #[serde(default)]
    worklogs: Vec<RawWorklog>,
}

#[derive(Deserialize)]
struct RawWorklog {
    id: String,
    #[serde(default)]
    author: Option<WorklogAuthor>,
    #[serde(rename = "timeSpentSeconds", default)]
    time_spent_seconds: i64,
    #[serde(default)]
    started: String,
    #[serde(default)]
    comment: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct WorklogAuthor {
    #[serde(rename = "accountId", default)]
    account_id: String,
}

impl JiraClient {
    pub fn new(creds: &Credentials) -> Self {
        let raw = format!("{}:{}", creds.email, creds.token);
        let auth = format!("Basic {}", STANDARD.encode(raw));
        JiraClient {
            site: creds.site.trim_end_matches('/').to_string(),
            auth,
            http: reqwest::Client::new(),
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

    pub async fn myself(&self) -> Result<Myself, String> {
        let resp = self
            .http
            .get(self.url("/rest/api/3/myself"))
            .header("Authorization", &self.auth)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(net_err)?;
        Self::check(resp)
            .await?
            .json::<Myself>()
            .await
            .map_err(|e| format!("unexpected response: {e}"))
    }

    pub async fn search_issues(&self, jql: &str, max_results: u32) -> Result<Vec<IssueSummary>, String> {
        let resp = self
            .http
            .get(self.url("/rest/api/3/search/jql"))
            .header("Authorization", &self.auth)
            .header("Accept", "application/json")
            .query(&[
                ("jql", jql.to_string()),
                ("maxResults", max_results.to_string()),
                ("fields", "summary".to_string()),
            ])
            .send()
            .await
            .map_err(net_err)?;
        let parsed = Self::check(resp)
            .await?
            .json::<SearchResp>()
            .await
            .map_err(|e| format!("unexpected search response: {e}"))?;
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
        comment: &str,
    ) -> Result<(), String> {
        let mut body = serde_json::json!({
            "timeSpentSeconds": time_spent_seconds,
            "started": jira_started(date)?,
        });
        if !comment.trim().is_empty() {
            body["comment"] = adf_paragraph(comment);
        }
        let resp = self
            .http
            .post(self.url(&format!("/rest/api/3/issue/{issue_key}/worklog")))
            .header("Authorization", &self.auth)
            .header("Accept", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(net_err)?;
        Self::check(resp).await?;
        Ok(())
    }

    pub async fn update_worklog(
        &self,
        issue_key: &str,
        worklog_id: &str,
        time_spent_seconds: i64,
        date: &str,
        comment: &str,
    ) -> Result<(), String> {
        let mut body = serde_json::json!({
            "timeSpentSeconds": time_spent_seconds,
            "started": jira_started(date)?,
        });
        // Send an (empty) ADF doc to clear the comment when blank.
        body["comment"] = if comment.trim().is_empty() {
            adf_paragraph("")
        } else {
            adf_paragraph(comment)
        };
        let resp = self
            .http
            .put(self.url(&format!("/rest/api/3/issue/{issue_key}/worklog/{worklog_id}")))
            .header("Authorization", &self.auth)
            .header("Accept", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(net_err)?;
        Self::check(resp).await?;
        Ok(())
    }

    pub async fn delete_worklog(&self, issue_key: &str, worklog_id: &str) -> Result<(), String> {
        let resp = self
            .http
            .delete(self.url(&format!("/rest/api/3/issue/{issue_key}/worklog/{worklog_id}")))
            .header("Authorization", &self.auth)
            .send()
            .await
            .map_err(net_err)?;
        Self::check(resp).await?;
        Ok(())
    }

    /// Fetch the current user's worklogs between two dates (inclusive, yyyy-MM-dd).
    /// Finds candidate issues via JQL, then filters each issue's worklogs to the
    /// current author and date window.
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

        let mut entries = Vec::new();
        for issue in issues {
            let resp = self
                .http
                .get(self.url(&format!("/rest/api/3/issue/{}/worklog", issue.key)))
                .header("Authorization", &self.auth)
                .header("Accept", "application/json")
                .query(&[("startedAfter", started_after_millis(start))])
                .send()
                .await
                .map_err(net_err)?;
            let list = Self::check(resp)
                .await?
                .json::<WorklogListResp>()
                .await
                .map_err(|e| format!("unexpected worklog response: {e}"))?;

            for w in list.worklogs {
                let author_id = w.author.map(|a| a.account_id).unwrap_or_default();
                if author_id != account_id {
                    continue;
                }
                let date = w.started.get(0..10).unwrap_or("").to_string();
                if date.as_str() < start || date.as_str() > end {
                    continue;
                }
                entries.push(WorklogEntry {
                    id: w.id,
                    issue_key: issue.key.clone(),
                    issue_summary: issue.summary.clone(),
                    time_spent_seconds: w.time_spent_seconds,
                    date,
                    comment: w.comment.as_ref().map(adf_to_text).unwrap_or_default(),
                });
            }
        }
        entries.sort_by(|a, b| b.date.cmp(&a.date));
        Ok(entries)
    }
}

fn net_err(e: reqwest::Error) -> String {
    format!("network error: {e}")
}

/// Build a Jira `started` timestamp (`yyyy-MM-ddThh:mm:ss.SSSZ`, offset without
/// a colon) for the given date at local noon.
fn jira_started(date: &str) -> Result<String, String> {
    let d = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| format!("invalid date '{date}', expected yyyy-MM-dd"))?;
    let naive = d
        .and_hms_opt(12, 0, 0)
        .ok_or_else(|| "invalid time".to_string())?;
    let dt = Local
        .from_local_datetime(&naive)
        .single()
        .ok_or_else(|| "ambiguous local time".to_string())?;
    Ok(dt.format("%Y-%m-%dT%H:%M:%S%.3f%z").to_string())
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

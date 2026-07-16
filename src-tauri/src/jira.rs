//! Thin async client over the Jira Cloud REST API v3.
//! All HTTP happens here in Rust (never in the webview) so that the API token
//! stays out of the frontend and we sidestep browser CORS restrictions.

use std::collections::HashSet;

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone};
use futures_util::{stream, StreamExt, TryStreamExt};
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
    /// Time portion (HH:mm) of the worklog start.
    pub time: String,
    pub comment: String,
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

#[derive(Deserialize)]
struct CommentListResp {
    #[serde(default)]
    comments: Vec<RawComment>,
}

#[derive(Deserialize)]
struct RawComment {
    #[serde(default)]
    author: Option<WorklogAuthor>,
    #[serde(default)]
    created: String,
}

#[derive(Deserialize)]
struct ChangelogPage {
    #[serde(default)]
    total: i64,
    #[serde(default)]
    values: Vec<ChangelogEntry>,
}

#[derive(Deserialize)]
struct ChangelogEntry {
    #[serde(default)]
    author: Option<WorklogAuthor>,
    #[serde(default)]
    created: String,
    #[serde(default)]
    items: Vec<ChangelogItem>,
}

#[derive(Deserialize)]
struct ChangelogItem {
    #[serde(default)]
    field: String,
}

#[derive(Deserialize)]
struct IssueLinksResp {
    #[serde(default)]
    fields: Option<IssueLinksFields>,
}

#[derive(Deserialize)]
struct IssueLinksFields {
    #[serde(default)]
    issuelinks: Vec<IssueLink>,
}

#[derive(Deserialize)]
struct IssueLink {
    #[serde(rename = "type")]
    link_type: LinkType,
    #[serde(rename = "inwardIssue", default)]
    inward_issue: Option<LinkedIssue>,
    #[serde(rename = "outwardIssue", default)]
    outward_issue: Option<LinkedIssue>,
}

#[derive(Deserialize)]
struct LinkType {
    #[serde(default)]
    inward: String,
    #[serde(default)]
    outward: String,
}

#[derive(Deserialize)]
struct LinkedIssue {
    key: String,
    #[serde(default)]
    fields: Option<SearchFields>,
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
        time: &str,
        comment: &str,
    ) -> Result<(), String> {
        let mut body = serde_json::json!({
            "timeSpentSeconds": time_spent_seconds,
            "started": jira_started(date, time)?,
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
            let worklogs = self
                .issue_worklogs(&issue.key, &started_after_millis(start))
                .await?;

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
        entries.sort_by(|a, b| b.date.cmp(&a.date));
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
        let resp = self
            .http
            .get(self.url(&format!("/rest/api/3/issue/{issue_key}/worklog")))
            .header("Authorization", &self.auth)
            .header("Accept", "application/json")
            .query(&[("startedAfter", started_after)])
            .send()
            .await
            .map_err(net_err)?;
        Ok(Self::check(resp)
            .await?
            .json::<WorklogListResp>()
            .await
            .map_err(|e| format!("unexpected worklog response: {e}"))?
            .worklogs)
    }

    async fn recent_comments(&self, issue_key: &str) -> Result<Vec<RawComment>, String> {
        let resp = self
            .http
            .get(self.url(&format!("/rest/api/3/issue/{issue_key}/comment")))
            .header("Authorization", &self.auth)
            .header("Accept", "application/json")
            .query(&[("orderBy", "-created"), ("maxResults", "30")])
            .send()
            .await
            .map_err(net_err)?;
        Ok(Self::check(resp)
            .await?
            .json::<CommentListResp>()
            .await
            .map_err(|e| format!("unexpected comment response: {e}"))?
            .comments)
    }

    async fn changelog_page(&self, issue_key: &str, start_at: i64) -> Result<ChangelogPage, String> {
        let resp = self
            .http
            .get(self.url(&format!("/rest/api/3/issue/{issue_key}/changelog")))
            .header("Authorization", &self.auth)
            .header("Accept", "application/json")
            .query(&[
                ("startAt", start_at.to_string()),
                ("maxResults", "100".to_string()),
            ])
            .send()
            .await
            .map_err(net_err)?;
        Self::check(resp)
            .await?
            .json::<ChangelogPage>()
            .await
            .map_err(|e| format!("unexpected changelog response: {e}"))
    }

    /// Most recent changelog entries. The API pages oldest-first, so when the
    /// history doesn't fit in one page, re-fetch the last page.
    async fn recent_changelog(&self, issue_key: &str) -> Result<Vec<ChangelogEntry>, String> {
        let first = self.changelog_page(issue_key, 0).await?;
        let fetched = first.values.len() as i64;
        if first.total > fetched && fetched > 0 {
            return Ok(self.changelog_page(issue_key, first.total - fetched).await?.values);
        }
        Ok(first.values)
    }

    /// The issue this one links to with the given description (e.g. the issue
    /// a DEV ticket "is an escalation for"), if such a link exists.
    async fn linked_issue(
        &self,
        issue_key: &str,
        link_description: &str,
    ) -> Result<Option<(String, String)>, String> {
        let resp = self
            .http
            .get(self.url(&format!("/rest/api/3/issue/{issue_key}")))
            .header("Authorization", &self.auth)
            .header("Accept", "application/json")
            .query(&[("fields", "issuelinks")])
            .send()
            .await
            .map_err(net_err)?;
        let parsed = Self::check(resp)
            .await?
            .json::<IssueLinksResp>()
            .await
            .map_err(|e| format!("unexpected issue response: {e}"))?;

        // A link entry on this issue reads "<this issue> <description>
        // <outwardIssue>" or "<this issue> <inward description> <inwardIssue>".
        for link in parsed.fields.map(|f| f.issuelinks).unwrap_or_default() {
            let target = if link.link_type.outward.eq_ignore_ascii_case(link_description) {
                link.outward_issue
            } else if link.link_type.inward.eq_ignore_ascii_case(link_description) {
                link.inward_issue
            } else {
                None
            };
            if let Some(t) = target {
                let summary = t.fields.map(|f| f.summary).unwrap_or_default();
                return Ok(Some((t.key, summary)));
            }
        }
        Ok(None)
    }

    /// Periods covered by the user's worklogs on one issue, each stretched by
    /// `window_secs` on both sides, as (from, to) epoch-second pairs.
    async fn covered_ranges(
        &self,
        issue_key: &str,
        account_id: &str,
        after_secs: i64,
        window_secs: i64,
    ) -> Result<Vec<(i64, i64)>, String> {
        let worklogs = self
            .issue_worklogs(issue_key, &(after_secs * 1000).to_string())
            .await?;
        Ok(worklogs
            .iter()
            .filter(|w| w.author.as_ref().map(|a| a.account_id.as_str()) == Some(account_id))
            .filter_map(|w| parse_jira_ts(&w.started).map(|s| (s, w.time_spent_seconds)))
            .map(|(start, spent)| (start - window_secs, start + spent + window_secs))
            .collect())
    }

    /// Issues where the user recently commented or changed the status but has
    /// no own worklog whose logged period (stretched by `window_secs` on both
    /// sides) covers that activity. Activity younger than `grace_secs` is not
    /// flagged yet, so there is a chance to log before the reminder appears.
    ///
    /// Status changes are found directly via JQL. Comments are not queryable
    /// by author, so recently updated issues the user viewed (issueHistory),
    /// watches, or owns serve as candidates — viewing history also covers
    /// JSM internal comments, which don't auto-watch.
    /// Issues from `escalation_project` log their time on the issue they are
    /// linked to as `escalation_link` (when present), so worklogs on either
    /// issue clear the reminder.
    pub async fn missing_worklogs(
        &self,
        account_id: &str,
        lookback_days: u32,
        window_secs: i64,
        grace_secs: i64,
        escalation_project: &str,
        escalation_link: &str,
    ) -> Result<Vec<MissingWorklog>, String> {
        let now = Local::now().timestamp();
        let cutoff = now - lookback_days as i64 * 86_400;
        let flag_before = now - grace_secs;

        let status_issues = self
            .search_issues(
                &format!(
                    "status CHANGED BY currentUser() AFTER \"-{lookback_days}d\" ORDER BY updated DESC"
                ),
                25,
            )
            .await?;
        let watched = self
            .search_issues(
                &format!(
                    "updated >= \"-{lookback_days}d\" AND (issue in issueHistory() \
                     OR watcher = currentUser() OR assignee = currentUser() \
                     OR reporter = currentUser()) ORDER BY updated DESC"
                ),
                50,
            )
            .await?;

        let status_keys: HashSet<String> = status_issues.iter().map(|i| i.key.clone()).collect();
        let mut candidates = status_issues;
        for issue in watched {
            if !status_keys.contains(&issue.key) {
                candidates.push(issue);
            }
        }

        // Candidates are independent — check them concurrently so the whole
        // scan finishes in seconds even with many recently touched issues.
        let mut found: Vec<(i64, MissingWorklog)> = stream::iter(candidates)
            .map(|issue| {
                let has_status_change = status_keys.contains(&issue.key);
                self.check_candidate(
                    issue,
                    has_status_change,
                    account_id,
                    cutoff,
                    flag_before,
                    window_secs,
                    escalation_project,
                    escalation_link,
                )
            })
            .buffer_unordered(8)
            .try_collect::<Vec<Option<(i64, MissingWorklog)>>>()
            .await?
            .into_iter()
            .flatten()
            .collect();

        found.sort_by_key(|(ts, _)| std::cmp::Reverse(*ts));
        Ok(found.into_iter().map(|(_, m)| m).collect())
    }

    /// Examine one candidate issue: does the user have unlogged activity on
    /// it? Returns the newest unlogged activity, keyed for sorting.
    #[allow(clippy::too_many_arguments)]
    async fn check_candidate(
        &self,
        issue: IssueSummary,
        has_status_change: bool,
        account_id: &str,
        cutoff: i64,
        flag_before: i64,
        window_secs: i64,
        escalation_project: &str,
        escalation_link: &str,
    ) -> Result<Option<(i64, MissingWorklog)>, String> {
        let mut activities: Vec<(&str, i64)> = Vec::new();
        for c in self.recent_comments(&issue.key).await? {
            if c.author.as_ref().map(|a| a.account_id.as_str()) != Some(account_id) {
                continue;
            }
            if let Some(ts) = parse_jira_ts(&c.created) {
                if ts >= cutoff && ts <= flag_before {
                    activities.push(("comment", ts));
                }
            }
        }
        if has_status_change {
            for e in self.recent_changelog(&issue.key).await? {
                if e.author.as_ref().map(|a| a.account_id.as_str()) != Some(account_id) {
                    continue;
                }
                if !e.items.iter().any(|i| i.field.eq_ignore_ascii_case("status")) {
                    continue;
                }
                if let Some(ts) = parse_jira_ts(&e.created) {
                    if ts >= cutoff && ts <= flag_before {
                        activities.push(("status", ts));
                    }
                }
            }
        }
        if activities.is_empty() {
            return Ok(None);
        }

        // Escalation-project issues log their time on the linked source
        // issue, so it becomes the log target and its worklogs count too.
        let escalated = if issue.key.starts_with(&format!("{escalation_project}-")) {
            self.linked_issue(&issue.key, escalation_link).await?
        } else {
            None
        };

        // Fetch worklogs a day extra back so a long worklog reaching into
        // the lookback window is still seen.
        let worklog_after = cutoff - 86_400;
        let mut covered = self
            .covered_ranges(&issue.key, account_id, worklog_after, window_secs)
            .await?;
        if let Some((target_key, _)) = &escalated {
            covered.extend(
                self.covered_ranges(target_key, account_id, worklog_after, window_secs)
                    .await?,
            );
        }

        let newest_unlogged = activities
            .into_iter()
            .filter(|(_, ts)| !covered.iter().any(|(a, b)| ts >= a && ts <= b))
            .max_by_key(|(_, ts)| *ts);
        Ok(newest_unlogged.map(|(kind, ts)| {
            let (log_key, log_summary) =
                escalated.unwrap_or_else(|| (issue.key.clone(), issue.summary.clone()));
            (
                ts,
                MissingWorklog {
                    issue_key: issue.key,
                    issue_summary: issue.summary,
                    kind: kind.to_string(),
                    activity_at: format_rfc3339_local(ts),
                    log_key,
                    log_summary,
                },
            )
        }))
    }
}

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

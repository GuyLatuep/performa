//! Thin async client over the Jira Cloud REST API v3.
//! All HTTP happens here in Rust (never in the webview) so that the API token
//! stays out of the frontend and we sidestep browser CORS restrictions.
//!
//! What this module itself holds is the transport: the client, its connection
//! pool, the comment-page cache and the error handling every request shares.
//!
//! Submodules by subject. The wire formats: `types` holds the response shapes,
//! `jql` builds every query the app sends (and escapes what goes into one),
//! `adf` converts between Jira's rich-text documents and plain text, and
//! `stamps` between its timestamps and epoch seconds. The features: `missing`
//! the missing-worklog reminder heuristic, `mentions` the @-mention inbox,
//! `issue` the single-issue view behind the todo tab, `attachments` the file
//! transfers that view needs, and `links` the work items it is linked to.

mod adf;
mod attachments;
mod issue;
mod jql;
mod links;
mod mentions;
mod missing;
mod stamps;
#[cfg(test)]
mod test_support;
mod types;

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Local;
use futures_util::{stream, StreamExt, TryStreamExt};
use serde::de::DeserializeOwned;

use adf::{adf_paragraph, adf_to_text};
pub use jql::{
    build_search_jql, build_text_jql, fill_search_template, is_issue_key, SEARCH_TERM_PLACEHOLDER,
};
use jql::{build_todo_jql, drop_ignored_statuses, open_status_names};
use stamps::{jira_started, started_after_millis};
use types::*;
pub use types::{
    FieldMeta, IssueActivity, IssueDetail, IssueSummary, JiraUser, LinkRelation, MentionRef,
    MentionScan, MissingConfig, MissingWorklog, Myself, ProjectSummary, TodoConfig, Transition,
    WorklogEntry, WorklogInput,
};

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

/// How many per-issue requests the two fan-out scans (`my_worklogs` and the
/// missing-worklog candidate scan) keep in flight at once.
///
/// The ceiling used to be about connections: under HTTP/1.1 each parallel
/// request needed its own socket, so a low number kept us from opening a pile
/// of them. With h2 negotiated (see the `http2` feature in `Cargo.toml`) they
/// multiplex over a single connection, and the number is purely about how much
/// work Jira is asked to do concurrently. Lower it again if Jira starts
/// answering 429.
const MAX_INFLIGHT: usize = 16;

/// How many rows one of the palette's searches asks Jira for.
///
/// Enough that the common search is answered whole, small enough that a term
/// matching half the site does not drag the webview to a halt drawing rows
/// nobody will scroll to. Where it is not enough, `search_issues_rows` says so
/// rather than letting a full page read as a complete answer.
const SEARCH_ROW_LIMIT: u32 = 100;

/// Page size for `/project/search` (Jira's own maximum), and a stop so a site
/// with an implausible number of projects can't spin the paging loop.
const PROJECT_PAGE: u32 = 50;
const MAX_PROJECTS: usize = 500;

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
    /// The same idea for the mentions inbox — see [`mentions`].
    mention_cache: mentions::MentionCache,
    /// The site's field catalog, fetched once and kept for the app run — what
    /// lets the issue view ask for its fields by name. See [`issue`].
    field_cache: issue::FieldCache,
    /// Names of Assets objects already looked up — see
    /// [`JiraClient::asset_label`]. Objects are reference data: an issue's
    /// field points at one, and what it is called does not change while the
    /// app is open.
    asset_cache: issue::AssetCache,
    /// Comment pages both scans read — see [`JiraClient::recent_comments`].
    comment_cache: CommentCache,
}

/// One issue's comment page, with the `updated` stamp it was read at and when
/// that happened.
struct CachedComments {
    updated: Option<String>,
    fetched_at: i64,
    comments: Vec<RawComment>,
}

impl CachedComments {
    /// Reusable while the issue has not been touched since the page was read
    /// and the entry has not expired. A missing `updated` on either side means
    /// the page cannot be proved current — refetch rather than serve it.
    fn is_fresh_for(&self, updated: Option<&str>, now: i64) -> bool {
        let unchanged = matches!(
            (self.updated.as_deref(), updated),
            (Some(cached), Some(current)) if cached == current
        );
        unchanged && now - self.fetched_at < COMMENT_CACHE_SECS
    }
}

type CommentCache = Arc<tokio::sync::Mutex<HashMap<String, CachedComments>>>;

/// How long a fetched comment page stays reusable. A comment cannot be written
/// or edited without moving the issue's `updated`, so a matching stamp already
/// proves the page current and this could be kept indefinitely — the window is
/// only there to bound what the map holds, since the pages carry full comment
/// bodies. Wide enough to span the missing-worklog interval, which is the gap
/// the sharing exists to cover.
const COMMENT_CACHE_SECS: i64 = 20 * 60;

/// How many comments one page holds. A full page means there are probably
/// older ones, which the issue timeline has to admit to rather than look
/// complete — see `IssueActivity::comments_truncated`.
const COMMENT_PAGE_LIMIT: usize = 30;

impl JiraClient {
    pub fn new(creds: &Credentials) -> Self {
        let raw = format!("{}:{}", creds.email, creds.token);
        let auth = format!("Basic {}", STANDARD.encode(raw));
        JiraClient {
            site: creds.site.trim_end_matches('/').to_string(),
            auth,
            http: shared_http(),
            activity_cache: missing::ActivityCache::default(),
            mention_cache: mentions::MentionCache::default(),
            field_cache: issue::FieldCache::default(),
            asset_cache: issue::AssetCache::default(),
            comment_cache: CommentCache::default(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.site, path)
    }

    /// The issue's newest comments, read once for both scans that want them:
    /// the mentions inbox looks for who was tagged, the missing-worklog scan
    /// for what the user did. They run on different intervals over heavily
    /// overlapping candidates, and each keeps its own cache of *conclusions*,
    /// so without this the same page was fetched twice whenever the two
    /// coincided — the heaviest call in the app, doubled.
    ///
    /// `updated` is the issue's timestamp: a comment cannot be written or
    /// edited without moving it, so a matching stamp proves the cached page
    /// current. A missing stamp on either side cannot prove that — refetch.
    pub(super) async fn recent_comments(
        &self,
        issue_key: &str,
        updated: Option<&str>,
    ) -> Result<Vec<RawComment>, String> {
        let now = Local::now().timestamp();
        if let Some(hit) = self.comment_cache.lock().await.get(issue_key) {
            if hit.is_fresh_for(updated, now) {
                return Ok(hit.comments.clone());
            }
        }

        let parsed: CommentListResp = self
            .get_json(
                &format!("/rest/api/3/issue/{issue_key}/comment"),
                &[
                    ("orderBy", "-created".to_string()),
                    ("maxResults", COMMENT_PAGE_LIMIT.to_string()),
                ],
                "comment",
            )
            .await?;

        let mut cache = self.comment_cache.lock().await;
        // Dropping what has expired here keeps the map from holding pages for
        // issues nobody asks about any more.
        cache.retain(|_, e| now - e.fetched_at < COMMENT_CACHE_SECS);
        // Only store a page that can prove itself current later. Without a
        // stamp `is_fresh_for` can never serve this entry, so writing it would
        // do nothing but evict a usable one — and the issue view reads with no
        // stamp on purpose, so it would evict precisely the issues the user is
        // looking at, out from under both background scans.
        if updated.is_some() {
            cache.insert(
                issue_key.to_string(),
                CachedComments {
                    updated: updated.map(str::to_string),
                    fetched_at: now,
                    comments: parsed.comments.clone(),
                },
            );
        }
        Ok(parsed.comments)
    }

    /// Turn a non-2xx response into a readable error including Jira's message.
    pub(super) async fn check(resp: reqwest::Response) -> Result<reqwest::Response, String> {
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

    /// The same GET against a full URL rather than a path on the site.
    ///
    /// Assets lives on `api.atlassian.com`, not the customer's Jira host, and
    /// takes the same credentials.
    pub(super) async fn get_json_absolute<T: DeserializeOwned>(
        &self,
        url: &str,
        what: &str,
    ) -> Result<T, String> {
        let resp = self
            .http
            .get(url)
            .header("Authorization", &self.auth)
            .header("Accept", "application/json")
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

    /// Every project the user can see, key-ordered — the scope picker behind
    /// the todo tab's ignored-status setting.
    ///
    /// Paged: Jira caps a page at [`PROJECT_PAGE`], so a site with more
    /// projects than that would silently offer only the first page.
    pub async fn projects(&self) -> Result<Vec<ProjectSummary>, String> {
        let mut out: Vec<ProjectSummary> = Vec::new();
        let mut start = 0u32;
        loop {
            let page: ProjectSearchResp = self
                .get_json(
                    "/rest/api/3/project/search",
                    &[
                        ("startAt", start.to_string()),
                        ("maxResults", PROJECT_PAGE.to_string()),
                        ("orderBy", "key".to_string()),
                        // Archived and deleted projects can't hold work the
                        // todo tab would ever list.
                        ("status", "live".to_string()),
                    ],
                    "project search",
                )
                .await?;
            let fetched = page.values.len() as u32;
            out.extend(page.values.into_iter().map(|p| ProjectSummary {
                key: p.key,
                name: p.name,
            }));
            if page.is_last || fetched == 0 || out.len() >= MAX_PROJECTS {
                break;
            }
            start += fetched;
        }
        Ok(out)
    }

    /// The status names one project's workflows use that are *not* in the Done
    /// category — the candidates for the todo tab's ignore list. Done-category
    /// statuses are left out because the query already excludes them.
    pub async fn project_open_statuses(&self, project_key: &str) -> Result<Vec<String>, String> {
        let raw: Vec<RawIssueTypeStatuses> = self
            .get_json(
                &format!("/rest/api/3/project/{project_key}/statuses"),
                &[],
                "project statuses",
            )
            .await?;
        Ok(open_status_names(raw))
    }

    pub async fn search_issues(
        &self,
        jql: &str,
        max_results: u32,
    ) -> Result<Vec<IssueSummary>, String> {
        self.search_issues_fields(jql, max_results, "summary,issuetype")
            .await
    }

    /// Like [`Self::search_issues`], but also carries each issue's `updated`
    /// timestamp — what the missing-worklog scan keys its cache on.
    async fn search_issues_dated(
        &self,
        jql: &str,
        max_results: u32,
    ) -> Result<Vec<IssueSummary>, String> {
        Ok(self.search_issues_dated_page(jql, max_results).await?.0)
    }

    /// As [`search_issues_dated`](Self::search_issues_dated), plus whether
    /// Jira reported a further page. Callers that present their result as
    /// complete need that flag: a page is not proof there is nothing after it.
    async fn search_issues_dated_page(
        &self,
        jql: &str,
        max_results: u32,
    ) -> Result<(Vec<IssueSummary>, bool), String> {
        self.search_issues_fields_page(jql, max_results, "summary,updated")
            .await
    }

    /// Issues assigned to the current user whose due date falls in a window
    /// around today — the data behind the dashboard's "due soon" list.
    pub async fn due_issues(&self) -> Result<Vec<IssueSummary>, String> {
        let jql = "assignee = currentUser() AND due >= -7d AND due <= 14d \
                   AND statusCategory != Done ORDER BY due ASC";
        self.search_issues_fields(jql, 50, "summary,duedate,issuetype")
            .await
    }

    /// Issues matching one of the palette's searches. The same fields a todo row
    /// draws, since that is what the results are shown as.
    /// Issues matching one of the palette's searches, and whether Jira had more
    /// to give.
    ///
    /// The flag is carried rather than dropped because of what these searches
    /// promise: "every issue for this plant" is the question, closed issues are
    /// deliberately kept, and a hundred rows of history is an ordinary result.
    /// A full page presented as a complete answer is the one way this feature
    /// can be confidently wrong — the reader counts a hundred, concludes the
    /// hundred-and-first does not exist, and nothing on screen disagrees.
    pub async fn search_issues_rows(&self, jql: &str) -> Result<(Vec<IssueSummary>, bool), String> {
        self.search_issues_fields_page(jql, SEARCH_ROW_LIMIT, "summary,status,priority,issuetype")
            .await
    }

    /// Issues waiting on the current user — see [`build_todo_jql`].
    ///
    /// Deliberately without `duedate`: due dates are the start tab's subject,
    /// and an extra badge here would only break the column alignment.
    pub async fn todo_issues(&self, cfg: &TodoConfig) -> Result<Vec<IssueSummary>, String> {
        let issues = self
            .search_issues_fields(
                &build_todo_jql(cfg),
                100,
                "summary,status,priority,issuetype",
            )
            .await?;
        Ok(drop_ignored_statuses(issues, cfg))
    }

    async fn search_issues_fields(
        &self,
        jql: &str,
        max_results: u32,
        fields: &str,
    ) -> Result<Vec<IssueSummary>, String> {
        Ok(self
            .search_issues_fields_page(jql, max_results, fields)
            .await?
            .0)
    }

    /// One page of a search, with Jira's own word on whether more follows.
    async fn search_issues_fields_page(
        &self,
        jql: &str,
        max_results: u32,
        fields: &str,
    ) -> Result<(Vec<IssueSummary>, bool), String> {
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
        let has_more = parsed.next_page_token.is_some();
        let issues = parsed
            .issues
            .into_iter()
            .map(|i| IssueSummary {
                key: i.key,
                summary: i.fields.summary,
                due_date: i.fields.duedate,
                updated: i.fields.updated,
                status: i.fields.status.map(|s| s.name),
                priority: i.fields.priority.map(|p| p.name),
                // Split in two: the name is what the tooltip says, the URL is
                // what the icon is fetched by, and a type can arrive with no
                // icon of its own.
                issue_type: i.fields.issuetype.as_ref().map(|t| t.name.clone()),
                issue_type_icon: i
                    .fields
                    .issuetype
                    .and_then(|t| t.icon_url)
                    .filter(|u| !u.is_empty()),
            })
            .collect();
        Ok((issues, has_more))
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
            .buffer_unordered(MAX_INFLIGHT)
            .try_collect()
            .await?;

        let mut entries = Vec::new();
        for (issue, worklogs) in per_issue {
            for w in worklogs {
                // Author first: an issue several people book time on returns
                // all of their worklogs, and flattening a colleague's ADF
                // comment only to discard it is the most expensive way to
                // skip a row.
                let author_id = w.author.map(|a| a.account_id).unwrap_or_default();
                if author_id != account_id {
                    continue;
                }
                let (billable, comment) =
                    split_billable(w.comment.as_ref().map(adf_to_text).unwrap_or_default());
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

// ----- Small shared helpers -----

fn net_err(e: reqwest::Error) -> String {
    format!("network error: {e}")
}

/// Pull `errorMessages[0]` / first `errors` value out of a Jira error body.
fn extract_error_message(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    if let Some(arr) = v.get("errorMessages").and_then(|m| m.as_array()) {
        if let Some(first) = arr.first().and_then(|m| m.as_str()) {
            return Some(first.to_string());
        }
    }
    // `errors` is keyed by field id, and the key is the more useful half: the
    // message alone ("Operation value must be an Atlassian Document") leaves
    // the reader guessing which of a screen's fields it is about.
    if let Some(errors) = v.get("errors").and_then(|m| m.as_object()) {
        let named: Vec<String> = errors
            .iter()
            .filter_map(|(field, msg)| Some(format!("{field}: {}", msg.as_str()?)))
            .collect();
        if !named.is_empty() {
            return Some(named.join("; "));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cached_page(updated: Option<&str>, fetched_at: i64) -> CachedComments {
        CachedComments {
            updated: updated.map(str::to_string),
            fetched_at,
            comments: Vec::new(),
        }
    }

    #[test]
    fn a_field_error_names_the_field_it_is_about() {
        let body = r#"{"errorMessages":[],"errors":{"customfield_10052":"Operation value must be an Atlassian Document"}}"#;
        assert_eq!(
            extract_error_message(body).as_deref(),
            Some("customfield_10052: Operation value must be an Atlassian Document")
        );
    }

    #[test]
    fn several_field_errors_are_all_reported() {
        let body = r#"{"errors":{"a":"first","b":"second"}}"#;
        let msg = extract_error_message(body).expect("message");
        assert!(msg.contains("a: first"), "{msg}");
        assert!(msg.contains("b: second"), "{msg}");
    }

    #[test]
    fn a_general_error_still_reads_as_a_sentence() {
        let body = r#"{"errorMessages":["Issue does not exist"],"errors":{}}"#;
        assert_eq!(
            extract_error_message(body).as_deref(),
            Some("Issue does not exist")
        );
    }

    #[test]
    fn a_comment_page_is_reused_until_the_issue_moves_or_it_expires() {
        let now = 1_700_000_000;
        let stamp = Some("2026-08-19T10:00:00.000+0200");
        let page = cached_page(stamp, now);

        assert!(page.is_fresh_for(stamp, now));
        // The issue was touched, so a comment may have been written or edited.
        assert!(!page.is_fresh_for(Some("2026-08-19T11:00:00.000+0200"), now));
        // Still provably current, but dropped anyway to bound the map.
        assert!(!page.is_fresh_for(stamp, now + COMMENT_CACHE_SECS));
    }

    #[test]
    fn a_page_without_a_timestamp_is_never_reused() {
        // Nothing to compare against means the page cannot be proved current.
        let now = 1_700_000_000;
        let stamp = Some("2026-08-19T10:00:00.000+0200");

        assert!(!cached_page(None, now).is_fresh_for(stamp, now));
        assert!(!cached_page(stamp, now).is_fresh_for(None, now));
        assert!(!cached_page(None, now).is_fresh_for(None, now));
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
}

/// Round-trip tests for the worklog fan-out and the shared error handling,
/// over a real HTTP server. See [`test_support`] for why a server rather than
/// a stubbed transport.
#[cfg(test)]
mod http_tests {
    use serde_json::json;
    use wiremock::MockServer;

    use super::test_support::{client_for, mount_get_failing, mount_get_matching, requests_to};

    const ME: &str = "acc-me";
    const SOMEBODY_ELSE: &str = "acc-them";

    fn adf(text: &str) -> serde_json::Value {
        json!({
            "type": "doc",
            "version": 1,
            "content": [{
                "type": "paragraph",
                "content": [{ "type": "text", "text": text }]
            }]
        })
    }

    fn worklog(
        id: &str,
        account: &str,
        started: &str,
        seconds: i64,
        comment: Option<&str>,
    ) -> serde_json::Value {
        let mut w = json!({
            "id": id,
            "author": { "accountId": account },
            "started": started,
            "timeSpentSeconds": seconds,
        });
        if let Some(text) = comment {
            w["comment"] = adf(text);
        }
        w
    }

    /// A site whose search finds `issues` and whose every issue carries the
    /// same `worklogs`.
    async fn site_with_worklogs(
        issues: serde_json::Value,
        worklogs: serde_json::Value,
    ) -> MockServer {
        let server = MockServer::start().await;
        mount_get_matching(
            &server,
            r"^/rest/api/3/search/jql$",
            json!({ "issues": issues }),
        )
        .await;
        mount_get_matching(
            &server,
            r"^/rest/api/3/issue/[^/]+/worklog$",
            json!({ "worklogs": worklogs }),
        )
        .await;
        server
    }

    fn one_issue() -> serde_json::Value {
        json!([{ "key": "ABC-1", "fields": { "summary": "Replace the pump" } }])
    }

    #[tokio::test]
    async fn only_my_own_worklogs_come_back() {
        // The search finds issues *somebody* logged on; each issue's worklogs
        // then arrive whole, colleagues' included.
        let server = site_with_worklogs(
            one_issue(),
            json!([
                worklog("1", ME, "2026-03-15T09:00:00.000+0100", 3600, None),
                worklog(
                    "2",
                    SOMEBODY_ELSE,
                    "2026-03-15T10:00:00.000+0100",
                    7200,
                    None
                ),
            ]),
        )
        .await;

        let entries = client_for(&server)
            .my_worklogs(ME, "2026-03-15", "2026-03-15")
            .await
            .expect("worklogs");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "1");
        assert_eq!(entries[0].time_spent_seconds, 3600);
    }

    #[tokio::test]
    async fn a_worklog_outside_the_window_is_dropped() {
        // `startedAfter` narrows the query but does not close it: it is set a
        // day early, and the far end is not bounded at all.
        let server = site_with_worklogs(
            one_issue(),
            json!([
                worklog("before", ME, "2026-03-14T23:00:00.000+0100", 60, None),
                worklog("inside", ME, "2026-03-15T09:00:00.000+0100", 60, None),
                worklog("after", ME, "2026-03-16T09:00:00.000+0100", 60, None),
            ]),
        )
        .await;

        let entries = client_for(&server)
            .my_worklogs(ME, "2026-03-15", "2026-03-15")
            .await
            .expect("worklogs");

        let ids: Vec<&str> = entries.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["inside"]);
    }

    #[tokio::test]
    async fn entries_carry_their_issue_and_are_newest_first() {
        let server = site_with_worklogs(
            one_issue(),
            json!([
                worklog("early", ME, "2026-03-15T09:00:00.000+0100", 60, None),
                worklog("late", ME, "2026-03-15T16:30:00.000+0100", 60, None),
            ]),
        )
        .await;

        let entries = client_for(&server)
            .my_worklogs(ME, "2026-03-15", "2026-03-15")
            .await
            .expect("worklogs");

        assert_eq!(entries[0].id, "late");
        assert_eq!(entries[0].time, "16:30");
        assert_eq!(entries[0].date, "2026-03-15");
        assert_eq!(entries[0].issue_key, "ABC-1");
        assert_eq!(entries[0].issue_summary, "Replace the pump");
    }

    #[tokio::test]
    async fn the_billable_marker_is_decoded_rather_than_shown() {
        // ActivityTimeline encodes non-billable as a leading `~`. The user
        // wrote the comment; they did not write the tilde.
        let server = site_with_worklogs(
            one_issue(),
            json!([
                worklog(
                    "b",
                    ME,
                    "2026-03-15T09:00:00.000+0100",
                    60,
                    Some("real work")
                ),
                worklog("n", ME, "2026-03-15T10:00:00.000+0100", 60, Some("~rework")),
            ]),
        )
        .await;

        let entries = client_for(&server)
            .my_worklogs(ME, "2026-03-15", "2026-03-15")
            .await
            .expect("worklogs");

        let non_billable = entries
            .iter()
            .find(|e| e.id == "n")
            .expect("the marked one");
        assert!(!non_billable.billable);
        assert_eq!(non_billable.comment, "rework");

        let billable = entries.iter().find(|e| e.id == "b").expect("the plain one");
        assert!(billable.billable);
        assert_eq!(billable.comment, "real work");
    }

    #[tokio::test]
    async fn a_week_with_nothing_logged_is_empty_rather_than_an_error() {
        let server = site_with_worklogs(json!([]), json!([])).await;

        let entries = client_for(&server)
            .my_worklogs(ME, "2026-03-09", "2026-03-15")
            .await
            .expect("worklogs");

        assert!(entries.is_empty());
    }

    #[tokio::test]
    async fn every_candidate_issue_is_asked_about() {
        // The fan-out is what makes the month view quick; a search hit whose
        // worklogs were never fetched would silently lose the time on it.
        let server = site_with_worklogs(
            json!([
                { "key": "ABC-1", "fields": { "summary": "One" } },
                { "key": "ABC-2", "fields": { "summary": "Two" } },
                { "key": "ABC-3", "fields": { "summary": "Three" } },
            ]),
            json!([worklog("1", ME, "2026-03-15T09:00:00.000+0100", 60, None)]),
        )
        .await;

        let entries = client_for(&server)
            .my_worklogs(ME, "2026-03-15", "2026-03-15")
            .await
            .expect("worklogs");

        assert_eq!(entries.len(), 3);
        assert_eq!(requests_to(&server, "/worklog").await, 3);
    }

    #[tokio::test]
    async fn one_failing_issue_fails_the_whole_read() {
        // A month silently missing one issue's time is worse than an error:
        // the totals would look right and be wrong.
        let server = MockServer::start().await;
        mount_get_matching(
            &server,
            r"^/rest/api/3/search/jql$",
            json!({ "issues": one_issue() }),
        )
        .await;
        mount_get_failing(
            &server,
            r"^/rest/api/3/issue/[^/]+/worklog$",
            500,
            json!({ "errorMessages": ["Internal server error"] }),
        )
        .await;

        let err = client_for(&server)
            .my_worklogs(ME, "2026-03-15", "2026-03-15")
            .await
            .err()
            .expect("a failed worklog fetch must not read as an empty month");
        assert!(err.contains("500"), "{err}");
    }

    #[tokio::test]
    async fn a_jira_error_body_becomes_the_message_the_user_sees() {
        let server = MockServer::start().await;
        mount_get_failing(
            &server,
            r"^/rest/api/3/search/jql$",
            400,
            json!({ "errorMessages": ["The JQL query is malformed"], "errors": {} }),
        )
        .await;

        let err = client_for(&server)
            .search_issues("nonsense", 10)
            .await
            .err()
            .expect("a rejected search must be an error");
        assert!(err.contains("400"), "{err}");
        assert!(err.contains("The JQL query is malformed"), "{err}");
    }

    #[tokio::test]
    async fn a_response_that_is_not_jiras_error_json_still_reads_as_something() {
        // A proxy's HTML page, say. The raw body stands in, bounded so it
        // cannot flood the log or the error banner.
        let server = MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path_regex(r"^/rest/api/3/search/jql$"))
            .respond_with(
                wiremock::ResponseTemplate::new(502).set_body_string("<html>Bad Gateway</html>"),
            )
            .mount(&server)
            .await;

        let err = client_for(&server)
            .search_issues("", 10)
            .await
            .err()
            .expect("a gateway error must be an error");
        assert!(err.contains("502"), "{err}");
        // Bounded, so a proxy's whole HTML page cannot reach the log or the
        // error banner. `assert!` with a formatted message would leave the
        // message arm as an uncovered line for no diagnostic gain here.
        assert!(err.len() < 700);
    }

    #[tokio::test]
    async fn a_comment_page_is_fetched_once_and_reused_while_the_issue_is_untouched() {
        // Both background scans read the same page; without the cache the
        // heaviest call in the app happened twice whenever they coincided.
        let server = MockServer::start().await;
        mount_get_matching(
            &server,
            r"^/rest/api/3/issue/[^/]+/comment$",
            json!({ "comments": [
                { "id": "1", "created": "2026-03-15T09:00:00.000+0100", "body": adf("hello") }
            ]}),
        )
        .await;
        let client = client_for(&server);
        let stamp = Some("2026-03-15T11:00:00.000+0100");

        let first = client.recent_comments("ABC-1", stamp).await;
        let second = client.recent_comments("ABC-1", stamp).await;

        assert_eq!(first.expect("first").len(), 1);
        assert_eq!(second.expect("second").len(), 1);
        assert_eq!(requests_to(&server, "/comment").await, 1);
    }

    #[tokio::test]
    async fn a_comment_page_is_refetched_once_the_issue_moves() {
        let server = MockServer::start().await;
        mount_get_matching(
            &server,
            r"^/rest/api/3/issue/[^/]+/comment$",
            json!({ "comments": [] }),
        )
        .await;
        let client = client_for(&server);

        client
            .recent_comments("ABC-1", Some("2026-03-15T11:00:00.000+0100"))
            .await
            .ok();
        client
            .recent_comments("ABC-1", Some("2026-03-15T12:00:00.000+0100"))
            .await
            .ok();

        assert_eq!(requests_to(&server, "/comment").await, 2);
    }

    #[tokio::test]
    async fn a_page_that_cannot_prove_itself_current_is_never_served_from_cache() {
        // The issue view reads with no stamp on purpose; caching that would
        // evict the entries the background scans depend on.
        let server = MockServer::start().await;
        mount_get_matching(
            &server,
            r"^/rest/api/3/issue/[^/]+/comment$",
            json!({ "comments": [] }),
        )
        .await;
        let client = client_for(&server);

        client.recent_comments("ABC-1", None).await.ok();
        client.recent_comments("ABC-1", None).await.ok();

        assert_eq!(requests_to(&server, "/comment").await, 2);
    }
}

//! Thin async client over the Jira Cloud REST API v3.
//! All HTTP happens here in Rust (never in the webview) so that the API token
//! stays out of the frontend and we sidestep browser CORS restrictions.
//!
//! Submodules: `types` holds the response shapes, `missing` the
//! missing-worklog reminder heuristic, `mentions` the @-mention inbox,
//! `issue` the single-issue view behind the todo tab, `attachments` the file
//! transfers that view needs, and `links` the work items it is linked to.

mod attachments;
mod issue;
mod links;
mod mentions;
mod missing;
mod types;

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone};
use futures_util::{stream, StreamExt, TryStreamExt};
use serde::de::DeserializeOwned;

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

/// The todo tab's JQL: everything the current user is expected to act on.
///
/// Two rules, OR'ed: issues in the escalation project that *I* raised, plus
/// issues assigned to me anywhere. Both start from `statusCategory != Done`
/// and subtract the statuses the user ignores. The author rule is already
/// pinned to one project, so only that project's list applies to it; the
/// assignee rule spans every project, so each project's list is subtracted
/// separately. Most urgent first, then most recently touched.
pub fn build_todo_jql(cfg: &TodoConfig) -> String {
    let author_ignored = cfg
        .ignored_statuses
        .get(&cfg.author_project)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let author = format!(
        "(project = \"{}\" AND {} AND creator = currentUser())",
        escape_jql(&cfg.author_project),
        open_in_one_project(author_ignored),
    );
    let assignee = format!(
        "({} AND assignee = currentUser())",
        open_across_projects(&cfg.ignored_statuses),
    );
    format!("({author} OR {assignee}) ORDER BY priority DESC, updated DESC")
}

/// "Still needs somebody", for a clause whose project is already pinned: the
/// status names alone are enough to subtract.
///
/// `statusCategory != Done` carries the clause on its own when nothing is
/// ignored — which it has to, since `status not in ()` is a JQL syntax error.
fn open_in_one_project(ignored: &[String]) -> String {
    if ignored.is_empty() {
        return "statusCategory != Done".to_string();
    }
    format!(
        "statusCategory != Done AND status NOT IN ({})",
        quoted(ignored)
    )
}

/// "Still needs somebody", across every project: each configured project
/// subtracts only its own statuses, so ignoring "In Arbeit" in one workflow
/// leaves it visible in the others. Projects with nothing ignored contribute
/// no term at all.
fn open_across_projects(ignored: &BTreeMap<String, Vec<String>>) -> String {
    let mut clause = "statusCategory != Done".to_string();
    for (project, statuses) in ignored {
        if statuses.is_empty() {
            continue;
        }
        clause.push_str(&format!(
            " AND NOT (project = \"{}\" AND status IN ({}))",
            escape_jql(project),
            quoted(statuses),
        ));
    }
    clause
}

/// The ignore list once more, over the issues that came back.
///
/// JQL resolves a status *name* to the status that literally carries it, so a
/// site whose workflows hold both "IN PROGRESS" and "In Progress" keeps
/// whichever spelling the user didn't tick — and the picker offers only one of
/// them, since it collapses case variants ([`open_status_names`]). Settings
/// treat the names case-insensitively throughout, so the rule is applied here
/// too, where each issue's actual status is known and no name resolution is in
/// the way.
///
/// The project comes from the issue key rather than a field, so it costs no
/// extra column in the search.
fn drop_ignored_statuses(issues: Vec<IssueSummary>, cfg: &TodoConfig) -> Vec<IssueSummary> {
    issues
        .into_iter()
        .filter(|issue| {
            let Some(status) = issue.status.as_deref() else {
                return true;
            };
            let project = issue
                .key
                .split_once('-')
                .map(|(project, _)| project)
                .unwrap_or(&issue.key)
                .to_lowercase();
            let status = status.to_lowercase();
            !cfg.ignored_statuses
                .iter()
                .filter(|(key, _)| key.to_lowercase() == project)
                .flat_map(|(_, names)| names)
                .any(|name| name.to_lowercase() == status)
        })
        .collect()
}

/// `"a", "b"` — JQL-escaped and quoted, ready for an `IN (…)` list.
fn quoted(names: &[String]) -> String {
    names
        .iter()
        .map(|s| format!("\"{}\"", escape_jql(s)))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Flatten `/project/{key}/statuses` down to the names worth offering: Jira
/// answers per issue type, so the same status arrives once per type that uses
/// it. Deduped case-insensitively and sorted, so the picker is stable.
///
/// Split out from the request purely so it can be tested without a network
/// call.
fn open_status_names(raw: Vec<RawIssueTypeStatuses>) -> Vec<String> {
    let mut names: Vec<String> = raw
        .into_iter()
        .flat_map(|t| t.statuses)
        // A status with no category is kept: offering one too many beats
        // hiding a real status the user wants to filter on.
        .filter(|s| {
            !s.name.is_empty()
                && s.status_category
                    .as_ref()
                    .is_none_or(|c| !c.key.eq_ignore_ascii_case("done"))
        })
        .map(|s| s.name)
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    names
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

/// Wrap plain text in an ADF doc, one paragraph per line.
///
/// [`adf_paragraph`]'s single-paragraph form is right for a worklog comment
/// (a one-liner) but would run a multi-line issue comment together into one
/// block. Blank lines are dropped: they are paragraph separators in the
/// textarea, and ADF spells that out with the paragraph nodes themselves.
fn adf_doc(text: &str, mentions: &[MentionRef]) -> serde_json::Value {
    let paragraphs: Vec<serde_json::Value> = text
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.is_empty())
        .map(|line| {
            serde_json::json!({
                "type": "paragraph",
                "content": adf_inline(line, mentions)
            })
        })
        .collect();
    if paragraphs.is_empty() {
        return adf_paragraph("");
    }
    serde_json::json!({ "type": "doc", "version": 1, "content": paragraphs })
}

/// Split one line into text runs and mention nodes.
///
/// A real mention is a node carrying an account id, not the characters
/// "@Malte Polzin" — typed as plain text those look right in the timeline and
/// notify nobody, which is the worse failure of the two. The webview says
/// which names it meant as mentions; this turns those spans into nodes and
/// leaves every other `@` exactly as typed.
///
/// Longest name first, so "@Anna Leeson" is not read as "@Anna" followed by
/// the word "Leeson". Two people sharing a display name are indistinguishable
/// here by construction — the first match wins, which is the only thing plain
/// text can support.
fn adf_inline(line: &str, mentions: &[MentionRef]) -> Vec<serde_json::Value> {
    let mut by_length: Vec<&MentionRef> = mentions.iter().filter(|m| !m.name.is_empty()).collect();
    by_length.sort_by_key(|m| std::cmp::Reverse(m.name.len()));

    let mut nodes: Vec<serde_json::Value> = Vec::new();
    let mut pending = String::new();
    let mut idx = 0;

    while let Some(offset) = line[idx..].find('@') {
        let at = idx + offset;
        let after = &line[at + 1..];
        match by_length.iter().find(|m| after.starts_with(&m.name)) {
            Some(m) => {
                pending.push_str(&line[idx..at]);
                if !pending.is_empty() {
                    nodes.push(serde_json::json!({ "type": "text", "text": pending }));
                    pending = String::new();
                }
                nodes.push(serde_json::json!({
                    "type": "mention",
                    "attrs": { "id": m.account_id, "text": format!("@{}", m.name) }
                }));
                idx = at + 1 + m.name.len();
            }
            None => {
                // Not a mention: keep the "@" and carry on past it.
                pending.push_str(&line[idx..=at]);
                idx = at + 1;
            }
        }
    }

    pending.push_str(&line[idx..]);
    if !pending.is_empty() || nodes.is_empty() {
        nodes.push(serde_json::json!({ "type": "text", "text": pending }));
    }
    nodes
}

/// Flatten an ADF document to plain text by collecting all `text` nodes,
/// with a newline at each block boundary so paragraphs and list items stay
/// apart.
///
/// Mentions carry their rendered form ("@Malte Polzin") in `attrs.text`
/// instead, and dropping it would leave a hole in the middle of the sentence —
/// exactly where the mentions inbox has the most to say.
///
/// The line breaks are new; the callers that predate them (the mentions inbox
/// and the missing-worklog scan) pipe the result through `excerpt`, which
/// collapses whitespace back to single spaces.
fn adf_to_text(value: &serde_json::Value) -> String {
    /// Node types that end a line — everything else flows inline.
    const BLOCKS: [&str; 8] = [
        "paragraph",
        "heading",
        "listItem",
        "blockquote",
        "codeBlock",
        "rule",
        "hardBreak",
        "mediaSingle",
    ];

    fn walk(v: &serde_json::Value, out: &mut String) {
        match v {
            serde_json::Value::Object(map) => {
                if let Some(serde_json::Value::String(t)) = map.get("text") {
                    out.push_str(t);
                } else if let Some(serde_json::Value::String(t)) =
                    map.get("attrs").and_then(|a| a.get("text"))
                {
                    out.push_str(t);
                }
                if let Some(content) = map.get("content") {
                    walk(content, out);
                }
                let is_block = map
                    .get("type")
                    .and_then(|t| t.as_str())
                    .is_some_and(|t| BLOCKS.contains(&t));
                // Never two in a row: a list item inside a paragraph inside a
                // list would otherwise open a gap per nesting level.
                if is_block && !out.is_empty() && !out.ends_with('\n') {
                    out.push('\n');
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
    out.trim_end().to_string()
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
    fn adf_doc_keeps_a_multi_line_comment_apart() {
        let doc = adf_doc("First line\n\nSecond line", &[]);
        let paragraphs = doc["content"].as_array().expect("content");
        assert_eq!(
            paragraphs.len(),
            2,
            "blank lines are separators, not content"
        );
        assert_eq!(paragraphs[0]["content"][0]["text"], "First line");
        assert_eq!(paragraphs[1]["content"][0]["text"], "Second line");
        // And it survives the round trip the activity feed makes.
        assert_eq!(adf_to_text(&doc), "First line\nSecond line");
    }

    fn mention_ref(name: &str, id: &str) -> MentionRef {
        MentionRef {
            account_id: id.to_string(),
            name: name.to_string(),
        }
    }

    #[test]
    fn adf_doc_turns_a_named_span_into_a_mention_node() {
        let doc = adf_doc(
            "Hi @Malte Polzin, please look",
            &[mention_ref("Malte Polzin", "acc-1")],
        );
        let content = doc["content"][0]["content"].as_array().expect("content");
        assert_eq!(content.len(), 3);
        assert_eq!(content[0]["text"], "Hi ");
        assert_eq!(content[1]["type"], "mention");
        // The id is what notifies somebody; the text is only what is rendered.
        assert_eq!(content[1]["attrs"]["id"], "acc-1");
        assert_eq!(content[1]["attrs"]["text"], "@Malte Polzin");
        assert_eq!(content[2]["text"], ", please look");
    }

    #[test]
    fn an_at_sign_nobody_picked_stays_plain_text() {
        // Typing an address or a stray "@" must not become a broken mention.
        let doc = adf_doc("mail me @ malte@polz.in", &[]);
        let content = doc["content"][0]["content"].as_array().expect("content");
        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[0]["text"], "mail me @ malte@polz.in");
    }

    #[test]
    fn the_longest_matching_name_wins() {
        // Otherwise "@Anna Leeson" is read as "@Anna" plus the word "Leeson".
        let doc = adf_doc(
            "@Anna Leeson ping",
            &[
                mention_ref("Anna", "short"),
                mention_ref("Anna Leeson", "long"),
            ],
        );
        let content = doc["content"][0]["content"].as_array().expect("content");
        assert_eq!(content[0]["attrs"]["id"], "long");
        assert_eq!(content[1]["text"], " ping");
    }

    #[test]
    fn several_mentions_on_one_line_all_become_nodes() {
        let doc = adf_doc(
            "@A and @B",
            &[mention_ref("A", "acc-a"), mention_ref("B", "acc-b")],
        );
        let content = doc["content"][0]["content"].as_array().expect("content");
        let ids: Vec<&str> = content
            .iter()
            .filter(|n| n["type"] == "mention")
            .map(|n| n["attrs"]["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["acc-a", "acc-b"]);
    }

    #[test]
    fn a_mention_survives_the_round_trip_the_timeline_makes() {
        let doc = adf_doc("Hi @Malte Polzin", &[mention_ref("Malte Polzin", "acc-1")]);
        assert_eq!(adf_to_text(&doc), "Hi @Malte Polzin");
    }

    #[test]
    fn a_name_the_user_deleted_from_the_text_simply_is_not_found() {
        // The webview keeps the pick after the characters are edited away;
        // nothing to substitute is not an error.
        let doc = adf_doc("nothing here", &[mention_ref("Malte Polzin", "acc-1")]);
        let content = doc["content"][0]["content"].as_array().expect("content");
        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["type"], "text");
    }

    #[test]
    fn a_mention_at_the_very_end_of_a_line_is_still_a_node() {
        let doc = adf_doc(
            "ping @Malte Polzin",
            &[mention_ref("Malte Polzin", "acc-1")],
        );
        let content = doc["content"][0]["content"].as_array().expect("content");
        assert_eq!(content.len(), 2);
        assert_eq!(content[1]["type"], "mention");
    }

    #[test]
    fn adf_doc_of_nothing_is_still_a_valid_doc() {
        let doc = adf_doc("   \n\n  ", &[]);
        assert_eq!(doc["type"], "doc");
        assert_eq!(adf_to_text(&doc), "");
    }

    #[test]
    fn adf_to_text_breaks_lines_at_blocks_only() {
        let doc = serde_json::json!({
            "type": "doc",
            "version": 1,
            "content": [
                { "type": "paragraph", "content": [
                    { "type": "text", "text": "Hi " },
                    { "type": "mention", "attrs": { "text": "@Malte Polzin" } },
                    { "type": "text", "text": ", see:" }
                ]},
                { "type": "bulletList", "content": [
                    { "type": "listItem", "content": [
                        { "type": "paragraph", "content": [{ "type": "text", "text": "one" }] }
                    ]},
                    { "type": "listItem", "content": [
                        { "type": "paragraph", "content": [{ "type": "text", "text": "two" }] }
                    ]}
                ]}
            ]
        });
        // Inline nodes stay on their line; nested blocks don't stack breaks.
        assert_eq!(adf_to_text(&doc), "Hi @Malte Polzin, see:\none\ntwo");
    }

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

    fn todo_cfg(ignored: &[(&str, &[&str])]) -> TodoConfig {
        TodoConfig {
            author_project: "DEV".to_string(),
            ignored_statuses: ignored
                .iter()
                .map(|(project, statuses)| {
                    (
                        project.to_string(),
                        statuses.iter().map(|s| s.to_string()).collect(),
                    )
                })
                .collect(),
        }
    }

    #[test]
    fn todo_jql_covers_both_rules() {
        let cfg = todo_cfg(&[("DEV", &["Rückfrage beantwortet"])]);
        assert_eq!(
            build_todo_jql(&cfg),
            "((project = \"DEV\" AND statusCategory != Done \
             AND status NOT IN (\"Rückfrage beantwortet\") \
             AND creator = currentUser()) OR (statusCategory != Done \
             AND NOT (project = \"DEV\" AND status IN (\"Rückfrage beantwortet\")) \
             AND assignee = currentUser())) ORDER BY priority DESC, updated DESC"
        );
    }

    #[test]
    fn todo_jql_keeps_each_project_to_its_own_statuses() {
        // The whole point of per-project lists: "In Arbeit" ignored in OPS
        // must stay visible in DEV.
        let jql = build_todo_jql(&todo_cfg(&[
            ("OPS", &["In Arbeit"]),
            ("SUP", &["Waiting for customer"]),
        ]));
        assert!(jql.contains("NOT (project = \"OPS\" AND status IN (\"In Arbeit\"))"));
        assert!(jql.contains("NOT (project = \"SUP\" AND status IN (\"Waiting for customer\"))"));
        // Nothing ignored in the escalation project, so its rule is unnarrowed.
        assert!(jql.contains("(project = \"DEV\" AND statusCategory != Done AND creator"));
    }

    #[test]
    fn todo_jql_filters_both_clauses_on_status_category() {
        // Both rules have to be narrowed, or the tab fills with done issues
        // through whichever half was left open.
        let jql = build_todo_jql(&todo_cfg(&[("DEV", &["Backlog"])]));
        assert_eq!(jql.matches("statusCategory != Done").count(), 2);
    }

    #[test]
    fn todo_jql_stays_valid_without_ignored_statuses() {
        // `status not in ()` would be a syntax error; the category rule has to
        // carry the clause on its own. An empty list contributes no term.
        let jql = build_todo_jql(&todo_cfg(&[("OPS", &[])]));
        assert!(!jql.contains("NOT IN"));
        assert!(!jql.contains("OPS"));
        assert_eq!(jql.matches("statusCategory != Done").count(), 2);
    }

    fn todo_issue(key: &str, status: &str) -> IssueSummary {
        IssueSummary {
            key: key.to_string(),
            summary: "whatever".to_string(),
            due_date: None,
            updated: None,
            status: Some(status.to_string()),
            priority: None,
            issue_type: None,
            issue_type_icon: None,
        }
    }

    fn kept(cfg: &TodoConfig, issues: &[(&str, &str)]) -> Vec<String> {
        let issues = issues.iter().map(|(k, s)| todo_issue(k, s)).collect();
        drop_ignored_statuses(issues, cfg)
            .into_iter()
            .map(|i| i.key)
            .collect()
    }

    #[test]
    fn ignored_statuses_are_dropped_whatever_their_case() {
        // The reason this sieve exists: JQL resolves "IN PROGRESS" to the
        // status literally named that, so a workflow holding both spellings
        // lets the other one through — and the picker only ever offered one,
        // having collapsed the pair.
        let cfg = todo_cfg(&[("DEV", &["IN PROGRESS"])]);
        assert_eq!(
            kept(&cfg, &[("DEV-4596", "In Progress"), ("DEV-1", "IN PROGRESS")]),
            Vec::<String>::new()
        );
    }

    #[test]
    fn ignored_statuses_stay_project_local() {
        // Same rule as the JQL: a status ignored in one project stays visible
        // in the others.
        let cfg = todo_cfg(&[("DEV", &["In Progress"])]);
        assert_eq!(
            kept(&cfg, &[("GER-1", "In Progress"), ("DEV-2", "Escalated")]),
            vec!["GER-1".to_string(), "DEV-2".to_string()]
        );
    }

    #[test]
    fn issues_without_a_status_are_kept() {
        // The todo search asks for the status field, but an issue that arrives
        // without one must not vanish over a filter it can't be judged by.
        let cfg = todo_cfg(&[("DEV", &["In Progress"])]);
        let mut issue = todo_issue("DEV-3", "In Progress");
        issue.status = None;
        assert_eq!(drop_ignored_statuses(vec![issue], &cfg).len(), 1);
    }

    #[test]
    fn todo_jql_escapes_project_and_status_names() {
        // Both come from webview-writable settings — the one place user data
        // reaches raw JQL.
        let jql = build_todo_jql(&todo_cfg(&[("OPS", &["say \"hi\"", "back\\slash"])]));
        assert!(jql.contains("\"say \\\"hi\\\"\""));
        assert!(jql.contains("\"back\\\\slash\""));
    }

    #[test]
    fn open_status_names_flattens_dedupes_and_drops_done() {
        // Jira answers per issue type, so shared statuses repeat.
        let raw: Vec<RawIssueTypeStatuses> = serde_json::from_str(
            r#"[
              {"statuses": [
                {"name": "In Arbeit", "statusCategory": {"key": "indeterminate"}},
                {"name": "Fertig", "statusCategory": {"key": "done"}}
              ]},
              {"statuses": [
                {"name": "In Arbeit", "statusCategory": {"key": "indeterminate"}},
                {"name": "Backlog", "statusCategory": {"key": "new"}},
                {"name": "Unkategorisiert"}
              ]}
            ]"#,
        )
        .expect("fixture parses");
        assert_eq!(
            open_status_names(raw),
            vec!["Backlog", "In Arbeit", "Unkategorisiert"]
        );
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

    #[test]
    fn adf_text_keeps_mentions_in_place() {
        let doc = serde_json::json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [
                    { "type": "mention", "attrs": { "id": "557058:abc", "text": "@Malte" } },
                    { "type": "text", "text": " please review" },
                ]
            }]
        });
        assert_eq!(adf_to_text(&doc), "@Malte please review");
    }
}

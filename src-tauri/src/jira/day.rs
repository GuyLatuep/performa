//! One day's evidence of work, for the timesheet's "rebuild a day" view: what
//! the user did in Jira on a given date — comments, status changes, issues
//! created, issues handed to them.
//!
//! Evidence, not proposals. Nothing here says how long anything took; the view
//! puts this next to the day's worklogs and leaves the booking to the user.
//!
//! Read only when the view is opened, never in the background. It reuses the
//! missing-worklog scan's way of finding candidates — comments are not
//! searchable by author, so recently touched issues near the user stand in —
//! but for an arbitrary date rather than the last day.

use std::collections::{HashMap, HashSet};

use chrono::{Duration, Local, NaiveDate, TimeZone};
use futures_util::{stream, StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};

use super::adf::adf_to_text;
use super::stamps::{format_rfc3339_local, parse_jira_ts};
use super::{JiraClient, COMMENT_PAGE_LIMIT, MAX_INFLIGHT};

/// One thing the user did on one issue that day.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct DayEvidence {
    /// "comment", "status", "created" or "assigned".
    pub kind: String,
    #[serde(rename = "issueKey")]
    pub issue_key: String,
    #[serde(rename = "issueSummary")]
    pub issue_summary: String,
    /// RFC3339, local time.
    pub at: String,
    /// A comment excerpt, "Old → New", or who handed the issue over.
    pub detail: String,
    /// Epoch seconds, for ordering. Backend-only.
    #[serde(skip)]
    ts: i64,
}

/// A day's evidence, and whether it is all there was to find.
#[derive(Serialize, Debug)]
pub struct DayActivity {
    pub evidence: Vec<DayEvidence>,
    /// False when a search, a comment page or a changelog page held more than
    /// was read and may have left out some of the day. The view says so
    /// rather than calling the day complete.
    pub complete: bool,
}

#[derive(Deserialize)]
struct CreatedResp {
    #[serde(default)]
    issues: Vec<CreatedIssue>,
    #[serde(rename = "nextPageToken", default)]
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
struct CreatedIssue {
    key: String,
    #[serde(default)]
    fields: Option<CreatedFields>,
}

#[derive(Deserialize)]
struct CreatedFields {
    #[serde(default)]
    summary: String,
    #[serde(default)]
    created: String,
}

/// How many issues each search may return — the most one page of the search
/// API gives with fields. Past this, the result says it may be incomplete.
const PER_SEARCH: u32 = 100;
/// The changelog page size `recent_changelog` reads, newest page only.
const CHANGELOG_PAGE: usize = 100;
const EXCERPT_CHARS: usize = 140;

/// `[start, end)` of `day` on this machine's clock, in epoch seconds.
fn local_day_bounds(day: NaiveDate) -> Result<(i64, i64), String> {
    Ok((
        day_start(&Local, day)?,
        day_start(&Local, day + Duration::days(1))?,
    ))
}

/// When `day` begins in `tz`, in epoch seconds: its midnight — or, where a
/// daylight-saving change skips midnight (it does in some zones), the first
/// moment of the day that exists. Checked a quarter hour at a time; no zone
/// skips more than a couple of hours.
fn day_start<Tz: TimeZone>(tz: &Tz, day: NaiveDate) -> Result<i64, String> {
    let midnight = day.and_hms_opt(0, 0, 0).expect("midnight is a valid time");
    (0..=16)
        .map(|quarter| midnight + Duration::minutes(15 * quarter))
        .find_map(|t| tz.from_local_datetime(&t).earliest())
        .map(|t| t.timestamp())
        .ok_or_else(|| format!("no local start of day on {day}"))
}

fn excerpt(text: &str) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= EXCERPT_CHARS {
        flat
    } else {
        let cut: String = flat.chars().take(EXCERPT_CHARS).collect();
        format!("{cut}…")
    }
}

impl JiraClient {
    /// What the user did in Jira on `date` (yyyy-MM-dd, this machine's day),
    /// oldest first.
    pub async fn day_activity(&self, account_id: &str, date: &str) -> Result<DayActivity, String> {
        let day = NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| format!("invalid date '{date}'"))?;
        let (from, to) = local_day_bounds(day)?;
        let in_day = |ts: i64| ts >= from && ts < to;

        // JQL reads dates in the user's Jira time zone, which need not be this
        // machine's — so search a day either side and filter exactly below.
        let before = (day - Duration::days(1)).format("%Y-%m-%d");
        let after = (day + Duration::days(2)).format("%Y-%m-%d");
        let during = format!("DURING (\"{before}\", \"{after}\")");

        let status_jql = format!("status CHANGED BY currentUser() {during} ORDER BY updated DESC");
        let assigned_jql =
            format!("assignee CHANGED TO currentUser() {during} ORDER BY updated DESC");
        let created_query = [
            (
                "jql",
                format!(
                    "creator = currentUser() AND created >= \"{before}\" \
                     AND created < \"{after}\" ORDER BY created ASC"
                ),
            ),
            ("maxResults", PER_SEARCH.to_string()),
            ("fields", "summary,created".to_string()),
        ];
        let touched_jql = format!(
            "updated >= \"{before}\" AND (issue in issueHistory() \
             OR watcher = currentUser() OR assignee = currentUser() \
             OR reporter = currentUser()) ORDER BY updated ASC"
        );
        // Oldest-updated first: for a day some weeks back, the issues last
        // touched around it are the likeliest to hold its comments, and the
        // ones busy since are the ones a full page would push out.
        let (
            (status_issues, status_more),
            (assigned_issues, assigned_more),
            created,
            (touched, touched_more),
        ) = futures_util::try_join!(
            self.search_issues_dated_page(&status_jql, PER_SEARCH),
            self.search_issues_dated_page(&assigned_jql, PER_SEARCH),
            self.get_json::<CreatedResp>("/rest/api/3/search/jql", &created_query, "search"),
            self.search_issues_dated_page(&touched_jql, PER_SEARCH),
        )?;
        let mut complete =
            !(status_more || assigned_more || touched_more || created.next_page_token.is_some());

        let mut found: Vec<DayEvidence> = Vec::new();
        for issue in created.issues {
            let Some(fields) = issue.fields else { continue };
            if let Some(ts) = parse_jira_ts(&fields.created).filter(|t| in_day(*t)) {
                found.push(DayEvidence {
                    kind: "created".to_string(),
                    issue_key: issue.key,
                    issue_summary: fields.summary,
                    at: format_rfc3339_local(ts),
                    detail: "Created".to_string(),
                    ts,
                });
            }
        }

        // Every issue worth a closer look, once, with whether its changelog
        // is needed: only where a status or assignee change is known to exist.
        let changed: HashSet<String> = status_issues
            .iter()
            .chain(assigned_issues.iter())
            .map(|i| i.key.clone())
            .collect();
        let mut candidates: HashMap<String, (String, Option<String>)> = HashMap::new();
        for issue in status_issues
            .into_iter()
            .chain(assigned_issues)
            .chain(touched)
        {
            candidates
                .entry(issue.key)
                .or_insert((issue.summary, issue.updated));
        }

        let per_issue: Vec<(Vec<DayEvidence>, bool)> = stream::iter(candidates)
            .map(|(key, (summary, updated))| {
                let needs_changelog = changed.contains(&key);
                async move {
                    let (comments, changes) = futures_util::try_join!(
                        self.recent_comments(&key, updated.as_deref()),
                        async {
                            if needs_changelog {
                                self.recent_changelog(&key).await
                            } else {
                                Ok(Vec::new())
                            }
                        },
                    )?;
                    // A full page that does not reach back to the start of
                    // the day may have cut some of it off.
                    let reaches_back = |stamps: Vec<i64>, page: usize| {
                        stamps.len() < page || stamps.iter().min().is_some_and(|t| *t < from)
                    };
                    let whole = reaches_back(
                        comments
                            .iter()
                            .filter_map(|c| parse_jira_ts(&c.created))
                            .collect(),
                        COMMENT_PAGE_LIMIT,
                    ) && reaches_back(
                        changes
                            .iter()
                            .filter_map(|e| parse_jira_ts(&e.created))
                            .collect(),
                        CHANGELOG_PAGE,
                    );
                    let mut out = Vec::new();
                    let evidence = |kind: &str, ts: i64, detail: String| DayEvidence {
                        kind: kind.to_string(),
                        issue_key: key.clone(),
                        issue_summary: summary.clone(),
                        at: format_rfc3339_local(ts),
                        detail,
                        ts,
                    };
                    for c in comments {
                        let mine =
                            c.author.as_ref().map(|a| a.account_id.as_str()) == Some(account_id);
                        if let Some(ts) = parse_jira_ts(&c.created).filter(|t| mine && in_day(*t)) {
                            let text = c.body.as_ref().map(adf_to_text).unwrap_or_default();
                            out.push(evidence("comment", ts, excerpt(&text)));
                        }
                    }
                    for e in changes {
                        let Some(ts) = parse_jira_ts(&e.created).filter(|t| in_day(*t)) else {
                            continue;
                        };
                        let by_me =
                            e.author.as_ref().map(|a| a.account_id.as_str()) == Some(account_id);
                        for item in &e.items {
                            if by_me && item.field.eq_ignore_ascii_case("status") {
                                out.push(evidence(
                                    "status",
                                    ts,
                                    format!(
                                        "{} → {}",
                                        item.from.as_deref().unwrap_or("?"),
                                        item.to.as_deref().unwrap_or("?"),
                                    ),
                                ));
                            } else if item.field.eq_ignore_ascii_case("assignee")
                                && item.to_id.as_deref() == Some(account_id)
                            {
                                let who = e
                                    .author
                                    .as_ref()
                                    .and_then(|a| a.display_name.clone())
                                    .filter(|_| !by_me);
                                out.push(evidence(
                                    "assigned",
                                    ts,
                                    match who {
                                        Some(name) => format!("Assigned to you by {name}"),
                                        None => "Assigned to you".to_string(),
                                    },
                                ));
                            }
                        }
                    }
                    Ok::<_, String>((out, whole))
                }
            })
            .buffer_unordered(MAX_INFLIGHT)
            .try_collect()
            .await?;

        for (evidence, whole) in per_issue {
            found.extend(evidence);
            complete &= whole;
        }
        found.sort_by(|a, b| a.ts.cmp(&b.ts).then(a.issue_key.cmp(&b.issue_key)));
        Ok(DayActivity {
            evidence: found,
            complete,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::*;
    use super::*;
    use serde_json::json;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const ME: &str = "me-123";
    const DAY: &str = "2026-03-10";

    /// A Jira timestamp at `hh:mm` local time on `date`.
    fn at(date: &str, hh: u32, mm: u32) -> String {
        let d = NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap();
        Local
            .from_local_datetime(&d.and_hms_opt(hh, mm, 0).unwrap())
            .earliest()
            .unwrap()
            .format("%Y-%m-%dT%H:%M:%S%.3f%z")
            .to_string()
    }

    fn adf(text: &str) -> serde_json::Value {
        json!({ "type": "doc", "version": 1, "content": [
            { "type": "paragraph", "content": [{ "type": "text", "text": text }] }
        ]})
    }

    /// One issue found by every search, carrying `comments` and `changelog`.
    async fn site(
        comments: serde_json::Value,
        changelog: serde_json::Value,
        created: serde_json::Value,
    ) -> MockServer {
        let server = MockServer::start().await;
        // The created search asks for the `created` field; the others don't.
        Mock::given(method("GET"))
            .and(path("/rest/api/3/search/jql"))
            .and(query_param("fields", "summary,created"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "issues": created })))
            .with_priority(1)
            .mount(&server)
            .await;
        mount_get(
            &server,
            "/rest/api/3/search/jql",
            json!({ "issues": [{
                "key": "ABC-1",
                "fields": { "summary": "Replace the pump", "updated": at(DAY, 18, 0) }
            }]}),
        )
        .await;
        mount_get_matching(
            &server,
            r"^/rest/api/3/issue/[^/]+/comment$",
            json!({ "comments": comments }),
        )
        .await;
        mount_get_matching(
            &server,
            r"^/rest/api/3/issue/[^/]+/changelog$",
            json!({ "values": changelog, "total": 1 }),
        )
        .await;
        server
    }

    #[tokio::test]
    async fn collects_my_comments_and_status_changes_of_that_day_in_order() {
        let server = site(
            json!([
                { "id": "1", "created": at(DAY, 14, 0), "author": { "accountId": ME }, "body": adf("swapped the seal") },
                // The day before: not this day's evidence.
                { "id": "2", "created": at("2026-03-09", 23, 30), "author": { "accountId": ME }, "body": adf("late") },
                // Somebody else's: not mine.
                { "id": "3", "created": at(DAY, 9, 0), "author": { "accountId": "other" }, "body": adf("theirs") },
            ]),
            json!([{
                "author": { "accountId": ME },
                "created": at(DAY, 9, 30),
                "items": [{ "field": "status", "fromString": "Open", "toString": "In Arbeit" }]
            }]),
            json!([]),
        )
        .await;

        let found = client_for(&server)
            .day_activity(ME, DAY)
            .await
            .expect("read")
            .evidence;

        let summary: Vec<(&str, &str)> = found
            .iter()
            .map(|e| (e.kind.as_str(), e.detail.as_str()))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("status", "Open → In Arbeit"),
                ("comment", "swapped the seal")
            ]
        );
        assert_eq!(found[0].issue_key, "ABC-1");
    }

    #[tokio::test]
    async fn names_who_handed_an_issue_over() {
        let server = site(
            json!([]),
            json!([{
                "author": { "accountId": "lead", "displayName": "A. Lead" },
                "created": at(DAY, 11, 0),
                "items": [{ "field": "assignee", "to": ME, "toString": "Me" }]
            }]),
            json!([]),
        )
        .await;

        let found = client_for(&server)
            .day_activity(ME, DAY)
            .await
            .expect("read")
            .evidence;

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, "assigned");
        assert_eq!(found[0].detail, "Assigned to you by A. Lead");
    }

    #[tokio::test]
    async fn counts_issues_i_created_that_day_only() {
        let server = site(
            json!([]),
            json!([]),
            json!([
                { "key": "NEW-1", "fields": { "summary": "Printer jam", "created": at(DAY, 8, 15) } },
                { "key": "NEW-0", "fields": { "summary": "Yesterday", "created": at("2026-03-09", 17, 0) } },
            ]),
        )
        .await;

        let found = client_for(&server)
            .day_activity(ME, DAY)
            .await
            .expect("read")
            .evidence;

        assert_eq!(found.len(), 1);
        assert_eq!(
            (found[0].kind.as_str(), found[0].issue_key.as_str()),
            ("created", "NEW-1")
        );
    }

    #[tokio::test]
    async fn asks_jira_for_a_day_either_side() {
        let server = site(json!([]), json!([]), json!([])).await;

        client_for(&server)
            .day_activity(ME, DAY)
            .await
            .expect("read");

        let jqls: Vec<String> = server
            .received_requests()
            .await
            .unwrap_or_default()
            .iter()
            .filter_map(|r| {
                r.url
                    .query_pairs()
                    .find(|(k, _)| k == "jql")
                    .map(|(_, v)| v.into_owned())
            })
            .collect();
        assert!(jqls.iter().any(|q| q
            .contains("status CHANGED BY currentUser() DURING (\"2026-03-09\", \"2026-03-12\")")));
        assert!(jqls.iter().any(|q| q.contains("creator = currentUser()")));
    }

    #[test]
    fn a_day_starts_at_midnight_where_midnight_exists() {
        let day = NaiveDate::from_ymd_opt(2026, 3, 10).unwrap();
        assert_eq!(
            day_start(&chrono::Utc, day).unwrap(),
            chrono::Utc
                .with_ymd_and_hms(2026, 3, 10, 0, 0, 0)
                .unwrap()
                .timestamp()
        );
    }

    #[tokio::test]
    async fn calls_a_small_day_complete() {
        let server = site(json!([]), json!([]), json!([])).await;

        let day = client_for(&server)
            .day_activity(ME, DAY)
            .await
            .expect("read");

        assert!(day.complete);
    }

    #[tokio::test]
    async fn says_so_when_a_full_comment_page_may_hide_part_of_the_day() {
        // A busy issue: the newest page is full and all of it is from the day
        // itself, so earlier comments that day may sit on the next page.
        let page: Vec<_> = (0..COMMENT_PAGE_LIMIT)
            .map(|i| {
                json!({
                    "id": i.to_string(),
                    "created": at(DAY, 20, (i % 60) as u32),
                    "author": { "accountId": "other" },
                    "body": adf("busy"),
                })
            })
            .collect();
        let server = site(json!(page), json!([]), json!([])).await;

        let day = client_for(&server)
            .day_activity(ME, DAY)
            .await
            .expect("read");

        assert!(!day.complete);
    }

    #[tokio::test]
    async fn says_so_when_a_search_had_more_to_give() {
        let server = MockServer::start().await;
        mount_get(
            &server,
            "/rest/api/3/search/jql",
            json!({ "issues": [], "nextPageToken": "more" }),
        )
        .await;

        let day = client_for(&server)
            .day_activity(ME, DAY)
            .await
            .expect("read");

        assert!(!day.complete);
    }

    #[tokio::test]
    async fn refuses_a_date_it_cannot_read() {
        let server = MockServer::start().await;
        let err = client_for(&server)
            .day_activity(ME, "yesterday")
            .await
            .unwrap_err();
        assert!(err.contains("invalid date"));
    }
}

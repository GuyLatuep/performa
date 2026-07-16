//! The missing-worklog reminder heuristic: find issues with recent own
//! activity (comments / status changes) that no nearby worklog covers.

use std::collections::HashSet;

use chrono::Local;
use futures_util::{stream, StreamExt, TryStreamExt};

use super::types::*;
use super::{format_rfc3339_local, parse_jira_ts, JiraClient};

impl JiraClient {
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

    async fn recent_comments(&self, issue_key: &str) -> Result<Vec<RawComment>, String> {
        let parsed: CommentListResp = self
            .get_json(
                &format!("/rest/api/3/issue/{issue_key}/comment"),
                &[
                    ("orderBy", "-created".to_string()),
                    ("maxResults", "30".to_string()),
                ],
                "comment",
            )
            .await?;
        Ok(parsed.comments)
    }

    async fn changelog_page(&self, issue_key: &str, start_at: i64) -> Result<ChangelogPage, String> {
        self.get_json(
            &format!("/rest/api/3/issue/{issue_key}/changelog"),
            &[
                ("startAt", start_at.to_string()),
                ("maxResults", "100".to_string()),
            ],
            "changelog",
        )
        .await
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
        let parsed: IssueLinksResp = self
            .get_json(
                &format!("/rest/api/3/issue/{issue_key}"),
                &[("fields", "issuelinks".to_string())],
                "issue",
            )
            .await?;

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
}

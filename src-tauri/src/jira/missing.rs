//! The missing-worklog reminder heuristic: find issues with recent own
//! activity (comments / status changes) that no nearby worklog covers.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::Local;
use futures_util::{stream, StreamExt, TryStreamExt};

use super::types::*;
use super::{adf_to_text, format_rfc3339_local, parse_jira_ts, JiraClient, MAX_INFLIGHT};

/// One thing the user did on an issue: a comment or a status change.
/// Deliberately *not* filtered by time — the scan window moves with the clock,
/// so a cached entry has to stay usable as it moves.
#[derive(Clone)]
pub(super) struct Activity {
    /// "comment" or "status".
    kind: &'static str,
    /// Epoch seconds.
    ts: i64,
    /// Comment excerpt, or "Old status → New status".
    detail: String,
}

/// What was found on one issue, plus the `updated` timestamp it was found at.
pub(super) struct CachedActivity {
    updated: Option<String>,
    /// Whether the changelog was fetched too — a scan that needs status
    /// changes cannot reuse an entry built without them.
    includes_status: bool,
    activities: Vec<Activity>,
}

impl CachedActivity {
    /// Reusable while the issue has not been touched since the entry was
    /// stored and it covers what this scan needs. A missing `updated` on
    /// either side means we cannot prove the issue is unchanged — refetch.
    fn is_fresh_for(&self, updated: Option<&str>, needs_status: bool) -> bool {
        let unchanged = matches!(
            (self.updated.as_deref(), updated),
            (Some(cached), Some(current)) if cached == current
        );
        unchanged && (!needs_status || self.includes_status)
    }
}

/// Per-issue activity cache, keyed by issue key. Shared across `JiraClient`
/// clones, which is why it is behind an `Arc`.
pub(super) type ActivityCache = Arc<tokio::sync::Mutex<HashMap<String, CachedActivity>>>;

impl JiraClient {
    /// Issues where the user recently commented or changed the status but has
    /// no own worklog whose logged period (stretched by `config.window_secs` on
    /// both sides) covers that activity. Activity younger than
    /// `config.grace_secs` is not flagged yet, so there is a chance to log
    /// before the reminder appears.
    ///
    /// Status changes are found directly via JQL. Comments are not queryable
    /// by author, so recently updated issues the user viewed (issueHistory),
    /// watches, or owns serve as candidates — viewing history also covers
    /// JSM internal comments, which don't auto-watch.
    /// Issues from `config.escalation_project` log their time on the issue they
    /// are linked to as `config.escalation_link` — when there is one and it is
    /// assigned to this user — so worklogs on either issue clear the reminder.
    pub async fn missing_worklogs(
        &self,
        account_id: &str,
        config: &MissingConfig,
    ) -> Result<Vec<MissingWorklog>, String> {
        let lookback_days = config.lookback_days;
        let now = Local::now().timestamp();
        let cutoff = now - lookback_days as i64 * 86_400;
        let flag_before = now - config.grace_secs;

        let not_closed = bookable_clause(&config.bookable_done_statuses);

        let status_issues = self
            .search_issues_dated(
                &format!(
                    "status CHANGED BY currentUser() AFTER \"-{lookback_days}d\" \
                     AND {not_closed} ORDER BY updated DESC"
                ),
                25,
            )
            .await?;
        let watched = self
            .search_issues_dated(
                &format!(
                    "updated >= \"-{lookback_days}d\" AND (issue in issueHistory() \
                     OR watcher = currentUser() OR assignee = currentUser() \
                     OR reporter = currentUser()) AND {not_closed} ORDER BY updated DESC"
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
        // Collected inside the macro so the key list is only built when debug
        // logging is actually on — the default level is `Error`.
        log::debug!(
            "missing_worklogs: {} candidate issue(s) to scan ({} status-changed): {:?}",
            candidates.len(),
            status_keys.len(),
            candidates
                .iter()
                .map(|i| i.key.as_str())
                .collect::<Vec<_>>()
        );
        let scanned: HashSet<String> = candidates.iter().map(|i| i.key.clone()).collect();

        // Candidates are independent — check them concurrently so the whole
        // scan finishes in seconds even with many recently touched issues.
        let found: Vec<(i64, MissingWorklog)> = stream::iter(candidates)
            .map(|issue| {
                let has_status_change = status_keys.contains(&issue.key);
                self.check_candidate(
                    issue,
                    has_status_change,
                    account_id,
                    cutoff,
                    flag_before,
                    config,
                )
            })
            .buffer_unordered(MAX_INFLIGHT)
            .try_collect::<Vec<Option<(i64, MissingWorklog)>>>()
            .await?
            .into_iter()
            .flatten()
            .collect();

        let mut found = drop_linked_escalations(found);

        // Issues that dropped out of the candidate set will not be asked about
        // again, so their entries would linger for the rest of the app run.
        self.activity_cache
            .lock()
            .await
            .retain(|key, _| scanned.contains(key));

        found.sort_by_key(|(ts, _)| std::cmp::Reverse(*ts));
        log::debug!(
            "missing_worklogs: {} issue(s) flagged as unlogged: {:?}",
            found.len(),
            found
                .iter()
                .map(|(_, m)| m.issue_key.as_str())
                .collect::<Vec<_>>()
        );
        Ok(found.into_iter().map(|(_, m)| m).collect())
    }

    /// Examine one candidate issue: does the user have unlogged activity on
    /// it? Returns the newest unlogged activity, keyed for sorting.
    async fn check_candidate(
        &self,
        issue: IssueSummary,
        has_status_change: bool,
        account_id: &str,
        cutoff: i64,
        flag_before: i64,
        config: &MissingConfig,
    ) -> Result<Option<(i64, MissingWorklog)>, String> {
        let activities = self
            .own_activities(&issue, has_status_change, account_id)
            .await?;
        // Filtered here, not where the activities were fetched: `cutoff` and
        // `flag_before` move with the clock, so the same cached activities
        // have to be re-judged on every scan.
        let in_window = within_window(&activities, cutoff, flag_before);
        // Nothing to judge — skip the worklog fetches entirely.
        if in_window.is_empty() {
            return Ok(None);
        }

        // Escalation-project issues log their time on the linked source issue
        // when that issue is the user's own, so it becomes the log target and
        // its worklogs count too.
        let escalation_prefix = format!("{}-", config.escalation_project);
        let is_escalation = issue.key.starts_with(&escalation_prefix);

        // Fetch worklogs a day extra back so a long worklog reaching into
        // the lookback window is still seen.
        let worklog_after = cutoff - 86_400;
        let window = config.window_secs;

        // Resolving the escalation link and reading this issue's own worklogs
        // are independent lookups, so they go out together. Only the *target's*
        // worklogs below genuinely have to wait on the link.
        let (escalated, mut covered) = futures_util::try_join!(
            async {
                if is_escalation {
                    self.escalation_target(&issue.key, &config.escalation_link, account_id)
                        .await
                } else {
                    Ok(None)
                }
            },
            self.covered_ranges(&issue.key, account_id, worklog_after, window),
        )?;

        if let Some((target_key, _)) = &escalated {
            covered.extend(
                self.covered_ranges(target_key, account_id, worklog_after, window)
                    .await?,
            );
        }

        let newest_unlogged = newest_uncovered(&in_window, &covered);
        Ok(newest_unlogged
            .cloned()
            .map(|Activity { kind, ts, detail }| {
                let (log_key, log_summary) =
                    escalated.unwrap_or_else(|| (issue.key.clone(), issue.summary.clone()));
                (
                    ts,
                    MissingWorklog {
                        issue_key: issue.key,
                        issue_summary: issue.summary,
                        kind: kind.to_string(),
                        detail,
                        activity_at: format_rfc3339_local(ts),
                        log_key,
                        log_summary,
                    },
                )
            }))
    }

    /// The user's own comments and status changes on an issue, unfiltered by
    /// time (see [`Activity`]).
    ///
    /// Served from the cache while the issue's `updated` timestamp is
    /// unchanged — neither a comment nor a status change can happen without
    /// moving it. This is what keeps a scan cheap: without it every candidate
    /// costs a comment fetch on every run, whether or not anything happened.
    ///
    /// Note that worklogs are deliberately *not* cached: they decide whether
    /// an activity counts as logged, and they are re-read on every scan so a
    /// freshly booked worklog clears its reminder immediately.
    async fn own_activities(
        &self,
        issue: &IssueSummary,
        has_status_change: bool,
        account_id: &str,
    ) -> Result<Vec<Activity>, String> {
        if let Some(hit) = self.activity_cache.lock().await.get(&issue.key) {
            if hit.is_fresh_for(issue.updated.as_deref(), has_status_change) {
                return Ok(hit.activities.clone());
            }
        }

        // The comment page and the changelog share nothing, so they go out
        // together rather than one after the other — the same reason
        // `check_candidate` joins its two lookups. The `has_status_change`
        // guard stays *inside* the arm, so an issue whose status did not move
        // still issues no changelog request.
        let (comments, changes) = futures_util::try_join!(
            self.recent_comments(&issue.key, issue.updated.as_deref()),
            async {
                if has_status_change {
                    self.recent_changelog(&issue.key).await
                } else {
                    Ok(Vec::new())
                }
            },
        )?;

        let mut activities = Vec::new();
        for c in comments {
            if c.author.as_ref().map(|a| a.account_id.as_str()) != Some(account_id) {
                continue;
            }
            if let Some(ts) = parse_jira_ts(&c.created) {
                activities.push(Activity {
                    kind: "comment",
                    ts,
                    detail: excerpt(&c.body.as_ref().map(adf_to_text).unwrap_or_default()),
                });
            }
        }
        for e in changes {
            if e.author.as_ref().map(|a| a.account_id.as_str()) != Some(account_id) {
                continue;
            }
            let Some(status) = e
                .items
                .iter()
                .find(|i| i.field.eq_ignore_ascii_case("status"))
            else {
                continue;
            };
            if let Some(ts) = parse_jira_ts(&e.created) {
                activities.push(Activity {
                    kind: "status",
                    ts,
                    detail: format!(
                        "{} → {}",
                        status.from.as_deref().unwrap_or("?"),
                        status.to.as_deref().unwrap_or("?"),
                    ),
                });
            }
        }

        self.activity_cache.lock().await.insert(
            issue.key.clone(),
            CachedActivity {
                updated: issue.updated.clone(),
                includes_status: has_status_change,
                activities: activities.clone(),
            },
        );
        Ok(activities)
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
            .map(|(start, spent)| covered_range(start, spent, window_secs))
            .collect())
    }

    async fn changelog_page(
        &self,
        issue_key: &str,
        start_at: i64,
    ) -> Result<ChangelogPage, String> {
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
    /// history doesn't fit in one page, re-fetch the last page. Shared with
    /// the issue view's activity feed.
    pub(super) async fn recent_changelog(
        &self,
        issue_key: &str,
    ) -> Result<Vec<ChangelogEntry>, String> {
        let first = self.changelog_page(issue_key, 0).await?;
        let fetched = first.values.len() as i64;
        if first.total > fetched && fetched > 0 {
            let last_page_start = first.total - fetched;
            let last = self.changelog_page(issue_key, last_page_start).await?;
            return Ok(last.values);
        }
        Ok(first.values)
    }

    /// The issue an escalation books its time on: the one it links to with
    /// `link_description` (e.g. the issue a DEV ticket "is an escalation
    /// for"), but only while that issue is assigned to the user doing the
    /// logging.
    ///
    /// The assignee rule is what keeps the forwarding from reaching into
    /// somebody else's work. An escalation is worked by a developer while the
    /// issue it came from stays with the colleague who raised it; booking the
    /// developer's hours over there would put their time on a ticket that is
    /// not theirs. With more than one person on the app that stopped being
    /// hypothetical — so when the source belongs to somebody else (or to
    /// nobody), the time stays on the escalation itself, which is the issue
    /// they were actually working.
    async fn escalation_target(
        &self,
        issue_key: &str,
        link_description: &str,
        account_id: &str,
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
            let IssueLink {
                link_type,
                inward_issue,
                outward_issue,
                ..
            } = link;
            let target = if link_type.outward.eq_ignore_ascii_case(link_description) {
                outward_issue
            } else if link_type.inward.eq_ignore_ascii_case(link_description) {
                inward_issue
            } else {
                None
            };
            if let Some(t) = target {
                if !self.assigned_to(&t.key, account_id).await? {
                    return Ok(None);
                }
                let summary = t.fields.map(|f| f.summary).unwrap_or_default();
                return Ok(Some((t.key, summary)));
            }
        }
        Ok(None)
    }

    /// Whether `issue_key` is assigned to `account_id`. A separate request
    /// because the link entries a search returns carry the target's summary
    /// and status but not who holds it.
    async fn assigned_to(&self, issue_key: &str, account_id: &str) -> Result<bool, String> {
        let parsed: AssigneeResp = self
            .get_json(
                &format!("/rest/api/3/issue/{issue_key}"),
                &[("fields", "assignee".to_string())],
                "issue",
            )
            .await?;
        Ok(parsed
            .fields
            .and_then(|f| f.assignee)
            .is_some_and(|a| a.account_id == account_id))
    }
}

/// The JQL fragment restricting a search to issues that still accept
/// worklogs. Workflows differ per project, so instead of naming every
/// project's "fully closed" status, only status-category "Done" issues whose
/// status is explicitly allow-listed (e.g. "Gelöst"/Resolved) count as still
/// bookable — every other Done status is excluded.
fn bookable_clause(bookable_done_statuses: &[String]) -> String {
    if bookable_done_statuses.is_empty() {
        // `status in ()` is a JQL syntax error, so with nothing allow-listed
        // the rule collapses to "not done at all".
        return "statusCategory != Done".to_string();
    }
    // Through `quoted`, which escapes: these names are a constant today, but
    // `MissingConfig` is on its way to being user-configurable, and the todo
    // tab's equivalent list already arrives from settings. A name carrying a
    // quote would otherwise break the JQL and with it the whole scan.
    format!(
        "(statusCategory != Done OR status in ({}))",
        super::quoted(bookable_done_statuses)
    )
}

/// An escalation issue books its time on the issue it is linked to. When that
/// issue is on the list as well, a single worklog clears both reminders — two
/// rows for one piece of work. Keep the issue the time actually lands on and
/// drop the escalation; on its own (the linked issue has no unlogged activity
/// of its own) the escalation stays, or the reminder would be lost entirely.
fn drop_linked_escalations(found: Vec<(i64, MissingWorklog)>) -> Vec<(i64, MissingWorklog)> {
    let listed: HashSet<String> = found.iter().map(|(_, m)| m.issue_key.clone()).collect();
    found
        .into_iter()
        .filter(|(_, m)| m.log_key == m.issue_key || !listed.contains(&m.log_key))
        .collect()
}

/// The period a worklog accounts for, stretched by `window_secs` on both
/// sides: time is rarely booked at the exact minute the work happened.
fn covered_range(started: i64, spent_secs: i64, window_secs: i64) -> (i64, i64) {
    (started - window_secs, started + spent_secs + window_secs)
}

/// Activities inside the scan window: old enough to be past the grace period
/// (`flag_before`), recent enough to still be in the lookback (`cutoff`).
fn within_window(activities: &[Activity], cutoff: i64, flag_before: i64) -> Vec<&Activity> {
    activities
        .iter()
        .filter(|a| a.ts >= cutoff && a.ts <= flag_before)
        .collect()
}

/// The newest activity that no worklog period covers — the one worth
/// reminding about. `None` once every activity is accounted for.
fn newest_uncovered<'a>(
    activities: &[&'a Activity],
    covered: &[(i64, i64)],
) -> Option<&'a Activity> {
    activities
        .iter()
        .copied()
        .filter(|a| {
            !covered
                .iter()
                .any(|(from, to)| a.ts >= *from && a.ts <= *to)
        })
        .max_by_key(|a| a.ts)
}

/// How much of a comment a reminder hint carries. Sized to stay one line.
const EXCERPT_CHARS: usize = 140;

/// Collapse whitespace and cap the length so a long comment stays a one-line
/// reminder hint.
///
/// The folding itself is [`crate::logging::one_line`] — the same rule the log
/// file applies to text arriving from outside the process, and there is no
/// reason for a second copy of it to drift.
fn excerpt(text: &str) -> String {
    crate::logging::one_line(text, EXCERPT_CHARS)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cached(updated: Option<&str>, includes_status: bool) -> CachedActivity {
        CachedActivity {
            updated: updated.map(str::to_string),
            includes_status,
            activities: vec![Activity {
                kind: "comment",
                ts: 1_784_190_600,
                detail: "worked on it".to_string(),
            }],
        }
    }

    const T1: &str = "2026-07-16T10:30:00.000+0200";
    const T2: &str = "2026-07-16T11:00:00.000+0200";

    fn activity(ts: i64) -> Activity {
        Activity {
            kind: "comment",
            ts,
            detail: format!("at {ts}"),
        }
    }

    // A stand-in "now" so the window arithmetic reads like the real thing:
    // one day of lookback, ten minutes of grace.
    const NOW: i64 = 1_784_190_600;
    const CUTOFF: i64 = NOW - 86_400;
    const FLAG_BEFORE: i64 = NOW - 600;

    #[test]
    fn window_excludes_the_too_old_and_the_too_fresh() {
        let all = vec![
            activity(CUTOFF - 1),      // fell out of the lookback
            activity(CUTOFF),          // exactly at the edge — included
            activity(NOW - 3600),      // squarely inside
            activity(FLAG_BEFORE),     // exactly at the grace edge — included
            activity(FLAG_BEFORE + 1), // still within the grace period
        ];
        let kept: Vec<i64> = within_window(&all, CUTOFF, FLAG_BEFORE)
            .iter()
            .map(|a| a.ts)
            .collect();
        assert_eq!(kept, vec![CUTOFF, NOW - 3600, FLAG_BEFORE]);
    }

    #[test]
    fn a_worklog_covering_the_activity_silences_it() {
        let logged = activity(NOW - 3600);
        let covered = vec![covered_range(NOW - 3600, 1800, 0)];
        assert!(newest_uncovered(&[&logged], &covered).is_none());
    }

    #[test]
    fn the_window_stretches_coverage_on_both_sides() {
        // Booked at 12:00 for 30 min, but the comment was written at 11:00 —
        // covered only because of the ±3h leeway.
        let earlier = activity(NOW - 3600);
        let booked_later = vec![covered_range(NOW, 1800, 3 * 3600)];
        assert!(newest_uncovered(&[&earlier], &booked_later).is_none());

        // Outside the leeway it stands.
        let long_before = activity(NOW - 5 * 3600);
        assert!(newest_uncovered(&[&long_before], &booked_later).is_some());
    }

    #[test]
    fn the_newest_uncovered_activity_wins() {
        let (old, middle, newest) = (
            activity(NOW - 7200),
            activity(NOW - 3600),
            activity(NOW - 1800),
        );
        // The newest one is already booked, so the next one down is reported.
        let covered = vec![covered_range(NOW - 1800, 900, 0)];
        let found = newest_uncovered(&[&old, &middle, &newest], &covered).unwrap();
        assert_eq!(found.ts, middle.ts);

        // With nothing booked, the newest wins outright.
        let found = newest_uncovered(&[&old, &middle, &newest], &[]).unwrap();
        assert_eq!(found.ts, newest.ts);
    }

    #[test]
    fn no_activities_means_nothing_to_report() {
        assert!(newest_uncovered(&[], &[]).is_none());
        assert!(within_window(&[], CUTOFF, FLAG_BEFORE).is_empty());
    }

    /// A reminder row, booking its time on `log_key` (the issue itself unless
    /// it is an escalation).
    fn missing(issue_key: &str, log_key: &str) -> (i64, MissingWorklog) {
        (
            NOW,
            MissingWorklog {
                issue_key: issue_key.to_string(),
                issue_summary: "summary".to_string(),
                kind: "comment".to_string(),
                detail: "worked on it".to_string(),
                activity_at: format_rfc3339_local(NOW),
                log_key: log_key.to_string(),
                log_summary: "summary".to_string(),
            },
        )
    }

    fn keys(found: &[(i64, MissingWorklog)]) -> Vec<&str> {
        found.iter().map(|(_, m)| m.issue_key.as_str()).collect()
    }

    #[test]
    fn an_escalation_drops_when_its_log_target_is_listed_too() {
        // Booking on ABC-1 clears both, so DEV-9 is a second row for the same
        // work.
        let found = vec![missing("DEV-9", "ABC-1"), missing("ABC-1", "ABC-1")];
        assert_eq!(keys(&drop_linked_escalations(found)), vec!["ABC-1"]);
    }

    #[test]
    fn a_lone_escalation_stays() {
        // ABC-1 has no unlogged activity of its own — without DEV-9 there
        // would be no reminder at all.
        let found = vec![missing("DEV-9", "ABC-1"), missing("XYZ-2", "XYZ-2")];
        assert_eq!(
            keys(&drop_linked_escalations(found)),
            vec!["DEV-9", "XYZ-2"]
        );
    }

    #[test]
    fn plain_issues_are_left_alone() {
        let found = vec![missing("ABC-1", "ABC-1"), missing("ABC-2", "ABC-2")];
        assert_eq!(
            keys(&drop_linked_escalations(found)),
            vec!["ABC-1", "ABC-2"]
        );
    }

    #[test]
    fn bookable_clause_quotes_status_names() {
        let statuses = vec!["Gelöst".to_string(), "Resolved".to_string()];
        assert_eq!(
            bookable_clause(&statuses),
            "(statusCategory != Done OR status in (\"Gelöst\", \"Resolved\"))"
        );
    }

    #[test]
    fn bookable_clause_stays_valid_jql_without_allow_listed_statuses() {
        // `status in ()` would be a syntax error and break the whole scan.
        assert_eq!(bookable_clause(&[]), "statusCategory != Done");
    }

    #[test]
    fn excerpt_collapses_and_caps() {
        assert_eq!(excerpt("  a\n\tlong   comment "), "a long comment");
        let long = "x".repeat(200);
        let cut = excerpt(&long);
        assert_eq!(cut.chars().count(), 141); // 140 + the ellipsis
        assert!(cut.ends_with('…'));
    }

    #[test]
    fn cache_hit_while_the_issue_is_untouched() {
        assert!(cached(Some(T1), false).is_fresh_for(Some(T1), false));
        assert!(cached(Some(T1), true).is_fresh_for(Some(T1), true));
        // Status changes already fetched are simply not needed this round.
        assert!(cached(Some(T1), true).is_fresh_for(Some(T1), false));
    }

    #[test]
    fn cache_miss_once_the_issue_moved() {
        // A new comment or status change always bumps `updated`, which is the
        // whole basis for reusing an entry.
        assert!(!cached(Some(T1), true).is_fresh_for(Some(T2), true));
    }

    #[test]
    fn cache_miss_when_the_entry_lacks_the_changelog() {
        // Stored while the issue had no status change; this scan needs one.
        assert!(!cached(Some(T1), false).is_fresh_for(Some(T1), true));
    }

    #[test]
    fn cache_miss_when_freshness_cannot_be_proven() {
        // No timestamp on either side (a search that didn't request the field,
        // or Jira omitting it) must never be mistaken for "unchanged".
        assert!(!cached(None, true).is_fresh_for(Some(T1), true));
        assert!(!cached(Some(T1), true).is_fresh_for(None, true));
        assert!(!cached(None, true).is_fresh_for(None, true));
    }
}

/// Round-trip tests for the scan itself, over a real HTTP server.
///
/// The pure helpers above are tested directly; this is about the heuristic as
/// a whole — which issues get flagged, and which are correctly left alone.
#[cfg(test)]
mod http_tests {
    use serde_json::json;
    use wiremock::MockServer;

    use super::MissingConfig;
    use crate::jira::test_support::{client_for, mount_get_matching};

    const ME: &str = "acc-me";

    /// Far enough back that the fixtures' own stamps decide everything, with a
    /// grace period short enough not to suppress them.
    fn config() -> MissingConfig {
        MissingConfig {
            lookback_days: 30,
            window_secs: 3 * 3600,
            grace_secs: 0,
            escalation_project: "DEV".to_string(),
            escalation_link: "is an escalation for".to_string(),
            bookable_done_statuses: vec!["Resolved".to_string()],
        }
    }

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

    /// Epoch-seconds `hours_ago`, as a Jira timestamp.
    fn hours_ago(hours: i64) -> String {
        let when = chrono::Local::now() - chrono::Duration::hours(hours);
        when.format("%Y-%m-%dT%H:%M:%S%.3f%z").to_string()
    }

    /// A site where the searches find one issue, it carries `comments`, and
    /// `worklogs` have been booked on it.
    async fn site(comments: serde_json::Value, worklogs: serde_json::Value) -> MockServer {
        let server = MockServer::start().await;
        mount_get_matching(
            &server,
            r"^/rest/api/3/search/jql$",
            json!({ "issues": [{
                "key": "ABC-1",
                "fields": { "summary": "Replace the pump", "updated": hours_ago(1) }
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
            json!({ "values": [], "total": 0 }),
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

    fn my_comment(hours: i64, text: &str) -> serde_json::Value {
        json!({
            "id": "1",
            "created": hours_ago(hours),
            "author": { "accountId": ME },
            "body": adf(text),
        })
    }

    fn my_worklog(started_hours_ago: i64, seconds: i64) -> serde_json::Value {
        json!({
            "id": "w1",
            "author": { "accountId": ME },
            "started": hours_ago(started_hours_ago),
            "timeSpentSeconds": seconds,
        })
    }

    #[tokio::test]
    async fn a_comment_with_no_worklog_near_it_is_flagged() {
        let server = site(json!([my_comment(5, "cleaned the filter")]), json!([])).await;

        let found = client_for(&server)
            .missing_worklogs(ME, &config())
            .await
            .expect("scan");

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].issue_key, "ABC-1");
        assert_eq!(found[0].kind, "comment");
        assert!(found[0].detail.contains("cleaned the filter"));
        // The time goes on the issue itself when nothing redirects it.
        assert_eq!(found[0].log_key, "ABC-1");
    }

    #[tokio::test]
    async fn a_comment_a_worklog_already_covers_is_not_flagged() {
        // The whole point of the heuristic: time booked around the activity
        // means it was not forgotten.
        let server = site(
            json!([my_comment(5, "cleaned the filter")]),
            json!([my_worklog(6, 2 * 3600)]),
        )
        .await;

        let found = client_for(&server)
            .missing_worklogs(ME, &config())
            .await
            .expect("scan");

        assert_eq!(found.len(), 0);
    }

    #[tokio::test]
    async fn somebody_elses_comment_is_not_my_missing_worklog() {
        let server = site(
            json!([{
                "id": "1",
                "created": hours_ago(5),
                "author": { "accountId": "acc-them" },
                "body": adf("their comment"),
            }]),
            json!([]),
        )
        .await;

        let found = client_for(&server)
            .missing_worklogs(ME, &config())
            .await
            .expect("scan");

        assert!(found.is_empty());
    }

    #[tokio::test]
    async fn activity_still_inside_the_grace_period_is_left_alone() {
        // There has to be a chance to log before the reminder appears.
        let mut cfg = config();
        cfg.grace_secs = 24 * 3600;
        let server = site(json!([my_comment(1, "just now")]), json!([])).await;

        let found = client_for(&server)
            .missing_worklogs(ME, &cfg)
            .await
            .expect("scan");

        assert!(found.is_empty());
    }

    #[tokio::test]
    async fn activity_older_than_the_lookback_is_out_of_scope() {
        let mut cfg = config();
        cfg.lookback_days = 1;
        let server = site(json!([my_comment(72, "last week")]), json!([])).await;

        let found = client_for(&server)
            .missing_worklogs(ME, &cfg)
            .await
            .expect("scan");

        assert!(found.is_empty());
    }

    #[tokio::test]
    async fn a_worklog_far_from_the_activity_does_not_cover_it() {
        // A worklog booked in the morning says nothing about an evening
        // comment; `window_secs` is what "near" means.
        let server = site(
            json!([my_comment(2, "evening work")]),
            json!([my_worklog(20, 3600)]),
        )
        .await;

        let found = client_for(&server)
            .missing_worklogs(ME, &config())
            .await
            .expect("scan");

        assert_eq!(found.len(), 1);
    }

    #[tokio::test]
    async fn an_issue_with_nothing_on_it_costs_no_worklog_fetch() {
        // The scan runs over every recently touched issue; skipping the
        // worklog read when there is no own activity is what keeps it cheap.
        let server = site(json!([]), json!([])).await;

        let found = client_for(&server)
            .missing_worklogs(ME, &config())
            .await
            .expect("scan");

        assert!(found.is_empty());
        assert_eq!(
            crate::jira::test_support::requests_to(&server, "/worklog").await,
            0
        );
    }

    #[tokio::test]
    async fn a_failing_scan_is_an_error_rather_than_an_empty_inbox() {
        // "Nothing to log" and "we could not check" must not look the same.
        let server = MockServer::start().await;
        crate::jira::test_support::mount_get_failing(
            &server,
            r"^/rest/api/3/search/jql$",
            503,
            json!({ "errorMessages": ["Service unavailable"] }),
        )
        .await;

        let err = client_for(&server)
            .missing_worklogs(ME, &config())
            .await
            .err()
            .expect("a failed scan must not read as nothing missing");
        assert!(err.contains("503"), "{err}");
    }
}

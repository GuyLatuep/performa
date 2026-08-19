//! The @-mention inbox: comments in which somebody tagged the current user.
//!
//! Jira has no API for "my mentions", so this works in two steps: a pair of
//! JQL searches narrows the field to issues that plausibly carry one, and the
//! comments of those issues are then checked precisely — a mention is an ADF
//! node holding the mentioned account's id, which is exact where a text search
//! is only a guess.

use std::cmp::Reverse;
use std::collections::HashMap;
use std::sync::Arc;

use chrono::Local;
use futures_util::{stream, StreamExt, TryStreamExt};

use super::types::*;
use super::{
    adf_to_text, escape_jql, format_rfc3339_local, parse_jira_ts, JiraClient, MAX_INFLIGHT,
};

/// How many issues each candidate search may return. Neither net is a precise
/// query, so this is a budget rather than a limit that "fits": past it, the
/// scan reports itself as truncated instead of pretending it saw everything.
const CANDIDATE_LIMIT: u32 = 100;

/// Mentions found on one issue, plus the `updated` timestamp they were found
/// at. A comment cannot be written or edited without moving `updated`, so an
/// entry stays valid until the issue is touched again.
pub(super) struct CachedMentions {
    updated: Option<String>,
    mentions: Vec<Mention>,
}

/// Per-issue mention cache, keyed by issue key. Shared across `JiraClient`
/// clones, which is why it is behind an `Arc`.
pub(super) type MentionCache = Arc<tokio::sync::Mutex<HashMap<String, CachedMentions>>>;

impl JiraClient {
    /// Comments from the last `lookback_days` that mention the current user,
    /// newest first. The user's own comments are skipped — being tagged by
    /// yourself is not news.
    pub async fn mentions(
        &self,
        account_id: &str,
        display_name: &str,
        lookback_days: u32,
    ) -> Result<MentionScan, String> {
        let cutoff = Local::now().timestamp() - lookback_days as i64 * 86_400;
        let (candidates, truncated) = self.mention_candidates(display_name, lookback_days).await?;
        log::debug!(
            "mentions: {} candidate issue(s) to scan: {:?}",
            candidates.len(),
            candidates.iter().map(|i| &i.key).collect::<Vec<_>>()
        );

        let mut found: Vec<Mention> = stream::iter(candidates)
            .map(|issue| self.issue_mentions(issue, account_id, cutoff))
            .buffer_unordered(MAX_INFLIGHT)
            .try_collect::<Vec<Vec<Mention>>>()
            .await?
            .into_iter()
            .flatten()
            .collect();

        newest_first(&mut found);
        log::debug!(
            "mentions: {} mention(s) found{}",
            found.len(),
            if truncated {
                " (candidate search truncated — there may be more)"
            } else {
                ""
            }
        );
        Ok(MentionScan {
            mentions: found,
            truncated,
        })
    }

    /// Issues that might carry a mention. Two nets, because neither alone is
    /// enough: Jira's text index does find the mention itself, but only by the
    /// name it renders as — and being mentioned does not make you a watcher, so
    /// the "issues I have to do with" net misses exactly the case that matters
    /// most. False positives are harmless; the ADF check below sorts them out.
    /// Returns the candidates and whether either net filled its budget, which
    /// means it was cut short and mentions may lie beyond it.
    async fn mention_candidates(
        &self,
        display_name: &str,
        lookback_days: u32,
    ) -> Result<(Vec<IssueSummary>, bool), String> {
        // Bound before the calls: a `format!` temporary passed straight into a
        // future would be dropped while that future still borrows it.
        let involved_jql = format!(
            "updated >= \"-{lookback_days}d\" AND (issue in issueHistory() \
             OR watcher = currentUser() OR assignee = currentUser() \
             OR reporter = currentUser()) ORDER BY updated DESC"
        );
        let text_jql = format!(
            "comment ~ \"{}\" AND updated >= \"-{lookback_days}d\" ORDER BY updated DESC",
            escape_jql(display_name)
        );
        let involved = self.search_issues_dated(&involved_jql, CANDIDATE_LIMIT);

        // An empty display name would search for the empty string, which
        // matches everything — skip that net rather than scan the whole site.
        let truncated;
        let mut candidates = if display_name.trim().is_empty() {
            // Only one net ran, so the text net's blind spot is unconditional
            // here rather than a matter of budget — see the comment above.
            truncated = true;
            involved.await?
        } else {
            let (by_text, involved) = futures_util::try_join!(
                self.search_issues_dated(&text_jql, CANDIDATE_LIMIT),
                involved
            )?;
            truncated = filled_budget(&by_text) || filled_budget(&involved);
            let mut merged = by_text;
            merged.extend(involved);
            merged
        };

        // Both nets overlap heavily — scanning an issue twice would report
        // every mention on it twice.
        let mut seen = std::collections::HashSet::new();
        candidates.retain(|i| seen.insert(i.key.clone()));
        Ok((candidates, truncated))
    }

    /// The mentions of `account_id` in one issue's recent comments.
    async fn issue_mentions(
        &self,
        issue: IssueSummary,
        account_id: &str,
        cutoff: i64,
    ) -> Result<Vec<Mention>, String> {
        if let Some(hit) = self.mention_cache.lock().await.get(&issue.key) {
            // A missing `updated` on either side means we cannot prove the
            // issue is unchanged — refetch rather than serve a stale entry.
            let unchanged = matches!(
                (hit.updated.as_deref(), issue.updated.as_deref()),
                (Some(cached), Some(current)) if cached == current
            );
            if unchanged {
                // The window moves with the clock, so even a cache hit is
                // re-judged against the current cutoff.
                return Ok(within_lookback(&hit.mentions, cutoff));
            }
        }

        let mut mentions = Vec::new();
        for c in self.recent_comments(&issue.key).await? {
            let author = c.author.as_ref();
            if author.map(|a| a.account_id.as_str()) == Some(account_id) {
                continue;
            }
            if !c
                .body
                .as_ref()
                .is_some_and(|b| mentions_user(b, account_id))
            {
                continue;
            }
            let Some(ts) = parse_jira_ts(&c.created) else {
                continue;
            };
            mentions.push(Mention {
                issue_key: issue.key.clone(),
                issue_summary: issue.summary.clone(),
                comment_id: c.id.clone(),
                author: author
                    .and_then(|a| a.display_name.clone())
                    .unwrap_or_else(|| "Someone".to_string()),
                text: excerpt(&c.body.as_ref().map(adf_to_text).unwrap_or_default()),
                created_at: format_rfc3339_local(ts),
                created_ts: ts,
            });
        }

        self.mention_cache.lock().await.insert(
            issue.key.clone(),
            CachedMentions {
                updated: issue.updated.clone(),
                // Cached unfiltered: the cutoff moves, the comments do not.
                mentions: mentions.clone(),
            },
        );
        Ok(within_lookback(&mentions, cutoff))
    }
}

/// Did this net come back full? Then it was cut off at the budget and there
/// are candidate issues it never returned.
fn filled_budget(net: &[IssueSummary]) -> bool {
    net.len() as u32 >= CANDIDATE_LIMIT
}

/// Newest first, ordered by the instant rather than by `created_at`: that
/// string carries a local UTC offset, and comparing offset-bearing strings is
/// not chronological. When summer time ends the same wall-clock hour occurs
/// twice with two different offsets, and the later of the two sorts first.
fn newest_first(mentions: &mut [Mention]) {
    mentions.sort_by_key(|m| Reverse(m.created_ts));
}

/// Mentions still inside the lookback window.
fn within_lookback(mentions: &[Mention], cutoff: i64) -> Vec<Mention> {
    mentions
        .iter()
        .filter(|m| m.created_ts >= cutoff)
        .cloned()
        .collect()
}

/// Does this ADF document tag `account_id`? A mention is a node of type
/// `mention` whose `attrs.id` is the mentioned account — matching on that
/// rather than on the rendered name, which is neither unique nor stable.
fn mentions_user(body: &serde_json::Value, account_id: &str) -> bool {
    match body {
        serde_json::Value::Object(map) => {
            let is_mention = map.get("type").and_then(|t| t.as_str()) == Some("mention");
            let tags_user = map
                .get("attrs")
                .and_then(|a| a.get("id"))
                .and_then(|id| id.as_str())
                == Some(account_id);
            if is_mention && tags_user {
                return true;
            }
            map.get("content")
                .is_some_and(|c| mentions_user(c, account_id))
        }
        serde_json::Value::Array(items) => items.iter().any(|i| mentions_user(i, account_id)),
        _ => false,
    }
}

/// Collapse whitespace and cap the length. The inbox wraps the excerpt over at
/// most four lines, so the cap is sized to fill those rather than one line.
fn excerpt(text: &str) -> String {
    const MAX_CHARS: usize = 500;
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= MAX_CHARS {
        return collapsed;
    }
    let cut: String = collapsed.chars().take(MAX_CHARS).collect();
    format!("{}…", cut.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ME: &str = "557058:abc";

    fn comment_with_mention(id: &str) -> serde_json::Value {
        json!({
            "type": "doc",
            "version": 1,
            "content": [{
                "type": "paragraph",
                "content": [
                    { "type": "text", "text": "can you look at this " },
                    { "type": "mention", "attrs": { "id": id, "text": "@Malte Polzin" } },
                    { "type": "text", "text": "?" },
                ]
            }]
        })
    }

    #[test]
    fn a_mention_is_matched_by_account_id() {
        assert!(mentions_user(&comment_with_mention(ME), ME));
    }

    #[test]
    fn somebody_elses_mention_is_not_mine() {
        assert!(!mentions_user(&comment_with_mention("557058:xyz"), ME));
    }

    #[test]
    fn plain_text_naming_me_is_not_a_mention() {
        // Typing a name is not tagging — only the mention node counts, which is
        // what keeps the text-search candidate net from producing false hits.
        let body = json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [{ "type": "text", "text": "Malte Polzin should look at this" }]
            }]
        });
        assert!(!mentions_user(&body, ME));
    }

    #[test]
    fn mentions_are_found_at_any_nesting_depth() {
        // Panels, lists and tables all wrap their content another level down.
        let body = json!({
            "type": "doc",
            "content": [{
                "type": "bulletList",
                "content": [{
                    "type": "listItem",
                    "content": [comment_with_mention(ME)]
                }]
            }]
        });
        assert!(mentions_user(&body, ME));
    }

    #[test]
    fn an_empty_body_mentions_nobody() {
        assert!(!mentions_user(&json!({}), ME));
        assert!(!mentions_user(&json!(null), ME));
    }

    fn mention_at(ts: i64) -> Mention {
        Mention {
            issue_key: "ABC-1".to_string(),
            issue_summary: "summary".to_string(),
            comment_id: "10001".to_string(),
            author: "Someone".to_string(),
            text: "hello".to_string(),
            created_at: format_rfc3339_local(ts),
            created_ts: ts,
        }
    }

    /// A mention whose rendered timestamp disagrees with its instant, as every
    /// mention written in the repeated hour at the end of summer time does.
    fn mention_displayed_as(ts: i64, created_at: &str) -> Mention {
        Mention {
            created_at: created_at.to_string(),
            ..mention_at(ts)
        }
    }

    #[test]
    fn the_newest_mention_comes_first_across_the_end_of_summer_time() {
        // Both are 26 October 2025, both read "02:something" locally, but
        // 02:10+01:00 is a full hour *after* 02:30+02:00. Sorting the strings
        // would put them the wrong way round.
        let earlier = mention_displayed_as(1_761_438_600, "2025-10-26T02:30:00+02:00");
        let later = mention_displayed_as(1_761_441_000, "2025-10-26T02:10:00+01:00");

        let mut all = vec![earlier, later];
        newest_first(&mut all);

        assert_eq!(all[0].created_ts, 1_761_441_000);
    }

    fn candidates(n: u32) -> Vec<IssueSummary> {
        (0..n)
            .map(|i| IssueSummary {
                key: format!("ABC-{i}"),
                summary: "summary".to_string(),
                due_date: None,
                updated: None,
                status: None,
                priority: None,
            })
            .collect()
    }

    #[test]
    fn a_net_that_came_back_full_counts_as_cut_off() {
        // Exactly full is the ambiguous case: Jira returning the budget is
        // indistinguishable from Jira having no more to give, so it counts as
        // cut off rather than as complete.
        assert!(filled_budget(&candidates(CANDIDATE_LIMIT)));
        assert!(!filled_budget(&candidates(CANDIDATE_LIMIT - 1)));
    }

    #[test]
    fn the_lookback_filter_drops_older_mentions() {
        let now = Local::now().timestamp();
        let cutoff = now - 14 * 86_400;
        let all = vec![
            mention_at(cutoff - 1),
            mention_at(cutoff),
            mention_at(now - 3600),
        ];
        let kept = within_lookback(&all, cutoff);
        assert_eq!(kept.len(), 2);
        assert_eq!(kept[0].created_ts, cutoff);
    }

    #[test]
    fn excerpt_collapses_and_caps() {
        assert_eq!(excerpt("  a\n\tlong   comment "), "a long comment");
        let long = "x".repeat(800);
        assert_eq!(excerpt(&long).chars().count(), 501); // 500 + the ellipsis
    }
}

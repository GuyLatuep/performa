//! Work items linked to an issue: reading the links off it, offering the
//! relationships a new one can use, creating and removing them.
//!
//! Split from [`super::issue`] because a link is the one thing in the view
//! that is about a *direction* rather than a value. Jira stores one link and
//! describes it twice — "A blocks B" and "B is blocked by A" are the same
//! record — so every function here has to say which end it is speaking from.
//! Getting that wrong is silent: the link is created, it just points the
//! other way. Keeping the direction handling in one module is what makes it
//! checkable.

use serde_json::Value;

use super::types::*;
use super::JiraClient;

/// Which half of a link type a relationship is. Jira's own words: on the
/// issue the link points *from*, the other issue is the `outward` one.
const OUTWARD: &str = "outward";
const INWARD: &str = "inward";

impl JiraClient {
    /// Every relationship this site defines, both halves of each type, in the
    /// order Jira lists them.
    ///
    /// Reference data like the field catalog — a Jira admin changes it, not a
    /// day's work — so the webview holds it for the life of the process.
    pub async fn link_relations(&self) -> Result<Vec<LinkRelation>, String> {
        let resp: LinkTypesResp = self
            .get_json("/rest/api/3/issueLinkType", &[], "issue link types")
            .await?;
        Ok(relations(resp.issue_link_types))
    }

    /// Link `issue_key` to `other_key` with the given relationship, read from
    /// `issue_key`'s side: `direction` says whether `label` was the type's
    /// outward half ("this blocks that") or its inward one ("this is blocked
    /// by that").
    ///
    /// The payload names the two ends by role, and the roles are what the
    /// direction decides: Jira reads a link as "outwardIssue <outward
    /// description> inwardIssue".
    pub async fn link_issues(
        &self,
        issue_key: &str,
        other_key: &str,
        type_name: &str,
        direction: &str,
    ) -> Result<(), String> {
        let (outward, inward) = if direction == OUTWARD {
            (issue_key, other_key)
        } else {
            (other_key, issue_key)
        };
        let body = serde_json::json!({
            "type": { "name": type_name },
            "outwardIssue": { "key": outward },
            "inwardIssue": { "key": inward },
        });
        let result = self
            .send_ok(
                self.http
                    .post(self.url("/rest/api/3/issueLink"))
                    .json(&body),
            )
            .await;
        match &result {
            Ok(()) => log::info!("linked {outward} -> {inward} as {type_name}"),
            Err(e) => log::error!("linking {issue_key} to {other_key} as {type_name} failed: {e}"),
        }
        result
    }

    /// Remove one link. Unlike deleting an attachment this destroys no
    /// content — the two issues are untouched — so the view unlinks on one
    /// click and says so afterwards.
    pub async fn delete_issue_link(&self, link_id: &str) -> Result<(), String> {
        let result = self
            .send_ok(
                self.http
                    .delete(self.url(&format!("/rest/api/3/issueLink/{link_id}"))),
            )
            .await;
        match &result {
            Ok(()) => log::info!("removed issue link {link_id}"),
            Err(e) => log::error!("removing issue link {link_id} failed: {e}"),
        }
        result
    }
}

/// Both halves of every link type, as the picker lists them.
fn relations(types: Vec<LinkType>) -> Vec<LinkRelation> {
    let mut out = Vec::new();
    for t in types {
        if t.name.is_empty() {
            continue;
        }
        // A type whose halves read the same ("relates to" both ways) is one
        // choice, not two: offering it twice would ask the user to pick
        // between two identical sentences.
        let same = t.outward.eq_ignore_ascii_case(&t.inward);
        for (direction, label) in [(OUTWARD, &t.outward), (INWARD, &t.inward)] {
            if label.is_empty() || (same && direction == INWARD) {
                continue;
            }
            out.push(LinkRelation {
                type_name: t.name.clone(),
                direction: direction.to_string(),
                label: label.clone(),
            });
        }
    }
    out
}

/// The issue's links, read from this issue's side and in Jira's own order —
/// which groups them by relationship, so the view can show the grouping
/// without sorting anything. A malformed field means no links rather than no
/// issue, like the attachments beside them.
pub(super) fn links(value: Option<&Value>) -> Vec<LinkedItem> {
    let Some(raw) = value else { return Vec::new() };
    let Ok(parsed) = serde_json::from_value::<Vec<IssueLink>>(raw.clone()) else {
        return Vec::new();
    };
    parsed
        .into_iter()
        .filter_map(|link| {
            // Which end is present is what says how the link reads from here:
            // an entry carrying `outwardIssue` is one this issue points out
            // along, so it takes the type's outward description.
            let (relation, other) = match (link.outward_issue, link.inward_issue) {
                (Some(other), _) => (link.link_type.outward, other),
                (None, Some(other)) => (link.link_type.inward, other),
                // Neither end: a link to an issue this account cannot see.
                // Jira sends the entry anyway; there is nothing to show.
                (None, None) => return None,
            };
            let fields = other.fields;
            Some(LinkedItem {
                id: link.id,
                relation,
                key: other.key,
                summary: fields
                    .as_ref()
                    .map(|f| f.summary.clone())
                    .unwrap_or_default(),
                status: fields
                    .and_then(|f| f.status)
                    .map(|s| s.name)
                    .filter(|n| !n.is_empty()),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn link_type(name: &str, outward: &str, inward: &str) -> LinkType {
        LinkType {
            name: name.to_string(),
            outward: outward.to_string(),
            inward: inward.to_string(),
        }
    }

    #[test]
    fn a_link_reads_from_this_issue_s_side() {
        // The end Jira sends is the *other* issue, and which key it arrives
        // under is what says how the link reads from here. Reading both the
        // same way is the mistake this guards: the view would then tell the
        // user an issue blocks this one when it is the other way round.
        let parsed = links(Some(&json!([
            {
                "id": "10101",
                "type": { "name": "Blocks", "outward": "blocks", "inward": "is blocked by" },
                "outwardIssue": {
                    "key": "OPS-2",
                    "fields": { "summary": "Ship it", "status": { "name": "To Do" } }
                }
            },
            {
                "id": "10102",
                "type": { "name": "Blocks", "outward": "blocks", "inward": "is blocked by" },
                "inwardIssue": {
                    "key": "OPS-3",
                    "fields": { "summary": "Wait for it", "status": { "name": "Done" } }
                }
            }
        ])));
        let seen: Vec<(&str, &str, Option<&str>)> = parsed
            .iter()
            .map(|l| (l.relation.as_str(), l.key.as_str(), l.status.as_deref()))
            .collect();
        assert_eq!(
            seen,
            [
                ("blocks", "OPS-2", Some("To Do")),
                ("is blocked by", "OPS-3", Some("Done")),
            ]
        );
    }

    #[test]
    fn a_link_to_an_invisible_issue_is_dropped() {
        // Jira sends the entry with neither end when the account cannot see
        // the other issue. There is no key, no summary and no status to show.
        let parsed = links(Some(&json!([
            { "id": "1", "type": { "name": "Blocks", "outward": "blocks", "inward": "is blocked by" } }
        ])));
        assert!(parsed.is_empty());
    }

    #[test]
    fn a_malformed_field_means_no_links_rather_than_no_issue() {
        assert!(links(None).is_empty());
        assert!(links(Some(&json!("nonsense"))).is_empty());
    }

    #[test]
    fn a_missing_status_or_summary_still_shows_the_link() {
        let parsed = links(Some(&json!([
            {
                "id": "5",
                "type": { "name": "Relates", "outward": "relates to", "inward": "relates to" },
                "outwardIssue": { "key": "OPS-9" }
            }
        ])));
        assert_eq!(parsed[0].key, "OPS-9");
        assert_eq!(parsed[0].summary, "");
        assert_eq!(parsed[0].status, None);
    }

    #[test]
    fn every_link_type_offers_both_of_its_halves() {
        let offered = relations(vec![link_type("Blocks", "blocks", "is blocked by")]);
        let seen: Vec<(&str, &str)> = offered
            .iter()
            .map(|r| (r.direction.as_str(), r.label.as_str()))
            .collect();
        assert_eq!(seen, [("outward", "blocks"), ("inward", "is blocked by")]);
        assert!(offered.iter().all(|r| r.type_name == "Blocks"));
    }

    #[test]
    fn a_symmetric_type_is_offered_once() {
        // "relates to" both ways is one relationship; two identical entries in
        // the picker would be a choice with no difference behind it.
        let offered = relations(vec![link_type("Relates", "relates to", "relates to")]);
        assert_eq!(offered.len(), 1);
        assert_eq!(offered[0].direction, "outward");
    }

    #[test]
    fn a_nameless_type_is_skipped() {
        // The name is how a link is created; without it the entry could only
        // fail on submit.
        assert!(relations(vec![link_type("", "blocks", "is blocked by")]).is_empty());
    }
}

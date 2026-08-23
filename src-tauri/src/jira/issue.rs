//! The in-app issue view: one issue's fields, its history, and posting a
//! comment back to it.
//!
//! The interesting part is the fields. Which of them matter is a property of
//! the Jira site, not of this app ("Plant-No.", "Analyseergebnis 1st Level",
//! …), and they live behind opaque `customfield_NNNNN` ids that differ per
//! site. So the caller names the fields it wants and this module resolves the
//! names through the site's field catalog — a wrong or renamed field then
//! quietly disappears from the view instead of breaking the request.
//!
//! That resolution exists to keep the issue request *narrow*. Asking Jira for
//! a wide field set (`*all`, or even `*navigable`) measured at ~10s per issue
//! on a service desk, against ~0.4s for the whole activity feed's three
//! requests. Naming the dozen fields this view actually shows is what makes
//! opening an issue feel immediate; the catalog is the price of being able to.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;

use super::types::*;
use super::{
    adf_doc, adf_to_text, format_rfc3339_local, parse_jira_ts, split_billable, JiraClient,
    COMMENT_PAGE_LIMIT,
};

/// Enough names to choose from without turning the picker into a list to be
/// read; a longer query is the way to narrow it.
const USER_SEARCH_LIMIT: u32 = 15;

/// The site's field catalog: normalised field name → Jira field id.
///
/// Fetched at most once per app run — fields are configuration, not data, and
/// the request is the expensive one (`/rest/api/3/field` answers with every
/// field on the instance). Shared across `JiraClient` clones like the other
/// caches, hence the `Arc`. `None` = not fetched yet.
pub(super) type FieldCache = Arc<tokio::sync::Mutex<Option<HashMap<String, String>>>>;

/// Assets object id → its display name. See [`JiraClient::asset_label`].
pub(super) type AssetCache = Arc<tokio::sync::Mutex<HashMap<String, String>>>;

/// The standard fields the view shows, requested by name on every issue.
const STANDARD_FIELDS: [&str; 12] = [
    "summary",
    "status",
    "priority",
    "issuetype",
    "reporter",
    "assignee",
    "duedate",
    "created",
    "updated",
    "description",
    "attachment",
    // Only for `projectTypeKey` — what actually says whether a comment here
    // can be public. See `service_desk` below.
    "project",
];

/// The field that only exists on service-desk requests, under either of the
/// two names Jira has shipped for it. Its presence is what tells us a comment
/// can be public — cheaper and more honest than a second API call.
const REQUEST_TYPE_NAMES: [&str; 2] = ["Request Type", "Customer Request Type"];

impl JiraClient {
    /// The site's field catalog, fetched at most once.
    ///
    /// The lock is deliberately held across the request: two issues opened at
    /// once should queue behind one fetch rather than run two.
    async fn field_ids(&self) -> Result<HashMap<String, String>, String> {
        let mut guard = self.field_cache.lock().await;
        if let Some(map) = guard.as_ref() {
            return Ok(map.clone());
        }
        let started = std::time::Instant::now();
        let fields: Vec<RawField> = self.get_json("/rest/api/3/field", &[], "field").await?;
        let elapsed = started.elapsed().as_millis();
        let mut map = HashMap::new();
        for f in fields {
            // First one wins: Jira lists the system fields before the custom
            // ones, and a custom field named after a system field should not
            // shadow it.
            map.entry(normalize_name(&f.name)).or_insert(f.id);
        }
        log::info!("field catalog: {} field(s) in {elapsed}ms", map.len());
        Ok(guard.insert(map).clone())
    }

    /// What an Assets object is called, fetched once per object per app run.
    ///
    /// Assets is a separate service on `api.atlassian.com` — the issue API
    /// hands out references into it and nothing more — so this is one extra
    /// request per distinct object. Cached because objects are reference data:
    /// several issues point at the same machine, and its name does not change
    /// while the app is open.
    async fn asset_label(&self, workspace_id: &str, object_id: &str) -> Option<String> {
        if let Some(hit) = self.asset_cache.lock().await.get(object_id) {
            return Some(hit.clone());
        }
        let url = format!(
            "https://api.atlassian.com/jsm/assets/workspace/{workspace_id}/v1/object/{object_id}"
        );
        let object: RawAssetObject = match self.get_json_absolute(&url, "asset").await {
            Ok(o) => o,
            Err(e) => {
                // Not fatal: the rest of the issue is still worth showing, and
                // the field simply stays absent as it did before.
                log::info!("asset {object_id} could not be read: {e}");
                return None;
            }
        };
        let label = object
            .label
            .or(object.object_key)
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())?;
        self.asset_cache
            .lock()
            .await
            .insert(object_id.to_string(), label.clone());
        Some(label)
    }

    /// Fetch the catalog ahead of the first issue view, so its cost is not
    /// paid while the user waits. Best-effort: a failure here only means
    /// [`Self::issue_detail`] fetches it itself.
    pub async fn warm_field_catalog(&self) {
        if let Err(e) = self.field_ids().await {
            log::debug!("field catalog warm-up failed: {e}");
        }
    }

    /// People matching `query`, for the comment box's mention picker.
    ///
    /// Needs the "Browse users" permission; without it Jira answers with an
    /// empty list rather than an error, so an empty result is not proof that
    /// nobody matched.
    pub async fn search_users(&self, query: &str) -> Result<Vec<JiraUser>, String> {
        let raw: Vec<RawUser> = self
            .get_json(
                "/rest/api/3/user/search",
                &[
                    ("query", query.to_string()),
                    ("maxResults", USER_SEARCH_LIMIT.to_string()),
                ],
                "user search",
            )
            .await?;
        Ok(raw
            .into_iter()
            // A deactivated account can be mentioned and will never read it.
            .filter(|u| u.active && !u.account_id.is_empty() && !u.display_name.trim().is_empty())
            .map(|u| JiraUser {
                account_id: u.account_id,
                display_name: u.display_name,
                email: u.email_address.filter(|e| !e.trim().is_empty()),
            })
            .collect())
    }

    /// Every field name the site defines, sorted — what the settings screen
    /// offers instead of having the user type a name that may not exist.
    ///
    /// Comes from the same catalog the issue view resolves names through, so
    /// anything listed here is guaranteed to resolve.
    pub async fn field_names(&self) -> Result<Vec<String>, String> {
        let fields: Vec<RawField> = self.get_json("/rest/api/3/field", &[], "field").await?;
        let mut names: Vec<String> = fields
            .into_iter()
            .map(|f| f.name)
            .filter(|n| !n.trim().is_empty())
            .collect();
        names.sort_by_key(|n| n.to_lowercase());
        names.dedup();
        Ok(names)
    }

    /// The fields this issue's edit form offers, in the same metadata shape a
    /// transition screen uses — which is why one renderer serves both.
    pub async fn issue_edit_fields(&self, issue_key: &str) -> Result<Vec<FieldMeta>, String> {
        #[derive(serde::Deserialize)]
        struct EditMeta {
            #[serde(default)]
            fields: HashMap<String, RawTransitionField>,
        }
        let meta: EditMeta = self
            .get_json(
                &format!("/rest/api/3/issue/{issue_key}/editmeta"),
                &[],
                "editmeta",
            )
            .await?;
        Ok(field_metas(meta.fields))
    }

    /// Write field values back to the issue. `fields` is already in Jira's own
    /// shape — the webview builds it with `toJiraFields`, exactly as it does
    /// for a transition screen.
    pub async fn update_issue_fields(&self, issue_key: &str, fields: Value) -> Result<(), String> {
        self.send_ok(
            self.http
                .put(self.url(&format!("/rest/api/3/issue/{issue_key}")))
                .json(&serde_json::json!({ "fields": fields })),
        )
        .await
    }

    /// Whatever Assets objects a field value points at, named and addressable.
    /// `None` when it points at none.
    async fn asset_names(&self, raw: Option<&Value>) -> Option<Vec<AssetLink>> {
        let refs = asset_refs(raw?);
        if refs.is_empty() {
            return None;
        }
        let mut links = Vec::new();
        for r in refs {
            if let Some(name) = self.asset_label(&r.workspace_id, &r.object_id).await {
                links.push(AssetLink {
                    name,
                    object_id: r.object_id,
                });
            }
        }
        (!links.is_empty()).then_some(links)
    }

    /// One issue with everything the detail view shows. `wanted` names the
    /// site-specific fields to include, in display order.
    pub async fn issue_detail(
        &self,
        issue_key: &str,
        wanted: &[&str],
    ) -> Result<IssueDetail, String> {
        let catalog = self.field_ids().await?;
        let resolve = |names: &[&str]| -> Vec<(String, String)> {
            names
                .iter()
                .filter_map(|label| {
                    let id = catalog.get(&normalize_name(label))?;
                    Some(((*label).to_string(), id.clone()))
                })
                .collect()
        };
        let wanted_fields = resolve(wanted);
        let request_type_fields = resolve(&REQUEST_TYPE_NAMES);

        // A wanted field the site has never heard of is a typo in the caller's
        // list, and silently showing one field fewer is a hard thing to
        // notice. Say so.
        if wanted_fields.len() != wanted.len() {
            let known: Vec<&str> = wanted_fields.iter().map(|(l, _)| l.as_str()).collect();
            let unknown: Vec<&&str> = wanted.iter().filter(|l| !known.contains(&(**l))).collect();
            log::info!("issue_detail: no field named {unknown:?} on this site");
        }

        // Naming every field keeps the response small — see the module docs.
        let field_list: Vec<&str> = STANDARD_FIELDS
            .iter()
            .copied()
            .chain(
                wanted_fields
                    .iter()
                    .chain(request_type_fields.iter())
                    .map(|(_, id)| id.as_str()),
            )
            .collect();

        let path = format!("/rest/api/3/issue/{issue_key}");
        let query = [("fields", field_list.join(","))];
        let raw: Value = self.get_json(&path, &query, "issue").await?;
        let fields = raw.get("fields").unwrap_or(&Value::Null);

        let text = |ptr: &str| {
            fields
                .pointer(ptr)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };

        // A field that resolves but renders as nothing disappears from the
        // view exactly as an unconfigured one would. The two have completely
        // different fixes, so they are logged apart — with the raw shape, since
        // "empty" usually means a value type `field_value` has not met.
        let mut unrendered: Vec<String> = Vec::new();
        let mut details: Vec<IssueField> = Vec::new();
        for (label, id) in &wanted_fields {
            let raw = fields.get(id);
            // Nothing to show directly — but an Assets field only ever holds
            // references, so this is where its objects get named.
            let assets = match raw.and_then(field_value) {
                Some(_) => Vec::new(),
                None => self.asset_names(raw).await.unwrap_or_default(),
            };
            let value = raw.and_then(field_value).or_else(|| {
                (!assets.is_empty()).then(|| {
                    assets
                        .iter()
                        .map(|a| a.name.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
            });
            match value {
                Some(value) => details.push(IssueField {
                    id: id.clone(),
                    label: label.clone(),
                    value,
                    assets,
                }),
                None => unrendered.push(format!(
                    "{label} ({id}) = {}",
                    crate::logging::one_line(
                        &raw.map(|v| v.to_string())
                            .unwrap_or_else(|| "absent".into()),
                        200
                    )
                )),
            }
        }
        if !unrendered.is_empty() {
            log::info!("issue_detail: nothing to show for {unrendered:?}");
        }

        // Whether a comment can be public is a property of the *project*, not
        // of one issue's fields. An agent-raised service-desk ticket carries no
        // request type, and taking that to mean "not a service desk" would have
        // the view offer a single comment button that posts publicly — telling
        // the user it is visible to everyone who can see the issue while it in
        // fact reaches the customer. The request type is kept as a fallback for
        // the case where `project` is not returned at all.
        let service_desk = fields
            .pointer("/project/projectTypeKey")
            .and_then(Value::as_str)
            .map(|kind| kind.eq_ignore_ascii_case("service_desk"))
            .unwrap_or_else(|| {
                request_type_fields
                    .iter()
                    .any(|(_, id)| fields.get(id).is_some_and(|v| !v.is_null()))
            });

        Ok(IssueDetail {
            key: raw
                .get("key")
                .and_then(Value::as_str)
                .unwrap_or(issue_key)
                .to_string(),
            summary: text("/summary").unwrap_or_default(),
            status: text("/status/name"),
            priority: text("/priority/name"),
            issue_type: text("/issuetype/name"),
            reporter: text("/reporter/displayName"),
            assignee: text("/assignee/displayName"),
            due_date: text("/duedate"),
            created_at: local_ts(&text("/created").unwrap_or_default()),
            updated_at: local_ts(&text("/updated").unwrap_or_default()),
            description: fields
                .get("description")
                .and_then(field_value)
                .unwrap_or_default(),
            details,
            service_desk,
            attachments: super::attachments::attachments(fields.get("attachment")),
        })
    }

    /// The issue's history — comments, status changes and worklogs of every
    /// user, newest first within each kind.
    ///
    /// The three stay apart all the way to the webview, which interleaves them
    /// for display. They are not three kinds of one thing: somebody talking,
    /// the workflow moving, and time being recorded answer different questions
    /// and only share a timeline. See CONTEXT.md.
    ///
    /// Uncached on purpose: it is read right after the user posts a comment or
    /// logs time, and a stale feed there would look like the write was lost.
    pub async fn issue_activity(&self, issue_key: &str) -> Result<IssueActivity, String> {
        let (raw_comments, changelog, raw_worklogs) = futures_util::try_join!(
            // `None` for the stamp: no cached page can prove itself current
            // without one, so the feed always refetches — which is the point.
            self.recent_comments(issue_key, None),
            self.recent_changelog(issue_key),
            // "0" = from the beginning; the feed shows the whole history.
            self.issue_worklogs(issue_key, "0"),
        )?;

        let comments_truncated = raw_comments.len() >= COMMENT_PAGE_LIMIT;
        let mut comments: Vec<IssueComment> = Vec::new();
        for c in raw_comments {
            let (created_at, created_ts) = stamp(&c.created);
            comments.push(IssueComment {
                id: format!("comment-{}", c.id),
                author: author_name(c.author.as_ref()),
                created_at,
                created_ts,
                text: c
                    .body
                    .as_ref()
                    .map(adf_to_text)
                    .unwrap_or_default()
                    .trim()
                    .to_string(),
                // Absent outside service-desk projects, where every comment is
                // visible to everyone who can see the issue.
                internal: c.jsd_public == Some(false),
            });
        }

        let mut status_changes: Vec<StatusChange> = Vec::new();
        for entry in changelog {
            let author = author_name(entry.author.as_ref());
            let (created_at, created_ts) = stamp(&entry.created);
            for item in entry.items.iter().filter(|i| i.field == "status") {
                status_changes.push(StatusChange {
                    // Several fields can change in one changelog entry, so the
                    // timestamp alone would not be unique.
                    id: format!(
                        "status-{}-{}",
                        entry.created,
                        item.to.as_deref().unwrap_or("")
                    ),
                    author: author.clone(),
                    created_at: created_at.clone(),
                    created_ts,
                    from: item.from.clone(),
                    to: item.to.clone(),
                });
            }
        }

        let mut worklogs: Vec<ActivityWorklog> = Vec::new();
        for w in raw_worklogs {
            let (_, comment) =
                split_billable(w.comment.as_ref().map(adf_to_text).unwrap_or_default());
            let (created_at, created_ts) = stamp(&w.started);
            worklogs.push(ActivityWorklog {
                id: format!("worklog-{}", w.id),
                author: author_name(w.author.as_ref()),
                created_at,
                created_ts,
                time_spent_seconds: w.time_spent_seconds,
                comment: comment.trim().to_string(),
            });
        }

        // On epoch seconds rather than the strings: Jira stamps each timestamp
        // in the *reporter's* timezone, so two entries an hour apart can sort
        // the wrong way round lexicographically.
        comments.sort_by_key(|c| std::cmp::Reverse(c.created_ts));
        status_changes.sort_by_key(|c| std::cmp::Reverse(c.created_ts));
        worklogs.sort_by_key(|w| std::cmp::Reverse(w.created_ts));

        Ok(IssueActivity {
            comments,
            comments_truncated,
            status_changes,
            worklogs,
        })
    }

    /// The moves the workflow permits from the issue's current status.
    ///
    /// `transitions.fields` is expanded because a transition with a required
    /// field cannot be run bare — Jira answers a field-less request with a 400
    /// — and the view has to know that *before* offering the button, not after
    /// the user presses it. The expansion costs nothing extra: it is the same
    /// request either way.
    pub async fn issue_transitions(&self, issue_key: &str) -> Result<Vec<Transition>, String> {
        let resp: TransitionsResp = self
            .get_json(
                &format!("/rest/api/3/issue/{issue_key}/transitions"),
                &[("expand", "transitions.fields".to_string())],
                "transitions",
            )
            .await?;
        Ok(resp
            .transitions
            .into_iter()
            .map(|t| Transition {
                id: t.id,
                name: t.name,
                to: t.to.map(|s| s.name),
                fields: field_metas(t.fields),
            })
            .collect())
    }

    /// Run one transition, by the id [`Self::issue_transitions`] handed out.
    ///
    /// Deliberately unlike `transition_to_status`, which resolves a status name
    /// and stays silent when it cannot: this is a button the user pressed, so a
    /// refusal has to reach them.
    /// `fields` carries the transition screen's answers, already in Jira's own
    /// shape (the webview builds it — see `toJiraFields`). Omitted entirely
    /// when the move runs bare, rather than sent as an empty object: Jira
    /// treats a present `fields` as a claim about the screen.
    pub async fn transition_issue(
        &self,
        issue_key: &str,
        transition_id: &str,
        fields: Option<Value>,
    ) -> Result<(), String> {
        let mut body = serde_json::json!({ "transition": { "id": transition_id } });
        if let Some(fields) = fields {
            body["fields"] = fields;
        }
        self.send_ok(
            self.http
                .post(self.url(&format!("/rest/api/3/issue/{issue_key}/transitions")))
                .json(&body),
        )
        .await
    }

    /// Post a comment. On a service-desk request `public` decides whether the
    /// customer sees it ("Reply to customer") or only agents do ("internal
    /// comment"); elsewhere the property is ignored by Jira and every comment
    /// is as visible as the issue itself.
    pub async fn add_comment(
        &self,
        issue_key: &str,
        text: &str,
        public: bool,
        mentions: &[MentionRef],
    ) -> Result<(), String> {
        let body = serde_json::json!({
            "body": adf_doc(text, mentions),
            "properties": [{
                "key": "sd.public.comment",
                "value": { "internal": !public }
            }]
        });
        self.send_ok(
            self.http
                .post(self.url(&format!("/rest/api/3/issue/{issue_key}/comment")))
                .json(&body),
        )
        .await
    }
}

/// Jira's field map turned into a list the webview can render in a stable
/// order.
///
/// Sorted required-first, then by name: a map has no order at all, so without
/// this the screen would reshuffle between openings. Required first because
/// those are the fields standing between the user and the move.
pub(super) fn field_metas(fields: HashMap<String, RawTransitionField>) -> Vec<FieldMeta> {
    let mut metas: Vec<FieldMeta> = fields
        .into_iter()
        .map(|(key, f)| {
            let schema = f.schema.unwrap_or(RawFieldSchema {
                schema_type: String::new(),
                items: None,
                custom: None,
                system: None,
            });
            let name = f.name.trim();
            FieldMeta {
                id: f.field_id.unwrap_or_else(|| key.clone()),
                name: if name.is_empty() {
                    key
                } else {
                    name.to_string()
                },
                required: f.required,
                schema_type: schema.schema_type,
                schema_items: schema.items,
                schema_custom: schema.custom,
                schema_system: schema.system,
                operations: f.operations,
                allowed_values: f
                    .allowed_values
                    .into_iter()
                    .map(|v| AllowedValue {
                        label: v
                            .value
                            .or(v.name)
                            .filter(|l| !l.trim().is_empty())
                            .unwrap_or_else(|| v.id.clone()),
                        id: v.id,
                    })
                    .collect(),
            }
        })
        .collect();
    metas.sort_by(|a, b| {
        b.required
            .cmp(&a.required)
            .then_with(|| a.name.cmp(&b.name))
    });
    metas
}

/// Field names are compared without case, spaces or punctuation, so the
/// configured "Plant-No." still finds a field the site calls "Plant No".
fn normalize_name(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// Where an object keeps the text worth showing, most specific first.
///
/// Jira has no convention here. A select option says `value`, a user
/// `displayName`, a version or component `name` — and an Assets (Insight)
/// object says `label`, with `objectKey` as its identifier. A shape none of
/// these fit renders as nothing, which is why a field can silently go missing
/// when a site uses a type this list has not met.
const DISPLAY_KEYS: [&str; 5] = ["value", "displayName", "name", "label", "objectKey"];

/// The Assets objects one field value points at, in order.
///
/// An Assets field arrives as bare references — `{workspaceId, objectId}` and
/// nothing else — so a field holding one renders as empty until the objects
/// themselves are fetched.
fn asset_refs(v: &Value) -> Vec<RawAssetRef> {
    let one = |v: &Value| -> Option<RawAssetRef> {
        let r: RawAssetRef = serde_json::from_value(v.clone()).ok()?;
        (!r.workspace_id.is_empty() && !r.object_id.is_empty()).then_some(r)
    };
    match v {
        Value::Array(items) => items.iter().filter_map(one).collect(),
        _ => one(v).into_iter().collect(),
    }
}

/// Render one raw field value as display text, or `None` when it is empty.
///
/// Jira has no single shape for a custom field: a text field is a string, a
/// select is `{ value }`, a user picker `{ displayName }`, a version or
/// component `{ name }`, an Assets object `{ label, objectKey }`, a
/// multi-select an array of any of those, and a rich-text field a whole ADF
/// document.
fn field_value(v: &Value) -> Option<String> {
    let text = match v {
        Value::Null => return None,
        Value::String(s) => s.trim().to_string(),
        Value::Bool(b) => (if *b { "Yes" } else { "No" }).to_string(),
        Value::Number(n) => n.to_string(),
        Value::Array(items) => items
            .iter()
            .filter_map(field_value)
            .collect::<Vec<_>>()
            .join(", "),
        Value::Object(map) => {
            if map.get("type").and_then(Value::as_str) == Some("doc") {
                adf_to_text(v).trim().to_string()
            } else {
                // In priority order, because an object can carry several: an
                // Assets (Insight) object has both `label` and `objectKey`, and
                // the label is the one a person recognises.
                DISPLAY_KEYS
                    .iter()
                    .find_map(|k| map.get(*k).and_then(Value::as_str))
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            }
        }
    };
    (!text.is_empty()).then_some(text)
}

/// Jira's timestamp as (RFC3339 in the local timezone, epoch seconds).
///
/// The string is what the webview renders — Jira writes the offset without a
/// colon, which `new Date(…)` does not parse. The seconds are what it sorts
/// the three activity lists on. An unparseable stamp yields an empty string
/// and 0 rather than a wrong date.
pub(super) fn stamp(jira_ts: &str) -> (String, i64) {
    match parse_jira_ts(jira_ts) {
        Some(ts) => (format_rfc3339_local(ts), ts),
        None => (String::new(), 0),
    }
}

/// Jira's timestamp as RFC3339 local, for the fields that carry no ordering.
fn local_ts(jira_ts: &str) -> String {
    stamp(jira_ts).0
}

/// Jira omits `displayName` for deleted or anonymised users.
pub(super) fn author_name(author: Option<&WorklogAuthor>) -> String {
    author
        .and_then(|a| a.display_name.clone())
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "Someone".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn raw(required: bool, name: &str) -> RawTransitionField {
        RawTransitionField {
            required,
            name: name.to_string(),
            field_id: None,
            schema: None,
            operations: vec!["set".to_string()],
            allowed_values: vec![],
        }
    }

    #[test]
    fn screen_fields_are_ordered_required_first_then_by_name() {
        // Jira hands back a map, which has no order; without this the screen
        // reshuffles every time it is opened.
        let metas = field_metas(HashMap::from([
            ("b".to_string(), raw(false, "Notes")),
            ("a".to_string(), raw(false, "Assignee")),
            ("r".to_string(), raw(true, "Resolution")),
        ]));
        assert_eq!(
            metas.iter().map(|m| m.name.as_str()).collect::<Vec<_>>(),
            ["Resolution", "Assignee", "Notes"]
        );
    }

    #[test]
    fn a_field_without_a_name_falls_back_to_its_key() {
        let metas = field_metas(HashMap::from([(
            "customfield_10042".to_string(),
            raw(true, "  "),
        )]));
        assert_eq!(metas[0].name, "customfield_10042");
        assert_eq!(metas[0].id, "customfield_10042");
    }

    #[test]
    fn allowed_values_take_whichever_label_jira_sent() {
        let mut f = raw(true, "Resolution");
        f.allowed_values = vec![
            RawAllowedValue {
                id: "1".into(),
                value: Some("VPN".into()),
                name: None,
            },
            RawAllowedValue {
                id: "2".into(),
                value: None,
                name: Some("Done".into()),
            },
            // Neither: the id is all there is to show.
            RawAllowedValue {
                id: "3".into(),
                value: None,
                name: None,
            },
        ];
        let metas = field_metas(HashMap::from([("resolution".to_string(), f)]));
        let labels: Vec<&str> = metas[0]
            .allowed_values
            .iter()
            .map(|v| v.label.as_str())
            .collect();
        assert_eq!(labels, ["VPN", "Done", "3"]);
    }

    #[test]
    fn schema_parts_are_passed_through_rather_than_interpreted() {
        let mut f = raw(false, "Description");
        f.schema = Some(RawFieldSchema {
            schema_type: "string".into(),
            items: None,
            custom: Some("…:textarea".into()),
            system: None,
        });
        let metas = field_metas(HashMap::from([("description".to_string(), f)]));
        assert_eq!(metas[0].schema_type, "string");
        assert_eq!(metas[0].schema_custom.as_deref(), Some("…:textarea"));
        assert_eq!(metas[0].schema_items, None);
    }

    #[test]
    fn normalizes_away_case_and_punctuation() {
        assert_eq!(normalize_name("Plant-No."), normalize_name("plant no"));
        assert_eq!(
            normalize_name("Analyseergebnis 1st Level"),
            normalize_name("analyseergebnis1stlevel")
        );
        assert_ne!(normalize_name("Remote Access"), normalize_name("Remote"));
    }

    #[test]
    fn renders_every_field_shape() {
        assert_eq!(field_value(&json!("  A-12  ")), Some("A-12".to_string()));
        assert_eq!(field_value(&json!(42)), Some("42".to_string()));
        assert_eq!(field_value(&json!(true)), Some("Yes".to_string()));
        assert_eq!(
            field_value(&json!({ "value": "VPN" })),
            Some("VPN".to_string())
        );
        assert_eq!(
            field_value(&json!({ "displayName": "Malte Polzin" })),
            Some("Malte Polzin".to_string())
        );
        assert_eq!(
            field_value(&json!({ "name": "Line 3" })),
            Some("Line 3".to_string())
        );
        assert_eq!(
            field_value(&json!([{ "value": "VPN" }, { "value": "TeamViewer" }])),
            Some("VPN, TeamViewer".to_string())
        );
    }

    #[test]
    fn renders_a_rich_text_field_as_text() {
        let doc = json!({
            "type": "doc",
            "version": 1,
            "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Pump stalled" }] }]
        });
        assert_eq!(field_value(&doc), Some("Pump stalled".to_string()));
    }

    #[test]
    fn renders_an_assets_object_by_its_label() {
        // Jira Assets (Insight) objects carry neither `value` nor `name`, so a
        // field holding one used to render as empty and disappear entirely.
        let asset = json!({
            "id": "1",
            "workspaceId": "abc",
            "objectId": "42",
            "label": "SRV-PUMP-01",
            "objectKey": "ITSM-142"
        });
        assert_eq!(field_value(&asset), Some("SRV-PUMP-01".to_string()));
        // Several of them, as the field actually arrives.
        assert_eq!(
            field_value(&json!([asset.clone(), asset])),
            Some("SRV-PUMP-01, SRV-PUMP-01".to_string())
        );
    }

    #[test]
    fn falls_back_to_the_object_key_when_there_is_no_label() {
        assert_eq!(
            field_value(&json!({ "objectKey": "ITSM-142" })),
            Some("ITSM-142".to_string())
        );
    }

    #[test]
    fn empty_values_are_dropped() {
        assert_eq!(field_value(&json!(null)), None);
        assert_eq!(field_value(&json!("   ")), None);
        assert_eq!(field_value(&json!([])), None);
        // An option object Jira sends without any of the names we know.
        assert_eq!(field_value(&json!({ "id": "10001" })), None);
    }
}

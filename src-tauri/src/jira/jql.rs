//! Building the JQL the app sends, and the escaping that keeps user text out
//! of the query's grammar.
//!
//! The webview never supplies raw JQL: it hands over a term, a key or a
//! settings value, and every query is assembled here. Two escapers do that
//! work — [`escape_jql`] for the JQL parser and [`escape_jql_text`] for the
//! text index behind a `~` clause — and which one a clause needs is a property
//! of the clause, so both live beside the builders that pick between them.

use std::collections::{BTreeMap, HashMap};

use super::types::*;

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
    let esc = escape_jql_text(trimmed);
    format!("(summary ~ \"{esc}*\" OR text ~ \"{esc}\") ORDER BY updated DESC")
}

/// A plain text search, over every text field Jira will search.
///
/// Unlike [`build_search_jql`], which is the issue picker's and reads an issue
/// key as a key, this takes the term at its word: somebody who asked to search
/// for text means the text.
pub fn build_text_jql(term: &str) -> String {
    let esc = escape_jql_text(term.trim());
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
pub(super) fn build_todo_jql(cfg: &TodoConfig) -> String {
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
pub(super) fn drop_ignored_statuses(
    issues: Vec<IssueSummary>,
    cfg: &TodoConfig,
) -> Vec<IssueSummary> {
    // Lowercased once, up front. Doing it inside the filter meant re-folding
    // every configured project key and status name for every issue that came
    // back — a fresh allocation per comparison, over up to 100 issues.
    // Merged rather than collected: settings can hold "DEV" and "dev" as two
    // separate keys, and the old scan matched both, so folding them has to
    // union their names instead of letting one win.
    let mut ignored: HashMap<String, std::collections::HashSet<String>> = HashMap::new();
    for (project, names) in &cfg.ignored_statuses {
        ignored
            .entry(project.to_lowercase())
            .or_default()
            .extend(names.iter().map(|n| n.to_lowercase()));
    }

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
            !ignored
                .get(&project)
                .is_some_and(|names| names.contains(&status.to_lowercase()))
        })
        .collect()
}

/// `"a", "b"` — JQL-escaped and quoted, ready for an `IN (…)` list.
pub(super) fn quoted(names: &[String]) -> String {
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
pub(super) fn open_status_names(raw: Vec<RawIssueTypeStatuses>) -> Vec<String> {
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

pub(super) fn escape_jql(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Characters Jira's text index reserves.
///
/// `&` and `|` are listed singly although Lucene only reserves them doubled:
/// escaping a lone one changes nothing about what it matches, and looking for
/// pairs would be a parser for no gain.
const LUCENE_RESERVED: &[char] = &[
    '+', '-', '!', '(', ')', '{', '}', '[', ']', '^', '"', '~', '*', '?', ':', '\\', '/', '&', '|',
];

/// Escape a value on its way into a `~` clause.
///
/// [`escape_jql`] makes a value safe for the JQL *parser*, which is all a `=` or
/// an `IN` needs: the quoted literal is consumed as a name and read no further.
/// `~` is different — Jira hands the right-hand side on to its text index, where
/// another set of characters is reserved. So `C++`, `(draft)` and `a:b` came back
/// as `400 … Unable to parse text query`: not a leak, but a flat failure on
/// ordinary input, explained in the text index's vocabulary rather than the
/// app's.
///
/// Escaped for the index first and for the parser second, because the backslashes
/// this adds have themselves to survive the parser. A wildcard the caller appends
/// afterwards stays a wildcard, which is the point of doing it here rather than
/// on the finished clause.
pub(super) fn escape_jql_text(s: &str) -> String {
    let mut escaped = String::with_capacity(s.len());
    for c in s.chars() {
        if LUCENE_RESERVED.contains(&c) {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    escape_jql(&escaped)
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// The webview reads issue keys too — the command palette offers to open one
    /// the moment you have typed it — and `parseIssueKey` in `src/issueKey.ts`
    /// mirrors this function rule for rule. Where the two disagree, the palette
    /// offers a key this side then refuses.
    ///
    /// So the same table lives in both suites, asserted here and in
    /// `src/issueKey.test.ts`. Changing either rule without the other breaks one
    /// of them, which is the point of writing it twice.
    #[test]
    fn issue_key_shapes_match_the_webviews() {
        for ok in ["ABC-1", "AB-7", "PERFORMA-1234", "A1B-9", "abc-1", "aBc-12"] {
            assert!(is_issue_key(ok), "{ok} should be a key");
        }
        for bad in [
            "refresh", "A-1", "-1", "ABC-", "ABC-1a", "1BC-1", "A.C-1", "ABC1", "", "ABC-1-2",
            "AB-CD-1",
        ] {
            assert!(!is_issue_key(bad), "{bad} should not be a key");
        }
    }

    #[test]
    fn text_search_is_not_a_field_search() {
        // A field search names its field and is built in `issue.rs`, where the
        // catalogue is; this builder is the one that searches everything.
        let jql = build_text_jql("pump");
        assert!(jql.contains("summary ~"), "{jql}");
        assert!(jql.contains("text ~"), "{jql}");
        assert!(!jql.contains("cf["), "{jql}");
    }

    #[test]
    fn text_jql_takes_a_key_as_text() {
        // Unlike the picker's builder, which reads a key as a key: somebody who
        // asked to search for text means the text. The hyphen arrives escaped
        // because the text index reserves it, which is a spelling rather than a
        // change of meaning.
        let jql = build_text_jql("ABC-1");
        assert!(jql.contains(r##"summary ~ "ABC\\-1*""##), "{jql}");
        assert!(!jql.starts_with("key ="), "{jql}");
    }

    #[test]
    fn a_text_search_survives_the_characters_lucene_reserves() {
        // These came back as `400 … Unable to parse text query` — not a leak,
        // but a flat failure on ordinary input.
        for term in ["C++", "(draft)", "a:b", "*", "a-b", "50%~", "x && y"] {
            let jql = build_text_jql(term);
            // Every reserved character carries a backslash by the time it is in
            // the clause, doubled so it survives the JQL parser on the way.
            for c in term.chars().filter(|c| LUCENE_RESERVED.contains(c)) {
                assert!(jql.contains(&format!("\\\\{c}")), "{c} unescaped in {jql}");
            }
        }
    }

    #[test]
    fn the_wildcard_stays_a_wildcard() {
        // Escaping happens to the term, not to the clause — otherwise the `*`
        // this appends would be escaped along with it and match a literal star.
        let jql = build_text_jql("pump");
        assert!(jql.contains(r#"summary ~ "pump*""#), "{jql}");
    }

    #[test]
    fn an_exact_clause_keeps_the_plainer_escaper() {
        // `=` compares a literal: only the JQL parser has to survive it, and
        // backslashing `-` there would look for a name nobody has.
        assert_eq!(escape_jql("O2C-1"), "O2C-1");
        assert!(escape_jql_text("O2C-1").contains("\\-"));
    }

    #[test]
    fn search_jql_escapes_user_text() {
        // The property that matters: a quote in the term cannot close the string
        // it sits in, so nothing after it is read as JQL. Both escapers run here
        // now — the text index reserves the quote and the backslash too — so the
        // assertion is about what the term cannot do rather than about the exact
        // number of backslashes.
        let jql = build_search_jql(r#"quo"te \ back"#);
        assert!(!jql.contains(r#" "quo""#), "{jql}");
        // Every quote in the clause is either a delimiter or escaped; none is
        // left bare in the middle of a value.
        assert!(!jql.contains(r#"quo"te"#), "{jql}");
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
            kept(
                &cfg,
                &[("DEV-4596", "In Progress"), ("DEV-1", "IN PROGRESS")]
            ),
            Vec::<String>::new()
        );
    }

    #[test]
    fn case_variant_project_keys_pool_their_ignored_statuses() {
        // Settings hold the project key as the user typed it, so the same
        // project can appear twice in different case. Each spelling's list
        // still counts — folding them for the lookup must union the names,
        // not let one spelling win.
        let cfg = todo_cfg(&[("DEV", &["In Progress"]), ("dev", &["Escalated"])]);
        assert_eq!(
            kept(
                &cfg,
                &[
                    ("DEV-1", "In Progress"),
                    ("DEV-2", "Escalated"),
                    ("DEV-3", "Open"),
                ]
            ),
            vec!["DEV-3".to_string()]
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
}

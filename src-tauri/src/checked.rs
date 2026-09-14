//! Input validation at the IPC boundary.
//!
//! The webview is untrusted by design (the token lives only in this process),
//! so everything it hands a command is checked here before it reaches a URL,
//! JQL, a request body or the filesystem. Commands call these and nothing
//! else; a new bound belongs in this file, not inline in a command.

use crate::creds::Credentials;
use std::collections::BTreeMap;

// Bounds on the todo tab's ignored-status list, which the webview supplies
// from local settings. Not a security boundary on its own (every name is still
// JQL-escaped) — just a cap on how much a corrupt settings entry can push into
// one query.
const MAX_IGNORED_PROJECTS: usize = 200;
// The same bound for the projects a saved search leaves out, and for the same
// reason: every one of them widens the query, and the JQL goes out as a URL
// parameter — a list long enough is a 414 the reader cannot trace back to a
// settings screen.
const MAX_EXCLUDED_PROJECTS: usize = 200;
const MAX_IGNORED_STATUSES: usize = 100;
const MAX_STATUS_NAME_CHARS: usize = 255;

// How many site-specific fields the issue view will ask for, and how long a
// field name may be. The names come from the webview (they are a setting), and
// every one of them widens the issue request — so the bound is here rather
// than in the settings screen, which is only one of the ways they could
// arrive.
const MAX_DETAIL_FIELDS: usize = 30;
const MAX_FIELD_NAME_CHARS: usize = 100;

// What the palette's searches will look for. Its own constant rather than the
// field-name bound: the two answer different questions, and tightening the
// issue view's request width should not quietly shrink what can be searched
// for. Generous, because a term is somebody's sentence — Jira's own comment
// bound is two orders larger again.
const MAX_SEARCH_TERM_CHARS: usize = 500;

// Jira rejects a comment body over 32767 characters with an unhelpful error.
// Refusing it here means the user is told what is wrong while their text is
// still in the box.
const MAX_COMMENT_CHARS: usize = 32_767;

pub fn issue_key(key: &str) -> Result<&str, String> {
    if crate::jira::is_issue_key(key) {
        Ok(key)
    } else {
        Err(format!("invalid issue key '{key}'"))
    }
}

/// Jira's own record ids — an attachment, a link, a transition, a worklog —
/// are numeric strings, and every one of them reaches a URL path or a request
/// body. They are all held to the same shape, so `kind` only names which id is
/// being refused.
pub fn jira_id<'a>(kind: &str, id: &'a str) -> Result<&'a str, String> {
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
        Ok(id)
    } else {
        Err(format!("invalid {kind} id '{id}'"))
    }
}

/// Project keys are interpolated into a URL path, so hold them to the shape
/// Jira actually allows.
pub fn project_key(key: &str) -> Result<&str, String> {
    let mut chars = key.chars();
    let ok = key.len() >= 2
        && key.len() <= 20
        && matches!(chars.next(), Some(c) if c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_');
    if ok {
        Ok(key)
    } else {
        Err(format!("invalid project key '{key}'"))
    }
}

pub fn date(s: &str) -> Result<&str, String> {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .map_err(|_| format!("invalid date '{s}', expected yyyy-MM-dd"))?;
    Ok(s)
}

/// Bound what settings can push into the todo JQL: entries under a key that
/// isn't a project are dropped, as are projects that end up ignoring nothing,
/// and the number of projects is capped. Silently — a stale settings entry
/// must never break the tab.
pub fn ignored_statuses(ignored: BTreeMap<String, Vec<String>>) -> BTreeMap<String, Vec<String>> {
    ignored
        .into_iter()
        .filter(|(project, _)| project_key(project).is_ok())
        .map(|(project, names)| (project, status_names(names)))
        .filter(|(_, names)| !names.is_empty())
        .take(MAX_IGNORED_PROJECTS)
        .collect()
}

/// Bound one project's list: blanks dropped, duplicates collapsed, over-long
/// names and an over-long list truncated. The names are JQL-escaped downstream
/// regardless — this only caps how much a corrupt entry can push into a query.
fn status_names(names: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for name in names {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > MAX_STATUS_NAME_CHARS {
            continue;
        }
        if !out.iter().any(|kept| kept == name) {
            out.push(name.to_string());
        }
        if out.len() >= MAX_IGNORED_STATUSES {
            break;
        }
    }
    out
}

/// A comment body Jira will accept. Empty is a mis-click rather than a
/// request, and an over-long one is rejected by Jira after the round trip.
pub fn comment_text(text: &str) -> Result<&str, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("a comment needs some text".to_string());
    }
    if trimmed.chars().count() > MAX_COMMENT_CHARS {
        return Err(format!(
            "comment is too long ({} characters; Jira allows {MAX_COMMENT_CHARS})",
            trimmed.chars().count()
        ));
    }
    Ok(trimmed)
}

/// The projects one of the palette's searches leaves out.
///
/// Sanitised rather than validated, the way [`status_names`] is: these come
/// from a settings screen whose checkboxes can only produce real keys, so
/// anything else is a corrupt stored value rather than a user's mistake, and
/// refusing the whole search over one bad entry helps nobody. A blank one
/// would reach the JQL as `project NOT IN ("")`, which Jira rejects — so that
/// search would fail on every run, permanently, with nothing to say why.
pub fn excluded_projects(keys: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for key in keys {
        let key = key.trim();
        if project_key(key).is_err() {
            continue;
        }
        if !out.iter().any(|kept| kept == key) {
            out.push(key.to_string());
        }
        if out.len() >= MAX_EXCLUDED_PROJECTS {
            break;
        }
    }
    out
}

/// What one of the palette's searches is looking for.
///
/// Blank comes back as `Ok("")` rather than an error: the palette calls on every
/// submission and an empty box is a search nobody ran, not a mistake worth a
/// message. Too long *is* an error, and says so — returning an empty list there
/// would draw "Nothing found", which is a claim about Jira rather than about the
/// term, and sends the reader looking in the wrong place.
pub fn search_term(term: &str) -> Result<&str, String> {
    let trimmed = term.trim();
    if trimmed.chars().count() > MAX_SEARCH_TERM_CHARS {
        return Err(format!(
            "that search term is too long ({} characters; the most is {MAX_SEARCH_TERM_CHARS})",
            trimmed.chars().count()
        ));
    }
    Ok(trimmed)
}

/// The field one of the user's own searches looks in.
pub fn search_field(field: &str) -> Result<&str, String> {
    let field = field.trim();
    if field.is_empty() || field.chars().count() > MAX_FIELD_NAME_CHARS {
        return Err("that search names no field to look in".into());
    }
    Ok(field)
}

/// What the comment box's mention picker asks for, or `None` when there is
/// nothing worth asking. One character is enough for Jira and keeps the picker
/// responsive from the first keystroke; an empty query would ask it for
/// everybody.
pub fn user_query(query: &str) -> Option<&str> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > MAX_FIELD_NAME_CHARS {
        None
    } else {
        Some(query)
    }
}

/// The site-specific field names the issue view asks for. These are matched
/// against the site's own field catalog rather than interpolated anywhere, so
/// the check is about size, not shape: a very long list makes for a very wide
/// issue request.
pub fn field_names(names: Vec<String>) -> Result<Vec<String>, String> {
    if names.len() > MAX_DETAIL_FIELDS {
        return Err(format!(
            "too many fields configured ({}; at most {MAX_DETAIL_FIELDS})",
            names.len()
        ));
    }
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for name in names {
        let name = name.trim().to_string();
        // Blank entries and repeats are settings-screen debris, not an error
        // worth refusing the whole view over.
        if name.is_empty() || name.chars().count() > MAX_FIELD_NAME_CHARS {
            continue;
        }
        if seen.insert(name.to_lowercase()) {
            out.push(name);
        }
    }
    Ok(out)
}

/// A link between two issues: both keys, which half of the relationship was
/// picked, and the relationship's name, which comes back trimmed.
pub fn link<'a>(
    from: &str,
    to: &str,
    type_name: &'a str,
    direction: &str,
) -> Result<&'a str, String> {
    issue_key(from)?;
    issue_key(to)?;
    // Linking an issue to itself is a mis-click Jira answers with a 400; say
    // what happened instead of passing its wording on.
    if from.eq_ignore_ascii_case(to) {
        return Err("an issue cannot be linked to itself".to_string());
    }
    if direction != "inward" && direction != "outward" {
        return Err(format!("invalid link direction '{direction}'"));
    }
    let type_name = type_name.trim();
    if type_name.is_empty() {
        return Err("pick a relationship first".to_string());
    }
    Ok(type_name)
}

/// An attachment's name reaches the filesystem, so it must stay a *name*: no
/// separators, no parent-directory hops, nothing empty. Jira's own value is
/// normally fine; this is about what the webview could send instead.
pub fn filename(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    let safe = !trimmed.is_empty()
        // Characters, not bytes, like every other bound here: counting bytes
        // would cut a German or Japanese file name off at a third of the
        // length and reject it as "unsafe", which it is not.
        && trimmed.chars().count() <= 200
        && !trimmed.contains(['/', '\\', '\0'])
        && trimmed != "."
        && trimmed != ".."
        && !trimmed.contains("..");
    if safe {
        Ok(trimmed.to_string())
    } else {
        Err(format!("unsafe attachment name '{name}'"))
    }
}

/// Normalize a user-entered site into `https://host` with no trailing slash.
///
/// Plain `http` is refused: the API token rides along as a Basic-auth header
/// on every single request, so an unencrypted site would put it on the wire in
/// clear. Loopback is the one exception — that traffic never leaves the
/// machine, and it keeps a local test double usable.
pub fn site(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    // Split the scheme off before trimming slashes — otherwise a bare
    // "https://" would collapse into a "https:" hostname.
    let (scheme, host) = match trimmed.split_once("://") {
        None => ("https", trimmed),
        Some((scheme, rest)) => (scheme, rest),
    };
    let host = host.trim_end_matches('/');
    if host.is_empty() {
        return Err("Jira site required, e.g. your-team.atlassian.net".to_string());
    }
    if scheme.eq_ignore_ascii_case("http") && !is_loopback(host) {
        return Err(
            "refusing a plain http site: your API token is sent with every \
             request and would travel unencrypted — use https://"
                .to_string(),
        );
    }
    if !scheme.eq_ignore_ascii_case("https") && !scheme.eq_ignore_ascii_case("http") {
        return Err(format!("unsupported scheme '{scheme}://' — use https://"));
    }
    Ok(format!("{}://{host}", scheme.to_ascii_lowercase()))
}

/// Does this `host[:port][/path]` address the local machine?
fn is_loopback(host: &str) -> bool {
    let authority = host.split('/').next().unwrap_or("");
    let hostname = match authority.strip_prefix('[') {
        // Bracketed IPv6: `[::1]:8080` → `::1`
        Some(rest) => rest.split(']').next().unwrap_or(""),
        None => authority.split(':').next().unwrap_or(""),
    };
    matches!(hostname, "localhost" | "127.0.0.1" | "::1")
}

/// May the stored token be sent to this site/account without re-entering it?
/// Only when both are unchanged — host and address compare case-insensitively,
/// since neither DNS nor Jira's account addresses distinguish case.
pub fn may_reuse_token(stored: &Credentials, site: &str, email: &str) -> bool {
    stored.site.eq_ignore_ascii_case(site) && stored.email.eq_ignore_ascii_case(email)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_search_term_is_bounded_but_a_blank_one_is_not_an_error() {
        assert_eq!(search_term("  DE_1979  "), Ok("DE_1979"));
        // The palette submits on every Enter; an empty box is a search nobody
        // ran rather than a mistake worth a message.
        assert_eq!(search_term("   "), Ok(""));
        // Too long *is* said out loud: an empty result there would read as
        // "Jira found nothing", which sends the reader looking in the wrong
        // place.
        assert!(search_term(&"a".repeat(MAX_SEARCH_TERM_CHARS + 1)).is_err());
        // Characters, not bytes, like every other bound here.
        assert!(search_term(&"ä".repeat(MAX_SEARCH_TERM_CHARS)).is_ok());
    }

    #[test]
    fn a_search_names_a_field_to_look_in() {
        assert_eq!(search_field("  Summary "), Ok("Summary"));
        assert!(search_field("   ").is_err());
        assert!(search_field(&"x".repeat(MAX_FIELD_NAME_CHARS + 1)).is_err());
    }

    #[test]
    fn a_user_query_worth_asking_jira_about() {
        assert_eq!(user_query(" m "), Some("m"));
        // An empty query would ask Jira for everybody.
        assert_eq!(user_query("  "), None);
        assert_eq!(user_query(&"x".repeat(MAX_FIELD_NAME_CHARS + 1)), None);
    }

    #[test]
    fn a_link_is_checked_before_it_reaches_jira() {
        assert_eq!(link("ABC-1", "ABC-2", "  Blocks ", "outward"), Ok("Blocks"));
        assert!(link("../x", "ABC-2", "Blocks", "outward").is_err());
        assert!(link("ABC-1", "ABC-2/x", "Blocks", "outward").is_err());
        assert_eq!(
            link("ABC-1", "abc-1", "Blocks", "inward").unwrap_err(),
            "an issue cannot be linked to itself"
        );
        assert!(link("ABC-1", "ABC-2", "Blocks", "sideways").is_err());
        assert!(link("ABC-1", "ABC-2", "  ", "inward").is_err());
    }

    #[test]
    fn excluded_projects_are_sanitised_rather_than_refused() {
        // The settings checkboxes can only produce real keys, so anything else
        // is a corrupt stored value — and failing the whole search over one bad
        // entry helps nobody.
        assert_eq!(
            excluded_projects(vec!["O2C".into(), "  DEV  ".into()]),
            vec!["O2C".to_string(), "DEV".to_string()]
        );
        // A blank one would reach the JQL as `project NOT IN ("")`, which Jira
        // rejects — so that search would fail on every run, permanently.
        assert!(excluded_projects(vec!["".into(), "  ".into()]).is_empty());
        assert!(excluded_projects(vec!["a".into()]).is_empty());
        assert!(excluded_projects(vec!["has space".into()]).is_empty());
    }

    #[test]
    fn excluded_projects_are_deduped_and_capped() {
        assert_eq!(
            excluded_projects(vec!["DEV".into(), "DEV".into(), "O2C".into()]),
            vec!["DEV".to_string(), "O2C".to_string()]
        );
        // Every one of them widens the query, and the JQL goes out as a URL
        // parameter.
        let many: Vec<String> = (0..MAX_EXCLUDED_PROJECTS + 50)
            .map(|i| format!("PR{i}"))
            .collect();
        assert_eq!(excluded_projects(many).len(), MAX_EXCLUDED_PROJECTS);
    }

    #[test]
    fn comment_text_is_validated() {
        assert_eq!(comment_text("  Pump stalled  "), Ok("Pump stalled"));
        // A mis-click, not a request.
        assert!(comment_text("").is_err());
        assert!(comment_text("   \n  ").is_err());
        // Counted in characters, not bytes: an umlaut is not two thirds of one.
        let umlauts = "ä".repeat(MAX_COMMENT_CHARS);
        assert!(comment_text(&umlauts).is_ok());
        assert!(comment_text(&"a".repeat(MAX_COMMENT_CHARS + 1)).is_err());
    }

    #[test]
    fn attachment_names_stay_file_names() {
        assert_eq!(filename("  report.pdf "), Ok("report.pdf".into()));
        // The name reaches the filesystem, so a path must not survive in it.
        assert!(filename("../../etc/passwd").is_err());
        assert!(filename("a/b.txt").is_err());
        // Counted in characters like the comment bound above: a name of
        // umlauts is not two thirds of a name.
        assert!(filename(&"ä".repeat(200)).is_ok());
        assert!(filename(&"a".repeat(201)).is_err());
        assert!(filename("a\\b.txt").is_err());
        assert!(filename("..").is_err());
        assert!(filename("").is_err());
        assert!(filename("   ").is_err());
        assert!(filename(&"x".repeat(201)).is_err());
    }

    #[test]
    fn attachment_ids_are_validated() {
        assert!(jira_id("attachment", "10042").is_ok());
        assert!(jira_id("attachment", "").is_err());
        assert!(jira_id("attachment", "../10042").is_err());
        assert!(jira_id("attachment", "abc").is_err());
    }

    #[test]
    fn transition_ids_are_validated() {
        assert!(jira_id("transition", "31").is_ok());
        assert!(jira_id("transition", "").is_err());
        // The id reaches a request body; anything but Jira's own digits is a
        // webview that has been tampered with.
        assert!(jira_id("transition", "31; drop").is_err());
        assert!(jira_id("transition", "abc").is_err());
    }

    #[test]
    fn project_keys_are_validated() {
        assert!(project_key("DEV").is_ok());
        assert!(project_key("AB1").is_ok());
        assert!(project_key("MY_PROJ").is_ok());
        // A key reaches a URL path, so path tricks must not survive.
        assert!(project_key("").is_err());
        assert!(project_key("A").is_err());
        assert!(project_key("1DEV").is_err());
        assert!(project_key("../secret").is_err());
        assert!(project_key("DEV/statuses").is_err());
        assert!(project_key("DEV%20").is_err());
    }

    #[test]
    fn ignored_projects_are_validated() {
        let map = |pairs: &[(&str, &[&str])]| -> BTreeMap<String, Vec<String>> {
            pairs
                .iter()
                .map(|(p, names)| (p.to_string(), names.iter().map(|s| s.to_string()).collect()))
                .collect()
        };
        let checked = ignored_statuses(map(&[
            ("DEV", &["Backlog"]),
            // Not a project key — a settings entry can't smuggle one in.
            ("../secret", &["Backlog"]),
            // Nothing left to ignore, so no term is worth generating.
            ("OPS", &[]),
            ("SUP", &["   "]),
        ]));

        assert_eq!(checked.keys().collect::<Vec<_>>(), vec!["DEV"]);
    }

    #[test]
    fn ignored_status_names_are_bounded() {
        let owned =
            |names: &[&str]| -> Vec<String> { names.iter().map(|s| s.to_string()).collect() };
        assert_eq!(
            status_names(owned(&["  Waiting  ", "", "   ", "Waiting"])),
            vec!["Waiting"],
        );
        // An over-long name is dropped, not truncated — a half-name would
        // silently filter on the wrong status.
        let long = "x".repeat(MAX_STATUS_NAME_CHARS + 1);
        assert!(status_names(vec![long]).is_empty());

        let many: Vec<String> = (0..MAX_IGNORED_STATUSES + 20)
            .map(|i| format!("Status {i}"))
            .collect();
        assert_eq!(status_names(many).len(), MAX_IGNORED_STATUSES);
    }

    #[test]
    fn site_normalization() {
        assert_eq!(
            site(" my.atlassian.net/ ").unwrap(),
            "https://my.atlassian.net"
        );
        assert_eq!(
            site("https://x.example.com").unwrap(),
            "https://x.example.com"
        );
        assert!(site("").is_err());
        assert!(site("https://").is_err());
    }

    #[test]
    fn site_must_be_encrypted_unless_loopback() {
        // The token travels as a Basic-auth header on every request.
        assert!(site("http://my.atlassian.net").is_err());
        assert!(site("http://evil.example/jira").is_err());
        assert!(site("ftp://my.atlassian.net").is_err());
        // Loopback never leaves the machine — kept usable for local doubles.
        assert_eq!(
            site("http://localhost:1234").unwrap(),
            "http://localhost:1234"
        );
        assert_eq!(
            site("http://127.0.0.1:1234/").unwrap(),
            "http://127.0.0.1:1234"
        );
        assert_eq!(site("http://[::1]:80").unwrap(), "http://[::1]:80");
        // A loopback-lookalike hostname is a remote host like any other.
        assert!(site("http://localhost.evil.example").is_err());
        assert!(site("http://127.0.0.1.evil.example").is_err());
    }

    #[test]
    fn stored_token_is_reused_only_for_the_same_connection() {
        let stored = Credentials {
            site: "https://my.atlassian.net".to_string(),
            email: "me@example.com".to_string(),
            token: "secret".to_string(),
        };
        assert!(may_reuse_token(
            &stored,
            "https://my.atlassian.net",
            "me@example.com"
        ));
        // Case differences address the same host and account.
        assert!(may_reuse_token(
            &stored,
            "https://MY.atlassian.net",
            "Me@Example.com"
        ));
        // Anything else would send the token somewhere it was never issued for.
        assert!(!may_reuse_token(
            &stored,
            "https://evil.example",
            "me@example.com"
        ));
        assert!(!may_reuse_token(
            &stored,
            "https://my.atlassian.net.evil.example",
            "me@example.com"
        ));
        assert!(!may_reuse_token(
            &stored,
            "https://my.atlassian.net",
            "someone@else.com"
        ));
    }

    #[test]
    fn ipc_input_checks() {
        assert!(issue_key("ABC-12").is_ok());
        assert!(issue_key("ABC-12/transitions").is_err());
        assert!(issue_key("../secret").is_err());
        assert!(jira_id("worklog", "10023").is_ok());
        assert!(jira_id("worklog", "10023?x=1").is_err());
        assert!(jira_id("worklog", "").is_err());
        assert!(date("2026-07-16").is_ok());
        assert!(date("2026-07-16\" OR project = X").is_err());
    }

    #[test]
    fn link_ids_are_validated() {
        // Reaches a URL path, like the attachment ids above.
        assert!(jira_id("link", "10042").is_ok());
        assert!(jira_id("link", "").is_err());
        assert!(jira_id("link", "10042/../issue/ABC-1").is_err());
        assert!(jira_id("link", "10042?expand=all").is_err());
        assert!(jira_id("link", "abc").is_err());
    }

    #[test]
    fn a_refused_id_says_which_kind_it_was() {
        assert_eq!(
            jira_id("worklog", "abc").unwrap_err(),
            "invalid worklog id 'abc'"
        );
    }

    #[test]
    fn a_field_list_the_settings_screen_left_debris_in_is_cleaned_up() {
        // Blanks and repeats are settings-screen debris, not something worth
        // refusing the whole issue view over.
        let names = vec![
            "Plant no.".to_string(),
            "   ".to_string(),
            "plant no.".to_string(),
            "Line".to_string(),
        ];

        let out = field_names(names).unwrap();

        assert_eq!(out, ["Plant no.", "Line"]);
    }

    #[test]
    fn a_field_name_keeps_the_case_it_was_given() {
        // Matched against the site's catalog, which is case-insensitive, but
        // the name is what the issue view labels the row with.
        let out = field_names(vec!["  Request Type  ".to_string()]).unwrap();

        assert_eq!(out, ["Request Type"]);
    }

    #[test]
    fn an_absurdly_long_field_name_is_dropped_rather_than_refused() {
        let long = "x".repeat(MAX_FIELD_NAME_CHARS + 1);

        let out = field_names(vec![long, "Line".to_string()]).unwrap();

        assert_eq!(out, ["Line"]);
    }

    #[test]
    fn too_many_fields_is_refused_outright() {
        // A very long list makes for a very wide issue request, and unlike one
        // bad entry there is no sensible half of it to keep.
        let many: Vec<String> = (0..=MAX_DETAIL_FIELDS).map(|n| format!("f{n}")).collect();

        assert!(field_names(many).is_err());
    }

    #[test]
    fn exactly_the_field_limit_is_allowed() {
        let at_limit: Vec<String> = (0..MAX_DETAIL_FIELDS).map(|n| format!("f{n}")).collect();

        assert_eq!(field_names(at_limit).unwrap().len(), MAX_DETAIL_FIELDS);
    }
}

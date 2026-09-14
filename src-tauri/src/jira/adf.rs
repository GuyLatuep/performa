//! Atlassian Document Format, in both directions.
//!
//! Jira's v3 API takes and returns rich-text bodies as ADF; the app deals in
//! plain text with a list of picked mentions. This module is the whole of that
//! translation — text in ([`adf_paragraph`], [`adf_doc`]) and text out
//! ([`adf_to_text`]) — so no caller has to know the node shapes.

use super::types::MentionRef;

/// Wrap plain text in a minimal Atlassian Document Format doc (required by v3).
pub(super) fn adf_paragraph(text: &str) -> serde_json::Value {
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
pub(super) fn adf_doc(text: &str, mentions: &[MentionRef]) -> serde_json::Value {
    // Ordered once for the whole document rather than per line: the mention
    // list does not change between paragraphs. Longest name first — see
    // [`adf_inline`] for why that ordering is what makes the match correct.
    let mut by_length: Vec<&MentionRef> = mentions.iter().filter(|m| !m.name.is_empty()).collect();
    by_length.sort_by_key(|m| std::cmp::Reverse(m.name.len()));

    let paragraphs: Vec<serde_json::Value> = text
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.is_empty())
        .map(|line| {
            serde_json::json!({
                "type": "paragraph",
                "content": adf_inline(line, &by_length)
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
/// `by_length` arrives sorted longest name first, so "@Anna Leeson" is not
/// read as "@Anna" followed by the word "Leeson" — [`adf_doc`] does that once
/// for the whole document. Two people sharing a display name are
/// indistinguishable here by construction — the first match wins, which is the
/// only thing plain text can support.
fn adf_inline(line: &str, by_length: &[&MentionRef]) -> Vec<serde_json::Value> {
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
pub(super) fn adf_to_text(value: &serde_json::Value) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

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

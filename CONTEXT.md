# Context

Domain glossary for performa. Terms only — no implementation detail, no specs,
no decisions. If a word in the UI or the code means something specific here,
it belongs in this file.

## Mention

A comment **written by another Jira user** in which they @-tag you.

A Mention means *somebody wants something from you*. It is a notification: the
expected response is to go and look at it. It is explicitly not a signal that
you owe time on the issue.

Deliberately outside the term:

- **Your own comments.** Tagging yourself is not somebody wanting something
  from you.
- **Tags outside comments.** Being named in an issue description or a worklog
  comment is not a Mention.

A Mention stays interesting for a bounded period after it was written; older
ones drop out of view.

## Missing worklog

A stretch of past work that appears to have happened without being logged.

A Missing worklog means *you probably forgot to log something*. The expected
response is to log the time.

Mentions and Missing worklogs are near-twins in shape — both are found by
polling Jira in the background, both surface in their own tab with an unread
badge — but they are **not two kinds of one thing**. One is an incoming
request to look at; the other is a reminder about your own past. Keeping them
apart is intentional; do not merge them behind a shared concept.

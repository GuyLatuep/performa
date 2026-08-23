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

## Comment

Something a person wrote on an issue. Distinct from a **Mention**, which is
the narrower thing: a Comment by somebody else that @-tags you.

On a service-desk issue a Comment is one of two kinds, and which one it is
decides who can read it:

### Internal note

A Comment only people working the issue can read. The customer who raised the
request never sees it.

### Customer reply

A Comment written *to* the customer, visible to them.

The distinction only exists on service-desk issues. Everywhere else a Comment
is simply as visible as the issue it sits on, and calling such a comment
"internal" or "a reply" would claim a privacy property that isn't there.

## Status change

The issue moving from one status to another. It records that the move
happened, and who made it.

## Transition

A move the workflow currently permits from the issue's status, offered by
name. A Transition is not "setting the status field": which ones exist depends
on the status the issue is in right now, and a status with no Transition
leading to it cannot be reached, however much it may exist elsewhere in the
workflow.

Some Transitions ask for information before they will run — a resolution, an
assignee, a comment. Those are the Transition's own fields, not the issue's.

## Timeline

Comments, Status changes and Worklogs on one issue, shown together in time
order.

They are shown together because a person reading an issue wants its story in
one place. They are **not three kinds of one thing**: a Comment is somebody
talking, a Status change is the workflow moving, a Worklog is time being
recorded. Each answers a different question and each carries different
information. As with Mentions and Missing worklogs, keeping them apart is
intentional — the Timeline is a way of displaying the three, not a concept
that replaces them.

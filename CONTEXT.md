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

## Draft worklog

Time **you put down** as owed to Jira but not booked yet: a duration, when it
happened, a note on what it was, and — once known — the issue it belongs on.

A Draft worklog means *you know you worked, and have not booked it*. Usually
the ticket did not exist yet, or there was no moment to fill in a form. The
expected response is to book it, possibly in parts, possibly on several
issues.

A Draft worklog is **not** a Missing worklog, though both wait in the same
place. A Missing worklog is *found* — the app guesses at it from activity in
Jira, and it disappears when the guess no longer holds. A Draft worklog is
*made* — you stated it, so it only ever goes when you book all of it or throw
it away. Showing them side by side is about where unbooked time waits, not a
claim that they are one thing.

## Idle time

A stretch with **no input at the computer** — keyboard, mouse, trackpad, or the
machine asleep — while a timer was counting.

Idle time is a question, not a verdict: being away from the keyboard is not
the same as not working, so the user decides whether it was work. It only
exists while a timer runs; time away with no timer running is nobody's
business.

## Daily target

What a day is **expected to hold**. It starts from the hours set for that
weekday — a part-time Friday is a shorter Friday, not a lower average — and
is lowered by a Holiday or an Absence on that day.

A day short of its target is behind; a day whose target is zero is not
expected to hold anything, and is never "behind", whatever it holds.

## Holiday

A legal public holiday of the user's German state. Nobody enters one — it is
the law's, the same for everyone in the state — and it sets the day's Daily
target to zero.

Only statewide holidays count. One that only some towns keep is, as far as
the app is concerned, an Absence the user marks.

## Absence

A day off the user **marks themselves** — vacation, sickness, anything else —
for a whole day or half of one. It takes its share off that day's Daily
target.

An Absence is **not** a Holiday: a Holiday is the state's and applies to
everyone, an Absence is the user's own record. Both lower the target; neither
makes the day "behind".

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

## Linked work item

Another issue this one stands in a named relationship to, seen from *this*
issue: "blocks TASK-4", "is caused by BUG-9".

The relationship is the term's substance, not the other issue. Jira keeps one
record and it reads two ways round — "A blocks B" and "B is blocked by A" are
the same link — so a Linked work item is only ever meaningful together with
the issue it is being read from. Dropping the direction and calling the pair
"related issues" loses the only thing the link says.

Which relationships exist is a property of the Jira site, like field names.

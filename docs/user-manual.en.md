# performa — User Manual

English · [Deutsch](user-manual.de.md)

performa is a small desktop app (macOS + Windows) for logging your work hours on Jira Cloud issues — with a timer, a weekly timesheet, reminders for forgotten worklogs, and a dashboard.

## Contents

- [What is performa?](#what-is-performa)
- [Getting started](#getting-started)
- [The interface at a glance](#the-interface-at-a-glance)
- [Start tab (dashboard)](#start-tab-dashboard)
- [Logging work](#logging-work)
- [The timer](#the-timer)
- [System tray / menu bar](#system-tray--menu-bar)
- [Timesheet](#timesheet)
- [Missing worklogs](#missing-worklogs)
- [Templates](#templates)
- [Settings](#settings)
- [Close protection](#close-protection)
- [Updates](#updates)
- [Data & privacy](#data--privacy)
- [Troubleshooting & FAQ](#troubleshooting--faq)

## What is performa?

performa talks directly to your Jira Cloud site and writes **native Jira worklogs**. Because the entries land in Jira itself, they automatically appear in every tool that reflects Jira worklogs — including **ActivityTimeline**.

Two design principles worth knowing:

- **Your API token never touches the web layer.** All Jira communication happens in the app's native (Rust) core; the token is stored in the operating system's credential store (macOS Keychain / Windows Credential Manager), not in a config file.
- **Billable by default.** A worklog marked *non-billable* is stored with a leading `~` in its Jira comment — the ActivityTimeline convention — so the categorization survives round trips through Jira.

## Getting started

### Installation

Download the latest release from the project's GitHub Releases page:

- **macOS**: `.dmg` (Apple Silicon)
- **Windows**: `.exe` installer

### Connecting to Jira

On first launch performa shows the connect screen. You need three things:

| Field | What to enter |
| --- | --- |
| **Jira site** | Your Jira Cloud host, e.g. `your-team.atlassian.net` (with or without `https://`) |
| **Email** | The email address of your Atlassian account |
| **API token** | A personal Atlassian API token |

Click **Create an API token ↗** on the connect screen (or go to [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)), create a token, and paste it into the field.

When you press **Connect**, performa verifies the credentials against Jira before saving them — a typo in the site or token produces an error message instead of a broken setup. On success the token is written to the OS keychain and the main window opens.

> If the app ever fails to read the keychain at startup, it shows the error with a **Retry** button instead of getting stuck on "Loading…".

## The interface at a glance

The main window consists of:

- **Header** — the performa mark, your account email, a **Settings** link, and **Sign out** (asks for confirmation; signing out removes the token from the keychain).
- **Update banner** — appears only when a newer release exists ([Updates](#updates)).
- **Timer bar** — appears only while a timer is running ([The timer](#the-timer)).
- **Four tabs**: **Start**, **Log work**, **Timesheet**, **Missing worklog**. The app opens on **Start**.

## Start tab (dashboard)

The Start tab is the landing page and shows four sections. Sections with nothing to show are hidden.

### Due dates

Issues **assigned to you** whose due date lies between **7 days ago and 14 days ahead**, soonest first. Issues already in a *Done* status category are excluded — an overdue issue only shows up here while it is still open.

Each issue carries a due badge:

- **overdue** (red outline) — the due date has passed
- **today** (highlighted) — due today
- **due …** (neutral) — upcoming, with the weekday and date

The rows are full-featured issue rows:

- **☆ / ★** pins the issue to the top of the Log work list ([Logging work](#logging-work))
- Clicking the **issue key** opens the issue in your browser
- Clicking the **summary** jumps to the Log work tab with the log form already open for that issue
- **▶ start** starts a timer for the issue

### This week

The same charts as the Timesheet's current week: per-day bars against your daily target and a progress ring against the weekly target, plus the total logged so far. It refreshes automatically whenever you log work.

### Templates

Your saved worklog templates as one-click chips — see [Templates](#templates). Hidden while you have none.

### Missing worklogs

A preview of the current findings of the missing-worklog watcher. Clicking an item (or **Open tab**) jumps to the Missing worklog tab. Hidden when nothing is missing.

## Logging work

The **Log work** tab is a two-step flow: find an issue, then fill in the worklog.

### Finding an issue

The search field interprets your input in three ways:

| Input | Behavior |
| --- | --- |
| *(empty)* | Your open issues (assigned to you, not Done), most recently updated first |
| An issue key such as `ABC-123` | Exact lookup of that issue |
| Any other text | Full-text search across issue summaries and content |

Search results update as you type (with a short debounce). The query itself is translated to JQL inside the app's native core — you never have to write JQL.

**Pinned issues** (★) always appear at the top of the default list, separated by a heavier divider. Pin or unpin any issue with the star on its row; pins are stored locally on your machine. During an active text search the plain results are shown instead.

Each result row offers the same actions as on the dashboard: open in browser (key), select (summary), pin (star), and start a timer (▶).

### The worklog form

After selecting an issue, fill in:

- **Time spent** — Jira-style duration syntax:

  | Input | Meaning |
  | --- | --- |
  | `1h 30m` | 1 hour 30 minutes |
  | `45m` | 45 minutes |
  | `2h` | 2 hours |
  | `1d` | 1 working day = 8 hours |
  | `1w` | 1 working week = 5 days |
  | `1.5h` or `0,25h` | Decimals with dot or comma |
  | `2` | A bare number counts as hours |

  A live hint below the field shows how the input was understood (e.g. `= 1h 30m`).

- **Date** — defaults to today; future dates are not allowed.
- **Start time** — defaults to the current time.
- **Comment** *(optional)* — stored as the Jira worklog comment.
- **Non-billable** — marks the entry non-billable (stored as a leading `~` in the Jira comment; see [What is performa?](#what-is-performa)). The checkbox resets for every newly selected issue so billability never leaks from a previous entry.

Press **Log work** to save. A success message confirms the entry, and the form clears for the next one.

### My logged time

Below the form, the issue's history shows **your** previous worklogs on that issue (the 10 most recent, plus your total). This updates immediately after logging.

## The timer

Start a timer with the **▶ start** button on any issue row (Start tab or Log work tab). Only one timer can run at a time — other start buttons are disabled while one is active.

While running:

- The **timer bar** above the tabs shows the issue and a live clock.
- The [system tray](#system-tray--menu-bar) mirrors the timer.

Press **Stop** (in the timer bar or the tray) to finish. The log modal opens with:

- **Time spent** prefilled with the elapsed time, **rounded up to the next 15 minutes** (minimum 15 minutes) — you can edit it freely before saving.
- **Date and start time** prefilled from when the timer was started.

You can complete the worklog (comment, billability) and save, or **Discard** the tracked time — discarding asks for confirmation, because the time would be lost.

> The timer is based on wall-clock time and survives app restarts: if you quit with a timer running (see [Close protection](#close-protection)) and reopen the app later, the timer resumes with the correct total elapsed time.

## System tray / menu bar

performa adds an icon to the macOS menu bar / Windows system tray:

- **macOS**: while a timer runs, a live readout appears next to the icon — `▶ ABC-123 12:34` (hours:minutes:seconds past an hour).
- **Windows**: tray icons cannot show text, so the same readout appears as the icon's **hover tooltip** instead. Everything else works identically.

The tray menu offers:

- **Stop timer…** *(enabled only while a timer runs)* — brings the window to the front and opens the regular log modal
- **Open performa** — shows and focuses the window
- **Quit performa** — quits the app; this goes through the normal close path, so [close protection](#close-protection) still applies

## Timesheet

The **Timesheet** tab shows one week at a time.

- Navigate with **← / →**; the current week is the rightmost you can go (no future weeks). Labels show "This week", "Last week", or the date range.
- **Charts**: per-day bars measured against your daily target (a line marks the target), and a ring showing the week's progress against the weekly target (daily hours × 5 workdays). Saturday/Sunday are hidden by default but appear automatically when they contain logged time — or always, if you switch the [setting](#settings) to full week.
- Below, worklogs are grouped by day (newest day first) with per-day totals. Each row shows the issue key (click → browser), summary, comment, start time, duration, and a `non-billable` tag where applicable.

Row actions:

- **↻ Log again today** — opens a prefilled form (same issue, duration, comment, billability) with **today's date and the current time**: ideal for recurring entries. The modal also offers **Save as template** ([Templates](#templates)).
- **✎ Edit** — change any field of the existing worklog (duration, date, time, comment, billability).
- **🗑 Delete** — removes the worklog after a second, inline confirmation (✓ / ✕).

## Missing worklogs

The **Missing worklog** tab is a safety net for forgotten time entries.

**What it flags:** issues where **you** commented or changed the status within the **last 24 hours**, but have **no worklog within about 3 hours** of that activity. Activity from the last 10 minutes is not flagged yet (grace period — you may simply not have logged it *yet*). The check runs automatically **every 2 minutes** while you are signed in; **Check now** triggers it manually, and the tab shows when it last ran.

Each finding shows:

- the issue and what you did — a quoted comment excerpt, or the status change (`Old → New`), with how long ago
- a count badge on the tab; the tab **blinks until you view it** (viewing the tab acknowledges the current findings)
- a **desktop notification**, fired **once per finding** ([see FAQ](#troubleshooting--faq) if you don't see notifications)

Clicking a finding opens an inline log form, prefilled with the **date and time of the flagged activity**, so the resulting worklog covers it and the reminder clears on the next check.

> **Escalation issues:** for issues in the `DEV` project, the time is logged on the **linked escalation-source issue** instead (the issue linked as "is an escalation for"). The form shows both issues so it's always clear where the time goes.

## Templates

Templates make recurring entries (daily standup, support duty, …) a one-click affair.

- **Create:** in the Timesheet, press **↻** on any worklog and tick **Save as template on the start tab** before logging. The template stores the issue, duration, comment, and billability.
- **Use:** on the Start tab, click a template chip. The log form opens prefilled — with today's date and the current time — and one confirmation logs it.
- **Remove:** the **✕** on each chip deletes the template.

Templates are stored locally on your machine, not in Jira.

## Settings

The **Settings** link in the header opens the same screen used for the first-run connection:

- **Appearance** — light / dark theme toggle.
- **Daily work hours** — 0.5–24 h; this drives the daily target line and, × 5, the weekly target ring in the charts.
- **Timesheet days** — **Mon–Fri** (weekends hidden unless they contain logged time) or **Full week**.
- **Credentials** — change site, email, or token. Leaving the token field blank keeps the stored token, so you don't need to re-enter it to fix a typo in the email. Saving re-verifies against Jira.

Appearance, hours, and the weekend toggle apply **instantly** as a live preview — pressing **Cancel** restores the values from when you opened the screen.

**Sign out** (in the header, with confirmation) deletes the token from the OS keychain and returns to the connect screen.

## Close protection

Quitting with unfinished business triggers a warning instead of silently losing data:

- **Timer still running** — shows the issue and elapsed time; stop the timer to log it first, or **Quit anyway** to discard the tracked time.
- **Unlogged work pending** — findings are waiting in the Missing worklog tab; go back and log them, or **Quit anyway**.

This applies to the window's close button and to **Quit performa** in the tray menu alike.

## Updates

performa checks GitHub for a newer release **once per hour**. When one exists, a banner appears with:

- **Update & restart** — downloads the update with a progress display, installs it, and relaunches the app
- **Release notes** — opens the release page in your browser
- **✕** — dismisses the banner **for this version**; the next release brings it back

## Data & privacy

| Data | Where it lives |
| --- | --- |
| API token | OS keychain (macOS Keychain / Windows Credential Manager) |
| Site & email | With the token in the keychain entry |
| Worklogs | In Jira — performa stores no copy |
| Pins, templates, settings (theme, hours, weekends) | Locally in the app's storage |
| Timer state, seen/notified markers, dismissed update version | Locally in the app's storage |

performa communicates **only** with your Jira Cloud site (all worklog operations) and GitHub (update check). There is no telemetry.

## Troubleshooting & FAQ

**"Jira returned 401/403" when connecting or logging.**
The token, email, or site is wrong, or the token was revoked. Create a fresh API token and re-enter it in Settings (site/email corrections don't require re-entering a valid token).

**I don't get desktop notifications.**
The first notification triggers the operating system's permission prompt — if it was declined, allow notifications for performa in the OS settings (macOS: System Settings → Notifications). Note that unsigned development builds may appear under a different app identity than the packaged app.

**Where is the tray clock on Windows?**
Windows tray icons can't display text next to the icon (a platform limitation). Hover the performa tray icon to see the running timer in the tooltip; all tray menu actions work normally.

**Do my worklogs show up in ActivityTimeline?**
Yes. performa writes native Jira worklogs, which ActivityTimeline reflects automatically. The non-billable marker (`~` prefix in the comment) follows ActivityTimeline's own convention.

**The app shows "Could not read stored credentials".**
The OS keychain could not be read (e.g. it was locked). Unlock/log in to your OS keychain and press **Retry**.

**Can I log time in the future?**
No — the date field is capped at today.

**Can two timers run at once?**
No. Stop the running timer first; all other start buttons are disabled meanwhile.

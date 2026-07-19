# performa

A small cross-platform desktop app (macOS + Windows) for logging your Jira Cloud
work hours. Built with [Tauri v2](https://tauri.app) — a Rust core plus a React
+ TypeScript frontend — so bundles are small (~5–10 MB) and the API token never
touches the web layer.

Worklogs are written via the **native Jira Cloud worklog API**, so they show up
in **ActivityTimeline** automatically (ActivityTimeline reflects Jira worklogs).

## Features

- Connect to a Jira Cloud site with your email + API token (stored in the OS
  keychain — macOS Keychain / Windows Credential Manager).
- **Start dashboard** with your due issues (last 7 / next 14 days), this
  week's progress charts, worklog templates, and pending reminders.
- Search issues (assigned to you by default, or by text / issue key), pin
  favorites to the top.
- Log work with a Jira-style duration (`1h 30m`), date, optional comment, and
  a non-billable flag (ActivityTimeline's `~` convention).
- **Timer** per issue with 15-minute round-up, mirrored live in the **system
  tray / menu bar** (stop and log straight from the tray).
- Weekly **timesheet** view with per-day totals and target charts; edit,
  delete, and repeat worklogs (or save them as templates).
- **Missing-worklog watcher**: flags your recent Jira comments / status
  changes without logged time nearby and raises a desktop notification.
- Auto-update via GitHub releases (hourly check).

## Documentation

- **User manual**: [English](docs/user-manual.en.md) ·
  [Deutsch](docs/user-manual.de.md) — all workflows and features in detail.

## Architecture

- **Rust backend (`src-tauri/`)** performs all Jira HTTP via `reqwest`. This
  keeps the API token out of the webview and avoids browser CORS restrictions.
  - `creds.rs` — keychain-backed credential storage (`keyring` crate).
  - `jira.rs` — typed async client over Jira REST API v3.
  - `lib.rs` — `#[tauri::command]` handlers the frontend invokes.
- **React frontend (`src/`)** calls those commands through `src/api.ts`.

Jira endpoints used: `GET /myself`, `GET /search/jql` (the current search
endpoint — the old `/search` was removed), and
`POST|PUT|DELETE /issue/{key}/worklog`.

## Prerequisites

- [Node.js](https://nodejs.org) 20+ and [pnpm](https://pnpm.io)
- [Rust](https://rustup.rs) (stable)
- Platform build tools: Xcode CLT on macOS; the Tauri prerequisites on Windows.

## Develop

```bash
pnpm install
pnpm tauri dev
```

## Build a distributable

```bash
pnpm tauri build
```

Artifacts land in `src-tauri/target/release/bundle/` (`.dmg`/`.app` on macOS,
`.msi`/`.exe` on Windows). You can only build a given OS's bundle on that OS —
use the included GitHub Actions workflow to build both.

## Release (CI)

`.github/workflows/release.yml` builds macOS (Apple Silicon) and Windows (NSIS
installer) bundles and attaches them to a draft GitHub Release, including the
updater artifacts. Trigger it by pushing a tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

### Code signing (optional, recommended for distribution)

Unsigned builds run locally but show OS security warnings on other machines. To
sign, uncomment and set the secrets in the workflow:

- **macOS**: Apple Developer cert + notarization (`APPLE_*` secrets).
- **Windows**: a code-signing certificate.

## Getting an API token

Create one at
<https://id.atlassian.com/manage-profile/security/api-tokens>, then paste it
into the app's connect screen along with your Jira site and email.

## Possible next steps

- Optional **read-only ActivityTimeline integration** (via an admin AT API
  token) to pre-fill planned assignments.

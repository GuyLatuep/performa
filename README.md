<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="performa" width="112" height="112">

# performa

**Log your Jira Cloud hours — and work your issues — from a tiny native desktop app.**

Cross-platform (macOS · Windows) · built with Tauri v2 · your API token never touches the web layer.

[![CI](https://github.com/GuyLatuep/performa/actions/workflows/ci.yml/badge.svg)](https://github.com/GuyLatuep/performa/actions/workflows/ci.yml)
[![Release](https://github.com/GuyLatuep/performa/actions/workflows/release.yml/badge.svg)](https://github.com/GuyLatuep/performa/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/GuyLatuep/performa?sort=semver)](https://github.com/GuyLatuep/performa/releases)
[![codecov](https://codecov.io/gh/GuyLatuep/performa/branch/main/graph/badge.svg)](https://codecov.io/gh/GuyLatuep/performa)

[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)](https://rustup.rs)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

[Features](#-features) · [Documentation](#-documentation) · [Getting started](#-getting-started) · [Architecture](#-architecture) · [Releases](#-release-ci)

</div>

---

Worklogs are written through the **native Jira Cloud worklog API**, so they show
up in **ActivityTimeline** automatically (ActivityTimeline reflects Jira
worklogs). The Rust core keeps your credentials in the OS keychain and does all
HTTP itself — no tokens in the webview, no CORS workarounds. Bundles land at
roughly **5–10 MB**.

## ✨ Features

| | |
| --- | --- |
| 🔐 **Secure connect** | Jira Cloud site + email + API token, stored in the OS keychain (macOS Keychain / Windows Credential Manager). |
| 🏠 **Start dashboard** | Due issues (last 7 / next 14 days), this week's progress charts, worklog templates, and pending reminders. |
| ✅ **Todo tab** | Everything waiting on you, most urgent first, as a sortable table — with the statuses that mean "somebody else's turn" filtered out per project. |
| 📄 **Issue view** | Read and work an issue without leaving the app: double-click a field to change it, move it through the workflow, comment (with `@` mentions), attach and remove files, link work items, and read one timeline of comments, status changes and worklogs. The field grid is yours to arrange. |
| 🔎 **Issue picker** | Finding the issue to log against: assigned to you by default, or by text / issue key — pin favourites to the top. |
| 🗂️ **Command palette** | ⌘P for everything the app can do, by name — open an issue by typing its key, search Jira by text, or run a search of your own written as JQL with a `%SEARCHTERM%` placeholder for what you type (Settings → Searches). |
| ⏱️ **Log work** | Jira-style durations (`1h 30m`), date, optional comment, and a non-billable flag (ActivityTimeline's `~` convention). |
| 🍱 **Tray timer** | Per-issue timer with 15-minute round-up, mirrored live in the system tray / menu bar — stop and log straight from there. Starting a timer also nudges the issue to Jira's "In Arbeit" status, best-effort. |
| 📅 **Timesheet** | **Week** — per-day totals and target charts; edit, delete, and repeat worklogs, or save them as templates. **Month** — the whole month as a matrix, day by day. |
| 🔔 **Missing-worklog watcher** | Flags recent Jira comments / status changes without logged time nearby and raises a desktop notification. |
| 💬 **Mentions** | Comments that name you, in one list, with the issue one click away. |
| ⌨️ **Keyboard-first** | Nearly every action on a ⌘/Ctrl chord, arrow-key navigation through every list — hold ⌘ and each one names its key on the button itself, so there is nothing to memorise. Going back also answers to your mouse's back button and a two-finger swipe. |
| 🎨 **Appearance** | Light / dark, an accent colour, text size, and whether issue rows carry Jira's type icons. Plus a fun mode, for the odd milestone worth a toast. |
| 🛟 **Close protection** | Quitting with a timer running or unlogged work pending asks first, after a last silent re-check against Jira. |
| 🚀 **Auto-update** | Hourly check against GitHub releases. |
| 🪵 **Debug log** | Rotating file (Python-`logging`-style lines, 3 most recent sessions kept), Settings-configurable level, one-click "open log folder". |

## 📖 Documentation

**User manual** — every workflow and feature in detail:
[🇬🇧 English](docs/user-manual.en.md) · [🇩🇪 Deutsch](docs/user-manual.de.md)

## 🚀 Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 20+ and [pnpm](https://pnpm.io)
- [Rust](https://rustup.rs) (stable)
- Platform build tools: Xcode CLT on macOS, the [Tauri prerequisites](https://tauri.app/start/prerequisites/) on Windows

### Develop

```bash
pnpm install
pnpm tauri dev
```

### Build a distributable

```bash
pnpm tauri build
```

Artifacts land in `src-tauri/target/release/bundle/` (`.dmg`/`.app` on macOS,
`.msi`/`.exe` on Windows). You can only build a given OS's bundle on that OS —
use the included GitHub Actions workflow to build both.

### Getting an API token

Create one at
[id.atlassian.com → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens),
then paste it into the app's connect screen along with your Jira site and email.

### Handy scripts

| Command | What it does |
| --- | --- |
| `pnpm tauri dev` | Run the app with hot reload |
| `pnpm rebuild` | Build the bundle and launch it — the usual way to try a change for real |
| `pnpm rebuild:only` | The same build, without launching |
| `pnpm test` | Run the Vitest suite |
| `pnpm test:coverage` | Vitest with a coverage report in `coverage/` |
| `pnpm lint` | ESLint, zero warnings tolerated |
| `pnpm format` / `pnpm format:check` | Prettier over the repo, writing or checking |
| `pnpm tauri build` | Build the platform bundle |

The Rust side has its own: `cargo test`, `cargo clippy --all-targets -- -D warnings`
and `cargo fmt --check`, from `src-tauri/`. CI runs all of them.

## 🏗️ Architecture

```
performa/
├── src-tauri/        Rust core — all Jira HTTP, credentials, logging
│   ├── jira/           typed async client over Jira REST API v3
│   │   ├── mod.rs        the client
│   │   ├── jql.rs        JQL construction and escaping, saved-search templates
│   │   ├── issue.rs      one issue: fields, edits, transitions
│   │   ├── links.rs      issue links · attachments.rs  files
│   │   ├── mentions.rs   comments naming you · missing.rs  the watcher
│   │   └── types.rs      the wire shapes
│   ├── creds.rs        keychain-backed credential storage (keyring crate)
│   ├── tray.rs         tray / menu-bar icon and its live timer
│   ├── gestures.rs     macOS two-finger swipe → navigate back / forward
│   ├── cleanup.rs      startup housekeeping after an in-app update
│   ├── logging.rs      rotating debug-log file
│   └── lib.rs          #[tauri::command] handlers the frontend invokes
└── src/              React + TypeScript frontend
    ├── api.ts          the single bridge into the Rust commands
    ├── components/     the screens
    └── *.ts            module-level stores (back, shortcuts, selection,
                        savedSearches, settings, …), each a tiny
                        `useSyncExternalStore` over one concern
```

The Rust backend performs all Jira HTTP via `reqwest`. This keeps the API token
out of the webview and avoids browser CORS restrictions.

<details>
<summary><strong>Jira endpoints used</strong></summary>

All under `/rest/api/3`.

- `GET /myself` · `GET /field` · `GET /user/search`
- `GET /search/jql` — the current search endpoint; the old `/search` was removed
- `GET /project/search` · `GET /project/{key}/statuses`
- `GET | PUT /issue/{key}` · `GET /issue/{key}/editmeta`
- `GET | POST /issue/{key}/transitions` · `GET /issue/{key}/changelog`
- `GET | POST /issue/{key}/comment`
- `POST | PUT | DELETE /issue/{key}/worklog`
- `POST /issue/{key}/attachments` · `GET | DELETE /attachment/{id}` · `GET /attachment/content/{id}`
- `GET /issueLinkType` · `POST /issueLink` · `DELETE /issueLink/{id}`

</details>

## 📦 Release (CI)

`.github/workflows/release.yml` builds macOS (Apple Silicon) and Windows (NSIS
installer) bundles and attaches them to a draft GitHub Release, including the
updater artifacts. Trigger it by pushing a tag:

```bash
git tag v0.4.1 && git push origin v0.4.1
```


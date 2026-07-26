<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="performa" width="112" height="112">

# performa

**Log your Jira Cloud work hours from a tiny native desktop app.**

Cross-platform (macOS · Windows) · built with Tauri v2 · your API token never touches the web layer.

[![CI](https://github.com/GuyLatuep/performa/actions/workflows/ci.yml/badge.svg)](https://github.com/GuyLatuep/performa/actions/workflows/ci.yml)
[![Release](https://github.com/GuyLatuep/performa/actions/workflows/release.yml/badge.svg)](https://github.com/GuyLatuep/performa/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/GuyLatuep/performa?sort=semver)](https://github.com/GuyLatuep/performa/releases)

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
| 🔎 **Issue search** | Assigned to you by default, or by text / issue key — pin favorites to the top. |
| ⏱️ **Log work** | Jira-style durations (`1h 30m`), date, optional comment, and a non-billable flag (ActivityTimeline's `~` convention). |
| 🍱 **Tray timer** | Per-issue timer with 15-minute round-up, mirrored live in the system tray / menu bar — stop and log straight from there. Starting a timer also nudges the issue to Jira's "In Arbeit" status, best-effort. |
| 📅 **Weekly timesheet** | Per-day totals and target charts; edit, delete, and repeat worklogs, or save them as templates. |
| 🔔 **Missing-worklog watcher** | Flags recent Jira comments / status changes without logged time nearby and raises a desktop notification. |
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
| `pnpm test` | Run the Vitest suite |
| `pnpm lint` | ESLint, zero warnings tolerated |
| `pnpm format` | Prettier over the repo |
| `pnpm tauri build` | Build the platform bundle |

## 🏗️ Architecture

```
performa/
├── src-tauri/        Rust core — all Jira HTTP, credentials, logging
│   ├── creds.rs        keychain-backed credential storage (keyring crate)
│   ├── jira.rs         typed async client over Jira REST API v3
│   ├── logging.rs      rotating debug-log file
│   └── lib.rs          #[tauri::command] handlers the frontend invokes
└── src/              React + TypeScript frontend
    └── api.ts          the single bridge into the Rust commands
```

The Rust backend performs all Jira HTTP via `reqwest`. This keeps the API token
out of the webview and avoids browser CORS restrictions.

<details>
<summary><strong>Jira endpoints used</strong></summary>

- `GET /myself`
- `GET /search/jql` — the current search endpoint; the old `/search` was removed
- `POST | PUT | DELETE /issue/{key}/worklog`

</details>

## 📦 Release (CI)

`.github/workflows/release.yml` builds macOS (Apple Silicon) and Windows (NSIS
installer) bundles and attaches them to a draft GitHub Release, including the
updater artifacts. Trigger it by pushing a tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

<details>
<summary><strong>Code signing (optional, recommended for distribution)</strong></summary>

Unsigned builds run locally but show OS security warnings on other machines. To
sign, uncomment and set the secrets in the workflow:

- **macOS** — Apple Developer cert + notarization (`APPLE_*` secrets)
- **Windows** — a code-signing certificate

</details>

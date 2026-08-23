#!/usr/bin/env bash
#
# Rebuild the debug app bundle and launch it, replacing any running copy.
#
# macOS only: it builds a .app and hands it to `open`. The debug profile is
# deliberate — it compiles far faster than release and keeps devtools available,
# which is what you want when testing against a real Jira.
#
#   scripts/rebuild.sh              rebuild and launch
#   scripts/rebuild.sh --no-launch  rebuild only
#
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

APP="src-tauri/target/debug/bundle/macos/performa.app"
BIN="$APP/Contents/MacOS/performa"
LOG="${TMPDIR:-/tmp}/performa-rebuild.log"

launch=1
case "${1:-}" in
    --no-launch) launch=0 ;;
    "") ;;
    *)
        echo "usage: $(basename "$0") [--no-launch]" >&2
        exit 2
        ;;
esac

# A running copy holds the binary open, and you would otherwise be looking at
# the old build wondering why nothing changed. Not an error when none is up.
pkill -f "$BIN" 2>/dev/null && echo "stopped the running app"

echo "building…"
# Kept in full in a log rather than piped straight to grep: a compile error
# prints nothing a filter would match, and swallowing it leaves you staring at
# a missing bundle with no reason given.
pnpm tauri build --debug --bundles app >"$LOG" 2>&1
status=$?

grep -E "Built application|Bundling performa\.app" "$LOG"

# `tauri build` exits non-zero here even when the bundle is fine: the config
# sets createUpdaterArtifacts, and signing those needs TAURI_SIGNING_PRIVATE_KEY,
# which only the release workflow has. That failure comes *after* the .app is
# written, so what matters is whether the bundle exists — not the exit code.
if [[ ! -d "$APP" ]]; then
    echo "build failed — no bundle at $APP" >&2
    echo "--- last 40 lines of $LOG ---" >&2
    tail -40 "$LOG" >&2
    exit 1
fi

if [[ $status -ne 0 ]] && ! grep -q "TAURI_SIGNING_PRIVATE_KEY" "$LOG"; then
    # Some other failure, and the bundle on disk is from an earlier run.
    echo "build reported an error unrelated to updater signing:" >&2
    tail -40 "$LOG" >&2
    exit 1
fi

if [[ $launch -eq 1 ]]; then
    open "$APP" && echo "launched"
else
    echo "built: $APP"
fi

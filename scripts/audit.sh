#!/usr/bin/env bash
# The dependency audit CI runs (the `audit` job in .github/workflows/ci.yml),
# locally: high and critical npm advisories, and RustSec vulnerabilities.
# Runs both so one red result doesn't hide the other.
#
# Called by the pre-push hook in .githooks; `pnpm run audit` runs it by hand.
# Advisories land against untouched lockfiles, so a push can fail here
# without any dependency having changed — bump the named crate or package.
set -uo pipefail
cd "$(dirname "$0")/.."

status=0

echo "▸ npm packages"
pnpm audit --audit-level=high || status=1

echo "▸ Rust crates"
if command -v cargo-audit >/dev/null 2>&1; then
  (cd src-tauri && cargo audit) || status=1
else
  # Fail rather than skip: a check that quietly does nothing is how CI ends up
  # being the first to notice.
  echo "cargo-audit is not installed: brew install cargo-audit" >&2
  status=1
fi

if [ "$status" -ne 0 ]; then
  echo >&2
  echo "Audit failed. Fix the advisories above, or push anyway with --no-verify." >&2
fi
exit "$status"

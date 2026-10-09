#!/bin/bash
# Launched by launchd. Wraps find-forms-browser.ts with a lock, kill switch, code update and per-run log, same shape as form_submit_cycle.sh.
# Shares ~/.calldesk-forms (lock dir, STOP file, env) with the form worker so one `touch STOP` pauses both.
export PATH="$HOME/.claude-accounts/bin:/opt/homebrew/bin:/usr/bin:/bin"
export HOME="${HOME:-/Users/$(id -un)}"
set -uo pipefail

BASE="$HOME/.calldesk-forms"
REPO="$HOME/calldesk-outreach-harness/repo"
mkdir -p "$BASE/logs"
LOG="$BASE/logs/formfind_$(date +%Y%m%d_%H%M%S).log"

[ -f "$BASE/STOP" ] && { echo "$(date) STOP file present, not running" >> "$BASE/logs/skipped.log"; exit 0; }

LOCK="$BASE/find-lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  PID=$(cat "$LOCK/pid" 2>/dev/null || echo 0)
  if kill -0 "$PID" 2>/dev/null; then echo "$(date) previous find run still active (pid $PID), skipping" >> "$BASE/logs/skipped.log"; exit 0; fi
  rm -rf "$LOCK"; mkdir "$LOCK"
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

set -a; . "$BASE/env"; set +a

( cd "$REPO" && git pull -q --ff-only ) >> "$LOG" 2>&1 || echo "git pull failed; using existing code" >> "$LOG"

cd "$REPO/harness/outreach" || exit 1
./node_modules/.bin/tsx find-forms-browser.ts >> "$LOG" 2>&1
find "$BASE/logs" -name 'formfind_*.log' -mtime +30 -delete 2>/dev/null

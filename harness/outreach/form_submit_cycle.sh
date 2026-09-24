#!/bin/bash
# Launched every 20 minutes by launchd. Wraps form-submit.ts with a lock, kill
# switch, code update, per-run log and log pruning -- same shape as run_cycle.sh.
# Each pass is a no-op unless a human queued something with "Submit for me".
export PATH="$HOME/.claude-accounts/bin:/opt/homebrew/bin:/usr/bin:/bin"
export HOME="${HOME:-/Users/$(id -un)}"
set -uo pipefail

PRODUCT="${PRODUCT:-calldesk}"
# One shared state dir for form submission across products: the caps
# (daily/hourly/per-domain) are about how much traffic we send to other
# people's websites in total, not per product.
BASE="$HOME/.calldesk-forms"
REPO="$HOME/calldesk-outreach-harness/repo"
mkdir -p "$BASE/logs"
LOG="$BASE/logs/formsubmit_$(date +%Y%m%d_%H%M%S).log"

[ -f "$BASE/STOP" ] && { echo "$(date) STOP file present, not running" >> "$BASE/logs/skipped.log"; exit 0; }

LOCK="$BASE/lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  PID=$(cat "$LOCK/pid" 2>/dev/null || echo 0)
  if kill -0 "$PID" 2>/dev/null; then echo "$(date) previous run still active (pid $PID), skipping" >> "$BASE/logs/skipped.log"; exit 0; fi
  rm -rf "$LOCK"; mkdir "$LOCK"
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

set -a; . "$BASE/env"; set +a

( cd "$REPO" && git pull -q --ff-only ) >> "$LOG" 2>&1 || echo "git pull failed; using existing code" >> "$LOG"

cd "$REPO/harness/outreach" || exit 1
./node_modules/.bin/tsx form-submit.ts >> "$LOG" 2>&1
RC=$?

find "$BASE/logs" -name 'formsubmit_*.log' -mtime +30 -delete 2>/dev/null
if [ $RC -ne 0 ]; then
  osascript -e "display notification \"Form submission run failed. See ${BASE}/logs\" with title \"${PRODUCT} form submit\"" 2>/dev/null
fi
exit $RC

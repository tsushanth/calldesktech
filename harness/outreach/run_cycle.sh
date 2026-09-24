#!/bin/bash
# Launched daily by launchd. Wraps run.ts with a lock, kill switch, code update,
# per-run log, log pruning and a macOS notification on failure.
export PATH="$HOME/.claude-accounts/bin:/opt/homebrew/bin:/usr/bin:/bin"
export HOME="${HOME:-/Users/$(id -un)}"
set -uo pipefail

# PRODUCT selects which product's harness state dir this run uses (default
# 'calldesk'), matching ProductConfig.stateDirName in src/lib/outreach/products.ts
# ('.calldesk-outreach' / '.readaloud-outreach') so each product's STOP file,
# lock, and per-run logs stay isolated. The repo checkout is shared across products.
PRODUCT="${PRODUCT:-calldesk}"
# The eight customer-discovery verticals keep state under ~/.calldesk-<vertical>-outreach
# (ProductConfig.stateDirName); calldesk and readaloud keep ~/.<product>-outreach.
case "$PRODUCT" in
  freight|homeservices|dental|insurance|towing|septic|homecare|bailbonds) BASE="$HOME/.calldesk-${PRODUCT}-outreach" ;;
  *) BASE="$HOME/.${PRODUCT}-outreach" ;;
esac
REPO="$HOME/calldesk-outreach-harness/repo"
mkdir -p "$BASE/logs"
LOG="$BASE/logs/run_$(date +%Y%m%d_%H%M%S).log"

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
./node_modules/.bin/tsx run.ts >> "$LOG" 2>&1
RC=$?

find "$BASE/logs" -name 'run_*.log' -mtime +30 -delete 2>/dev/null
if [ $RC -ne 0 ]; then
  osascript -e "display notification \"Discovery run failed. See ${BASE}/logs\" with title \"${PRODUCT} outreach\"" 2>/dev/null
fi
exit $RC

#!/bin/bash
# Daily reseller pipeline for the Mac mini (launchd, weekdays): find new reseller leads, give each phone a call-region verdict,
# research and draft the new ones. Never sends: drafts land in the review queue, autosend does the sending after approval.
#
#   Stop it:   touch ~/.calldesk-backlog/STOP        Logs: ~/calldesk-reports/reseller-daily-YYYYMMDD.log
#   Cost:      ~4 Google searches a day through DataForSEO (about $0.016) plus Claude CLI calls for research and drafts.
export PATH="$HOME/.claude-accounts/bin:/opt/homebrew/bin:/usr/bin:/bin"
export HOME="${HOME:-/Users/$(id -un)}"
set -uo pipefail
BASE="$HOME/.calldesk-backlog"
REPO="$HOME/calldesk-outreach-harness/repo"
mkdir -p "$BASE" "$HOME/calldesk-reports"
LOG="$HOME/calldesk-reports/reseller-daily-$(date +%Y%m%d).log"

[ -f "$BASE/STOP" ] && { echo "$(date) STOP file present, not running" >> "$LOG"; exit 0; }
LOCK="$BASE/daily.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  PID=$(cat "$LOCK/pid" 2>/dev/null || echo 0)
  if kill -0 "$PID" 2>/dev/null; then echo "$(date) previous run still active ($PID)" >> "$LOG"; exit 0; fi
  rm -rf "$LOCK"; mkdir "$LOCK"
fi
echo $$ > "$LOCK/pid"; trap 'rm -rf "$LOCK"' EXIT

( cd "$REPO" && git pull -q --ff-only ) >> "$LOG" 2>&1 || echo "git pull failed; using existing code" >> "$LOG"
cd "$REPO/harness/outreach" || exit 1
set -a; . "$HOME/.calldesk-outreach/env"; set +a
export OUTREACH_LLM=cli
# Vapi's directory is a handful of HTTP requests; weekly (Monday) is plenty.
[ "$(date +%u)" = "1" ] && export OUTREACH_VAPI_DIRECTORY=1 || export OUTREACH_VAPI_DIRECTORY=0
echo "== $(date) discover" >> "$LOG"
ENRICH=100 DEADLINE_SECONDS=1500 ./node_modules/.bin/tsx discover-resellers.ts >> "$LOG" 2>&1
[ -f "$BASE/STOP" ] && exit 0
echo "== $(date) region check" >> "$LOG"
LIMIT=500 ./node_modules/.bin/tsx check-call-region.ts >> "$LOG" 2>&1
[ -f "$BASE/STOP" ] && exit 0
echo "== $(date) research" >> "$LOG"
for i in 0 1 2 3; do
  PRODUCT=calldesk SHARD=$i/4 LIMIT=15 PHASE=research SOURCES=search,manual,review_site,directory ./node_modules/.bin/tsx research-backlog.ts >> "$LOG" 2>&1 &
done
wait
[ -f "$BASE/STOP" ] && exit 0
echo "== $(date) draft" >> "$LOG"
PRODUCT=calldesk PHASE=draft LIMIT=40 ./node_modules/.bin/tsx research-backlog.ts >> "$LOG" 2>&1
echo "== $(date) done" >> "$LOG"
find "$HOME/calldesk-reports" -name 'reseller-daily-*.log' -mtime +30 -delete 2>/dev/null
exit 0

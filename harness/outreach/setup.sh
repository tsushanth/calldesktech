#!/bin/bash
# Idempotent installer, run ON the Mac mini. Sparse-clones only what the
# harness needs, installs 4 small dependencies, and (re)loads the launch agent.
set -euo pipefail
BASE="$HOME/.calldesk-outreach"; ROOT="$HOME/calldesk-outreach-harness"; LABEL=com.calldesk.outreach-discovery
export PATH="/opt/homebrew/bin:/usr/bin:/bin"
mkdir -p "$BASE/logs" "$ROOT"
[ -d "$ROOT/repo/.git" ] || git clone -q --depth 1 --filter=blob:none --sparse https://github.com/tsushanth/calldesktech.git "$ROOT/repo"
cd "$ROOT/repo"
git sparse-checkout set --no-cone /src/lib/outreach /src/lib/anthropic.ts /src/lib/email.ts /src/lib/supabase.ts /harness/outreach
git pull -q --ff-only
( cd harness/outreach && npm install --no-audit --no-fund --loglevel=error )
ln -sfn "$ROOT/repo/harness/outreach/node_modules" "$ROOT/repo/node_modules"
[ -f "$BASE/env" ] || { echo "missing $BASE/env (see README.md)"; exit 1; }
chmod 600 "$BASE/env"
sed "s|__HOME__|$HOME|g" harness/outreach/com.calldesk.outreach-discovery.plist.template > "$HOME/Library/LaunchAgents/$LABEL.plist"
U=$(id -u); launchctl bootout gui/$U/$LABEL 2>/dev/null || true
launchctl bootstrap gui/$U "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "installed and loaded $LABEL (daily 09:17 local)"

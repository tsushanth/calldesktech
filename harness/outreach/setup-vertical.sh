#!/bin/bash
# Prepares ONE customer-discovery vertical to start drafting on the Mac mini:
#   ./setup-vertical.sh childcare
#
# It creates ~/.calldesk-<vertical>-outreach/{env,logs} as a copy of an existing
# vertical's env (or the calldesk one), and renders the vertical's launchd plist
# from its template into ~/Library/LaunchAgents/.
#
# It deliberately does NOT load the launch agent and does NOT run a pass: it only
# puts the files in place. Start it yourself when you want it to run:
#   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.calldesk.outreach-<vertical>.plist
#   launchctl kickstart  gui/$(id -u)/com.calldesk.outreach-<vertical>       # run once now
# Stop it at any time with:  touch ~/.calldesk-<vertical>-outreach/STOP
#
# Idempotent: an existing env is never overwritten, and the plist is re-rendered.
# SOURCE_ENV=<path> overrides which env is copied.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin"

VERTICALS="freight homeservices dental insurance towing septic homecare bailbonds childcare accounting realestate lodging funeral physio taxi vets"

V="${1:-}"
if [ -z "$V" ]; then
  echo "usage: ./setup-vertical.sh <vertical>" >&2
  echo "verticals: $VERTICALS" >&2
  exit 2
fi
case " $VERTICALS " in
  *" $V "*) ;;
  *) echo "unknown vertical \"$V\"; one of: $VERTICALS" >&2; exit 2 ;;
esac

# This script lives in the repo next to the templates, so find them relative to it
# rather than assuming the checkout path.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$HERE/com.calldesk.outreach-$V.plist.template"
[ -f "$TEMPLATE" ] || { echo "missing template $TEMPLATE" >&2; exit 1; }

BASE="$HOME/.calldesk-$V-outreach"
LABEL="com.calldesk.outreach-$V"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$BASE/logs" "$HOME/Library/LaunchAgents"

if [ -f "$BASE/env" ]; then
  echo "env already exists, left untouched: $BASE/env"
else
  # Copy from an env that already works. Every vertical's env is the same file as
  # calldesk's (Supabase URL + service role key, OUTREACH_LLM=cli, optional
  # tunables); PRODUCT comes from the plist, never from the env.
  SRC="${SOURCE_ENV:-}"
  if [ -z "$SRC" ]; then
    for c in "$HOME/.calldesk-outreach/env" $(for o in $VERTICALS; do echo "$HOME/.calldesk-$o-outreach/env"; done); do
      [ -f "$c" ] && { SRC="$c"; break; }
    done
  fi
  [ -n "$SRC" ] && [ -f "$SRC" ] || { echo "no existing env to copy; create $BASE/env by hand (see README.md) or pass SOURCE_ENV=<path>" >&2; exit 1; }
  cp "$SRC" "$BASE/env"
  echo "created $BASE/env (copied from $SRC)"
fi
chmod 700 "$BASE"
chmod 600 "$BASE/env"

sed "s|__HOME__|$HOME|g" "$TEMPLATE" > "$PLIST"
echo "wrote $PLIST"

# A vertical that has never run has no STOP file; say so plainly either way.
if [ -f "$BASE/STOP" ]; then
  echo "NOTE: $BASE/STOP is present, so runs will be skipped until you remove it."
fi

cat <<EOS

$V is staged but NOT running. To start it:
  launchctl bootstrap gui/\$(id -u) "$PLIST"
To run one pass immediately:
  launchctl kickstart gui/\$(id -u)/$LABEL
To try it without writing anything first (recommended):
  cd "$HERE" && set -a && . "$BASE/env" && set +a && PRODUCT=$V DRY_RUN=1 ./node_modules/.bin/tsx run.ts
EOS

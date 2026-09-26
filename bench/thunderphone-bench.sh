#!/usr/bin/env bash
# Mystery-shopper A/B: Calldesk (call-loop-poc) vs ThunderPhone
# Adapted from mystery-shopper-run.sh (Retell version).
#
# Places the same AI shopper call against both backends in parallel, captures
# Twilio recordings + transcripts from both systems, derives objective audio
# latency, and runs the blind neutral judge.
#
# Unlike the Retell version, there is NO number-swap step — you point a
# dedicated ThunderPhone number at a benchmark agent once (in the TP dash),
# and this script just dials it.
#
# Required env:
#   THUNDERPHONE_API_KEY      — from ThunderPhone dash (Settings → API Keys)
#   THUNDERPHONE_NUMBER       — e.g. +12025551234 (must have a TP agent assigned)
#   THUNDERPHONE_AGENT_ID     — filter calls by this agent id for transcript lookup
#   CALLDESK_NUMBER           — your own inbound number (default +12245061194)
#   TEST_CALL_SECRET          — call-loop-poc /place-test-call secret
#   TWILIO_ACCOUNT_SID / AUTH_TOKEN
#
# Optional:
#   THUNDERPHONE_API_BASE     — default https://api.thunderphone.com
#   ROUNDS                    — default 1
#
set -euo pipefail

THUNDERPHONE_NUMBER="${THUNDERPHONE_NUMBER:?set THUNDERPHONE_NUMBER}"
THUNDERPHONE_AGENT_ID="${THUNDERPHONE_AGENT_ID:?set THUNDERPHONE_AGENT_ID}"
THUNDERPHONE_API_KEY="${THUNDERPHONE_API_KEY:?set THUNDERPHONE_API_KEY}"
CALLDESK_NUMBER="${CALLDESK_NUMBER:-+12245061194}"
CALL_LOOP_URL="${CALL_LOOP_URL:-https://call-loop-poc.fly.dev}"

: "${TEST_CALL_SECRET:?set TEST_CALL_SECRET}"
: "${TWILIO_ACCOUNT_SID:?set TWILIO_ACCOUNT_SID}"
: "${TWILIO_AUTH_TOKEN:?set TWILIO_AUTH_TOKEN}"

ROUNDS=1
while [ $# -gt 0 ]; do
  case "$1" in
    --rounds) ROUNDS="${2:?--rounds needs a number}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TP_API="$SCRIPT_DIR/thunderphone_api.py"
RUN_DIR="$(mktemp -d /tmp/mystery-shopper-tp.XXXX)"
echo "[mystery-shopper-tp] run dir: $RUN_DIR"

# --- helpers (same as Retell version) --------------------------------------

tw() { curl -s -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" "$@"; }

wait_for_recording() {
  local sid="$1" recs st rsid=""
  for i in $(seq 1 24); do
    recs=$(tw "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Recordings.json?CallSid=$sid")
    rsid=$(echo "$recs" | python3 -c "import json,sys; d=json.load(sys.stdin)['recordings']; print(d[0]['sid'] if d else '')" 2>/dev/null || true)
    if [ -n "$rsid" ]; then
      st=$(tw "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Recordings/$rsid.json" \
        | python3 -c "import json,sys; print(json.load(sys.stdin).get('status'))" 2>/dev/null || true)
      if [ "$st" = "completed" ] || [ "$st" = "processing-complete" ]; then
        echo "$rsid"; return 0
      fi
    fi
    sleep 5
  done
  echo ""; return 1
}

resolve_business_sid() {
  local ours_sid="$1"
  local since since_enc bounds call sid
  since=$(date -u -v-10M +"%Y-%m-%d %H:%M:%S")
  since_enc=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$since'))")
  bounds=$(tw "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Calls.json?To=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$CALLDESK_NUMBER'))")&Direction=inbound&StartTime%3E=$since_enc&PageSize=100")
  echo "$bounds" | python3 -c "
import json,sys
try:
    calls = json.load(sys.stdin)['calls']
except Exception:
    sys.exit(0)
for c in sorted(calls, key=lambda c: c.get('date_created') or '', reverse=True):
    if c['sid'] != '$ours_sid':
        print(c['sid'])
        break
"
}

latency_lines() {
  flyctl logs -a call-loop-poc --no-tail 2>&1 | grep "\[call $1\]" | grep -oE '\[latency\].*' || true
}

# --- per-round execution ---------------------------------------------------

echo "[mystery-shopper-tp] running $ROUNDS round(s)"
for r in $(seq 1 "$ROUNDS"); do
  echo "=== round $r ==="

  WINDOW_START=$(($(date +%s) * 1000))

  CALDESK_SID=$(curl -s -X POST "$CALL_LOOP_URL/place-test-call" \
    -H "Authorization: Bearer $TEST_CALL_SECRET" -H "Content-Type: application/json" \
    -d "{\"toNumber\":\"$CALLDESK_NUMBER\",\"shopper\":true,\"record\":true}" | python3 -c "import json,sys; print(json.load(sys.stdin)['sid'])")

  TP_SID=$(curl -s -X POST "$CALL_LOOP_URL/place-test-call" \
    -H "Authorization: Bearer $TEST_CALL_SECRET" -H "Content-Type: application/json" \
    -d "{\"toNumber\":\"$THUNDERPHONE_NUMBER\",\"shopper\":true,\"record\":true}" | python3 -c "import json,sys; print(json.load(sys.stdin)['sid'])")

  FROM_NUMBER=$(tw "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Calls/$CALDESK_SID.json" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('from'))")
  echo "[mystery-shopper-tp] round $r caldesk=$CALDESK_SID thunderphone=$TP_SID shopper-from=$FROM_NUMBER"

  for sid in "$CALDESK_SID" "$TP_SID"; do
    while true; do
      st=$(tw "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Calls/$sid.json" \
        | python3 -c "import json,sys; print(json.load(sys.stdin).get('status'))")
      case "$st" in
        completed|failed|busy|no-answer|canceled) break ;;
      esac
      sleep 15
    done
    echo "[mystery-shopper-tp] $sid -> $st"
  done

  WINDOW_END=$(($(date +%s) * 1000))

  # --- transcripts ---------------------------------------------------------

  # Caldesk transcript (from own server logs)
  echo "[mystery-shopper-tp] pulling Caldesk transcript"
  flyctl logs -a call-loop-poc --no-tail 2>&1 \
    | grep "\[call $CALDESK_SID\]" \
    | grep -oE '(user|assistant): ".*"$' \
    | sed -E 's/^user:/Business:/; s/^assistant:/Customer:/' \
    > "$RUN_DIR/round-$r-caldesk.txt" || true

  # ThunderPhone transcript (via API)
  echo "[mystery-shopper-tp] pulling ThunderPhone transcript"
  python3 - "$TP_API" "$THUNDERPHONE_AGENT_ID" "$FROM_NUMBER" "$WINDOW_START" "$WINDOW_END" "$RUN_DIR/round-$r-thunderphone.txt" <<'PY'
import sys
sys.path.insert(0, sys.argv[1].rsplit('/', 1)[0])
from thunderphone_api import find_call_by_time_window, get_call_transcript
agent_id, from_number, start, end, out_path = sys.argv[2:]
call = find_call_by_time_window(agent_id, from_number, int(start), int(end))
transcript = get_call_transcript(call["id"])
# Normalize labels to match judge convention
normalized = transcript.replace("Agent:", "Business:").replace("User:", "Customer:")
with open(out_path, "w") as f:
    f.write(normalized)
print(f"ThunderPhone call {call['id']} transcript -> {out_path}")
PY

  # --- recordings + objective latency metrics ------------------------------

  CALDESK_REC=$(wait_for_recording "$CALDESK_SID") || CALDESK_REC=""
  TP_REC=$(wait_for_recording "$TP_SID") || TP_REC=""

  if [ -n "$CALDESK_REC" ]; then
    python3 "$SCRIPT_DIR/analyze-call-ttfb.py" --recording "$CALDESK_REC" --json \
      > "$RUN_DIR/round-$r-caldesk-metrics.json" 2>/dev/null || true
  fi
  if [ -n "$TP_REC" ]; then
    python3 "$SCRIPT_DIR/analyze-call-ttfb.py" --recording "$TP_REC" --json \
      > "$RUN_DIR/round-$r-thunderphone-metrics.json" 2>/dev/null || true
  fi

  # --- Caldesk server-side latency (ours only) -----------------------------

  BIZ_SID=$(resolve_business_sid "$CALDESK_SID")
  if [ -n "$BIZ_SID" ]; then
    latency_lines "$BIZ_SID" > "$RUN_DIR/round-$r-biz-latency.txt"
  fi

  # --- blind judge ---------------------------------------------------------

  if [ ! -s "$RUN_DIR/round-$r-caldesk.txt" ]; then
    echo "[mystery-shopper-tp] ERROR: Caldesk transcript empty for round $r" >&2
    continue
  fi
  if [ ! -s "$RUN_DIR/round-$r-thunderphone.txt" ]; then
    echo "[mystery-shopper-tp] ERROR: ThunderPhone transcript empty for round $r" >&2
    continue
  fi

  echo "[mystery-shopper-tp] running blind judge"
  node "$SCRIPT_DIR/mystery-shopper-judge-neutral.mjs" \
    --a "$RUN_DIR/round-$r-caldesk.txt" --label-a "Calldesk" \
    --b "$RUN_DIR/round-$r-thunderphone.txt" --label-b "ThunderPhone" \
    --metrics-a "$RUN_DIR/round-$r-caldesk-metrics.json" \
    --metrics-b "$RUN_DIR/round-$r-thunderphone-metrics.json" \
    > "$RUN_DIR/round-$r-verdict.txt" 2>&1

  WINNER=$(grep -E '^WINNER_SYSTEM:' "$RUN_DIR/round-$r-verdict.txt" | tail -1 | awk '{print $2}' || true)
  echo "[mystery-shopper-tp] round $r winner: ${WINNER:-n/a}"
done

# --- summary -------------------------------------------------------------

echo
echo "=================================================================="
echo " MYSTERY-SHOPPER SUMMARY: Calldesk vs ThunderPhone ($ROUNDS round(s))"
echo "=================================================================="
printf "%-5s %-12s %-16s %-16s %-16s\n" "round" "winner" "caldesk p50/p95" "thunder p50/p95" "caldesk llm/ttfb"
for r in $(seq 1 "$ROUNDS"); do
  caldesk_lat=$(python3 -c "
import json
try:
    d=json.load(open('$RUN_DIR/round-$r-caldesk-metrics.json'))
    l=d['response_latency_ms']
    print(f\"{l['median_ms']}/{l['p95_ms']}\" if l.get('n') else 'n/a')
except Exception:
    print('n/a')")
  tp_lat=$(python3 -c "
import json
try:
    d=json.load(open('$RUN_DIR/round-$r-thunderphone-metrics.json'))
    l=d['response_latency_ms']
    print(f\"{l['median_ms']}/{l['p95_ms']}\" if l.get('n') else 'n/a')
except Exception:
    print('n/a')")
  winner=$(grep -E '^WINNER_SYSTEM:' "$RUN_DIR/round-$r-verdict.txt" 2>/dev/null | tail -1 | awk '{print $2}' || true)
  winner=${winner:-n/a}
  printf "%-5s %-12s %-16s %-16s\n" "$r" "$winner" "$caldesk_lat" "$tp_lat"
  if [ -s "$RUN_DIR/round-$r-biz-latency.txt" ]; then
    echo "  -> Caldesk server latency (round $r):"
    sed 's/^/     /' "$RUN_DIR/round-$r-biz-latency.txt"
  fi
done
echo "=================================================================="
echo " reports: $RUN_DIR"

#!/usr/bin/env bash
# ThunderPhone tiered benchmark: Spark vs Bolt vs Calldesk
# Runs 5 rounds against each TP tier, same shopper, same scenario.
#
# Usage: ./thunderphone-tier-bench.sh

set -euo pipefail

THUNDERPHONE_NUMBER="${THUNDERPHONE_NUMBER:?set THUNDERPHONE_NUMBER}"
THUNDERPHONE_API_KEY="${THUNDERPHONE_API_KEY:?set THUNDERPHONE_API_KEY}"
TP_NUM_ID="${TP_NUM_ID:-107}"
CALLDESK_NUMBER="${CALLDESK_NUMBER:-+12245061194}"
CALL_LOOP_URL="${CALL_LOOP_URL:-https://call-loop-poc.fly.dev}"

: "${TEST_CALL_SECRET:?set TEST_CALL_SECRET}"
: "${TWILIO_ACCOUNT_SID:?set TWILIO_ACCOUNT_SID}"
: "${TWILIO_AUTH_TOKEN:?set TWILIO_AUTH_TOKEN}"

ROUNDS="${ROUNDS:-5}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TP_API="$SCRIPT_DIR/thunderphone_api.py"
RUN_DIR="$(mktemp -d /tmp/tp-tier-bench.XXXX)"
echo "[tp-tier-bench] run dir: $RUN_DIR"

# --- TP agent IDs (must be created beforehand) ---
SPARK_AGENT="${SPARK_AGENT:-253}"
BOLT_AGENT="${BOLT_AGENT:-254}"

# --- helpers (copied from thunderphone-bench.sh) ---
tw() { curl -s -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" "$@"; }

wait_for_recording() {
  local sid="$1" recs st rsid=""
  for i in $(seq 1 24); do
    recs=$(tw "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Recordings.json?CallSid=$sid")
    rsid=$(echo "$recs" | python3 -c "import json,sys; d=json.load(sys.stdin)['recordings']; print(d[0]['sid'] if d else '')" 2>/dev/null || true)
    if [ -n "$rsid" ]; then
      st=$(tw "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Recordings/$rsid.json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status'))" 2>/dev/null || true)
      if [ "$st" = "completed" ] || [ "$st" = "processing-complete" ]; then echo "$rsid"; return 0; fi
    fi
    sleep 5
  done
  echo ""; return 1
}

resolve_business_sid() {
  local ours_sid="$1"
  local since since_enc bounds
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

fetch_caldesk_transcript() {
  local biz_sid="$1" out="$2"
  python3 - "$biz_sid" "$out" <<'PY'
import json, os, sys

def read_env(path):
    vals = {}
    with open(path) as f:
        for line in f:
            if '=' in line and not line.startswith('#'):
                k, v = line.strip().split('=', 1)
                vals[k] = v.strip().strip('"')
    return vals

env = read_env(os.path.expanduser('~/Documents/GitHub/realtime-tts/call-loop-poc/.env'))
url = env.get('SUPABASE_URL')
key = env.get('SUPABASE_SERVICE_ROLE_KEY')
if not url or not key:
    print('SUPABASE creds missing', file=sys.stderr)
    sys.exit(1)

biz_sid = sys.argv[1]
out_path = sys.argv[2]

import urllib.request
req = urllib.request.Request(
    f"{url}/rest/v1/calldesk_call_logs?retell_call_id=eq.{biz_sid}&select=transcript",
    headers={'apikey': key, 'Authorization': f'Bearer {key}'}
)
try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        rows = json.loads(resp.read())
        if not rows:
            print(f"No calldesk_call_logs row for {biz_sid}", file=sys.stderr)
            sys.exit(1)
        transcript = rows[0].get('transcript') or []
        with open(out_path, 'w') as f:
            for msg in transcript:
                role = msg.get('role', '')
                content = msg.get('content', '')
                if role == 'user':
                    f.write(f'Customer: "{content}"\n')
                elif role == 'assistant':
                    f.write(f'Business: "{content}"\n')
        print(f"Caldesk transcript {len(transcript)} turns -> {out_path}")
except Exception as e:
    print(f"Supabase query failed: {e}", file=sys.stderr)
    sys.exit(1)
PY
}

# --- assign TP number to agent ---
assign_tp_agent() {
  local agent_id="$1"
  echo "[tp-tier-bench] assigning number $TP_NUM_ID -> agent $agent_id"
  python3 - "$TP_API" "$TP_NUM_ID" "$agent_id" <<'PY'
import sys
sys.path.insert(0, sys.argv[1].rsplit('/', 1)[0])
from thunderphone_api import assign_agent_to_number
assign_agent_to_number(sys.argv[2], sys.argv[3])
print(f"Assigned number {sys.argv[2]} to agent {sys.argv[3]}")
PY
}

# --- run rounds against a specific TP agent ---
run_tier() {
  local tier="$1" agent_id="$2"
  echo ""
  echo "=========================================="
  echo "  TIER: $tier (agent $agent_id)"
  echo "=========================================="

  # Assign number to this tier's agent
  assign_tp_agent "$agent_id"
  sleep 3  # brief pause for routing to settle

  for r in $(seq 1 "$ROUNDS"); do
    echo "--- $tier round $r ---"

    WINDOW_START=$(($(date +%s) * 1000))

    CALDESK_SID=$(curl -s -X POST "$CALL_LOOP_URL/place-test-call" \
      -H "Authorization: Bearer $TEST_CALL_SECRET" -H "Content-Type: application/json" \
      -d "{\"toNumber\":\"$CALLDESK_NUMBER\",\"shopper\":true,\"record\":true}" | python3 -c "import json,sys; print(json.load(sys.stdin)['sid'])")

    TP_SID=$(curl -s -X POST "$CALL_LOOP_URL/place-test-call" \
      -H "Authorization: Bearer $TEST_CALL_SECRET" -H "Content-Type: application/json" \
      -d "{\"toNumber\":\"$THUNDERPHONE_NUMBER\",\"shopper\":true,\"record\":true}" | python3 -c "import json,sys; print(json.load(sys.stdin)['sid'])")

    FROM_NUMBER=$(tw "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Calls/$CALDESK_SID.json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('from'))")
    echo "[tp-tier-bench] caldesk=$CALDESK_SID tp=$TP_SID shopper-from=$FROM_NUMBER"

    # Wait for completion
    for sid in "$CALDESK_SID" "$TP_SID"; do
      while true; do
        st=$(tw "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Calls/$sid.json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status'))")
        case "$st" in completed|failed|busy|no-answer|canceled) break ;; esac
        sleep 15
      done
      echo "[tp-tier-bench] $sid -> $st"
    done

    # Caldesk transcript
    BIZ_SID=$(resolve_business_sid "$CALDESK_SID")
    if [ -n "$BIZ_SID" ]; then
      fetch_caldesk_transcript "$BIZ_SID" "$RUN_DIR/${tier}-round-$r-caldesk.txt"
    else
      echo "[tp-tier-bench] WARNING: no biz sid for Caldesk"
      > "$RUN_DIR/${tier}-round-$r-caldesk.txt"
    fi

    WINDOW_END=$(($(date +%s) * 1000))

    # TP transcript
    python3 - "$TP_API" "$agent_id" "$FROM_NUMBER" "$WINDOW_START" "$WINDOW_END" "$RUN_DIR/${tier}-round-$r-thunderphone.txt" <<'PY'
import sys
sys.path.insert(0, sys.argv[1].rsplit('/', 1)[0])
from thunderphone_api import find_call_by_time_window, get_call_transcript
agent_id, from_number, start, end, out_path = sys.argv[2:]
call = find_call_by_time_window(agent_id, from_number, int(start), int(end))
if call:
    transcript = get_call_transcript(call["call_id"])
    with open(out_path, "w") as f:
        f.write(transcript)
    print(f"ThunderPhone call {call['call_id']} -> {out_path}")
else:
    print("WARNING: no ThunderPhone call found", file=sys.stderr)
    open(out_path, "w").close()
PY

    # Recordings
    CALDESK_REC=$(wait_for_recording "$CALDESK_SID") || CALDESK_REC=""
    TP_REC=$(wait_for_recording "$TP_SID") || TP_REC=""

    if [ -n "$CALDESK_REC" ]; then
      python3 "$SCRIPT_DIR/analyze-call-ttfb.py" --recording "$CALDESK_REC" --json > "$RUN_DIR/${tier}-round-$r-caldesk-metrics.json" 2>/dev/null || true
    fi
    if [ -n "$TP_REC" ]; then
      python3 "$SCRIPT_DIR/analyze-call-ttfb.py" --recording "$TP_REC" --json > "$RUN_DIR/${tier}-round-$r-thunderphone-metrics.json" 2>/dev/null || true
    fi

    # Judge
    if [ -s "$RUN_DIR/${tier}-round-$r-caldesk.txt" ] && [ -s "$RUN_DIR/${tier}-round-$r-thunderphone.txt" ]; then
      echo "[tp-tier-bench] running blind judge"
      node "$SCRIPT_DIR/mystery-shopper-judge-neutral.mjs" \
        --a "$RUN_DIR/${tier}-round-$r-caldesk.txt" --label-a "Calldesk" \
        --b "$RUN_DIR/${tier}-round-$r-thunderphone.txt" --label-b "ThunderPhone ($tier)" \
        --metrics-a "$RUN_DIR/${tier}-round-$r-caldesk-metrics.json" \
        --metrics-b "$RUN_DIR/${tier}-round-$r-thunderphone-metrics.json" \
        > "$RUN_DIR/${tier}-round-$r-verdict.txt" 2>&1
      WINNER=$(grep -E '^WINNER_SYSTEM:' "$RUN_DIR/${tier}-round-$r-verdict.txt" | tail -1 | awk '{print $2}' || true)
      echo "[tp-tier-bench] $tier round $r winner: ${WINNER:-n/a}"
    else
      echo "[tp-tier-bench] ERROR: empty transcript for $tier round $r"
    fi
  done
}

# --- main ---
run_tier "spark" "$SPARK_AGENT"
run_tier "bolt" "$BOLT_AGENT"

# --- summary ---
echo ""
echo "============================================================"
echo " TIERED BENCHMARK SUMMARY: Calldesk vs ThunderPhone"
echo "============================================================"
printf "%-8s %-7s %-16s %-16s %-16s\n" "tier" "round" "caldesk p50/p95" "tp p50/p95" "winner"
for tier in spark bolt; do
  for r in $(seq 1 "$ROUNDS"); do
    caldesk_lat=$(python3 -c "
import json
try:
    d=json.load(open('$RUN_DIR/${tier}-round-$r-caldesk-metrics.json'))
    l=d['response_latency_ms']
    print(f\"{l['median_ms']}/{l['p95_ms']}\" if l.get('n') else 'n/a')
except: print('n/a')")
    tp_lat=$(python3 -c "
import json
try:
    d=json.load(open('$RUN_DIR/${tier}-round-$r-thunderphone-metrics.json'))
    l=d['response_latency_ms']
    print(f\"{l['median_ms']}/{l['p95_ms']}\" if l.get('n') else 'n/a')
except: print('n/a')")
    winner=$(grep -E '^WINNER_SYSTEM:' "$RUN_DIR/${tier}-round-$r-verdict.txt" 2>/dev/null | tail -1 | awk '{print $2}' || true)
    winner=${winner:-n/a}
    printf "%-8s %-7s %-16s %-16s %-16s\n" "$tier" "$r" "$caldesk_lat" "$tp_lat" "$winner"
  done
done
echo "============================================================"
echo " reports: $RUN_DIR"

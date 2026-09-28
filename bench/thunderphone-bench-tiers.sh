#!/usr/bin/env bash
# Mystery-shopper A/B: Calldesk (call-loop-poc) vs ThunderPhone — tier matrix.
#
# ADDITIVE. Sits alongside `thunderphone-bench.sh` rather than replacing it,
# and drives `mystery-shopper-judge-pinned.mjs`. The single-opponent harness
# stays as-is for reproducing the published runs; this one exists because
# "we beat Spark" is not the same claim as "we beat Spark, Bolt and Storm",
# and because a win should still produce a work list.
#
# Differences from thunderphone-bench.sh:
#   * --tiers: one or more ThunderPhone tiers per round (number-per-tier).
#   * Runs a single-system critique of our own transcript every round, because
#     a comparative judge only reports gaps on the side that lost.
#   * --scenario: passes a free-text persona, e.g. `medical` where the caller
#     spells their name unprompted.
#   * Judge model pinned via JUDGE_MODEL, recorded in every verdict file.
#   * CALLOOP_ENV overrides the Supabase-credential .env lookup.
#
# Required env:
#   THUNDERPHONE_API_KEY      — from ThunderPhone dash (Settings → API Keys)
#   THUNDERPHONE_API_BASE     — default https://api.thunderphone.com
#   THUNDERPHONE_TIERS        — comma list of tier:number:agent_id, e.g.
#                               "spark:+12025551111:123,bolt:+12025552222:124,storm:+12025553333:125"
#                               One number per tier, each already pointing at
#                               that tier's agent in the TP dashboard.
#                               A "<tier>-noei" entry is a second agent on that
#                               same tier with Extra Intelligence DISABLED:
#                               "storm:+15550001111:125,storm-noei:+15550002222:126"
#                               Pairing the two isolates Extra Intelligence as
#                               the only variable and adds a direct head-to-head.
#   CALDESK_NUMBER           — your own inbound number (default +12245061194)
#   TEST_CALL_SECRET          — call-loop-poc /place-test-call secret
#   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN
#
# Optional:
#   ROUNDS                    — default 1
#   THUNDERPHONE_NUMBER / THUNDERPHONE_AGENT_ID
#                            — legacy single-opponent form; treated as tier
#                              "spark" and merged with THUNDERPHONE_TIERS
#   SCENARIO                  — default "booking"; "medical" forces the
#                              shopper to spell their name
#   JUDGE_MODEL               — default claude-sonnet-4-6
#   JUDGE_THINKING            — set to 1 for an extended-thinking judge
#   CALLOOP_ENV               — path to call-loop-poc/.env (for Supabase creds)
#   SKIP_CRITIQUE             — set to 1 to skip the self-critique pass
#   SKIP_EI_PAIR              — set to 1 to skip the Extra Intelligence
#                              head-to-head (paired tiers only)
#   THUNDERPHONE_SHARED_NUMBER— when set, every tier reuses this one number and
#                              THUNDERPHONE_TIERS becomes tier:agentId. The
#                              runner re-points the number at each arm's agent
#                              and restores the original agent on exit. Use this
#                              when you have fewer numbers than arms.
#   TP_SETTLE_SECONDS         — routing settle after a re-point (default 30)
set -euo pipefail

THUNDERPHONE_API_KEY="${THUNDERPHONE_API_KEY:?set THUNDERPHONE_API_KEY}"
CALLDESK_NUMBER="${CALLDESK_NUMBER:-+12245061194}"
CALL_LOOP_URL="${CALL_LOOP_URL:-https://call-loop-poc.fly.dev}"
CALLOOP_ENV="${CALLOOP_ENV:-$HOME/Documents/GitHub/realtime-tts/call-loop-poc/.env}"

: "${TEST_CALL_SECRET:?set TEST_CALL_SECRET}"
: "${TWILIO_ACCOUNT_SID:?set TWILIO_ACCOUNT_SID}"
: "${TWILIO_AUTH_TOKEN:?set TWILIO_AUTH_TOKEN}"

ROUNDS="${ROUNDS:-1}"
SCENARIO="${SCENARIO:-booking}"
JUDGE_MODEL="${JUDGE_MODEL:-claude-sonnet-4-6}"
SKIP_CRITIQUE="${SKIP_CRITIQUE:-0}"
TP_SHARED="${THUNDERPHONE_SHARED_NUMBER:-}"
TP_SETTLE_SECONDS="${TP_SETTLE_SECONDS:-30}"
JUDGE_THINKING_FLAG=""
if [ -n "${JUDGE_THINKING:-}" ] && [ "${JUDGE_THINKING}" != "0" ]; then
  JUDGE_THINKING_FLAG="--thinking"
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --rounds) ROUNDS="${2:?--rounds needs a number}"; shift 2 ;;
    --tiers) THUNDERPHONE_TIERS="${2:?--tiers needs tier:number:agentId,...}"; shift 2 ;;
    --scenario) SCENARIO="${2:?--scenario needs a name}"; shift 2 ;;
    --judge-model) JUDGE_MODEL="${2:?--judge-model needs a model id}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

# --- scenario prompts ------------------------------------------------------
# Free-text `persona` — call-loop-poc accepts an arbitrary string per call, so
# scenario changes need no engine change.

scenario_persona() {
  case "$1" in
    medical)
      # A clinic receptionist requirement: never accept a name the STT may have
      # garbled. The caller spells it out; the agent is expected to ask.
      cat <<'PERSONA'
You are Alex Morgan, calling a medical clinic to book an appointment for
tomorrow afternoon. You are slightly hard of hearing and you speak quickly,
so you expect to be asked to repeat yourself.

Spell your name out letter by letter the FIRST time the agent asks for it,
unprompted. Say it clearly, letter by letter, on its own. Do not spell it
any other time.

If the agent asks for a phone number, your number is 4155550147. Say it by
speaking each digit separately with a short pause between digits: "four ...
one ... five ... five ... five ... five ... zero ... one ... four ...
seven". Never run the digits together as one continuous run, and never give
a short, partial, or different number, so that any failure to collect the
complete number is the agent's fault and not the caller's.

Your number is the only correct answer. If the agent reads back anything
other than 4155550147, tell them plainly that it is wrong and give the ten
digits again, one at a time. If they read back 4155550147 correctly, just
confirm it.

Everything else about you is normal: answer one question at a time, wait for
the agent to speak first, confirm when asked to confirm, and when the booking
is read back to you, verify every detail carefully. If the agent reads your
name back incorrectly, say so plainly and correct it. Say one goodbye at the
end and then stop talking.
PERSONA
      ;;
    *)
      cat <<'PERSONA'
You are Alex Morgan, calling to book an appointment for tomorrow afternoon.
Wait for the agent to speak first, answer one question at a time, confirm
when asked, and when the booking is read back to you, verify every detail
carefully. If the agent asks for a phone number, your number is 4155550147.
Say it by speaking each digit separately with a short pause between digits:
"four ... one ... five ... five ... five ... five ... zero ... one ... four ...
seven". Never run the digits together as one continuous run, and never give a
short, partial, or different number. If the agent reads back anything other
than 4155550147, tell them plainly it is wrong and give the ten digits again.
Say a single goodbye at the end and then stop talking.
PERSONA
      ;;
  esac
}

# --- tier table ------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TP_API="$SCRIPT_DIR/thunderphone_api.py"
RUN_DIR="$(mktemp -d /tmp/mystery-shopper-tp.XXXX)"
echo "[mystery-shopper-tp] run dir: $RUN_DIR"
echo "[mystery-shopper-tp] scenario: $SCENARIO"
echo "[mystery-shopper-tp] judge model: $JUDGE_MODEL (thinking: $([ -n "$JUDGE_THINKING_FLAG" ] && echo on || echo off))"

PERSONA="$(scenario_persona "$SCENARIO")"

TIER_SPEC="${THUNDERPHONE_TIERS:-}"
if [ -z "$TIER_SPEC" ] && [ -n "${THUNDERPHONE_NUMBER:-}" ]; then
  TIER_SPEC="spark:${THUNDERPHONE_NUMBER}:${THUNDERPHONE_AGENT_ID:-}"
fi
if [ -z "$TIER_SPEC" ]; then
  echo "need THUNDERPHONE_TIERS (tier:number:agentId,...) or THUNDERPHONE_NUMBER + THUNDERPHONE_AGENT_ID" >&2
  exit 1
fi

TIER_NAMES=(); TIER_NUMBERS=(); TIER_AGENT_IDS=()
if [ -n "$TP_SHARED" ] && ! printf '%s' "$TP_SHARED" | grep -Eq '^\+[0-9]{7,15}$'; then
  echo "THUNDERPHONE_SHARED_NUMBER='$TP_SHARED' is not an E.164 number" >&2
  exit 1
fi
IFS=',' read -ra _tier_specs <<< "$TIER_SPEC"
for spec in "${_tier_specs[@]}"; do
  spec="$(echo "$spec" | tr -d '[:space:]')"
  [ -z "$spec" ] && continue
  # Split on ':' with IFS rather than `cut`. `cut -d: -f2` on a spec with no
  # delimiter echoes the whole line, so a typo like "spark" used to validate as
  # tier=spark number=spark and place a live call to a bogus number.
  if [ -n "$TP_SHARED" ]; then
    # shared-number mode: the number is supplied once, so a spec is tier:agentId
    IFS=':' read -r t a <<< "$spec"
    n="$TP_SHARED"
    if [ -z "$t" ] || [ -z "$a" ]; then
      echo "bad tier spec '$spec' — with THUNDERPHONE_SHARED_NUMBER set, expected tier:agentId" >&2
      exit 1
    fi
    # read -r t a gives the last field everything left over, so a pasted
    # 3-field spec would otherwise arrive here as agent "+1507...:248".
    if ! printf '%s' "$a" | grep -Eq '^[0-9]+$'; then
      echo "bad tier spec '$spec' — agent id '$a' is not numeric (with THUNDERPHONE_SHARED_NUMBER set, expected tier:agentId)" >&2
      exit 1
    fi
  else
    IFS=':' read -r t n a <<< "$spec"
    if [ -z "$t" ] || [ -z "$n" ] || [ -z "$a" ]; then
      echo "bad tier spec '$spec' — expected tier:number:agentId" >&2
      exit 1
    fi
    if ! printf '%s' "$n" | grep -Eq '^\+[0-9]{7,15}$'; then
      echo "bad tier spec '$spec' — '$n' is not an E.164 number" >&2
      exit 1
    fi
    if ! printf '%s' "$a" | grep -Eq '^[0-9]+$'; then
      echo "bad tier spec '$spec' — agent id '$a' is not numeric" >&2
      exit 1
    fi
  fi
  TIER_NAMES+=("$t"); TIER_NUMBERS+=("$n"); TIER_AGENT_IDS+=("$a")
done
if [ "${#TIER_NAMES[@]}" -eq 0 ]; then
  echo "no tiers parsed from THUNDERPHONE_TIERS='$TIER_SPEC'" >&2
  exit 1
fi
echo "[mystery-shopper-tp] tiers: ${TIER_NAMES[*]}"

# --- Extra Intelligence pairing preflight ---------------------------------
# A "<tier>-noei" entry is a *second* ThunderPhone agent on that same tier with
# Extra Intelligence disabled. It only means anything next to its "on"
# counterpart, because the pair is what turns Extra Intelligence from a
# marketing claim into a measured variable.
EI_PAIRS=()
for t in "${TIER_NAMES[@]}"; do
  case "$t" in
    *-noei)
      base="${t%-noei}"
      seen=0
      for t2 in "${TIER_NAMES[@]}"; do
        if [ "$t2" = "$base" ]; then seen=1; fi
      done
      if [ "$seen" = "1" ]; then
        EI_PAIRS+=("$base")
      else
        echo "[mystery-shopper-tp] WARNING: tier '$t' has no '$base' counterpart — Extra Intelligence cannot be isolated" >&2
      fi
      ;;
  esac
done
if [ "${#EI_PAIRS[@]}" -gt 0 ]; then
  if [ "${SKIP_EI_PAIR:-0}" = "1" ]; then
    echo "[mystery-shopper-tp] Extra Intelligence pairs: ${EI_PAIRS[*]} (head-to-heads SKIPPED)"
  else
    echo "[mystery-shopper-tp] Extra Intelligence pairs: ${EI_PAIRS[*]} (direct head-to-heads will run)"
  fi
fi

# --- helpers ---------------------------------------------------------------

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
  # resolve_business_sid <our_shopper_leg_sid> <round_window_start_epoch_SECONDS>
  #
  # Same shape as the original harness, but the lookback is anchored to this
  # round's window instead of a fixed 10 minutes. The original is safe with one
  # opponent because rounds rarely overlap 10 minutes; across tiers they do,
  # and a stale SID from an earlier round would be scored as if it were this
  # round's transcript. If the business leg has not propagated yet we return
  # nothing so the round fails loudly instead of judging the wrong call.
  local ours_sid="$1" floor_epoch="$2"
  local since since_enc bounds
  # WINDOW_START elsewhere in this script is milliseconds, so a ms value handed
  # to the epoch-seconds conversion below raises "year must be in 1..9999" and
  # the round is then skipped with only a generic warning. Catch it here.
  if [ "$floor_epoch" -gt 100000000000 ] 2>/dev/null; then
    echo "resolve_business_sid: got $floor_epoch, which looks like milliseconds — expected epoch seconds" >&2
    return 1
  fi
  floor_epoch=$(( floor_epoch - 60 ))
  since=$(python3 -c "import datetime,sys;print(datetime.datetime.fromtimestamp(int(sys.argv[1]),datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S'))" "$floor_epoch")
  since_enc=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$since'))")
  bounds=$(tw "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Calls.json?To=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$CALLDESK_NUMBER'))")&Direction=inbound&StartTime%3E=$since_enc&PageSize=100")
  echo "$bounds" | python3 -c "
import json,sys
from email.utils import parsedate_to_datetime
floor = int('$floor_epoch')
try:
    calls = json.load(sys.stdin)['calls']
except Exception:
    sys.exit(0)
def epoch(c):
    try:
        return int(parsedate_to_datetime(c.get('date_created')).timestamp())
    except Exception:
        return 0
for c in sorted(calls, key=epoch, reverse=True):
    if c['sid'] == '$ours_sid':
        continue
    if epoch(c) < floor:
        continue
    print(c['sid'])
    break
"
}

latency_lines() {
  flyctl logs -a call-loop-poc --no-tail 2>&1 | grep "\[call $1\]" | grep -oE '\[latency\].*' || true
}

fetch_caldesk_transcript() {
  local biz_sid="$1" out="$2"
  CALLOOP_ENV="$CALLOOP_ENV" python3 - "$biz_sid" "$out" <<'PY'
import json, os, sys

env_path = os.environ.get('CALLOOP_ENV') or os.path.expanduser(
    '~/Documents/GitHub/realtime-tts/call-loop-poc/.env')

def read_env(path):
    vals = {}
    with open(path) as f:
        for line in f:
            if '=' in line and not line.startswith('#'):
                k, v = line.strip().split('=', 1)
                vals[k] = v.strip().strip('"')
    return vals

env = read_env(env_path)
url = env.get('SUPABASE_URL')
key = env.get('SUPABASE_SERVICE_ROLE_KEY')
if not url or not key:
    print(f'Supabase creds missing in {env_path}', file=sys.stderr)
    sys.exit(1)

biz_sid = sys.argv[1]
out_path = sys.argv[2]

import urllib.request
req = urllib.request.Request(
    f"{url}/rest/v1/calldesk_call_logs?retell_call_id=eq.{biz_sid}&select=transcript",
    headers={'apikey': key, 'Authorization': f'Bearer {key}'},
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

place_shopper_call() {
  local to_number="$1"
  local payload
  payload=$(python3 -c "
import json,sys
print(json.dumps({
  'toNumber': sys.argv[1],
  'shopper': True,
  'record': True,
  'persona': sys.argv[2],
}))" "$to_number" "$PERSONA")
  curl -s -X POST "$CALL_LOOP_URL/place-test-call" \
    -H "Authorization: Bearer $TEST_CALL_SECRET" -H "Content-Type: application/json" \
    -d "$payload" | python3 -c "import json,sys; print(json.load(sys.stdin)['sid'])"
}

wait_for_call() {
  local sid="$1" st=""
  while true; do
    st=$(tw "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Calls/$sid.json" \
      | python3 -c "import json,sys; print(json.load(sys.stdin).get('status'))")
    case "$st" in
      completed|failed|busy|no-answer|canceled) break ;;
    esac
    sleep 15
  done
  echo "$st"
}

pull_tp_transcript() {
  local agent_id="$1" from_number="$2" win_start="$3" win_end="$4" out="$5"
  python3 - "$SCRIPT_DIR" "$agent_id" "$from_number" "$win_start" "$win_end" "$out" <<'PY'
import re, sys
sys.path.insert(0, sys.argv[1])
from thunderphone_api import find_call_by_time_window, get_call_transcript
agent_id, from_number, start, end, out_path = sys.argv[2:]
call = find_call_by_time_window(agent_id, from_number, int(start), int(end))
transcript = get_call_transcript(call["call_id"])
# ThunderPhone's transcript includes non-speech telemetry rows such as
#   Customer: {"tool_call": "end_call", "arguments": {}}
#   Customer: {"actor": "ai", "event": "call_ended", "action": "hangup"}
# Feeding those to the judge is dirty input and can read as the agent saying
# JSON aloud, so drop any row whose payload is a JSON object/array.
kept, dropped = [], 0
for line in transcript.splitlines():
    if re.match(r'^\s*\w+\s*:\s*[\[{]', line):
        dropped += 1
        continue
    kept.append(line)
with open(out_path, "w") as f:
    f.write("\n".join(kept))
print(f"ThunderPhone call {call['call_id']} transcript -> {out_path} "
      f"({dropped} telemetry row(s) filtered)")
PY
}

tp_inbound() {
  # tp_inbound <e164> -> current inbound_agent_id, or empty if number unknown
  python3 - "$SCRIPT_DIR" "$1" <<'PY'
import sys
sys.path.insert(0, sys.argv[1])
import thunderphone_api as tp
num = sys.argv[2]
rows = tp.list_phone_numbers()
rows = rows if isinstance(rows, list) else (rows.get("phone_numbers") or rows.get("data") or [])
m = next((r for r in rows if r.get("number") == num), None)
print(m.get("inbound_agent_id") if m else "")
PY
}

tp_repoint() {
  # tp_repoint <e164> <agent_id> -> echoes the agent id the API now reports
  #
  # The field is the scalar `inbound_agent_id`. The repo's own
  # assign_agent_to_number() posts {"inbound_agents":[{...}]}, which this API
  # accepts with a 200 and then silently ignores, so it is not used here.
  python3 - "$SCRIPT_DIR" "$1" "$2" <<'PY'
import sys
sys.path.insert(0, sys.argv[1])
import thunderphone_api as tp
num, agent = sys.argv[2], int(sys.argv[3])
rows = tp.list_phone_numbers()
rows = rows if isinstance(rows, list) else (rows.get("phone_numbers") or rows.get("data") or [])
m = next((r for r in rows if r.get("number") == num), None)
if not m:
    sys.exit(f"no ThunderPhone number matching {num}")
r = tp._req("PATCH", f"/v1/phone-numbers/{m['id']}", {"inbound_agent_id": agent})
r = r[0] if isinstance(r, list) else r
print(r.get("inbound_agent_id"))
PY
}

run_judge() {
  # run_judge <outfile> <args...>
  local out="$1"; shift
  node "$SCRIPT_DIR/mystery-shopper-judge-pinned.mjs" \
    --model "$JUDGE_MODEL" $JUDGE_THINKING_FLAG "$@" > "$out" 2>&1
}

# --- shared-number bookkeeping --------------------------------------------
# ThunderPhone provisions phone numbers itself (there is no purchase endpoint;
# numbers arrive from their own Twilio VOIP connection), so a 3-arm matrix
# rarely has 3 spare numbers. In shared-number mode the runner re-points one
# number at each arm's agent in turn and always restores the original agent on
# exit, including on Ctrl-C or an unexpected failure.
TP_ORIG_AGENT=""
if [ -n "$TP_SHARED" ]; then
  TP_ORIG_AGENT="$(tp_inbound "$TP_SHARED")"
  if [ -z "$TP_ORIG_AGENT" ]; then
    echo "THUNDERPHONE_SHARED_NUMBER=$TP_SHARED is not one of your ThunderPhone numbers" >&2
    exit 1
  fi
  echo "[mystery-shopper-tp] shared number $TP_SHARED (currently agent $TP_ORIG_AGENT, settle ${TP_SETTLE_SECONDS}s)"
  restore_shared_number() {
    local rc=$?
    if [ -n "$TP_ORIG_AGENT" ]; then
      if tp_repoint "$TP_SHARED" "$TP_ORIG_AGENT" >/dev/null 2>&1; then
        echo "[mystery-shopper-tp] restored $TP_SHARED -> agent $TP_ORIG_AGENT"
      else
        echo "[mystery-shopper-tp] WARNING: could not restore $TP_SHARED to agent $TP_ORIG_AGENT — fix in the dashboard" >&2
      fi
    fi
    return $rc
  }
  trap restore_shared_number EXIT
fi

# --- per-round execution ---------------------------------------------------

echo "[mystery-shopper-tp] running $ROUNDS round(s) x ${#TIER_NAMES[@]} tier(s)"

for r in $(seq 1 "$ROUNDS"); do
  for i in "${!TIER_NAMES[@]}"; do
    TIER="${TIER_NAMES[$i]}"
    TP_NUMBER="${TIER_NUMBERS[$i]}"
    TP_AGENT_ID="${TIER_AGENT_IDS[$i]}"
    PFX="$RUN_DIR/round-$r-$TIER"

    echo "=== round $r / tier $TIER ==="

    if [ -n "$TP_SHARED" ]; then
      echo "[mystery-shopper-tp] pointing $TP_SHARED at agent $TP_AGENT_ID ($TIER)"
      if ! GOT_AGENT="$(tp_repoint "$TP_SHARED" "$TP_AGENT_ID")"; then
        echo "[mystery-shopper-tp] ERROR: could not re-point $TP_SHARED — skipping round $r/$TIER" >&2
        continue
      fi
      if [ "$GOT_AGENT" != "$TP_AGENT_ID" ]; then
        echo "[mystery-shopper-tp] ERROR: re-point read back agent $GOT_AGENT, expected $TP_AGENT_ID — skipping" >&2
        continue
      fi
      # Routing may be eventually-consistent on their side, so give it a moment
      # before dialling. If it is in fact still stale, the transcript lookup is
      # keyed by agent id, so the round finds no call and fails loudly rather
      # than scoring the previous arm's audio.
      sleep "$TP_SETTLE_SECONDS"
    fi

    WINDOW_START=$(($(date +%s) * 1000))

    CALDESK_SID=$(place_shopper_call "$CALLDESK_NUMBER")
    TP_SID=$(place_shopper_call "$TP_NUMBER")

    FROM_NUMBER=$(tw "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Calls/$CALDESK_SID.json" \
      | python3 -c "import json,sys; print(json.load(sys.stdin).get('from'))")
    echo "[mystery-shopper-tp] round $r/$TIER caldesk=$CALDESK_SID thunderphone($TIER)=$TP_SID shopper-from=$FROM_NUMBER"

    wait_for_call "$CALDESK_SID" > /dev/null
    wait_for_call "$TP_SID" > /dev/null

    # WINDOW_START is in milliseconds (find_call_by_time_window wants ms);
    # resolve_business_sid works in epoch seconds.
    BIZ_SID=$(resolve_business_sid "$CALDESK_SID" "$(( WINDOW_START / 1000 ))")
    if [ -n "$BIZ_SID" ]; then
      echo "[mystery-shopper-tp] pulling Caldesk transcript (bizSid=$BIZ_SID)"
      fetch_caldesk_transcript "$BIZ_SID" "$PFX-caldesk.txt" || true
    else
      echo "[mystery-shopper-tp] WARNING: could not resolve Caldesk business SID"
      : > "$PFX-caldesk.txt"
    fi

    WINDOW_END=$(($(date +%s) * 1000))

    echo "[mystery-shopper-tp] pulling ThunderPhone ($TIER) transcript"
    if [ -n "$TP_AGENT_ID" ]; then
      pull_tp_transcript "$TP_AGENT_ID" "$FROM_NUMBER" "$WINDOW_START" "$WINDOW_END" "$PFX-thunderphone.txt" || : > "$PFX-thunderphone.txt"
    else
      echo "[mystery-shopper-tp] WARNING: no agent id for tier $TIER — skipping transcript"
      : > "$PFX-thunderphone.txt"
    fi

    CALDESK_REC=$(wait_for_recording "$CALDESK_SID") || CALDESK_REC=""
    TP_REC=$(wait_for_recording "$TP_SID") || TP_REC=""

    [ -n "$CALDESK_REC" ] && { python3 "$SCRIPT_DIR/analyze-call-ttfb.py" --recording "$CALDESK_REC" --json > "$PFX-caldesk-metrics.json" 2>/dev/null || true; }
    [ -n "$TP_REC" ] && { python3 "$SCRIPT_DIR/analyze-call-ttfb.py" --recording "$TP_REC" --json > "$PFX-thunderphone-metrics.json" 2>/dev/null || true; }

    [ -n "$BIZ_SID" ] && latency_lines "$BIZ_SID" > "$PFX-biz-latency.txt"

    if [ ! -s "$PFX-caldesk.txt" ]; then
      echo "[mystery-shopper-tp] ERROR: Caldesk transcript empty for round $r/$TIER" >&2
      continue
    fi
    if [ ! -s "$PFX-thunderphone.txt" ]; then
      echo "[mystery-shopper-tp] ERROR: ThunderPhone ($TIER) transcript empty for round $r/$TIER" >&2
      continue
    fi

    echo "[mystery-shopper-tp] running blind judge (round $r / $TIER)"
    run_judge "$PFX-verdict.txt" \
      --a "$PFX-caldesk.txt" --label-a "Calldesk" \
      --b "$PFX-thunderphone.txt" --label-b "ThunderPhone-$TIER" \
      --metrics-a "$PFX-caldesk-metrics.json" \
      --metrics-b "$PFX-thunderphone-metrics.json"

    WINNER=$(grep -E '^WINNER_SYSTEM:' "$PFX-verdict.txt" | tail -1 | awk '{print $2}' || true)
    echo "[mystery-shopper-tp] round $r/$TIER winner: ${WINNER:-n/a}"

    # Self-critique: runs regardless of who won, so a sweep still yields fixes.
    if [ "$SKIP_CRITIQUE" != "1" ] && [ -s "$PFX-caldesk.txt" ]; then
      echo "[mystery-shopper-tp] running Calldesk self-critique (round $r / $TIER)"
      run_judge "$PFX-critique.txt" \
        --critique "$PFX-caldesk.txt" --critique-label "Calldesk" \
        --metrics "$PFX-caldesk-metrics.json"
      FIXES=$(grep -E '^ACTIONABLE_FIXES:' "$PFX-critique.txt" | tail -1 | awk '{print $2}' || true)
      echo "[mystery-shopper-tp] round $r/$TIER critique fixes: ${FIXES:-n/a}"
    fi
  done
done

# --- Extra Intelligence head-to-head --------------------------------------
# The per-round A/B above pits Calldesk against each arm. That answers "did we
# beat Storm" but not "is Extra Intelligence worth +3c/min", because the two
# arms never meet. Judging them against each other on the same shopper intent
# costs one judge call per round and no additional phone call.
if [ "${#EI_PAIRS[@]}" -gt 0 ] && [ "${SKIP_EI_PAIR:-0}" != "1" ]; then
  echo
  echo "[mystery-shopper-tp] running Extra Intelligence head-to-heads"
  for r in $(seq 1 "$ROUNDS"); do
    for base in "${EI_PAIRS[@]}"; do
      on_f="$RUN_DIR/round-$r-$base-thunderphone.txt"
      off_f="$RUN_DIR/round-$r-$base-noei-thunderphone.txt"
      if [ ! -s "$on_f" ] || [ ! -s "$off_f" ]; then
        echo "[mystery-shopper-tp] SKIP EI head-to-head r$r $base (missing transcript)"
        continue
      fi
      run_judge "$RUN_DIR/round-$r-$base-eihead2head.txt" \
        --a "$on_f" --label-a "${base}-EI-on" \
        --b "$off_f" --label-b "${base}-EI-off"
      w=$(grep -E '^WINNER_SYSTEM:' "$RUN_DIR/round-$r-$base-eihead2head.txt" 2>/dev/null | tail -1 | awk '{print $2}' || true)
      echo "[mystery-shopper-tp] r$r $base EI head-to-head winner: ${w:-n/a}"
    done
  done
fi

# --- summary ---------------------------------------------------------------

echo
echo "=================================================================="
echo " MYSTERY-SHOPPER SUMMARY: Calldesk vs ThunderPhone"
echo " scenario=$SCENARIO  judge=$JUDGE_MODEL  thinking=${JUDGE_THINKING:-off}  rounds=$ROUNDS"
echo "=================================================================="
printf "%-5s %-8s %-20s %-16s %-16s %-8s\n" "round" "tier" "winner" "caldesk p50/p95" "thunder p50/p95" "fixes"
for r in $(seq 1 "$ROUNDS"); do
  for TIER in "${TIER_NAMES[@]}"; do
    PFX="$RUN_DIR/round-$r-$TIER"
    caldesk_lat=$(python3 -c "
import json
try:
    d=json.load(open('$PFX-caldesk-metrics.json'))
    l=d['response_latency_ms']
    print(f\"{l['median_ms']}/{l['p95_ms']}\" if l.get('n') else 'n/a')
except Exception:
    print('n/a')")
    tp_lat=$(python3 -c "
import json
try:
    d=json.load(open('$PFX-thunderphone-metrics.json'))
    l=d['response_latency_ms']
    print(f\"{l['median_ms']}/{l['p95_ms']}\" if l.get('n') else 'n/a')
except Exception:
    print('n/a')")
    winner=$(grep -E '^WINNER_SYSTEM:' "$PFX-verdict.txt" 2>/dev/null | tail -1 | awk '{print $2}' || true)
    fixes=$(grep -E '^ACTIONABLE_FIXES:' "$PFX-critique.txt" 2>/dev/null | tail -1 | awk '{print $2}' || true)
    printf "%-5s %-8s %-20s %-16s %-16s %-8s\n" \
      "$r" "$TIER" "${winner:-n/a}" "$caldesk_lat" "$tp_lat" "${fixes:-n/a}"
    if [ -s "$PFX-biz-latency.txt" ]; then
      echo "  -> Caldesk server latency:"
      sed 's/^/     /' "$PFX-biz-latency.txt"
    fi
  done
done

if [ "${#EI_PAIRS[@]}" -gt 0 ]; then
  echo
  echo "--- Extra Intelligence: direct head-to-head, same shopper intent ---"
  printf "%-5s %-8s %-16s %-16s %-10s\n" "round" "tier" "EI-on wins" "EI-off wins" "winner"
  for r in $(seq 1 "$ROUNDS"); do
    for base in "${EI_PAIRS[@]}"; do
      f="$RUN_DIR/round-$r-$base-eihead2head.txt"
      if [ ! -s "$f" ]; then
        printf "%-5s %-8s %-16s %-16s %-10s\n" "$r" "$base" "-" "-" "no data"
        continue
      fi
      w=$(grep -E '^WINNER_SYSTEM:' "$f" 2>/dev/null | tail -1 | awk '{print $2}' || true)
      on_c=0; off_c=0
      if [ "$w" = "${base}-EI-on" ]; then on_c=1; fi
      if [ "$w" = "${base}-EI-off" ]; then off_c=1; fi
      printf "%-5s %-8s %-16s %-16s %-10s\n" "$r" "$base" "$on_c" "$off_c" "${w:-n/a}"
    done
  done
  for base in "${EI_PAIRS[@]}"; do
    tot_on=0; tot_off=0
    for r in $(seq 1 "$ROUNDS"); do
      f="$RUN_DIR/round-$r-$base-eihead2head.txt"
      w=$(grep -E '^WINNER_SYSTEM:' "$f" 2>/dev/null | tail -1 | awk '{print $2}' || true)
      if [ "$w" = "${base}-EI-on" ]; then tot_on=$((tot_on + 1)); fi
      if [ "$w" = "${base}-EI-off" ]; then tot_off=$((tot_off + 1)); fi
    done
    echo "  $base: EI-on $tot_on  vs  EI-off $tot_off  (of $ROUNDS round(s))"
  done
fi

echo "=================================================================="
echo " reports: $RUN_DIR"
echo
echo " Per-round artefacts:"
echo "   *-caldesk.txt / *-thunderphone.txt   transcripts"
echo "   *-verdict.txt                        blind A/B judge  (grep WINNER_SYSTEM, JUDGE_MODEL)"
echo "   *-critique.txt                       self-critique     (section: What to fix)"
echo "   *-eihead2head.txt                    EI-on vs EI-off   (only for paired tiers)"

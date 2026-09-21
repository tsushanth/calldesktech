# Voice Agent Evaluation Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable, git-tracked evaluation system that places real phone calls against our voice agents, scores them, tracks results over time in Supabase, alerts on regressions via SMS, and reports through a new `/admin/eval` dashboard — runnable on-demand, on every deploy, and weekly.

**Architecture:** A JSON test-case registry drives a Python runner that places real shopper calls (reusing the `/place-test-call` mechanism and LLM-judge pattern already proven in `bench/lang_shopper_bench_*.md`), scores each call, writes results to two new Supabase tables, and sends an SMS alert on regression. A shell wrapper hooks the runner into deploys; a GitHub Actions cron hooks it into the weekly full sweep. A Next.js admin page reads the two tables to show history and trends.

**Tech Stack:** Python 3 (runner, matches existing `bench/*.py` scripts), Supabase Postgres (storage), Next.js/TypeScript (dashboard, matches existing `/admin/usage`), Twilio Messages API (SMS, matches existing Kokoro-failover alert), GitHub Actions (weekly cron, matches existing `outreach-discover.yml`), bash (deploy wrapper).

**Spec:** `docs/superpowers/specs/2026-09-21-eval-framework-design.md`

## Global Constraints

- Non-blocking: no trigger may stop or roll back a deploy. The runner's exit code is never checked by the deploy step in a way that halts it.
- Every test call must clean up after itself (clear phone routing, delete test agent, revoke temp API key) even on crash — no exceptions.
- Fast tier: no Retell calls, ever, by default. Full tier and any explicit `--vs-retell` on-demand run: Retell calls allowed.
- All new files are git-tracked; nothing evaluation-related lives only in `/tmp` or the session scratchpad.
- SMS notification reuses the existing `ALERT_SMS_TO`/`ALERT_SMS_FROM` Fly secrets on `call-loop-poc` and the same Twilio Messages API call shape already in `server.js`'s `markKokoroDown` function — do not introduce a second notification mechanism.
- Dashboard reuses the existing admin-email-allowlist gate (`requireAdminSession` from `src/lib/outreach/adminAuth.ts`), the same pattern as `/admin/usage`.

---

## Task 1: Supabase schema for eval runs and cases

**Files:**
- Create: `supabase/migrations/034_eval_framework.sql`

**Interfaces:**
- Produces: tables `calldesk_eval_runs` (columns: `id uuid`, `tier text`, `trigger text`, `vs_retell boolean`, `started_at timestamptz`, `finished_at timestamptz`, `status text`, `regression_count int`, `error_count int`) and `calldesk_eval_cases` (columns: `id uuid`, `run_id uuid` FK, `case_id text`, `template text`, `language text`, `status text`, `task_completion int`, `fluency int`, `latency_ms int`, `barge_in int`, `delta_from_prior numeric`, `regressed boolean`, `llm_notes text`, `transcript jsonb`, `retell_task_completion int`, `retell_fluency int`, `retell_transcript jsonb`, `created_at timestamptz`).

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS calldesk_eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier text NOT NULL CHECK (tier IN ('fast', 'full')),
  trigger text NOT NULL CHECK (trigger IN ('on-demand', 'on-deploy', 'weekly')),
  vs_retell boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'crashed')),
  regression_count int NOT NULL DEFAULT 0,
  error_count int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS calldesk_eval_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES calldesk_eval_runs(id) ON DELETE CASCADE,
  case_id text NOT NULL,
  template text NOT NULL,
  language text NOT NULL,
  status text NOT NULL CHECK (status IN ('scored', 'errored')),
  task_completion int,
  fluency int,
  latency_ms int,
  barge_in int,
  delta_from_prior numeric,
  regressed boolean NOT NULL DEFAULT false,
  llm_notes text,
  transcript jsonb,
  retell_task_completion int,
  retell_fluency int,
  retell_transcript jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eval_cases_run ON calldesk_eval_cases(run_id);
CREATE INDEX IF NOT EXISTS idx_eval_cases_case_id ON calldesk_eval_cases(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_runs_started ON calldesk_eval_runs(started_at DESC);

ALTER TABLE calldesk_eval_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_eval_cases ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply the migration**

Run: `cd /Users/sushanthtiruvaipati/Documents/github/calldesktech/bench && ./sq.sh "$(cat ../supabase/migrations/034_eval_framework.sql)"`
Expected: `[]` (no error) returned by the Supabase Management API.

- [ ] **Step 3: Verify the tables exist**

Run: `./sq.sh "select table_name from information_schema.tables where table_name in ('calldesk_eval_runs','calldesk_eval_cases')"`
Expected: both table names returned.

- [ ] **Step 4: Commit**

```bash
cd /Users/sushanthtiruvaipati/Documents/github/calldesktech
git add supabase/migrations/034_eval_framework.sql
git commit -m "Add eval framework tables: calldesk_eval_runs, calldesk_eval_cases

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Test case registry

**Files:**
- Create: `bench/eval-cases.json`

**Interfaces:**
- Produces: a JSON array the runner (Task 3) reads. Each entry shape:
  `{ "id": string, "template": string, "language": string, "persona": string, "tier": "fast" | "full" }`

- [ ] **Step 1: Write the registry file**

Seed with the cases we already have real, verified personas for from today's work (Spanish,
French, Portuguese-BR, English), covering the `receptionist` template. `fast` tier gets 3 cases
(one language each, rotating so all languages get exercised across runs without ballooning cost);
`full` tier gets all of them plus room to grow.

```json
[
  {
    "id": "receptionist-en-pricing",
    "template": "receptionist",
    "language": "en",
    "persona": "You are a customer calling to ask about pricing for their services and whether they can book an appointment this week. Speak naturally, casually.",
    "tier": "fast"
  },
  {
    "id": "receptionist-es-pricing",
    "template": "receptionist",
    "language": "es",
    "persona": "Eres un cliente que llama para preguntar sobre precios y si pueden agendar una cita esta semana. Habla solo en espanol, natural y coloquial.",
    "tier": "fast"
  },
  {
    "id": "receptionist-fr-pricing",
    "template": "receptionist",
    "language": "fr",
    "persona": "Vous etes un client qui appelle pour demander les tarifs et si un rendez-vous est possible cette semaine. Parlez uniquement en francais, de facon naturelle.",
    "tier": "fast"
  },
  {
    "id": "receptionist-ptbr-pricing",
    "template": "receptionist",
    "language": "pt-BR",
    "persona": "Voce e um cliente ligando para perguntar sobre precos e se e possivel marcar um horario esta semana. Fale somente em portugues brasileiro, de forma natural.",
    "tier": "full"
  }
]
```

- [ ] **Step 2: Validate it's well-formed JSON**

Run: `python3 -c "import json; d = json.load(open('bench/eval-cases.json')); print(len(d), 'cases,', sum(1 for c in d if c['tier']=='fast'), 'fast')"`
Expected: `4 cases, 3 fast`

- [ ] **Step 3: Commit**

```bash
git add bench/eval-cases.json
git commit -m "Add eval framework test case registry, seeded from today's language bench personas

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Runner — call placement and cleanup (no scoring yet)

**Files:**
- Create: `bench/run_eval.py`
- Modify: (none — this task only adds the file; scoring/storage land in later tasks)

**Interfaces:**
- Consumes: `bench/eval-cases.json` (Task 2 format), `bench/sq.sh` (existing, takes a SQL string as `argv[1]`, returns JSON on stdout), env vars `TEST_CALL_SECRET`/`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` (read from `/Users/sushanthtiruvaipati/Documents/github/realtime-tts/call-loop-poc/.env`), env var `RETELL_API_KEY` (from `calldesktech/.env`).
- Produces: function `place_and_wait_call(case: dict, phone_number_id: str = "34d13af7-e4ba-4312-a0aa-bd8d356de97f") -> dict` returning `{"call_sid": str, "status": str, "duration_s": int, "transcript": list[dict]}` for our side. This is what Task 4 (scoring) and Task 5 (Retell leg) build on.

This task establishes the call-placement + cleanup skeleton, independently testable by placing one
real call end to end and confirming cleanup happens, before scoring logic is added on top.

- [ ] **Step 1: Write the runner skeleton with call placement and guaranteed cleanup**

```python
#!/usr/bin/env python3
"""Voice agent evaluation runner. See docs/superpowers/specs/2026-09-21-eval-framework-design.md."""
import argparse, json, os, subprocess, time, hashlib, secrets as _secrets
import urllib.request

D = os.path.dirname(os.path.abspath(__file__))
CALLDESKTECH = os.path.dirname(D)
CALL_LOOP_POC = os.path.join(os.path.dirname(CALLDESKTECH), 'realtime-tts', 'call-loop-poc')
PHONE_NUMBER_ID = '34d13af7-e4ba-4312-a0aa-bd8d356de97f'
OUR_NUMBER = '+12245061194'


def envfile(path):
    e = {}
    for line in open(path):
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            e[k.strip()] = v.strip().strip('"')
    return e


def sq(query):
    out = subprocess.run([os.path.join(D, 'sq.sh'), query], capture_output=True, text=True).stdout
    return json.loads(out or '[]')


def api(url, method='GET', headers=None, body=None):
    req = urllib.request.Request(url, method=method, headers=headers or {},
                                  data=json.dumps(body).encode() if body is not None else None)
    if body is not None:
        req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())


def mint_temp_key(tenant_id, name):
    key = 'cdk_live_' + _secrets.token_hex(24)
    key_hash = hashlib.sha256(key.encode()).hexdigest()
    sq(f"insert into calldesk_api_keys(tenant_id,name,key_prefix,key_hash) "
       f"values ('{tenant_id}','{name}','{key[:16]}','{key_hash}')")
    return key


def cleanup(agent_id=None, key_name=None):
    sq(f"update calldesk_phone_numbers set inbound_agent_version_id=NULL where id='{PHONE_NUMBER_ID}'")
    if agent_id:
        sq(f"delete from calldesk_agents where id='{agent_id}'")
    if key_name:
        sq(f"update calldesk_api_keys set revoked_at=now() where name='{key_name}'")


def place_and_wait_call(case, calldesktech_env):
    """Creates a fresh agent for this case's template+language, routes our number to it,
    places a real shopper call, waits for completion, returns the transcript. Always cleans up,
    even on error (that's the whole point of the try/finally here)."""
    tenants = sq("select id from calldesk_tenants order by created_at limit 1")
    tenant_id = tenants[0]['id']
    key_name = f"eval-{case['id']}-{int(time.time())}"
    key = mint_temp_key(tenant_id, key_name)
    agent_id = None
    try:
        created = api(
            f"https://calldesk.tech/api/tenants/{tenant_id}/agents/from-template",
            method='POST',
            headers={'Authorization': f'Bearer {key}'},
            body={'templateId': case['template'], 'name': f"Eval-{case['id']}",
                  'voiceEngine': 'poc', 'language': case['language']},
        )
        agent_id = created['agentId']
        version_id = created['versionId']
        sq(f"update calldesk_phone_numbers set inbound_agent_version_id='{version_id}' "
           f"where id='{PHONE_NUMBER_ID}'")

        secret = envfile(os.path.join(CALL_LOOP_POC, '.env'))['TEST_CALL_SECRET']
        placed = api(
            'https://call-loop-poc.fly.dev/place-test-call',
            method='POST',
            headers={'Authorization': f'Bearer {secret}'},
            body={'toNumber': OUR_NUMBER, 'shopper': True, 'persona': case['persona'],
                  'language': case['language']},
        )
        call_sid = placed['sid']

        tw = envfile(os.path.join(CALL_LOOP_POC, '.env'))
        import base64
        auth = base64.b64encode(f"{tw['TWILIO_ACCOUNT_SID']}:{tw['TWILIO_AUTH_TOKEN']}".encode()).decode()
        status = None
        for _ in range(26):
            r = api(f"https://api.twilio.com/2010-04-01/Accounts/{tw['TWILIO_ACCOUNT_SID']}/Calls/{call_sid}.json",
                     headers={'Authorization': f'Basic {auth}'})
            status = r.get('status')
            if status in ('completed', 'failed', 'busy', 'no-answer'):
                break
            time.sleep(10)

        duration_s = 0
        transcript = []
        if status == 'completed':
            time.sleep(3)  # let the call-log write land
            rows = sq(f"select duration_seconds, transcript from calldesk_call_logs "
                      f"where retell_call_id='{call_sid}'")
            if rows:
                duration_s = rows[0].get('duration_seconds') or 0
                transcript = rows[0].get('transcript') or []

        return {'call_sid': call_sid, 'status': status or 'unknown',
                'duration_s': duration_s, 'transcript': transcript}
    finally:
        cleanup(agent_id, key_name)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--tier', choices=['fast', 'full'], default='fast')
    parser.add_argument('--vs-retell', action='store_true')
    parser.add_argument('--trigger', choices=['on-demand', 'on-deploy', 'weekly'], default='on-demand')
    args = parser.parse_args()

    cases = json.load(open(os.path.join(D, 'eval-cases.json')))
    selected = [c for c in cases if c['tier'] == args.tier or args.tier == 'full']
    print(f"Running {len(selected)} case(s), tier={args.tier}")
    for case in selected:
        result = place_and_wait_call(case, None)
        print(f"{case['id']}: status={result['status']} duration={result['duration_s']}s "
              f"turns={len(result['transcript'])}")
```

- [ ] **Step 2: Run it manually against one case to prove the skeleton works end to end**

Run: `cd /Users/sushanthtiruvaipati/Documents/github/calldesktech/bench && python3 -c "
import json, run_eval
cases = json.load(open('eval-cases.json'))
r = run_eval.place_and_wait_call(cases[0], None)
print(r['status'], r['duration_s'], len(r['transcript']))
"`
Expected: `completed <nonzero> <nonzero turn count>` — a real call actually happened and produced a
transcript. This costs real money (~$0.07-0.10, one real call) — that's expected and acceptable per
the spec's fast-tier budget.

- [ ] **Step 3: Verify cleanup happened**

Run: `./sq.sh "select inbound_agent_version_id from calldesk_phone_numbers where id='34d13af7-e4ba-4312-a0aa-bd8d356de97f'"`
Expected: `[{"inbound_agent_version_id": null}]`

- [ ] **Step 4: Commit**

```bash
git add bench/run_eval.py
git commit -m "Eval runner: real call placement with guaranteed cleanup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Runner — LLM judge scoring and baseline diff

**Files:**
- Modify: `bench/run_eval.py`

**Interfaces:**
- Consumes: `place_and_wait_call` result shape from Task 3, `ANTHROPIC_API_KEY` (from
  `call-loop-poc/.env`).
- Produces: function `judge_transcript(transcript: list[dict], prior: dict | None) -> dict`
  returning `{"task_completion": int, "fluency": int, "latency_ms": int, "barge_in": int | None,
  "llm_notes": str, "delta_from_prior": float | None, "regressed": bool}`. `latency_ms` is computed
  from the transcript's turn count and `duration_s` as a proxy (`duration_s * 1000 / max(1,
  len(transcript))`), not per-turn instrumentation — good enough for a regression signal, not a
  precise latency measurement. `barge_in` is `None` unless the transcript shows evidence of an
  interruption (not forced in this framework — see spec, barge-in scoring is opportunistic).

- [ ] **Step 1: Add the judge function**

```python
def judge_transcript(transcript, duration_s, prior=None):
    """Scores a transcript 1-5 on task_completion and fluency via LLM judge, computes a
    duration-based latency proxy, and — if `prior` (a previous case's stored scores) is given —
    computes both a numeric delta and asks the same judge call for a holistic verdict."""
    ak = envfile(os.path.join(CALL_LOOP_POC, '.env'))['ANTHROPIC_API_KEY']
    convo = "\n".join(f"{t['role']}: {t['content']}" for t in transcript)
    prior_block = ""
    if prior:
        prior_convo = "\n".join(f"{t['role']}: {t['content']}" for t in (prior.get('transcript') or []))
        prior_block = (f"\n\nPRIOR RUN'S TRANSCRIPT (for comparison — was today's run better, worse, "
                        f"or the same, and why):\n{prior_convo}\n\nPrior scores: "
                        f"task_completion={prior.get('task_completion')}, fluency={prior.get('fluency')}")
    prompt = (
        "Score this AI phone receptionist transcript 1-5 on task_completion (did the caller's "
        "actual request get resolved or meaningfully progressed) and fluency (natural, in-language, "
        "no glitches). Be critical and specific."
        f"\n\nTRANSCRIPT:\n{convo}{prior_block}\n\n"
        "Respond with JSON only: "
        '{"task_completion": n, "fluency": n, "notes": "...", "verdict_vs_prior": "better|worse|same|n/a"}'
    )
    req = urllib.request.Request(
        'https://api.anthropic.com/v1/messages',
        headers={'x-api-key': ak, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
        data=json.dumps({'model': 'claude-sonnet-4-5-20250929', 'max_tokens': 400,
                          'messages': [{'role': 'user', 'content': prompt}]}).encode(),
    )
    with urllib.request.urlopen(req) as r:
        body = json.loads(r.read().decode())
    text = body['content'][0]['text']
    text = text[text.find('{'):text.rfind('}') + 1]
    scored = json.loads(text)

    latency_ms = int(duration_s * 1000 / max(1, len(transcript)))
    delta = None
    regressed = False
    if prior and prior.get('task_completion') is not None:
        delta = scored['task_completion'] - prior['task_completion']
        regressed = delta < -1 or scored['verdict_vs_prior'] == 'worse'

    return {
        'task_completion': scored['task_completion'],
        'fluency': scored['fluency'],
        'latency_ms': latency_ms,
        'barge_in': None,
        'llm_notes': scored.get('notes', ''),
        'delta_from_prior': delta,
        'regressed': regressed,
    }


def get_prior_case(case_id):
    rows = sq(f"select task_completion, fluency, transcript from calldesk_eval_cases "
              f"where case_id='{case_id}' and status='scored' order by created_at desc limit 1")
    return rows[0] if rows else None
```

- [ ] **Step 2: Write a unit test for the scoring shape (no real call, uses a canned transcript)**

Create `bench/test_run_eval.py`:

```python
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import run_eval

CANNED_TRANSCRIPT = [
    {"role": "user", "content": "Hi, what are your prices?"},
    {"role": "assistant", "content": "I don't have that info, but I can have someone call you back with pricing — what's the best number?"},
    {"role": "user", "content": "555-0100"},
    {"role": "assistant", "content": "Got it, someone will call you back with pricing shortly."},
]


def test_judge_transcript_no_prior():
    result = run_eval.judge_transcript(CANNED_TRANSCRIPT, duration_s=42)
    assert 1 <= result['task_completion'] <= 5
    assert 1 <= result['fluency'] <= 5
    assert result['latency_ms'] > 0
    assert result['delta_from_prior'] is None
    assert result['regressed'] is False


def test_judge_transcript_with_worse_prior():
    prior = {'task_completion': 5, 'fluency': 5, 'transcript': CANNED_TRANSCRIPT}
    # Force a clearly worse transcript to check the regression flag fires.
    worse = [{"role": "user", "content": "Hi, what are your prices?"},
              {"role": "assistant", "content": "I don't know, goodbye."}]
    result = run_eval.judge_transcript(worse, duration_s=10, prior=prior)
    assert result['delta_from_prior'] is not None
    assert result['task_completion'] <= 3
```

- [ ] **Step 3: Run the test (calls the real Anthropic API — no phone call, so this is cheap, a few cents)**

Run: `cd /Users/sushanthtiruvaipati/Documents/github/calldesktech/bench && python3 -m pytest test_run_eval.py -v`
Expected: both tests PASS. If `test_judge_transcript_with_worse_prior` fails on the regression
assertion, the judge prompt needs tightening — iterate on the prompt text in Step 1 until it
reliably flags an obviously worse transcript, then re-run.

- [ ] **Step 4: Commit**

```bash
git add bench/run_eval.py bench/test_run_eval.py
git commit -m "Eval runner: LLM judge scoring with baseline-diff regression signal

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Runner — storage, notification, and full CLI wiring

**Files:**
- Modify: `bench/run_eval.py`

**Interfaces:**
- Consumes: `place_and_wait_call` (Task 3), `judge_transcript`/`get_prior_case` (Task 4), Twilio
  Messages API (same shape as `server.js`'s `markKokoroDown` — `POST
  https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json` with `To`/`From`/`Body` form
  params, Basic auth).
- Produces: the finished `__main__` block — this is the task that makes `run_eval.py --tier fast`
  a complete, storage-backed, alerting run. Nothing downstream depends on new exports from this
  task; it's the integration point.

- [ ] **Step 1: Replace the `__main__` block with the full run loop**

```python
def send_sms(body):
    tw = envfile(os.path.join(CALL_LOOP_POC, '.env'))
    to = tw.get('ALERT_SMS_TO')
    frm = tw.get('ALERT_SMS_FROM')
    if not to or not frm:
        print(f"[eval] SMS alert skipped (ALERT_SMS_TO/FROM not set): {body}")
        return
    import base64
    sid, tok = tw['TWILIO_ACCOUNT_SID'], tw['TWILIO_AUTH_TOKEN']
    auth = base64.b64encode(f"{sid}:{tok}".encode()).decode()
    data = f"To={to}&From={frm}&Body={urllib.parse.quote(body)}".encode()
    req = urllib.request.Request(
        f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
        headers={'Authorization': f'Basic {auth}', 'Content-Type': 'application/x-www-form-urlencoded'},
        data=data,
    )
    with urllib.request.urlopen(req) as r:
        print(f"[eval] alert SMS -> {r.status}")


def run(tier, vs_retell, trigger):
    run_row = sq(
        f"insert into calldesk_eval_runs(tier,trigger,vs_retell) "
        f"values ('{tier}','{trigger}',{'true' if vs_retell else 'false'}) returning id"
    )
    run_id = run_row[0]['id']
    cases = json.load(open(os.path.join(D, 'eval-cases.json')))
    selected = [c for c in cases if tier == 'full' or c['tier'] == 'fast']

    regression_count = 0
    error_count = 0
    try:
        for case in selected:
            try:
                result = place_and_wait_call(case, None)
            except Exception as e:
                print(f"[eval] {case['id']} errored: {e}")
                error_count += 1
                sq(f"insert into calldesk_eval_cases(run_id,case_id,template,language,status) "
                   f"values ('{run_id}','{case['id']}','{case['template']}','{case['language']}','errored')")
                continue

            if result['status'] != 'completed':
                error_count += 1
                sq(f"insert into calldesk_eval_cases(run_id,case_id,template,language,status) "
                   f"values ('{run_id}','{case['id']}','{case['template']}','{case['language']}','errored')")
                continue

            prior = get_prior_case(case['id'])
            scored = judge_transcript(result['transcript'], result['duration_s'], prior)
            if scored['regressed']:
                regression_count += 1

            transcript_json = json.dumps(result['transcript']).replace("'", "''")
            notes_escaped = scored['llm_notes'].replace("'", "''")
            sq(
                f"insert into calldesk_eval_cases"
                f"(run_id,case_id,template,language,status,task_completion,fluency,latency_ms,"
                f"delta_from_prior,regressed,llm_notes,transcript) values "
                f"('{run_id}','{case['id']}','{case['template']}','{case['language']}','scored',"
                f"{scored['task_completion']},{scored['fluency']},{scored['latency_ms']},"
                f"{scored['delta_from_prior'] if scored['delta_from_prior'] is not None else 'NULL'},"
                f"{'true' if scored['regressed'] else 'false'},'{notes_escaped}','{transcript_json}')"
            )
            print(f"{case['id']}: task_completion={scored['task_completion']} "
                  f"fluency={scored['fluency']} regressed={scored['regressed']}")

        status = 'ok'
    except Exception:
        status = 'crashed'
        raise
    finally:
        sq(f"update calldesk_eval_runs set finished_at=now(), status='{status}', "
           f"regression_count={regression_count}, error_count={error_count} where id='{run_id}'")

        if status == 'crashed':
            send_sms(f"CallDesk eval: {tier} run after {trigger} did not complete. Check /admin/eval.")
        elif regression_count > 0:
            send_sms(f"CallDesk eval: {regression_count} regression(s) in {tier} run. "
                      f"See https://calldesk.tech/admin/eval?run={run_id}")
        elif trigger == 'weekly':
            send_sms(f"CallDesk eval: weekly run complete, no regressions ({len(selected)} cases).")

    return run_id


if __name__ == '__main__':
    import urllib.parse
    parser = argparse.ArgumentParser()
    parser.add_argument('--tier', choices=['fast', 'full'], default='fast')
    parser.add_argument('--vs-retell', action='store_true')
    parser.add_argument('--trigger', choices=['on-demand', 'on-deploy', 'weekly'], default='on-demand')
    args = parser.parse_args()
    run(args.tier, args.vs_retell, args.trigger)
```

(Note: `--vs-retell` is accepted here but the Retell leg itself is Task 6 — until that task lands,
passing the flag has no additional effect, which is correct sequencing: this task must work
standalone first.)

- [ ] **Step 2: Run a real fast-tier run end to end**

Run: `cd /Users/sushanthtiruvaipati/Documents/github/calldesktech/bench && python3 run_eval.py --tier fast --trigger on-demand`
Expected: 3 lines of per-case output, then the run completing. This places 3 real calls (~$0.20-0.30
total, matching the spec's fast-tier budget) — expected cost, not a bug.

- [ ] **Step 3: Verify storage**

Run: `./sq.sh "select tier, trigger, status, regression_count, error_count from calldesk_eval_runs order by started_at desc limit 1"`
Expected: one row, `status: "ok"`.

Run: `./sq.sh "select case_id, status, task_completion, fluency from calldesk_eval_cases order by created_at desc limit 3"`
Expected: 3 rows, `status: "scored"` (or `"errored"` if a call genuinely failed — check the printed
output from Step 2 to see which).

- [ ] **Step 4: Run it again to prove the baseline-diff path works (second run has a prior to compare against)**

Run: `python3 run_eval.py --tier fast --trigger on-demand`
Expected: output includes `regressed=True` or `regressed=False` per case (not silently `None` /
missing), proving `get_prior_case` found the first run's rows.

- [ ] **Step 5: Commit**

```bash
git add bench/run_eval.py
git commit -m "Eval runner: storage, SMS alerting, full CLI — fast tier working end to end

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Runner — Retell comparison leg (`--vs-retell`)

**Files:**
- Modify: `bench/run_eval.py`

**Interfaces:**
- Consumes: `RETELL_API_KEY` (from `calldesktech/.env`), the from-template API's `voiceEngine:
  "retell"` path (already used in today's manual A/B tests), `retellVoiceFor`/`assignPhoneNumberToAgent`
  logic already in `src/lib/retell.ts` (reimplemented in Python here since the runner is Python —
  match its `inbound_agents` PATCH shape exactly, not the deprecated `inbound_agent_id` field flagged
  in Retell's deprecation emails).
- Produces: extends `place_and_wait_call` with an optional Retell leg; extends the storage insert in
  Task 5 to populate `retell_task_completion`, `retell_fluency`, `retell_transcript` when
  `--vs-retell` is set.

- [ ] **Step 1: Add the Retell call-placement function**

```python
RETELL_NUMBER = '+19786454307'


def place_and_wait_retell_call(case, calldesktech_env):
    """Creates a Retell agent for this case's template+language (via our own from-template API
    with voiceEngine='retell'), publishes it, routes Retell's test number to it with the current
    (non-deprecated) inbound_agents field shape, places a shopper call, waits, returns the
    transcript pulled straight from Retell's own API. Always cleans up."""
    rk = calldesktech_env['RETELL_API_KEY']
    tenants = sq("select id from calldesk_tenants order by created_at limit 1")
    tenant_id = tenants[0]['id']
    key_name = f"eval-retell-{case['id']}-{int(time.time())}"
    key = mint_temp_key(tenant_id, key_name)
    agent_id = None
    retell_agent_id = None
    try:
        created = api(
            f"https://calldesk.tech/api/tenants/{tenant_id}/agents/from-template",
            method='POST', headers={'Authorization': f'Bearer {key}'},
            body={'templateId': case['template'], 'name': f"EvalRetell-{case['id']}",
                  'voiceEngine': 'retell', 'language': case['language']},
        )
        agent_id = created['agentId']
        retell_agent_id = created['retellAgentId']

        publish = api(f"https://api.retellai.com/publish-agent/{retell_agent_id}", method='POST',
                       headers={'Authorization': f'Bearer {rk}'})
        version = publish.get('version', 0)
        api(f"https://api.retellai.com/update-phone-number/%2B19786454307", method='PATCH',
            headers={'Authorization': f'Bearer {rk}'},
            body={'inbound_agents': [{'agent_id': retell_agent_id, 'agent_version': version, 'weight': 1}]})

        secret = envfile(os.path.join(CALL_LOOP_POC, '.env'))['TEST_CALL_SECRET']
        placed = api('https://call-loop-poc.fly.dev/place-test-call', method='POST',
                      headers={'Authorization': f'Bearer {secret}'},
                      body={'toNumber': RETELL_NUMBER, 'shopper': True, 'persona': case['persona'],
                            'language': case['language']})
        call_sid = placed['sid']

        tw = envfile(os.path.join(CALL_LOOP_POC, '.env'))
        import base64
        auth = base64.b64encode(f"{tw['TWILIO_ACCOUNT_SID']}:{tw['TWILIO_AUTH_TOKEN']}".encode()).decode()
        for _ in range(26):
            r = api(f"https://api.twilio.com/2010-04-01/Accounts/{tw['TWILIO_ACCOUNT_SID']}/Calls/{call_sid}.json",
                     headers={'Authorization': f'Basic {auth}'})
            if r.get('status') in ('completed', 'failed', 'busy', 'no-answer'):
                break
            time.sleep(10)

        calls = api('https://api.retellai.com/v2/list-calls', method='POST',
                     headers={'Authorization': f'Bearer {rk}'},
                     body={'filter_criteria': {'agent_id': [retell_agent_id]}, 'limit': 1,
                           'sort_order': 'descending'})
        if not calls:
            return None
        detail = api(f"https://api.retellai.com/v2/get-call/{calls[0]['call_id']}",
                      headers={'Authorization': f'Bearer {rk}'})
        raw = detail.get('transcript', '')
        transcript = [{'role': 'assistant' if line.startswith('Agent:') else 'user',
                        'content': line.split(':', 1)[1].strip()}
                       for line in raw.split('\n') if ':' in line]
        return {'transcript': transcript, 'duration_s': (detail.get('duration_ms') or 0) / 1000}
    finally:
        try:
            api("https://api.retellai.com/update-phone-number/%2B19786454307", method='PATCH',
                headers={'Authorization': f'Bearer {rk}'}, body={'inbound_agents': []})
        except Exception:
            pass
        if agent_id:
            sq(f"delete from calldesk_agents where id='{agent_id}'")
        if retell_agent_id:
            try:
                api(f"https://api.retellai.com/delete-agent/{retell_agent_id}", method='DELETE',
                    headers={'Authorization': f'Bearer {rk}'})
            except Exception:
                pass
        sq(f"update calldesk_api_keys set revoked_at=now() where name='{key_name}'")
```

Note: `urllib.request` doesn't support `DELETE` with a body-less request out of the box in the
`api()` helper as written — verify `api()`'s `Request(..., method=method)` handles `DELETE`
correctly (it does, since `method` is passed straight to `urllib.request.Request`); no change
needed to `api()`.

- [ ] **Step 2: Wire it into `run()` behind the `--vs-retell` flag**

In `run()` from Task 5, after computing `scored` for the main (ours) leg, add:

```python
            retell_scored_sql = ""
            if vs_retell:
                try:
                    retell_result = place_and_wait_retell_call(case, envfile(os.path.join(CALLDESKTECH, '.env')))
                    if retell_result:
                        retell_judged = judge_transcript(retell_result['transcript'], retell_result['duration_s'])
                        retell_transcript_json = json.dumps(retell_result['transcript']).replace("'", "''")
                        retell_scored_sql = (
                            f",retell_task_completion={retell_judged['task_completion']},"
                            f"retell_fluency={retell_judged['fluency']},"
                            f"retell_transcript='{retell_transcript_json}'"
                        )
                except Exception as e:
                    print(f"[eval] retell leg for {case['id']} failed (non-fatal, per spec): {e}")
```

Then append `retell_scored_sql` into the `INSERT INTO calldesk_eval_cases` statement's column/value
lists from Task 5 (add `retell_task_completion,retell_fluency,retell_transcript` as trailing columns
whose values come from `retell_scored_sql`, or simpler: build the insert as an f-string with
`{retell_scored_sql}` appended right before the closing paren of the VALUES clause — either way, a
failed or skipped Retell leg must never affect whether the main insert happens, matching the spec's
"Retell-side issues... no special handling, no retry logic" rule).

- [ ] **Step 3: Run a real `--vs-retell` on-demand test with one case**

Temporarily point at a single-case tier for this test only:
Run: `cd /Users/sushanthtiruvaipati/Documents/github/calldesktech/bench && python3 -c "
import run_eval
run_eval.run('fast', True, 'on-demand')
"`
Expected: output shows the normal per-case line, plus no crash from the Retell leg. This places up
to 6 real calls (3 fast-tier cases × ours + Retell) — expected cost for this manual verification.

- [ ] **Step 4: Verify Retell columns populated and Retell-side cleanup happened**

Run: `./sq.sh "select case_id, retell_task_completion, retell_fluency from calldesk_eval_cases where run_id=(select id from calldesk_eval_runs order by started_at desc limit 1)"`
Expected: `retell_task_completion`/`retell_fluency` non-null for at least the cases where the Retell
leg succeeded.

Run (needs `RETELL_API_KEY` from calldesktech/.env in shell env):
`curl -s "https://api.retellai.com/get-phone-number/%2B19786454307" -H "Authorization: Bearer $RETELL_API_KEY" | python3 -c "import sys,json;print(json.load(sys.stdin).get('inbound_agents'))"`
Expected: `[]` or `None` — Retell's number is not left routed to a test agent.

- [ ] **Step 5: Commit**

```bash
git add bench/run_eval.py
git commit -m "Eval runner: optional --vs-retell comparison leg for full/on-demand runs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Deploy wrapper script

**Files:**
- Create: `bench/deploy-and-test.sh`

**Interfaces:**
- Consumes: `bench/run_eval.py` (Task 5/6), `fly` CLI (already used throughout this session).
- Produces: an executable script, the new standard way to deploy either app when this framework
  should run.

- [ ] **Step 1: Write the script**

```bash
#!/bin/bash
# Deploys an app, waits for it to report healthy, then runs the fast-tier eval.
# Non-blocking by design: the eval step's exit code never affects this script's own exit code
# after the deploy — a bad eval run is reported (dashboard + SMS), never rolled back automatically.
#
# Usage: bench/deploy-and-test.sh <fly-app-name>
set -e
APP="$1"
if [ -z "$APP" ]; then
  echo "Usage: $0 <fly-app-name>" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
echo "=== Deploying $APP ==="
fly deploy --app "$APP"

echo "=== Waiting for $APP to report healthy ==="
for i in $(seq 1 12); do
  STATE=$(fly status --app "$APP" 2>&1 | grep -m1 started || true)
  [ -n "$STATE" ] && break
  sleep 10
done

echo "=== Running fast-tier eval (non-blocking — deploy already succeeded above) ==="
cd bench
python3 run_eval.py --tier fast --trigger on-deploy || echo "[deploy-and-test] eval run reported an issue — see /admin/eval (deploy itself already succeeded, not affected)"

echo "=== Done ==="
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x bench/deploy-and-test.sh`

- [ ] **Step 3: Verify the deploy step's success is independent of the eval step**

Run: `cd bench && bash -c 'set -e; cd ..; fly deploy --app calldesk-tech; echo "deploy step exit: $?"; false || echo "simulated eval failure did not stop this line"'`
Expected: both echo lines print — confirms a `set -e` script still reaches the post-eval line even
when a command fails, because the failing command is explicitly `||`-guarded in the real script
(Step 1's `|| echo ...` on the `run_eval.py` line is what makes this safe under `set -e`).

- [ ] **Step 4: Run it for real once against `calldesk-tech`**

Run: `./deploy-and-test.sh calldesk-tech` (from `bench/`, or `bench/deploy-and-test.sh calldesk-tech`
from the repo root)
Expected: deploy succeeds, health check passes, fast-tier eval runs (3 more real calls — this is the
same fast-tier cost as Task 5's manual run, now happening automatically after a real deploy).

- [ ] **Step 5: Commit**

```bash
git add bench/deploy-and-test.sh
git commit -m "Add deploy-and-test.sh: wraps fly deploy with a non-blocking fast-tier eval run

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Weekly GitHub Actions cron

**Files:**
- Create: `.github/workflows/eval-weekly.yml`

**Interfaces:**
- Consumes: `bench/run_eval.py` (Task 6, `--tier full --vs-retell`). Needs the same secrets the
  runner reads from `.env` files locally — since GitHub Actions has no access to local `.env` files,
  this task must also surface which repo secrets need to be set, matching the pattern in
  `outreach-discover.yml`'s header comment.
- Produces: a scheduled workflow; no other task depends on this one.

- [ ] **Step 1: Write the workflow**

```yaml
name: Voice agent eval (weekly, full tier vs Retell)

# Runs the full evaluation tier with a real Retell comparison, weekly, against whatever is
# currently in production (no deploy step — see bench/deploy-and-test.sh for the on-deploy path).
#
# Required repo secrets (the runner reads these directly instead of the local .env files it uses
# when run by hand — see bench/run_eval.py's envfile() calls, which this workflow bypasses by
# exporting the same variable names into the environment first):
#   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TEST_CALL_SECRET, RETELL_API_KEY,
#   ANTHROPIC_API_KEY, ALERT_SMS_TO, ALERT_SMS_FROM, SUPABASE_MANAGEMENT_TOKEN

on:
  schedule:
    - cron: '0 14 * * 1' # weekly, Monday 14:00 UTC
  workflow_dispatch: {}

jobs:
  eval:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - name: Run full-tier eval vs Retell
        env:
          TWILIO_ACCOUNT_SID: ${{ secrets.TWILIO_ACCOUNT_SID }}
          TWILIO_AUTH_TOKEN: ${{ secrets.TWILIO_AUTH_TOKEN }}
          TEST_CALL_SECRET: ${{ secrets.TEST_CALL_SECRET }}
          RETELL_API_KEY: ${{ secrets.RETELL_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          ALERT_SMS_TO: ${{ secrets.ALERT_SMS_TO }}
          ALERT_SMS_FROM: ${{ secrets.ALERT_SMS_FROM }}
          SUPABASE_MANAGEMENT_TOKEN: ${{ secrets.SUPABASE_MANAGEMENT_TOKEN }}
        run: |
          cd bench
          python3 run_eval.py --tier full --vs-retell --trigger weekly
```

Note: `run_eval.py`'s `envfile()` helper reads from local `.env` files, which don't exist in the
Actions runner. `sq.sh` also reads a macOS-Keychain-cached Supabase CLI token, which doesn't exist
there either. This workflow, as scaffolded, will not run correctly until `run_eval.py`'s env-reading
is made to prefer `os.environ` over `envfile()` when the variable is already set, and `sq.sh` is
made to accept `SUPABASE_MANAGEMENT_TOKEN` from the environment directly when the Keychain lookup
fails. That's real follow-up work — see Step 2.

- [ ] **Step 2: Make `envfile()`-reading and `sq.sh` environment-aware**

In `bench/run_eval.py`, change `envfile(path)` to check `os.environ` first:

```python
def envfile(path):
    e = {}
    for line in open(path):
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            e[k.strip()] = v.strip().strip('"')
    for k in list(e.keys()):
        if k in os.environ:
            e[k] = os.environ[k]
    return e
```

This means: on a real developer machine, the existing `.env` files still work unchanged (the loop
only overrides keys that are *also* set in the real environment, which normally none are); in GitHub
Actions, the workflow's injected env vars now take priority over the (nonexistent or stale) `.env`
file — but `envfile()` still needs *a* file to open first for the keys not already known. Simplify
further: change every `envfile(os.path.join(CALL_LOOP_POC, '.env'))['KEY']` call site added in Tasks
3/5/6 to `os.environ.get('KEY') or envfile(...)['KEY']` is more invasive than needed — instead, add
one helper used everywhere:

```python
def get_env(key, path):
    if key in os.environ:
        return os.environ[key]
    return envfile(path)[key]
```

Replace the direct `envfile(os.path.join(CALL_LOOP_POC, '.env'))['TEST_CALL_SECRET']`-style call
sites from Tasks 3/5/6 with `get_env('TEST_CALL_SECRET', os.path.join(CALL_LOOP_POC, '.env'))`, and
similarly for `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ALERT_SMS_TO`,
`ALERT_SMS_FROM` (from `CALL_LOOP_POC/.env`), and `RETELL_API_KEY` (from `CALLDESKTECH/.env`).

In `bench/sq.sh`, add an environment-variable fallback before the Keychain lookup:

```bash
#!/bin/bash
RAW=$(security find-generic-password -s "Supabase CLI" -w 2>/dev/null)
TOK=$(echo "$RAW" | sed 's/^go-keyring-base64://' | base64 -d 2>/dev/null); [ -z "$TOK" ] && TOK="$RAW"
[ -z "$TOK" ] && TOK="$SUPABASE_MANAGEMENT_TOKEN"
python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$1" | curl -s -X POST https://api.supabase.com/v1/projects/uazpbuvqisbpykiuebbn/database/query -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d @-
```

- [ ] **Step 3: Verify local runs still work unchanged**

Run: `cd bench && python3 run_eval.py --tier fast --trigger on-demand`
Expected: same behavior as Task 5 Step 2 — local `.env`-file-based runs are unaffected, since none of
those variable names are set in the ambient shell environment on a developer machine.

- [ ] **Step 4: Set the GitHub repo secrets**

This step cannot be done from the command line by an automated worker — it requires access to the
GitHub repo's Settings → Secrets UI (or `gh secret set`, which needs an authenticated `gh` session).
Flag this explicitly to the user rather than skipping it silently: the workflow will fail every
Monday until `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TEST_CALL_SECRET`, `RETELL_API_KEY`,
`ANTHROPIC_API_KEY`, `ALERT_SMS_TO`, `ALERT_SMS_FROM`, and `SUPABASE_MANAGEMENT_TOKEN` are set as
repo secrets (values come from the corresponding `.env` files / macOS Keychain entry used locally).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/eval-weekly.yml bench/run_eval.py bench/sq.sh
git commit -m "Add weekly full-tier eval cron; make runner and sq.sh environment-variable-aware for CI

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: `/admin/eval` dashboard

**Files:**
- Create: `src/app/admin/eval/layout.tsx`
- Create: `src/app/admin/eval/page.tsx`

**Interfaces:**
- Consumes: `requireAdminSession` from `src/lib/outreach/adminAuth.ts` (existing), `getSupabaseAdmin`
  from `src/lib/supabase` (existing), tables `calldesk_eval_runs`/`calldesk_eval_cases` (Task 1).
- Produces: a page at `/admin/eval`, no other task depends on its exports.

- [ ] **Step 1: Write the layout (mirrors `src/app/admin/usage/layout.tsx` exactly)**

```tsx
import { redirect } from 'next/navigation';
import { requireAdminSession } from '@/lib/outreach/adminAuth';

export default async function AdminEvalLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminSession();
  if (!admin) redirect('/auth/signin?callbackUrl=/admin/eval');
  return (
    <div className="min-h-screen bg-[#f7f8fa] text-[#1a1d29]">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <p className="text-[13px] font-semibold text-gray-400">Internal</p>
        <h1 className="text-[17px] font-semibold">Evaluation runs</h1>
      </div>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Write the page**

```tsx
import Link from 'next/link';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Evaluation runs | CallDeskTech' };

type CaseRow = {
  case_id: string; status: string; task_completion: number | null; fluency: number | null;
  regressed: boolean; llm_notes: string | null; transcript: { role: string; content: string }[] | null;
  retell_task_completion: number | null; retell_fluency: number | null;
};
type RunRow = {
  id: string; tier: string; trigger: string; vs_retell: boolean; started_at: string;
  status: string; regression_count: number; error_count: number;
};

export default async function EvalPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run: runId } = await searchParams;
  const db = getSupabaseAdmin();

  const { data: runs } = await db
    .from('calldesk_eval_runs')
    .select('id, tier, trigger, vs_retell, started_at, status, regression_count, error_count')
    .order('started_at', { ascending: false })
    .limit(30);

  const selectedRun = (runId ? (runs || []).find((r) => r.id === runId) : runs?.[0]) as RunRow | undefined;
  let cases: CaseRow[] = [];
  if (selectedRun) {
    const { data } = await db
      .from('calldesk_eval_cases')
      .select('case_id, status, task_completion, fluency, regressed, llm_notes, transcript, retell_task_completion, retell_fluency')
      .eq('run_id', selectedRun.id)
      .order('created_at');
    cases = (data || []) as CaseRow[];
  }

  // Per-case score trend across recent runs, for the "slow drift" view.
  const { data: trendRows } = await db
    .from('calldesk_eval_cases')
    .select('case_id, task_completion, created_at')
    .eq('status', 'scored')
    .order('created_at', { ascending: false })
    .limit(200);
  const trendByCase = new Map<string, { d: string; v: number }[]>();
  for (const r of (trendRows || []).reverse()) {
    if (r.task_completion == null) continue;
    const arr = trendByCase.get(r.case_id) || [];
    arr.push({ d: r.created_at.slice(0, 10), v: r.task_completion });
    trendByCase.set(r.case_id, arr);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-[15px] font-medium">Recent runs</h2>
        <table className="mt-4 w-full text-[13px]">
          <thead className="text-left text-gray-400">
            <tr><th className="pb-2">Started</th><th>Tier</th><th>Trigger</th><th>vs Retell</th><th>Status</th><th>Regressions</th><th>Errors</th></tr>
          </thead>
          <tbody>
            {(runs || []).map((r) => (
              <tr key={r.id} className={`border-t border-gray-100 ${r.id === selectedRun?.id ? 'bg-gray-50' : ''}`}>
                <td className="py-2"><Link href={`/admin/eval?run=${r.id}`} className="text-blue-600 hover:underline">{new Date(r.started_at).toLocaleString()}</Link></td>
                <td>{r.tier}</td><td>{r.trigger}</td><td>{r.vs_retell ? 'yes' : 'no'}</td>
                <td>{r.status}</td>
                <td className={r.regression_count > 0 ? 'text-red-600' : ''}>{r.regression_count}</td>
                <td className={r.error_count > 0 ? 'text-amber-600' : ''}>{r.error_count}</td>
              </tr>
            ))}
            {!runs?.length && <tr><td colSpan={7} className="py-4 text-gray-400">No runs yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {selectedRun && (
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-[15px] font-medium">Run detail — {new Date(selectedRun.started_at).toLocaleString()}</h2>
          <div className="mt-4 space-y-4">
            {cases.map((c) => (
              <div key={c.case_id} className={`rounded-md border p-4 ${c.regressed ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
                <div className="flex items-baseline justify-between">
                  <p className="text-[14px] font-medium">{c.case_id}</p>
                  <p className="text-[13px] text-gray-500">{c.status}</p>
                </div>
                {c.status === 'scored' && (
                  <>
                    <p className="mt-1 text-[13px] text-gray-600">
                      task_completion={c.task_completion} fluency={c.fluency}
                      {c.retell_task_completion != null && ` · Retell: task_completion=${c.retell_task_completion} fluency=${c.retell_fluency}`}
                    </p>
                    {c.llm_notes && <p className="mt-2 text-[13px] text-gray-500">{c.llm_notes}</p>}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[13px] text-blue-600">Transcript</summary>
                      <div className="mt-2 space-y-1 text-[13px]">
                        {(c.transcript || []).map((t, i) => (
                          <p key={i}><span className="font-medium">{t.role}:</span> {t.content}</p>
                        ))}
                      </div>
                    </details>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-[15px] font-medium">Score trend by case</h2>
        <div className="mt-4 space-y-3">
          {[...trendByCase.entries()].map(([caseId, points]) => (
            <div key={caseId}>
              <p className="text-[13px] text-gray-600">{caseId}</p>
              <div className="mt-1 flex h-8 items-end gap-1">
                {points.map((p, i) => (
                  <div key={i} title={`${p.d}: ${p.v}`} className="w-3 rounded-sm bg-[#00122e]" style={{ height: `${(p.v / 5) * 100}%` }} />
                ))}
              </div>
            </div>
          ))}
          {!trendByCase.size && <p className="text-[13px] text-gray-400">No scored cases yet.</p>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/sushanthtiruvaipati/Documents/github/calldesktech && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Deploy and verify the gate + real data render**

Run: `fly deploy --app calldesk-tech`
Then: `curl -s -o /dev/null -w "%{http_code}\n" https://calldesk.tech/admin/eval`
Expected: `307` (redirect to sign-in, unauthenticated) — confirms the gate is active. A signed-in
admin visiting the URL directly should see the run history table populated from Task 5/6/7's real
runs.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/eval
git commit -m "Add /admin/eval dashboard: run history, per-case detail, score trends

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Update bench README

**Files:**
- Modify: `bench/README.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing (documentation only) — final task, ties the framework together for a future
  reader who opens `bench/` cold.

- [ ] **Step 1: Rewrite the README to describe the full framework, superseding its original A/B-only description**

```markdown
# bench/

Voice agent evaluation framework. Places real phone calls against our own agents (and, optionally,
Retell's), scores them with an LLM judge, tracks results in Supabase, and alerts on regression.
Design: `docs/superpowers/specs/2026-09-21-eval-framework-design.md`.

- `sq.sh <sql>` — run SQL against the production Supabase project via the Management API (Keychain
  token locally, `SUPABASE_MANAGEMENT_TOKEN` env var in CI).
- `eval-cases.json` — the test case registry. Edit this to add/remove coverage. `tier: "fast"` cases
  run on every deploy and by default on-demand; `tier: "full"` cases only run in the weekly cron or
  an explicit `--tier full` on-demand run.
- `run_eval.py --tier fast|full [--vs-retell] [--trigger on-demand|on-deploy|weekly]` — the runner.
  `--vs-retell` adds a real Retell comparison call per case (off by default, always available on
  request).
- `deploy-and-test.sh <fly-app-name>` — deploys an app, then runs the fast tier. This is now the
  normal way to deploy `call-loop-poc` or `calldesk-tech`.
- `.github/workflows/eval-weekly.yml` (repo root) — runs the full tier with `--vs-retell` every
  Monday.
- Dashboard: `/admin/eval` (admin-email gated, same allowlist as `/admin/usage`).
- `lang_shopper_bench_*.md` — one-off manual A/B reports from before this framework existed. Kept
  for history; new results belong in the `calldesk_eval_*` tables, viewed via `/admin/eval`.

Needs in the environment (local: read from `.env` files; CI: repo secrets, see
`eval-weekly.yml`'s header comment): TWILIO_ACCOUNT_SID/AUTH_TOKEN, RETELL_API_KEY,
TEST_CALL_SECRET, ANTHROPIC_API_KEY, ALERT_SMS_TO/FROM.
```

- [ ] **Step 2: Commit**

```bash
git add bench/README.md
git commit -m "Document the eval framework in bench/README.md

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

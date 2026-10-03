# Outreach Campaign Infrastructure

Two-pronged outreach for Calldesk:
- **Group A**: Human cold calls to high-value leads
- **Group B**: Text-first, then AI callback for warm replies
- **Group C (NEW)**: Text → instant self-serve trial — no demo, no call

---

## Group A: Human Cold Calls

### Scripts
- `group-a-cold-call.md` — Full scripts, objection handling, tracking metrics

### Running it
1. Download the lead CSV from Mac Mini: `/tmp/callable-leads.csv`
2. Pick 50 leads for Group A (high-score, has phone)
3. Use the script in `group-a-cold-call.md`
4. Track in spreadsheet or Supabase

---

## Group B: Text-First Outreach + AI Callback

For warm replies: sends SMS, classifies replies, triggers AI voice callback.

### 1. Send Texts
```bash
export CALLDESK_API_KEY=cdk_live_...
export SUPABASE_URL=https://...
export SUPABASE_SERVICE_ROLE_KEY=...

node outreach/scripts/group-b-text-first.js \
  --csv /tmp/callable-leads.csv \
  --phone-number-id <uuid-of-your-cd-number> \
  --limit 50 \
  --dry-run
```

### 2. Poll for Replies + Classify
```bash
export GROQ_API_KEY=gsk_...  # Optional; falls back to keyword matching
node outreach/scripts/poll-sms-replies.js --interval=60
```

### 3. Trigger AI Callbacks
```bash
export TEST_CALL_SECRET=...
node outreach/scripts/poll-warm-replies.js --interval=60
```

---

## Group C (NEW): Text → Instant Trial Setup

**The long-term goal. No demo, no AI callback to a human. The prospect sets up their own AI receptionist entirely via SMS.**

### Architecture
```
Cold text → Prospect replies "START" → SMS Onboarding Engine asks 4 questions
→ Creates agent + buys number + routes → Sends live number back
→ 14-day free trial begins automatically
```

Zero human touch after the initial cold text.

### Components

#### 1. Onboarding Engine (polling)
```bash
export CALLDESK_API_KEY=...
export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
export TRIAL_FROM_NUMBER_ID=<uuid-of-your-cd-number>

node outreach/scripts/trial-sms-onboarding.js --interval 30
```

What it does:
- Polls `calldesk_sms_messages` for new inbound SMS to the trial number
- Maintains conversation state in `trial_sms_sessions`
- Sends next question via CallDeskTech SMS API
- When all info collected, spawns `trial-creator.js` to provision resources

**SMS Flow:**
```
START → "What's your business name?"
→ "What should the AI say when answering? (Reply 1 for default)"
→ "What number should urgent calls transfer to?"
→ "What timezone?"
→ "Creating your AI... one sec."
→ "Done! Your AI is live at +1... Call it to test."
```

#### 2. Trial Creator
```bash
node outreach/scripts/trial-creator.js --session-id <uuid>
```

What it does:
- Reads onboarding data from `trial_sms_sessions`
- Creates agent via `POST /tenants/{id}/agents`
- Publishes version with custom greeting + transfer number
- Buys phone number via CallDeskTech API
- Routes number → agent version
- Updates session with live number

### Database
- `trial_sms_sessions` (migration 052) — tracks each prospect's onboarding journey
- `trial_sms_messages` — junction table to prevent double-processing
- Existing `calldesk_sms_messages` — holds all inbound/outbound SMS

### How to Enable
1. Pick one of your CallDeskTech phone numbers to be the "trial onboarding number"
   (prospects text this number to begin setup)
2. Set `TRIAL_FROM_NUMBER_ID` to its UUID
3. Run `trial-sms-onboarding.js` in a screen/tmux session or as a systemd service
4. In your cold outreach texts, include: *"Reply START to +1XXX-XXX-XXXX to set up your free AI receptionist in 2 mins"*

### Scaling Out
- Short term (< 500 trials/month): Buy one number per trial. Fine.
- Medium term: Number pooling — when a trial expires, transfer the number to a new prospect.
- Long term: Offer BYON (bring-your-own-number) — prospect texts FROM their own business number.

---

## Comparison

| Metric | Group A (human calls) | Group B (text + AI callback) | Group C (text → instant trial) |
|--------|----------------------|------------------------------|-------------------------------|
| Human hours per 100 leads | ~10 hrs | ~0.5 hrs | 0 hrs |
| Conversion → trial | 5-10% | 2-5% | 10-20% (self-serve) |
| Time from interest → live AI | 1-3 days | Minutes (AI call) | 2 minutes |
| Scalable | No (needs callers) | Partial (expensive AI calls) | Yes (fully automated) |

---

## Files

- `group-a-cold-call.md` — Human caller scripts
- `group-b-text-first.js` — SMS sender (CallDeskTech API)
- `poll-sms-replies.js` — Reply classifier
- `poll-warm-replies.js` — AI callback trigger
- **`trial-sms-onboarding.js`** — State machine for SMS onboarding
- **`trial-creator.js`** — Provisions agent, number, routing
- `env.example` — Required environment variables

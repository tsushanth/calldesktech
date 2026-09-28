# Outreach Campaign Infrastructure

Two-pronged outreach for Calldesk:
- **Group A**: Human cold calls to high-value leads
- **Group B**: Text-first, then AI callback for warm replies

## Group A: Human Cold Calls

### Scripts
- `group-a-cold-call.md` — Full scripts, objection handling, tracking metrics

### Running it
1. Download the lead CSV from Mac Mini: `/tmp/callable-leads.csv`
2. Pick 50 leads for Group A (high-score, has phone)
3. Use the script in `group-a-cold-call.md`
4. Track in spreadsheet or Supabase

## Group B: Text-First Outreach

### Architecture
```
Lead CSV → CallDeskTech SMS API (Telnyx) → Poll for replies → Classify (Groq) → AI Callback
```

### Components

#### 1. Send Texts
```bash
export CALLDESK_API_KEY=cdk_live_...
export SUPABASE_URL=https://...
export SUPABASE_SERVICE_ROLE_KEY=...

node outreach/scripts/group-b-text-first.js \
  --csv /tmp/callable-leads.csv \
  --phone-number-id <uuid-of-your-cd-number> \
  --limit 50 \
  --dry-run  # Remove for live sending
```

Find your phone number ID via MCP or API: `list_phone_numbers`.

**Templates used** (rotated):
- Direct question: "Quick question — do you get missed calls after hours?"
- Benefit-focused: "Ever lose leads to voicemail after 5pm?"
- Social proof: "We're helping [city] agencies capture after-hours leads..."

#### 2. Poll for Replies
```bash
export SUPABASE_URL=https://...
export SUPABASE_SERVICE_ROLE_KEY=...
export GROQ_API_KEY=gsk_...

node outreach/scripts/poll-sms-replies.js --interval=60
```

What it does:
1. Polls `calldesk_sms_messages` (inbound via Telnyx webhook) for replies to campaign numbers
2. Classifies each reply with Groq (interested/not_interested/question/opt_out/unclear)
3. Updates `outreach_text_campaign` with reply + classification

#### 3. Trigger AI Callbacks
```bash
export SUPABASE_URL=https://...
export SUPABASE_SERVICE_ROLE_KEY=...
export TEST_CALL_SECRET=...
export CALL_LOOP_URL=https://call-loop-poc.fly.dev

node outreach/scripts/poll-warm-replies.js --interval=60
```

Runs continuously, polls Supabase for unhandled "interested" replies,
then triggers AI sales call via call-loop-poc.

### Database
- Table: `outreach_text_campaign` (migration 051)
- Tracks: sent, replied, classified, ai_call_sid
- Inbound SMS stored in: `calldesk_sms_messages` (main app handles Telnyx webhook)

### Telnyx Setup
SMS sending and receiving is already handled by the CallDeskTech app:
- Outbound: `POST /api/v1/tenants/{id}/sms` → Telnyx provider
- Inbound: `/api/webhooks/telnyx-sms` → stored in `calldesk_sms_messages`

No separate Twilio setup needed.

### Testing
Test mode: all texts go to a single test number:
```bash
node outreach/scripts/group-b-text-first.js \
  --csv /tmp/callable-leads.csv \
  --phone-number-id <uuid> \
  --test-number +15551234567 \
  --limit 5
```

## Cost Estimates

| Channel | Cost per lead | Notes |
|---------|--------------|-------|
| SMS (Telnyx via CallDeskTech) | ~$0.005 | Cheaper than Twilio |
| AI classification (Groq) | ~$0.0001 | Llama 3.1 8B, negligible |
| AI callback (Twilio voice) | ~$0.03/min | Call loop runs on Fly |
| Human cold call (VA) | ~$0.30/call | $15/hr, 50 calls/hr |

Group B is ~40× cheaper per lead than Group A.

## Expected Metrics (benchmark)

| Metric | Group A (human) | Group B (text) |
|--------|----------------|----------------|
| Connection rate | 15-25% | 90%+ (text delivery) |
| Reply rate | N/A | 5-15% |
| Interest rate | 10-20% of connected | 30-50% of replies |
| Demo scheduled | 5-10% | 10-20% of interested |
| Cost per demo | ~$6-12 | ~$0.50-1.00 |

## Next Steps

1. Run Group A with 50 leads (track in spreadsheet)
2. Run Group B with 50 leads (dry-run first, then live)
3. Compare after 1 week:
   - Cost per conversation
   - Cost per demo scheduled
   - Cost per closed deal
4. Double down on the winner

## Files

- `group-a-cold-call.md` — Scripts and objection handling
- `group-b-text-first.js` — SMS sender (uses CallDeskTech API)
- `poll-sms-replies.js` — Inbound reply classifier
- `poll-warm-replies.js` — AI callback trigger

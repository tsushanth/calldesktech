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
Lead CSV → Twilio SMS → Webhook (on reply) → Classify (Groq/Ollama) → AI Callback
```

### Components

#### 1. Send Texts
```bash
node outreach/scripts/group-b-text-first.js \
  --csv /tmp/callable-leads.csv \
  --from +12245061194 \
  --limit 50 \
  --dry-run  # Remove for live sending
```

**Templates used** (rotated):
- Direct question: "Quick question — do you get missed calls after hours?"
- Benefit-focused: "Ever lose leads to voicemail after 5pm?"
- Social proof: "We're helping [city] agencies capture after-hours leads..."

#### 2. Handle Replies (Webhook)
Deployed at: `POST /api/webhooks/sms-reply`

What it does:
1. Receives Twilio inbound SMS
2. Classifies reply with Groq (interested/not_interested/question/opt_out/unclear)
3. Stores in `outreach_text_campaign` table
4. For "interested" replies → triggers AI callback

#### 3. Poll for Warm Replies
```bash
node outreach/scripts/poll-warm-replies.js --interval=60
```

Runs continuously, polls Supabase for unhandled "interested" replies,
then triggers AI sales call via call-loop-poc.

### Database
- Table: `outreach_text_campaign` (migration 048)
- Tracks: sent, delivered, replied, classified, ai_call_sid

### Twilio Setup
1. Configure webhook URL for inbound SMS:
   ```
   https://your-domain.com/api/webhooks/sms-reply
   ```
2. Ensure `TEST_CALL_SECRET` is set in env
3. Ensure `GROQ_API_KEY` or Ollama is available for classification

### Testing
Test mode: all texts go to a single test number:
```bash
node outreach/scripts/group-b-text-first.js \
  --csv /tmp/callable-leads.csv \
  --test-number +15551234567 \
  --limit 5
```

## Cost Estimates

| Channel | Cost per lead | Notes |
|---------|--------------|-------|
| SMS (Twilio) | ~$0.0075 | $0.0075/msg, avg 1-2 msgs |
| AI classification (Groq) | ~$0.0001 | Llama 3.1 8B, negligible |
| AI callback (Twilio) | ~$0.03/min | Call loop runs on Fly |
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
- `group-b-text-first.js` — SMS sender
- `webhook-sms-reply.js` — Inbound SMS handler
- `poll-warm-replies.js` — AI callback trigger
- `callable-leads.csv` — Exported lead list (generated)

#!/usr/bin/env -S node --import tsx
// Adds the STT billing minimum ("billed by the second, 10 second minimum per request") to UNSENT emails and to form
// messages that are not yet submitted, wherever they quote "$0.11 per hour". Deterministic text patch, no LLM, never touches
// sent messages. The old text is kept on the message error-free in signals only for forms; for emails the change is additive.
//
//   DRY_RUN=1 tsx harness/outreach/patch-stt-minimum.ts
import { getSupabaseAdmin } from '@/lib/supabase';
import { addSttMinimum } from '@/lib/outreach/sttMinimum';

const DRY = process.env.DRY_RUN === '1';

(async () => {
  const db = getSupabaseAdmin();
  let patched = 0, noPrice = 0, realtime = 0, scanned = 0;
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from('calldesk_outreach_messages').select('id,status,body_text')
      .in('status', ['draft', 'approved', 'paused']).ilike('body_text', '%0.11%').range(from, from + 499);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const m of data as { id: string; status: string; body_text: string }[]) {
      scanned++;
      if (/realtime|real-time/i.test(m.body_text)) realtime++;
      const next = addSttMinimum(m.body_text);
      if (!next) { if (!/10[ -]second minimum/i.test(m.body_text)) noPrice++; continue; }
      if (!DRY) {
        const { error: e } = await db.from('calldesk_outreach_messages').update({ body_text: next }).eq('id', m.id).in('status', ['draft', 'approved', 'paused']);
        if (e) { console.log('update failed', m.id, e.message); continue; }
      }
      patched++;
    }
    if (data.length < 500) break;
  }
  console.log(`${DRY ? '[dry] ' : ''}email scan: ${scanned} unsent messages mention $0.11, patched ${patched}, no matching phrase ${noPrice}, mention realtime ${realtime}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

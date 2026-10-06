#!/usr/bin/env -S node --import tsx
// Gives every reseller lead that has a dialable-looking phone number a call-region verdict (signals.callRegion), from its own
// website. The call-batch builder only places a lead by its area code once the verdict says the number is a real +1 number for
// a business that serves the US or Canada (callRegion.ts has the rules and the reasons). Plain HTTP, no LLM, never sends anything.
//
//   LIMIT=300 tsx harness/outreach/check-call-region.ts            # only leads with no verdict yet
//   RECHECK=1 tsx harness/outreach/check-call-region.ts            # redo 'unclear' and foreign ones too
//   DRY_RUN=1 ...                                                    # prints, writes nothing
import { getSupabaseAdmin } from '@/lib/supabase';
import { stateFromPhone } from '@/lib/areaCodeState';
import { classifyRegion, fetchSiteFacts, type SiteFacts } from '@/lib/outreach/callRegion';

const LIMIT = Math.max(1, Number(process.env.LIMIT) || 300);
const DRY = process.env.DRY_RUN === '1';
const RECHECK = process.env.RECHECK === '1';
const CONC = 6;

type Lead = { id: string; domain: string | null; phone: string | null; location: string | null; signals: Record<string, unknown> | null; source_key: string | null; signal_source: string | null };
const last10 = (s: string) => s.replace(/\D/g, '').slice(-10);

(async () => {
  const db = getSupabaseAdmin();
  const all: Lead[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.from('calldesk_outreach_leads').select('id,domain,phone,location,signals,source_key,signal_source')
      .eq('product', 'calldesk').neq('status', 'dead').not('phone', 'is', null).not('domain', 'is', null).order('id').range(off, off + 999);
    if (error) throw new Error(error.message);
    all.push(...((data ?? []) as Lead[]));
    if (!data || data.length < 1000) break;
  }
  const reseller = all.filter((l) => ['search', 'manual', 'review_site'].includes(String(l.signal_source)) || /^(retell|serp|vapi):/.test(String(l.source_key)));
  // How many different domains carry the same number: three or more is a scrape artifact.
  const domainsByPhone = new Map<string, Set<string>>();
  for (const l of reseller) { const k = last10(l.phone ?? ''); if (k.length === 10) (domainsByPhone.get(k) ?? domainsByPhone.set(k, new Set()).get(k)!).add(String(l.domain)); }

  const todo = reseller.filter((l) => {
    if (!l.phone || /^\+(?!1)/.test(l.phone.trim()) || /^00/.test(l.phone.trim())) return false;
    if (!stateFromPhone(l.phone)) return false; // not a number the batch builder could place anyway
    const v = (l.signals as { callRegion?: { verdict?: string } } | null)?.callRegion?.verdict;
    return RECHECK ? !v || ['unclear', 'foreign_number'].includes(v) : !v;
  }).slice(0, LIMIT);
  console.log(`${reseller.length} reseller leads with a phone; ${todo.length} to check`);

  const factsByDomain = new Map<string, Promise<SiteFacts | null>>();
  const tally: Record<string, number> = {};
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const lead = todo[i++];
      const domain = String(lead.domain);
      if (!factsByDomain.has(domain)) factsByDomain.set(domain, fetchSiteFacts(domain).catch(() => null));
      const facts = await factsByDomain.get(domain)!;
      if (!facts) { tally.unreachable = (tally.unreachable || 0) + 1; continue; } // try again on a later run
      const shared = domainsByPhone.get(last10(lead.phone ?? ''))?.size ?? 1;
      const r = classifyRegion(facts, { phone: lead.phone!, location: lead.location }, shared);
      tally[r.verdict] = (tally[r.verdict] || 0) + 1;
      if (DRY) { console.log(`${r.verdict.padEnd(15)} ${domain}  ${r.evidence}`); continue; }
      const { error } = await db.from('calldesk_outreach_leads').update({ signals: { ...(lead.signals ?? {}), callRegion: { ...r, checkedAt: new Date().toISOString() } } }).eq('id', lead.id);
      if (error) console.log(`write failed ${domain}: ${error.message}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log(JSON.stringify(tally));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

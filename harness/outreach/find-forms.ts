#!/usr/bin/env -S node --import tsx
// Finds contact forms for reseller leads we have ALREADY contacted by phone or email. findContact() stops at the first email or
// phone it finds, so a lead that had an address never had its form recorded. This reads each lead's own contact pages (plain HTTP,
// robots-respecting, no LLM) and stores signals.contactForm when one is found. Never submits anything.
//
//   DRY_RUN=1 tsx harness/outreach/find-forms.ts      # print only
//   tsx harness/outreach/find-forms.ts                 # also store signals.contactForm on the leads
// Writes the list to /tmp/reseller-forms-contacted.csv
import fs from 'node:fs';
import { getSupabaseAdmin } from '@/lib/supabase';
import { politeFetchText } from '@/lib/outreach/discovery/http';
import { detectContactForm, type ContactForm } from '@/lib/outreach/discovery/contactPages';
import { isPlatformDomain } from '@/lib/outreach/platformBlocklist';

const DRY = process.env.DRY_RUN === '1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Lead = { id: string; company_name: string; domain: string | null; status: string; signal_source: string | null; source_key: string | null; fit: string | null; contact_email: string | null; phone: string | null; replied_at: string | null; signals: Record<string, unknown> | null };

async function findForm(domain: string): Promise<ContactForm | null> {
  const robots = await politeFetchText(`https://${domain}/robots.txt`, 6000);
  const blocked = robots.ok ? [...robots.text.matchAll(/^\s*disallow:\s*(\S+)/gim)].map((m) => m[1]) : [];
  let best: ContactForm | null = null;
  for (const path of ['/contact', '/contact-us', '/contact/', '/get-in-touch', '/about', '/']) {
    if (blocked.some((b) => b === '/' || (b !== '' && path.startsWith(b)))) continue;
    const res = await politeFetchText(`https://${domain}${path}`);
    await sleep(700);
    if (!res.ok) continue;
    const f = detectContactForm(res.text, `https://${domain}${path}`);
    if (f && (!best || (best.method === 'embedded' && f.method !== 'embedded'))) best = f;
    if (best && best.method !== 'embedded') break;
  }
  return best;
}

(async () => {
  const db = getSupabaseAdmin();
  const outcomeBy = new Map<string, string[]>();
  const ids = new Set<string>();
  for (let off = 0; ; off += 1000) {
    const { data } = await db.from('calldesk_call_batches').select('lead_id,outcome').not('lead_id', 'is', null).range(off, off + 999);
    for (const r of (data ?? []) as { lead_id: string; outcome: string | null }[]) { ids.add(r.lead_id); if (r.outcome) outcomeBy.set(r.lead_id, [...(outcomeBy.get(r.lead_id) ?? []), r.outcome]); }
    if (!data || data.length < 1000) break;
  }
  const emailed = new Set<string>();
  for (let off = 0; ; off += 1000) {
    const { data } = await db.from('calldesk_outreach_messages').select('lead_id').eq('product', 'calldesk').eq('status', 'sent').range(off, off + 999);
    for (const r of (data ?? []) as { lead_id: string }[]) { ids.add(r.lead_id); emailed.add(r.lead_id); }
    if (!data || data.length < 1000) break;
  }
  const all = [...ids];
  const leads: Lead[] = [];
  for (let i = 0; i < all.length; i += 100) {
    const { data } = await db.from('calldesk_outreach_leads').select('id,company_name,domain,status,signal_source,source_key,fit,contact_email,phone,replied_at,signals').eq('product', 'calldesk').in('id', all.slice(i, i + 100));
    leads.push(...((data ?? []) as Lead[]));
  }
  const reseller = (l: Lead) => ['search', 'manual', 'review_site'].includes(l.signal_source ?? '') || (l.signal_source === 'directory' && (l.source_key ?? '').startsWith('retell:'));
  const todo = leads.filter((l) => l.domain && reseller(l) && !isPlatformDomain(l.domain) && !(l.signals as { contactForm?: unknown } | null)?.contactForm);
  console.error(`contacted ${leads.length}, reseller segment without a recorded form: ${todo.length}`);

  const rows: string[][] = [];
  let found = 0;
  for (const l of todo) {
    let f: ContactForm | null = null;
    try { f = await findForm(l.domain as string); } catch { /* unreachable site */ }
    if (!f) continue;
    found++;
    const outs = outcomeBy.get(l.id) ?? [];
    const said = outs.some((o) => ['not_interested', 'do_not_call'].includes(o)) ? 'said no on a call' : l.replied_at ? 'replied' : '';
    rows.push([l.company_name, l.domain as string, f.pageUrl, f.captcha ? 'captcha' : f.method === 'embedded' ? 'embedded' : 'plain', emailed.has(l.id) ? 'emailed' : '', outs.length ? 'called: ' + [...new Set(outs)].join('/') : '', said, l.id]);
    if (!DRY) await db.from('calldesk_outreach_leads').update({ signals: { ...(l.signals ?? {}), contactForm: f } }).eq('id', l.id);
  }
  const q = (v: string) => '"' + v.replace(/"/g, '""') + '"';
  fs.writeFileSync('/tmp/reseller-forms-contacted.csv', ['company,domain,form_url,form_type,emailed,calls,flag,lead_id', ...rows.map((r) => r.map(q).join(','))].join('\n'));
  console.error(`forms found for ${found} of ${todo.length}; wrote /tmp/reseller-forms-contacted.csv${DRY ? ' (dry run, nothing stored)' : ''}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

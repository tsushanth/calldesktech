import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// COMPLIANCE GUARDRAIL (internal-docs/legal/OUTBOUND-CONSENT-RESEARCH.md): no cold SMS and no AI-voice calls
// to prospects. A freight lead's phone is for HUMAN calls only. This test fails if any file outside the
// reviewed allow-list both reads outreach lead phones and talks to a calling/texting provider, or if a new
// file starts reading outreach leads' phone numbers without being added to the list on purpose.
const ROOT = join(__dirname, '..', '..');
const SKIP = new Set(['node_modules', '.next', '.git']);
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(e)) out.push(p);
  }
  return out;
}
const files = ['src', 'scripts', 'harness'].flatMap((d) => walk(join(ROOT, d))).map((p) => ({ rel: relative(ROOT, p), text: readFileSync(p, 'utf8') }));

const READS_LEAD_PHONE = /calldesk_outreach_leads|leadsTable\(/;
const PHONE = /\bphone\b/;
// Reviewed readers of outreach-lead phones. Each is a human-only surface: admin display/edit, the human caller
// batch builder, carrier line-type lookups (a lookup, not a call), the phone backfills, and discovery code
// that writes the phone.
const ALLOWED_READERS = [
  /^src\/app\/api\/admin\/outreach\//,
  /^src\/app\/admin\/outreach\//,
  /^src\/lib\/outreach\/discovery\//,
  /^scripts\/(build-call-batch\.ts|lookup-line-types\.mjs|line-type-sample\.mjs|backfill-freight-phones\.mjs)$/,
  /^harness\/outreach\//,
  // The human cold-caller's batch screen: it now also reads the officer name (signals.registry.contactName) of each batch lead to show
  // "Ask for: ...". It places no calls and sends no texts (the next test checks that).
  /^src\/app\/api\/caller\/batch\/route\.ts$/,
  // The supervisor's calling-review statistics: it reads each batch lead's PRODUCT (to split results by kind of company), never its phone for
  // any other purpose, and places no calls and sends no texts (the next test checks that).
  /^src\/app\/api\/caller\/admin\/stats\/route\.ts$/,
  /^src\/lib\/outreach\/(products|sender|autosend|emailVerify)\.ts$/,
];
// Anything that can place a call or send a text.
const CALL_OR_SMS = /\bcalls\.create|CreateCall|\/Calls\b|Messages\.json|sendSms|create-phone-call|createPhoneCall|\btwilio\b|\btelnyx\b/i;

describe('freight lead phones are for human calls only', () => {
  it('only reviewed files read outreach-lead phones', () => {
    const readers = files.filter((f) => READS_LEAD_PHONE.test(f.text) && PHONE.test(f.text) && !/^test\//.test(f.rel)).map((f) => f.rel);
    const unexpected = readers.filter((r) => !ALLOWED_READERS.some((re) => re.test(r)));
    expect(unexpected).toEqual([]);
  });
  it('no file that reads outreach-lead phones can place a call or send a text', () => {
    // The two line-type scripts call Telnyx Number LOOKUP (carrier/line type, a data query, no call is placed).
    const LOOKUP_ONLY = /^scripts\/(lookup-line-types|line-type-sample)\.mjs$/;
    const offenders = files.filter((f) => READS_LEAD_PHONE.test(f.text) && PHONE.test(f.text) && CALL_OR_SMS.test(f.text) && !LOOKUP_ONLY.test(f.rel)).map((f) => f.rel);
    expect(offenders).toEqual([]);
    for (const f of files.filter((x) => LOOKUP_ONLY.test(x.rel))) expect(/number_lookup|number-lookup/i.test(f.text), f.rel).toBe(true);
  });
  it('the freight path (discovery, drafting, follow-ups, sending) never touches SMS or call APIs', () => {
    const freightPath = files.filter((f) => /^src\/lib\/outreach\/(freight|followUps|utm|agencyDraft|autosend|sender|emailHtml)\.ts$|discovery\/(freightFmcsa|freightFmcsaRegistry|pipeline)\.ts$/.test(f.rel));
    expect(freightPath.length).toBeGreaterThanOrEqual(8);
    for (const f of freightPath) expect(CALL_OR_SMS.test(f.text), f.rel).toBe(false);
  });
});

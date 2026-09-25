import { describe, it } from 'vitest';
import { findBrCnpjCandidates, BR_PRODUCT_IDS } from '@/lib/outreach/discovery/brCnpjRegistry';
import { findDenueCandidates, MX_PRODUCT_IDS } from '@/lib/outreach/discovery/mxDenueRegistry';
import { loadBrMunicipalities } from '@/lib/outreach/discovery/brCnpjRegistry';

const PREFIX = Math.round(341_841_082 * 0.05); // 5% of Estabelecimentos1

describe('LATAM live dry run (no DB writes)', () => {
  it('BR: 5% of Estabelecimentos1, every vertical', async () => {
    const munis = await loadBrMunicipalities({ log: (m) => console.log(m) });
    const out: Record<string, unknown>[] = [];
    for (const product of BR_PRODUCT_IDS) {
      const t = Date.now();
      const r = await findBrCnpjCandidates(product, Number.MAX_SAFE_INTEGER, {
        fileIndex: 1, maxCompressedBytes: PREFIX, skipNameJoin: true, municipalities: munis,
      });
      const withEmail = r.candidates.filter((c) => c.email).length;
      out.push({ product, scanned: r.scanned, candidates: r.candidates.length, withEmail,
        withPhone: r.candidates.filter((c) => c.phone).length, secs: Math.round((Date.now() - t) / 1000),
        errors: r.errors });
      console.log('BR', JSON.stringify(out[out.length - 1]));
      if (r.candidates[0]) console.log('   sample:', r.candidates[0].name, '|', r.candidates[0].location, '|', r.candidates[0].email ?? '(free-mail, no contact)');
    }
    console.log('BR TABLE', JSON.stringify(out, null, 1));
  }, 3_600_000);

  it('BR: the Empresas legal-name join on the same prefix (dental)', async () => {
    const t = Date.now();
    const r = await findBrCnpjCandidates('dental', Number.MAX_SAFE_INTEGER, {
      fileIndex: 1, maxCompressedBytes: PREFIX, log: (m) => console.log('  ', m),
    });
    console.log('BR JOIN dental', JSON.stringify({ scanned: r.scanned, candidates: r.candidates.length,
      withEmail: r.candidates.filter((c) => c.email).length,
      withLegalName: r.candidates.filter((c) => c.legalName).length,
      rejected: r.rejected, secs: Math.round((Date.now() - t) / 1000), errors: r.errors }, null, 1));
  }, 3_600_000);

  it('MX: states 09 and 15, every vertical', async () => {
    const out: Record<string, unknown>[] = [];
    for (const product of MX_PRODUCT_IDS) {
      const t = Date.now();
      const r = await findDenueCandidates(product, Number.MAX_SAFE_INTEGER, { states: ['09', '15'] });
      out.push({ product, scanned: r.scanned, candidates: r.candidates.length,
        withEmail: r.candidates.filter((c) => c.email).length,
        withDomain: r.candidates.filter((c) => c.domain).length,
        byState: r.byState, secs: Math.round((Date.now() - t) / 1000), errors: r.errors });
      console.log('MX', JSON.stringify(out[out.length - 1]));
      if (r.candidates[0]) console.log('   sample:', r.candidates[0].name, '|', r.candidates[0].location, '|', r.candidates[0].email ?? '(free-mail, no contact)');
    }
    console.log('MX TABLE', JSON.stringify(out, null, 1));
  }, 3_600_000);
});

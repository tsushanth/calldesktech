import { describe, it } from 'vitest';
import { findBrCnpjCandidates, BR_PRODUCT_IDS, loadBrMunicipalities } from '@/lib/outreach/discovery/brCnpjRegistry';
import { findDenueCandidates, MX_PRODUCT_IDS } from '@/lib/outreach/discovery/mxDenueRegistry';

const PREFIX = Math.round(341_841_082 * 0.05);

describe('LATAM live dry run (no DB writes)', () => {
  it('BR: 5% of Estabelecimentos1, every vertical', async () => {
    const munis = await loadBrMunicipalities();
    const out: Record<string, unknown>[] = [];
    for (const product of BR_PRODUCT_IDS) {
      const r = await findBrCnpjCandidates(product, Number.MAX_SAFE_INTEGER, {
        fileIndex: 1, maxCompressedBytes: PREFIX, skipNameJoin: true, municipalities: munis });
      out.push({ product, scanned: r.scanned, candidates: r.candidates.length,
        withEmail: r.candidates.filter((c) => c.email).length, errors: r.errors });
      console.log('BR', JSON.stringify(out[out.length - 1]));
    }
  }, 3_600_000);

  it('BR: the Empresas legal-name join (dental, 1% prefix so the join is the cost)', async () => {
    const t = Date.now();
    const r = await findBrCnpjCandidates('dental', Number.MAX_SAFE_INTEGER, {
      fileIndex: 1, maxCompressedBytes: Math.round(341_841_082 * 0.01), log: (m) => console.log('  ', m) });
    console.log('BR JOIN dental', JSON.stringify({ scanned: r.scanned, candidates: r.candidates.length,
      withEmail: r.candidates.filter((c) => c.email).length,
      withLegalName: r.candidates.filter((c) => c.legalName).length,
      secs: Math.round((Date.now() - t) / 1000), errors: r.errors }, null, 1));
    for (const c of r.candidates.slice(0, 5)) console.log('   ', c.name, '|', c.legalName, '|', c.location, '|', c.email ?? '(free-mail)');
  }, 3_600_000);

  it('MX: states 09 and 15, every vertical', async () => {
    for (const product of MX_PRODUCT_IDS) {
      const r = await findDenueCandidates(product, Number.MAX_SAFE_INTEGER, { states: ['09', '15'] });
      console.log('MX', JSON.stringify({ product, scanned: r.scanned, candidates: r.candidates.length,
        withEmail: r.candidates.filter((c) => c.email).length,
        withDomain: r.candidates.filter((c) => c.domain).length, byState: r.byState, errors: r.errors }));
      if (r.candidates[0]) console.log('    sample:', r.candidates[0].name, '|', r.candidates[0].location, '|', r.candidates[0].email ?? '(free-mail)');
    }
  }, 3_600_000);
});

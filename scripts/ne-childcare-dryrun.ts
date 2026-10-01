import { allNeChildcareLeads, NE_CHILDCARE_SOURCES } from '../src/lib/outreach/discovery/childcareNortheast';
async function main() {
  for (const s of NE_CHILDCARE_SOURCES) {
    const r = await allNeChildcareLeads(s, { log: console.error });
    const c = r.candidates;
    const keys = new Set(c.map((l) => l.sourceKey));
    console.log(JSON.stringify({ source: s, scanned: r.scanned, kept: c.length, withEmail: c.filter((l) => l.email).length, withPhone: c.filter((l) => l.phone).length, either: c.filter((l) => l.email || l.phone).length, phoneExcluded: c.filter((l) => l.callerPhoneExcluded).length, uniqueKeys: keys.size, errors: r.errors, rejected: r.rejected }));
    if (c[0]) console.log(JSON.stringify(c[0]));
  }
}
main();

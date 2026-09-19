// G2 and Capterra have no public, ToS-friendly API for pulling reviewer
// company names off Retell's product page, and scraping those pages
// programmatically risks both their ToS and (per the discussion this tool
// came out of) the reputational optics of harvesting a competitor's
// customer list. So this source stays a MANUAL import: a human reads
// Retell's public review pages, copies the (company name, review snippet)
// pairs they can see, and pastes them in via this typed function — no
// automated fetch/scrape happens here.
//
// The shape matches the other signal sources so leads/route.ts can treat
// all three uniformly; swapping in a real data provider (e.g. Apollo,
// Clearbit, a G2 partner data feed) later just means adding a fetch-based
// function with this same return type.

export interface ReviewSiteSignal {
  companyName: string;
  domain: string | null;
  detail: string; // the review snippet or reviewer title, as copied by a human
}

export interface ReviewSiteImportRow {
  companyName: string;
  domain?: string;
  snippet: string;
}

export function parseManualReviewImport(rows: ReviewSiteImportRow[]): ReviewSiteSignal[] {
  return rows
    .filter((r) => r.companyName?.trim())
    .map((r) => ({
      companyName: r.companyName.trim(),
      domain: r.domain?.trim() || null,
      detail: r.snippet?.trim() || '',
    }));
}

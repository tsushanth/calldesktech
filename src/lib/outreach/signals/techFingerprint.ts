// Detects Retell's client SDK/widget on a prospect's own public website —
// this is public information about the PROSPECT's site (what scripts it
// loads), not data extracted from Retell's platform, which keeps it on the
// right side of the "market segment, not Retell's customer list" line from
// the outreach guardrails.
//
// v1 does its own lightweight fetch-and-grep rather than paying for
// BuiltWith/Wappalyzer up front — it's a single HTML fetch checking for
// known Retell script/asset markers. Swap in a real tech-fingerprint API
// (BuiltWith has a free-tier lookup endpoint) later by replacing the body
// of checkDomain(); the return type is designed to stay the same either way.

export interface TechFingerprintSignal {
  companyName: string;
  domain: string;
  detail: string;
}

// Retell's hosted widget/SDK assets — update if Retell renames their CDN.
const RETELL_MARKERS = ['retellai.com', 'retell-client-js-sdk', 'retell-web-client'];

export async function checkDomainForRetell(domain: string, companyName: string): Promise<TechFingerprintSignal | null> {
  const url = domain.startsWith('http') ? domain : `https://${domain}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'calldesk-outreach-research/1.0' } });
  if (!res.ok) return null;

  const html = await res.text();
  const matched = RETELL_MARKERS.find((marker) => html.includes(marker));
  if (!matched) return null;

  return {
    companyName,
    domain,
    detail: `Found "${matched}" referenced on ${url}`,
  };
}

// Batch helper — checks a list of (domain, companyName) candidates
// sequentially (no concurrency) to stay a polite, low-volume crawler rather
// than a scraper hammering many sites at once.
export async function findTechFingerprintSignals(
  candidates: { domain: string; companyName: string }[]
): Promise<TechFingerprintSignal[]> {
  const results: TechFingerprintSignal[] = [];
  for (const candidate of candidates) {
    try {
      const signal = await checkDomainForRetell(candidate.domain, candidate.companyName);
      if (signal) results.push(signal);
    } catch (error) {
      console.warn(`[techFingerprint] failed to check ${candidate.domain}:`, error);
    }
  }
  return results;
}

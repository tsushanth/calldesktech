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

import { politeFetchText } from '../discovery/http';

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

// Competing-platform markers for the automated enrichment pass (pipeline.ts's
// stageEnrich): same technique as RETELL_MARKERS above (public script/asset
// signatures on the PROSPECT's own site), extended to the platforms Calldesk
// actually competes with. A hit here is strong scoring evidence — it confirms
// the lead already resells/integrates a voice-AI platform, not just that their
// description mentions the category.
const COMPETITOR_MARKERS: Record<string, string[]> = {
  Retell: RETELL_MARKERS,
  Vapi: ['vapi.ai', 'vapi-web-sdk', '@vapi-ai'],
  Bland: ['bland.ai', 'bland-client'],
  Synthflow: ['synthflow.ai'],
  ElevenLabs: ['elevenlabs.io/convai', 'elevenlabs-convai'],
  PlayAI: ['play.ai', 'playht.com'],
};

// Requires the marker to appear where it would if it were actually loaded/
// linked (a script/asset src or href, or a bare URL), not just anywhere in
// the page's text — a blog post that merely mentions a competitor by name
// must not count as "confirmed integration".
function appearsAsScriptOrUrlReference(html: string, marker: string): boolean {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?:src|href)\\s*=\\s*["'][^"']*${escaped}[^"']*["']|https?://[^\\s"'<>]*${escaped}`,
    'i',
  );
  return pattern.test(html);
}

// Checks one domain for ANY known platform marker, returning every platform
// name detected (usually 0 or 1, but a migration in progress could show 2).
// Best-effort: a fetch failure yields [], never throws (politeFetchText
// already never throws, and applies a 12s timeout so one slow site can't
// stall the serial per-lead enrichment loop).
export async function checkDomainForPlatforms(domain: string): Promise<string[]> {
  const url = domain.startsWith('http') ? domain : `https://${domain}`;
  const { ok, text: html } = await politeFetchText(url, 12000);
  if (!ok) return [];
  const found: string[] = [];
  for (const [platform, markers] of Object.entries(COMPETITOR_MARKERS)) {
    if (markers.some((marker) => appearsAsScriptOrUrlReference(html, marker))) found.push(platform);
  }
  return found;
}

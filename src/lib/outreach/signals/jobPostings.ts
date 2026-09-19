// Finds companies publicly hiring for voice-AI-related roles as a signal
// they're building or evaluating a voice-agent platform (possibly Retell).
// Uses RemoteOK's public, keyless JSON feed as the free starting source —
// thin coverage (remote-tagged listings only) but zero signup friction to
// get v1 working end-to-end. Swap/extend with a paid job-board API (e.g.
// a JSearch/LinkedIn Jobs API plan) by adding another fetch+filter here and
// merging results — this function's shape (return one row per matching
// listing) is designed to make that additive, not a rewrite.

export interface JobPostingSignal {
  companyName: string;
  domain: string | null;
  detail: string; // the matched job title/snippet
  sourceUrl: string;
}

const KEYWORDS = ['retell', 'voice ai agent', 'voice agent', 'conversational ai', 'ai receptionist'];

interface RemoteOkJob {
  company?: string;
  position?: string;
  description?: string;
  url?: string;
  company_url?: string;
}

export async function findJobPostingSignals(): Promise<JobPostingSignal[]> {
  const res = await fetch('https://remoteok.com/api', {
    headers: { 'User-Agent': 'calldesk-outreach-research/1.0' },
  });
  if (!res.ok) {
    throw new Error(`RemoteOK feed request failed: ${res.status}`);
  }
  const rows = (await res.json()) as RemoteOkJob[];

  const matches: JobPostingSignal[] = [];
  for (const row of rows) {
    const haystack = `${row.position ?? ''} ${row.description ?? ''}`.toLowerCase();
    const matchedKeyword = KEYWORDS.find((kw) => haystack.includes(kw));
    if (!matchedKeyword || !row.company) continue;
    matches.push({
      companyName: row.company,
      domain: row.company_url ? safeHostname(row.company_url) : null,
      detail: `${row.position ?? 'Role'} — matched "${matchedKeyword}"`,
      sourceUrl: row.url ?? '',
    });
  }
  return matches;
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

import { sleep as politeSleep } from './http';

// Minimal polite Socrata (SODA) client shared by the registry-based discovery
// sources: small pages, retry with exponential backoff on 429/5xx, and an
// optional free SOCRATA_APP_TOKEN (not required). Throws after 5 attempts or on
// a non-retryable 4xx (our bug, e.g. a bad $where).
export async function socrataGet<T>(host: string, dataset: string, params: Record<string, string>, log: (m: string) => void = () => {}): Promise<T[]> {
  const qs = new URLSearchParams(params).toString();
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'calldesk-outreach-research/1.0 (+https://calldesk.tech)' };
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  let delay = 2000;
  let lastErr = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`https://${host}/resource/${dataset}.json?${qs}`, { headers });
      const text = await res.text();
      if (res.ok) {
        const parsed = JSON.parse(text) as unknown;
        if (Array.isArray(parsed)) return parsed as T[];
        lastErr = 'unexpected response shape';
      } else {
        lastErr = `HTTP ${res.status} ${text.slice(0, 120)}`;
        if (res.status < 500 && res.status !== 429 && !/too many requests/i.test(text)) throw new Error(lastErr);
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (/^HTTP 4/.test(lastErr) && !/HTTP 429/.test(lastErr)) throw e;
    }
    log(`socrata ${host}/${dataset} retry in ${delay}ms (${lastErr})`);
    await politeSleep(delay);
    delay *= 2;
  }
  throw new Error(`socrata ${host}/${dataset} failed after retries: ${lastErr}`);
}

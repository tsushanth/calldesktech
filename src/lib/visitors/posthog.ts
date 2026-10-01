// Read-only access to PostHog's query API for the internal traffic page. Needs a
// personal API key with the "Query: read" scope in POSTHOG_PERSONAL_API_KEY.

export function postHogConfigured(): boolean {
  return !!process.env.POSTHOG_PERSONAL_API_KEY;
}

export async function queryPostHog(hogql: string): Promise<{ columns: string[]; results: unknown[][] }> {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  if (!key) throw new Error('POSTHOG_PERSONAL_API_KEY is not set');
  const host = (process.env.POSTHOG_HOST || 'https://us.posthog.com').replace(/\/$/, '');
  const project = process.env.POSTHOG_PROJECT_ID || '619676';
  const res = await fetch(`${host}/api/projects/${project}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: hogql } }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`PostHog returned ${res.status}: ${detail}`);
  }
  const body = (await res.json()) as { columns?: string[]; results?: unknown[][] };
  return { columns: body.columns || [], results: body.results || [] };
}

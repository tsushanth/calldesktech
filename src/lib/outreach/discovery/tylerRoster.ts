import { parseCsv, rowToObject } from './csvStream';
import { DISCOVERY_UA } from './http';

// Client for the public "License Lookup & Download -> Generate Roster(s)" feature
// of Tyler Technologies "eLicense Online" sites (Ohio's elicense3 / elicense4
// hosts, and the same software at other agencies). It is the agency's own free
// roster download ("No Fee Required" on the page), needing no login or captcha:
//
//   1. GET  /Lookup/GenerateRoster.aspx            -> ASP.NET form + session cookie
//   2. POST the same form with the roster box ticked (and, optionally, the
//      credential-type multi-select) and the Continue button
//      -> redirected to /Lookup/DownloadRoster.aspx listing "<n> records found"
//         and a RosterIdnt for the generated file
//   3. GET  /Lookup/FileDownload.aspx?Idnt=<RosterIdnt>&Type=Comma   (same session)
//      -> the roster as a comma CSV.
//
// Nothing here bypasses a control: it performs exactly the clicks the page
// documents. One roster per run, so the load on the agency is three requests.

export interface TylerRosterOptions {
  host: string; // e.g. 'elicense4.com.ohio.gov'
  // Credential-type option values (the numeric <option value>s of the multi-select);
  // empty means "all types".
  credentialTypeIds?: string[];
  timeoutMs?: number;
  log?: (m: string) => void;
}

const P = 'ctl00$MainContentPlaceHolder$';

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// Every <input type="hidden"> of the ASP.NET page (__VIEWSTATE and friends).
export function hiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]+)"/.exec(m[0])?.[1];
    const value = /value="([^"]*)"/.exec(m[0])?.[1] ?? '';
    if (name) out[name] = decodeEntities(value);
  }
  return out;
}

export function rosterId(downloadPageHtml: string): string | null {
  return /RosterIdnt="(\d+)"/.exec(downloadPageHtml)?.[1] ?? null;
}

export function recordsFound(downloadPageHtml: string): number | null {
  const m = /(\d[\d,]*) records found/.exec(downloadPageHtml);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

export function credentialSelectName(generatePageHtml: string): string | null {
  return /name="(ctl00\$MainContentPlaceHolder\$ucSearchCriteria\d+\$lbMultipleCredentialTypePrefix)"/.exec(generatePageHtml)?.[1] ?? null;
}

class Jar {
  private c = new Map<string, string>();
  absorb(res: Response) {
    const list = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const sc of list) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.c.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header(): string { return [...this.c].map(([k, v]) => `${k}=${v}`).join('; '); }
}

// Returns the roster as an array of header-keyed rows. Throws on any layout
// surprise (no roster id, empty file, HTML instead of CSV) rather than returning
// something partial.
export async function fetchTylerRoster(opts: TylerRosterOptions): Promise<Record<string, string>[]> {
  const jar = new Jar();
  const base = `https://${opts.host}/Lookup`;
  const timeout = opts.timeoutMs ?? 120_000;
  const call = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': DISCOVERY_UA, Cookie: jar.header(), ...(init.headers as Record<string, string> | undefined) },
        signal: controller.signal,
        redirect: 'follow',
      });
      jar.absorb(res);
      return res;
    } finally {
      clearTimeout(timer);
    }
  };

  const page = await call(`${base}/GenerateRoster.aspx`);
  if (!page.ok) throw new Error(`${opts.host} GenerateRoster HTTP ${page.status}`);
  const html = await page.text();
  const form = hiddenFields(html);
  if (!form.__VIEWSTATE) throw new Error(`${opts.host}: roster form not found; layout may have changed`);
  form[`${P}ckbRoster0`] = 'on';
  form[`${P}btnRosterContinue`] = 'Continue';
  const body = new URLSearchParams(form);
  const sel = credentialSelectName(html);
  if (sel) for (const id of opts.credentialTypeIds ?? []) body.append(sel, id);

  const gen = await call(`${base}/GenerateRoster.aspx`, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!gen.ok) throw new Error(`${opts.host} roster generation HTTP ${gen.status}`);
  const genHtml = await gen.text();
  const id = rosterId(genHtml);
  if (!id) throw new Error(`${opts.host}: no roster id after generation; layout may have changed`);
  opts.log?.(`${opts.host}: roster ${id}, ${recordsFound(genHtml) ?? '?'} records`);

  const file = await call(`${base}/FileDownload.aspx?Idnt=${id}&Type=Comma`);
  if (!file.ok) throw new Error(`${opts.host} roster download HTTP ${file.status}`);
  const text = new TextDecoder('latin1').decode(await file.arrayBuffer());
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error(`${opts.host}: roster download returned HTML, not CSV`);
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error(`${opts.host}: roster is empty`);
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((c) => c.trim())).map((r) => rowToObject(header, r.map((c) => c)));
}

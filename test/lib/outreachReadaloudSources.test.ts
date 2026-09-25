import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  orgDomain, isPersonalSite, looksLikePersonName, companyRoleEmail, parseRobots, robotsAllows, detectChallenge, countryOf,
  PoliteHttp, type RaHttp, type HttpResponse, type RaLead,
} from '@/lib/outreach/discovery/readaloud/common';
import { parseCustomerSlugs, extractCustomerSite, nameFromHeading, toCompetitorLead, loadCompetitorCustomers } from '@/lib/outreach/discovery/readaloud/competitorCustomers';
import { evaluateYcCompany, selectYcLeads, type YcCompany } from '@/lib/outreach/discovery/readaloud/ycVoice';
import { orgOwnersFromCodeSearch, orgLoginsFromUserSearch, orgReposFromRepoSearch, toGithubLead, newEvidence, resolveGithubToken, loadGithubOrgs } from '@/lib/outreach/discovery/readaloud/githubOrgs';
import { atsSlugs, parseAtsJobs, boardBelongsTo, matchVoiceRoles, parseHiringComment, jobsAdjust, probeAts, toJobsLead, loadJobsSignal } from '@/lib/outreach/discovery/readaloud/jobsSignal';
import { evaluateWpPlugin, evaluateAmoAddon, loadWpPlugins, loadFirefoxTts } from '@/lib/outreach/discovery/readaloud/marketplaces';
import { evaluateHnLaunch, productNameFromTitle } from '@/lib/outreach/discovery/readaloud/hnLaunches';
import { planReadaloudImport, readaloudLeadRow, sumReadaloudAdjust, importReadaloudSource, isRaSource, RA_SOURCES, type ExistingLead } from '@/lib/outreach/discovery/readaloud/import';
import { readaloud, calldesk, type ProductConfig } from '@/lib/outreach/products';
import { scoreLead } from '@/lib/outreach/discovery/score';

const scoreLeadVocabularyForTest = (description: string, p: ProductConfig) => scoreLead({ tier: null, location: null, description }, undefined, p);

// A fake RaHttp: url -> response (by exact url or by predicate), records calls.
function fakeHttp(routes: [string | RegExp, Partial<HttpResponse> | ((url: string) => Partial<HttpResponse>)][]): RaHttp & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async get(url: string) {
      calls.push(url);
      for (const [m, r] of routes) {
        if (typeof m === 'string' ? m === url : m.test(url)) {
          const v = typeof r === 'function' ? r(url) : r;
          return { ok: v.ok ?? true, status: v.status ?? 200, text: v.text ?? '', headers: v.headers ?? {}, blocked: v.blocked };
        }
      }
      return { ok: false, status: 404, text: '', headers: {} };
    },
  };
}

// ===========================================================================
describe('readaloud common: organisation-only filters', () => {
  it('orgDomain keeps company sites and drops generic hosts', () => {
    expect(orgDomain('https://www.abby.com/')).toBe('abby.com');
    expect(orgDomain('http:&#x2F;&#x2F;livekit.io&#x2F;')).toBe('livekit.io');
    expect(orgDomain('https://careers.telli.com/')).toBe('telli.com');
    expect(orgDomain('https://docs.hyprnote.com/x')).toBe('hyprnote.com');
    expect(orgDomain('https://blog.vapi.ai/post')).toBe('vapi.ai');
    expect(orgDomain('acme.co.uk')).toBe('acme.co.uk');
    expect(orgDomain('https://app.co.uk')).toBe('app.co.uk'); // never strip down to a bare public suffix
    expect(orgDomain('https://coaching.cerebrium.ai/')).toBe('cerebrium.ai');
    expect(orgDomain('https://www.klubi.com.br/')).toBe('klubi.com.br');
    expect(orgDomain('https://shop.acme.com.au')).toBe('acme.com.au');
    expect(orgDomain('https://biggest-decisions-702764.framer.app')).toBeNull();
    expect(orgDomain('https://marketplace.visualstudio.com/items?x=1')).toBeNull();
    for (const g of ['https://github.com/acme', 'https://acme.github.io', 'https://medium.com/@x', 'https://x.vercel.app', 'https://wordpress.org/plugins/x', 'https://jobs.ashbyhq.com/vapi', 'http://10.0.0.1', '', null]) {
      expect(orgDomain(g as string)).toBeNull();
    }
  });

  it('recognises personal sites only when the name is a person AND the domain is that name', () => {
    expect(looksLikePersonName('Jane Doe')).toBe(true);
    expect(looksLikePersonName('Maria de Cruz')).toBe(true);
    expect(looksLikePersonName('Creative-Solutions')).toBe(false);
    expect(looksLikePersonName('LSD Software')).toBe(false);
    expect(isPersonalSite('Jane Doe', 'janedoe.com')).toBe(true);
    expect(isPersonalSite('Azizul Hasan', 'atlasaidev.com')).toBe(false); // a person publishing under a company site is fine
    expect(isPersonalSite('Acme Labs', 'acmelabs.com')).toBe(false);
  });

  it('uses only company-role addresses at the company domain, never personal or free-mail', () => {
    expect(companyRoleEmail('support@lsdsoftware.com', 'lsdsoftware.com')).toBe('support@lsdsoftware.com');
    expect(companyRoleEmail('Hello@Acme.ai', null)).toBe('hello@acme.ai');
    expect(companyRoleEmail('senselius@gmail.com', null)).toBeNull();
    expect(companyRoleEmail('john.smith@acme.ai', 'acme.ai')).toBeNull(); // a person
    expect(companyRoleEmail('support@smartlincorp.com', 'imtranslator.net')).toBeNull(); // someone else's domain
    expect(companyRoleEmail('not-an-email', null)).toBeNull();
  });

  it('countryOf takes the first location', () => {
    expect(countryOf('San Francisco, CA, USA; Remote')).toBe('USA');
    expect(countryOf('Warsaw, Masovian Voivodeship, Poland')).toBe('Poland');
    expect(countryOf(null)).toBeNull();
  });
});

describe('robots.txt and bot challenges', () => {
  it('parses the * group with longest-match precedence', () => {
    const r = parseRobots('User-agent: *\nDisallow: /api/\nAllow: /api/feeds/\nAllow: /api/articles$\n\nUser-agent: Googlebot\nDisallow: /');
    expect(robotsAllows(r, '/customers/abby-connect')).toBe(true);
    expect(robotsAllows(r, '/api/private')).toBe(false);
    expect(robotsAllows(r, '/api/feeds/x')).toBe(true);
    expect(robotsAllows(r, '/api/articles')).toBe(true);
    expect(robotsAllows(r, '/api/articles/1')).toBe(false);
    // api.wordpress.org, 2026-09-25
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow: /'), '/plugins/info/1.2/')).toBe(false);
    expect(parseRobots('User-agent: *\nAllow: /\nCrawl-delay: 1').crawlDelayMs).toBe(1000);
  });

  it('flags challenge pages instead of retrying them', () => {
    expect(detectChallenge({ ok: false, status: 403, text: '<title>Just a moment...</title>', headers: {} })).toMatch(/challenge/);
    expect(detectChallenge({ ok: false, status: 403, text: '', headers: { 'cf-mitigated': 'challenge' } })).toMatch(/Cloudflare/);
    expect(detectChallenge({ ok: false, status: 404, text: 'nope', headers: {} })).toBeNull();
  });

  describe('PoliteHttp', () => {
    afterEach(() => { vi.unstubAllGlobals(); });
    const resp = (status: number, body: string, headers: Record<string, string> = {}) => new Response(body, { status, headers });

    it('refuses a robots-disallowed url without fetching it', async () => {
      const f = vi.fn(async (url: string) => (url.endsWith('/robots.txt') ? resp(200, 'User-agent: *\nDisallow: /') : resp(200, 'SECRET')));
      vi.stubGlobal('fetch', f);
      const r = await new PoliteHttp({ minDelayMs: 0 }).get('https://api.example.org/plugins/info/1.2/?x=1');
      expect(r.ok).toBe(false);
      expect(r.blocked).toMatch(/robots.txt disallows/);
      expect(f.mock.calls.map((c) => c[0])).toEqual(['https://api.example.org/robots.txt']);
    });

    it('treats a 4xx robots.txt as allow-all, a 5xx as disallow', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('a.example') ? (url.endsWith('robots.txt') ? resp(404, '') : resp(200, 'ok')) : resp(503, ''))));
      const http = new PoliteHttp({ minDelayMs: 0 });
      expect((await http.get('https://a.example/x')).text).toBe('ok');
      expect((await http.get('https://b.example/x')).blocked).toMatch(/unavailable/);
    });

    it('backs off on 429 using Retry-After, then succeeds; a challenge is returned blocked, not retried', async () => {
      let n = 0;
      const f = vi.fn(async (url: string) => {
        if (url.endsWith('robots.txt')) return resp(404, '');
        if (url.includes('/cf')) return resp(403, '<html>Just a moment...</html>');
        return ++n === 1 ? resp(429, '', { 'retry-after': '0.01' }) : resp(200, '{"ok":1}');
      });
      vi.stubGlobal('fetch', f);
      const http = new PoliteHttp({ minDelayMs: 0 });
      expect((await http.get('https://c.example/data')).text).toBe('{"ok":1}');
      const cf = await http.get('https://c.example/cf');
      expect(cf.blocked).toMatch(/challenge/);
      expect(f.mock.calls.filter((c) => String(c[0]).includes('/cf'))).toHaveLength(1);
    });
  });
});

// ===========================================================================
// Trimmed from the live pages, 2026-09-25.
const CARTESIA_INDEX = `<a href="/customers/actoncue">x</a><a href="/customers/retell">y</a><a href="https://www.cartesia.ai/customers/actoncue">z</a><a href="/customers/fortune-50-bank">w</a>`;
const CARTESIA_CASE = `<html><head><title>Cartesia | ActOnCue&#39;s AI scene readers moved from ElevenLabs to Sonic 3</title></head><body>
<a href="https://status.cartesia.ai/">s</a><a href="https://play.cartesia.ai/sign-up">u</a><a href="https://luma.com/cartesia">l</a>
<a href="https://x.com/cartesia">x</a><a href="https://www.linkedin.com/company/cartesia-ai/">li</a><a href="https://github.com/cartesia-ai">gh</a>
<h1 class="font-medium">ActOnCue&#39;s AI scene readers moved from ElevenLabs to Sonic 3</h1>
<a href="https://actoncue.com/">ActOnCue</a></body></html>`;
const DEEPGRAM_CASE = `<html><title>Telnyx Powers Real-Time Voice AI at Carrier Scale with Deepgram Flux</title>
<h1>Telnyx Powers Real-Time Voice AI at Carrier Scale with Deepgram Flux</h1>
<a href="https://www.telnyx.com">1</a><a href="https://www.telnyx.com">2</a><a href="https://telnyx.com/products/voice-ai-agents">3</a>
<a href="https://cdn.sanity.io/files/x.pdf">pdf</a><a href="https://www.klubi.com.br/">related story</a>
<a href="https://www.googletagmanager.com/gtm.js?id=GTM">g</a><a href="https://deepgram.com/customers/telnyx">self</a></html>`;

describe('ra-cartesia-customers / ra-deepgram-customers', () => {
  it('lists case-study slugs once each', () => {
    expect(parseCustomerSlugs(CARTESIA_INDEX)).toEqual(['actoncue', 'fortune-50-bank', 'retell']);
  });

  it('follows the case study to the customer website and names it from the heading', () => {
    expect(extractCustomerSite(CARTESIA_CASE, 'cartesia', 'actoncue')).toEqual({ domain: 'actoncue.com', name: 'ActOnCue' });
    expect(extractCustomerSite(DEEPGRAM_CASE, 'deepgram', 'telnyx')).toEqual({ domain: 'telnyx.com', name: 'Telnyx' });
    // A lone link to an unrelated site is not the customer.
    expect(extractCustomerSite('<a href="https://www.klubi.com.br/">x</a>', 'deepgram', 'fortune-50-retail-pharmacy').domain).toBeNull();
    // Only a case-study PDF on the CMS asset host (Deepgram's CallTrackingMetrics page, 2026-09-25).
    const pdf = '<a href="https://www.datocms-assets.com/96965/1-case-study-calltrackingmetrics.pdf">1</a>'.repeat(3);
    expect(extractCustomerSite(pdf, 'deepgram', 'calltrackingmetrics').domain).toBeNull();
  });

  it('falls back to the domain for the name', () => {
    expect(nameFromHeading('Cartesia | How we scaled', 'superdial.com')).toBe('Superdial');
    expect(nameFromHeading('Abby Connect scales high-touch service', 'abby.com')).toBe('Abby');
  });

  it('keeps the vendor as a scoring fact only, never in the draft-visible description', () => {
    const l = toCompetitorLead('deepgram', 'telnyx', { domain: 'telnyx.com', name: 'Telnyx' });
    expect(l.sourceKey).toBe('readaloud:competitor-customer:deepgram:telnyx');
    expect(l.description).toBeNull();
    expect(l.source.facts.vendor).toBe('deepgram');
    expect(l.source.adjust).toBe(25);
    expect(l.signalSource).toBe('directory');
  });

  it('loads politely and skips anonymised case studies', async () => {
    const http = fakeHttp([
      ['https://cartesia.ai/customers', { text: CARTESIA_INDEX }],
      ['https://cartesia.ai/customers/actoncue', { text: CARTESIA_CASE }],
      ['https://cartesia.ai/customers/retell', { text: '<a href="https://www.retellai.com">r</a><a href="https://www.retellai.com/pricing">p</a>' }],
    ]);
    const res = await loadCompetitorCustomers('cartesia', http);
    expect(res.leads.map((l) => l.domain)).toEqual(['actoncue.com', 'retellai.com']);
    expect(res.rejected['anonymised case study']).toBe(1);
    expect(http.calls).not.toContain('https://cartesia.ai/customers/fortune-50-bank');
  });

  it('stops softly when the index is blocked', async () => {
    const res = await loadCompetitorCustomers('deepgram', fakeHttp([['https://deepgram.com/customers', { ok: false, status: 0, blocked: 'bot challenge (HTTP 403); not bypassed' }]]));
    expect(res.leads).toEqual([]);
    expect(res.errors[0]).toMatch(/challenge/);
  });
});

// ===========================================================================
const YC: YcCompany[] = [
  { id: 1, name: 'Vapi', slug: 'vapi', website: 'https://vapi.ai', all_locations: 'San Francisco, CA, USA', one_liner: 'Voice AI for developers.', tags: ['Developer Tools'], batch: 'Winter 2021', status: 'Active', isHiring: true },
  { id: 2, name: 'Deepgram', slug: 'deepgram', website: 'https://www.deepgram.com', one_liner: 'Building foundational AI for speech transcription', tags: ['Speech Recognition'], status: 'Active' },
  { id: 3, name: 'Navattic', slug: 'navattic', website: 'https://www.navattic.com/', one_liner: 'Interactive product demos', long_description: 'Tell your story in your brand voice.', tags: ['Conversational AI'], status: 'Active' },
  { id: 4, name: 'OldCo', slug: 'oldco', website: 'https://oldco.com', one_liner: 'IVR for banks', status: 'Inactive' },
  { id: 5, name: 'CallCo', slug: 'callco', website: 'https://callco.ai', all_locations: 'Bengaluru, KA, India', one_liner: 'Software', long_description: 'We replace call center queues with phone agents.', tags: [], status: 'Active' },
  { id: 6, name: 'Chatty', slug: 'chatty', website: 'https://chatty.ai', one_liner: 'Support chatbot', tags: ['Conversational AI'], long_description: 'Handles phone calls and chat.', status: 'Public' },
  { id: 7, name: 'NoSite', slug: 'nosite', website: '', one_liner: 'Text-to-speech for kids', status: 'Active' },
];

describe('ra-yc-voice', () => {
  it('keeps active voice/speech companies and drops noise', () => {
    expect(evaluateYcCompany(YC[0])).toMatchObject({ keep: true, adjust: 13 });
    expect(evaluateYcCompany(YC[2])).toEqual({ keep: false, reason: 'not voice/speech' }); // "brand voice" + text-chat tag
    expect(evaluateYcCompany(YC[3])).toEqual({ keep: false, reason: 'status Inactive' });
    expect(evaluateYcCompany(YC[5]).keep).toBe(true); // Conversational AI + phone calls
  });

  it('builds leads with the one-liner as description and country as a fact; excludes vendors and site-less', () => {
    const res = selectYcLeads(YC);
    expect(res.leads.map((l) => l.domain)).toEqual(['vapi.ai', 'callco.ai', 'chatty.ai']);
    expect(res.rejected).toMatchObject({ 'speech-API vendor itself': 1, 'no company website': 1, inactive: 1, 'not voice/speech': 1 });
    const callco = res.leads[1];
    expect(callco.sourceKey).toBe('readaloud:yc:callco');
    expect(callco.source.facts.country).toBe('India');
    expect(callco.description).toBe('Software');
  });
});

// ===========================================================================
describe('ra-github-orgs', () => {
  it('keeps Organization owners only from every search shape', () => {
    const code = { items: [
      { repository: { full_name: 'Bitterbot-AI/app', owner: { login: 'Bitterbot-AI', type: 'Organization' } } },
      { repository: { full_name: 'jdoe/side', owner: { login: 'jdoe', type: 'User' } } },
      { repository: { full_name: 'Bitterbot-AI/cli', owner: { login: 'Bitterbot-AI', type: 'Organization' } } },
    ] };
    expect([...orgOwnersFromCodeSearch(code)]).toEqual([['bitterbot-ai', ['Bitterbot-AI/app', 'Bitterbot-AI/cli']]]);
    expect(orgLoginsFromUserSearch({ items: [{ login: 'skit-ai', type: 'Organization' }, { login: 'someone', type: 'User' }] })).toEqual(['skit-ai']);
    expect(orgReposFromRepoSearch({ items: [{ full_name: 'o/r', stargazers_count: 120, owner: { login: 'O', type: 'Organization' } }, { full_name: 'u/r', owner: { login: 'u', type: 'User' } }] }))
      .toEqual([{ login: 'o', repo: 'o/r', stars: 120 }]);
  });

  it('stores only what the org publishes and scores code evidence highest', () => {
    const ev = newEvidence(); ev.apis.add('ElevenLabs'); ev.repos.add('acme/voice');
    const lead = toGithubLead({ login: 'AcmeVoice', name: 'Acme Voice', blog: 'acmevoice.ai', email: 'hello@acmevoice.ai', location: 'Lagos, Nigeria', description: 'Voice agents for banks', public_repos: 12, type: 'Organization' }, ev);
    expect('reject' in lead).toBe(false);
    const l = lead as RaLead;
    expect(l).toMatchObject({ sourceKey: 'readaloud:github:acmevoice', domain: 'acmevoice.ai', email: 'hello@acmevoice.ai', signalSource: 'tech_fingerprint', location: 'Lagos, Nigeria' });
    expect(l.source.adjust).toBe(20);
    expect(Object.keys(l.source.facts)).not.toContain('members');
  });

  it('rejects orgs without a website, personal sites, and marks tiny orgs as hobbyist', () => {
    expect(toGithubLead({ login: 'x', blog: '', email: 'x@gmail.com', public_repos: 3 }, newEvidence())).toEqual({ reject: 'no organisation website' });
    expect(toGithubLead({ login: 'jd', name: 'Jane Doe', blog: 'https://janedoe.com', public_repos: 5 }, newEvidence())).toEqual({ reject: 'personal site' });
    const ev = newEvidence(); ev.viaLocation = 'India';
    const tiny = toGithubLead({ login: 'tinyorg', blog: 'https://tiny.dev', public_repos: 1, email: 'founder@tiny.dev' }, ev) as RaLead;
    expect(tiny.source.adjust).toBe(3 - 10);
    expect(tiny.email).toBeNull(); // a named person's mailbox is not a role address
    expect(tiny.signalSource).toBe('search');
  });

  it('uses GITHUB_TOKEN first', () => {
    expect(resolveGithubToken({ GITHUB_TOKEN: ' abc ' } as NodeJS.ProcessEnv)).toEqual({ token: 'abc', via: 'GITHUB_TOKEN' });
  });

  it('degrades without a token: no code search, clear note', async () => {
    const http = fakeHttp([
      [/search\/users/, { text: JSON.stringify({ items: [{ login: 'VoiceOrg', type: 'Organization' }] }) }],
      [/search\/repositories/, { text: JSON.stringify({ items: [] }) }],
      [/\/orgs\/voiceorg$/, { text: JSON.stringify({ login: 'VoiceOrg', name: 'Voice Org', blog: 'https://voiceorg.in', public_repos: 9, type: 'Organization' }) }],
    ]);
    // Only one location/topic page each is enough for the test; spacing is the fake's concern.
    const res = await loadGithubOrgs(http, { token: null, searchPages: 1 });
    expect(http.calls.some((u) => u.includes('/search/code'))).toBe(false);
    expect(res.notes[0]).toMatch(/unauthenticated/);
    expect(res.leads.map((l) => l.domain)).toEqual(['voiceorg.in']);
  }, 120_000);
});

// ===========================================================================
describe('ra-jobs-signal', () => {
  it('derives plausible ATS slugs, skipping very short ones', () => {
    expect(atsSlugs('Abby Connect', 'abby.com')).toEqual(['abbyconnect', 'abby-connect', 'abby']);
    expect(atsSlugs('AI', 'ai.co')).toEqual([]);
  });

  it('parses Greenhouse, Lever and Ashby boards', () => {
    expect(parseAtsJobs('greenhouse', JSON.stringify({ jobs: [{ title: 'Speech Scientist', absolute_url: 'u', content: '&lt;p&gt;Join PolyAI&lt;/p&gt;' }] })))
      .toEqual([{ title: 'Speech Scientist', url: 'u', text: 'Join PolyAI' }]);
    expect(parseAtsJobs('lever', JSON.stringify([{ text: 'Voice AI Engineer', hostedUrl: 'h', descriptionPlain: 'At Acme' }]))?.[0].title).toBe('Voice AI Engineer');
    expect(parseAtsJobs('ashby', JSON.stringify({ jobs: [{ title: 'TTS Engineer', jobUrl: 'j', isListed: true }, { title: 'Hidden', isListed: false }] }))?.map((j) => j.title)).toEqual(['TTS Engineer']);
    expect(parseAtsJobs('lever', 'not json')).toBeNull();
  });

  it('matches voice roles by title and verifies a derived board belongs to the company', () => {
    const jobs = [
      { title: 'Senior Speech Recognition Engineer', url: null, text: 'Acme builds voice agents at acme.ai' },
      { title: 'Account Executive', url: null, text: '' },
      { title: 'ML Engineer, Text-to-Speech', url: null, text: '' },
    ];
    expect(matchVoiceRoles(jobs).map((j) => j.title)).toEqual(['Senior Speech Recognition Engineer', 'ML Engineer, Text-to-Speech']);
    expect(boardBelongsTo(jobs, { name: 'Acme', domain: 'acme.ai' })).toBe(true);
    expect(boardBelongsTo(jobs, { name: 'Zeta', domain: 'zeta.com' })).toBe(false);
  });

  it('probes ATS boards and rejects a same-slug board of another company', async () => {
    const http = fakeHttp([
      ['https://api.ashbyhq.com/posting-api/job-board/acmevoice', { text: JSON.stringify({ jobs: [{ title: 'Voice Agent Engineer', descriptionPlain: 'Acme Voice (acmevoice.ai) is hiring' }, { title: 'Designer', descriptionPlain: '' }] }) }],
      [/boards-api.greenhouse.io\/v1\/boards\/other/, { text: JSON.stringify({ jobs: [{ title: 'Speech Engineer', content: 'Totally different company' }] }) }],
    ]);
    expect(await probeAts(http, { name: 'Acme Voice', domain: 'acmevoice.ai' })).toEqual({ ats: 'ashby', slug: 'acmevoice', openRoles: 2, voiceRoles: 1, titles: ['Voice Agent Engineer'] });
    expect(await probeAts(http, { name: 'Other', domain: 'other.com' })).toBeNull();
  });

  const HN_TOP = { objectID: '49522950', parent_id: 49522897, story_id: 49522897, comment_text: 'LiveKit|<a href="http:&#x2F;&#x2F;livekit.io&#x2F;" rel="nofollow">http:&#x2F;&#x2F;livekit.io&#x2F;</a>| VoiceAI | webRTC | Remote | Full Time<p>LiveKit is building the infrastructure layer for the voice-driven era of computing. Our platform gives developers everything.<p>Email jane@livekit.io' };
  const HN_REPLY = { objectID: '49524167', parent_id: 49522950, story_id: 49522897, comment_text: 'what platform are you using for Voice AI? see https://myblog.dev' };
  const HN_TELLI = { objectID: '3', parent_id: 1, story_id: 1, comment_text: 'telli (Voice AI)| Engineering, Design, GTM | Berlin<p>check out roles -&gt; <a href="https:&#x2F;&#x2F;careers.telli.com&#x2F;">https:&#x2F;&#x2F;careers.telli.com&#x2F;</a>' };

  it('reads company posts from HN Who is hiring, never replies or personal emails', () => {
    expect(parseHiringComment(HN_TOP)).toEqual({ name: 'LiveKit', domain: 'livekit.io', pitch: 'LiveKit is building the infrastructure layer for the voice-driven era of computing.' });
    expect(parseHiringComment(HN_REPLY)).toBeNull();
    expect(parseHiringComment(HN_TELLI)).toMatchObject({ name: 'telli', domain: 'telli.com' });
    expect(JSON.stringify(parseHiringComment(HN_TOP))).not.toContain('jane@');
  });

  it('scores ATS roles above an HN post and does not double count', () => {
    expect(jobsAdjust({ ats: { ats: 'ashby', slug: 'x', openRoles: 9, voiceRoles: 3, titles: [] } }).adjust).toBe(20);
    expect(jobsAdjust({ hn: { item: '1', thread: 'Who is hiring? (September 2026)' } }).adjust).toBe(12);
    expect(jobsAdjust({ ats: { ats: 'lever', slug: 'x', openRoles: 1, voiceRoles: 1, titles: [] }, hn: { item: '1', thread: 't' } }).adjust).toBe(20);
    const l = toJobsLead({ name: 'Acme', domain: 'acme.ai' }, { ats: { ats: 'lever', slug: 'acme', openRoles: 4, voiceRoles: 1, titles: ['Speech Engineer'] } });
    expect(l).toMatchObject({ sourceKey: 'readaloud:jobs:acme.ai', signalSource: 'job_posting' });
    expect(l.source.facts).toMatchObject({ ats: { voiceRoles: 1, titles: ['Speech Engineer'] } });
  });

  it('combines ATS and HN evidence per domain', async () => {
    const http = fakeHttp([
      ['https://api.ashbyhq.com/posting-api/job-board/vapi', { text: JSON.stringify({ jobs: [{ title: 'Voice Infrastructure Engineer' }] }) }],
      [/search_by_date/, { text: JSON.stringify({ hits: [{ objectID: '1', title: 'Ask HN: Who is hiring? (September 2026)' }, { objectID: '2', title: 'Ask HN: Who wants to be hired? (September 2026)' }] }) }],
      [/story_1/, { text: JSON.stringify({ hits: [{ objectID: '9', parent_id: 1, story_id: 1, comment_text: 'Vapi | <a href="https://vapi.ai">vapi.ai</a> | Speech engineer | SF<p>Vapi is voice AI for developers, used by many teams.' }] }) }],
    ]);
    const res = await loadJobsSignal(http, [], { hnMonths: 1, maxCompanies: 1 });
    const vapi = res.leads.find((l) => l.domain === 'vapi.ai') as RaLead;
    expect(vapi.source.facts).toMatchObject({ ats: { slug: 'vapi', voiceRoles: 1 }, hn: { item: '9' } });
    expect(http.calls.some((u) => u.includes('story_2'))).toBe(false); // "who wants to be hired" is individuals: never read
  });
});

// ===========================================================================
describe('ra-wp-plugins / ra-firefox-tts', () => {
  const now = new Date('2026-09-25T00:00:00Z');
  it('keeps real TTS plugins with 1000+ installs at the publisher domain', () => {
    const l = evaluateWpPlugin({ name: 'GSpeech TTS &#8211; WordPress Text To Speech Plugin', slug: 'gspeech', author: '<a href="https://gspeech.io">Creative-Solutions</a>', homepage: 'https://gspeech.io', active_installs: 3000, last_updated: '2026-08-01 10:00am GMT', short_description: 'Free Text to Speech plugin' }, now) as RaLead;
    expect(l).toMatchObject({ sourceKey: 'readaloud:wp-plugin:gspeech', domain: 'gspeech.io', name: 'Creative-Solutions' });
    expect(evaluateWpPlugin({ name: 'LIQUID SPEECH BALLOON', slug: 'lsb', homepage: 'https://lqd.jp', active_installs: 10000, short_description: 'Create a talk style design' }, now)).toEqual({ reject: 'not a TTS plugin' });
    expect(evaluateWpPlugin({ name: 'Tiny TTS', slug: 't', homepage: 'https://t.io', active_installs: 900, short_description: 'text to speech' }, now)).toEqual({ reject: 'under 1000 active installs' });
    expect(evaluateWpPlugin({ name: 'AI Provider TTS', slug: 'g', homepage: 'https://github.com/WordPress/x', active_installs: 40000, short_description: 'tts' }, now)).toEqual({ reject: 'no publisher website' });
    const stale = evaluateWpPlugin({ name: 'Old TTS', slug: 'o', author: 'Jane Doe', homepage: 'https://oldtts.com', active_installs: 20000, last_updated: '2021-01-01 1:00pm GMT', short_description: 'read aloud' }, now) as RaLead;
    expect(stale.name).toBe('Oldtts'); // a person's display name is not used as the company
    expect(stale.source.adjust).toBe(5 + 5 - 10);
  });

  it('never fetches api.wordpress.org past a robots.txt disallow', async () => {
    const res = await loadWpPlugins(fakeHttp([[/api\.wordpress\.org/, { ok: false, status: 0, blocked: 'robots.txt disallows api.wordpress.org/plugins/info/1.2/' }]]));
    expect(res.leads).toEqual([]);
    expect(res.errors).toHaveLength(1);
  });

  const READ_ALOUD = { slug: 'read-aloud', name: { 'en-US': 'Read Aloud: A Text to Speech Voice Reader' }, summary: { 'en-US': 'Read out loud the current web-page article' }, average_daily_users: 228319, authors: [{ name: 'LSD Software' }], homepage: null, support_email: { 'en-US': 'support@lsdsoftware.com' } };
  it('keeps Firefox TTS add-ons with 5000+ users; a free-mail support address is never the contact', () => {
    const l = evaluateAmoAddon(READ_ALOUD) as RaLead;
    expect(l).toMatchObject({ domain: 'lsdsoftware.com', email: 'support@lsdsoftware.com', name: 'LSD Software', sourceKey: 'readaloud:firefox:read-aloud' });
    expect(l.source.adjust).toBe(15);
    expect(evaluateAmoAddon({ slug: 's3', name: 'S3 TTS', summary: 'text to speech', average_daily_users: 16300, authors: [{ name: 'Oleksandr' }], homepage: { url: { 'en-US': 'http://www.s3blog.org/x.html' } }, support_email: 'senselius@gmail.com' }))
      .toMatchObject({ domain: 's3blog.org', email: null });
    expect(evaluateAmoAddon({ slug: 'pf', name: 'PrintFriendly', summary: 'Print pages', average_daily_users: 50000 })).toEqual({ reject: 'not a TTS add-on' });
    expect(evaluateAmoAddon({ slug: 'x', name: 'TTS', average_daily_users: 4999 })).toEqual({ reject: 'under 5000 daily users' });
  });

  it('pages AMO by users and stops below the threshold', async () => {
    const http = fakeHttp([[/addons\.mozilla\.org/, { text: JSON.stringify({ results: [READ_ALOUD, { slug: 'low', average_daily_users: 100 }], next: 'https://next' }) }]]);
    const res = await loadFirefoxTts(http);
    expect(res.leads).toHaveLength(1);
    expect(http.calls.every((u) => u.includes('page=1'))).toBe(true);
  });
});

// ===========================================================================
describe('ra-hn-launches', () => {
  const now = new Date('2026-09-25T00:00:00Z');
  it('keeps the product site domain only and marks low-traction launches', () => {
    const l = evaluateHnLaunch({ objectID: '1', title: 'Show HN: Listenly – Turn articles into podcasts', url: 'https://listenly.io/', points: 3, created_at: '2026-01-01T00:00:00Z' }, now) as RaLead;
    expect(l).toMatchObject({ domain: 'listenly.io', name: 'Listenly', sourceKey: 'readaloud:hn-launch:listenly.io', signalSource: 'search' });
    expect(l.source.adjust).toBe(-5);
    expect(evaluateHnLaunch({ objectID: '2', title: 'Show HN: X', url: 'https://github.com/a/b', points: 99 }, now)).toEqual({ reject: 'repo / generic host' });
    expect(evaluateHnLaunch({ objectID: '3', title: 'Show HN: I built a voice agent', url: 'https://www.ntik.me/posts/voice-agent', points: 570 }, now)).toEqual({ reject: 'blog post, not a product site' });
    expect(evaluateHnLaunch({ objectID: '4', title: 'Ask HN: alternatives?', url: null }, now)).toEqual({ reject: 'no story url (text post)' });
    expect(evaluateHnLaunch({ objectID: '5', title: 'Show HN: Old', url: 'https://old.ai', created_at: '2020-01-01T00:00:00Z' }, now)).toEqual({ reject: 'launch older than 3 years' });
  });

  it('names the product from the title, falling back to the domain', () => {
    expect(productNameFromTitle('Show HN: Dograh – an OSS Vapi alternative', 'dograh.com')).toBe('Dograh');
    expect(productNameFromTitle('Show HN: I built an AI voice agent for Gmail', 'pocket.computer')).toBe('Pocket');
  });
});

// ===========================================================================
function lead(over: Partial<RaLead> = {}): RaLead {
  return {
    sourceId: 'ra-yc-voice', sourceKey: 'readaloud:yc:acme', name: 'Acme', domain: 'acme.ai', location: 'San Francisco, CA, USA',
    description: 'Realtime voice agents', signalSource: 'directory', signalDetail: 'YC', email: null, emailSourceUrl: null,
    source: { adjust: 10, reasons: ['+10: YC'], facts: { batch: 'W24' } }, ...over,
  };
}

describe('readaloud import: dedupe, merge, idempotence', () => {
  it('builds rows tagged for readaloud in the shared table, with a valid signal_source', () => {
    const row = readaloudLeadRow(lead(), readaloud, '2026-09-25T00:00:00Z');
    expect(row).toMatchObject({ product: 'readaloud', signal_source: 'directory', source_key: 'readaloud:yc:acme', domain: 'acme.ai', region_blocked: false });
    expect(['job_posting', 'review_site', 'tech_fingerprint', 'manual', 'directory', 'search']).toContain(row.signal_source);
    expect(row.signals.readaloud.sources['ra-yc-voice'].adjust).toBe(10);
    expect(row.score).toBe(50 + 10 + 10 + 10); // realtime + voice agent vocabulary + source adjust
    expect(row).not.toHaveProperty('contact_email');
    const withEmail = readaloudLeadRow(lead({ email: 'hello@acme.ai', emailSourceUrl: 'https://x' }), readaloud, 'now');
    expect(withEmail).toMatchObject({ contact_email: 'hello@acme.ai', contact_status: 'found', enriched_at: 'now' });
  });

  it('dedupes on source_key and domain within the batch and against existing leads', () => {
    const existing: ExistingLead[] = [{ id: 'e1', company_name: 'Known', domain: 'known.ai', source_key: 'telephony_platform:known.ai', contact_email: null, score: 60, signals: { reasons: [] } }];
    const plan = planReadaloudImport([
      lead(),
      lead({ sourceKey: 'readaloud:yc:acme' }), // same key
      lead({ sourceKey: 'readaloud:yc:acme2', domain: 'ACME.ai'.toLowerCase() }), // same domain
      lead({ sourceKey: 'readaloud:yc:known', domain: 'known.ai', name: 'Known Inc' }),
      lead({ sourceKey: 'readaloud:yc:de', domain: 'voice.de' }),
    ], existing, new Set());
    expect(plan.inserts.map((r) => r.domain)).toEqual(['acme.ai']);
    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0]).toMatchObject({ id: 'e1', patch: { score: 70 } });
    expect(plan.skipped).toMatchObject({ 'duplicate source_key in batch': 1, 'duplicate domain in batch': 1, 'blocked domain (DE/AT/CH/LI)': 1 });
  });

  it('re-running is a no-op, and updated facts replace (never stack) the score bump', () => {
    const first = planReadaloudImport([lead()], [], new Set(), readaloud, 't0');
    const stored: ExistingLead = { id: 'x', company_name: 'Acme', domain: 'acme.ai', source_key: 'readaloud:yc:acme', contact_email: null, score: first.inserts[0].score, signals: first.inserts[0].signals };
    const again = planReadaloudImport([lead()], [stored], new Set(), readaloud, 't1');
    expect(again.inserts).toHaveLength(0);
    expect(again.merges).toHaveLength(0);
    expect(again.skipped).toEqual({ 'already recorded on existing lead': 1 });
    const changed = planReadaloudImport([lead({ source: { adjust: 13, reasons: ['+13'], facts: { batch: 'W24', hiring: true } } })], [stored], new Set(), readaloud, 't2');
    expect(changed.merges[0].patch.score).toBe(stored.score! + 3);
  });

  it('a merged source keeps the other sources on the lead, and the sum is what enrich re-applies', () => {
    const stored: ExistingLead = { id: 'x', company_name: 'Acme', domain: 'acme.ai', source_key: 'readaloud:yc:acme', contact_email: null, score: 80, signals: { reasons: [], readaloud: { sources: { 'ra-yc-voice': { adjust: 10, reasons: ['+10: YC'], facts: {} } } } } };
    const jobs = lead({ sourceId: 'ra-jobs-signal', sourceKey: 'readaloud:jobs:acme.ai', signalSource: 'job_posting', source: { adjust: 15, reasons: ['+15: hiring'], facts: {} } });
    const plan = planReadaloudImport([jobs], [stored], new Set());
    const sig = plan.merges[0].patch.signals as ExistingLead['signals'];
    expect(Object.keys(sig?.readaloud?.sources ?? {})).toEqual(['ra-yc-voice', 'ra-jobs-signal']);
    expect(sumReadaloudAdjust(sig)).toEqual({ adjust: 25, reasons: ['+10: YC', '+15: hiring'] });
    expect(sumReadaloudAdjust(null)).toEqual({ adjust: 0, reasons: [] });
  });

  it('never attaches a suppressed or already-used address', () => {
    const plan = planReadaloudImport([
      lead({ email: 'support@acme.ai' }),
      lead({ sourceKey: 'readaloud:firefox:b', domain: 'b.io', email: 'hello@b.io' }),
    ], [{ id: 'z', company_name: 'Z', domain: 'z.io', source_key: null, contact_email: 'hello@b.io', score: 50, signals: null }], new Set(['support@acme.ai']));
    expect(plan.skipped['published contact is suppressed']).toBe(1);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).not.toHaveProperty('contact_email');
  });

  it('registers exactly the eight source ids', () => {
    expect(Object.keys(RA_SOURCES).sort()).toEqual(['ra-cartesia-customers', 'ra-deepgram-customers', 'ra-firefox-tts', 'ra-github-orgs', 'ra-hn-launches', 'ra-jobs-signal', 'ra-wp-plugins', 'ra-yc-voice']);
    expect(isRaSource('fl-dfs')).toBe(false);
  });

  it('runs a whole source without a database (dry run) and refuses other products', async () => {
    const http = fakeHttp([[/yc-oss/, { text: JSON.stringify(YC) }]]);
    const sum = await importReadaloudSource(null, 'ra-yc-voice', { http });
    expect(sum).toMatchObject({ dryRun: true, scanned: 7, rows: 3, companies: 3, withWebsite: 3, withEmail: 0, toInsert: 3, inserted: 0 });
    await expect(importReadaloudSource(null, 'ra-yc-voice', { http, product: calldesk })).rejects.toThrow(/PRODUCT=readaloud/);
    await expect(importReadaloudSource(null, 'nope', { http })).rejects.toThrow(/unknown readaloud source/);
  });

  it('writes through leadsTable(readaloud) scoped to product=readaloud, and merges by id', async () => {
    const ops: { op: string; table: string; payload?: unknown; eq?: [string, unknown][] }[] = [];
    const existingRows = [{ id: 'e1', company_name: 'CallCo', domain: 'callco.ai', source_key: null, contact_email: null, score: 55, status: 'new', signals: null }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      from(table: string) {
        const eqs: [string, unknown][] = [];
        const q: Record<string, unknown> = {
          select: () => q, eq: (c: string, v: unknown) => { eqs.push([c, v]); ops.push({ op: 'eq', table, eq: [[c, v]] }); return q; }, order: () => q,
          range: async () => ({ data: table.endsWith('_leads') ? existingRows : [], error: null }),
          insert: async (payload: unknown) => { ops.push({ op: 'insert', table, payload }); return { error: null }; },
          update: (payload: unknown) => ({ eq: async (c: string, v: unknown) => { ops.push({ op: 'update', table, payload, eq: [[c, v]] }); return { error: null }; } }),
        };
        return q;
      },
    };
    const http = fakeHttp([[/yc-oss/, { text: JSON.stringify(YC) }]]);
    const sum = await importReadaloudSource(db, 'ra-yc-voice', { http });
    expect(sum).toMatchObject({ inserted: 2, merged: 1, toInsert: 2, toMerge: 1 });
    expect(ops.find((o) => o.op === 'eq' && o.table === 'calldesk_outreach_leads')?.eq).toEqual([['product', 'readaloud']]);
    const ins = ops.find((o) => o.op === 'insert')!;
    expect(ins.table).toBe('calldesk_outreach_leads');
    expect((ins.payload as { product: string }[]).every((r) => r.product === 'readaloud')).toBe(true);
    expect(ops.find((o) => o.op === 'update')).toMatchObject({ table: 'calldesk_outreach_leads', eq: [['id', 'e1']] });
  });
});

describe('readaloud score vocabulary', () => {
  it('adds the speech-product rule without touching calldesk', () => {
    expect(scoreLeadVocabularyForTest('An open source text-to-speech plugin', readaloud).reasons).toContain('+5: speech synthesis/recognition product');
    expect(scoreLeadVocabularyForTest('An open source text-to-speech plugin', calldesk).reasons).toEqual([]);
  });
});

// Live checks hit the real sites: opt in with RUN_LIVE=1 (never in the normal suite).
describe.skipIf(process.env.RUN_LIVE !== '1')('readaloud sources live (no DB writes)', () => {
  it('YC directory still yields 100+ voice companies', async () => {
    const sum = await importReadaloudSource(null, 'ra-yc-voice');
    expect(sum.rows).toBeGreaterThan(100);
  }, 120_000);
  it('Cartesia index still lists 20+ case studies', async () => {
    const r = await new PoliteHttp().get('https://cartesia.ai/customers', { accept: 'text/html' });
    expect(parseCustomerSlugs(r.text).length).toBeGreaterThan(20);
  }, 60_000);
});

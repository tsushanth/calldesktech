import { describe, it, expect } from 'vitest';
import { RA_SOURCE_IDS, type RaHttp, type HttpResponse, type RaLead } from '@/lib/outreach/discovery/readaloud/common';
import { parseStorySlugs, extractStoryCustomer, toElevenlabsLead, isLargeEnterprise, loadElevenlabsCustomers } from '@/lib/outreach/discovery/readaloud/elevenlabsCustomers';
import { evaluateYcMedia, selectYcMediaLeads, loadYcMedia } from '@/lib/outreach/discovery/readaloud/ycMedia';
import { selectYcLeads, type YcCompany } from '@/lib/outreach/discovery/readaloud/ycVoice';
import { toPublisherLead, newPublisherEvidence, loadGithubPublishers } from '@/lib/outreach/discovery/readaloud/githubPublishers';
import { planReadaloudImport, RA_SOURCES, isRaSource, type ExistingLead } from '@/lib/outreach/discovery/readaloud/import';

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

const INDEX = `<html><body>
<a data-card-link="true" href="/blog/fuzzr"><p>Scaling advertising audio production</p></a>
<a data-card-link="true" href="/blog/finch"><p>Pre-litigation</p></a>
<a href="/blog/meta">Meta</a>
<a href="/blog/elevenlabs-partners-with-ibm-to-bring-premium-voice">IBM</a>
<a href="/blog/fyxer">Fyxer</a>
<a href="/blog/fuzzr">dup</a>
<a href="/blog">blog index</a>
<a href="/docs/overview">docs</a>
</body></html>`;

const story = (h1: string, links: string[], desc = '') =>
  `<html><head><title>${h1}</title><meta name="description" content="${desc}"></head><body><h1>${h1}</h1>
   <a href="https://help.elevenlabs.io/x">help</a><a href="https://compliance.elevenlabs.io">c</a><a href="https://x.com/elevenlabsio">x</a>
   <a href="https://www.linkedin.com/company/elevenlabsio">li</a><a href="https://github.com/elevenlabs">gh</a>
   ${links.map((l) => `<a href="${l}">site</a>`).join('')}</body></html>`;

describe('ra-elevenlabs-customers', () => {
  it('is registered', () => {
    for (const id of ['ra-elevenlabs-customers', 'ra-yc-media', 'ra-github-publishers']) {
      expect(RA_SOURCE_IDS).toContain(id);
      expect(isRaSource(id)).toBe(true);
      expect(RA_SOURCES[id as keyof typeof RA_SOURCES]).toBeTruthy();
    }
  });

  it('parses unique story slugs from the index, ignoring the blog index and docs', () => {
    expect(parseStorySlugs(INDEX)).toEqual(['fuzzr', 'finch', 'meta', 'elevenlabs-partners-with-ibm-to-bring-premium-voice', 'fyxer']);
  });

  it('extracts the customer site and name, ignoring vendor and social links', () => {
    const r = extractStoryCustomer(story('How Fuzzr built voice-powered advertising workflows with ElevenLabs', ['https://www.fuzzr.com.br/']), 'fuzzr');
    expect(r.domain).toBe('fuzzr.com.br');
    expect(r.name).toBe('Fuzzr');
    expect(r.agents).toBe(false);
    const a = extractStoryCustomer(story('Finch scales pre-litigation legal operations with ElevenAgents', ['https://www.finchlegal.com/']), 'finch');
    expect(a.domain).toBe('finchlegal.com');
    expect(a.agents).toBe(true);
  });

  it('finds no site when the page only links the vendor and socials', () => {
    expect(extractStoryCustomer(story('Something', []), 'something').domain).toBeNull();
  });

  it('scores large enterprises down and keeps mid-size names up', () => {
    for (const d of ['meta.com', 'vimeo.com', 'telekom.com', 'twilio.com', 'alpha.gr', 'klarna.com', 'revolut.com', 'deliveroo.com', 'allegro.pl', 'about.meta.com']) {
      expect(isLargeEnterprise(d)).toBe(true);
    }
    expect(isLargeEnterprise('chess.com')).toBe(false);
    const small = toElevenlabsLead('fuzzr', { domain: 'fuzzr.com.br', name: 'Fuzzr', agents: false });
    const big = toElevenlabsLead('klarna', { domain: 'klarna.com', name: 'Klarna', agents: true });
    const chess = toElevenlabsLead('chess-com', { domain: 'chess.com', name: 'Chess.com', agents: false });
    expect(small.source.adjust).toBe(20);
    expect(chess.source.adjust).toBe(20);
    expect(big.source.adjust).toBe(-10);
    expect(big.source.reasons.join(' ')).toMatch(/very large enterprise/);
    expect(big.source.facts.product).toBe('agents');
  });

  it('never carries the vendor in the description, only in facts', () => {
    const l = toElevenlabsLead('fuzzr', { domain: 'fuzzr.com.br', name: 'Fuzzr', agents: false });
    expect(l.description).toBeNull();
    expect(l.source.facts.vendor).toBe('elevenlabs');
    expect(l.sourceKey).toBe('readaloud:competitor-customer:elevenlabs:fuzzr');
    expect(l.sourceId).toBe('ra-elevenlabs-customers');
    expect(l.email).toBeNull();
  });

  it('loads index -> stories -> leads, skipping partner posts and sites it cannot find', async () => {
    const http = fakeHttp([
      ['https://elevenlabs.io/customer-stories', { text: INDEX }],
      ['https://elevenlabs.io/blog/fuzzr', { text: story('How Fuzzr built workflows with ElevenLabs', ['https://www.fuzzr.com.br/']) }],
      ['https://elevenlabs.io/blog/finch', { text: story('Finch scales ops with ElevenAgents', ['https://www.finchlegal.com/']) }],
      ['https://elevenlabs.io/blog/meta', { text: story('Meta uses ElevenLabs', ['https://about.meta.com/']) }],
      ['https://elevenlabs.io/blog/fyxer', { text: story('Fyxer uses ElevenLabs', []) }],
    ]);
    const res = await loadElevenlabsCustomers(http);
    expect(res.leads.map((l) => l.domain).sort()).toEqual(['finchlegal.com', 'fuzzr.com.br', 'meta.com']);
    expect(res.leads.find((l) => l.domain === 'meta.com')?.source.adjust).toBe(-10);
    expect(res.rejected['partner/launch post, not a customer story']).toBe(1);
    expect(res.rejected['no customer website on story']).toBe(1);
    expect(http.calls).not.toContain('https://elevenlabs.io/blog/elevenlabs-partners-with-ibm-to-bring-premium-voice');
  });

  it('stops softly when robots.txt disallows or a challenge is served', async () => {
    const blockedIndex = await loadElevenlabsCustomers(fakeHttp([['https://elevenlabs.io/customer-stories', { ok: false, status: 0, blocked: 'robots.txt disallows elevenlabs.io/customer-stories' }]]));
    expect(blockedIndex.leads).toEqual([]);
    expect(blockedIndex.errors[0]).toMatch(/robots.txt disallows/);
    const http = fakeHttp([
      ['https://elevenlabs.io/customer-stories', { text: INDEX }],
      [/\/blog\/fuzzr$/, { ok: false, status: 0, blocked: 'bot challenge (HTTP 403); not bypassed' }],
    ]);
    const res = await loadElevenlabsCustomers(http);
    expect(res.leads).toEqual([]);
    expect(res.errors.join(' ')).toMatch(/challenge/);
    expect(http.calls.filter((u) => u.includes('/blog/')).length).toBe(1); // stopped after the first challenge
  });
});

// ===========================================================================
const yc = (o: Partial<YcCompany>): YcCompany => ({ id: 1, name: 'Acme', slug: 'acme', website: 'https://www.acme.com', status: 'Active', tags: [], industries: [], one_liner: 'x', batch: 'W24', ...o });

describe('ra-yc-media', () => {
  it('keeps education / gaming / media-audio / accessibility companies and uses their own one-liner', () => {
    const edu = evaluateYcMedia(yc({ industries: ['Education'], tags: ['eLearning'], one_liner: 'Language learning with AI tutors' }));
    expect(edu.keep && edu.segments).toContain('education');
    const game = evaluateYcMedia(yc({ industries: ['Gaming'], tags: ['Gaming'] }));
    expect(game).toMatchObject({ keep: true, adjust: 5 });
    const pod = evaluateYcMedia(yc({ tags: ['Media'], one_liner: 'We turn newsletters into podcasts' }));
    expect(pod).toMatchObject({ keep: true, adjust: 10 });
    const access = evaluateYcMedia(yc({ one_liner: 'Accessibility overlays for dyslexic readers' }));
    expect(access.keep && access.segments).toContain('accessibility');
    const dub = evaluateYcMedia(yc({ one_liner: 'Audiobooks for busy people', tags: ['Media'] }));
    expect(dub.keep && dub.segments).toContain('audio');
  });

  it('rejects inactive, unrelated, betting, and generic media-tag-only companies', () => {
    expect(evaluateYcMedia(yc({ status: 'Inactive', industries: ['Education'] }))).toMatchObject({ keep: false, reason: 'inactive' });
    expect(evaluateYcMedia(yc({ status: 'Acquired', industries: ['Gaming'] })).keep).toBe(false);
    expect(evaluateYcMedia(yc({ industries: ['Fintech'], one_liner: 'Payments for SMBs' })).keep).toBe(false);
    expect(evaluateYcMedia(yc({ tags: ['Media', 'Entertainment'], one_liner: 'A social feed for sports fans' })).keep).toBe(false);
    expect(evaluateYcMedia(yc({ industries: ['Gaming'], tags: ['Gaming'], one_liner: 'Sports betting and casino platform' })).keep).toBe(false);
  });

  it('leaves voice companies to ra-yc-voice, so the two sources never overlap', () => {
    const voice = yc({ slug: 'vc', website: 'https://vc.ai', one_liner: 'Voice AI agents for education', industries: ['Education'], tags: ['Education'] });
    expect(evaluateYcMedia(voice)).toMatchObject({ keep: false, reason: 'owned by ra-yc-voice' });
    const list = [voice, yc({ slug: 'lang', website: 'https://lang.io', industries: ['Education'], tags: ['Education'] })];
    const v = selectYcLeads(list).leads.map((l) => l.sourceKey);
    const m = selectYcMediaLeads(list).leads.map((l) => l.sourceKey);
    expect(v).toEqual(['readaloud:yc:vc']);
    expect(m).toEqual(['readaloud:yc:lang']);
  });

  it('drops companies without an organisation website and vendors', () => {
    const res = selectYcMediaLeads([
      yc({ slug: 'a', website: null, industries: ['Education'] }),
      yc({ slug: 'b', website: 'https://b.github.io', industries: ['Education'] }),
      yc({ slug: 'c', website: 'https://elevenlabs.io', industries: ['Education'] }),
      yc({ slug: 'd', website: 'https://d.com', industries: ['Education'], isHiring: true }),
    ]);
    expect(res.leads.map((l) => l.domain)).toEqual(['d.com']);
    expect(res.leads[0].source.adjust).toBe(8); // +5 industry +3 hiring
    expect(res.leads[0].description).toBe('x');
    expect(res.rejected['no company website']).toBe(2);
  });

  it('plan merges into an existing lead on the same domain instead of double-inserting', () => {
    const leads = selectYcMediaLeads([yc({ slug: 'lang', website: 'https://www.lang.io', industries: ['Education'] }), yc({ slug: 'new', website: 'https://new.io', industries: ['Gaming'] })]).leads;
    const existing: ExistingLead[] = [{ id: 'e1', company_name: 'Lang', domain: 'lang.io', source_key: 'readaloud:wp:lang', contact_email: null, score: 40, signals: { readaloud: { sources: { 'ra-wp-plugins': { adjust: 5, reasons: ['r'], facts: {} } } } } }];
    const plan = planReadaloudImport(leads, existing, new Set());
    expect(plan.inserts.map((r) => r.domain)).toEqual(['new.io']);
    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0].id).toBe('e1');
    const sources = (plan.merges[0].patch.signals as { readaloud: { sources: Record<string, unknown> } }).readaloud.sources;
    expect(Object.keys(sources).sort()).toEqual(['ra-wp-plugins', 'ra-yc-media']);
    // and the same key from ra-yc-voice also merges rather than inserting
    const byKey = planReadaloudImport(leads.slice(0, 1), [{ ...existing[0], domain: 'other.io', source_key: 'readaloud:yc:lang' }], new Set());
    expect(byKey.inserts).toHaveLength(0);
    expect(byKey.merges).toHaveLength(1);
  });

  it('loads from the mirror with a single request and fails soft', async () => {
    const http = fakeHttp([['https://yc-oss.github.io/api/companies/all.json', { text: JSON.stringify([yc({ industries: ['Education'] })]) }]]);
    const res = await loadYcMedia(http);
    expect(http.calls).toHaveLength(1);
    expect(res.leads).toHaveLength(1);
    expect((await loadYcMedia(fakeHttp([]))).errors[0]).toMatch(/YC directory/);
    expect((await loadYcMedia(fakeHttp([[/all\.json/, { text: '<html>' }]]))).errors[0]).toMatch(/invalid JSON/);
  });
});

// ===========================================================================
describe('ra-github-publishers', () => {
  const org = (o: Record<string, unknown>) => ({ login: 'acme-audio', name: 'Acme Audio', type: 'Organization', blog: 'https://acmeaudio.com', description: 'Listen to this article plugin', public_repos: 8, ...o });
  const ev = () => { const e = newPublisherEvidence(); e.labels.add('wordpress text-to-speech'); e.repos.add('acme-audio/listen'); e.maxStars = 150; return e; };

  it('turns an org with its own website into a scored lead using its own description', () => {
    const l = toPublisherLead(org({}), ev()) as RaLead;
    expect(l.sourceId).toBe('ra-github-publishers');
    expect(l.sourceKey).toBe('readaloud:github-publisher:acme-audio');
    expect(l.domain).toBe('acmeaudio.com');
    expect(l.description).toBe('Listen to this article plugin');
    expect(l.source.adjust).toBe(12);
    expect(l.email).toBeNull();
  });

  it('uses only a role mailbox the org publishes on its own domain', () => {
    expect((toPublisherLead(org({ email: 'support@acmeaudio.com' }), ev()) as RaLead).email).toBe('support@acmeaudio.com');
    expect((toPublisherLead(org({ email: 'support@acmeaudio.com' }), ev()) as RaLead).emailSourceUrl).toBe('https://github.com/acme-audio');
    expect((toPublisherLead(org({ email: 'jane.doe@acmeaudio.com' }), ev()) as RaLead).email).toBeNull(); // a person
    expect((toPublisherLead(org({ email: 'jane@gmail.com' }), ev()) as RaLead).email).toBeNull(); // free-mail
    expect((toPublisherLead(org({ email: 'info@someoneelse.com' }), ev()) as RaLead).email).toBeNull(); // not the org's domain
  });

  it('rejects user accounts, personal sites, github.io and orgs with no website', () => {
    expect(toPublisherLead(org({ type: 'User' }), ev())).toEqual({ reject: 'not an organisation' });
    expect(toPublisherLead(org({ blog: 'https://acme-audio.github.io' }), ev())).toEqual({ reject: 'no organisation website' });
    expect(toPublisherLead(org({ blog: '' }), ev())).toEqual({ reject: 'no organisation website' });
    expect(toPublisherLead(org({ name: 'Jane Doe', blog: 'https://janedoe.com' }), ev())).toEqual({ reject: 'personal site' });
    expect(toPublisherLead(org({ blog: 'https://elevenlabs.io' }), ev())).toEqual({ reject: 'speech-API vendor itself' });
  });

  it('marks tiny orgs down', () => {
    const l = toPublisherLead(org({ public_repos: 1 }), ev()) as RaLead;
    expect(l.source.adjust).toBe(2);
  });

  it('searches repositories, keeps org owners only and looks up each org once', async () => {
    const repoPage = JSON.stringify({ items: [
      { full_name: 'acme-audio/listen', stargazers_count: 150, owner: { login: 'Acme-Audio', type: 'Organization' } },
      { full_name: 'jane/tts-plugin', stargazers_count: 900, owner: { login: 'jane', type: 'User' } },
      { full_name: 'solo-org/read', stargazers_count: 3, owner: { login: 'solo-org', type: 'Organization' } },
    ] });
    const http = fakeHttp([
      [/\/search\/repositories\?/, { text: repoPage }],
      ['https://api.github.com/orgs/acme-audio', { text: JSON.stringify(org({ email: 'hello@acmeaudio.com' })) }],
      ['https://api.github.com/orgs/solo-org', { text: JSON.stringify({ login: 'solo-org', name: 'Solo', type: 'Organization', blog: '', email: null }) }],
    ]);
    const res = await loadGithubPublishers(http, { token: 'tkn', searchPages: 1 });
    expect(res.leads.map((l) => l.sourceKey)).toEqual(['readaloud:github-publisher:acme-audio']);
    expect(res.leads[0].email).toBe('hello@acmeaudio.com');
    expect(res.rejected['no organisation website']).toBe(1);
    expect(http.calls.filter((u) => u.includes('/orgs/')).sort()).toEqual(['https://api.github.com/orgs/acme-audio', 'https://api.github.com/orgs/solo-org']);
    expect(http.calls.some((u) => /users\/jane|members|commits|events/.test(u))).toBe(false); // never touches individuals
    const q = decodeURIComponent(http.calls.find((u) => u.includes('/search/repositories'))!);
    expect(q).toMatch(/topic:wordpress-plugin text-to-speech/);
  });

  it('fails soft when GitHub rate-limits or errors', async () => {
    const http = fakeHttp([[/api\.github\.com/, { ok: false, status: 403, text: 'API rate limit exceeded', headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) } }]]);
    const res = await loadGithubPublishers(http, { token: null, searchPages: 1 });
    expect(res.leads).toEqual([]);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors[0]).toMatch(/rate limited/);
  });
});

describe('ra-elevenlabs-customers naming', () => {
  it('prefers the headline name when the domain adds a word', () => {
    expect(extractStoryCustomer(story('Finch scales pre-litigation legal operations with ElevenAgents', ['https://www.finchlegal.com/']), 'finch').name).toBe('Finch');
  });
});

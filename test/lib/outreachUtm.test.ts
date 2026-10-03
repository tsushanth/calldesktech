import { describe, expect, it } from 'vitest';
import { campaignFor, withUtm } from '@/lib/outreach/utm';
import { renderOutreachEmail } from '@/lib/outreach/emailHtml';

const footer = { text: '\n--\nUnsubscribe: https://calldesk.tech/api/unsubscribe/tok', html: '<p><a href="https://calldesk.tech/api/unsubscribe/tok">Unsubscribe</a></p>' };
const sample = { title: 'Freight', lines: [{ speaker: 'caller' as const, text: 'hi' }, { speaker: 'agent' as const, text: 'hello' }], url: 'https://calldesk.tech/samples/freight?t=abc.def', deckUrl: 'https://calldesk.tech/deck?t=abc.def', disclosure: 'AI demo' };

const params = (u: string) => Object.fromEntries(new URL(u.replace(/&amp;/g, '&')).searchParams);

describe('withUtm', () => {
  it('sets the four UTM params and keeps the existing token', () => {
    const out = withUtm('https://calldesk.tech/samples/freight?t=abc.def', { campaign: 'freight', step: 2 });
    expect(params(out)).toEqual({ t: 'abc.def', utm_source: 'outreach', utm_medium: 'email', utm_campaign: 'freight', utm_content: 'step2' });
  });
  it('overwrites stale utm params, defaults a bad step to 1, ignores non-http and junk', () => {
    expect(params(withUtm('https://x.co/?utm_source=old&utm_content=x', { campaign: 'c', step: 0 }))).toMatchObject({ utm_source: 'outreach', utm_content: 'step1' });
    expect(withUtm('mailto:a@b.co', { campaign: 'c', step: 1 })).toBe('mailto:a@b.co');
    expect(withUtm('not a url', { campaign: 'c', step: 1 })).toBe('not a url');
  });
  it('adds utm_term only for a non-personal token, never an email address', () => {
    expect(params(withUtm('https://x.co/', { campaign: 'c', step: 1, term: 'tok123' })).utm_term).toBe('tok123');
    expect(params(withUtm('https://x.co/', { campaign: 'c', step: 1, term: 'a@b.co' })).utm_term).toBeUndefined();
    expect(params(withUtm('https://x.co/', { campaign: 'c', step: 1 })).utm_term).toBeUndefined();
  });
  it('derives the campaign from the product', () => {
    expect(campaignFor('calldesk:freight')).toBe('freight');
    expect(campaignFor('calldesk')).toBe('calldesk');
    expect(campaignFor(undefined)).toBe('calldesk');
    expect(campaignFor('readaloud:api')).toBe('readaloud');
    expect(campaignFor('kreativekoala:voxkey')).toBe('voxkey');
  });
});

describe('renderOutreachEmail with utm', () => {
  const utm = { campaign: 'freight', step: 3 };
  const out = renderOutreachEmail({ bodyText: 'Hi\n\nThere', footer, sample, deckUrl: 'https://calldesk.tech/deck?t=zzz', site: { label: 'calldesk.tech', url: 'https://calldesk.tech' }, utm });

  it('tags the sample, card deck and site links in the HTML', () => {
    const hrefs = [...out.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !h.includes('/unsubscribe/'));
    expect(hrefs).toHaveLength(3); // site, sample button, card deck (standalone deck is suppressed when the card has one)
    for (const h of hrefs) expect(params(h)).toMatchObject({ utm_source: 'outreach', utm_medium: 'email', utm_campaign: 'freight', utm_content: 'step3' });
    expect(out.html).toContain('t=abc.def');
  });
  it('tags the same links in the text alternative', () => {
    const urls = out.text.match(/https:\/\/calldesk\.tech\S*/g)!.filter((u) => !u.includes('/unsubscribe/'));
    expect(urls.length).toBe(3);
    for (const u of urls) expect(params(u)).toMatchObject({ utm_campaign: 'freight', utm_content: 'step3' });
  });
  it('never tags the unsubscribe link and carries no email address in any query', () => {
    expect(out.html).toContain('href="https://calldesk.tech/api/unsubscribe/tok"');
    expect(out.text).toContain('Unsubscribe: https://calldesk.tech/api/unsubscribe/tok');
    expect(out.html + out.text).not.toMatch(/utm_[a-z]+=[^&"\s]*@/);
  });
  it('tags the standalone deck link when there is no sample card', () => {
    const r = renderOutreachEmail({ bodyText: 'Hi', footer, deckUrl: 'https://calldesk.tech/deck?t=zzz', utm });
    expect(params(r.html.match(/href="([^"]*deck[^"]*)"/)![1])).toMatchObject({ t: 'zzz', utm_content: 'step3' });
    expect(r.text).toMatch(/Short deck: https:\/\/calldesk\.tech\/deck\?t=zzz&utm_source=outreach/);
  });
  it('without utm the output is unchanged', () => {
    const plain = renderOutreachEmail({ bodyText: 'Hi', footer, sample, site: { label: 'calldesk.tech', url: 'https://calldesk.tech' } });
    expect(plain.html).toContain('href="https://calldesk.tech/samples/freight?t=abc.def"');
    expect(plain.html).not.toContain('utm_');
  });
});

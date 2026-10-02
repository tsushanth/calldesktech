import { describe, expect, it } from 'vitest';
import { isKnownSpeechApiPayer } from '@/lib/outreach/discovery/pipeline';

describe('isKnownSpeechApiPayer', () => {
  it('is true for Cartesia and Deepgram customer leads', () => {
    expect(isKnownSpeechApiPayer({ signals: { readaloud: { sources: { 'ra-cartesia-customers': {} } } } })).toBe(true);
    expect(isKnownSpeechApiPayer({ signals: { readaloud: { sources: { 'ra-deepgram-customers': {}, 'ra-yc-voice': {} } } } })).toBe(true);
  });
  it('is false for other sources and for leads with no readaloud facts', () => {
    expect(isKnownSpeechApiPayer({ signals: { readaloud: { sources: { 'ra-hn-launches': {}, 'ra-github-orgs': {} } } } })).toBe(false);
    expect(isKnownSpeechApiPayer({ signals: null })).toBe(false);
    expect(isKnownSpeechApiPayer({})).toBe(false);
  });
});

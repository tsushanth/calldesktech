import { describe, it, expect } from 'vitest';
import { checkPriceLed } from '@/lib/outreach/priceLed';

const GOOD_SUBJECT = 'Voice agents from 2 cents a minute, or speech from $0.004';
const GOOD_BODY = 'Listen: https://readaloudai.org/samples/compare/new-voice.mp3 . Hi there,\n\nCalldesk phone agents start at 2 cents a minute, and the readaloudai.org speech API is $0.004 per 1,000 characters for text-to-speech and $0.11 per hour for speech-to-text. Which route fits you? Happy to do a 15-minute call.';

describe('checkPriceLed', () => {
  it('passes a price-led email with both routes', () => { expect(checkPriceLed(GOOD_SUBJECT, GOOD_BODY)).toBeNull(); });
  it('rejects a draft without the platform price', () => { expect(checkPriceLed(GOOD_SUBJECT, GOOD_BODY.replace('2 cents a minute', 'a low rate'))).toMatch(/per-minute/); });
  it('rejects a draft without the speech prices', () => { expect(checkPriceLed(GOOD_SUBJECT, GOOD_BODY.replace('$0.004', 'low').replace('$0.11', 'low'))).toMatch(/speech/); });
  it('rejects a draft without the listen link', () => { expect(checkPriceLed(GOOD_SUBJECT, GOOD_BODY.replace('https://readaloudai.org/samples/compare/new-voice.mp3', ''))).toMatch(/listen link/); });
  it('rejects a subject with no price', () => { expect(checkPriceLed('Quick question', GOOD_BODY)).toMatch(/subject/); });
  it('rejects comparative claims and competitor names', () => {
    expect(checkPriceLed(GOOD_SUBJECT, GOOD_BODY + ' We are the cheapest.')).toMatch(/comparative/);
    expect(checkPriceLed(GOOD_SUBJECT, GOOD_BODY + ' Unlike Deepgram.')).toMatch(/competitor/);
  });
});

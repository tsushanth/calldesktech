import { describe, it, expect } from 'vitest';
import { addSttMinimum, dropRealtimeClaim } from '@/lib/outreach/sttMinimum';

describe('addSttMinimum', () => {
  it('adds the note after the hourly price', () => {
    expect(addSttMinimum('and $0.11 per hour for speech-to-text, with free credits')).toBe('and $0.11 per hour (billed by the second, 10 second minimum per request) for speech-to-text, with free credits');
    expect(addSttMinimum('speech-to-text at $0.11 per hour of audio.')).toBe('speech-to-text at $0.11 per hour of audio (billed by the second, 10 second minimum per request).');
  });
  it('leaves text that already has it or has no hourly price', () => {
    expect(addSttMinimum('$0.11 per hour, 10 second minimum per request')).toBeNull();
    expect(addSttMinimum('from 2 cents a minute')).toBeNull();
  });

  it('drops realtime from claims about our speech API only', () => {
    expect(dropRealtimeClaim('readaloudai.org, a realtime speech-to-text and text-to-speech API')).toBe('readaloudai.org, a speech-to-text and text-to-speech API');
    expect(dropRealtimeClaim('Realtime STT and TTS API access is available now.')).toBe('STT and TTS API access is available now.');
    expect(dropRealtimeClaim('Our realtime speech API runs')).toBe('Our speech API runs');
    expect(dropRealtimeClaim('you build realtime voice products')).toBeNull();
  });
});

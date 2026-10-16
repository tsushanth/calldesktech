import { describe, it, expect } from 'vitest';
import { playbackRemainingMs } from '@/lib/useLiveDemo';

describe('playbackRemainingMs', () => {
  it('is the time left until the scheduled end of playback, rounded up', () => {
    expect(playbackRemainingMs(12.5, 10)).toBe(2500);
    expect(playbackRemainingMs(10.0004, 10)).toBe(1);
  });
  it('is zero when playback has finished or nothing is scheduled', () => {
    expect(playbackRemainingMs(10, 10)).toBe(0);
    expect(playbackRemainingMs(9, 10)).toBe(0);
    expect(playbackRemainingMs(0, 0)).toBe(0);
  });
});

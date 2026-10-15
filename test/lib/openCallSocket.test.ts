import { describe, expect, it } from 'vitest';
import { CANT_START_CALL_MESSAGE, openCallSocket } from '@/lib/voiceEngine';

describe('openCallSocket', () => {
  it('returns the socket when the browser creates it', () => {
    const fake = { readyState: 0 } as unknown as WebSocket;
    expect(openCallSocket('wss://example.test/call', () => fake)).toBe(fake);
  });

  it('passes the URL through unchanged', () => {
    let seen = '';
    openCallSocket('wss://example.test/call', (u) => { seen = u; return {} as WebSocket; });
    expect(seen).toBe('wss://example.test/call');
  });

  it('returns null instead of throwing when the browser refuses the URL (SyntaxError)', () => {
    const refuse = () => { throw new SyntaxError("Failed to construct 'WebSocket': Failed to create a WebSocket: the provided URL is invalid."); };
    expect(openCallSocket('wss://example.test/call', refuse)).toBeNull();
  });

  it('returns null when there is no WebSocket at all', () => {
    const none = () => { throw new ReferenceError('WebSocket is not defined'); };
    expect(openCallSocket('wss://example.test/call', none)).toBeNull();
  });

  it('has a plain visitor message without dashes or jargon', () => {
    expect(CANT_START_CALL_MESSAGE).toMatch(/couldn't start the call/);
    expect(CANT_START_CALL_MESSAGE).not.toMatch(/[–—]|WebSocket|SyntaxError/);
  });
});

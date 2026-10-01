import { describe, it, expect } from 'vitest';
import { initialLiveCallState, nextLiveCallState, LIVE_CALL_WAIT_MS } from '@/lib/liveCall';

const call = (id: string, currentNodeId: string | null = 'greeting') => ({ id, currentNodeId });

describe('nextLiveCallState', () => {
  it('records the calls already live on the first poll and does not claim any of them', () => {
    const s = nextLiveCallState(initialLiveCallState(), [call('other')], 0);
    expect(s.baseline).toEqual(['other']);
    expect(s.status).toBe('waiting');
    expect(s.callId).toBeNull();
    // the same pre-existing call on the next poll is still not ours
    expect(nextLiveCallState(s, [call('other')], 1000).callId).toBeNull();
  });

  it('claims the first call that was not live before and follows its node', () => {
    let s = nextLiveCallState(initialLiveCallState(), [call('other')], 0);
    s = nextLiveCallState(s, [call('other'), call('mine', 'greeting')], 5000);
    expect(s).toMatchObject({ status: 'live', callId: 'mine', nodeId: 'greeting' });
    s = nextLiveCallState(s, [call('other'), call('mine', 'knowledge_base')], 6000);
    expect(s.nodeId).toBe('knowledge_base');
  });

  it('ends when the call leaves the registry, and clears the node', () => {
    let s = nextLiveCallState(initialLiveCallState(), [], 0);
    s = nextLiveCallState(s, [call('mine')], 3000);
    s = nextLiveCallState(s, [], 9000);
    expect(s).toMatchObject({ status: 'ended', nodeId: null });
    // terminal: later polls do not revive it
    expect(nextLiveCallState(s, [call('mine')], 10000).status).toBe('ended');
  });

  it('times out if no new call ever appears', () => {
    let s = nextLiveCallState(initialLiveCallState(), [], 0);
    s = nextLiveCallState(s, [], LIVE_CALL_WAIT_MS - 1);
    expect(s.status).toBe('waiting');
    s = nextLiveCallState(s, [], LIVE_CALL_WAIT_MS + 1);
    expect(s.status).toBe('timeout');
  });

  it('keeps the same object when nothing changed', () => {
    let s = nextLiveCallState(initialLiveCallState(), [], 0);
    s = nextLiveCallState(s, [call('mine', 'a')], 1000);
    expect(nextLiveCallState(s, [call('mine', 'a')], 2000)).toBe(s);
  });
});

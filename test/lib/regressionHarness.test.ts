import { describe, it, expect } from 'vitest';
import { checkSpend, lines, agentText, COST_PER_CALL_USD } from '../../scripts/regression/lib.mjs';
import { SCENARIOS, pick } from '../../scripts/regression/scenarios.mjs';

const log = (agent: string[], duration = 20) => ({ duration_seconds: duration, transcript: agent.flatMap((a) => [{ role: 'assistant', content: a }, { role: 'user', content: 'ok' }]) });

describe('spend gate', () => {
  it('allows a run inside both caps and estimates its cost', () => {
    expect(checkSpend({ wanted: 5, maxCalls: 8, used: 0, total: 60 })).toEqual({ ok: true, estimateUsd: Math.round(5 * COST_PER_CALL_USD * 100) / 100 });
  });
  it('refuses when the run is bigger than --max-calls or would pass the lifetime cap', () => {
    expect(checkSpend({ wanted: 9, maxCalls: 8, used: 0, total: 60 }).ok).toBe(false);
    const r = checkSpend({ wanted: 5, maxCalls: 8, used: 58, total: 60 });
    expect(r.ok).toBe(false);
    expect(String(r.reason)).toMatch(/lifetime cap/);
  });
});

describe('transcript helpers', () => {
  it('maps assistant to agent and drops empty lines', () => {
    const l = lines({ transcript: [{ role: 'assistant', content: ' Hi  there ' }, { role: 'user', content: '' }, { role: 'user', content: 'Hello' }] });
    expect(l).toEqual([{ speaker: 'agent', text: 'Hi there' }, { speaker: 'caller', text: 'Hello' }]);
    expect(agentText(log(['one', 'two']))).toBe('one two');
  });
});

describe('scenarios', () => {
  it('have unique ids, a persona, a version with a start node that exists, and an assert function', () => {
    const ids = new Set<string>();
    for (const s of SCENARIOS) {
      expect(ids.has(s.id)).toBe(false); ids.add(s.id);
      expect(s.persona.length).toBeGreaterThan(20);
      expect(typeof s.assert).toBe('function');
      // A scenario with `prepare` builds its real version at run time; otherwise the static one must be valid.
      if (!s.prepare) expect(s.version.nodes.some((n: { id: string }) => n.id === s.version.startNodeId)).toBe(true);
      if (s.skip) expect(s.skip.length).toBeGreaterThan(10);
    }
  });
  it('pick leaves skipped scenarios out unless asked for by id', () => {
    expect(pick([]).some((s: { skip?: string }) => !!s.skip)).toBe(false);
    expect(pick(['silence-hangup'])).toHaveLength(1);
  });
  it('the silence check-in needs the reminder right after the greeting, not just any two agent lines', () => {
    const sc = SCENARIOS.find((s) => s.id === 'silence-checkin')!;
    const mk = (rows: [string, string][]) => ({ transcript: rows.map(([role, content]) => ({ role, content })) });
    expect(sc.assert(mk([['user', '[Call connected]'], ['assistant', 'Hello, welcome.'], ['assistant', 'Are you still there?']]))).toEqual([]);
    expect(sc.assert(mk([['user', '[Call connected]'], ['assistant', 'Hello, welcome.'], ['user', 'I need a haircut'], ['assistant', 'Sure, what day?']]))).not.toEqual([]);
  });
  it('pick rejects unknown ids', () => {
    expect(() => pick(['nope'])).toThrow(/unknown scenario/);
    expect(pick(['handbook-secret'])).toHaveLength(1);
  });
  it('assertions catch the failure they are about and pass the good case', () => {
    const by = (id: string) => SCENARIOS.find((s) => s.id === id)!;
    expect(by('handbook-secret').assert(log(['The code is ZEBRA-42.']))).toEqual([]);
    expect(by('handbook-secret').assert(log(['No idea.']))).not.toEqual([]);
    expect(by('exact-greeting').assert(log(['Welcome to Quillbert Hardware, this call is recorded for quality.']))).toEqual([]);
    expect(by('exact-greeting').assert(log(['Hello, how can I help?']))).not.toEqual([]);
    expect(by('variables').assert(log(['You are speaking with Zephyr Dental.']))).toEqual([]);
    expect(by('variables').assert(log(['This is {{business_name}}.']))).not.toEqual([]);
    expect(by('single-prompt-hours').assert(log(['We close at 3 PM.']))).toEqual([]);
    expect(by('max-duration').assert(log(['hi'], 31))).toEqual([]);
    expect(by('max-duration').assert(log(['hi'], 140))).not.toEqual([]);
    expect(by('max-duration').assert(log(['hi'], 3))).not.toEqual([]);
    expect(by('extraction-flow').assert(log(['Thanks Priya, your haircut is booked.']))).toEqual([]);
    expect(by('extraction-flow').assert(log(['Thanks, you are booked.']))).not.toEqual([]);
  });
});

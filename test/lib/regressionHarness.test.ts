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
      // Outbound scenarios have no AI shopper (a scripted receiver answers), so no persona.
      if (!s.outbound) expect(s.persona.length).toBeGreaterThan(20);
      else expect(['ivr', 'voicemail', 'silent']).toContain(s.outbound.mode);
      expect(typeof s.assert).toBe('function');
      // A scenario with `prepare` builds its real version at run time; otherwise the static one must be valid.
      if (!s.prepare) expect(s.version.nodes.some((n: { id: string }) => n.id === s.version.startNodeId)).toBe(true);
      if (s.skip) expect(s.skip.length).toBeGreaterThan(10);
    }
  });
  it('pick leaves skipped scenarios out unless asked for by id', () => {
    expect(pick([]).some((s: { skip?: string }) => !!s.skip)).toBe(false);
    expect(pick(['silence-hangup'])).toHaveLength(1); // no scenario is skipped today; the mechanism stays for future ones
  });
  it('the silence check-in needs the reminder right after the greeting, not just any two agent lines', () => {
    const sc = SCENARIOS.find((s) => s.id === 'silence-checkin')!;
    const mk = (rows: [string, string][]) => ({ transcript: rows.map(([role, content]) => ({ role, content })) });
    expect(sc.assert(mk([['user', '[Call connected]'], ['assistant', 'Hello, welcome.'], ['assistant', 'Are you still there?']]))).toEqual([]);
    expect(sc.assert(mk([['user', '[Call connected]'], ['assistant', 'Hello, welcome.'], ['user', 'I need a haircut'], ['assistant', 'Sure, what day?']]))).not.toEqual([]);
  });
  it('the webhook scenario accepts any spoken form of the returned times but needs the webhook call', () => {
    const sc = SCENARIOS.find((s) => s.id === 'webhook-function')!;
    const ev = [{ kind: 'hook', body: JSON.stringify({ function: 'check_availability', collectedData: {} }) }];
    expect(sc.assert(log(['We have 10 in the morning or 2 in the afternoon.']), { events: ev })).toEqual([]);
    expect(sc.assert(log(['We have ten o\'clock or two pm.']), { events: ev })).toEqual([]);
    expect(sc.assert(log(['We have 10 in the morning or 2 in the afternoon.']), { events: [] })).not.toEqual([]);
    expect(sc.assert(log(['Nothing is available.']), { events: ev })).not.toEqual([]);
  });
  it('the MCP scenario needs all three protocol calls, the header, and the result', () => {
    const sc = SCENARIOS.find((s) => s.id === 'mcp-tool')!;
    const ev = (extra: object[] = []) => [
      { kind: 'mcp', body: JSON.stringify({ method: 'initialize' }), headers: { authorization: 'Bearer regression-token' } },
      { kind: 'mcp', body: JSON.stringify({ method: 'notifications/initialized' }), headers: {} },
      { kind: 'mcp', body: JSON.stringify({ method: 'tools/call', params: { name: 'lookup_order', arguments: { id: 'A-77' } } }), headers: {} },
      ...extra,
    ];
    expect(sc.assert(log(['It should arrive Tuesday.']), { events: ev() })).toEqual([]);
    expect(sc.assert(log(['It should arrive Tuesday.']), { events: ev().slice(0, 2) })).not.toEqual([]);
    expect(sc.assert(log(['No idea.']), { events: ev() })).not.toEqual([]);
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

describe('outbound scenarios', () => {
  const ev = (digits: string | null) => [{ kind: 'twiml' }, ...(digits === null ? [] : [{ kind: 'dtmf', body: JSON.stringify({ digits }) }])];
  const sc = (id: string) => SCENARIOS.find((s) => s.id === id)!;
  it('dtmf needs the exact digits at the menu', () => {
    expect(sc('dtmf-ivr').assert({}, { events: ev('214') })).toEqual([]);
    expect(sc('dtmf-ivr').assert({}, { events: ev('999') })).not.toEqual([]);
    expect(sc('dtmf-ivr').assert({}, { events: ev(null) })).not.toEqual([]);
    expect(sc('dtmf-ivr').assert({}, { events: [] })).not.toEqual([]);
  });
  it('voicemail hang-up needs outcome voicemail and a short call', () => {
    expect(sc('voicemail-hangup').assert({ outcome: 'voicemail', duration_seconds: 14 }, { events: ev(null) })).toEqual([]);
    expect(sc('voicemail-hangup').assert({ outcome: 'answered', duration_seconds: 14 }, { events: ev(null) })).not.toEqual([]);
    expect(sc('voicemail-hangup').assert({ outcome: 'voicemail', duration_seconds: 90 }, { events: ev(null) })).not.toEqual([]);
  });
  it('voicemail message must be spoken', () => {
    const t = (c: string) => ({ outcome: 'voicemail', transcript: [{ role: 'assistant', content: c }] });
    expect(sc('voicemail-message').assert(t('Hi, this is Acme Dental calling about your appointment tomorrow.'))).toEqual([]);
    expect(sc('voicemail-message').assert(t('Hello?'))).not.toEqual([]);
  });
  it('silence hang-up needs a call roughly 8s long', () => {
    expect(sc('silence-hangup').assert({ duration_seconds: 14 }, { events: ev(null) })).toEqual([]);
    expect(sc('silence-hangup').assert({ duration_seconds: 58 }, { events: ev(null) })).not.toEqual([]);
  });
});

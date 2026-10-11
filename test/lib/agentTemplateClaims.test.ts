import { describe, it, expect } from 'vitest';
import { AGENT_TEMPLATES } from '@/lib/agentTemplates';

// A live agent can repeat anything in a template's prompts, flows or knowledge-base seeds to a caller.
// Calldesk makes no HIPAA, SOC 2, BAA, DPA or encryption claim, does not offer SIP trunking, and has no
// Salesforce sync. These must never appear as affirmative claims in template text.
const BANNED: Array<[string, RegExp]> = [
  ['HIPAA-compliant / compliant configurations', /hipaa[- ]compliant|compliant configuration/i],
  ['BAA', /\bBAAs?\b/i],
  ['SOC 2', /soc[- ]?[23]\b/i],
  ['encryption claim', /encrypted (in transit|at rest)|encryption at rest/i],
  ['DPA', /\bDPA\b|data processing (agreement|addendum)/i],
  ['SIP trunking offered', /sip trunking (connects|is supported|is available)|supports? sip trunking/i],
  ['Salesforce integration', /salesforce/i],
  ['uptime / SLA claim', /\b\d{2}\.\d+% uptime|uptime (guarantee|sla)|\bSLA\b/i],
  ['free trial', /free trial/i],
];

describe('agent templates make no unsupported claims', () => {
  // FAQ question strings may legitimately repeat what callers ask ("Is the platform HIPAA compliant?"); the answers must not
  // affirm it. Knowledge-base seeds are stored as JSON strings inside node params, so parse those too.
  const strings: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (/^\s*[[{]/.test(v)) {
        try { walk(JSON.parse(v)); return; } catch { /* plain text */ }
      }
      strings.push(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) if (k !== 'question') walk(x);
    }
  };
  walk(AGENT_TEMPLATES);
  const text = strings.join('\n');

  it('loads templates', () => {
    expect(AGENT_TEMPLATES.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(1000);
  });

  for (const [label, re] of BANNED) {
    it(`contains no ${label} claim`, () => {
      const m = re.exec(text);
      expect(m ? text.slice(Math.max(0, m.index - 80), m.index + 120) : null).toBeNull();
    });
  }
});

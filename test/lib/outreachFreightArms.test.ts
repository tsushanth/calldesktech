import { beforeEach, describe, expect, it, vi } from 'vitest';

const cliComplete = vi.fn();
vi.mock('@/lib/outreach/llm', async (orig) => ({ ...(await orig<typeof import('@/lib/outreach/llm')>()), cliComplete: (...a: unknown[]) => cliComplete(...a), usingCli: () => true, usingApi: () => false }));

import { draftAgencyEmail, draftFollowUpEmail } from '@/lib/outreach/agencyDraft';
import { freight, dental, homeservices, resolveArmPrompts } from '@/lib/outreach/products';

const input = { name: 'Acme Freight LLC', location: 'Cole Camp, MO', description: 'Listed in the FMCSA registry with active property broker authority (MC-1).', product: freight };

beforeEach(() => {
  cliComplete.mockReset();
  cliComplete.mockReturnValue('{"subject":"S","body":"Hi there,\\n\\nB"}');
});

describe('freight experiment arms', () => {
  it('free_week is the default offer; demo asks for a 15-minute demo and never mentions the pilot', () => {
    const fw = resolveArmPrompts(freight, 'free_week');
    expect(fw.offerFacts).toEqual(freight.offerFacts);
    expect(fw.systemPrompt).toBe(freight.systemPrompt);
    expect(resolveArmPrompts(freight, undefined)).toMatchObject({ offerFacts: freight.offerFacts, systemPrompt: freight.systemPrompt });
    expect(resolveArmPrompts(freight, 'nonsense').systemPrompt).toBe(freight.systemPrompt);

    const demo = resolveArmPrompts(freight, 'demo');
    const facts = demo.offerFacts.join(' ');
    expect(facts).toMatch(/15-minute call/);
    expect(facts).toMatch(/run live by us \(people\), not an automated call/);
    expect(facts).not.toMatch(/pilot|free for|50 minutes|no credit card|forward/i);
    expect(demo.systemPrompt).toMatch(/15-minute demo/);
    expect(demo.systemPrompt).toMatch(/Do NOT mention a free trial, pilot/);
    expect(demo.systemPrompt).not.toMatch(/ONE WEEK/);
    expect(demo.followUpSystemPrompt).toMatch(/15-minute demo/);
    expect(demo.followUpSystemPrompt).toMatch(/Do NOT mention a trial, pilot/);
    // the free_week arm still says one week
    expect(fw.systemPrompt).toMatch(/ONE WEEK/);
    expect(fw.offerFacts.join(' ')).toMatch(/free pilot of one week, capped at 50 minutes/);
  });
  it('other verticals have no arms and ignore an arm argument', () => {
    expect(dental.arms).toBeUndefined();
    expect(homeservices.arms).toBeUndefined();
    expect(resolveArmPrompts(dental, 'demo')).toMatchObject({ offerFacts: dental.offerFacts, systemPrompt: dental.systemPrompt });
  });
  it('the drafter uses the arm prompts for first touches and follow-ups', async () => {
    await draftAgencyEmail({ ...input, arm: 'demo' });
    let prompt = cliComplete.mock.calls[0][0] as string;
    expect(prompt).toMatch(/15-minute demo/);
    expect(prompt).not.toMatch(/free pilot of one week/);

    cliComplete.mockClear();
    await draftAgencyEmail({ ...input, arm: 'free_week' });
    prompt = cliComplete.mock.calls[0][0] as string;
    expect(prompt).toMatch(/free pilot of one week, capped at 50 minutes of calls, no credit card/);
    expect(prompt).not.toMatch(/15-minute call with us/);

    cliComplete.mockClear();
    await draftAgencyEmail(input); // no arm: unchanged default
    expect(cliComplete.mock.calls[0][0] as string).toMatch(/free pilot of one week/);

    cliComplete.mockClear();
    await draftFollowUpEmail({ ...input, arm: 'demo', previousSubject: 'Help', step: 2, isFinal: false });
    prompt = cliComplete.mock.calls[0][0] as string;
    expect(prompt).toMatch(/earlier request for a 15-minute demo/);
    expect(prompt).not.toMatch(/pilot terms exactly as in the offer facts/);
  });
  it('other verticals draft exactly as before (two-week pilot) even if an arm is passed', async () => {
    await draftAgencyEmail({ name: 'Smile Dental', location: 'Austin, TX', description: 'd', product: dental, arm: 'demo' });
    const prompt = cliComplete.mock.calls[0][0] as string;
    expect(prompt).toMatch(/free for two weeks, capped at 50 minutes/);
    expect(prompt).not.toMatch(/15-minute call with us/);
  });
});

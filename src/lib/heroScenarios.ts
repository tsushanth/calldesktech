// Example calls shown in the landing hero. They are illustrations of what the
// agent does, written for this page, not recordings of real customers; the
// panel labels them "Example call".
export interface HeroScenario {
  id: string;
  /** Short label on the scenario tab. */
  tab: string;
  headline: string;
  /** Business and time of day shown above the call. */
  meta: string;
  lines: { who: 'caller' | 'agent'; text: string }[];
  /** What the agent did with the call. */
  outcome: string;
}

export const HERO_SCENARIOS: HeroScenario[] = [
  {
    id: 'dental',
    tab: 'Dental clinic',
    headline: 'Booked while the front desk was closed.',
    meta: 'Dental clinic, 6:40 pm',
    lines: [
      { who: 'caller', text: 'Hi, do you have anything Tuesday morning for a cleaning?' },
      { who: 'agent', text: 'We do. I have 10:30 open. Can I get your name?' },
      { who: 'caller', text: 'Dana Reyes.' },
      { who: 'agent', text: "Thanks, Dana. You're booked for Tuesday at 10:30." },
    ],
    outcome: 'Appointment booked, Tuesday 10:30',
  },
  {
    id: 'plumbing',
    tab: 'Plumber',
    headline: 'Answered at 2 a.m., with the address.',
    meta: 'Plumbing company, 2:07 am',
    lines: [
      { who: 'caller', text: 'My basement is flooding, I need someone now.' },
      { who: 'agent', text: "I'm sorry, that's urgent. What's the address?" },
      { who: 'caller', text: '48 Alder Street.' },
      { who: 'agent', text: "Got it. I'm connecting you to the on-call plumber now." },
    ],
    outcome: 'Transferred to the on-call plumber',
  },
  {
    id: 'salon',
    tab: 'Hair salon',
    headline: 'Answers the questions that interrupt the work.',
    meta: 'Hair salon, 11:15 am',
    lines: [
      { who: 'caller', text: 'Are you open Sundays? And do you do balayage?' },
      { who: 'agent', text: "We're open Sunday from 10 to 4, and yes, we do balayage. Want me to find you a time?" },
      { who: 'caller', text: "Not yet, I'll check my calendar." },
      { who: 'agent', text: 'No problem. Call any time, we answer every call.' },
    ],
    outcome: 'Questions answered, no staff interrupted',
  },
  {
    id: 'law',
    tab: 'Law office',
    headline: 'Takes the message, then gets it to you.',
    meta: 'Law office, 3:30 pm',
    lines: [
      { who: 'caller', text: 'I need to talk to someone about a lease dispute.' },
      { who: 'agent', text: 'The attorneys are in court this afternoon. May I take your name and number for a callback?' },
      { who: 'caller', text: "It's Marcus, 555 0142." },
      { who: 'agent', text: "Thank you, Marcus. I've passed that on, and someone will call you back." },
    ],
    outcome: 'Message taken for a callback',
  },
];

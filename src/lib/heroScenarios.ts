// Example calls shown in the landing hero. They are illustrations of what the
// agent does, written for this page, not recordings of real customers, and the
// footage is licensed stock. Neither is labelled on the page.
//
// `id` is also the key of the matching clips in src/data/heroPool.json.
export interface HeroScenario {
  id: string;
  /** Short label on the scenario tab. */
  tab: string;
  headline: string;
  /** Business and time of day shown above the call. */
  meta: string;
  /** What the person in the footage is doing, shown on the video. */
  caption: string;
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
    caption: 'The caller',
    lines: [
      { who: 'caller', text: 'Hi, do you have anything Tuesday morning for a cleaning?' },
      { who: 'agent', text: 'We do. I have 10:30 open. Can I get your name?' },
      { who: 'caller', text: 'Dana Reyes.' },
      { who: 'agent', text: "Thanks, Dana. You're booked for Tuesday at 10:30." },
    ],
    outcome: 'Appointment booked, Tuesday 10:30',
  },
  {
    id: 'contractor',
    tab: 'Equipment rental',
    headline: 'Answered on the job site.',
    meta: 'Equipment rental, 7:12 am',
    caption: 'The caller',
    lines: [
      { who: 'caller', text: 'Do you have a 20-ton excavator free on Thursday?' },
      { who: 'agent', text: 'We do. Is that for a day or a week?' },
      { who: 'caller', text: 'Just Thursday. The site is on Route 9.' },
      { who: 'agent', text: "Booked for Thursday. Dispatch will confirm a delivery window." },
    ],
    outcome: 'Rental booked, Thursday',
  },
  {
    id: 'frontdesk',
    tab: 'Clinic front desk',
    headline: 'The second line, answered.',
    meta: 'Clinic front desk, 4:45 pm',
    caption: 'Your receptionist, on another call',
    lines: [
      { who: 'caller', text: 'Hi, I need to move my appointment.' },
      { who: 'agent', text: "Of course. What's your name and the current date?" },
      { who: 'caller', text: 'Lee Park, this Friday at 2.' },
      { who: 'agent', text: "Thanks, Lee. I can offer Monday at 10 or Tuesday at 3." },
    ],
    outcome: 'Appointment rescheduled',
  },
  {
    id: 'salon',
    tab: 'Hair salon',
    headline: 'Answers the questions that interrupt the work.',
    meta: 'Hair salon, 11:15 am',
    caption: 'On the phone at the salon',
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
    caption: 'The caller',
    lines: [
      { who: 'caller', text: 'I need to talk to someone about a lease dispute.' },
      { who: 'agent', text: 'The attorneys are in court this afternoon. May I take your name and number for a callback?' },
      { who: 'caller', text: "It's Jordan, 555 0142." },
      { who: 'agent', text: "Thank you, Jordan. I've passed that on, and someone will call you back." },
    ],
    outcome: 'Message taken for a callback',
  },
  {
    id: 'owner',
    tab: 'Small shop',
    headline: 'Orders taken while your hands are full.',
    meta: 'Small shop, 10:05 am',
    caption: 'The owner, hands full',
    lines: [
      { who: 'caller', text: 'Do you still have the large blue planter?' },
      { who: 'agent', text: 'We do, two left. Want me to set one aside?' },
      { who: 'caller', text: "Yes please. It's for Sam, I'll pick it up at five." },
      { who: 'agent', text: 'Done. A large blue planter is held for Sam until five.' },
    ],
    outcome: 'Item held for pickup',
  },
];

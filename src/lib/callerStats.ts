import { OUTCOMES_ASKING_DECISION_MAKER, WIN_OUTCOMES, decisionMakerOf } from '@/lib/callerPortal';

// Supervisor statistics for the cold-calling line: per day, per segment (what kind of company was called) and per hour of the
// day, from the daily batches (outcomes the caller logged) and the call log (what the phone line actually did). Pure functions,
// so they are unit tested; the endpoint only fetches rows and calls these.

export interface BatchRow { batch_date: string; sip_username: string; phone: string; outcome: string | null; notes: string | null; lead_id: string | null }
export interface CallRow { sip_username: string; to_number: string; status: string; answered: boolean | null; duration_seconds: number | null; started_at: string; outcome: string | null }

export interface Stat {
  label: string;
  numbers: number; // numbers in the batches
  dials: number; // calls placed (blocked dials are not counted)
  connected: number; // a person or machine picked up
  voicemail: number;
  no_answer: number;
  gatekeeper: number;
  not_interested: number;
  wrong_number: number;
  people_reached: number; // a person spoke to the caller
  decision_maker: number; // of those, the caller said it was the owner or decision maker
  wins: number;
  avg_talk_seconds: number; // average length of connected calls
  logged: number;
}

const WIN = new Set<string>(WIN_OUTCOMES as readonly string[]);
const PEOPLE = new Set<string>(OUTCOMES_ASKING_DECISION_MAKER as readonly string[]);

export function segmentLabel(product: string | null | undefined): string {
  if (!product) return 'Unknown';
  if (product === 'calldesk') return 'Resellers and agencies';
  if (product === 'readaloud:api' || product === 'readaloud') return 'Speech-API leads';
  const v = product.replace(/^calldesk:/, '');
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function empty(label: string): Stat {
  return { label, numbers: 0, dials: 0, connected: 0, voicemail: 0, no_answer: 0, gatekeeper: 0, not_interested: 0, wrong_number: 0, people_reached: 0, decision_maker: 0, wins: 0, avg_talk_seconds: 0, logged: 0 };
}

const easternDate = (iso: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
const easternHour = (iso: string) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));

/** Adds one batch row's outcome to a stat. */
function addOutcome(s: Stat, b: BatchRow) {
  s.numbers++;
  if (!b.outcome) return;
  s.logged++;
  if (b.outcome === 'voicemail') s.voicemail++;
  else if (b.outcome === 'no_answer') s.no_answer++;
  else if (b.outcome === 'gatekeeper') s.gatekeeper++;
  else if (b.outcome === 'not_interested') s.not_interested++;
  else if (b.outcome === 'wrong_number') s.wrong_number++;
  if (PEOPLE.has(b.outcome)) {
    s.people_reached++;
    if (decisionMakerOf(b.notes) === true) s.decision_maker++;
  }
  if (WIN.has(b.outcome)) s.wins++;
}

function addCall(s: Stat, c: CallRow, talk: number[]) {
  if (c.status === 'rejected') return;
  s.dials++;
  if (c.answered) { s.connected++; if (c.duration_seconds) talk.push(c.duration_seconds); }
}

const finish = (s: Stat, talk: number[]): Stat => ({ ...s, avg_talk_seconds: talk.length ? Math.round(talk.reduce((a, b) => a + b, 0) / talk.length) : 0 });

export function aggregate(batch: BatchRow[], calls: CallRow[], productByLead: Map<string, string>) {
  const real = calls.filter((c) => c.outcome !== 'test');

  // Per day: outcomes from the batch for that date, dials from the calls that started on that Eastern date.
  const dayKeys = [...new Set([...batch.map((b) => b.batch_date), ...real.map((c) => easternDate(c.started_at))])].sort().reverse();
  const days = dayKeys.map((d) => {
    const s = empty(d); const talk: number[] = [];
    for (const b of batch) if (b.batch_date === d) addOutcome(s, b);
    for (const c of real) if (easternDate(c.started_at) === d) addCall(s, c, talk);
    return finish(s, talk);
  });

  // Per segment: the segment of a number is the product of its lead; calls are matched to the number they dialled.
  const segOfPhone = new Map<string, string>();
  for (const b of batch) segOfPhone.set(`${b.sip_username}|${b.phone}`, segmentLabel(b.lead_id ? productByLead.get(b.lead_id) : null));
  const segs = new Map<string, { s: Stat; talk: number[] }>();
  const seg = (name: string) => segs.get(name) ?? (segs.set(name, { s: empty(name), talk: [] }), segs.get(name)!);
  for (const b of batch) addOutcome(seg(segOfPhone.get(`${b.sip_username}|${b.phone}`)!).s, b);
  for (const c of real) {
    const name = segOfPhone.get(`${c.sip_username}|${c.to_number}`);
    if (name) { const g = seg(name); addCall(g.s, c, g.talk); }
  }
  const segments = [...segs.values()].map((g) => finish(g.s, g.talk)).sort((a, b) => b.dials - a.dials);

  // Per hour (US Eastern, the callers' working hours): dials and connects.
  const hourMap = new Map<number, { dials: number; connected: number }>();
  for (const c of real) {
    if (c.status === 'rejected') continue;
    const h = easternHour(c.started_at);
    const e = hourMap.get(h) ?? { dials: 0, connected: 0 };
    e.dials++; if (c.answered) e.connected++;
    hourMap.set(h, e);
  }
  const hours = [...hourMap.entries()].sort((a, b) => a[0] - b[0]).map(([hour, v]) => ({ hour, ...v }));
  return { days, segments, hours };
}

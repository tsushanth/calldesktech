import type { FlowNode } from '@/types';

// Does this flow mean to book appointments? Used to warn (never block) when an agent is published, or edited, with that intent
// but no calendar connected: the engine only offers check_availability / book_appointment when the workspace has a calendar
// and globalSettings.calendarTools is not false. Deliberately conservative: a false warning is noise, a miss is only a missed hint.

export interface BookingIntent {
  intends: boolean;
  reasons: string[];
  /** True when the agent's calendar tools are switched off (globalSettings.calendarTools === false). */
  calendarToolsOff: boolean;
}

export interface BookingWarning { code: 'booking_without_calendar'; message: string }

export const BOOKING_WITHOUT_CALENDAR_MESSAGE =
  'This agent collects appointments, but no calendar is connected, so it will take a request and someone must confirm. Connect a calendar under Integrations to let it book.';
export const BOOKING_CALENDAR_TOOLS_OFF_MESSAGE =
  'This agent collects appointments, but its calendar tools are turned off, so it will take a request and someone must confirm. Turn calendar tools back on (and connect a calendar under Integrations) to let it book.';

export const BOOKING_REQUIRES_CALENDAR_FIX =
  'Connect a calendar under Integrations, remove the booking steps, or publish without requireBookingTools to accept a request-only agent.';

// Extraction keys that name an appointment request. Matched on the whole key, split into words.
const FIELD_KEY = /(^|[\s_\-.])(preferred[\s_\-]?(time|day|date|slot|appointment)|appointment([\s_\-]?(time|date|day|slot|request))?|booking([\s_\-]?(time|date|day|slot))?|schedule[d]?([\s_\-]?(time|date|day))?|date[\s_\-]?time|requested[\s_\-]?(time|date|day|slot))($|[\s_\-.])/i;
// Instructions to book/schedule/reserve something with a time. "book" as a verb or "booking" of an appointment/slot/visit; plain
// "booking" alone (book a flight, booking.com, booking fee) does not count.
const BOOK_APPOINTMENT = /\b(book|schedule|reserve|set\s+up|arrange)\b[^.\n]{0,40}\b(an?\s+|the\s+|their\s+|your\s+)?(appointment|appointments|consultation|cleaning|tee\s?time|slot|visit|reservation|viewing|tour|demo|meeting)\b/i;
const BOOKING_OF_APPOINTMENT = /\b(appointment|consultation|visit)\s+(booking|scheduling)\b|\b(booking|scheduling)\s+(an?\s+)?(appointment|consultation|visit|slot)s?\b/i;
const TOOL_NAME = /\b(check_availability|book_appointment)\b/;
const BOOKING_TEMPLATE_IDS = new Set(['appointment-booking']);

function text(n: FlowNode): string {
  const parts = [n.prompt || ''];
  if (n.params) for (const [k, v] of Object.entries(n.params)) {
    if (k.startsWith('subflow') || k.startsWith('_template')) continue;
    if (typeof v === 'string') parts.push(v);
  }
  return parts.join('\n');
}

export function detectBookingIntent(
  nodes: FlowNode[] | null | undefined,
  globalSettings?: Record<string, unknown> | null,
  opts: { templateId?: string | null } = {},
): BookingIntent {
  const reasons: string[] = [];
  const add = (r: string) => { if (!reasons.includes(r)) reasons.push(r); };
  const calendarToolsOff = !!globalSettings && globalSettings.calendarTools === false;

  if (opts.templateId && BOOKING_TEMPLATE_IDS.has(opts.templateId)) add(`built from the "${opts.templateId}" template`);

  for (const n of Array.isArray(nodes) ? nodes : []) {
    if (!n || n.type === 'note') continue;
    if (n.type === 'extraction' && n.extract && typeof n.extract === 'object') {
      for (const key of Object.keys(n.extract)) if (FIELD_KEY.test(key)) add(`node "${n.id}" collects "${key}"`);
    }
    if (n.type === 'function' && n.function && TOOL_NAME.test(n.function)) add(`node "${n.id}" calls ${n.function}`);
    const t = text(n);
    const tool = TOOL_NAME.exec(t);
    if (tool) add(`node "${n.id}" mentions ${tool[1]}`);
    // Prompts count only on nodes that speak/collect; an 'agent' that merely transfers is not booking.
    if (n.type !== 'transfer' && n.type !== 'agent_transfer' && n.type !== 'logic_split') {
      if (BOOK_APPOINTMENT.test(t) || BOOKING_OF_APPOINTMENT.test(t)) {
        add(`node "${n.id}" tells the agent to book or schedule an appointment`);
      }
    }
  }
  return { intends: reasons.length > 0, reasons, calendarToolsOff };
}

/** The non-blocking warning for a flow with booking intent, or null when none applies. */
export function bookingWarning(intent: BookingIntent, calendarConnected: boolean): BookingWarning | null {
  if (!intent.intends) return null;
  if (intent.calendarToolsOff) return { code: 'booking_without_calendar', message: BOOKING_CALENDAR_TOOLS_OFF_MESSAGE };
  if (calendarConnected) return null;
  return { code: 'booking_without_calendar', message: BOOKING_WITHOUT_CALENDAR_MESSAGE };
}

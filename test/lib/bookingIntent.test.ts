import { describe, it, expect } from 'vitest';
import type { FlowNode } from '@/types';
import { detectBookingIntent, bookingWarning, BOOKING_WITHOUT_CALENDAR_MESSAGE } from '@/lib/bookingIntent';

const dental: FlowNode[] = [
  { id: 'greeting', type: 'greeting', prompt: 'You are the receptionist for Cedar Dental. Greet the caller and ask how you can help.', edges: [{ id: 'e1', target: 'collect', condition: 'caller wants a cleaning or checkup' }] },
  { id: 'collect', type: 'extraction', prompt: 'Collect the caller name, the day and time they would like, and a callback number.', extract: { name: 'string', preferred_time: 'string', callback_number: 'string' }, edges: [{ id: 'e2', target: 'bye', condition: 'all collected' }] },
  { id: 'bye', type: 'goodbye', prompt: 'Thank the caller and say goodbye.', edges: [] },
];
const insurance: FlowNode[] = [
  { id: 'g', type: 'greeting', prompt: 'You help callers get an insurance quote.', edges: [{ id: 'e', target: 'q', condition: 'wants a quote' }] },
  { id: 'q', type: 'extraction', prompt: 'Ask what they want covered and which day is best for an agent to call them back.', extract: { coverage: 'string', preferred_day: 'string' }, edges: [] },
];
const faq: FlowNode[] = [
  { id: 'g', type: 'greeting', prompt: 'You are the receptionist for Maple Cafe. Answer questions about hours and the menu. Booking.com listings are not ours.', edges: [{ id: 'e', target: 'kb', condition: 'asks a question' }] },
  { id: 'kb', type: 'knowledge_base', prompt: 'Answer from the knowledge base.', edges: [] },
];
const transferOnly: FlowNode[] = [
  { id: 'g', type: 'greeting', prompt: 'Greet the caller for Willow Realty. If they ask for sales or a person, transfer them.', edges: [{ id: 'e', target: 't', condition: 'caller wants a person' }] },
  { id: 't', type: 'transfer', prompt: 'Book an appointment with the front desk by transferring.', params: { transferTo: '+15551230000' }, edges: [] },
];

describe('detectBookingIntent', () => {
  it('flags a dental booking flow with the field name as a reason', () => {
    const r = detectBookingIntent(dental, {});
    expect(r.intends).toBe(true);
    expect(r.reasons.join(' ')).toMatch(/preferred_time/);
  });
  it('flags an insurance quote that collects a preferred day (known, accepted overlap)', () => {
    expect(detectBookingIntent(insurance, {}).intends).toBe(true);
  });
  it('does not flag a plain FAQ flow or a booking.com mention', () => {
    expect(detectBookingIntent(faq, {})).toMatchObject({ intends: false, reasons: [] });
  });
  it('does not flag a transfer that only hands off', () => {
    expect(detectBookingIntent(transferOnly, {}).intends).toBe(false);
  });
  it('flags book-an-appointment prompts, tool names and the template id', () => {
    expect(detectBookingIntent([{ id: 'a', type: 'greeting', prompt: 'Help the caller book an appointment.', edges: [] }]).intends).toBe(true);
    expect(detectBookingIntent([{ id: 'a', type: 'greeting', prompt: 'Use check_availability before offering times.', edges: [] }]).intends).toBe(true);
    expect(detectBookingIntent([{ id: 'a', type: 'function', function: 'book_appointment', prompt: 'x', edges: [] }]).intends).toBe(true);
    expect(detectBookingIntent([{ id: 'a', type: 'greeting', prompt: 'Hi', edges: [] }], {}, { templateId: 'appointment-booking' }).intends).toBe(true);
  });
  it('ignores unrelated senses of booking and canvas notes', () => {
    expect(detectBookingIntent([{ id: 'a', type: 'greeting', prompt: 'We sell flights. Never discuss booking fees or book a flight for them.', edges: [] }]).intends).toBe(false);
    expect(detectBookingIntent([{ id: 'n', type: 'note', prompt: 'book an appointment', edges: [] }]).intends).toBe(false);
  });
  it('tolerates empty or missing nodes', () => {
    expect(detectBookingIntent(undefined).intends).toBe(false);
    expect(detectBookingIntent([]).intends).toBe(false);
  });
  it('reports calendarTools off', () => {
    expect(detectBookingIntent(dental, { calendarTools: false }).calendarToolsOff).toBe(true);
  });
});

describe('bookingWarning', () => {
  const intent = detectBookingIntent(dental, {});
  it('warns without a calendar, not with one, and always when tools are off', () => {
    expect(bookingWarning(intent, false)).toEqual({ code: 'booking_without_calendar', message: BOOKING_WITHOUT_CALENDAR_MESSAGE });
    expect(bookingWarning(intent, true)).toBeNull();
    expect(bookingWarning(detectBookingIntent(dental, { calendarTools: false }), true)?.message).toMatch(/turned off/);
    expect(bookingWarning(detectBookingIntent(faq, {}), false)).toBeNull();
  });
});

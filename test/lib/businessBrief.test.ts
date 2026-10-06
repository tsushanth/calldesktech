import { describe, it, expect } from 'vitest';
import { extractSignals, chooseAngle } from '@/lib/outreach/businessBrief';

const page = (body: string) => `<html lang="en"><body>${body}</body></html>`;

describe('extractSignals', () => {
  it('finds call-to-book language and no booking tool', () => {
    const s = extractSignals([page('<p>Call us to schedule your appointment today.</p>')]);
    expect(s.callToBook).toMatch(/Call us to schedule/i);
    expect(s.onlineBookingTool).toBeNull();
  });
  it('detects an online booking tool from a link', () => {
    const s = extractSignals([page('<a href="https://calendly.com/dr-smith">Book</a>')]);
    expect(s.onlineBookingTool).toBe('Calendly');
  });
  it('finds weekday-only hours', () => {
    const s = extractSignals([page('<p>Hours: Monday - Friday 8:00 am - 5:00 pm. Saturday and Sunday closed.</p>')]);
    expect(s.weekdayOnlyHours).toBeTruthy();
  });
  it('does not call a plain 7-day schedule weekday-only', () => {
    const s = extractSignals([page('<p>Open every day from 8 am to 8 pm.</p>')]);
    expect(s.weekdayOnlyHours).toBeNull();
  });
  it('finds a 24/7 claim and Spanish', () => {
    const s = extractSignals([page('<p>Emergency service 24/7. Se habla español.</p>')]);
    expect(s.twentyFourSeven).toMatch(/24\/7/);
    expect(s.emergency).toBe(true);
    expect(s.spanish).toBe(true);
  });
});

describe('chooseAngle', () => {
  const none = extractSignals([page('<p>Welcome to our practice.</p>')]);
  it('falls back to the default after-hours angle with no evidence', () => {
    const a = chooseAngle('dental', none);
    expect(a.id).toBe('after_hours');
    expect(a.evidence).toBeNull();
  });
  it('phone-only booking points at booking, quoting the site', () => {
    const a = chooseAngle('dental', extractSignals([page('<p>Call us to schedule your appointment.</p>')]));
    expect(a.id).toBe('booking');
    expect(a.evidence).toMatch(/^Your site says: "Call us to schedule/);
    expect(a.capability).toMatch(/Cal\.com/);
  });
  it('a 24/7 claim points at transfer for a tow company', () => {
    expect(chooseAngle('towing', extractSignals([page('<p>24/7 emergency towing</p>')])).id).toBe('transfer');
  });
  it('weekday-only hours point at after-hours with the hours quoted', () => {
    const a = chooseAngle('homecare', extractSignals([page('<p>Office: Mon-Fri 9am to 5pm. Closed weekends.</p>')]));
    expect(a.id).toBe('after_hours');
    expect(a.evidence).toMatch(/^Your site lists/);
  });
  it('online booking in a dental practice points at reminders', () => {
    const a = chooseAngle('dental', extractSignals([page('<a href="https://www.zocdoc.com/x">Book</a>')]));
    expect(a.id).toBe('reminders');
  });
  it('bail bonds never get booking or reminders', () => {
    const a = chooseAngle('bailbonds', extractSignals([page('<p>Call us to schedule your appointment. Online booking available.</p>')]));
    expect(['transfer', 'after_hours', 'spanish']).toContain(a.id);
  });
  it('freight stays on the default angle', () => {
    expect(chooseAngle('freight', extractSignals([page('<p>24/7 dispatch. Call us to schedule a pickup.</p>')])).id).toBe('after_hours');
  });
});

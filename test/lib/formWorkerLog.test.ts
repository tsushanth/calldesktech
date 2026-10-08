import { describe, it, expect, vi } from 'vitest';
import { leadPageUrl, logWorkerAttempt, segmentLabel, workerLogRow } from '@/lib/outreach/formWorkerLog';

const lead = { id: 'l1', product: 'calldesk:homecare', company_name: 'Acme Care', domain: 'acme.com', contact_source_url: 'https://acme.com/', signals: { contactForm: { pageUrl: 'https://acme.com/contact' } } };

describe('worker log rows', () => {
  it('uses the stored form page, else the page the contact came from', () => {
    expect(leadPageUrl(lead)).toBe('https://acme.com/contact');
    expect(leadPageUrl({ id: 'x', contact_source_url: 'https://b.com/' })).toBe('https://b.com/');
    expect(leadPageUrl({ id: 'x' })).toBeNull();
  });

  it('builds a row for a delivery, and prefers the page the form was actually on', () => {
    const row = workerLogRow(lead, { outcome: 'submitted', screenshot: '/x/after.png' }, { pageUrl: 'https://acme.com/get-in-touch' });
    expect(row).toMatchObject({ lead_id: 'l1', product: 'calldesk:homecare', domain: 'acme.com', outcome: 'submitted', proof: 'page', page_url: 'https://acme.com/get-in-touch', screenshot: '/x/after.png', confirmed_by: null });
  });

  it('records an email confirmation and trims a long reason', () => {
    const row = workerLogRow(lead, { outcome: 'submitted', reason: 'x'.repeat(500) }, { proof: 'email', confirmedBy: 'auto-reply email from hello@acme.com' });
    expect(row.proof).toBe('email');
    expect(row.confirmed_by).toContain('hello@acme.com');
    expect(row.reason).toHaveLength(300);
  });

  it('labels the segment', () => {
    expect(segmentLabel('calldesk')).toBe('Reseller / agency');
    expect(segmentLabel(null)).toBe('Reseller / agency');
    expect(segmentLabel('calldesk:homecare')).toBe('Homecare');
  });

  it('never throws when the log cannot be written', async () => {
    const db = { from: () => ({ insert: vi.fn().mockRejectedValue(new Error('down')) }) };
    await expect(logWorkerAttempt(db, workerLogRow(lead, { outcome: 'needs_manual', reason: 'captcha' }))).resolves.toBeUndefined();
    const ok = { from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ error: null }) })) };
    await logWorkerAttempt(ok, workerLogRow(lead, { outcome: 'submitted' }));
    expect(ok.from).toHaveBeenCalledWith('calldesk_form_worker_log');
  });
});

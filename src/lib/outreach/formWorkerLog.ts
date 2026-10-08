// The form worker's own record (table calldesk_form_worker_log, migration 074): one row per attempt, written by the worker
// (harness/outreach/form-submit.ts) and by the inbound-reply webhook when a company's auto-reply confirms a form the page could not.
// The outreach queue's Worker tab reads it; the leads table stays the source of truth for a lead's status.

export type WorkerOutcome = 'submitted' | 'needs_manual' | 'failed';

export interface WorkerLogRow {
  lead_id: string;
  product: string | null;
  company_name: string | null;
  domain: string | null;
  page_url: string | null;
  outcome: WorkerOutcome;
  reason: string | null;
  proof: 'page' | 'email';
  confirmed_by: string | null;
  screenshot: string | null;
}

interface LeadLike {
  id: string;
  product?: string | null;
  company_name?: string | null;
  domain?: string | null;
  contact_source_url?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signals?: any;
}

/** The page we opened for a lead: the stored form page, else the page its contact details came from. */
export function leadPageUrl(lead: LeadLike): string | null {
  return lead.signals?.contactForm?.pageUrl || lead.contact_source_url || null;
}

export function workerLogRow(
  lead: LeadLike,
  attempt: { outcome: WorkerOutcome; reason?: string | null; screenshot?: string | null },
  opts: { pageUrl?: string | null; proof?: 'page' | 'email'; confirmedBy?: string | null } = {},
): WorkerLogRow {
  return {
    lead_id: lead.id,
    product: lead.product ?? null,
    company_name: lead.company_name ?? null,
    domain: lead.domain ?? null,
    page_url: opts.pageUrl ?? leadPageUrl(lead),
    outcome: attempt.outcome,
    reason: attempt.reason ? String(attempt.reason).slice(0, 300) : null,
    proof: opts.proof ?? 'page',
    confirmed_by: opts.confirmedBy ?? null,
    screenshot: attempt.screenshot ?? null,
  };
}

/** Best effort: the log is for the human's tab, so a failure to write it never changes what happened to the lead. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function logWorkerAttempt(db: any, row: WorkerLogRow): Promise<void> {
  try {
    await db.from('calldesk_form_worker_log').insert(row);
  } catch {
    /* ignore */
  }
}

/** "Reseller or agency" for the plain product, the vertical's name otherwise. */
export function segmentLabel(product: string | null | undefined): string {
  if (!product || product === 'calldesk') return 'Reseller / agency';
  const v = product.split(':')[1] || product;
  return v.charAt(0).toUpperCase() + v.slice(1);
}

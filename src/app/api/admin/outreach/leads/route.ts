import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { findJobPostingSignals } from '@/lib/outreach/signals/jobPostings';
import { parseManualReviewImport, type ReviewSiteImportRow } from '@/lib/outreach/signals/reviewSites';
import { findTechFingerprintSignals } from '@/lib/outreach/signals/techFingerprint';

// GET /api/admin/outreach/leads — list all leads, newest first.
export async function GET() {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_outreach_leads')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leads: data });
}

// POST /api/admin/outreach/leads — either:
//   { mode: 'manual', companyName, domain?, contactEmail?, signalDetail? }
//   { mode: 'scan_job_postings' }
//   { mode: 'scan_tech_fingerprint', candidates: [{domain, companyName}] }
//   { mode: 'import_review_sites', rows: [{companyName, domain?, snippet}] }
// Scan modes insert one lead row per signal found and return how many were added.
export async function POST(request: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const body = await request.json();

  try {
    if (body.mode === 'manual') {
      if (!body.companyName) {
        return NextResponse.json({ error: 'companyName is required' }, { status: 400 });
      }
      const { data, error } = await supabase
        .from('calldesk_outreach_leads')
        .insert({
          company_name: body.companyName,
          domain: body.domain ?? null,
          contact_email: body.contactEmail ?? null,
          signal_source: 'manual',
          signal_detail: body.signalDetail ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ lead: data }, { status: 201 });
    }

    if (body.mode === 'scan_job_postings') {
      const signals = await findJobPostingSignals();
      const inserted = await insertSignals(supabase, signals, 'job_posting');
      return NextResponse.json({ added: inserted });
    }

    if (body.mode === 'scan_tech_fingerprint') {
      const candidates = Array.isArray(body.candidates) ? body.candidates : [];
      const signals = await findTechFingerprintSignals(candidates);
      const inserted = await insertSignals(supabase, signals, 'tech_fingerprint');
      return NextResponse.json({ added: inserted });
    }

    if (body.mode === 'import_review_sites') {
      const rows = (Array.isArray(body.rows) ? body.rows : []) as ReviewSiteImportRow[];
      const signals = parseManualReviewImport(rows);
      const inserted = await insertSignals(supabase, signals, 'review_site');
      return NextResponse.json({ added: inserted });
    }

    return NextResponse.json({ error: `Unknown mode: ${body.mode}` }, { status: 400 });
  } catch (error) {
    console.error('Error creating outreach lead(s):', error);
    const message = error instanceof Error ? error.message : 'Failed to create lead(s)';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function insertSignals(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  signals: { companyName: string; domain: string | null; detail: string }[],
  signalSource: 'job_posting' | 'review_site' | 'tech_fingerprint'
): Promise<number> {
  if (!signals.length) return 0;
  const rows = signals.map((s) => ({
    company_name: s.companyName,
    domain: s.domain,
    signal_source: signalSource,
    signal_detail: s.detail,
  }));
  const { error, count } = await supabase.from('calldesk_outreach_leads').insert(rows).select('*', { count: 'exact' });
  if (error) throw error;
  return count ?? rows.length;
}

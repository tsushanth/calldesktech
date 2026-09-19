import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { getBenchmarkAggregate } from '@/lib/outreach/benchmarkImport';
import { generateOutreachReport } from '@/lib/outreach/reportGenerator';
import { sendEmail } from '@/lib/email';

// POST /api/admin/outreach/leads/:id/report — generate (or regenerate) the
// personalized comparison one-pager for a lead, using the real benchmark
// aggregate (calldesk_benchmark_runs) as its only source of numbers.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: lead, error: leadError } = await supabase
    .from('calldesk_outreach_leads')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (leadError) return NextResponse.json({ error: leadError.message }, { status: 500 });
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  try {
    const benchmark = await getBenchmarkAggregate(supabase);
    const report = await generateOutreachReport(
      {
        companyName: lead.company_name,
        domain: lead.domain,
        signalSource: lead.signal_source,
        signalDetail: lead.signal_detail,
      },
      benchmark
    );

    const { data: updated, error: updateError } = await supabase
      .from('calldesk_outreach_leads')
      .update({
        report_html: report.html,
        report_text: report.text,
        report_subject: report.subject,
        status: 'report_generated',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();
    if (updateError) throw updateError;

    return NextResponse.json({ lead: updated });
  } catch (error) {
    console.error('Error generating outreach report:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/admin/outreach/leads/:id/report — "send preview to myself" using
// the already-generated report and the admin's own session email. Does NOT
// send to the lead's actual contact — v1 has no automated send to real
// prospects by design (see the plan's guardrail); this is only for
// reviewing what a send would look like.
export async function PUT(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data: lead, error } = await supabase
    .from('calldesk_outreach_leads')
    .select('report_html, report_text, report_subject')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!lead?.report_html) {
    return NextResponse.json({ error: 'No report generated yet for this lead' }, { status: 400 });
  }

  const result = await sendEmail({
    to: admin.email,
    subject: `[PREVIEW] ${lead.report_subject}`,
    html: lead.report_html,
    text: lead.report_text ?? undefined,
  });

  if (!result.ok) return NextResponse.json({ error: result.error || 'Send failed' }, { status: 502 });
  return NextResponse.json({ sent: true, id: result.id });
}

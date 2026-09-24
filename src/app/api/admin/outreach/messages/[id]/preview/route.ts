import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { brandFor, buildOutreachEmail } from '@/lib/outreach/sender';

// GET — the exact HTML/text that sending this message would produce right now (saved draft text, current
// published sample, real tracking link). Read-only: nothing is sent or recorded.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data: msg } = await supabase.from('calldesk_outreach_messages').select('*').eq('id', id).maybeSingle();
  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  const product = (msg.product as string) || 'calldesk';
  const brand = brandFor(product);
  const postalAddress = (process.env[brand.postalEnvVar] || '').trim() || '(mailing address not configured)';
  const toEmail = String(msg.to_email).trim().toLowerCase();
  const { html, text, variant } = await buildOutreachEmail(supabase, msg, { toEmail, product, brand, postalAddress });
  return NextResponse.json({ subject: msg.subject, to: toEmail, html, text, variant: variant ?? null });
}

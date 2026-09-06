import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';

// Alert rules API — server-side, service-role Supabase (this app authenticates
// via NextAuth/Google, so auth.uid() is always NULL for anon-key requests and
// RLS would block every browser call; the whole API surface routes through the
// server for the same reason — see the note in api/tenants/[id]/route.ts).
//
// Ownership is enforced here rather than trusting the client: every request
// resolves the real session user and checks the target tenant is theirs, so a
// caller can't read or write another tenant's rules by passing a foreign id.

const TRIGGER_TYPES = ['transferred', 'abandoned', 'voicemail'] as const;
type TriggerType = (typeof TRIGGER_TYPES)[number];

async function assertTenantOwnership(tenantId: string, userId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('calldesk_tenants')
    .select('id')
    .eq('id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

// GET /api/alert-rules?tenantId=... — list a tenant's rules.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenantId = request.nextUrl.searchParams.get('tenantId');
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  if (!(await assertTenantOwnership(tenantId, userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_alert_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}

// POST /api/alert-rules — create a rule { tenantId, triggerType, email }.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const tenantId: string | undefined = body?.tenantId;
  const triggerType: string | undefined = body?.triggerType;
  const email: string | undefined = typeof body?.email === 'string' ? body.email.trim() : undefined;

  if (!tenantId || !triggerType || !email) {
    return NextResponse.json({ error: 'tenantId, triggerType and email are required' }, { status: 400 });
  }
  if (!TRIGGER_TYPES.includes(triggerType as TriggerType)) {
    return NextResponse.json({ error: 'Invalid triggerType' }, { status: 400 });
  }
  // Deliberately lenient — enough to reject obvious junk, not to police RFC 5322.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
  }

  if (!(await assertTenantOwnership(tenantId, userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_alert_rules')
    .insert({ tenant_id: tenantId, trigger_type: triggerType, email, enabled: true })
    .select()
    .single();

  if (error) {
    // Unique (tenant_id, trigger_type, email) collision — surface a clean 409.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A rule for that trigger and email already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rule: data }, { status: 201 });
}

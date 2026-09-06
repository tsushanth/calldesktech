import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';

// Toggle (PATCH) / delete (DELETE) a single alert rule. Both verify the rule's
// tenant belongs to the session user before touching it (see the note in
// ../route.ts on why ownership is enforced in the route, not via RLS).

async function loadOwnedRule(ruleId: string, userId: string): Promise<{ ok: boolean; status: number }> {
  const supabase = getSupabaseAdmin();
  const { data: rule } = await supabase
    .from('calldesk_alert_rules')
    .select('id, tenant_id')
    .eq('id', ruleId)
    .maybeSingle();

  if (!rule) return { ok: false, status: 404 };

  const { data: tenant } = await supabase
    .from('calldesk_tenants')
    .select('id')
    .eq('id', rule.tenant_id)
    .eq('user_id', userId)
    .maybeSingle();

  return tenant ? { ok: true, status: 200 } : { ok: false, status: 403 };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const owned = await loadOwnedRule(id, userId);
  if (!owned.ok) {
    return NextResponse.json({ error: owned.status === 404 ? 'Not found' : 'Forbidden' }, { status: owned.status });
  }

  const body = await request.json().catch(() => null);
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_alert_rules')
    .update({ enabled: body.enabled })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const owned = await loadOwnedRule(id, userId);
  if (!owned.ok) {
    return NextResponse.json({ error: owned.status === 404 ? 'Not found' : 'Forbidden' }, { status: owned.status });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('calldesk_alert_rules').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

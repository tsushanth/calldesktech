import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/authz';

// GET /api/v1/me — who am I? An API key is pinned to one tenant, so this is
// how a client (e.g. the MCP server) learns the tenant id to put in paths.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const { principal } = auth;
  if (principal.via === 'apikey') {
    const { data: tenant } = await getSupabaseAdmin().from('calldesk_tenants').select('id, name').eq('id', principal.tenantId!).maybeSingle();
    return NextResponse.json({ auth: 'api_key', tenantId: principal.tenantId, tenantName: tenant?.name ?? null });
  }
  const { data: tenants } = await getSupabaseAdmin().from('calldesk_tenants').select('id, name').eq('user_id', principal.userId!);
  return NextResponse.json({ auth: principal.via, userId: principal.userId, tenants: tenants || [] });
}

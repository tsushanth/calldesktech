import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';
import { buildWizardFlow, DEFAULT_WIZARD_BLOCKS, type WizardBlocks } from '@/lib/flowBuilder';

// POST /api/demo-call/live — real phone call from our voice engine to the
// visitor's phone, running the flow built from the "Set up your business"
// wizard. The flow is passed inline to call-loop-poc (no number routing).
const hits = new Map<string, number[]>();
function limited(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return true; }
  recent.push(now); hits.set(key, recent);
  return false;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const tenantId = String(body.tenant_id || '');
  const digits = String(body.phone_number || '').replace(/[^\d+]/g, '');
  const e164 = /^\+1\d{10}$/.test(digits) ? digits : /^\d{10}$/.test(digits) ? `+1${digits}` : '';
  if (!tenantId || !e164) return NextResponse.json({ error: 'tenant_id and a valid US phone_number are required' }, { status: 400 });

  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  if (limited(`phone:${e164}`, 2, 3600_000) || limited(`ip:${ip}`, 5, 3600_000)) {
    return NextResponse.json({ error: 'Demo call limit reached — please try again in an hour.' }, { status: 429 });
  }

  // The caller must own the workspace (the demo wizard creates it under the signed-in user).
  const auth = await authorizeTenant(request, tenantId);
  if (!auth.ok) return auth.response;
  const { data: tenant } = await getSupabaseAdmin().from('calldesk_tenants').select('id, name').eq('id', tenantId).maybeSingle();
  if (!tenant) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

  const blocks: WizardBlocks = { ...DEFAULT_WIZARD_BLOCKS, ...(body.blocks || {}) };
  const transferTo = typeof body.transfer_to === 'string' ? body.transfer_to : undefined;
  const flow = buildWizardFlow({ businessName: tenant.name, transferToNumber: transferTo }, blocks);

  const baseUrl = process.env.CALL_LOOP_POC_BASE_URL;
  const secret = process.env.CALL_LOOP_POC_TEST_CALL_SECRET;
  if (!baseUrl || !secret) return NextResponse.json({ error: 'Calling is not configured' }, { status: 500 });

  const res = await fetch(`${baseUrl}/place-test-call`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ toNumber: e164, demoFlow: { ...flow, tenantId: tenant.id } }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof out.detail?.message === 'string' ? out.detail.message : out.error || 'Could not place the call';
    return NextResponse.json({ error: msg }, { status: res.status >= 500 ? 502 : res.status });
  }
  return NextResponse.json({ call_id: out.sid, status: 'queued' }, { status: 201 });
}

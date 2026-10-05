import { NextRequest, NextResponse } from 'next/server';
import { authorizeTenant } from '@/lib/authz';
import { tenantHasCalendar } from '@/lib/calendarConnection';

// GET /api/tenants/[id]/calendar — whether the workspace has a calendar connected (never returns the key).
// The builder uses it to hint that a booking agent cannot book yet.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const tenantId = (await params).id;
  const __auth = await authorizeTenant(request, tenantId);
  if (!__auth.ok) return __auth.response;
  return NextResponse.json({ connected: await tenantHasCalendar(tenantId) });
}

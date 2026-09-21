import { NextRequest, NextResponse } from 'next/server';
import { authorizeTenant } from '@/lib/authz';
import { lookupHubspotContactVars } from '@/lib/crmSync';

// GET /api/tenants/[id]/crm/hubspot/lookup?phone=+1555... — CRM→us
// direction: look up a caller's HubSpot contact at call time so an agent
// flow can inject {{crm_company_name}} etc. as dynamic variables. Open to
// API keys (apiKeysAllowed default true via authorizeTenant) since this is
// meant to be called from call-time flow logic, same trust level as
// get_call/list_calls in the MCP tools.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  const auth = await authorizeTenant(request, tenantId);
  if (!auth.ok) return auth.response;

  const phone = request.nextUrl.searchParams.get('phone');
  if (!phone) {
    return NextResponse.json({ error: 'phone query param is required' }, { status: 400 });
  }

  const vars = await lookupHubspotContactVars(tenantId, phone);
  return NextResponse.json({ variables: vars });
}

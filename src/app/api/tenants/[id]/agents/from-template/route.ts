import { NextRequest, NextResponse } from 'next/server';
import { authorizeTenant } from '@/lib/authz';
import { installTemplate } from '@/lib/templateInstall';

// POST /api/tenants/[id]/agents/from-template — create an agent from a built-in
// template and publish its first version. voiceEngine 'poc' runs on CallDesk's
// own engine; 'retell' also creates the equivalent Retell conversation-flow agent.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;
  const { id: tenantId } = await params;
  const body = await request.json().catch(() => ({}));
  if (!body.templateId || typeof body.templateId !== 'string') {
    return NextResponse.json({ error: 'templateId is required (see GET /agent-templates)' }, { status: 400 });
  }
  const voiceEngine = body.voiceEngine === 'retell' ? 'retell' : 'poc';
  if (body.transferTo && !/^\+[1-9]\d{6,14}$/.test(body.transferTo)) {
    return NextResponse.json({ error: 'transferTo must be an E.164 number like +14155550123' }, { status: 400 });
  }
  let variables: Record<string, string> | undefined;
  if (body.variables !== undefined && body.variables !== null) {
    const v = body.variables;
    const entries = typeof v === 'object' && !Array.isArray(v) ? Object.entries(v as Record<string, unknown>) : null;
    if (!entries || entries.length > 30) {
      return NextResponse.json({ error: 'variables must be an object with at most 30 entries' }, { status: 400 });
    }
    for (const [k, val] of entries) {
      if (!/^[a-z][a-z0-9_]{0,40}$/.test(k)) return NextResponse.json({ error: `Invalid variable name "${k}" (use lowercase letters, digits, underscores; start with a letter; max 41 chars)` }, { status: 400 });
      if (typeof val !== 'string' || val.length > 200) return NextResponse.json({ error: `Variable "${k}" must be a string of at most 200 characters` }, { status: 400 });
    }
    variables = Object.fromEntries(entries as [string, string][]);
  }
  try {
    const result = await installTemplate(request, tenantId, {
      templateId: body.templateId, name: body.name, voiceEngine, transferTo: body.transferTo, functionUrl: body.functionUrl, variables, calendarTools: body.calendarTools === false ? false : undefined,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create agent';
    return NextResponse.json({ error: message }, { status: message.startsWith('Unknown template') ? 400 : 500 });
  }
}

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
  try {
    const result = await installTemplate(request, tenantId, {
      templateId: body.templateId, name: body.name, voiceEngine, transferTo: body.transferTo, functionUrl: body.functionUrl,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create agent';
    return NextResponse.json({ error: message }, { status: message.startsWith('Unknown template') ? 400 : 500 });
  }
}

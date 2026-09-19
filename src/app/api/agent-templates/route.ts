import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authz';
import { listTemplates } from '@/lib/templateInstall';

// GET /api/agent-templates — the built-in templates that can be installed as an agent.
export async function GET(request: NextRequest) {
  const __auth = await requireAuth(request);
  if (!__auth.ok) return __auth.response;
  return NextResponse.json({ templates: listTemplates() });
}

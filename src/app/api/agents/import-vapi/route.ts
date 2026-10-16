import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authz';
import { vapiAssistantToFlow } from '@/lib/vapiImport';

// POST /api/agents/import-vapi — "Import from Vapi": turns a pasted Vapi assistant into a draft flow for the editor.
//   body: { assistant: <the assistant JSON, as an object or a string>, tools?: [<saved tools from GET /tool>] }
//   or the bare assistant object.
// Deterministic (no model call) and read-only: nothing is saved. The editor opens the draft for review, like "Generate from prompt".
// See src/lib/vapiImport.ts for the mapping and for what is reported rather than carried over.
export const dynamic = 'force-dynamic';

const MAX_BODY_CHARS = 450_000;

export async function POST(request: NextRequest) {
  const __auth = await requireAuth(request);
  if (!__auth.ok) return __auth.response;

  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return NextResponse.json({ error: 'That is too large to be a single assistant.' }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: 'The request body is not valid JSON.' }, { status: 400 }); }

  // The editor sends the pasted text untouched as { assistant: "<text>" }, so a paste that is itself { assistant, tools } still works.
  const raw = body && typeof body === 'object' && !Array.isArray(body) && typeof (body as { assistant?: unknown }).assistant === 'string'
    ? (body as { assistant: string }).assistant
    : body;
  const result = vapiAssistantToFlow(raw);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authz';
import { getModelCatalog } from '@/lib/modelCatalog';

// GET /api/models: the language models and voice models an agent version can choose (publish a version with llmModel / ttsModel).
export async function GET(request: NextRequest) {
  const __auth = await requireAuth(request);
  if (!__auth.ok) return __auth.response;
  return NextResponse.json(getModelCatalog());
}

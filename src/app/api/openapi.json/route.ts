import { NextRequest, NextResponse } from 'next/server';
import { buildOpenApi } from '@/lib/openapi';

// Public on purpose — API documentation. GET /api/v1/openapi.json
export async function GET(request: NextRequest) {
  return NextResponse.json(buildOpenApi(`${request.nextUrl.origin}/api/v1`));
}

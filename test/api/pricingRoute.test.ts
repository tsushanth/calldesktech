import { it, expect } from 'vitest';
import { GET } from '@/app/api/pricing/route';
import { buildOpenApi } from '@/lib/openapi';

it('GET /api/pricing is public and returns the tiers', async () => {
  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.tiers.map((t: { id: string }) => t.id)).toEqual(['lite', 'standard', 'pro']);
  expect(body.tiers.find((t: { id: string }) => t.id === 'lite').availability).toBe('live');
  expect(body.addOns.every((a: { proposed: boolean }) => a.proposed)).toBe(true);
});

it('OpenAPI documents /pricing as public and the tier field on publish', () => {
  const spec = buildOpenApi('https://example.com/api/v1') as { paths: Record<string, Record<string, { security?: unknown[]; responses: Record<string, unknown>; requestBody?: { content: { 'application/json': { schema: { properties: Record<string, unknown> } } } } }>> };
  const pricing = spec.paths['/pricing'].get;
  expect(pricing.security).toEqual([]);
  expect(pricing.responses['401']).toBeUndefined();
  expect(spec.paths['/agents/{agentId}/versions'].post.requestBody!.content['application/json'].schema.properties).toHaveProperty('tier');
  // every other operation still documents the 401
  expect(spec.paths['/models'].get.responses['401']).toBeDefined();
});

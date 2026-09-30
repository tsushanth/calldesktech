import { describe, it, expect } from 'vitest';
import { buildOpenApi } from '@/lib/openapi';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const spec: any = buildOpenApi('https://calldesk.tech/api/v1');
const base = '/tenants/{tenantId}/call-audio';

describe('OpenAPI documents the sounds (jingle / sound effect) endpoints', () => {
  it('lists, creates, deletes and previews under a "Sounds" tag (not a combined "call audio" noun)', () => {
    expect(spec.paths[base].get.tags).toEqual(['Sounds']);
    expect(spec.paths[base].post.tags).toEqual(['Sounds']);
    expect(spec.paths[`${base}/{soundId}`].delete.tags).toEqual(['Sounds']);
    expect(spec.paths[`${base}/{soundId}/audio`].get.tags).toEqual(['Sounds']);
  });
  it('the create body documents type, name, description, prompt and durationSec, with the required ones marked', () => {
    const schema = spec.paths[base].post.requestBody.content['application/json'].schema;
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['type', 'name', 'description', 'prompt', 'durationSec']));
    expect(schema.required).toEqual(expect.arrayContaining(['type', 'name', 'prompt', 'durationSec']));
  });
  it('the create description explains cost, replacement, and the Retell exclusion', () => {
    const d = spec.paths[base].post.description as string;
    expect(d).toMatch(/credits/i);
    expect(d).toMatch(/replaces/i);
    expect(d).toMatch(/retell/i);
  });
});

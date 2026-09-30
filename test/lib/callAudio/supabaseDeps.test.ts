import { describe, it, expect } from 'vitest';
import { makeSupabaseCallAudioDeps } from '@/lib/callAudio/supabaseDeps';

// Recording fake of the supabase-js query builder: every chained call is logged, and awaiting the
// chain resolves to `result`. Enough to assert the filters that scope writes to the right tenant.
function fakeClient(result: { data?: unknown; error?: unknown; count?: number } = { data: [], error: null }) {
  const log: Array<{ table?: string; bucket?: string; ops: Array<[string, unknown[]]> }> = [];
  const chain = (entry: (typeof log)[number]) => {
    const proxy: any = new Proxy(function () {}, {
      get(_t, prop: string) {
        if (prop === 'then') return (res: (v: unknown) => void) => res(result);
        return (...args: unknown[]) => { entry.ops.push([prop, args]); return proxy; };
      },
    });
    return proxy;
  };
  const client: any = {
    from: (table: string) => { const e = { table, ops: [] as any[] }; log.push(e); return chain(e); },
    storage: { from: (bucket: string) => { const e = { bucket, ops: [] as any[] }; log.push(e); return chain(e); } },
  };
  return { client, log };
}
const ops = (entry: { ops: Array<[string, unknown[]]> }, name: string) => entry.ops.filter(([n]) => n === name).map(([, a]) => a);

describe('makeSupabaseCallAudioDeps', () => {
  it('disableOthers (jingle) scopes to tenant + type + enabled, excludes the new id, returns the ids it disabled', async () => {
    const { client, log } = fakeClient({ data: [{ id: 'old-1' }, { id: 'old-2' }], error: null });
    const ids = await makeSupabaseCallAudioDeps(client, { generateWav: async () => Buffer.alloc(0) }).disableOthers({ tenantId: 't1', type: 'jingle', name: undefined, exceptId: 'new' });
    expect(ids).toEqual(['old-1', 'old-2']);
    const e = log[0];
    expect(e.table).toBe('tenant_call_audio_assets');
    expect(ops(e, 'update')[0]).toEqual([{ enabled: false }]);
    const eqs = ops(e, 'eq');
    expect(eqs).toContainEqual(['tenant_id', 't1']);
    expect(eqs).toContainEqual(['asset_type', 'jingle']);
    expect(eqs).toContainEqual(['enabled', true]);
    expect(ops(e, 'neq')).toContainEqual(['id', 'new']);
    expect(eqs.find(([c]) => c === 'name')).toBeUndefined(); // jingle: any name
  });

  it('disableOthers (effect) additionally scopes to the same name only', async () => {
    const { client, log } = fakeClient({ data: [], error: null });
    await makeSupabaseCallAudioDeps(client, { generateWav: async () => Buffer.alloc(0) }).disableOthers({ tenantId: 't1', type: 'sound_effect', name: 'chime', exceptId: 'new' });
    expect(ops(log[0], 'eq')).toContainEqual(['name', 'chime']);
  });

  it('countEnabledEffects counts only this tenant\'s enabled effects, excluding the given name', async () => {
    const { client, log } = fakeClient({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], error: null });
    const n = await makeSupabaseCallAudioDeps(client, { generateWav: async () => Buffer.alloc(0) }).countEnabledEffects('t1', 'chime');
    expect(n).toBe(3);
    const e = log[0];
    expect(ops(e, 'eq')).toEqual(expect.arrayContaining([['tenant_id', 't1'], ['asset_type', 'sound_effect'], ['enabled', true]]));
    expect(ops(e, 'neq')).toContainEqual(['name', 'chime']);
  });

  it('uploads to the private bucket with upsert off, and surfaces storage errors', async () => {
    const ok = fakeClient({ data: {}, error: null });
    await makeSupabaseCallAudioDeps(ok.client, { generateWav: async () => Buffer.alloc(0) }).uploadObject('t1/x.raw', Buffer.from([1]));
    expect(ok.log[0].bucket).toBe('call-audio-assets');
    expect(ops(ok.log[0], 'upload')[0][2]).toMatchObject({ upsert: false });
    const bad = fakeClient({ data: null, error: { message: 'bucket missing' } });
    await expect(makeSupabaseCallAudioDeps(bad.client, { generateWav: async () => Buffer.alloc(0) }).uploadObject('t1/x.raw', Buffer.from([1]))).rejects.toThrow('bucket missing');
  });

  it('surfaces database errors instead of swallowing them', async () => {
    const bad = fakeClient({ data: null, error: { message: 'relation does not exist' } });
    const deps = makeSupabaseCallAudioDeps(bad.client, { generateWav: async () => Buffer.alloc(0) });
    await expect(deps.insertAsset({} as never)).rejects.toThrow('relation does not exist');
    await expect(deps.setEnabled('x', true)).rejects.toThrow('relation does not exist');
    await expect(deps.disableOthers({ tenantId: 't', type: 'jingle', name: undefined, exceptId: 'n' })).rejects.toThrow('relation does not exist');
  });
});

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { wavToMulaw8k } from './mulaw';
import type { CallAudioDeps } from './assets';

export const CALL_AUDIO_TABLE = 'tenant_call_audio_assets';
export const CALL_AUDIO_BUCKET = 'call-audio-assets';

function check<T extends { error: { message: string } | null }>(res: T): T {
  if (res.error) throw new Error(res.error.message);
  return res;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeSupabaseCallAudioDeps(supabase: SupabaseClient<any>, gen: Pick<CallAudioDeps, 'generateWav'>): CallAudioDeps {
  return {
    generateWav: gen.generateWav,
    convert: wavToMulaw8k,
    newId: () => randomUUID(),

    async uploadObject(path, bytes) {
      check(await supabase.storage.from(CALL_AUDIO_BUCKET).upload(path, bytes, { contentType: 'application/octet-stream', upsert: false }));
    },
    async deleteObject(path) {
      check(await supabase.storage.from(CALL_AUDIO_BUCKET).remove([path]));
    },
    async insertAsset(row) {
      check(await supabase.from(CALL_AUDIO_TABLE).insert(row));
    },
    async deleteAsset(id) {
      check(await supabase.from(CALL_AUDIO_TABLE).delete().eq('id', id));
    },
    async setEnabled(id, enabled) {
      check(await supabase.from(CALL_AUDIO_TABLE).update({ enabled }).eq('id', id));
    },
    async disableOthers({ tenantId, type, name, exceptId }) {
      let q = supabase.from(CALL_AUDIO_TABLE).update({ enabled: false })
        .eq('tenant_id', tenantId).eq('asset_type', type).eq('enabled', true).neq('id', exceptId);
      if (name !== undefined) q = q.eq('name', name);
      const { data } = check(await q.select('id'));
      return (data ?? []).map((r: { id: string }) => r.id);
    },
    async countEnabledEffects(tenantId, excludingName) {
      const { data } = check(await supabase.from(CALL_AUDIO_TABLE).select('id')
        .eq('tenant_id', tenantId).eq('asset_type', 'sound_effect').eq('enabled', true).neq('name', excludingName));
      return (data ?? []).length;
    },
  };
}

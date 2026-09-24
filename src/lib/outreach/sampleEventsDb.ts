import type { SupabaseClient } from '@supabase/supabase-js';
import type { SampleEventDeps } from './sampleEvents';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function supabaseEventDeps(supabase: SupabaseClient<any>): SampleEventDeps {
  return {
    async getMessage(id) {
      // sample_id may not exist yet (migration pending): fall back to product only.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let res: { data: any; error: any } = await supabase.from('calldesk_outreach_messages').select('sample_id, product').eq('id', id).maybeSingle();
      if (res.error) res = await supabase.from('calldesk_outreach_messages').select('product').eq('id', id).maybeSingle();
      if (res.error || !res.data) return null;
      const d = res.data as { sample_id?: string | null; product?: string | null };
      return { sample_id: d.sample_id ?? null, product: d.product ?? null };
    },
    async hasEvent(messageId, event, sinceIso) {
      let q = supabase.from('calldesk_outreach_sample_events').select('id').eq('message_id', messageId).eq('event', event);
      if (sinceIso) q = q.gte('created_at', sinceIso);
      const { data, error } = await q.limit(1);
      if (error) throw new Error(error.message);
      return Array.isArray(data) && data.length > 0;
    },
    async insert(row) {
      const { error } = await supabase.from('calldesk_outreach_sample_events').insert(row);
      if (error) throw new Error(error.message);
    },
  };
}

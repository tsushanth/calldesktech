import { getSupabaseAdmin } from '@/lib/supabase';
import { hashToken } from '@/lib/callerPortal';

export interface PortalUser {
  sip_username: string;
  display_name: string;
  role: 'caller' | 'admin';
}

// A caller's private link carries a random token (?k=...). Only its hash is stored; a disabled caller's link stops working.
export async function authenticateLink(token: string | null | undefined): Promise<PortalUser | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const { data } = await getSupabaseAdmin()
    .from('calldesk_outbound_callers')
    .select('sip_username, display_name, role, enabled')
    .eq('access_token_hash', hashToken(token))
    .maybeSingle();
  if (!data || !data.enabled) return null;
  return { sip_username: data.sip_username, display_name: data.display_name, role: data.role };
}

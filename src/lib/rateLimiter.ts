// Global/per-tenant CPS rate limiting for real outbound call placement —
// see supabase/migrations/023_rate_limiters.sql for why this has to be a
// Postgres-backed atomic token bucket (cross-process, cross-repo safe)
// rather than in-memory state.
import { getSupabaseAdmin } from '@/lib/supabase';

export interface RateLimitConfig {
  capacity: number;
  refillPerSec: number;
}

// Conservative starting defaults — these are guesses at safe rates, NOT
// verified against our actual Twilio/Retell account's approved CPS/
// concurrency limits. Tune via env vars once real limits are confirmed;
// don't treat these numbers as authoritative.
export const RETELL_GLOBAL: RateLimitConfig = {
  capacity: Number(process.env.RETELL_GLOBAL_BURST ?? 4),
  refillPerSec: Number(process.env.RETELL_GLOBAL_CPS ?? 2),
};
export const RETELL_TENANT: RateLimitConfig = {
  capacity: Number(process.env.RETELL_TENANT_BURST ?? 2),
  refillPerSec: Number(process.env.RETELL_TENANT_CPS ?? 0.5),
};
export const TWILIO_TENANT: RateLimitConfig = {
  capacity: Number(process.env.TWILIO_TENANT_BURST ?? 2),
  refillPerSec: Number(process.env.TWILIO_TENANT_CPS ?? 0.5),
};

// /api/demo-call's profile_id path is intentionally unauthenticated (the
// public "Try a free demo call" marketing CTA), which makes it the one
// outbound-call trigger reachable with no signup, no tenant, and no API
// key at all -- confirmed 2026-09-24 it previously had no auth AND no rate
// limit, meaning anyone could script arbitrary outbound calls to arbitrary
// numbers at will. Tighter than the paid-tenant limiters above since this
// surface has no cost accountability behind it at all.
export const DEMO_CALL_GLOBAL: RateLimitConfig = {
  capacity: Number(process.env.DEMO_CALL_GLOBAL_BURST ?? 5),
  refillPerSec: Number(process.env.DEMO_CALL_GLOBAL_CPS ?? 0.05), // ~1 every 20s sustained
};
export const DEMO_CALL_IP: RateLimitConfig = {
  capacity: Number(process.env.DEMO_CALL_IP_BURST ?? 2),
  refillPerSec: Number(process.env.DEMO_CALL_IP_CPS ?? 0.0033), // ~1 every 5 min sustained
};

export async function tryAcquireToken(key: string, config: RateLimitConfig, cost = 1): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('calldesk_try_acquire_token', {
    p_key: key,
    p_capacity: config.capacity,
    p_refill_per_sec: config.refillPerSec,
    p_cost: cost,
  });
  if (error) {
    // Fail OPEN, not closed — a rate-limiter outage should never be the
    // reason a real batch/call silently can't run at all. Logged so a
    // persistent failure here is still visible.
    console.error(`Rate limiter RPC failed for key "${key}" (failing open):`, error);
    return true;
  }
  return data === true;
}

// Blocks (polling, not busy-waiting) until a token is available or
// maxWaitMs elapses, returning whether it actually acquired one. Batch
// calling wants pacing, not outright rejection — a denied attempt should
// wait its turn, not fail the target.
export async function acquireTokenBlocking(key: string, config: RateLimitConfig, maxWaitMs = 30000): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (await tryAcquireToken(key, config)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

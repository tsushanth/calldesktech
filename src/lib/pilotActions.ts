import { computePilotStats, DEFAULT_MINUTES_CAP, DEFAULT_PILOT_DAYS, type PilotRow } from '@/lib/pilots';
import { loadCallsForPilot, syncBlockFlag, isMissingTable, type Db } from '@/lib/pilotJobs';

// Admin writes for /api/admin/pilots. Validation is here so the routes stay thin and the rules are testable.

const DAY = 86400_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): ActionResult<never> => ({ ok: false, status, error });

const str = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export async function createPilot(db: Db, body: Record<string, unknown>, now: Date = new Date()): Promise<ActionResult<PilotRow>> {
  let tenantId = str(body.tenant_id, 64);
  const ownerEmail = str(body.owner_email, 320)?.toLowerCase() ?? null;
  if (tenantId && !UUID.test(tenantId)) return fail(400, 'tenant_id must be a workspace id (uuid)');
  if (!tenantId && ownerEmail) {
    const u = await db.from('calldesk_users').select('id').eq('email', ownerEmail).limit(2);
    if (u.error) return fail(500, u.error.message);
    const ids = ((u.data ?? []) as Array<{ id: string }>).map((x) => String(x.id));
    if (ids.length !== 1) return fail(404, ids.length ? 'More than one user has that email: use tenant_id' : 'No user with that email: they need to sign in first, or use tenant_id');
    const t = await db.from('calldesk_tenants').select('id').eq('user_id', ids[0]).limit(2);
    if (t.error) return fail(500, t.error.message);
    const tids = ((t.data ?? []) as Array<{ id: string }>).map((x) => x.id);
    if (tids.length !== 1) return fail(404, tids.length ? 'That user has several workspaces: use tenant_id' : 'That user has no workspace yet');
    tenantId = tids[0];
  }
  if (!tenantId) return fail(400, 'tenant_id or owner_email is required');

  const contactEmail = str(body.contact_email, 320);
  if (contactEmail && !EMAIL.test(contactEmail)) return fail(400, 'contact_email is not a valid email');
  const cap = body.minutes_cap === undefined || body.minutes_cap === '' ? DEFAULT_MINUTES_CAP : Number(body.minutes_cap);
  if (!Number.isFinite(cap) || cap <= 0 || cap > 1000) return fail(400, 'minutes_cap must be between 1 and 1000');
  const days = body.days === undefined || body.days === '' ? DEFAULT_PILOT_DAYS : Number(body.days);
  if (!Number.isFinite(days) || days < 1 || days > 60) return fail(400, 'days must be between 1 and 60');

  const tenant = await db.from('calldesk_tenants').select('id').eq('id', tenantId).maybeSingle();
  if (tenant.error) return fail(500, tenant.error.message);
  if (!tenant.data) return fail(404, 'No workspace with that id');

  const row = {
    tenant_id: tenantId,
    contact_name: str(body.contact_name, 200),
    contact_email: contactEmail,
    company: str(body.company, 200),
    vertical: str(body.vertical, 100),
    started_at: now.toISOString(),
    ends_at: new Date(now.getTime() + days * DAY).toISOString(),
    minutes_cap: cap,
    status: 'active',
    notes: str(body.notes, 4000),
  };
  const ins = await db.from('calldesk_pilots').insert(row).select('*').single();
  if (ins.error) {
    if (isMissingTable(ins.error)) return fail(503, 'Migration 068 (calldesk_pilots) is not applied yet');
    if (ins.error.code === '23505') return fail(409, 'That workspace already has a pilot');
    return fail(500, ins.error.message);
  }
  return { ok: true, data: ins.data as unknown as PilotRow };
}

export type PilotAction =
  | { action: 'stop' }
  | { action: 'convert' }
  | { action: 'extend'; days?: number; minutes?: number }
  | { action: 'notes'; notes: string };

/** Applies stop / convert / extend / notes, then re-derives status and the engine block flag so a change takes effect without waiting for the hourly cron. */
export async function updatePilot(db: Db, id: string, body: Record<string, unknown>, now: Date = new Date()): Promise<ActionResult<PilotRow>> {
  if (!UUID.test(id)) return fail(400, 'Invalid pilot id');
  const cur = await db.from('calldesk_pilots').select('*').eq('id', id).maybeSingle();
  if (cur.error) return fail(500, cur.error.message);
  if (!cur.data) return fail(404, 'Pilot not found');
  const pilot = cur.data as unknown as PilotRow;
  const patch: Partial<PilotRow> = {};

  switch (body.action) {
    case 'stop':
      patch.status = 'stopped';
      break;
    case 'convert':
      patch.status = 'converted';
      break;
    case 'notes':
      if (typeof body.notes !== 'string') return fail(400, 'notes must be a string');
      patch.notes = body.notes.slice(0, 4000);
      break;
    case 'extend': {
      const days = body.days === undefined ? 0 : Number(body.days);
      const minutes = body.minutes === undefined ? 0 : Number(body.minutes);
      if (!Number.isFinite(days) || !Number.isFinite(minutes) || days < 0 || minutes < 0 || (days === 0 && minutes === 0) || days > 60 || minutes > 1000) {
        return fail(400, 'extend needs days (0-60) and/or minutes (0-1000), at least one above 0');
      }
      if (days > 0) patch.ends_at = new Date(Math.max(Date.parse(pilot.ends_at), now.getTime()) + days * DAY).toISOString();
      if (minutes > 0) patch.minutes_cap = Number(pilot.minutes_cap) + minutes;
      patch.status = 'active'; // re-derived below
      break;
    }
    default:
      return fail(400, 'action must be stop, convert, extend or notes');
  }

  let next: PilotRow = { ...pilot, ...patch };
  if (body.action !== 'notes') {
    const stats = computePilotStats(next, await loadCallsForPilot(db, next), now);
    if (body.action === 'extend') patch.status = stats.effectiveStatus;
    next = { ...next, ...patch };
    await syncBlockFlag(db, pilot.tenant_id, stats.blocked, stats.blockReason, now);
  }
  const upd = await db.from('calldesk_pilots').update(patch).eq('id', id).select('*').single();
  if (upd.error) return fail(500, upd.error.message);
  return { ok: true, data: upd.data as unknown as PilotRow };
}

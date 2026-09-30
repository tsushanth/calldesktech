// Configuration-time pipeline for a tenant's jingle / sound-effect assets (see the realtime-tts spec
// docs/superpowers/specs/2026-09-29-call-audio-jingle-sfx-design.md): generate once, convert to
// mu-law@8kHz, store, record. All I/O is injected so the ordering and failure handling are testable;
// the route wires the real ReadAloud client / Supabase implementations.

export const MAX_ENABLED_EFFECTS = 10; // keeps the model's play_sound_effect tool schema small
const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type CallAudioType = 'jingle' | 'sound_effect';

export class CallAudioError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'CallAudioError';
  }
}

export interface CallAudioRow {
  id: string;
  tenant_id: string;
  asset_type: CallAudioType;
  name: string;
  description: string;
  mulaw8k_storage_path: string;
  source_readaloud_job_id: string | null;
  enabled: boolean;
}

export interface CallAudioDeps {
  generateWav(input: { prompt: string; durationSec: number }): Promise<Buffer>;
  convert(wav: Buffer): Buffer;
  uploadObject(path: string, bytes: Buffer): Promise<void>;
  deleteObject(path: string): Promise<void>;
  insertAsset(row: CallAudioRow): Promise<void>;
  deleteAsset(id: string): Promise<void>;
  /** Disables the tenant's other enabled assets this one replaces; returns their ids. */
  disableOthers(q: { tenantId: string; type: CallAudioType; name: string | undefined; exceptId: string }): Promise<string[]>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  /** Enabled effects for the tenant, not counting one named `excludingName`. */
  countEnabledEffects(tenantId: string, excludingName: string): Promise<number>;
  newId(): string;
}

export interface CreateCallAudioInput {
  tenantId: string;
  type: CallAudioType;
  name: string;
  description: string;
  prompt: string;
  durationSec: number;
}

export async function createCallAudioAsset(input: CreateCallAudioInput, deps: CallAudioDeps): Promise<CallAudioRow> {
  const { tenantId, type, name, prompt, durationSec } = input;
  // Everything cheap to check is checked BEFORE the paid generation call.
  if (type !== 'jingle' && type !== 'sound_effect') throw new CallAudioError('Unknown asset type', 400);
  if (!NAME_RE.test(name)) throw new CallAudioError('Name must be 1-64 letters, numbers, "_" or "-"', 400);
  const description = type === 'sound_effect' ? input.description.trim() : '';
  if (type === 'sound_effect' && !description) {
    throw new CallAudioError('A sound effect needs a description: it is how the agent decides when to play it', 400);
  }
  if (type === 'sound_effect' && (await deps.countEnabledEffects(tenantId, name)) >= MAX_ENABLED_EFFECTS) {
    throw new CallAudioError(`A tenant can have at most ${MAX_ENABLED_EFFECTS} enabled sound effects`, 409);
  }

  const wav = await deps.generateWav({ prompt, durationSec });
  const mulaw = deps.convert(wav);

  const id = deps.newId();
  const path = `${tenantId}/${id}.raw`;
  await deps.uploadObject(path, mulaw);

  const row: CallAudioRow = {
    id, tenant_id: tenantId, asset_type: type, name, description,
    mulaw8k_storage_path: path,
    // ReadAloud's MCP tool doesn't return the job id on success, so there is nothing to record yet.
    source_readaloud_job_id: null,
    enabled: false,
  };
  try {
    // Inserted disabled, then swapped in: the DB forbids two enabled effects with one name, so the
    // old row must be disabled before the new one is enabled.
    await deps.insertAsset(row);
  } catch (err) {
    await deps.deleteObject(path).catch(() => {});
    throw err;
  }

  let disabled: string[] = [];
  try {
    disabled = await deps.disableOthers({ tenantId, type, name: type === 'sound_effect' ? name : undefined, exceptId: id });
    await deps.setEnabled(id, true);
  } catch (err) {
    // Put the tenant back exactly as it was: restore what we disabled, drop what we added.
    for (const oldId of disabled) await deps.setEnabled(oldId, true).catch(() => {});
    await deps.deleteAsset(id).catch(() => {});
    await deps.deleteObject(path).catch(() => {});
    throw err;
  }
  return { ...row, enabled: true };
}

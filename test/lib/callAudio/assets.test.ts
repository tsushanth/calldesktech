import { describe, it, expect, vi } from 'vitest';
import { createCallAudioAsset, MAX_ENABLED_EFFECTS, type CallAudioDeps } from '@/lib/callAudio/assets';

const MULAW = Buffer.from([1, 2, 3]);

function makeDeps(over: Partial<CallAudioDeps> = {}) {
  const calls: string[] = [];
  const deps: CallAudioDeps = {
    generateWav: vi.fn(async () => { calls.push('generate'); return Buffer.from('wav'); }),
    convert: vi.fn(() => { calls.push('convert'); return MULAW; }),
    uploadObject: vi.fn(async () => { calls.push('upload'); }),
    deleteObject: vi.fn(async () => { calls.push('deleteObject'); }),
    insertAsset: vi.fn(async () => { calls.push('insert'); }),
    deleteAsset: vi.fn(async () => { calls.push('deleteRow'); }),
    disableOthers: vi.fn(async () => { calls.push('disableOthers'); return ['old-1']; }),
    setEnabled: vi.fn(async () => { calls.push('setEnabled'); }),
    countEnabledEffects: vi.fn(async () => 0),
    newId: () => 'new-id',
    ...over,
  };
  return { deps, calls };
}

const effect = { tenantId: 't1', type: 'sound_effect' as const, name: 'booking_chime', description: 'After a booking is confirmed', prompt: 'a soft chime', durationSec: 2 };
const jingle = { tenantId: 't1', type: 'jingle' as const, name: 'intro', description: '', prompt: 'upbeat 3 note jingle', durationSec: 4 };

describe('createCallAudioAsset', () => {
  it('runs generate -> convert -> upload -> insert(disabled) -> swap out old -> enable, in that order', async () => {
    const { deps, calls } = makeDeps();
    const row = await createCallAudioAsset(effect, deps);
    expect(calls).toEqual(['generate', 'convert', 'upload', 'insert', 'disableOthers', 'setEnabled']);
    expect(row).toMatchObject({ id: 'new-id', tenant_id: 't1', asset_type: 'sound_effect', name: 'booking_chime', enabled: true });
  });

  it('stores under <tenant_id>/<asset_id>.raw and records the converted bytes', async () => {
    const { deps } = makeDeps();
    await createCallAudioAsset(effect, deps);
    expect(deps.uploadObject).toHaveBeenCalledWith('t1/new-id.raw', MULAW);
    expect(deps.insertAsset).toHaveBeenCalledWith(expect.objectContaining({
      id: 'new-id', tenant_id: 't1', mulaw8k_storage_path: 't1/new-id.raw', enabled: false, description: 'After a booking is confirmed',
    }));
  });

  it('a new jingle replaces the tenant\'s other enabled jingle; a new effect replaces only the same-named effect', async () => {
    const a = makeDeps();
    await createCallAudioAsset(jingle, a.deps);
    expect(a.deps.disableOthers).toHaveBeenCalledWith({ tenantId: 't1', type: 'jingle', name: undefined, exceptId: 'new-id' });
    const b = makeDeps();
    await createCallAudioAsset(effect, b.deps);
    expect(b.deps.disableOthers).toHaveBeenCalledWith({ tenantId: 't1', type: 'sound_effect', name: 'booking_chime', exceptId: 'new-id' });
  });

  it('a jingle needs no description (it plays on connect, the model never chooses it)', async () => {
    const { deps } = makeDeps();
    await expect(createCallAudioAsset(jingle, deps)).resolves.toMatchObject({ asset_type: 'jingle', description: '' });
  });

  describe('validation happens before any paid generation', () => {
    it.each([
      ['bad name (space)', { ...effect, name: 'has space' }],
      ['empty name', { ...effect, name: '' }],
      ['effect with no description', { ...effect, description: '  ' }],
      ['unknown type', { ...effect, type: 'music' as never }],
    ])('%s', async (_label, input) => {
      const { deps } = makeDeps();
      await expect(createCallAudioAsset(input, deps)).rejects.toMatchObject({ name: 'CallAudioError', status: 400 });
      expect(deps.generateWav).not.toHaveBeenCalled();
    });

    it(`refuses a new effect past ${MAX_ENABLED_EFFECTS} enabled (keeps the tool schema small), but allows replacing a name`, async () => {
      const full = makeDeps({ countEnabledEffects: vi.fn(async () => MAX_ENABLED_EFFECTS) });
      await expect(createCallAudioAsset(effect, full.deps)).rejects.toMatchObject({ status: 409 });
      expect(full.deps.generateWav).not.toHaveBeenCalled();
      // The count passed excludes this name, so a replacement at the cap is fine.
      expect(full.deps.countEnabledEffects).toHaveBeenCalledWith('t1', 'booking_chime');
      const replace = makeDeps({ countEnabledEffects: vi.fn(async () => MAX_ENABLED_EFFECTS - 1) });
      await expect(createCallAudioAsset(effect, replace.deps)).resolves.toBeTruthy();
    });
  });

  describe('failure handling never leaves a half-made asset or loses the existing one', () => {
    it('generation failure writes nothing', async () => {
      const { deps } = makeDeps({ generateWav: vi.fn(async () => { throw new Error('gen failed'); }) });
      await expect(createCallAudioAsset(effect, deps)).rejects.toThrow('gen failed');
      expect(deps.uploadObject).not.toHaveBeenCalled();
      expect(deps.insertAsset).not.toHaveBeenCalled();
    });
    it('conversion failure (e.g. silent clip) writes nothing', async () => {
      const { deps } = makeDeps({ convert: vi.fn(() => { throw new Error('Generated audio is silent'); }) });
      await expect(createCallAudioAsset(effect, deps)).rejects.toThrow(/silent/);
      expect(deps.uploadObject).not.toHaveBeenCalled();
    });
    it('insert failure removes the uploaded object', async () => {
      const { deps } = makeDeps({ insertAsset: vi.fn(async () => { throw new Error('db down'); }) });
      await expect(createCallAudioAsset(effect, deps)).rejects.toThrow('db down');
      expect(deps.deleteObject).toHaveBeenCalledWith('t1/new-id.raw');
    });
    it('failure enabling the new row re-enables what was disabled and removes the new row + object', async () => {
      const { deps } = makeDeps({ setEnabled: vi.fn(async (id: string) => { if (id === 'new-id') throw new Error('enable failed'); }) });
      await expect(createCallAudioAsset(effect, deps)).rejects.toThrow('enable failed');
      expect(deps.setEnabled).toHaveBeenCalledWith('old-1', true); // old asset restored
      expect(deps.deleteAsset).toHaveBeenCalledWith('new-id');
      expect(deps.deleteObject).toHaveBeenCalledWith('t1/new-id.raw');
    });
  });
});

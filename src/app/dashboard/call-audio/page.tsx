'use client';

import { useState, useEffect, useCallback } from 'react';
import { useOnboarding } from '@/context/OnboardingContext';

interface Asset {
  id: string;
  asset_type: 'jingle' | 'sound_effect';
  name: string;
  description: string;
  enabled: boolean;
  created_at: string;
}

const MAX_SEC = 12;

// Generation takes up to ~a minute (GPU worker), so each form shows a busy state instead of freezing.
function GenerateForm({
  type, busy, onSubmit,
}: {
  type: Asset['asset_type'];
  busy: boolean;
  onSubmit: (v: { name: string; description: string; prompt: string; durationSec: number }) => void;
}) {
  const isEffect = type === 'sound_effect';
  const [name, setName] = useState(isEffect ? '' : 'intro');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [durationSec, setDurationSec] = useState(isEffect ? 2 : 5);
  const valid = prompt.trim() && name.trim() && (!isEffect || description.trim());
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => { e.preventDefault(); if (valid && !busy) onSubmit({ name: name.trim(), description: description.trim(), prompt: prompt.trim(), durationSec }); }}
    >
      {isEffect && (
        <>
          <input className="w-full rounded border px-3 py-2 text-sm" placeholder="Name, e.g. booking_confirmed_chime" value={name} maxLength={64}
            onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_-]/g, '_'))} />
          <input className="w-full rounded border px-3 py-2 text-sm" placeholder="When should the agent play it? e.g. Right after an appointment is booked" value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </>
      )}
      <input className="w-full rounded border px-3 py-2 text-sm" placeholder={isEffect ? 'Describe the sound, e.g. a soft two-note confirmation chime' : 'Describe your jingle, e.g. an upbeat three-note bell melody'}
        value={prompt} maxLength={500} onChange={(e) => setPrompt(e.target.value)} />
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-600">Length
          <input type="number" min={1} max={MAX_SEC} step={1} value={durationSec} className="ml-2 w-16 rounded border px-2 py-1 text-sm"
            onChange={(e) => setDurationSec(Math.min(MAX_SEC, Math.max(1, Number(e.target.value) || 1)))} /> s
        </label>
        <button type="submit" disabled={!valid || busy} className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-40">
          {busy ? 'Generating… (up to a minute)' : isEffect ? 'Generate sound effect' : 'Generate jingle'}
        </button>
      </div>
    </form>
  );
}

function AssetRow({ tenantId, asset, onDelete }: { tenantId: string; asset: Asset; onDelete: (a: Asset) => void }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded border p-3 ${asset.enabled ? '' : 'opacity-50'}`}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{asset.name}{!asset.enabled && <span className="ml-2 text-xs text-gray-500">(replaced)</span>}</div>
        {asset.description && <div className="text-xs text-gray-600">{asset.description}</div>}
      </div>
      <audio controls preload="none" src={`/api/tenants/${tenantId}/call-audio/${asset.id}/audio`} className="h-8" />
      <button onClick={() => onDelete(asset)} className="text-sm text-red-600 hover:underline">Delete</button>
    </div>
  );
}

export default function CallAudioPage() {
  const { tenantId, isHydrated } = useOnboarding();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busyType, setBusyType] = useState<Asset['asset_type'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/tenants/${tenantId}/call-audio`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setAssets(body.assets);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [tenantId]);

  useEffect(() => { if (isHydrated) load(); }, [isHydrated, load]);

  const generate = async (type: Asset['asset_type'], v: { name: string; description: string; prompt: string; durationSec: number }) => {
    if (!tenantId) return;
    setBusyType(type);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/call-audio`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, ...v }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Generation failed');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setBusyType(null);
    }
  };

  const remove = async (a: Asset) => {
    if (!tenantId || !confirm(`Delete "${a.name}"? Callers will stop hearing it.`)) return;
    const res = await fetch(`/api/tenants/${tenantId}/call-audio/${a.id}`, { method: 'DELETE' });
    if (!res.ok) { setError('Could not delete this sound'); return; }
    await load();
  };

  const active = assets.filter((a) => a.enabled);
  const jingle = active.find((a) => a.asset_type === 'jingle');
  const effects = active.filter((a) => a.asset_type === 'sound_effect');

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Sounds</h1>
        <p className="mt-1 text-sm text-gray-600">
          Two kinds of sound for your calls. The <strong>intro jingle</strong> plays automatically when a call connects, before the greeting.
          <strong> Sound effects</strong> are played by your agent during the call, when the situation you describe comes up.
          Applies to agents on the in-house engine only; agents on Retell are unaffected. Each sound is generated once here, never during a call.
        </p>
      </div>

      {error && <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loadFailed && <div className="text-sm text-gray-500">Couldn&apos;t load your sounds. Try refreshing.</div>}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Intro jingle</h2>
        {jingle ? <AssetRow tenantId={tenantId!} asset={jingle} onDelete={remove} /> : <p className="text-sm text-gray-500">No jingle yet.</p>}
        <div className="text-sm font-medium">{jingle ? 'Replace it' : 'Create one'}</div>
        <GenerateForm type="jingle" busy={busyType === 'jingle'} onSubmit={(v) => generate('jingle', v)} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Sound effects</h2>
        {effects.length === 0 && <p className="text-sm text-gray-500">No sound effects yet.</p>}
        {effects.map((a) => <AssetRow key={a.id} tenantId={tenantId!} asset={a} onDelete={remove} />)}
        <div className="text-sm font-medium">Add one <span className="font-normal text-gray-500">(reusing a name replaces that effect)</span></div>
        <GenerateForm type="sound_effect" busy={busyType === 'sound_effect'} onSubmit={(v) => generate('sound_effect', v)} />
      </section>
    </div>
  );
}

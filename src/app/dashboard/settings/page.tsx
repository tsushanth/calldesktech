'use client';

import { useState, useEffect } from 'react';
import { useOnboarding } from '@/context/OnboardingContext';
import { api, type Tenant } from '@/lib/api';
import { formatPhoneDisplay } from '@/lib/utils';
import { VOICE_OPTIONS, TONE_OPTIONS } from '@/lib/constants';
import type { RetellVoice } from '@/lib/retell';
import type { VoiceEngine } from '@/lib/voiceEngine';
import type { TtsBackend } from '@/types';
import { WizardBlocksPicker } from '@/components/flow-builder/WizardBlocksPicker';
import { buildWizardFlow, DEFAULT_WIZARD_BLOCKS, type WizardBlocks } from '@/lib/flowBuilder';
import type { Agent, AgentVersion } from '@/types';

export default function SettingsPage() {
  const { tenantId, businessName, assignedPhoneNumber, isHydrated } = useOnboarding();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [name, setName] = useState('');
  // Was defaulting to 'eleven_turbo_v2' — an ElevenLabs TTS *model* id, not a
  // valid Retell voice_id, so it never matched any real voice option and got
  // silently persisted as garbage if a tenant saved before picking a voice.
  const [selectedVoice, setSelectedVoice] = useState('');
  const [selectedTone, setSelectedTone] = useState('professional');
  // Retell's real multi-provider voice catalog (elevenlabs, openai, cartesia,
  // minimax, fish_audio, platform) — replaces the old hardcoded two-voice,
  // ElevenLabs-only VOICE_OPTIONS list. Falls back to VOICE_OPTIONS if the
  // fetch fails, so the picker never shows zero choices.
  const [voices, setVoices] = useState<RetellVoice[]>([]);
  const [providerFilter, setProviderFilter] = useState<'all' | RetellVoice['provider']>('all');
  const [calApiKey, setCalApiKey] = useState('');
  const [calEventTypeId, setCalEventTypeId] = useState('');
  const [voiceEngine, setVoiceEngine] = useState<VoiceEngine>('poc');
  const [ttsBackend, setTtsBackend] = useState<TtsBackend>('kokoro');
  // Call recording — mirrors Retell's own data_storage_setting/
  // data_storage_retention_days (see src/lib/retell.ts's updateAgent).
  // 'everything' + indefinite matches their default.
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  const [recordingRetentionDays, setRecordingRetentionDays] = useState('');

  // Building blocks — backed by the tenant's default "simple" agent (see
  // src/lib/flowBuilder.ts / the "Two-Tier Onboarding" design doc). This is
  // the ongoing-edit half of the wizard; the onboarding half creates this
  // same agent's version 1 on signup (see OnboardingContext).
  const [simpleAgent, setSimpleAgent] = useState<Agent | null>(null);
  const [latestVersion, setLatestVersion] = useState<AgentVersion | null>(null);
  const [wizardBlocks, setWizardBlocks] = useState<WizardBlocks>(DEFAULT_WIZARD_BLOCKS);
  const [transferToNumber, setTransferToNumber] = useState('');
  const [showGoLiveConfirm, setShowGoLiveConfirm] = useState(false);
  const [isSavingBlocks, setIsSavingBlocks] = useState(false);

  useEffect(() => {
    async function loadTenant() {
      if (!tenantId || !isHydrated) return;

      setIsLoading(true);
      try {
        const data = await api.getTenant(tenantId);
        if (data) {
          setTenant(data);
          setName(data.name);
          const settings = data.settings as Record<string, string> | null;
          if (settings) {
            setSelectedVoice(settings.voice || 'eleven_turbo_v2');
            setSelectedTone(settings.tone || 'professional');
            setVoiceEngine(settings.voice_engine === 'poc' ? 'poc' : 'retell');
            const savedBackend = settings.tts_backend;
            setTtsBackend(
              savedBackend === 'elevenlabs' || savedBackend === 'cartesia' || savedBackend === 'minimax'
                ? savedBackend
                : 'kokoro'
            );
            setRecordingEnabled(settings.recording_enabled !== 'false');
            setRecordingRetentionDays(settings.recording_retention_days || '');
          }
          setCalApiKey(data.cal_api_key || '');
          setCalEventTypeId(data.cal_event_type_id || '');
        }

        const agentsRes = await fetch(`/api/tenants/${tenantId}/agents`);
        const agentsBody = await agentsRes.json();
        const agent: Agent | undefined = agentsRes.ok
          ? agentsBody.agents.find((a: Agent) => a.mode === 'simple')
          : undefined;
        setSimpleAgent(agent || null);

        if (agent) {
          const versionsRes = await fetch(`/api/agents/${agent.id}/versions`);
          const versionsBody = await versionsRes.json();
          const latest: AgentVersion | undefined = versionsRes.ok ? versionsBody.versions[0] : undefined;
          setLatestVersion(latest || null);
          const savedBlocks = latest?.wizard_config as (WizardBlocks & { transferToNumber?: string }) | null | undefined;
          if (savedBlocks) {
            setWizardBlocks({ booking: !!savedBlocks.booking, transfer: !!savedBlocks.transfer, takeMessage: !!savedBlocks.takeMessage });
            setTransferToNumber(savedBlocks.transferToNumber || '');
          }
        }
      } catch (err) {
        console.error('Failed to load tenant:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadTenant();
  }, [tenantId, isHydrated]);

  useEffect(() => {
    let cancelled = false;
    api
      .getRetellVoices()
      .then((v) => {
        if (!cancelled && v.length > 0) setVoices(v);
      })
      .catch((err) => console.error('Failed to load Retell voices, falling back to static list:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveBlocks = async () => {
    if (!tenantId) return;
    setIsSavingBlocks(true);
    setMessage(null);
    try {
      let agentId = simpleAgent?.id;
      if (!agentId) {
        const res = await fetch(`/api/tenants/${tenantId}/agents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name || 'Front Desk' }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        setSimpleAgent(body.agent);
        agentId = body.agent.id;
      }

      const synthesized = buildWizardFlow({ businessName: name, transferToNumber }, wizardBlocks);
      const versionRes = await fetch(`/api/agents/${agentId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowName: `v${(latestVersion?.version_number || 0) + 1}`,
          startNodeId: synthesized.startNodeId,
          nodes: synthesized.nodes,
          voiceEngine,
          ttsBackend: voiceEngine === 'poc' ? ttsBackend : undefined,
          wizardConfig: { ...wizardBlocks, transferToNumber },
        }),
      });
      const versionBody = await versionRes.json();
      if (!versionRes.ok) throw new Error(versionBody.error);
      setLatestVersion(versionBody.version);

      // Go live now: route every phone number already pointing at the
      // previous version's inbound slot to this new one. A tenant with no
      // number yet (nothing to route) still gets the version saved above —
      // it'll be there to route to once a number exists.
      const numbersRes = await fetch(`/api/tenants/${tenantId}/phone-numbers`);
      const numbersBody = await numbersRes.json();
      if (numbersRes.ok) {
        await Promise.all(
          numbersBody.phoneNumbers
            .filter((n: { inbound_agent_version_id: string | null }) => !latestVersion || n.inbound_agent_version_id === latestVersion.id || n.inbound_agent_version_id === null)
            .map((n: { id: string }) =>
              fetch(`/api/phone-numbers/${n.id}/routing`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ direction: 'inbound', agentVersionId: versionBody.version.id }),
              })
            )
        );
      }

      setShowGoLiveConfirm(false);
      setMessage({ type: 'success', text: 'Your changes are live.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save changes' });
    } finally {
      setIsSavingBlocks(false);
    }
  };

  const handleSave = async () => {
    if (!tenantId) return;

    setIsSaving(true);
    setMessage(null);

    try {
      await api.updateTenant(tenantId, {
        name,
        settings: {
          voice: selectedVoice,
          tone: selectedTone,
          voice_engine: voiceEngine,
          tts_backend: ttsBackend,
          recording_enabled: String(recordingEnabled),
          recording_retention_days: recordingRetentionDays,
        },
        cal_api_key: calApiKey || null,
        cal_event_type_id: calEventTypeId || null,
      });
      setMessage({ type: 'success', text: 'Settings saved successfully!' });
    } catch (err) {
      console.error('Failed to save settings:', err);
      setMessage({ type: 'error', text: 'Failed to save settings. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="p-10 text-center text-[13.5px] text-gray-400">Loading settings…</div>;
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[22px] font-semibold text-[#1a1d29]">Settings</h1>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-lg bg-[#1a1d29] px-5 py-2 text-[13.5px] font-medium text-white transition hover:bg-[#2a2e3d] disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {message && (
        <div
          className={`mb-5 rounded-lg px-4 py-3 text-[13.5px] ${
            message.type === 'success' ? 'border border-green-200 bg-green-50 text-green-700' : 'border border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="space-y-5">
        {/* Business Information */}
        <SettingsSection title="Business Information" icon={<IconBuilding />}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Business Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Phone Number</label>
              <input
                type="text"
                value={assignedPhoneNumber ? formatPhoneDisplay(assignedPhoneNumber) : 'Not assigned'}
                disabled
                className="w-full cursor-not-allowed rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-[13.5px] text-gray-400"
              />
            </div>
          </div>
        </SettingsSection>

        {/* AI Voice Settings */}
        <SettingsSection title="AI Voice" icon={<IconMic />}>
          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-[12.5px] font-medium text-gray-500">Voice</label>
              <p className="text-[11.5px] text-gray-400">
                {voices.length > 0 ? `${voices.length} voices across every provider Retell supports` : 'Loading full voice catalog…'}
              </p>
            </div>
            {voices.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {(['all', ...Array.from(new Set(voices.map((v) => v.provider)))] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setProviderFilter(p)}
                    className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium capitalize transition ${
                      providerFilter === p
                        ? 'border-blue-400 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    {p === 'fish_audio' ? 'Fish Audio' : p}
                  </button>
                ))}
              </div>
            )}
            <div className="grid max-h-80 grid-cols-2 gap-2.5 overflow-y-auto md:grid-cols-4">
              {(voices.length > 0
                ? voices.filter((v) => providerFilter === 'all' || v.provider === providerFilter)
                : VOICE_OPTIONS
              ).map((voice) => {
                const id = 'voice_id' in voice ? voice.voice_id : voice.id;
                const name = 'voice_name' in voice ? voice.voice_name : voice.name;
                const description =
                  'provider' in voice
                    ? [voice.provider === 'fish_audio' ? 'Fish Audio' : voice.provider, voice.gender, voice.accent].filter(Boolean).join(' · ')
                    : voice.description;
                return (
                  <OptionCard key={id} selected={selectedVoice === id} onClick={() => setSelectedVoice(id)} title={name} description={description} />
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-[12.5px] font-medium text-gray-500">Tone</label>
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
              {TONE_OPTIONS.map((tone) => (
                <OptionCard key={tone.id} selected={selectedTone === tone.id} onClick={() => setSelectedTone(tone.id)} title={tone.label} description={tone.description} />
              ))}
            </div>
          </div>
        </SettingsSection>

        {/* Voice Engine */}
        <SettingsSection title="Call Engine" icon={<IconPlug />}>
          <p className="mb-4 text-[13.5px] text-gray-500">
            Which pipeline handles this tenant&apos;s calls. CallDeskTech is our own engine, with real phone numbers and outbound/inbound calling; Retell is kept only as a comparison baseline.
          </p>
          <div className="grid max-w-md grid-cols-2 gap-2.5">
            <OptionCard selected={voiceEngine === 'poc'} onClick={() => setVoiceEngine('poc')} title="CallDeskTech" description="Our own engine — real phone numbers" />
            <OptionCard selected={voiceEngine === 'retell'} onClick={() => setVoiceEngine('retell')} title="Retell" description="Comparison baseline" />
          </div>

          {voiceEngine === 'poc' && (
            <div className="mt-5">
              <label className="mb-2 block text-[12.5px] font-medium text-gray-500">TTS Backend</label>
              <div className="grid max-w-2xl grid-cols-2 gap-2.5 md:grid-cols-4">
                <OptionCard selected={ttsBackend === 'kokoro'} onClick={() => setTtsBackend('kokoro')} title="CallDeskTech" description="Our own voice, lowest cost" />
                <OptionCard selected={ttsBackend === 'elevenlabs'} onClick={() => setTtsBackend('elevenlabs')} title="ElevenLabs" description="Higher quality, per-char cost" />
                <OptionCard selected={ttsBackend === 'cartesia'} onClick={() => setTtsBackend('cartesia')} title="Cartesia" description="Low-latency streaming" />
                <OptionCard selected={ttsBackend === 'minimax'} onClick={() => setTtsBackend('minimax')} title="MiniMax" description="Higher cost, $0.16/min" />
              </div>
              {(ttsBackend === 'cartesia' || ttsBackend === 'minimax') && (
                <p className="mt-2 text-[12px] text-amber-600">
                  This voice isn&apos;t fully set up on our end yet — calls will use the CallDeskTech voice instead until it is. Contact us if you need this enabled sooner.
                </p>
              )}
            </div>
          )}
        </SettingsSection>

        {/* Call Recording */}
        <SettingsSection title="Call Recording" icon={<IconMic />}>
          <p className="mb-4 text-[13.5px] text-gray-500">
            Matches Retell&apos;s own default: recording is on, with no in-call disclosure announcement — consent is left to you to handle however fits your business, not enforced by the platform.
          </p>
          <div className="grid max-w-md grid-cols-2 gap-2.5">
            <OptionCard selected={recordingEnabled} onClick={() => setRecordingEnabled(true)} title="Record calls" description="Audio + transcript kept" />
            <OptionCard selected={!recordingEnabled} onClick={() => setRecordingEnabled(false)} title="Don't record" description="No audio captured" />
          </div>
          {recordingEnabled && (
            <div className="mt-4 max-w-xs">
              <label className="mb-1.5 block text-[12.5px] font-medium text-gray-500">Retention</label>
              <select
                value={recordingRetentionDays}
                onChange={(e) => setRecordingRetentionDays(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">Indefinite (default)</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="180">180 days</option>
                <option value="365">365 days</option>
              </select>
              <p className="mt-1 text-[11px] text-gray-400">Recordings older than this get deleted automatically. Doesn&apos;t affect transcripts, only audio.</p>
            </div>
          )}
        </SettingsSection>

        {/* Building Blocks */}
        <SettingsSection title="What your receptionist can do" icon={<IconPuzzle />}>
          {simpleAgent?.mode === 'advanced' ? (
            <p className="text-[13.5px] text-gray-500">
              This agent has been moved to advanced mode — edit it in the{' '}
              <a href={`/dashboard/agents/${simpleAgent.id}`} className="font-medium text-blue-600 hover:text-blue-700">
                Agents console
              </a>{' '}
              instead. The building-block wizard no longer applies here.
            </p>
          ) : (
            <>
              <WizardBlocksPicker
                blocks={wizardBlocks}
                onChange={setWizardBlocks}
                transferToNumber={transferToNumber}
                onTransferToNumberChange={setTransferToNumber}
              />
              {message && message.text === 'Your changes are live.' && (
                <p className="mt-3 text-[13px] text-green-600">{message.text}</p>
              )}
              <div className="mt-4 flex justify-end border-t border-gray-100 pt-4">
                {showGoLiveConfirm ? (
                  <div className="flex items-center gap-3">
                    <p className="text-[13px] text-amber-600">This goes live on real calls immediately.</p>
                    <button
                      onClick={handleSaveBlocks}
                      disabled={isSavingBlocks}
                      className="rounded-lg bg-amber-500 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-amber-600 disabled:opacity-50"
                    >
                      {isSavingBlocks ? 'Saving…' : 'Yes, make it live'}
                    </button>
                    <button
                      onClick={() => setShowGoLiveConfirm(false)}
                      className="rounded-lg border border-gray-200 px-4 py-2 text-[13px] text-gray-600 transition hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowGoLiveConfirm(true)}
                    className="rounded-lg bg-blue-600 px-5 py-2 text-[13px] font-medium text-white transition hover:bg-blue-700"
                  >
                    Save &amp; go live
                  </button>
                )}
              </div>
            </>
          )}
        </SettingsSection>

        {/* Calendar Integration */}
        <SettingsSection title="Calendar Integration" icon={<IconCalendar />}>
          <p className="mb-4 text-[13.5px] text-gray-500">
            Connect your Cal.com calendar to enable real-time appointment booking during calls.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Cal.com API Key</label>
              <input
                type="password"
                value={calApiKey}
                onChange={(e) => setCalApiKey(e.target.value)}
                placeholder="cal_live_..."
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Event Type ID</label>
              <input
                type="text"
                value={calEventTypeId}
                onChange={(e) => setCalEventTypeId(e.target.value)}
                placeholder="123456"
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>
          <p className="mt-2 text-[12.5px] text-gray-400">
            Find your API key at{' '}
            <a href="https://cal.com/settings/developer/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700">
              cal.com/settings/developer/api-keys
            </a>
          </p>
        </SettingsSection>

        {/* Danger Zone */}
        <SettingsSection title="Danger Zone" icon={<IconWarning />} danger>
          <p className="mb-4 text-[13.5px] text-gray-500">These actions are destructive and cannot be undone.</p>
          <div className="flex flex-wrap gap-3">
            <button className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-[13px] font-medium text-red-600 transition hover:bg-red-100">
              Delete All Call Logs
            </button>
            <button className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-[13px] font-medium text-red-600 transition hover:bg-red-100">
              Delete Account
            </button>
          </div>
        </SettingsSection>
      </div>
    </>
  );
}

function OptionCard({ selected, onClick, title, description }: { selected: boolean; onClick: () => void; title: string; description: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-3.5 text-left transition ${selected ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
    >
      <p className="text-[13px] font-medium text-[#1a1d29]">{title}</p>
      <p className="mt-0.5 text-[12px] text-gray-500">{description}</p>
    </button>
  );
}

function SettingsSection({
  title,
  icon,
  children,
  danger,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-5 ${danger ? 'border-red-200 bg-red-50/40' : 'border-gray-200 bg-white'}`}>
      <h2 className="mb-4 flex items-center gap-2 text-[14px] font-semibold text-[#1a1d29]">
        <span className={danger ? 'text-red-500' : 'text-gray-400'}>{icon}</span>
        <span>{title}</span>
      </h2>
      {children}
    </div>
  );
}

function IconBuilding() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1" /></svg>; }
function IconMic() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>; }
function IconPlug() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3v5M15 3v5M6 8h12l-1 5a5 5 0 0 1-10 0L6 8Z" /><path d="M12 16v5" /></svg>; }
function IconPuzzle() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4h3.5a1.5 1.5 0 0 1 1.4 2A1.5 1.5 0 0 0 15.3 8H19a1 1 0 0 1 1 1v3.7a1.5 1.5 0 0 0-2 1.4 1.5 1.5 0 0 0 2 1.4V19a1 1 0 0 1-1 1h-3.7a1.5 1.5 0 0 0 .1-.6 1.5 1.5 0 0 0-3 0 1.5 1.5 0 0 0 .1.6H9a1 1 0 0 1-1-1v-3.5a1.5 1.5 0 0 0-2-1.4A1.5 1.5 0 0 1 4.6 12 1.5 1.5 0 0 1 6 10.5a1.5 1.5 0 0 0 2-1.4V5a1 1 0 0 1 1-1Z" /></svg>; }
function IconCalendar() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M8 3v4M16 3v4M3.5 10h17" /></svg>; }
function IconWarning() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17h.01" /></svg>; }

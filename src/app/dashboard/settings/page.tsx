'use client';

import { useState, useEffect } from 'react';
import { useOnboarding } from '@/context/OnboardingContext';
import { api, type Tenant } from '@/lib/api';
import { formatPhoneDisplay } from '@/lib/utils';
import { VOICE_OPTIONS, TONE_OPTIONS } from '@/lib/constants';
import type { VoiceEngine } from '@/lib/voiceEngine';
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
  const [selectedVoice, setSelectedVoice] = useState('eleven_turbo_v2');
  const [selectedTone, setSelectedTone] = useState('professional');
  const [calApiKey, setCalApiKey] = useState('');
  const [calEventTypeId, setCalEventTypeId] = useState('');
  const [voiceEngine, setVoiceEngine] = useState<VoiceEngine>('retell');
  const [ttsBackend, setTtsBackend] = useState<'kokoro' | 'elevenlabs'>('kokoro');

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
            setTtsBackend(settings.tts_backend === 'elevenlabs' ? 'elevenlabs' : 'kokoro');
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
    return <div className="p-8 text-center text-gray-400">Loading settings...</div>;
  }

  return (
    <>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">Settings</h1>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 px-6 py-2 rounded-lg transition"
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {message && (
        <div
          className={`mb-6 p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-500/20 text-green-400'
              : 'bg-red-500/20 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="space-y-6">
        {/* Business Information */}
        <SettingsSection title="Business Information" icon="🏢">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Business Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Phone Number</label>
              <input
                type="text"
                value={assignedPhoneNumber ? formatPhoneDisplay(assignedPhoneNumber) : 'Not assigned'}
                disabled
                className="w-full bg-gray-600 border border-gray-600 rounded-lg px-4 py-2 text-gray-400 cursor-not-allowed"
              />
            </div>
          </div>
        </SettingsSection>

        {/* AI Voice Settings */}
        <SettingsSection title="AI Voice" icon="🎙️">
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-2">Voice</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {VOICE_OPTIONS.map((voice) => (
                <button
                  key={voice.id}
                  type="button"
                  onClick={() => setSelectedVoice(voice.id)}
                  className={`p-4 rounded-lg border text-left transition ${
                    selectedVoice === voice.id
                      ? 'bg-blue-600/20 border-blue-500'
                      : 'bg-gray-700 border-gray-600 hover:border-gray-500'
                  }`}
                >
                  <p className="font-medium">{voice.name}</p>
                  <p className="text-sm text-gray-400">{voice.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Tone</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {TONE_OPTIONS.map((tone) => (
                <button
                  key={tone.id}
                  type="button"
                  onClick={() => setSelectedTone(tone.id)}
                  className={`p-4 rounded-lg border text-left transition ${
                    selectedTone === tone.id
                      ? 'bg-blue-600/20 border-blue-500'
                      : 'bg-gray-700 border-gray-600 hover:border-gray-500'
                  }`}
                >
                  <p className="font-medium">{tone.label}</p>
                  <p className="text-sm text-gray-400">{tone.description}</p>
                </button>
              ))}
            </div>
          </div>
        </SettingsSection>

        {/* Voice Engine */}
        <SettingsSection title="Call Engine" icon="🔌">
          <p className="text-gray-400 mb-4">
            Which pipeline handles this tenant&apos;s demo calls. Retell places a real outbound
            phone call; our in-house engine runs entirely in-browser with no telephony involved.
          </p>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <button
              type="button"
              onClick={() => setVoiceEngine('retell')}
              className={`p-4 rounded-lg border text-left transition ${
                voiceEngine === 'retell'
                  ? 'bg-blue-600/20 border-blue-500'
                  : 'bg-gray-700 border-gray-600 hover:border-gray-500'
              }`}
            >
              <p className="font-medium">Retell</p>
              <p className="text-sm text-gray-400">Real outbound PSTN call</p>
            </button>
            <button
              type="button"
              onClick={() => setVoiceEngine('poc')}
              className={`p-4 rounded-lg border text-left transition ${
                voiceEngine === 'poc'
                  ? 'bg-blue-600/20 border-blue-500'
                  : 'bg-gray-700 border-gray-600 hover:border-gray-500'
              }`}
            >
              <p className="font-medium">In-house (beta)</p>
              <p className="text-sm text-gray-400">In-browser, no phone number</p>
            </button>
          </div>

          {voiceEngine === 'poc' && (
            <div className="mt-6">
              <label className="block text-sm text-gray-400 mb-2">TTS Backend</label>
              <div className="grid grid-cols-2 gap-3 max-w-md">
                <button
                  type="button"
                  onClick={() => setTtsBackend('kokoro')}
                  className={`p-4 rounded-lg border text-left transition ${
                    ttsBackend === 'kokoro'
                      ? 'bg-blue-600/20 border-blue-500'
                      : 'bg-gray-700 border-gray-600 hover:border-gray-500'
                  }`}
                >
                  <p className="font-medium">Kokoro</p>
                  <p className="text-sm text-gray-400">Self-hosted, lowest cost</p>
                </button>
                <button
                  type="button"
                  onClick={() => setTtsBackend('elevenlabs')}
                  className={`p-4 rounded-lg border text-left transition ${
                    ttsBackend === 'elevenlabs'
                      ? 'bg-blue-600/20 border-blue-500'
                      : 'bg-gray-700 border-gray-600 hover:border-gray-500'
                  }`}
                >
                  <p className="font-medium">ElevenLabs</p>
                  <p className="text-sm text-gray-400">Higher quality, per-char cost</p>
                </button>
              </div>
            </div>
          )}
        </SettingsSection>

        {/* Building Blocks */}
        <SettingsSection title="What your receptionist can do" icon="🧩">
          {simpleAgent?.mode === 'advanced' ? (
            <p className="text-gray-400">
              This agent has been moved to advanced mode — edit it in the{' '}
              <a href={`/dashboard/agents/${simpleAgent.id}`} className="text-blue-400 hover:text-blue-300">
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
                dark
              />
              {message && message.text === 'Your changes are live.' && (
                <p className="text-sm text-green-400 mt-3">{message.text}</p>
              )}
              <div className="mt-4 pt-4 border-t border-gray-700 flex justify-end">
                {showGoLiveConfirm ? (
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-amber-300">This goes live on real calls immediately.</p>
                    <button
                      onClick={handleSaveBlocks}
                      disabled={isSavingBlocks}
                      className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition"
                    >
                      {isSavingBlocks ? 'Saving...' : 'Yes, make it live'}
                    </button>
                    <button
                      onClick={() => setShowGoLiveConfirm(false)}
                      className="border border-gray-600 hover:border-gray-400 px-4 py-2 rounded-lg text-sm transition"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowGoLiveConfirm(true)}
                    className="bg-blue-600 hover:bg-blue-700 px-5 py-2 rounded-lg text-sm font-medium transition"
                  >
                    Save &amp; go live
                  </button>
                )}
              </div>
            </>
          )}
        </SettingsSection>

        {/* Calendar Integration */}
        <SettingsSection title="Calendar Integration" icon="📅">
          <p className="text-gray-400 mb-4">
            Connect your Cal.com calendar to enable real-time appointment booking during calls.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Cal.com API Key</label>
              <input
                type="password"
                value={calApiKey}
                onChange={(e) => setCalApiKey(e.target.value)}
                placeholder="cal_live_..."
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Event Type ID</label>
              <input
                type="text"
                value={calEventTypeId}
                onChange={(e) => setCalEventTypeId(e.target.value)}
                placeholder="123456"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-2">
            Find your API key at{' '}
            <a
              href="https://cal.com/settings/developer/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300"
            >
              cal.com/settings/developer/api-keys
            </a>
          </p>
        </SettingsSection>

        {/* Danger Zone */}
        <SettingsSection title="Danger Zone" icon="⚠️" danger>
          <p className="text-gray-400 mb-4">
            These actions are destructive and cannot be undone.
          </p>
          <div className="flex gap-4">
            <button className="bg-red-600/20 text-red-400 hover:bg-red-600/30 px-4 py-2 rounded-lg transition border border-red-600/50">
              Delete All Call Logs
            </button>
            <button className="bg-red-600/20 text-red-400 hover:bg-red-600/30 px-4 py-2 rounded-lg transition border border-red-600/50">
              Delete Account
            </button>
          </div>
        </SettingsSection>
      </div>
    </>
  );
}

function SettingsSection({
  title,
  icon,
  children,
  danger,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-6 ${
        danger
          ? 'bg-red-500/5 border-red-500/20'
          : 'bg-gray-800 border-gray-700'
      }`}
    >
      <h2 className="font-semibold mb-4 flex items-center gap-2">
        <span>{icon}</span>
        <span>{title}</span>
      </h2>
      {children}
    </div>
  );
}

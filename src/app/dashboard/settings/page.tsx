'use client';

import { useState, useEffect } from 'react';
import { useOnboarding } from '@/context/OnboardingContext';
import { api, type Tenant } from '@/lib/api';
import { formatPhoneDisplay } from '@/lib/utils';
import { VOICE_OPTIONS, TONE_OPTIONS } from '@/lib/constants';

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
          }
          setCalApiKey(data.cal_api_key || '');
          setCalEventTypeId(data.cal_event_type_id || '');
        }
      } catch (err) {
        console.error('Failed to load tenant:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadTenant();
  }, [tenantId, isHydrated]);

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

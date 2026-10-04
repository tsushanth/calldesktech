'use client';

import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useOnboarding } from '@/context/OnboardingContext';
import { track } from '@/components/Analytics';
import { notifyPhoneNumbersChanged } from '@/lib/events';
import type { PhoneNumber, Agent, AgentVersion, AgentEnvironment } from '@/types';

const ENV_PREFIX = 'env:';

interface PhoneNumberPort {
  id: string;
  number: string;
  status: string;
  twilio_port_in_request_sid: string | null;
  last_submit_error: string | null;
  created_at: string;
}

// Mirrors Retell's own Phone Numbers screen: a list on the left, and on the
// right an Inbound Call Agent dropdown and a separate Outbound Call Agent
// dropdown for whichever number is selected — each one routes to a specific
// agent VERSION, not just "the agent" (see the "Two-Tier Onboarding" design
// doc for why). Picking a version here is what "activation" means in this
// model, and re-picking an older one is how rollback works.
export default function PhoneNumbersPage() {
  const router = useRouter();
  const { tenantId, isHydrated } = useOnboarding();
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [versionsByAgent, setVersionsByAgent] = useState<Record<string, AgentVersion[]>>({});
  const [environmentsByAgent, setEnvironmentsByAgent] = useState<Record<string, AgentEnvironment[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newNumber, setNewNumber] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBuying, setIsBuying] = useState(false);
  const [buyAreaCode, setBuyAreaCode] = useState('');
  // Set when the server says buying a number is a paid add-on (Lite/Standard): shows the terms and needs a checkbox before buying.
  const [addonTerms, setAddonTerms] = useState<string | null>(null);
  const [addonAccepted, setAddonAccepted] = useState(false);
  const [billingPrompt, setBillingPrompt] = useState<{ message: string; action: 'checkout' | 'billing_portal' } | null>(null);
  const [showCallModal, setShowCallModal] = useState(false);
  const [callToNumber, setCallToNumber] = useState('');
  const [isCalling, setIsCalling] = useState(false);
  const [callResult, setCallResult] = useState<{ sid: string; to: string } | null>(null);
  const [callError, setCallError] = useState<string | null>(null);

  // Number porting
  const [ports, setPorts] = useState<PhoneNumberPort[]>([]);
  const [showPortForm, setShowPortForm] = useState(false);
  const [isSubmittingPort, setIsSubmittingPort] = useState(false);
  const [portError, setPortError] = useState<string | null>(null);
  const [checkingStatusId, setCheckingStatusId] = useState<string | null>(null);
  const [portForm, setPortForm] = useState({
    number: '',
    losingCarrierName: '',
    customerType: 'Business',
    authorizedRepresentative: '',
    authorizedRepresentativeEmail: '',
    accountTelephoneNumber: '',
    accountNumber: '',
    // Twilio's losing_carrier_information.address is a required nested
    // object (street/city/state/zip/country) per a live docs check of
    // https://www.twilio.com/docs/phone-numbers/port-in/port-in-request-api
    // on 2026-09-28 — the form previously collected everything else but not
    // this, so every real submission would have failed on a missing field.
    addressStreet: '',
    addressCity: '',
    addressState: '',
    addressZip: '',
    addressCountry: 'US',
  });
  // LOA document upload — Twilio's real PortIn submission requires at least
  // one Utility Bill document sid (see .../port/documents/route.ts). Kept
  // separate from portForm because it goes through its own upload request
  // BEFORE the port request is submitted, not as part of the same payload.
  const [portDocFile, setPortDocFile] = useState<File | null>(null);
  const [isUploadingPortDoc, setIsUploadingPortDoc] = useState(false);
  const [portDocSid, setPortDocSid] = useState<string | null>(null);
  const [portDocError, setPortDocError] = useState<string | null>(null);

  const handleUploadPortDocument = async () => {
    if (!tenantId || !portDocFile) return;
    setIsUploadingPortDoc(true);
    setPortDocError(null);
    try {
      const fd = new FormData();
      fd.set('file', portDocFile);
      fd.set('documentType', 'utility_bill');
      const res = await fetch(`/api/tenants/${tenantId}/phone-numbers/port/documents`, {
        method: 'POST',
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Document upload failed');
      if (!body.documentSid) throw new Error('Upload succeeded locally but Twilio did not return a document sid');
      setPortDocSid(body.documentSid);
    } catch (err) {
      setPortDocSid(null);
      setPortDocError(err instanceof Error ? err.message : 'Failed to upload document');
    } finally {
      setIsUploadingPortDoc(false);
    }
  };

  const load = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);
    try {
      const [numbersRes, agentsRes, portsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/phone-numbers`),
        fetch(`/api/tenants/${tenantId}/agents`),
        fetch(`/api/tenants/${tenantId}/phone-numbers/port`),
      ]);
      const numbersBody = await numbersRes.json();
      const agentsBody = await agentsRes.json();
      if (!numbersRes.ok) throw new Error(numbersBody.error);
      if (!agentsRes.ok) throw new Error(agentsBody.error);
      setNumbers(numbersBody.phoneNumbers);
      setAgents(agentsBody.agents);
      if (portsRes.ok) {
        const portsBody = await portsRes.json();
        setPorts(portsBody.ports || []);
      }
      setSelectedId((prev) => prev || numbersBody.phoneNumbers[0]?.id || null);

      const versionEntries = await Promise.all(
        (agentsBody.agents as Agent[]).map(async (a: Agent) => {
          const res = await fetch(`/api/agents/${a.id}/versions`);
          const body = await res.json();
          return [a.id, res.ok ? body.versions : []] as const;
        })
      );
      setVersionsByAgent(Object.fromEntries(versionEntries));

      const environmentEntries = await Promise.all(
        (agentsBody.agents as Agent[]).map(async (a: Agent) => {
          const res = await fetch(`/api/agents/${a.id}/environments`);
          const body = await res.json();
          return [a.id, res.ok ? body.environments : []] as const;
        })
      );
      setEnvironmentsByAgent(Object.fromEntries(environmentEntries));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load phone numbers');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (isHydrated) load();
  }, [isHydrated, load]);

  const allVersions = Object.values(versionsByAgent).flat();
  const versionLabel = (v: AgentVersion) => {
    const agent = agents.find((a) => a.id === v.agent_id);
    return `${agent?.name || 'Agent'} · V${v.version_number} (${v.voice_engine})`;
  };
  const allEnvironments = Object.values(environmentsByAgent).flat();
  const environmentLabel = (env: AgentEnvironment) => {
    const agent = agents.find((a) => a.id === env.agent_id);
    const version = env.version_id ? allVersions.find((v) => v.id === env.version_id) : null;
    const envName = env.name === 'production' ? 'Production' : 'Staging';
    return `${agent?.name || 'Agent'} · ${envName}${version ? ` (currently V${version.version_number})` : ' (nothing promoted yet)'}`;
  };

  const handleAddNumber = async () => {
    if (!tenantId || !newNumber.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/phone-numbers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: newNumber.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setNumbers((prev) => [body.phoneNumber, ...prev]);
      setSelectedId(body.phoneNumber.id);
      setNewNumber('');
      setShowRegister(false);
      notifyPhoneNumbersChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add number');
    } finally {
      setIsSaving(false);
    }
  };

  const handleBuyNumber = async (acceptNumberAddOn = false) => {
    if (!tenantId) return;
    setIsBuying(true);
    setError(null);
    setBillingPrompt(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/phone-numbers/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ areaCode: buyAreaCode.trim() || undefined, ...(acceptNumberAddOn ? { acceptNumberAddOn: true } : {}) }),
      });
      const body = await res.json();
      if (res.status === 400 && body.code === 'number_addon_acceptance_required') {
        setAddonTerms(body.terms);
        setAddonAccepted(false);
        return;
      }
      if (res.status === 402) {
        setBillingPrompt({ message: body.error, action: body.action });
        return;
      }
      if (!res.ok) throw new Error(body.error);
      setNumbers((prev) => [body.phoneNumber, ...prev]);
      setSelectedId(body.phoneNumber.id);
      setBuyAreaCode('');
      setAddonTerms(null);
      setAddonAccepted(false);
      notifyPhoneNumbersChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to buy a number');
    } finally {
      setIsBuying(false);
    }
  };

  const handleRoute = async (direction: 'inbound' | 'outbound', selection: string) => {
    if (!selectedId) return;
    setIsSaving(true);
    setError(null);
    try {
      const isEnv = selection.startsWith(ENV_PREFIX);
      const res = await fetch(`/api/phone-numbers/${selectedId}/routing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEnv
            ? { direction, environmentId: selection.slice(ENV_PREFIX.length) }
            : { direction, agentVersionId: selection || null }
        ),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setNumbers((prev) => prev.map((n) => (n.id === selectedId ? body.phoneNumber : n)));
      if (isEnv || selection) track('phone_number_routed', { direction });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to route number');
    } finally {
      setIsSaving(false);
    }
  };

  const handleMakeCall = async () => {
    if (!selectedId || !callToNumber.trim()) return;
    setIsCalling(true);
    setCallError(null);
    setCallResult(null);
    try {
      const res = await fetch(`/api/phone-numbers/${selectedId}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toNumber: callToNumber.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to place call');
      setCallResult({ sid: body.call.sid, to: body.call.to });
    } catch (err) {
      setCallError(err instanceof Error ? err.message : 'Failed to place call');
    } finally {
      setIsCalling(false);
    }
  };

  const handleSubmitPort = async () => {
    if (!tenantId || !portForm.number.trim()) return;
    setIsSubmittingPort(true);
    setPortError(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/phone-numbers/port`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: portForm.number.trim(),
          losingCarrierName: portForm.losingCarrierName.trim() || undefined,
          customerType: portForm.customerType,
          authorizedRepresentative: portForm.authorizedRepresentative.trim(),
          authorizedRepresentativeEmail: portForm.authorizedRepresentativeEmail.trim(),
          accountTelephoneNumber: portForm.accountTelephoneNumber.trim(),
          accountNumber: portForm.accountNumber.trim() || undefined,
          billingAddress: {
            street: portForm.addressStreet.trim(),
            city: portForm.addressCity.trim(),
            state: portForm.addressState.trim(),
            zip: portForm.addressZip.trim(),
            country: portForm.addressCountry.trim(),
          },
          documentSids: portDocSid ? [portDocSid] : [],
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setPorts((prev) => [body.port, ...prev]);
      setShowPortForm(false);
      setPortForm({
        number: '',
        losingCarrierName: '',
        customerType: 'Business',
        authorizedRepresentative: '',
        authorizedRepresentativeEmail: '',
        accountTelephoneNumber: '',
        accountNumber: '',
        addressStreet: '',
        addressCity: '',
        addressState: '',
        addressZip: '',
        addressCountry: 'US',
      });
      setPortDocFile(null);
      setPortDocSid(null);
      setPortDocError(null);
    } catch (err) {
      setPortError(err instanceof Error ? err.message : 'Failed to submit port request');
    } finally {
      setIsSubmittingPort(false);
    }
  };

  const handleCheckPortStatus = async (portId: string) => {
    if (!tenantId) return;
    setCheckingStatusId(portId);
    setPortError(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/phone-numbers/port/${portId}/status`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setPorts((prev) => prev.map((p) => (p.id === portId ? body.port : p)));
    } catch (err) {
      setPortError(err instanceof Error ? err.message : 'Failed to check status');
    } finally {
      setCheckingStatusId(null);
    }
  };

  const selected = numbers.find((n) => n.id === selectedId) || null;
  const filteredNumbers = useMemo(
    () => numbers.filter((n) => n.number.includes(search.trim())),
    [numbers, search]
  );

  if (!isHydrated || isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-gray-200" />
        <div className="h-96 animate-pulse rounded-xl bg-gray-100" />
      </div>
    );
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-[#1a1d29]">Phone Numbers</h1>
        <p className="mt-0.5 text-[13px] text-gray-500">
          Each number routes inbound and outbound calls to a specific agent version, independently.
        </p>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-700">{error}</div>}

      {billingPrompt && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-800">
          <span>{billingPrompt.message}</span>
          <a
            href={billingPrompt.action === 'checkout' ? `/pricing?tenantId=${tenantId}` : '/dashboard/billing'}
            className="flex-none rounded-lg bg-amber-800 px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-amber-900"
          >
            {billingPrompt.action === 'checkout' ? 'Add billing' : 'Add payment method'}
          </a>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
        {/* Left: number list */}
        <div className="h-fit overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="space-y-2.5 border-b border-gray-100 p-3">
            {/* Buy: the area code only modifies the buy action, so the two
                live in one row. Register-your-own is a secondary path behind
                a link, and search only appears once the list is long enough
                to need it. */}
            <div className="flex gap-2">
              <input
                value={buyAreaCode}
                onChange={(e) => setBuyAreaCode(e.target.value.replace(/\D/g, ''))}
                placeholder="Area"
                title="Area code (optional)"
                aria-label="Area code (optional)"
                inputMode="numeric"
                maxLength={3}
                className="w-16 flex-none rounded-lg border border-gray-200 px-2.5 py-1.5 text-center font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                onKeyDown={(e) => e.key === 'Enter' && handleBuyNumber(addonTerms !== null && addonAccepted)}
              />
              <button
                onClick={() => handleBuyNumber(addonTerms !== null && addonAccepted)}
                disabled={isBuying || (addonTerms !== null && !addonAccepted)}
                className="min-w-0 flex-1 rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
              >
                {isBuying ? 'Buying…' : 'Buy a number'}
              </button>
            </div>
            {addonTerms && (
              <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[12.5px] leading-snug text-amber-900">
                <input
                  type="checkbox"
                  checked={addonAccepted}
                  onChange={(e) => setAddonAccepted(e.target.checked)}
                  className="mt-0.5 flex-none"
                />
                <span>
                  <span className="font-medium">Premium phone number (Twilio carrier).</span> {addonTerms} Or register a number you already own, at no charge.
                  <span className="mt-1 block">I understand and accept these charges.</span>
                </span>
              </label>
            )}
            {showRegister ? (
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={newNumber}
                  onChange={(e) => setNewNumber(e.target.value)}
                  placeholder="+1 your number"
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-1.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddNumber()}
                />
                <button
                  onClick={handleAddNumber}
                  disabled={isSaving || !newNumber.trim()}
                  className="flex-none rounded-lg bg-[#1a1d29] px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-[#2a2e3d] disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowRegister(true)}
                className="text-[12.5px] text-gray-500 underline-offset-2 transition hover:text-blue-600 hover:underline"
              >
                Already own a number? Add it
              </button>
            )}
            {numbers.length > 5 && (
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search phone numbers"
                  className="w-full rounded-lg border border-gray-200 py-1.5 pl-8 pr-3 text-[13px] placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
            )}
          </div>
          {filteredNumbers.length === 0 ? (
            <div className="p-6 text-center text-[13px] text-gray-400">No numbers yet.</div>
          ) : (
            filteredNumbers.map((n) => (
              <button
                key={n.id}
                onClick={() => setSelectedId(n.id)}
                className={`flex w-full items-center gap-2.5 border-b border-gray-50 px-4 py-3 text-left transition last:border-0 ${
                  n.id === selectedId ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-lg ${n.id === selectedId ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                  <PhoneIcon />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-mono text-[13px] text-[#1a1d29]">{n.number}</p>
                  <p className="mt-0.5 text-[11.5px] text-gray-400">
                    {n.inbound_agent_version_id ? 'Inbound routed' : 'No inbound agent'}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Right: detail */}
        {!selected ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white p-14 text-center text-[13.5px] text-gray-400">
            {numbers.length === 0 ? 'Add a phone number to get started.' : 'Select a number.'}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-gray-400">Number</p>
                  <p className="font-mono text-[17px] text-[#1a1d29]">{selected.number}</p>
                </div>
                <div className="text-right">
                  <button
                    onClick={() => {
                      setShowCallModal(true);
                      setCallResult(null);
                      setCallError(null);
                    }}
                    disabled={!selected.outbound_agent_version_id}
                    title={!selected.outbound_agent_version_id ? 'Set an Outbound Call Agent first' : undefined}
                    className="flex items-center gap-1.5 rounded-lg bg-[#1a1d29] px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-[#2a2e3d] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <PhoneIcon />
                    Make an outbound call
                  </button>
                  {!selected.outbound_agent_version_id && (
                    <p className="mt-1.5 text-[12px] text-amber-600">
                      Greyed out — set an Outbound Call Agent below first.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <RoutingSection
              title="Inbound Call Agent"
              description="Handles calls placed to this number. Route to an environment (staging/production) so promoting a new version takes effect here automatically, or to a specific version directly."
              value={selected.inbound_environment_id ? `${ENV_PREFIX}${selected.inbound_environment_id}` : selected.inbound_agent_version_id}
              versions={allVersions}
              versionLabel={versionLabel}
              environments={allEnvironments}
              environmentLabel={environmentLabel}
              onChange={(v) => handleRoute('inbound', v)}
              onCreateAgent={() => router.push('/dashboard/agents')}
              disabled={isSaving}
            />

            <RoutingSection
              title="Outbound Call Agent"
              description="Used when placing calls from this number. Leave unset to disable outbound."
              value={selected.outbound_environment_id ? `${ENV_PREFIX}${selected.outbound_environment_id}` : selected.outbound_agent_version_id}
              versions={allVersions}
              versionLabel={versionLabel}
              environments={allEnvironments}
              environmentLabel={environmentLabel}
              onChange={(v) => handleRoute('outbound', v)}
              onCreateAgent={() => router.push('/dashboard/agents')}
              disabled={isSaving}
              allowNone
            />
          </div>
        )}
      </div>

      {/* Port an existing number — submits a real Twilio port-in request
          (numbers.twilio.com Porting API) and tracks its status. */}
      <div className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[14px] font-semibold text-[#1a1d29]">Port an existing number</h2>
            <p className="mt-0.5 text-[12.5px] text-gray-500">
              Submits a real port-in request to Twilio for a number you own with another carrier. Twilio requires a supporting document (e.g. a utility bill) to complete the LOA — upload it below and wait for it to finish before submitting, or Twilio will reject the request.
            </p>
          </div>
          <button
            onClick={() => setShowPortForm((v) => !v)}
            className="flex-none rounded-lg border border-gray-200 px-3.5 py-2 text-[13px] font-medium text-[#1a1d29] transition hover:bg-gray-50"
          >
            {showPortForm ? 'Cancel' : '+ Port a number'}
          </button>
        </div>

        {portError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">{portError}</div>
        )}

        {showPortForm && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Number to port (E.164)">
              <input
                value={portForm.number}
                onChange={(e) => setPortForm((f) => ({ ...f, number: e.target.value }))}
                placeholder="+1..."
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 font-mono text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </Field>
            <Field label="Current carrier name">
              <input
                value={portForm.losingCarrierName}
                onChange={(e) => setPortForm((f) => ({ ...f, losingCarrierName: e.target.value }))}
                placeholder="e.g. Verizon"
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </Field>
            <Field label="Customer type">
              <select
                value={portForm.customerType}
                onChange={(e) => setPortForm((f) => ({ ...f, customerType: e.target.value }))}
                className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] text-[#1a1d29] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="Business">Business</option>
                <option value="Individual">Individual</option>
              </select>
            </Field>
            <Field label="Authorized representative">
              <input
                value={portForm.authorizedRepresentative}
                onChange={(e) => setPortForm((f) => ({ ...f, authorizedRepresentative: e.target.value }))}
                placeholder="Full name on the account"
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </Field>
            <Field label="Authorized representative email">
              <input
                value={portForm.authorizedRepresentativeEmail}
                onChange={(e) => setPortForm((f) => ({ ...f, authorizedRepresentativeEmail: e.target.value }))}
                placeholder="you@company.com"
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </Field>
            <Field label="Billing/account phone number">
              <input
                value={portForm.accountTelephoneNumber}
                onChange={(e) => setPortForm((f) => ({ ...f, accountTelephoneNumber: e.target.value }))}
                placeholder="+1..."
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 font-mono text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </Field>
            <Field label="Carrier account number (if known)">
              <input
                value={portForm.accountNumber}
                onChange={(e) => setPortForm((f) => ({ ...f, accountNumber: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </Field>
            <Field label="Billing address — street">
              <input
                value={portForm.addressStreet}
                onChange={(e) => setPortForm((f) => ({ ...f, addressStreet: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </Field>
            <Field label="Billing address — city">
              <input
                value={portForm.addressCity}
                onChange={(e) => setPortForm((f) => ({ ...f, addressCity: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </Field>
            <Field label="Billing address — state">
              <input
                value={portForm.addressState}
                onChange={(e) => setPortForm((f) => ({ ...f, addressState: e.target.value }))}
                placeholder="TX"
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </Field>
            <Field label="Billing address — ZIP">
              <input
                value={portForm.addressZip}
                onChange={(e) => setPortForm((f) => ({ ...f, addressZip: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </Field>
            <Field label="Billing address — country">
              <input
                value={portForm.addressCountry}
                onChange={(e) => setPortForm((f) => ({ ...f, addressCountry: e.target.value }))}
                placeholder="US"
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Utility bill / LOA document (required by Twilio)">
                <div className="flex flex-wrap items-center gap-2.5">
                  <input
                    type="file"
                    accept="application/pdf,image/png,image/jpeg"
                    onChange={(e) => {
                      setPortDocFile(e.target.files?.[0] ?? null);
                      setPortDocSid(null);
                      setPortDocError(null);
                    }}
                    className="text-[13px] text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-[12.5px] file:font-medium file:text-[#1a1d29] hover:file:bg-gray-200"
                  />
                  <button
                    type="button"
                    onClick={handleUploadPortDocument}
                    disabled={!portDocFile || isUploadingPortDoc || !!portDocSid}
                    className="flex-none rounded-lg border border-gray-200 px-3.5 py-1.5 text-[12.5px] font-medium text-[#1a1d29] transition hover:bg-gray-50 disabled:opacity-40"
                  >
                    {isUploadingPortDoc ? 'Uploading…' : portDocSid ? 'Uploaded ✓' : 'Upload document'}
                  </button>
                </div>
                {portDocSid && (
                  <p className="mt-1.5 text-[12px] text-green-700">
                    Uploaded to Twilio — document sid <span className="font-mono">{portDocSid}</span>
                  </p>
                )}
                {portDocError && <p className="mt-1.5 text-[12px] text-red-600">{portDocError}</p>}
                {!portDocSid && !portDocError && (
                  <p className="mt-1.5 text-[12px] text-gray-400">
                    Submission will be rejected by Twilio without a successfully uploaded document.
                  </p>
                )}
              </Field>
            </div>
            <div className="sm:col-span-2">
              <button
                onClick={handleSubmitPort}
                disabled={
                  isSubmittingPort ||
                  !portForm.number.trim() ||
                  !portForm.authorizedRepresentative.trim() ||
                  !portForm.authorizedRepresentativeEmail.trim() ||
                  !portForm.accountTelephoneNumber.trim() ||
                  !portForm.addressStreet.trim() ||
                  !portForm.addressCity.trim() ||
                  !portForm.addressState.trim() ||
                  !portForm.addressZip.trim() ||
                  !portForm.addressCountry.trim() ||
                  !portDocSid
                }
                title={!portDocSid ? 'Upload the utility bill / LOA document first' : undefined}
                className="rounded-lg bg-[#1a1d29] px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-[#2a2e3d] disabled:opacity-40"
              >
                {isSubmittingPort ? 'Submitting…' : 'Submit port request'}
              </button>
            </div>
          </div>
        )}

        {ports.length > 0 && (
          <div className="mt-5 overflow-hidden rounded-lg border border-gray-100">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-gray-50 text-[11px] font-medium uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="px-3.5 py-2">Number</th>
                  <th className="px-3.5 py-2">Status</th>
                  <th className="px-3.5 py-2">Twilio request ID</th>
                  <th className="px-3.5 py-2" />
                </tr>
              </thead>
              <tbody>
                {ports.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="px-3.5 py-2.5 font-mono">{p.number}</td>
                    <td className="px-3.5 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${
                          p.status === 'Completed'
                            ? 'bg-green-100 text-green-700'
                            : p.status === 'submit_failed' || p.status === 'Canceled' || p.status === 'Expired'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {p.status}
                      </span>
                      {p.last_submit_error && (
                        <p className="mt-1 max-w-[280px] text-[11.5px] text-red-600">{p.last_submit_error}</p>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-[12px] text-gray-500">
                      {p.twilio_port_in_request_sid || '—'}
                    </td>
                    <td className="px-3.5 py-2.5 text-right">
                      <button
                        onClick={() => handleCheckPortStatus(p.id)}
                        disabled={checkingStatusId === p.id || !p.twilio_port_in_request_sid}
                        className="rounded-lg border border-gray-200 px-2.5 py-1 text-[12px] font-medium text-[#1a1d29] transition hover:bg-gray-50 disabled:opacity-40"
                      >
                        {checkingStatusId === p.id ? 'Checking…' : 'Check status'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCallModal && selected && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={() => setShowCallModal(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold text-[#1a1d29]">Make an outbound call</h2>
              <button type="button" onClick={() => setShowCallModal(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <p className="mb-4 text-[13px] text-gray-500">
              Places a real call from <span className="font-mono text-[#1a1d29]">{selected.number}</span> using its Outbound Call Agent — the exact flow a real outbound call from this number would run.
            </p>
            <label className="mb-1.5 block text-[12.5px] font-medium text-[#1a1d29]">Destination number</label>
            <input
              value={callToNumber}
              onChange={(e) => {
                setCallToNumber(e.target.value);
                // Editing the destination is what "trying again" means here —
                // clears the placed-call state so the button re-enables.
                setCallResult(null);
              }}
              placeholder="+1..."
              className="mb-4 w-full rounded-lg border border-gray-200 px-3.5 py-2.5 font-mono text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              onKeyDown={(e) => e.key === 'Enter' && !isCalling && !callResult && handleMakeCall()}
            />
            {callError && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">{callError}</div>
            )}
            {callResult && (
              <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3.5 py-2.5 text-[13px] text-green-700">
                Call placed to {callResult.to}. It should be ringing now.
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCallModal(false)}
                className="rounded-lg px-4 py-2 text-[13.5px] font-medium text-gray-600 hover:bg-gray-50"
              >
                Close
              </button>
              <button
                onClick={handleMakeCall}
                disabled={isCalling || !!callResult || !callToNumber.trim()}
                title={callResult ? 'Already placed — edit the number to call again' : undefined}
                className="rounded-lg bg-[#1a1d29] px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-[#2a2e3d] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isCalling ? 'Calling…' : callResult ? 'Called' : 'Call'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const CREATE_AGENT_VALUE = '__create_agent__';

function RoutingSection({
  title,
  description,
  value,
  versions,
  versionLabel,
  environments,
  environmentLabel,
  onChange,
  onCreateAgent,
  disabled,
  allowNone,
}: {
  title: string;
  description: string;
  value: string | null;
  versions: AgentVersion[];
  versionLabel: (v: AgentVersion) => string;
  environments: AgentEnvironment[];
  environmentLabel: (env: AgentEnvironment) => string;
  onChange: (selection: string) => void;
  onCreateAgent: () => void;
  disabled: boolean;
  allowNone?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-[14px] font-semibold text-[#1a1d29]">{title}</h2>
      <p className="mt-0.5 text-[12.5px] text-gray-500">{description}</p>
      <div className="relative mt-3">
        <select
          value={value || ''}
          onChange={(e) => {
            if (e.target.value === CREATE_AGENT_VALUE) {
              onCreateAgent();
              return;
            }
            onChange(e.target.value);
          }}
          disabled={disabled}
          className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] text-[#1a1d29] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
        >
          <option value="">{allowNone ? 'None (disable outbound)' : 'Select a version…'}</option>
          {environments.length > 0 && (
            <optgroup label="Environments">
              {environments.map((env) => (
                <option key={env.id} value={`${ENV_PREFIX}${env.id}`}>{environmentLabel(env)}</option>
              ))}
            </optgroup>
          )}
          <optgroup label="Specific versions">
            {versions.map((v) => (
              <option key={v.id} value={v.id}>{versionLabel(v)}</option>
            ))}
          </optgroup>
          <option value={CREATE_AGENT_VALUE}>+ Create an agent…</option>
        </select>
        <ChevronIcon className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[12.5px] font-medium text-[#1a1d29]">{label}</label>
      {children}
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 4h3l1.5 4-2 1.3a11 11 0 0 0 5.7 5.7l1.3-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 5 5.6 1.5 1.5 0 0 1 6.5 4Z" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

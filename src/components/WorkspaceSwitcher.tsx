'use client';

import { useEffect, useRef, useState } from 'react';

// The sidebar's workspace row used to be static display only — clicking it
// did nothing, and there was no way to see or switch between a user's other
// tenants, or create a new one, even though the backend already supports a
// user owning several (calldesk_tenants.user_id is a plain column, not
// unique). This wires it up to match Retell's own workspace switcher:
// clicking opens a search + list popover with a checkmark on the active
// workspace and an "Add another workspace" row that opens the create modal.

interface WorkspaceOption {
  id: string;
  name: string;
}

interface WorkspaceSwitcherProps {
  activeTenantId: string | null;
  displayName: string;
  onSwitch: (tenant: WorkspaceOption) => void;
  onCreated: (tenant: WorkspaceOption) => void;
}

export default function WorkspaceSwitcher({ activeTenantId, displayName, onSwitch, onCreated }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [tenants, setTenants] = useState<WorkspaceOption[] | null>(null);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Refetch every time it opens rather than caching — a workspace created
    // elsewhere (or in the modal below) should show up without a reload.
    let cancelled = false;
    fetch('/api/tenants')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        setTenants((body?.tenants || []).map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })));
      })
      .catch(() => {
        if (!cancelled) setTenants([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const filtered = (tenants || []).filter((t) => t.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div ref={containerRef} className="relative mx-3 mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-gray-50"
      >
        <div className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white">
          {displayName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] leading-tight text-gray-400">Workspace</p>
          <p className="truncate text-[13px] font-medium leading-tight text-[#1a1d29]">{displayName}</p>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="flex-none text-gray-400">
          <path d="m7 10 5 5 5-5" />
          <path d="m7 14 5-5 5 5" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-[#1a1d29] outline-none focus:border-blue-400"
          />
          <div className="max-h-64 overflow-y-auto">
            {tenants === null ? (
              <p className="px-2 py-3 text-[13px] text-gray-400">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-3 text-[13px] text-gray-400">No workspaces found</p>
            ) : (
              filtered.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    onSwitch(t);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-gray-50"
                >
                  <div className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white">
                    {t.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[#1a1d29]">{t.name}</span>
                  {t.id === activeTenantId && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-blue-600">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
          <div className="mt-1 border-t border-gray-100 pt-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setShowCreate(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13.5px] font-medium text-gray-600 hover:bg-gray-50 hover:text-[#1a1d29]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add another workspace
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateWorkspaceModal
          onClose={() => setShowCreate(false)}
          onCreated={(tenant) => {
            setShowCreate(false);
            onCreated(tenant);
          }}
        />
      )}
    </div>
  );
}

const WORKSPACE_TYPES = [
  { id: 'business', label: 'Business', description: 'Answer our phones', icon: IconBriefcase },
  { id: 'agency', label: 'Agency', description: 'Building for clients', icon: IconUsers },
  { id: 'developer', label: 'Developer', description: 'Embedding Retell', icon: IconTerminal },
  { id: 'other', label: 'Other', description: 'None of the above', icon: IconDots },
] as const;

function CreateWorkspaceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (tenant: WorkspaceOption) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof WORKSPACE_TYPES)[number]['id'] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), voiceEngine: 'poc', workspaceType: type }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to create workspace');
      onCreated({ id: body.tenant.id, name: body.tenant.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[19px] font-semibold text-[#1a1d29]">Create your workspace</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <label className="mb-1.5 block text-[13.5px] font-medium text-[#1a1d29]">Workspace name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Company"
          className="mb-5 w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[14px] text-[#1a1d29] outline-none focus:border-blue-400"
        />

        <p className="mb-1 text-[13.5px] font-medium text-[#1a1d29]">What best describes you?</p>
        <p className="mb-3 text-[12.5px] text-gray-400">We&apos;ll customize your workspace accordingly.</p>
        <div className="mb-5 grid grid-cols-2 gap-3">
          {WORKSPACE_TYPES.map((opt) => {
            const Icon = opt.icon;
            const active = type === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setType(opt.id)}
                className={`rounded-xl border px-4 py-3.5 text-left transition ${
                  active ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <Icon className={active ? 'text-blue-600' : 'text-blue-500'} />
                <p className="mt-2.5 text-[14px] font-semibold text-[#1a1d29]">{opt.label}</p>
                <p className="text-[12.5px] text-gray-400">{opt.description}</p>
              </button>
            );
          })}
        </div>

        {error && <p className="mb-3 text-[13px] text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-[13.5px] font-medium text-[#1a1d29] hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-lg bg-blue-600 px-4 py-2 text-[13.5px] font-medium text-white transition disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 hover:bg-blue-700 disabled:hover:bg-gray-200"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function iconProps() {
  return { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
}
function IconBriefcase({ className }: { className?: string }) {
  return <svg {...iconProps()} className={className}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;
}
function IconUsers({ className }: { className?: string }) {
  return <svg {...iconProps()} className={className}><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><circle cx="17" cy="9" r="2.5" /><path d="M15 20a5 5 0 0 1 6.5-4.8" /></svg>;
}
function IconTerminal({ className }: { className?: string }) {
  return <svg {...iconProps()} className={className}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3" /><path d="M13 15h4" /></svg>;
}
function IconDots({ className }: { className?: string }) {
  return <svg {...iconProps()} className={className}><circle cx="12" cy="12" r="9" /><circle cx="8.5" cy="12" r="0.8" fill="currentColor" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /><circle cx="15.5" cy="12" r="0.8" fill="currentColor" /></svg>;
}

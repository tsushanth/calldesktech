'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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

// Modals render into document.body: inside the sidebar they were clipped to its 256px column (an ancestor with a
// transform or overflow traps `position: fixed`), which is what made the create dialog look cramped.
function Overlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  );
}

export default function WorkspaceSwitcher({ activeTenantId, displayName, onSwitch, onCreated }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [renaming, setRenaming] = useState<WorkspaceOption | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceOption | null>(null);
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
                <div key={t.id} className="group flex items-center gap-1 rounded-lg hover:bg-gray-50">
                  <button
                    type="button"
                    onClick={() => {
                      onSwitch(t);
                      setOpen(false);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left"
                  >
                    <div className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white">
                      {t.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[#1a1d29]">{t.name}</span>
                    {t.id === activeTenantId && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-blue-600" aria-label="Current workspace">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setOpen(false); setRenaming(t); }}
                    className="flex-none rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#1a1d29]"
                    aria-label={`Rename ${t.name}`}
                    title="Rename"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setOpen(false); setDeleting(t); }}
                    className="mr-1 flex-none rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    aria-label={`Delete ${t.name}`}
                    title="Delete"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
                  </button>
                </div>
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

      {renaming && (
        <RenameWorkspaceModal
          workspace={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={(updated) => {
            setRenaming(null);
            setTenants((prev) => (prev ? prev.map((t) => (t.id === updated.id ? updated : t)) : prev));
            if (updated.id === activeTenantId) onSwitch(updated);
          }}
        />
      )}

      {deleting && (
        <DeleteWorkspaceModal
          workspace={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(id) => {
            setDeleting(null);
            const remaining = (tenants || []).filter((t) => t.id !== id);
            setTenants(remaining);
            if (id === activeTenantId && remaining.length > 0) onSwitch(remaining[0]);
          }}
        />
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

  const [attempted, setAttempted] = useState(false);
  const nameEmpty = name.trim().length === 0;
  const canSave = !nameEmpty && !saving;
  // The button stays grey until the name is filled in (the use-case choice is optional); say so instead of leaving it a mystery.
  const missing = nameEmpty ? 'Enter a workspace name to continue' : null;
  const showNameError = nameEmpty && (attempted || type !== null);

  const handleSave = async () => {
    setAttempted(true);
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
    <Overlay onClose={onClose}>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-[19px] font-semibold text-[#1a1d29]">Create a workspace</h2>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      <label htmlFor="ws-name" className="mb-1.5 block text-[13.5px] font-medium text-[#1a1d29]">
        Workspace name <span className="text-red-500" aria-hidden="true">*</span>
      </label>
      <input
        id="ws-name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
        placeholder="Acme Company"
        aria-invalid={showNameError}
        className={`w-full rounded-lg border px-3.5 py-2.5 text-[14px] text-[#1a1d29] outline-none ${showNameError ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-blue-400'}`}
      />
      <p className={`mb-5 mt-1 min-h-[18px] text-[12.5px] ${showNameError ? 'text-red-600' : 'text-transparent'}`}>
        Give your workspace a name, for example your business name.
      </p>

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

      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-[12.5px] text-gray-500">{missing}</p>
        <div className="flex flex-none gap-2">
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
            aria-disabled={!canSave}
            className={`rounded-lg px-4 py-2 text-[13.5px] font-medium transition ${canSave ? 'bg-blue-600 text-white hover:bg-blue-700' : 'cursor-not-allowed bg-gray-200 text-gray-400'}`}
          >
            {saving ? 'Creating...' : 'Create workspace'}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function RenameWorkspaceModal({ workspace, onClose, onRenamed }: { workspace: WorkspaceOption; onClose: () => void; onRenamed: (w: WorkspaceOption) => void }) {
  const [name, setName] = useState(workspace.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed !== workspace.name && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${workspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not rename the workspace');
      onRenamed({ id: workspace.id, name: body.tenant?.name ?? trimmed });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename the workspace');
      setSaving(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <h2 className="mb-4 text-[19px] font-semibold text-[#1a1d29]">Rename workspace</h2>
      <label htmlFor="ws-rename" className="mb-1.5 block text-[13.5px] font-medium text-[#1a1d29]">Workspace name</label>
      <input
        id="ws-rename"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
        maxLength={200}
        className="mb-4 w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[14px] text-[#1a1d29] outline-none focus:border-blue-400"
      />
      {error && <p className="mb-3 text-[13px] text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-[13.5px] font-medium text-[#1a1d29] hover:bg-gray-50">Cancel</button>
        <button
          type="button"
          onClick={save}
          aria-disabled={!canSave}
          className={`rounded-lg px-4 py-2 text-[13.5px] font-medium transition ${canSave ? 'bg-blue-600 text-white hover:bg-blue-700' : 'cursor-not-allowed bg-gray-200 text-gray-400'}`}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </Overlay>
  );
}

function DeleteWorkspaceModal({ workspace, onClose, onDeleted }: { workspace: WorkspaceOption; onClose: () => void; onDeleted: (id: string) => void }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${workspace.id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not delete the workspace');
      onDeleted(workspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the workspace');
      setDeleting(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <h2 className="mb-2 text-[19px] font-semibold text-[#1a1d29]">Delete &ldquo;{workspace.name}&rdquo;?</h2>
      <p className="mb-2 text-[14px] text-gray-600">
        Are you sure? This permanently deletes the workspace and everything in it: its agents, flows, call logs, contacts, knowledge bases and API keys.
      </p>
      <p className="mb-4 text-[14px] font-medium text-red-600">This cannot be undone.</p>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" autoFocus onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-[13.5px] font-medium text-[#1a1d29] hover:bg-gray-50">Cancel</button>
        <button
          type="button"
          onClick={confirm}
          disabled={deleting}
          className="rounded-lg bg-red-600 px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
        >
          {deleting ? 'Deleting...' : 'Delete workspace'}
        </button>
      </div>
    </Overlay>
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

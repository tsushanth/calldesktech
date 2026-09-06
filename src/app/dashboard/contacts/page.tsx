'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useOnboarding } from '@/context/OnboardingContext';
import { formatPhoneDisplay, formatRelativeTime } from '@/lib/utils';

type Contact = {
  caller_phone: string;
  first_seen: string;
  last_contact: string;
  total_calls: number;
  do_not_call: boolean;
};

export default function ContactsPage() {
  const { tenantId, isHydrated } = useOnboarding();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const loadContacts = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/contacts`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setContacts(body.contacts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contacts');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (isHydrated) loadContacts();
  }, [isHydrated, loadContacts]);

  const toggleDnc = async (contact: Contact) => {
    if (!tenantId) return;
    const next = !contact.do_not_call;
    setSaving(contact.caller_phone);
    setError(null);
    // Optimistic: flip immediately, roll back on failure.
    setContacts((prev) =>
      prev.map((c) => (c.caller_phone === contact.caller_phone ? { ...c, do_not_call: next } : c))
    );
    try {
      const res = await fetch(`/api/tenants/${tenantId}/contacts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caller_phone: contact.caller_phone, do_not_call: next }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update contact');
      setContacts((prev) =>
        prev.map((c) =>
          c.caller_phone === contact.caller_phone ? { ...c, do_not_call: contact.do_not_call } : c
        )
      );
    } finally {
      setSaving(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.caller_phone.toLowerCase().includes(q) ||
        formatPhoneDisplay(c.caller_phone).toLowerCase().includes(q)
    );
  }, [contacts, search]);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold text-[#1a1d29]">Contacts</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Every number that&apos;s ever called in, with their call history. Mark a number Do Not Call to flag it.
          </p>
        </div>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-56 rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-[13.5px] text-[#1a1d29] placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-700">{error}</div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {isLoading ? (
          <div className="p-10 text-center text-[13.5px] text-gray-400">Loading contacts…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-[13.5px] text-gray-400">
            {contacts.length === 0 ? 'No contacts yet — numbers appear here once they call in.' : 'No contacts match your search.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60 text-[11.5px] uppercase tracking-wide text-gray-400">
                  <th className="px-5 py-3 font-medium">Phone Number</th>
                  <th className="px-5 py-3 font-medium">First Seen</th>
                  <th className="px-5 py-3 font-medium">Last Contact</th>
                  <th className="px-5 py-3 font-medium">Total Calls</th>
                  <th className="px-5 py-3 font-medium">Do Not Call</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((contact) => (
                  <tr key={contact.caller_phone} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/70">
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-2.5 font-medium text-[#1a1d29]">
                        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-gray-100 text-gray-400">
                          <PhoneIcon />
                        </span>
                        {formatPhoneDisplay(contact.caller_phone)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{formatRelativeTime(contact.first_seen)}</td>
                    <td className="px-5 py-3.5 text-gray-500">{formatRelativeTime(contact.last_contact)}</td>
                    <td className="px-5 py-3.5 font-mono text-gray-600">{contact.total_calls}</td>
                    <td className="px-5 py-3.5">
                      <button
                        role="switch"
                        aria-checked={contact.do_not_call}
                        aria-label={`Toggle Do Not Call for ${formatPhoneDisplay(contact.caller_phone)}`}
                        disabled={saving === contact.caller_phone}
                        onClick={() => toggleDnc(contact)}
                        className={`relative inline-flex h-5 w-9 flex-none items-center rounded-full transition disabled:opacity-50 ${
                          contact.do_not_call ? 'bg-red-500' : 'bg-gray-200'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                            contact.do_not_call ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 4h3l1.5 4-2 1.3a11 11 0 0 0 5.7 5.7l1.3-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 5 5.6 1.5 1.5 0 0 1 6.5 4Z" />
    </svg>
  );
}

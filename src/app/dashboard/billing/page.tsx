'use client';

import { useState, useEffect } from 'react';
import { useOnboarding } from '@/context/OnboardingContext';

type UsageBreakdown = {
  calls: number;
  minutes: number;
  bookings: number;
  transfers: number;
  messages: number;
};

type BillingData = {
  hasSubscription: boolean;
  plan: {
    name: string;
    status: string;
    currentPeriodStart: number | null;
    currentPeriodEnd: number | null;
  } | null;
  usage: UsageBreakdown;
  upcomingInvoice: {
    amountDue: number;
    currency: string;
    periodEnd: number | null;
    lineItems: Array<{ description: string; amount: number }>;
  } | null;
  paymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
  invoices: Array<{
    id: string;
    number: string | null;
    created: number;
    amountPaid: number;
    currency: string;
    status: string | null;
    hostedInvoiceUrl: string | null;
    invoicePdf: string | null;
  }>;
};

function formatCurrency(amountInCents: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amountInCents / 100);
}

function formatDate(unixSeconds: number | null) {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const STATUS_STYLES: Record<string, string> = {
  active: 'border-green-200 bg-green-50 text-green-700',
  trialing: 'border-blue-200 bg-blue-50 text-blue-700',
  past_due: 'border-amber-200 bg-amber-50 text-amber-700',
  canceled: 'border-red-200 bg-red-50 text-red-700',
  unpaid: 'border-red-200 bg-red-50 text-red-700',
  paid: 'border-green-200 bg-green-50 text-green-700',
  open: 'border-amber-200 bg-amber-50 text-amber-700',
  draft: 'border-gray-200 bg-gray-50 text-gray-600',
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || 'border-gray-200 bg-gray-50 text-gray-600';
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium capitalize ${style}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export default function BillingPage() {
  const { tenantId, isHydrated } = useOnboarding();
  const [data, setData] = useState<BillingData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  useEffect(() => {
    async function loadBilling() {
      if (!tenantId || !isHydrated) return;
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/tenants/${tenantId}/billing`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Failed to load billing');
        setData(body);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load billing');
      } finally {
        setIsLoading(false);
      }
    }
    loadBilling();
  }, [tenantId, isHydrated]);

  const handleOpenPortal = async () => {
    if (!tenantId) return;
    setIsOpeningPortal(true);
    setPortalError(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/billing/portal`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to open portal');
      window.location.href = body.url;
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : 'Failed to open the billing portal');
      setIsOpeningPortal(false);
    }
  };

  if (isLoading) {
    return <div className="p-10 text-center text-[13.5px] text-gray-400">Loading billing…</div>;
  }

  if (error) {
    return (
      <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-700">
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[22px] font-semibold text-[#1a1d29]">Billing</h1>
        {data.hasSubscription && (
          <button
            onClick={handleOpenPortal}
            disabled={isOpeningPortal}
            className="rounded-lg bg-[#1a1d29] px-5 py-2 text-[13.5px] font-medium text-white transition hover:bg-[#2a2e3d] disabled:opacity-50"
          >
            {isOpeningPortal ? 'Opening…' : 'Manage billing'}
          </button>
        )}
      </div>

      {portalError && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-700">
          {portalError}
        </div>
      )}

      {!data.hasSubscription ? (
        <BillingSection title="No active subscription" icon={<IconCard />}>
          <p className="text-[13.5px] text-gray-500">
            This account doesn&apos;t have an active subscription yet. Once you subscribe, your
            current plan, usage, and invoices will appear here.
          </p>
          <a
            href="/pricing"
            className="mt-4 inline-block rounded-lg bg-blue-600 px-5 py-2 text-[13px] font-medium text-white transition hover:bg-blue-700"
          >
            View pricing
          </a>
        </BillingSection>
      ) : (
        <div className="space-y-5">
          {/* Current Plan */}
          <BillingSection title="Current Plan" icon={<IconCard />}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <p className="text-[16px] font-semibold text-[#1a1d29]">{data.plan?.name}</p>
                  {data.plan && <StatusBadge status={data.plan.status} />}
                </div>
                <p className="mt-1 text-[13px] text-gray-500">
                  Pay-as-you-go — you&apos;re only billed for call minutes and completed actions.
                </p>
              </div>
              {data.plan?.currentPeriodEnd && (
                <div className="text-right">
                  <p className="text-[12px] text-gray-400">Current period</p>
                  <p className="text-[13px] font-medium text-[#1a1d29]">
                    {formatDate(data.plan.currentPeriodStart)} – {formatDate(data.plan.currentPeriodEnd)}
                  </p>
                </div>
              )}
            </div>
          </BillingSection>

          {/* Usage This Period */}
          <BillingSection title="Usage This Period" icon={<IconChart />}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <UsageStat label="Calls" value={data.usage.calls} />
              <UsageStat label="Voice minutes" value={data.usage.minutes} />
              <UsageStat label="Bookings" value={data.usage.bookings} />
              <UsageStat label="Transfers" value={data.usage.transfers} />
              <UsageStat label="Messages" value={data.usage.messages} />
            </div>
          </BillingSection>

          {/* Upcoming Invoice */}
          <BillingSection title="Upcoming Invoice" icon={<IconReceipt />}>
            {data.upcomingInvoice ? (
              <>
                <div className="mb-4 flex items-baseline justify-between">
                  <p className="text-[13px] text-gray-500">
                    Estimated total{data.upcomingInvoice.periodEnd ? ` · due ${formatDate(data.upcomingInvoice.periodEnd)}` : ''}
                  </p>
                  <p className="text-[20px] font-semibold text-[#1a1d29]">
                    {formatCurrency(data.upcomingInvoice.amountDue, data.upcomingInvoice.currency)}
                  </p>
                </div>
                {data.upcomingInvoice.lineItems.length > 0 && (
                  <div className="divide-y divide-gray-100 border-t border-gray-100">
                    {data.upcomingInvoice.lineItems.map((line, i) => (
                      <div key={i} className="flex items-center justify-between py-2.5">
                        <span className="text-[13px] text-gray-600">{line.description}</span>
                        <span className="text-[13px] font-medium text-[#1a1d29]">
                          {formatCurrency(line.amount, data.upcomingInvoice!.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-[12px] text-gray-400">
                  This is an estimate and may change as you use more before the period ends.
                </p>
              </>
            ) : (
              <p className="text-[13.5px] text-gray-500">No upcoming invoice to estimate yet.</p>
            )}
          </BillingSection>

          {/* Payment Method */}
          <BillingSection title="Payment Method" icon={<IconCard />}>
            {data.paymentMethod ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-12 items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase text-gray-500">
                    {data.paymentMethod.brand}
                  </div>
                  <div>
                    <p className="text-[13.5px] font-medium text-[#1a1d29]">
                      •••• {data.paymentMethod.last4}
                    </p>
                    <p className="text-[12px] text-gray-400">
                      Expires {String(data.paymentMethod.expMonth).padStart(2, '0')}/{data.paymentMethod.expYear}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleOpenPortal}
                  disabled={isOpeningPortal}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-[13px] font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                >
                  Update
                </button>
              </div>
            ) : (
              <p className="text-[13.5px] text-gray-500">No payment method on file.</p>
            )}
          </BillingSection>

          {/* Invoice History */}
          <BillingSection title="Invoice History" icon={<IconReceipt />}>
            {data.invoices.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {data.invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="text-[13px] font-medium text-[#1a1d29]">
                          {inv.number || 'Invoice'}
                        </p>
                        <p className="text-[12px] text-gray-400">{formatDate(inv.created)}</p>
                      </div>
                      {inv.status && <StatusBadge status={inv.status} />}
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-[13px] font-medium text-[#1a1d29]">
                        {formatCurrency(inv.amountPaid, inv.currency)}
                      </span>
                      {inv.hostedInvoiceUrl && (
                        <a
                          href={inv.hostedInvoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] font-medium text-blue-600 hover:text-blue-700"
                        >
                          View
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13.5px] text-gray-500">No invoices yet.</p>
            )}
          </BillingSection>
        </div>
      )}
    </>
  );
}

function UsageStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3.5">
      <p className="text-[20px] font-semibold text-[#1a1d29]">{value.toLocaleString()}</p>
      <p className="mt-0.5 text-[12px] text-gray-500">{label}</p>
    </div>
  );
}

function BillingSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-4 flex items-center gap-2 text-[14px] font-semibold text-[#1a1d29]">
        <span className="text-gray-400">{icon}</span>
        <span>{title}</span>
      </h2>
      {children}
    </div>
  );
}

function IconCard() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19" /></svg>; }
function IconChart() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>; }
function IconReceipt() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3v18l2-1.2L9 21l2-1.2L13 21l2-1.2L17 21l2-1.2V3l-2 1.2L15 3l-2 1.2L11 3 9 4.2 7 3 5 4.2Z" /><path d="M9 8h6M9 12h6" /></svg>; }

'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, type CallLog } from '@/lib/api';
import { formatPhoneDisplay, formatDuration, formatRelativeTime } from '@/lib/utils';

interface TranscriptEntry {
  role: string;
  content: string;
}

export default function CallDetailPage() {
  const params = useParams();
  const router = useRouter();
  const callId = params.id as string;

  const [call, setCall] = useState<CallLog | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadCall() {
      if (!callId) return;

      setIsLoading(true);
      try {
        const data = await api.getCallLog(callId);
        setCall(data);
      } catch (err) {
        console.error('Failed to load call:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadCall();
  }, [callId]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-[13.5px] text-gray-400">Loading call details…</div>
      </div>
    );
  }

  if (!call) {
    return (
      <div className="py-14 text-center">
        <p className="mb-3 text-[13.5px] text-gray-400">Call not found</p>
        <Link href="/dashboard/calls" className="font-medium text-blue-600 hover:text-blue-700">
          Back to Call Logs
        </Link>
      </div>
    );
  }

  const transcript = (call.transcript as TranscriptEntry[] | null) || [];

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => router.back()} className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 19 8 12l7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-[20px] font-semibold text-[#1a1d29]">{formatPhoneDisplay(call.caller_phone)}</h1>
          <p className="text-[12.5px] text-gray-400">{formatRelativeTime(call.created_at)}</p>
        </div>
        <OutcomeBadge outcome={call.outcome} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Call Info */}
        <div className="col-span-1 space-y-5">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3.5 text-[14px] font-semibold text-[#1a1d29]">Call Information</h2>
            <div className="space-y-3">
              <InfoRow label="Caller" value={formatPhoneDisplay(call.caller_phone)} />
              <InfoRow label="Duration" value={formatDuration(call.duration_seconds)} />
              <InfoRow label="Outcome" value={call.outcome} />
              <InfoRow label="Date" value={new Date(call.created_at).toLocaleDateString()} />
              <InfoRow label="Time" value={new Date(call.created_at).toLocaleTimeString()} />
            </div>
          </div>

          {call.extracted_data && (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="mb-3.5 text-[14px] font-semibold text-[#1a1d29]">Extracted Information</h2>
              <div className="space-y-2.5">
                {Object.entries(call.extracted_data as Record<string, string>).map(([key, value]) => (
                  <div key={key}>
                    <p className="text-[12px] capitalize text-gray-400">{key.replace(/_/g, ' ')}</p>
                    <p className="text-[13.5px] font-medium text-[#1a1d29]">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Transcript */}
        <div className="col-span-1 lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3.5 text-[14px] font-semibold text-[#1a1d29]">Transcript</h2>
            {transcript.length === 0 ? (
              <p className="py-8 text-center text-[13.5px] text-gray-400">No transcript available</p>
            ) : (
              <div className="max-h-[600px] space-y-3 overflow-y-auto">
                {transcript.map((entry, index) => (
                  <div key={index} className={`flex ${entry.role === 'agent' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[80%] rounded-lg p-3.5 ${entry.role === 'agent' ? 'bg-blue-50 text-blue-900' : 'bg-gray-100 text-[#1a1d29]'}`}>
                      <p className="mb-1 text-[11px] capitalize text-gray-400">{entry.role === 'agent' ? 'AI Receptionist' : 'Caller'}</p>
                      <p className="text-[13.5px]">{entry.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[13.5px]">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium capitalize text-[#1a1d29]">{value}</span>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const colors: Record<string, string> = {
    booked: 'bg-green-50 text-green-700',
    answered: 'bg-blue-50 text-blue-700',
    transferred: 'bg-amber-50 text-amber-700',
    voicemail: 'bg-gray-100 text-gray-600',
    abandoned: 'bg-red-50 text-red-700',
  };

  return <span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${colors[outcome] || colors.answered}`}>{outcome}</span>;
}

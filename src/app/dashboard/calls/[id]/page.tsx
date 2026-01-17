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
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading call details...</div>
      </div>
    );
  }

  if (!call) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400 mb-4">Call not found</p>
        <Link href="/dashboard/calls" className="text-blue-400 hover:text-blue-300">
          Back to Call Logs
        </Link>
      </div>
    );
  }

  const transcript = (call.transcript as TranscriptEntry[] | null) || [];

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => router.back()}
          className="p-2 hover:bg-gray-700 rounded-lg transition"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold">{formatPhoneDisplay(call.caller_phone)}</h1>
          <p className="text-gray-400">{formatRelativeTime(call.created_at)}</p>
        </div>
        <OutcomeBadge outcome={call.outcome} />
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Call Info */}
        <div className="col-span-1 space-y-6">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
            <h2 className="font-semibold mb-4">Call Information</h2>
            <div className="space-y-4">
              <InfoRow label="Caller" value={formatPhoneDisplay(call.caller_phone)} />
              <InfoRow label="Duration" value={formatDuration(call.duration_seconds)} />
              <InfoRow label="Outcome" value={call.outcome} />
              <InfoRow label="Date" value={new Date(call.created_at).toLocaleDateString()} />
              <InfoRow label="Time" value={new Date(call.created_at).toLocaleTimeString()} />
            </div>
          </div>

          {call.extracted_data && (
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
              <h2 className="font-semibold mb-4">Extracted Information</h2>
              <div className="space-y-3">
                {Object.entries(call.extracted_data as Record<string, string>).map(([key, value]) => (
                  <div key={key}>
                    <p className="text-sm text-gray-400 capitalize">{key.replace(/_/g, ' ')}</p>
                    <p className="font-medium">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Transcript */}
        <div className="col-span-2">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
            <h2 className="font-semibold mb-4">Transcript</h2>
            {transcript.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No transcript available</p>
            ) : (
              <div className="space-y-4 max-h-[600px] overflow-y-auto">
                {transcript.map((entry, index) => (
                  <div
                    key={index}
                    className={`flex ${entry.role === 'agent' ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg p-4 ${
                        entry.role === 'agent'
                          ? 'bg-blue-600/20 text-blue-100'
                          : 'bg-gray-700 text-gray-100'
                      }`}
                    >
                      <p className="text-xs text-gray-400 mb-1 capitalize">
                        {entry.role === 'agent' ? 'AI Receptionist' : 'Caller'}
                      </p>
                      <p>{entry.content}</p>
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
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium capitalize">{value}</span>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const colors: Record<string, string> = {
    booked: 'bg-green-500/20 text-green-400',
    answered: 'bg-blue-500/20 text-blue-400',
    transferred: 'bg-yellow-500/20 text-yellow-400',
    voicemail: 'bg-gray-500/20 text-gray-400',
    abandoned: 'bg-red-500/20 text-red-400',
  };

  return (
    <span className={`px-3 py-1.5 rounded text-sm font-medium ${colors[outcome] || colors.answered}`}>
      {outcome}
    </span>
  );
}

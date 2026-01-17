'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { TranscriptResponse } from '@/types';

interface TranscriptViewerProps {
  transcript: TranscriptResponse;
}

export function TranscriptViewer({ transcript }: TranscriptViewerProps) {
  return (
    <div className="space-y-6">
      {/* Summary */}
      {transcript.summary && (
        <div className="bg-primary-50 rounded-xl p-4 border border-primary-100">
          <h3 className="font-semibold text-primary-900 mb-2 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
            AI Summary
          </h3>
          <p className="text-primary-800">{transcript.summary}</p>
        </div>
      )}

      {/* Conversation */}
      <div className="space-y-4">
        <h3 className="font-semibold text-gray-900">Conversation</h3>
        <div className="space-y-3">
          {transcript.transcript.map((turn, index) => (
            <div
              key={index}
              className={cn(
                'flex',
                turn.role === 'user' ? 'justify-end' : 'justify-start'
              )}
            >
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-4 py-3',
                  turn.role === 'user'
                    ? 'bg-primary-600 text-white rounded-br-md'
                    : 'bg-gray-100 text-gray-900 rounded-bl-md'
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={cn(
                      'text-xs font-medium',
                      turn.role === 'user' ? 'text-primary-200' : 'text-gray-500'
                    )}
                  >
                    {turn.role === 'user' ? 'You' : 'AI Receptionist'}
                  </span>
                  {turn.timestamp && (
                    <span
                      className={cn(
                        'text-xs',
                        turn.role === 'user' ? 'text-primary-300' : 'text-gray-400'
                      )}
                    >
                      {turn.timestamp}
                    </span>
                  )}
                </div>
                <p className="text-sm leading-relaxed">{turn.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions demonstrated */}
      {transcript.actions_demonstrated && transcript.actions_demonstrated.length > 0 && (
        <div className="bg-green-50 rounded-xl p-4 border border-green-100">
          <h3 className="font-semibold text-green-900 mb-2 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Demonstrated Capabilities
          </h3>
          <div className="flex flex-wrap gap-2">
            {transcript.actions_demonstrated.map((action, index) => (
              <span
                key={index}
                className="inline-block bg-green-100 text-green-800 text-sm px-3 py-1 rounded-full"
              >
                {action}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Call stats */}
      <div className="flex justify-center gap-8 text-sm text-gray-500">
        <div>
          <span className="font-medium">{transcript.turn_count}</span> messages
        </div>
        <div>
          <span className="font-medium">{Math.floor(transcript.duration / 60)}:{(transcript.duration % 60).toString().padStart(2, '0')}</span> duration
        </div>
      </div>
    </div>
  );
}

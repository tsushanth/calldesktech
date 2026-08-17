'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useOnboarding } from '@/context/OnboardingContext';
import { formatDuration, formatPhoneDisplay } from '@/lib/utils';
import { CALL_STATUSES } from '@/lib/constants';

export default function FocusedDemoCallPage() {
  const router = useRouter();
  const {
    businessName,
    ownerPhone,
    callStatus,
    callDuration,
    isCallInProgress,
    startCallPolling,
    stopCallPolling,
    retryDemoCall,
    isLoading,
    error,
  } = useOnboarding();

  const statusInfo = CALL_STATUSES[callStatus as keyof typeof CALL_STATUSES] || { label: callStatus, color: 'text-gray-500' };

  // Start polling when component mounts
  useEffect(() => {
    startCallPolling();
    return () => stopCallPolling();
  }, [startCallPolling, stopCallPolling]);

  // Navigate to transcript page when call completes
  useEffect(() => {
    if (callStatus === 'completed') {
      const timer = setTimeout(() => {
        router.push('/demo/focused/transcript');
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [callStatus, router]);

  // Redirect back only if we land here with no business name AND no call
  // already in flight. Checking `!businessName` alone during render bounced
  // users back to the business-details step even after a successful call:
  // createTenantAndStartDemo sets isCallInProgress and calls router.push in
  // the same async function, but this page's first render can commit before
  // that context update has propagated, so businessName reads as empty for
  // one frame. Doing this in an effect (not during render) and gating on
  // isCallInProgress avoids bouncing away from a call that's already underway.
  useEffect(() => {
    if (!businessName && !isCallInProgress && !callStatus) {
      router.push('/demo/focused');
    }
  }, [businessName, isCallInProgress, callStatus, router]);

  if (!businessName && !isCallInProgress && !callStatus) {
    return null;
  }

  const isRinging = callStatus === 'ringing' || callStatus === 'queued' || callStatus === 'initiated';
  const isInProgress = callStatus === 'in-progress';
  const isCompleted = callStatus === 'completed';
  const isFailed = callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer';

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-lg mx-auto">
        {/* Progress indicator */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="w-12 h-1 bg-green-500"></div>
            <div className="w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="w-12 h-1 bg-primary-600"></div>
            <div className="w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center text-sm font-medium">3</div>
          </div>
        </div>

        {/* Call status card */}
        <Card className="text-center">
          {/* Business icon */}
          <div className="w-20 h-20 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>

          <h2 className="text-xl font-semibold text-gray-900 mb-1">
            {businessName}
          </h2>
          <p className="text-gray-500 mb-6">
            Calling {formatPhoneDisplay(ownerPhone)}
          </p>

          {/* Status indicator */}
          <div className="mb-6">
            {(isRinging || isInProgress) && (
              <div className="flex items-center justify-center gap-3">
                <LoadingSpinner size="sm" />
                <span className={`font-medium ${statusInfo.color}`}>
                  {statusInfo.label}
                </span>
              </div>
            )}

            {isCompleted && (
              <div className="flex items-center justify-center gap-2 text-green-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="font-medium">Call Completed</span>
              </div>
            )}

            {isFailed && (
              <div className="flex items-center justify-center gap-2 text-red-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="font-medium">{statusInfo.label}</span>
              </div>
            )}
          </div>

          {/* Duration */}
          {callDuration > 0 && (
            <div className="text-2xl font-mono text-gray-700 mb-6">
              {formatDuration(callDuration)}
            </div>
          )}

          {/* Actions */}
          {isCompleted && (
            <p className="text-sm text-gray-500">
              Redirecting...
            </p>
          )}

          {isFailed && (
            <div className="space-y-3">
              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}
              <Button
                onClick={retryDemoCall}
                isLoading={isLoading}
              >
                Try Again
              </Button>
            </div>
          )}

          {isRinging && (
            <p className="text-sm text-gray-500">
              Please answer your phone to start the demo
            </p>
          )}

          {isInProgress && (
            <p className="text-sm text-gray-500">
              Talk to your AI receptionist!
            </p>
          )}
        </Card>

        {/* Tips during call */}
        {isInProgress && (
          <div className="mt-6 bg-blue-50 rounded-lg p-4">
            <h3 className="font-medium text-blue-900 mb-2">Try asking:</h3>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>&bull; &ldquo;I&apos;d like to book an appointment&rdquo;</li>
              <li>&bull; &ldquo;What services do you offer?&rdquo;</li>
              <li>&bull; &ldquo;What are your hours?&rdquo;</li>
              <li>&bull; &ldquo;Can I speak to someone?&rdquo;</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TranscriptViewer } from '@/components/onboarding/TranscriptViewer';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useOnboarding } from '@/context/OnboardingContext';
import type { CallerInsights } from '@/lib/api';

// Helper to get badge color based on value
function getInsightBadgeColor(value: string): string {
  const colors: Record<string, string> = {
    positive: 'bg-green-100 text-green-800',
    enthusiastic: 'bg-green-100 text-green-800',
    neutral: 'bg-gray-100 text-gray-800',
    negative: 'bg-red-100 text-red-800',
    frustrated: 'bg-red-100 text-red-800',
    low: 'bg-gray-100 text-gray-800',
    medium: 'bg-yellow-100 text-yellow-800',
    high: 'bg-orange-100 text-orange-800',
    emergency: 'bg-red-100 text-red-800',
  };
  return colors[value.toLowerCase()] || 'bg-gray-100 text-gray-800';
}

function InsightBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-gray-600">{label}</span>
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getInsightBadgeColor(value)}`}>
        {value.replace(/_/g, ' ')}
      </span>
    </div>
  );
}

function CallerInsightsPanel({ insights }: { insights: CallerInsights }) {
  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
        <h4 className="font-medium text-blue-900 mb-2">Caller Profile</h4>
        <p className="text-blue-800 text-sm">{insights.caller_profile_summary}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-50 rounded-lg p-3">
          <InsightBadge label="Sentiment" value={insights.sentiment} />
          <InsightBadge label="Urgency" value={insights.urgency} />
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <InsightBadge label="Purchase Intent" value={insights.purchase_intent} />
          <InsightBadge label="Price Sensitivity" value={insights.price_sensitivity} />
        </div>
      </div>

      {insights.key_concerns && insights.key_concerns.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">Key Concerns</h4>
          <ul className="space-y-1">
            {insights.key_concerns.map((concern, i) => (
              <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                <span className="text-gray-400 mt-1">*</span>
                {concern}
              </li>
            ))}
          </ul>
        </div>
      )}

      {insights.follow_up_recommendation && (
        <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-4">
          <h4 className="font-medium text-yellow-900 mb-2">Recommended Action</h4>
          <p className="text-yellow-800 text-sm">{insights.follow_up_recommendation}</p>
        </div>
      )}
    </div>
  );
}

export default function FocusedTranscriptPage() {
  const router = useRouter();
  const {
    businessName,
    transcript,
    isLoading,
    fetchTranscript,
    reset,
  } = useOnboarding();

  useEffect(() => {
    if (!transcript) {
      fetchTranscript();
    }
  }, [transcript, fetchTranscript]);

  const handleTryAnother = () => {
    reset();
    router.push('/demo');
  };

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="text-gray-500">
              <div className="flex items-center gap-2">
                <span className="text-xl">B</span>
                <span className="font-medium">{businessName}</span>
              </div>
            </div>
            <span className="text-sm text-primary-600 font-medium">Demo Complete</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            Your Demo is Complete!
          </h1>
          <p className="text-gray-600">
            See how your AI receptionist handled the call for {businessName}
          </p>
        </div>

        {isLoading ? (
          <Card className="mb-8">
            <div className="flex flex-col items-center justify-center py-12">
              <LoadingSpinner size="lg" />
              <p className="mt-4 text-gray-500">Analyzing your call...</p>
            </div>
          </Card>
        ) : transcript ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            {/* Left Column: Summary & Transcript */}
            <div className="space-y-6">
              {transcript.summary && (
                <Card>
                  <h3 className="font-semibold text-gray-900 mb-3">Call Summary</h3>
                  <p className="text-gray-600">{transcript.summary}</p>
                  {transcript.caller_intent && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <span className="text-sm text-gray-500">Caller Intent: </span>
                      <span className="text-sm font-medium text-gray-700">{transcript.caller_intent}</span>
                    </div>
                  )}
                </Card>
              )}

              <Card>
                <h3 className="font-semibold text-gray-900 mb-3">Conversation Transcript</h3>
                <TranscriptViewer transcript={transcript} />
              </Card>
            </div>

            {/* Right Column: Caller Insights */}
            <div>
              <Card>
                <h3 className="font-semibold text-gray-900 mb-4">
                  Caller Insights
                  <span className="ml-2 text-xs font-normal text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                    AI-Generated
                  </span>
                </h3>
                {transcript.caller_insights ? (
                  <CallerInsightsPanel insights={transcript.caller_insights} />
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <p className="text-sm">Insights are being generated...</p>
                  </div>
                )}
              </Card>

              {/* Value Proposition */}
              <Card className="mt-6 bg-gradient-to-br from-primary-50 to-blue-50 border-primary-200">
                <div className="text-center">
                  <div className="text-2xl mb-2">T</div>
                  <h4 className="font-medium text-primary-900 mb-1">This Was Just a Preview</h4>
                  <p className="text-sm text-primary-700 mb-3">
                    With a full subscription, your AI will learn from your website, know your services, and handle real customer calls 24/7.
                  </p>
                </div>
              </Card>
            </div>
          </div>
        ) : (
          <Card className="mb-8">
            <div className="text-center py-12 text-gray-500">
              <p>Transcript not available yet.</p>
              <Button onClick={fetchTranscript} variant="secondary" className="mt-4">
                Retry
              </Button>
            </div>
          </Card>
        )}

        {/* CTAs */}
        <div className="space-y-4">
          <Card className="border-2 border-primary-500 bg-primary-50">
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                Ready to Go Live with {businessName}?
              </h2>
              <p className="text-gray-600 mb-4">
                Get a dedicated phone number and let your AI handle calls 24/7
              </p>
              <Link href="/pricing">
                <Button size="lg" className="w-full sm:w-auto">
                  Get Started — Pay As You Go
                </Button>
              </Link>
            </div>
          </Card>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button variant="secondary" onClick={handleTryAnother}>
              Try Another Demo
            </Button>
            <Link href="/">
              <Button variant="ghost">
                Back to Home
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

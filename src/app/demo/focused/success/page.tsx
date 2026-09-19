'use client';

import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useOnboarding } from '@/context/OnboardingContext';
import { formatDuration, formatPhoneDisplay } from '@/lib/utils';

export default function FocusedDemoSuccessPage() {
  const router = useRouter();
  const {
    businessName,
    tenantId,
    callDuration,
    assignedPhoneNumber,
    retryDemoCall,
    isLoading,
  } = useOnboarding();

  const handleGoLive = () => {
    router.push('/dashboard');
  };

  const handleAddKnowledge = () => {
    router.push(`/dashboard/knowledge`);
  };

  if (!businessName) {
    router.push('/demo/focused');
    return null;
  }

  return (
    <div className="min-h-[calc(100vh-72px)] bg-white py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Success header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Your AI Receptionist is Ready!
          </h1>
          <p className="text-lg text-gray-600">
            {businessName} now has a 24/7 AI-powered phone assistant
          </p>
        </div>

        {/* Call summary */}
        <Card className="mb-6">
          <h3 className="font-semibold text-gray-900 mb-4">Demo Summary</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Call Duration</p>
              <p className="text-lg font-semibold text-gray-900">
                {formatDuration(callDuration)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">AI Performance</p>
              <p className="text-lg font-semibold text-green-600">Excellent</p>
            </div>
          </div>
          {assignedPhoneNumber && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-sm text-gray-500">Your Phone Number</p>
              <p className="text-xl font-semibold text-primary-600">
                {formatPhoneDisplay(assignedPhoneNumber)}
              </p>
            </div>
          )}
        </Card>

        {/* Next steps */}
        <Card className="mb-6">
          <h3 className="font-semibold text-gray-900 mb-4">Next Steps to Go Live</h3>
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-primary-600 font-semibold text-sm">1</span>
              </div>
              <div>
                <p className="font-medium text-gray-900">Add your knowledge base</p>
                <p className="text-sm text-gray-600">
                  Help your AI answer questions about your services, pricing, and hours
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-primary-600 font-semibold text-sm">2</span>
              </div>
              <div>
                <p className="font-medium text-gray-900">Connect your calendar</p>
                <p className="text-sm text-gray-600">
                  Let the AI book appointments directly to your Cal.com calendar
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-primary-600 font-semibold text-sm">3</span>
              </div>
              <div>
                <p className="font-medium text-gray-900">Forward your calls</p>
                <p className="text-sm text-gray-600">
                  Set up call forwarding to your new AI receptionist number
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Actions */}
        <div className="space-y-3">
          <Button
            onClick={handleGoLive}
            className="w-full"
            size="lg"
          >
            Go to Dashboard
          </Button>

          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={handleAddKnowledge}
              className="flex-1"
            >
              Add Knowledge Base
            </Button>
            <Button
              variant="secondary"
              onClick={retryDemoCall}
              isLoading={isLoading}
              className="flex-1"
            >
              Test Call Again
            </Button>
          </div>
        </div>

        {/* Stats preview */}
        <div className="mt-8 grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-3xl font-bold text-primary-600">24/7</p>
            <p className="text-sm text-gray-500">Availability</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-primary-600">&lt;1s</p>
            <p className="text-sm text-gray-500">Answer Time</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-primary-600">100%</p>
            <p className="text-sm text-gray-500">Call Coverage</p>
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { useOnboarding } from '@/context/OnboardingContext';
import { isValidUSPhone } from '@/lib/utils';

export default function FocusedDemoPhonePage() {
  const router = useRouter();
  const {
    businessName,
    ownerPhone,
    setOwnerPhone,
    createTenantAndStartDemo,
    isLoading,
    error,
    clearError
  } = useOnboarding();

  const [localError, setLocalError] = useState('');

  const isPhoneValid = isValidUSPhone(ownerPhone);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isPhoneValid) {
      setLocalError('Please enter a valid US phone number');
      return;
    }

    setLocalError('');
    clearError();

    try {
      await createTenantAndStartDemo();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to start demo');
    }
  };

  if (!businessName) {
    router.push('/demo/focused');
    return null;
  }

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
            <div className="w-12 h-1 bg-primary-600"></div>
            <div className="w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center text-sm font-medium">2</div>
            <div className="w-12 h-1 bg-gray-200"></div>
            <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm font-medium">3</div>
          </div>
        </div>

        {/* Business preview */}
        <Card className="mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-gray-500">Your business</p>
              <p className="font-semibold text-gray-900">{businessName}</p>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-sm text-gray-600">
              <span className="font-medium">AI greeting preview:</span>
              <br />
              <span className="italic">&ldquo;Hello, thank you for calling {businessName}! How can I help you today?&rdquo;</span>
            </p>
          </div>
        </Card>

        {/* Phone input form */}
        <Card>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Enter Your Phone Number
          </h2>
          <p className="text-gray-600 mb-6">
            We&apos;ll call you so you can experience your AI receptionist
          </p>

          <form onSubmit={handleSubmit}>
            <PhoneInput
              value={ownerPhone}
              onChange={setOwnerPhone}
              error={localError || error || undefined}
              className="mb-6"
            />

            <div className="bg-green-50 rounded-lg p-4 mb-6">
              <div className="flex gap-3">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm text-green-700">
                  <p className="font-medium mb-1">This is your actual AI receptionist</p>
                  <p>After the demo, you can go live immediately with your own phone number!</p>
                </div>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={!isPhoneValid}
              isLoading={isLoading}
            >
              Call Me Now
            </Button>
          </form>
        </Card>

        {/* Back link */}
        <div className="text-center mt-6">
          <button
            onClick={() => router.push('/demo/focused')}
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            &larr; Edit business details
          </button>
        </div>
      </div>
    </div>
  );
}

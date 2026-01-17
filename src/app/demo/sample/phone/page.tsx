'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { useOnboarding } from '@/context/OnboardingContext';
import { isValidUSPhone } from '@/lib/utils';
import { DEMO_PROFILES } from '@/lib/constants';

export default function SampleDemoPhonePage() {
  const router = useRouter();
  const {
    selectedProfileId,
    ownerPhone,
    setOwnerPhone,
    createTenantAndStartDemo,
    isLoading,
    error,
    clearError
  } = useOnboarding();

  const [localError, setLocalError] = useState('');

  const profile = selectedProfileId ? DEMO_PROFILES[selectedProfileId] : null;
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

  if (!profile) {
    router.push('/demo/sample');
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

        {/* Selected profile display */}
        <Card className="mb-6">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 ${profile.color} rounded-lg flex items-center justify-center text-2xl`}>
              {profile.icon}
            </div>
            <div>
              <p className="text-sm text-gray-500">Selected profile</p>
              <p className="font-semibold text-gray-900">{profile.businessName}</p>
            </div>
          </div>
        </Card>

        {/* Phone input form */}
        <Card>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Enter Your Phone Number
          </h2>
          <p className="text-gray-600 mb-6">
            We&apos;ll call you so you can experience the AI receptionist firsthand
          </p>

          <form onSubmit={handleSubmit}>
            <PhoneInput
              value={ownerPhone}
              onChange={setOwnerPhone}
              error={localError || error || undefined}
              className="mb-6"
            />

            <div className="bg-blue-50 rounded-lg p-4 mb-6">
              <div className="flex gap-3">
                <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm text-blue-700">
                  <p className="font-medium mb-1">What happens next?</p>
                  <p>You&apos;ll receive a call from our AI assistant acting as {profile.businessName}. Try asking questions or booking an appointment!</p>
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
            onClick={() => router.push('/demo/sample')}
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            &larr; Choose a different profile
          </button>
        </div>
      </div>
    </div>
  );
}

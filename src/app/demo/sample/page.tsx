'use client';

import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useOnboarding } from '@/context/OnboardingContext';
import { DEMO_PROFILES, type DemoProfileId } from '@/lib/constants';

export default function SampleDemoProfilesPage() {
  const router = useRouter();
  const { selectedProfileId, selectProfile } = useOnboarding();

  const profiles = Object.entries(DEMO_PROFILES) as [DemoProfileId, typeof DEMO_PROFILES[DemoProfileId]][];

  const handleContinue = () => {
    if (selectedProfileId) {
      router.push('/demo/sample/phone');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Progress indicator */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center text-sm font-medium">1</div>
            <div className="w-12 h-1 bg-gray-200"></div>
            <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm font-medium">2</div>
            <div className="w-12 h-1 bg-gray-200"></div>
            <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm font-medium">3</div>
          </div>
        </div>

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Choose a Business Type
          </h1>
          <p className="text-gray-600">
            Select a profile to hear how the AI receptionist handles calls
          </p>
        </div>

        {/* Profile grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {profiles.map(([id, profile]) => (
            <Card
              key={id}
              hover
              selected={selectedProfileId === id}
              className="cursor-pointer p-5"
              onClick={() => selectProfile(id)}
            >
              <div className="flex items-start gap-3">
                <div className={`w-12 h-12 ${profile.color} rounded-lg flex items-center justify-center text-2xl`}>
                  {profile.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900 truncate">
                      {profile.businessName}
                    </h3>
                    {selectedProfileId === id && (
                      <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <p className="text-sm text-primary-600 font-medium">
                    {profile.displayName}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {profile.voiceStyle}
                  </p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-sm text-gray-600 italic line-clamp-2">
                  &ldquo;{profile.greeting}&rdquo;
                </p>
              </div>
            </Card>
          ))}
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center">
          <button
            onClick={() => router.push('/demo')}
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            &larr; Back
          </button>
          <Button
            onClick={handleContinue}
            disabled={!selectedProfileId}
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}

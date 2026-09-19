'use client';

import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useOnboarding } from '@/context/OnboardingContext';
import { CAPABILITY_DEMOS, type DemoProfileId } from '@/lib/constants';

export default function SampleDemoProfilesPage() {
  const router = useRouter();
  const { selectedProfileId, selectProfile, demoMechanism, setDemoMechanism, createTenantAndStartDemo, isLoading } = useOnboarding();

  const profiles = Object.entries(CAPABILITY_DEMOS) as [DemoProfileId, typeof CAPABILITY_DEMOS[DemoProfileId]][];

  const handleContinue = async () => {
    if (!selectedProfileId) return;
    if (demoMechanism === 'phone') {
      router.push('/demo/sample/phone');
    } else {
      // Browser mechanism places no real call — nothing more to collect,
      // go straight to the in-browser call.
      await createTenantAndStartDemo();
    }
  };

  return (
    <div className="min-h-[calc(100vh-72px)] bg-white py-12 px-4">
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
            See What It Can Do
          </h1>
          <p className="text-gray-600">
            Pick a capability to hear it in action — you&apos;ll choose which ones you want for your own business later
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

        {/* Mechanism choice */}
        {selectedProfileId && (
          <div className="flex justify-center mb-6">
            <div className="inline-flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setDemoMechanism('phone')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                  demoMechanism === 'phone' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                📞 Call my phone
              </button>
              <button
                onClick={() => setDemoMechanism('browser')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                  demoMechanism === 'browser' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                🎧 Try in browser
              </button>
            </div>
          </div>
        )}

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
            isLoading={demoMechanism === 'browser' && isLoading}
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}

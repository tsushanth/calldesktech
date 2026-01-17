'use client';

import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useOnboarding } from '@/context/OnboardingContext';

export default function DemoSelectionPage() {
  const router = useRouter();
  const { setDemoType } = useOnboarding();

  const handleSampleDemo = () => {
    setDemoType('sample');
    router.push('/demo/sample');
  };

  const handleFocusedDemo = () => {
    setDemoType('focused');
    router.push('/demo/focused');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Try Our AI Receptionist
          </h1>
          <p className="text-lg text-gray-600">
            Choose how you&apos;d like to experience our AI phone assistant
          </p>
        </div>

        {/* Options */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Quick Sample Demo */}
          <Card hover className="p-8 cursor-pointer" onClick={handleSampleDemo}>
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Quick Sample Demo
              </h2>
              <p className="text-gray-600 mb-6">
                Try pre-configured business profiles to see the AI in action
              </p>
              <ul className="text-left text-sm text-gray-500 space-y-2 mb-6">
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Choose from 5 business types
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Get a demo call in 30 seconds
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  No setup required
                </li>
              </ul>
              <Button variant="secondary" className="w-full">
                Start Quick Demo
              </Button>
            </div>
          </Card>

          {/* Your Business Demo */}
          <Card hover className="p-8 cursor-pointer border-primary-200" onClick={handleFocusedDemo}>
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-primary-600 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div className="inline-block bg-primary-100 text-primary-700 text-xs font-semibold px-2 py-1 rounded mb-2">
                RECOMMENDED
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Your Business Demo
              </h2>
              <p className="text-gray-600 mb-6">
                Set up a customized AI receptionist for your actual business
              </p>
              <ul className="text-left text-sm text-gray-500 space-y-2 mb-6">
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Uses your business name
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Customized greeting
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Ready to go live after demo
                </li>
              </ul>
              <Button className="w-full">
                Set Up My Business
              </Button>
            </div>
          </Card>
        </div>

        {/* Back link */}
        <div className="text-center mt-8">
          <button
            onClick={() => router.push('/')}
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            &larr; Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}

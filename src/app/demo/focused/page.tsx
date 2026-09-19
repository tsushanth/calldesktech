'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useOnboarding } from '@/context/OnboardingContext';
import { isValidEmail } from '@/lib/utils';
import { BUSINESS_TYPES } from '@/lib/constants';

export default function FocusedDemoPage() {
  const router = useRouter();
  const {
    businessName,
    setBusinessName,
    ownerEmail,
    setOwnerEmail,
    businessDescription,
    setBusinessDescription,
    setDemoType,
  } = useOnboarding();

  const [businessType, setBusinessType] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!businessName.trim()) {
      newErrors.businessName = 'Business name is required';
    }

    if (!ownerEmail.trim()) {
      newErrors.email = 'Email is required';
    } else if (!isValidEmail(ownerEmail)) {
      newErrors.email = 'Please enter a valid email';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleContinue = () => {
    if (validate()) {
      setDemoType('focused');
      router.push('/demo/focused/blocks');
    }
  };

  return (
    <div className="min-h-[calc(100vh-72px)] bg-white py-12 px-4">
      <div className="max-w-lg mx-auto">
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
            Tell Us About Your Business
          </h1>
          <p className="text-gray-600">
            We&apos;ll create a custom AI receptionist just for you
          </p>
        </div>

        {/* Form */}
        <Card>
          <div className="space-y-5">
            <div>
              <Input
                label="Business Name"
                placeholder="e.g., Mike's Plumbing"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                error={errors.businessName}
              />
            </div>

            <Input
              label="Your Email"
              type="email"
              placeholder="you@company.com"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              error={errors.email}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Business Type
              </label>
              <select
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
              >
                <option value="">Select a type...</option>
                {BUSINESS_TYPES.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Main Services (optional)
              </label>
              <textarea
                placeholder="e.g., Emergency plumbing, water heater installation, drain cleaning..."
                value={businessDescription}
                onChange={(e) => setBusinessDescription(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder-gray-400 text-gray-900 bg-white"
              />
              <p className="mt-1 text-sm text-gray-500">
                This helps the AI answer questions about your services
              </p>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-100">
            <Button
              onClick={handleContinue}
              className="w-full"
              size="lg"
            >
              Continue
            </Button>
          </div>
        </Card>

        {/* Back link */}
        <div className="text-center mt-6">
          <button
            onClick={() => router.push('/demo')}
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            &larr; Back
          </button>
        </div>
      </div>
    </div>
  );
}

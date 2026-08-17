'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useOnboarding } from '@/context/OnboardingContext';
import { BUSINESS_TYPES } from '@/lib/constants';
import { isValidEmail } from '@/lib/utils';

export default function BusinessSetupPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const {
    businessName,
    setBusinessName,
    ownerEmail,
    setOwnerEmail,
    businessDescription,
    setBusinessDescription,
    businessWebsite,
    businessAddress,
    businessPhone,
    businessHours,
    setTenantId,
    isLoading,
  } = useOnboarding();

  const [businessType, setBusinessType] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Check auth status only (no payment required to set up business)
  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/auth/signin?callbackUrl=/onboarding/business');
      return;
    }
  }, [authStatus, router]);

  // Pre-fill email from session
  useEffect(() => {
    if (session?.user?.email && !ownerEmail) {
      setOwnerEmail(session.user.email);
    }
  }, [session, ownerEmail, setOwnerEmail]);

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

    if (!businessType) {
      newErrors.businessType = 'Please select a business type';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleContinue = async () => {
    if (!validate()) return;

    setSubmitting(true);

    try {
      // Create business in database
      const response = await fetch('/api/business', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: businessName,
          email: ownerEmail,
          business_type: businessType,
          description: businessDescription,
          website: businessWebsite,
          address: businessAddress,
          phone: businessPhone,
          hours: businessHours,
        }),
      });

      const data = await response.json();

      if (data.id) {
        setTenantId(data.id);
        localStorage.setItem('calldesk_business_id', data.id);

        // Check if user has a coupon (skip payment) or needs to pay
        const couponCode = localStorage.getItem('calldesk_coupon_code');
        const stripeSessionId = localStorage.getItem('calldesk_stripe_session_id');
        const flow = localStorage.getItem('calldesk_flow');

        if (couponCode || stripeSessionId) {
          // Has coupon or already paid - go to complete
          router.push('/onboarding/complete');
        } else if (flow === 'subscribe') {
          // Came from pricing page wanting to subscribe - go to Stripe checkout
          localStorage.removeItem('calldesk_flow');

          const checkoutResponse = await fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ business_id: data.id }),
          });

          const checkoutData = await checkoutResponse.json();

          if (checkoutData.checkout_url) {
            window.location.href = checkoutData.checkout_url;
          } else {
            // Checkout failed, go to complete page where they can enter coupon
            console.error('Checkout failed:', checkoutData.error);
            router.push('/onboarding/complete');
          }
        } else {
          // Direct access - go to complete page where they can enter coupon or subscribe
          router.push('/onboarding/complete');
        }
      } else {
        throw new Error(data.error || 'Failed to create business');
      }
    } catch (error) {
      console.error('Error creating business:', error);
      setErrors({ submit: 'Failed to create business. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (authStatus === 'loading' || isLoading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-lg mx-auto">
        {/* Progress indicator */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center text-sm font-medium">1</div>
            <div className="w-12 h-1 bg-gray-200"></div>
            <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm font-medium">2</div>
          </div>
        </div>

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Set Up Your Business
          </h1>
          <p className="text-gray-600">
            Tell us about your business to personalize your AI receptionist
          </p>
        </div>

        {/* Form */}
        <Card>
          <div className="space-y-5">
            {errors.submit && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-red-600">{errors.submit}</p>
              </div>
            )}

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
                onChange={(e) => {
                  setBusinessType(e.target.value);
                  if (errors.businessType) {
                    setErrors((prev) => ({ ...prev, businessType: '' }));
                  }
                }}
                className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white ${
                  errors.businessType ? 'border-red-500' : 'border-gray-300'
                }`}
              >
                <option value="">Select a type...</option>
                {BUSINESS_TYPES.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
              {errors.businessType && (
                <p className="mt-1 text-sm text-red-600">{errors.businessType}</p>
              )}
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
              disabled={submitting}
            >
              {submitting ? 'Setting up...' : 'Continue'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

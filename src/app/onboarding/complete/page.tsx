'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useOnboarding } from '@/context/OnboardingContext';

export default function OnboardingCompletePage() {
  const { status: authStatus } = useSession();
  const router = useRouter();
  const {
    businessName,
    tenantId,
    assignedPhoneNumber,
    setAssignedPhoneNumber,
    setIsSubscribed,
  } = useOnboarding();

  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [couponError, setCouponError] = useState('');
  const [hasPayment, setHasPayment] = useState(false);

  // Check auth and payment status
  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/auth/signin?callbackUrl=/onboarding/complete');
      return;
    }

    // Check if we have a business
    const businessId = localStorage.getItem('calldesk_business_id');
    if (!businessId && !tenantId) {
      router.push('/onboarding/business');
      return;
    }

    // Check if we have payment verification
    const sessionId = localStorage.getItem('calldesk_stripe_session_id');
    const storedCoupon = localStorage.getItem('calldesk_coupon_code');
    setHasPayment(!!(sessionId || storedCoupon));
  }, [authStatus, router, tenantId]);

  const handleApplyCoupon = () => {
    if (!couponCode.trim()) {
      setCouponError('Please enter a coupon code');
      return;
    }

    const validCoupons = ['SUSH', 'BETA', 'EARLY'];
    if (validCoupons.includes(couponCode.toUpperCase())) {
      localStorage.setItem('calldesk_coupon_code', couponCode.toUpperCase());
      setHasPayment(true);
      setCouponError('');
    } else {
      setCouponError('Invalid coupon code');
    }
  };

  const handleActivate = async () => {
    setActivating(true);
    setError(null);

    try {
      const businessId = tenantId || localStorage.getItem('calldesk_business_id');
      const sessionId = localStorage.getItem('calldesk_stripe_session_id');
      const storedCoupon = localStorage.getItem('calldesk_coupon_code');

      // Call go-live API
      const response = await fetch('/api/go-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          session_id: sessionId,
          coupon_code: storedCoupon,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setActivated(true);
        setIsSubscribed(true);
        if (data.phone_number) {
          setAssignedPhoneNumber(data.phone_number);
        }

        // Clear session storage
        localStorage.removeItem('calldesk_stripe_session_id');
        localStorage.removeItem('calldesk_coupon_code');
      } else {
        throw new Error(data.error || 'Failed to activate service');
      }
    } catch (err) {
      console.error('Activation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to activate service');
    } finally {
      setActivating(false);
    }
  };

  const handleGoToDashboard = () => {
    router.push('/dashboard');
  };

  if (authStatus === 'loading') {
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
            <div className="w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="w-12 h-1 bg-primary-600"></div>
            <div className="w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center text-sm font-medium">2</div>
          </div>
        </div>

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {activated ? 'You\'re All Set!' : 'Activate Your AI Receptionist'}
          </h1>
          <p className="text-gray-600">
            {activated
              ? 'Your AI receptionist is now live and ready to take calls'
              : 'One last step to go live with your AI receptionist'}
          </p>
        </div>

        {/* Content */}
        <Card>
          {activated ? (
            <div className="text-center">
              {/* Success Icon */}
              <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                <svg
                  className="w-8 h-8 text-green-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>

              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                {businessName || 'Your Business'} is Live!
              </h2>

              {assignedPhoneNumber && (
                <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 mb-6">
                  <p className="text-sm text-primary-700 mb-1">Your dedicated phone number</p>
                  <p className="text-2xl font-bold text-primary-900">{assignedPhoneNumber}</p>
                </div>
              )}

              <p className="text-gray-600 mb-6">
                Forward your business calls to this number or share it directly with customers.
              </p>

              <Button
                onClick={handleGoToDashboard}
                className="w-full"
                size="lg"
              >
                Go to Dashboard
              </Button>
            </div>
          ) : (
            <div>
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <div className="space-y-4 mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Business details configured</p>
                    <p className="text-sm text-gray-500">{businessName || 'Your business'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                    hasPayment ? 'bg-green-100' : 'bg-yellow-100'
                  }`}>
                    {hasPayment ? (
                      <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <span className="text-xs font-medium text-yellow-600">2</span>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">
                      {hasPayment ? 'Payment confirmed' : 'Payment required'}
                    </p>
                    {hasPayment ? (
                      <p className="text-sm text-gray-500">Pay-as-you-go — billed only for call minutes and completed actions</p>
                    ) : (
                      <div className="mt-2">
                        <p className="text-sm text-gray-500 mb-2">
                          Enter a coupon code or <button
                            onClick={() => router.push('/pricing')}
                            className="text-primary-600 hover:underline"
                          >
                            subscribe
                          </button>
                        </p>
                        <div className="flex gap-2">
                          <Input
                            placeholder="Enter coupon code"
                            value={couponCode}
                            onChange={(e) => {
                              setCouponCode(e.target.value);
                              setCouponError('');
                            }}
                            error={couponError}
                            className="flex-1"
                          />
                          <Button onClick={handleApplyCoupon} variant="secondary">
                            Apply
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-medium text-primary-600">3</span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Provision dedicated phone number</p>
                    <p className="text-sm text-gray-500">Click below to activate your AI receptionist</p>
                  </div>
                </div>
              </div>

              <Button
                onClick={handleActivate}
                className="w-full"
                size="lg"
                disabled={activating || !hasPayment}
              >
                {activating ? (
                  <span className="flex items-center justify-center gap-2">
                    <LoadingSpinner size="sm" />
                    Activating...
                  </span>
                ) : (
                  'Activate Now'
                )}
              </Button>
            </div>
          )}
        </Card>

        {/* Back link */}
        {!activated && (
          <div className="text-center mt-6">
            <button
              onClick={() => router.push('/onboarding/business')}
              className="text-gray-500 hover:text-gray-700 text-sm"
            >
              &larr; Back to business setup
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

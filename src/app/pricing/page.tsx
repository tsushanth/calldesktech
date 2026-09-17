'use client';

import { useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { PricingCard } from '@/components/onboarding/PricingCard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';

export default function PricingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [showCoupon, setShowCoupon] = useState(false);
  const [couponError, setCouponError] = useState('');

  const handleSubscribe = async () => {
    if (status !== 'authenticated') {
      // Redirect to sign in, then come back
      signIn('google', { callbackUrl: '/pricing' });
      return;
    }

    // Check if business already exists
    const businessId = localStorage.getItem('calldesk_business_id');

    if (!businessId) {
      // No business yet - go to business setup first
      // Mark that user came from pricing (wants to subscribe)
      localStorage.setItem('calldesk_flow', 'subscribe');
      router.push('/onboarding/business');
      return;
    }

    // Business exists, proceed to checkout
    setLoading(true);
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId }),
      });

      const data = await response.json();

      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        throw new Error(data.error || 'Failed to create checkout session');
      }
    } catch (error) {
      console.error('Checkout error:', error);
      alert('Failed to start checkout. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCouponSubmit = async () => {
    if (!couponCode.trim()) {
      setCouponError('Please enter a coupon code');
      return;
    }

    // For now, check against a hardcoded coupon for testing
    const validCoupons = ['SUSH', 'BETA', 'EARLY'];

    if (validCoupons.includes(couponCode.toUpperCase())) {
      localStorage.setItem('calldesk_coupon_code', couponCode.toUpperCase());
      router.push('/onboarding/business');
    } else {
      setCouponError('Invalid coupon code');
    }
  };

  if (status === 'loading') {
    return (
      <main className="min-h-screen bg-[#f7f8fa] flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f8fa] py-16 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-semibold text-[#1a1d29] mb-4">
            Simple, Usage-Based Pricing
          </h1>
          <p className="text-xl text-gray-500">
            No monthly minimum. Pay only for talk time and completed actions.
          </p>
        </div>

        {/* Pricing Card */}
        <div className="flex justify-center mb-8">
          <PricingCard onSubscribe={handleSubscribe} loading={loading} />
        </div>

        {/* vs. Retell — the $0.02/min kokoro number is our own priced rate
            (USAGE_PRICES/PRICING in src/lib/constants.ts); the Retell figure
            is real observed blended cost-per-minute from an actual Retell
            account's own billing dashboard (voice infra + LLM + phone +
            telephony + TTS combined), not a published Retell price sheet —
            worded that way deliberately so this stays honest if Retell's
            own pricing changes. */}
        <div className="max-w-2xl mx-auto mb-12 rounded-2xl border border-gray-200 bg-white p-6">
          <h3 className="text-center text-[15px] font-semibold text-[#1a1d29] mb-1">How this compares</h3>
          <p className="text-center text-[12.5px] text-gray-400 mb-5">
            Retell figure is real observed blended cost-per-minute from an actual account&apos;s own billing dashboard, not a published price sheet.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-blue-50 p-4 text-center">
              <p className="text-[12px] font-medium text-blue-700 mb-1">This platform (default voice)</p>
              <p className="text-[28px] font-bold text-blue-900">$0.02</p>
              <p className="text-[12px] text-blue-700">per minute</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-4 text-center">
              <p className="text-[12px] font-medium text-gray-500 mb-1">Retell (observed blended avg)</p>
              <p className="text-[28px] font-bold text-gray-700">~$0.16</p>
              <p className="text-[12px] text-gray-500">per minute</p>
            </div>
          </div>
          <p className="mt-4 text-center text-[12px] text-gray-400">
            Premium voices (ElevenLabs, Cartesia) run $0.08–$0.16/min here — still no monthly minimum either way.
          </p>
        </div>

        {/* Coupon Section */}
        <div className="text-center">
          {!showCoupon ? (
            <button
              onClick={() => setShowCoupon(true)}
              className="text-gray-500 hover:text-[#1a1d29] text-sm underline"
            >
              Have a coupon code?
            </button>
          ) : (
            <div className="max-w-xs mx-auto">
              <div className="flex gap-2">
                <Input
                  placeholder="Enter code"
                  value={couponCode}
                  onChange={(e) => {
                    setCouponCode(e.target.value);
                    setCouponError('');
                  }}
                  error={couponError}
                />
                <Button onClick={handleCouponSubmit} variant="secondary">
                  Apply
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Try Demo Link */}
        <div className="text-center mt-12">
          <p className="text-gray-500 mb-2">Want to try before you buy?</p>
          <Link
            href="/demo"
            className="text-blue-600 font-medium hover:underline"
          >
            Try a free demo call
          </Link>
        </div>

        {/* Back to Home */}
        <div className="text-center mt-8">
          <Link
            href="/"
            className="text-gray-400 hover:text-[#1a1d29] text-sm"
          >
            &larr; Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}

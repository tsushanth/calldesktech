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
      <main className="min-h-screen bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary-600 to-primary-800 py-16 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-white mb-4">
            Simple, Transparent Pricing
          </h1>
          <p className="text-xl text-white/80">
            One plan, everything included. No hidden fees.
          </p>
        </div>

        {/* Pricing Card */}
        <div className="flex justify-center mb-8">
          <PricingCard onSubscribe={handleSubscribe} loading={loading} />
        </div>

        {/* Coupon Section */}
        <div className="text-center">
          {!showCoupon ? (
            <button
              onClick={() => setShowCoupon(true)}
              className="text-white/70 hover:text-white text-sm underline"
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
                  className="bg-white"
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
          <p className="text-white/70 mb-2">Want to try before you buy?</p>
          <Link
            href="/demo"
            className="text-white font-medium hover:underline"
          >
            Try a free demo call
          </Link>
        </div>

        {/* Back to Home */}
        <div className="text-center mt-8">
          <Link
            href="/"
            className="text-white/60 hover:text-white text-sm"
          >
            &larr; Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}

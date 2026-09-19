'use client';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PRICING } from '@/lib/constants';

interface PricingCardProps {
  onSubscribe: () => void;
  loading?: boolean;
}

export function PricingCard({ onSubscribe, loading }: PricingCardProps) {
  return (
    <Card className="max-w-md w-full rounded-2xl border-[#e4e4f0] p-8 shadow-none">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-semibold tracking-[-0.03em] text-[#00122e]">AI Receptionist</h2>
        <div className="mt-4">
          <span className="text-6xl font-normal tracking-[-0.05em] text-[#00122e]">$0</span>
          <span className="text-gray-500"> base — pay only for usage</span>
        </div>
        <p className="mt-2 text-sm text-gray-500">
          ${PRICING.usage.voicePerMinute.kokoro.toFixed(2)}/min talk time, plus a small fee only when the call actually books, transfers, or takes a message
        </p>
      </div>

      <ul className="space-y-4 mb-8">
        {PRICING.usage.features.map((feature, index) => (
          <li key={index} className="flex items-center gap-3">
            <svg
              className="w-5 h-5 text-green-500 flex-shrink-0"
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
            <span className="text-gray-700">{feature}</span>
          </li>
        ))}
      </ul>

      <div className="border-t border-gray-100 pt-4 mb-6">
        <p className="text-sm text-gray-500 text-center">
          Booking ${PRICING.usage.perBookingEvent.toFixed(3)} · Transfer ${PRICING.usage.perTransferEvent.toFixed(3)} · Message ${PRICING.usage.perMessageEvent.toFixed(3)} — billed per completed action, not per attempt
        </p>
      </div>

      <Button
        onClick={onSubscribe}
        disabled={loading}
        className="w-full"
        size="lg"
      >
        {loading ? 'Processing...' : 'Get Started'}
      </Button>

      <div className="mt-6 flex items-center justify-center gap-4 text-sm text-gray-500">
        <div className="flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          Secure payment
        </div>
        <div className="flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
          Cancel anytime
        </div>
      </div>
    </Card>
  );
}

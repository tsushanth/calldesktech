'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useOnboarding } from '@/context/OnboardingContext';
import { WizardBlocksPicker } from '@/components/flow-builder/WizardBlocksPicker';
import { BLOCK_PRICES } from '@/lib/constants';

export default function FocusedDemoBlocksPage() {
  const router = useRouter();
  const { wizardBlocks, setWizardBlocks, transferToNumber, setTransferToNumber } = useOnboarding();

  const monthlyAddOn =
    (wizardBlocks.booking ? BLOCK_PRICES.booking : 0) +
    (wizardBlocks.transfer ? BLOCK_PRICES.transfer : 0) +
    (wizardBlocks.takeMessage ? BLOCK_PRICES.takeMessage : 0);

  const canContinue = !wizardBlocks.transfer || transferToNumber.trim().length > 0;

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-lg mx-auto">
        {/* Progress indicator */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center text-sm font-medium">1</div>
            <div className="w-12 h-1 bg-primary-600"></div>
            <div className="w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center text-sm font-medium">2</div>
            <div className="w-12 h-1 bg-gray-200"></div>
            <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm font-medium">3</div>
          </div>
        </div>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Choose what it can do</h1>
          <p className="text-gray-600">Every plan can answer FAQs — pick anything else your receptionist should handle.</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <WizardBlocksPicker
            blocks={wizardBlocks}
            onChange={setWizardBlocks}
            transferToNumber={transferToNumber}
            onTransferToNumberChange={setTransferToNumber}
          />

          <div className="mt-6 pt-6 border-t border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Estimated add-ons</p>
              <p className="text-lg font-semibold text-gray-900">+${monthlyAddOn}/mo</p>
            </div>
            <Button onClick={() => router.push('/demo/focused/phone')} disabled={!canContinue}>
              Continue
            </Button>
          </div>
          {!canContinue && (
            <p className="text-sm text-red-500 mt-2 text-right">Add a transfer number to continue.</p>
          )}
        </div>

        <div className="text-center mt-6">
          <button onClick={() => router.push('/demo/focused')} className="text-gray-500 hover:text-gray-700 text-sm">
            &larr; Back
          </button>
        </div>
      </div>
    </div>
  );
}

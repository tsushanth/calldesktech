'use client';

import { PRICING } from '@/lib/constants';
import type { WizardBlocks } from '@/lib/flowBuilder';

interface BlockDef {
  key: keyof WizardBlocks;
  label: string;
  description: string;
  icon: string;
  // Real per-event price this block actually bills at (PRICING.usage in
  // constants.ts) — this used to be a flat "+$15/mo"-style BLOCK_PRICES
  // figure with a disclaimer that it wasn't real billing yet. That was
  // confusing on its own (a real-looking price tag next to fine print
  // nobody reads) and outright wrong once per-event usage pricing actually
  // shipped — a caller who books once costs $0.007, not $15/mo regardless
  // of volume. Showing the real number removes the need for a disclaimer.
  perEventPrice: number;
  unit: string;
}

const BLOCKS: BlockDef[] = [
  { key: 'booking', label: 'Appointment booking', description: 'Collects name + preferred time and confirms a booking.', icon: '📅', perEventPrice: PRICING.usage.perBookingEvent, unit: 'booking' },
  { key: 'transfer', label: 'Transfer to a human', description: 'Caller can ask to speak to a real person on your team.', icon: '📞', perEventPrice: PRICING.usage.perTransferEvent, unit: 'transfer' },
  { key: 'takeMessage', label: 'Take a message', description: 'Captures name, callback number, and reason when no one\'s available.', icon: '📝', perEventPrice: PRICING.usage.perMessageEvent, unit: 'message' },
];

// Shared by real onboarding (produces an agent's first version) and
// dashboard settings (produces a later version on edit) — one component so
// the two surfaces can never drift into offering different toggles. FAQ/KB
// answering isn't shown here because it's the always-on baseline, not a
// choice (see buildWizardFlow).
export function WizardBlocksPicker({
  blocks,
  onChange,
  transferToNumber,
  onTransferToNumberChange,
  dark = false,
}: {
  blocks: WizardBlocks;
  onChange: (blocks: WizardBlocks) => void;
  transferToNumber: string;
  onTransferToNumberChange: (value: string) => void;
  dark?: boolean;
}) {
  const toggle = (key: keyof WizardBlocks) => onChange({ ...blocks, [key]: !blocks[key] });

  const cardBase = dark
    ? 'bg-gray-700 border-gray-600 hover:border-gray-500'
    : 'bg-white border-gray-200 hover:border-gray-300';
  const cardOn = dark ? 'bg-blue-600/20 border-blue-500' : 'border-primary-500 bg-primary-50';
  const textMuted = dark ? 'text-gray-400' : 'text-gray-500';
  const inputBase = dark
    ? 'bg-gray-700 border-gray-600 focus:border-blue-500'
    : 'bg-white border-gray-300 focus:border-primary-500';

  return (
    <div className="space-y-3">
      <div className={`flex items-center justify-between rounded-lg border p-4 ${dark ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
        <div className="flex items-center gap-3">
          <span className="text-xl">💬</span>
          <div>
            <p className="font-medium">FAQ &amp; knowledge base</p>
            <p className={`text-sm ${textMuted}`}>Answers questions about your hours, services, and pricing. Always included.</p>
          </div>
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${dark ? 'bg-green-500/20 text-green-300' : 'bg-green-100 text-green-700'}`}>
          Included
        </span>
      </div>

      {BLOCKS.map((block) => {
        const isOn = blocks[block.key];
        return (
          <div key={block.key}>
            <button
              type="button"
              onClick={() => toggle(block.key)}
              className={`w-full text-left flex items-center justify-between rounded-lg border p-4 transition ${isOn ? cardOn : cardBase}`}
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">{block.icon}</span>
                <div>
                  <p className="font-medium">{block.label}</p>
                  <p className={`text-sm ${textMuted}`}>{block.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-medium ${textMuted}`}>${block.perEventPrice.toFixed(3)}/{block.unit}</span>
                <span
                  className={`w-11 h-6 rounded-full relative transition ${isOn ? 'bg-blue-600' : dark ? 'bg-gray-600' : 'bg-gray-300'}`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${isOn ? 'translate-x-5' : ''}`}
                  />
                </span>
              </div>
            </button>
            {block.key === 'transfer' && isOn && (
              <div className="mt-2 ml-4 pl-4 border-l-2 border-blue-500/30">
                <label className={`block text-sm mb-1 ${textMuted}`}>Transfer calls to</label>
                <input
                  type="tel"
                  value={transferToNumber}
                  onChange={(e) => onTransferToNumberChange(e.target.value)}
                  placeholder="+1..."
                  className={`w-full max-w-xs border rounded-lg px-3 py-2 text-sm focus:outline-none ${inputBase}`}
                />
              </div>
            )}
          </div>
        );
      })}

      <p className={`text-xs ${textMuted} pt-1`}>
        Billed per completed action, not per attempt or per month — no charge until a caller actually uses it.
      </p>
    </div>
  );
}

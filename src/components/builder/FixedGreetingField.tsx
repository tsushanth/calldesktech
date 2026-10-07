'use client';

import { DEFAULT_FIXED_GREETING, FIXED_GREETING_EXPLAINER, FIXED_GREETING_TITLE } from '@/lib/fixedGreeting';

// The "Fixed greeting" control for the agent's first step: an on/off switch, what it does, and the exact words. Used by the single-prompt
// editor and by the entry step of a flow. The caller stores `on` and `text`; turning it off keeps the text so turning it on again restores it.
export function FixedGreetingField({ on, text, onChange }: { on: boolean; text: string; onChange: (on: boolean, text: string) => void }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3.5" data-testid="fixed-greeting">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onChange(e.target.checked, text.trim() ? text : DEFAULT_FIXED_GREETING)}
          className="mt-0.5 h-4 w-4"
          data-testid="fixed-greeting-toggle"
        />
        <span>
          <span className="text-[13px] font-medium text-gray-800">{FIXED_GREETING_TITLE}</span>
          <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">On by default</span>
          <span className="mt-1 block text-[12px] leading-relaxed text-gray-500">{FIXED_GREETING_EXPLAINER}</span>
        </span>
      </label>
      {on && (
        <div className="mt-3">
          <label className="mb-1 block text-[12px] font-medium text-gray-500">What the agent says first</label>
          <textarea
            rows={2}
            value={text}
            onChange={(e) => onChange(true, e.target.value)}
            placeholder={DEFAULT_FIXED_GREETING}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          <p className="mt-1 text-[11px] text-gray-400">You can use {'{{business_name}}'} and other variables. Leave it empty to let the AI write the greeting.</p>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { trackBuilder } from '@/lib/builderTelemetry';

const STORAGE_KEY = 'calldesk_builder_feedback_done';

function alreadyAnswered(): boolean {
  try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}
function remember(): void {
  try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch { /* private mode: ask again next time, harmless */ }
}

// One optional question, shown after a first publish or test call. Answers go to PostHog as `builder_feedback`.
// It never blocks the builder and is asked once per browser.
export default function BuilderFeedback({ trigger }: { trigger: 'publish' | 'test_call' }) {
  const [state, setState] = useState<'ask' | 'comment' | 'done'>(() => (typeof window !== 'undefined' && alreadyAnswered() ? 'done' : 'ask'));
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');

  if (state === 'done') return null;

  const finish = (sent: boolean) => {
    if (sent && rating !== null) trackBuilder('builder_feedback', { trigger, rating, comment: comment.trim().slice(0, 500) || undefined });
    remember();
    setState('done');
  };

  return (
    <div role="status" className="rounded-lg border border-gray-200 bg-white p-4 text-[13.5px] shadow-sm">
      <p className="font-medium">How did that go?</p>
      <p className="mt-0.5 text-gray-500">One tap helps us fix what is confusing. Optional.</p>
      <div className="mt-3 flex items-center gap-2" role="group" aria-label="Rating from 1 (poor) to 5 (great)">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={rating === n}
            onClick={() => { setRating(n); setState('comment'); }}
            className={`h-8 w-8 rounded-md border text-[13px] font-medium ${rating === n ? 'border-[#00122e] bg-[#00122e] text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            {n}
          </button>
        ))}
        <button type="button" onClick={() => finish(false)} className="ml-auto text-[12.5px] text-gray-500 hover:underline">No thanks</button>
      </div>
      {state === 'comment' && (
        <div className="mt-3">
          <label className="block text-[12.5px] text-gray-500" htmlFor="builder-feedback-comment">What was missing or confusing? Please leave out phone numbers and personal details.</label>
          <textarea id="builder-feedback-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={500} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-[13px]" />
          <button type="button" onClick={() => finish(true)} className="mt-2 rounded-md bg-[#00122e] px-3 py-1.5 text-[13px] font-medium text-white">Send</button>
        </div>
      )}
    </div>
  );
}

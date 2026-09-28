import type { Metadata } from 'next';
import { Container, Section, Eyebrow, SectionTitle } from '@/components/landing/primitives';
import { formatPhoneDisplay } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Start Your Trial | CallDeskTech',
  description: 'Text START to get a working AI phone agent trial set up in a few minutes.',
};

export default function TrialPage() {
  const trialNumber = process.env.TRIAL_ONBOARDING_NUMBER || '+12245061194';
  const displayNumber = formatPhoneDisplay(trialNumber);

  return (
    <div className="min-h-[calc(100vh-72px)] bg-white">
      <Section size="major">
        <div className="text-center max-w-2xl mx-auto">
          <Eyebrow>Free trial</Eyebrow>
          <SectionTitle className="mt-3">
            Text START to try it live.
          </SectionTitle>
          <p className="mt-5 text-[17px] text-gray-500">
            Trials start over SMS — no forms, no sign-up. Text{' '}
            <strong className="text-[#00122e]">START</strong> to{' '}
            <a
              href={`sms:${trialNumber}?body=START`}
              className="font-semibold text-blue-600 hover:text-blue-700"
            >
              {displayNumber}
            </a>{' '}
            and we&apos;ll have a working AI phone agent set up for you in a few
            minutes.
          </p>

          <div className="mt-10 bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-left">
            <h2 className="text-[20px] font-normal tracking-[-0.05em] text-[#00122e] mb-4">
              How it works
            </h2>
            <ol className="space-y-3 text-gray-600">
              <li className="flex gap-3">
                <span className="flex-none w-6 h-6 rounded-full bg-primary-100 text-primary-600 text-sm font-semibold flex items-center justify-center">
                  1
                </span>
                <span>
                  Text <strong className="text-[#00122e]">START</strong> to{' '}
                  <a href={`sms:${trialNumber}?body=START`} className="text-blue-600 font-medium">
                    {displayNumber}
                  </a>
                  .
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex-none w-6 h-6 rounded-full bg-primary-100 text-primary-600 text-sm font-semibold flex items-center justify-center">
                  2
                </span>
                <span>Answer a couple of quick questions about your business over text.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-none w-6 h-6 rounded-full bg-primary-100 text-primary-600 text-sm font-semibold flex items-center justify-center">
                  3
                </span>
                <span>
                  We&apos;ll text you back a live number for your AI phone agent —
                  call it to try it out.
                </span>
              </li>
            </ol>
          </div>

          <p className="mt-8 text-sm text-gray-400">
            Prefer to see it in action first?{' '}
            <a href="/demo" className="text-blue-600 underline">
              Try a live demo
            </a>{' '}
            instead.
          </p>
        </div>
      </Section>
    </div>
  );
}

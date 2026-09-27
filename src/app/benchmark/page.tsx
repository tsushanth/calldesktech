'use client';

import { useState } from 'react';
import Link from 'next/link';

const ROUND_DATA = [
  {
    round: 1,
    winner: 'Calldesk',
    calldeskTurns: 6,
    calldeskDuration: '87s',
    thunderphoneTurns: 12,
    thunderphoneDuration: '90s',
    calldeskScore: 3.4,
    thunderphoneScore: 3.0,
    summary: 'Calldesk bundled slot-filling correctly. ThunderPhone misheard "Alex" as "Alec" and double-closed.',
  },
  {
    round: 2,
    winner: 'Calldesk',
    calldeskTurns: 3,
    calldeskDuration: '62s',
    thunderphoneTurns: 10,
    thunderphoneDuration: '114s',
    calldeskScore: 4.5,
    thunderphoneScore: 3.3,
    summary: 'Calldesk completed in 3 turns via compound ask. ThunderPhone asked name/phone before knowing purpose, used fake hold sequence.',
  },
  {
    round: 3,
    winner: 'Calldesk',
    calldeskTurns: 3,
    calldeskDuration: '55s',
    thunderphoneTurns: 14,
    thunderphoneDuration: '162s',
    calldeskScore: 4.5,
    thunderphoneScore: 2.3,
    summary: 'Calldesk clean 55-second booking. ThunderPhone failed twice on "I\'m flexible" response, had unfilled template, 5.2s latency spike.',
  },
];

const RETELL_COMPARISON = {
  metric: 'Cost per minute (default voice)',
  calldesk: '$0.10',
  retell: '~$0.16',
  note: 'Retell figure is observed blended cost from an actual Retell account billing dashboard, not a published price sheet.',
};

const THUNDERPHONE_COMPARISON = {
  metric: 'Conversation quality (mystery-shopper benchmark)',
  calldesk: 'Won 3 of 3',
  thunderphone: 'Lost 3 of 3',
  note: 'Blind LLM-judge evaluation on appointment-booking scenario. Full transcripts and methodology published on GitHub.',
};

export default function BenchmarkPage() {
  const [activeRound, setActiveRound] = useState<number | null>(null);
  const [showRetell, setShowRetell] = useState(false);

  return (
    <main className="bg-white">
      {/* Hero */}
      <section className="py-14 px-4 md:py-20 border-b border-gray-100">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-[40px] font-normal leading-[1.02] tracking-[-0.05em] text-[#00122e] md:text-[64px]">
            Independently measured.
          </h1>
          <p className="mx-auto mt-5 max-w-[600px] text-[17px] leading-[1.5] text-gray-500">
            We publish our benchmarks so you can verify them. Same AI mystery shopper calls every system, scored blind by Claude.
          </p>
        </div>
      </section>

      {/* High-level comparison */}
      <section className="py-12 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex gap-2 mb-6 justify-center">
            <button
              onClick={() => setShowRetell(false)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                !showRetell ? 'bg-[#00122e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              vs ThunderPhone
            </button>
            <button
              onClick={() => setShowRetell(true)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                showRetell ? 'bg-[#00122e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              vs Retell
            </button>
          </div>

          <div className="rounded-2xl bg-[#f4f4fa] p-6 md:p-8">
            {showRetell ? (
              <>
                <h3 className="text-center text-[15px] font-semibold text-[#1a1d29] mb-1">Cost comparison</h3>
                <p className="text-center text-[12.5px] text-gray-400 mb-5">{RETELL_COMPARISON.note}</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl bg-[#00122e] p-4 text-center">
                    <p className="text-[12px] font-medium text-white/70 mb-1">Calldesk (default voice)</p>
                    <p className="text-[28px] font-semibold tracking-[-0.03em] text-white">{RETELL_COMPARISON.calldesk}</p>
                    <p className="text-[12px] text-white/70">per minute</p>
                  </div>
                  <div className="rounded-xl bg-white p-4 text-center">
                    <p className="text-[12px] font-medium text-gray-500 mb-1">Retell (observed blended avg)</p>
                    <p className="text-[28px] font-semibold tracking-[-0.03em] text-gray-700">{RETELL_COMPARISON.retell}</p>
                    <p className="text-[12px] text-gray-500">per minute</p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-center text-[15px] font-semibold text-[#1a1d29] mb-1">Conversation quality</h3>
                <p className="text-center text-[12.5px] text-gray-400 mb-5">{THUNDERPHONE_COMPARISON.note}</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl bg-[#00122e] p-4 text-center">
                    <p className="text-[12px] font-medium text-white/70 mb-1">Calldesk</p>
                    <p className="text-[28px] font-semibold tracking-[-0.03em] text-white">{THUNDERPHONE_COMPARISON.calldesk}</p>
                    <p className="text-[12px] text-white/70">rounds</p>
                  </div>
                  <div className="rounded-xl bg-white p-4 text-center">
                    <p className="text-[12px] font-medium text-gray-500 mb-1">ThunderPhone</p>
                    <p className="text-[28px] font-semibold tracking-[-0.03em] text-gray-700">{THUNDERPHONE_COMPARISON.thunderphone}</p>
                    <p className="text-[12px] text-gray-500">rounds</p>
                  </div>
                </div>
                <div className="mt-4 text-center">
                  <Link
                    href="https://github.com/tsushanth/voice-agent-bench"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] text-[#00122e] font-medium underline underline-offset-4 hover:text-blue-600"
                  >
                    See full transcripts and methodology →
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ThunderPhone detail */}
      {!showRetell && (
        <section className="py-12 px-4 border-t border-gray-100">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-[28px] font-normal tracking-[-0.04em] text-[#00122e] mb-2">
              ThunderPhone benchmark details
            </h2>
            <p className="text-[14px] text-gray-500 mb-8">
              3 rounds, same AI shopper, blind judge. Scenario: book a medical appointment for tomorrow afternoon.
            </p>

            {/* Round cards */}
            <div className="space-y-4">
              {ROUND_DATA.map((r) => (
                <div
                  key={r.round}
                  className={`rounded-xl border transition cursor-pointer ${
                    activeRound === r.round
                      ? 'border-[#00122e] bg-[#00122e] text-white'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setActiveRound(activeRound === r.round ? null : r.round)}
                >
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`text-[13px] font-semibold px-2.5 py-1 rounded-full ${
                        activeRound === r.round
                          ? 'bg-white/20 text-white'
                          : 'bg-green-50 text-green-700'
                      }`}>
                        Round {r.round}
                      </span>
                      <span className="text-[14px] font-medium">
                        {r.winner} wins
                      </span>
                    </div>
                    <span className="text-[12px] text-gray-400">
                      {r.calldeskDuration} vs {r.thunderphoneDuration}
                    </span>
                  </div>
                  {activeRound === r.round && (
                    <div className="px-4 pb-4">
                      <p className="text-[13px] leading-[1.6] opacity-90 mb-3">
                        {r.summary}
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg bg-white/10 p-3">
                          <p className="text-[11px] uppercase tracking-wider opacity-60 mb-1">Calldesk</p>
                          <p className="text-[20px] font-semibold">{r.calldeskTurns} turns</p>
                          <p className="text-[12px] opacity-70">Judge score: {r.calldeskScore}/5</p>
                        </div>
                        <div className="rounded-lg bg-white/10 p-3">
                          <p className="text-[11px] uppercase tracking-wider opacity-60 mb-1">ThunderPhone</p>
                          <p className="text-[20px] font-semibold">{r.thunderphoneTurns} turns</p>
                          <p className="text-[12px] opacity-70">Judge score: {r.thunderphoneScore}/5</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Aggregate */}
            <div className="mt-8 rounded-xl bg-[#f4f4fa] p-5">
              <h3 className="text-[14px] font-semibold text-[#1a1d29] mb-3">What this measures</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[13px]">
                <div>
                  <p className="font-medium text-[#1a1d29] mb-1">Turn efficiency</p>
                  <p className="text-gray-500">Fewer back-and-forth exchanges to complete the same task. Compound asks (name + time + phone in one turn) vs. asking one at a time.</p>
                </div>
                <div>
                  <p className="font-medium text-[#1a1d29] mb-1">Error recovery</p>
                  <p className="text-gray-500">Does the agent correctly capture and confirm name, phone number, and time? Does it recover gracefully from mishears?</p>
                </div>
                <div>
                  <p className="font-medium text-[#1a1d29] mb-1">Naturalness</p>
                  <p className="text-gray-500">Does it sound like a real human receptionist, or like a menu-driven IVR?</p>
                </div>
                <div>
                  <p className="font-medium text-[#1a1d29] mb-1">Response latency</p>
                  <p className="text-gray-500">Time from end of caller speech to start of agent reply. Measured from Twilio recordings, not simulated.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="py-14 px-4 border-t border-gray-100">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-[28px] font-normal tracking-[-0.04em] text-[#00122e] mb-3">
            Run the benchmark yourself
          </h2>
          <p className="text-[14px] text-gray-500 mb-6 max-w-[480px] mx-auto">
            The full evaluation harness — transcripts, judge rubric, reproduction instructions — is open source.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="https://github.com/tsushanth/voice-agent-bench"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-[#00122e] text-white text-[14px] font-medium hover:bg-[#00122e]/90 transition"
            >
              View benchmark on GitHub
            </Link>
            <Link
              href="/demo"
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl border border-gray-200 text-[#00122e] text-[14px] font-medium hover:bg-gray-50 transition"
            >
              Try a demo call
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

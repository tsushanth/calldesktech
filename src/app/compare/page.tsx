import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, Section } from '@/components/landing/primitives';
import { COMPETITORS } from '@/lib/compareData';
import { LIVE_RANGE } from '@/lib/pricingCopy';

export const metadata: Metadata = {
  title: 'Compare | CallDeskTech',
  description: 'How CallDeskTech stacks up against Retell, ThunderPhone, and a dozen other voice AI platforms, feature by feature and call by call.',
};

const MORE_PAGES = [
  ...COMPETITORS.map((c) => ({ href: `/compare/${c.slug}`, name: c.shortName, line: c.stats[0] })),
  {
    href: '/compare/build-your-own',
    name: 'Building your own',
    line: { label: 'What it actually takes', us: 'LiveKit Agents & Pipecat, compared honestly' },
  },
];

const PAGES = [
  {
    href: '/compare/retell',
    name: 'Retell',
    line: 'A feature-by-feature look at the builder, pricing, and real test calls.',
    stat: LIVE_RANGE,
    statLabel: 'per minute by tier — Retell blends to $0.07–$0.31',
  },
  {
    href: '/compare/thunderphone',
    name: 'ThunderPhone',
    line: 'A live benchmark: same caller, same goal, same judge.',
    stat: '3–0',
    statLabel: 'mystery-shopper calls won, zero lost',
  },
];

export default function ComparePage() {
  return (
    <main>
      <Container className="pt-16 pb-10 md:pt-24">
        <h1 className="max-w-[760px] text-[40px] font-normal leading-[1.02] tracking-[-0.05em] text-[#00122e] md:text-[64px]">
          How we compare.
        </h1>
        <p className="mt-6 max-w-[560px] text-[17px] leading-[1.5] text-gray-500">
          We ran the calls, read the docs, and wrote down what we found — including where the other side wins. Pick a comparison below.
        </p>
      </Container>

      <Container className="pb-24">
        <div className="grid gap-5 md:grid-cols-2">
          {PAGES.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="group rounded-xl border border-gray-200 bg-white p-8 transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-sm"
            >
              <p className="text-[13px] font-medium text-gray-400">vs {p.name}</p>
              <p className="mt-3 text-[40px] font-normal leading-none tracking-[-0.03em] text-[#00122e]">{p.stat}</p>
              <p className="mt-2 text-[13px] leading-[1.4] text-gray-500">{p.statLabel}</p>
              <p className="mt-6 text-[15px] leading-[1.5] text-gray-600">{p.line}</p>
              <p className="mt-5 text-[13px] font-medium text-[#00122e] underline underline-offset-4 group-hover:text-blue-600">
                See the comparison
              </p>
            </Link>
          ))}
        </div>
      </Container>

      <Section size="secondary" className="pt-0 pb-24">
        <h2 className="text-[24px] font-normal leading-[1.1] tracking-[-0.03em] text-[#00122e]">
          More comparisons.
        </h2>
        <p className="mt-3 max-w-[560px] text-[14px] leading-[1.5] text-gray-500">
          Built from public pricing pages and documentation, not head-to-head calls &mdash; each page says exactly how it was sourced.
        </p>
        <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-100 sm:grid-cols-2 lg:grid-cols-3">
          {MORE_PAGES.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="group bg-white p-6 transition-colors duration-200 hover:bg-[#f8f8fb]"
            >
              <p className="text-[14.5px] font-medium text-[#00122e] group-hover:text-blue-600">vs {p.name}</p>
              <p className="mt-2 text-[13px] leading-[1.4] text-gray-500">{p.line.us}</p>
            </Link>
          ))}
        </div>
      </Section>
    </main>
  );
}

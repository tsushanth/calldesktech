import { Container, Section, PrimaryButton, SecondaryButton } from '@/components/landing/primitives';
import type { CompetitorEntry, Verdict } from '@/lib/compareData';

const VERDICT_LABEL: Record<Verdict, string> = {
  ahead: 'Ahead',
  have: 'Have',
  partial: 'Partial',
  gap: 'Gap',
  neither: 'Different',
};

const VERDICT_STYLE: Record<Verdict, string> = {
  ahead: 'bg-blue-50 text-blue-700',
  have: 'bg-[#f0f0f8] text-[#00122e]',
  partial: 'bg-amber-50 text-amber-700',
  gap: 'bg-gray-100 text-gray-500',
  neither: 'bg-gray-100 text-gray-400',
};

export function CompetitorTemplate({ entry }: { entry: CompetitorEntry }) {
  const groups = Array.from(new Set(entry.rows.map((r) => r.group)));

  return (
    <main>
      <Container className="pt-16 pb-14 md:pt-24">
        <h1 className="max-w-[760px] text-[40px] font-normal leading-[1.02] tracking-[-0.05em] text-[#00122e] md:text-[64px]">
          {entry.heroHeadline}
        </h1>
        <p className="mt-6 max-w-[580px] text-[17px] leading-[1.5] text-gray-500">
          {entry.heroSub}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <PrimaryButton href="/demo" size="lg">Try a free demo call</PrimaryButton>
          <SecondaryButton href="/compare" size="lg">See all comparisons</SecondaryButton>
        </div>
      </Container>

      <Container className="pb-16">
        <div className="grid gap-4 sm:grid-cols-3">
          {entry.stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-gray-200 p-6">
              <p className="text-[13px] font-medium text-gray-400">{s.label}</p>
              <div className="mt-3 space-y-1">
                <p className="text-[17px] leading-[1.3] font-normal tracking-[-0.01em] text-[#00122e]">{s.us}</p>
                <p className="text-[13px] leading-[1.3] text-gray-400">vs {s.them}</p>
              </div>
            </div>
          ))}
        </div>
      </Container>

      <Section size="secondary" className="pt-0 pb-16 md:pb-20">
        <h2 className="text-[32px] md:text-[44px] font-normal leading-[1.04] tracking-[-0.045em] text-[#00122e]">
          Point by point.
        </h2>
        <p className="mt-4 max-w-[560px] text-[15px] leading-[1.5] text-gray-500">
          Where {entry.shortName} is ahead of us, or simply doing something different, we&rsquo;ve said so.
        </p>

        <div className="mt-10 space-y-10">
          {groups.map((group) => (
            <div key={group}>
              <h3 className="text-[15px] font-semibold text-[#1a1d29]">{group}</h3>
              <div className="mt-3 divide-y divide-gray-100 border-t border-gray-100">
                {entry.rows
                  .filter((r) => r.group === group)
                  .map((r) => (
                    <div key={r.item} className="grid gap-2 py-5 sm:grid-cols-[200px_84px_1fr] sm:items-start sm:gap-6">
                      <p className="text-[14.5px] font-medium text-[#1a1d29]">{r.item}</p>
                      <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[12px] font-medium ${VERDICT_STYLE[r.verdict]}`}>
                        {VERDICT_LABEL[r.verdict]}
                      </span>
                      <div>
                        <p className="text-[14px] leading-[1.5] text-gray-700">
                          <span className="text-gray-400">Us: </span>{r.us}
                        </p>
                        <p className="mt-1 text-[14px] leading-[1.5] text-gray-500">
                          <span className="text-gray-400">{entry.shortName}: </span>{r.them}
                        </p>
                        {r.note && (
                          <p className="mt-1 text-[13px] leading-[1.5] text-gray-400">{r.note}</p>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-10 max-w-[640px] text-[12.5px] leading-[1.5] text-gray-400">{entry.caveat}</p>
      </Section>

      <Container className="py-20 md:py-24 text-center">
        <h2 className="text-[32px] md:text-[44px] font-normal leading-[1.04] tracking-[-0.045em] text-[#00122e]">
          Hear it yourself.
        </h2>
        <p className="mx-auto mt-4 max-w-[480px] text-[16px] leading-[1.5] text-gray-500">
          Place a real call to one of our demo agents. No account required.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <PrimaryButton href="/demo" size="lg">Try a free demo call</PrimaryButton>
          <SecondaryButton href="/compare" size="lg">See all comparisons</SecondaryButton>
        </div>
      </Container>
    </main>
  );
}

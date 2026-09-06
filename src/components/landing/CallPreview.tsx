import { Container, PrimaryButton } from './primitives';
import { Reveal } from './Reveal';

/**
 * Product illustration occupying the structural slot where the reference site
 * runs a large full-bleed product banner (measured h=672/864 at this position).
 *
 * This is a mock of the product's OWN demo flow — clearly a product
 * illustration, deliberately not framed as a real customer interaction.
 */

const TRANSCRIPT: { who: 'caller' | 'agent'; text: string }[] = [
  { who: 'agent', text: 'Thanks for calling — how can I help today?' },
  { who: 'caller', text: 'Do you have anything open Thursday afternoon?' },
  { who: 'agent', text: 'I have 2:15 and 4:30 on Thursday. Which works better?' },
  { who: 'caller', text: "Let's do 2:15." },
  { who: 'agent', text: "Booked for Thursday at 2:15. You'll get a text confirmation." },
];

export function CallPreview() {
  return (
    <section className="py-20 md:py-[120px]">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <Reveal>
            <div>
              <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-blue-600">
                What a call sounds like
              </p>
              <h2 className="mt-6 text-[30px] font-semibold leading-[1.05] tracking-[-0.03em] text-[#1a1d29] md:text-[37.5px]">
                It books the appointment
                <br />
                while the caller is still talking.
              </h2>
              <p className="mt-5 max-w-[460px] text-[16px] leading-[1.55] text-gray-500">
                Real availability from your calendar, spoken back in the same
                turn — no hold music, no callback promise, no transcription
                queue. This is the booking block running end to end.
              </p>
              <div className="mt-8">
                <PrimaryButton href="/demo">Hear it yourself</PrimaryButton>
              </div>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className="rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
              <div className="rounded-xl bg-[#f7f8fa] p-5 md:p-7">
                <div className="mb-6 flex items-center gap-2.5 border-b border-gray-200 pb-4">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                  </span>
                  <span className="text-[12px] font-medium tracking-[-0.01em] text-[#1a1d29]">
                    Live call
                  </span>
                  <span className="ml-auto text-[12px] tabular-nums text-gray-400">
                    00:24
                  </span>
                </div>

                <ul className="space-y-3.5">
                  {TRANSCRIPT.map((line, i) => (
                    <li
                      key={i}
                      className={
                        line.who === 'agent'
                          ? 'flex justify-start'
                          : 'flex justify-end'
                      }
                    >
                      <div
                        className={`max-w-[85%] rounded-xl px-4 py-2.5 text-[14px] leading-[1.45] ${
                          line.who === 'agent'
                            ? 'bg-blue-50 text-blue-900 ring-1 ring-inset ring-blue-100'
                            : 'bg-white text-[#1a1d29] ring-1 ring-inset ring-gray-200'
                        }`}
                      >
                        {line.text}
                      </div>
                    </li>
                  ))}
                </ul>

                <p className="mt-6 border-t border-gray-200 pt-4 text-[12px] text-gray-400">
                  Illustration of the booking building block. Try the live demo
                  for a real call.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

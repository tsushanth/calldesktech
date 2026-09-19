import Link from 'next/link';
import { Container, PrimaryButton } from './primitives';
import { Reveal } from './Reveal';
import { ORB } from './gradient';

/**
 * Live-demo module, in the arrangement the reference site uses: a white card
 * with an orb and use-case chips on the left, a pale panel on the right. The
 * right panel is an illustration of our booking flow, deliberately not framed
 * as a real customer call.
 */

const TRANSCRIPT: { who: 'caller' | 'agent'; text: string }[] = [
  { who: 'agent', text: 'Thanks for calling — how can I help today?' },
  { who: 'caller', text: 'Do you have anything open Thursday afternoon?' },
  { who: 'agent', text: 'I have 2:15 and 4:30 on Thursday. Which works better?' },
  { who: 'caller', text: "Let's do 2:15." },
  { who: 'agent', text: "Booked for Thursday at 2:15. You'll get a text confirmation." },
];

const USE_CASES = ['Receptionist', 'Appointment booking', 'Lead qualification', 'Customer service', 'Collections', 'Reminders'];

export function CallPreview() {
  return (
    <section id="demo" className="py-16 md:py-[100px]">
      <Container>
        <Reveal>
          <h2 className="mx-auto max-w-[760px] text-center text-[36px] font-normal leading-[1.02] tracking-[-0.05em] text-[#00122e] md:text-[60px]">
            Hear what a call
            <br />
            sounds like.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-4 md:mt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <Reveal>
            <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-[#e4e4f0] bg-white px-6 py-12">
              <span aria-hidden className="block h-[220px] w-[220px] rounded-full md:h-[280px] md:w-[280px]" style={{ background: ORB }} />
              <ul className="mt-10 flex max-w-[460px] flex-wrap justify-center gap-2">
                {USE_CASES.map((u) => (
                  <li key={u}>
                    <Link
                      href="/demo"
                      className="inline-block rounded-md bg-[#f0f0f8] px-3.5 py-2 text-[13px] font-medium text-[#00122e] transition-colors hover:bg-[#e6e6f2]"
                    >
                      {u}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className="h-full rounded-2xl bg-[#f4f4fa] p-6 md:p-9">
              <p className="max-w-[420px] text-[24px] font-normal leading-[1.12] tracking-[-0.04em] text-[#00122e] md:text-[30px]">
                It books the appointment while the caller is still talking.
              </p>
              <div className="mt-6 flex items-center gap-2.5 border-b border-[#e0e0ee] pb-4">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                </span>
                <span className="text-[12px] font-medium text-[#00122e]">Live call</span>
                <span className="ml-auto text-[12px] tabular-nums text-gray-400">00:24</span>
              </div>
              <ul className="mt-5 space-y-3">
                {TRANSCRIPT.map((line, i) => (
                  <li key={i} className={line.who === 'agent' ? 'flex justify-start' : 'flex justify-end'}>
                    <div
                      className={`max-w-[85%] rounded-xl px-4 py-2.5 text-[14px] leading-[1.45] ${
                        line.who === 'agent' ? 'bg-[#00122e] text-white' : 'bg-white text-[#00122e]'
                      }`}
                    >
                      {line.text}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-7 flex flex-wrap items-center gap-4">
                <PrimaryButton href="/demo">Hear it yourself</PrimaryButton>
                <p className="text-[12px] text-gray-500">Illustration of the booking flow. The live demo is a real call.</p>
              </div>
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

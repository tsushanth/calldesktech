import { Card, CardBody, CardTitle, Eyebrow, PrimaryButton, SecondaryButton, Section, SectionLead, SectionTitle } from './primitives';
import { Reveal } from './Reveal';
import { UseCasePicker, type UseCaseGroup } from './UseCases';

// ------------------------------------------------------------------ templates

export function UseCases({ groups, total }: { groups: UseCaseGroup[]; total: number }) {
  return (
    <Section id="templates" size="secondary">
      <Reveal>
        <div className="max-w-[640px]">
          <Eyebrow>Templates</Eyebrow>
          <SectionTitle className="mt-6">Start from {total} ready-made phone agents.</SectionTitle>
          <SectionLead>
            Each template is a complete conversation flow, not a prompt: the questions to ask, the branches, the hand-offs. Pick the closest one and change what you need.
          </SectionLead>
        </div>
      </Reveal>
      <UseCasePicker groups={groups} />
    </Section>
  );
}

// --------------------------------------------------------------------- studio

const STAGES = [
  { title: 'Build', body: 'Draw the conversation as a flow: steps, arrows and the condition for each. Reuse pieces across agents as subflows.' },
  { title: 'Test', body: 'Call yourself from the builder, or run simulated callers against a saved script before anyone real dials in.' },
  { title: 'Deploy', body: 'Publish a version, point a phone number at it, and roll back by restoring an earlier one. Live calls never change under you.' },
  { title: 'Review', body: 'Every call keeps its transcript, outcome and recording. Quality scores flag the calls worth listening to.' },
  { title: 'Improve', body: 'Compare two versions side by side, see what changed, and watch call volume and outcomes move.' },
];

export function Studio() {
  return (
    <Section id="platform" size="secondary">
      <Reveal>
        <div className="max-w-[640px]">
          <Eyebrow>Platform</Eyebrow>
          <SectionTitle className="mt-6">Build, test and run agents in one place.</SectionTitle>
          <SectionLead>No code needed to ship a working agent, and nothing hidden from you when you want to go deeper.</SectionLead>
        </div>
      </Reveal>
      <Reveal delay={80}>
        <figure className="mt-12 overflow-hidden rounded-2xl border border-gray-200 bg-white p-2 shadow-sm md:mt-14">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/landing/flow-builder.png"
            alt="The visual flow builder showing a multi-department router agent: identify what the caller needs, collect details, confirm, then transfer to sales, billing or support"
            width={2260}
            height={830}
            loading="lazy"
            className="h-auto w-full rounded-xl"
          />
          <figcaption className="px-3 pb-2 pt-3 text-[13px] text-gray-500">The Multi-Department Router template in the flow builder. Every step and every arrow is editable.</figcaption>
        </figure>
      </Reveal>
      <dl className="mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-5">
        {STAGES.map((s, i) => (
          <Reveal key={s.title} delay={i * 50}>
            <div className="border-t border-gray-200 pt-4">
              <dt className="text-[16px] font-semibold tracking-[-0.02em] text-[#1a1d29]">{s.title}</dt>
              <dd className="mt-1.5 text-[14.5px] leading-[1.5] text-gray-500">{s.body}</dd>
            </div>
          </Reveal>
        ))}
      </dl>
    </Section>
  );
}

// -------------------------------------------------------------- contact center

const FEATURES = [
  { title: 'Call transfer', body: 'Hand the caller to a person with a spoken line you write. We record how long the wait was and whether anyone picked up.' },
  { title: 'Agent-to-agent hand-off', body: 'Move a live call to another agent without hanging up. The conversation so far and the details collected carry over.' },
  { title: 'Outbound campaigns', body: 'Upload a list and dial it in a batch, paced to carrier limits so your numbers stay healthy.' },
  { title: 'Phone menus', body: 'Press keypad digits to work through another company’s phone menu, then carry on the conversation with a person.' },
  { title: 'Voicemail handling', body: 'Detect an answering machine on outbound calls, then hang up or leave the message you wrote.' },
  { title: 'Text during the call', body: 'Send the caller a confirmation text mid-call, from your number.' },
  { title: 'Secure card payments', body: 'Take a card payment on the keypad through Twilio, so card numbers are entered by the caller and never spoken aloud.' },
  { title: 'Post-call analysis', body: 'Define the fields you care about (was it booked, why not, how did the caller feel) and get them filled in for every call.' },
  { title: 'Business-hours routing', body: 'Route differently in and out of hours, in your own time zone, with daylight saving handled.' },
];

export function ContactCenter() {
  return (
    <Section id="calling" size="secondary">
      <Reveal>
        <div className="max-w-[640px]">
          <Eyebrow>Calling features</Eyebrow>
          <SectionTitle className="mt-6">More than answering the phone.</SectionTitle>
          <SectionLead>The parts of a real call centre that agents usually fall short on, built in and testable one at a time.</SectionLead>
        </div>
      </Reveal>
      <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 3) * 60}>
            <Card className="h-full">
              <CardTitle>{f.title}</CardTitle>
              <CardBody>{f.body}</CardBody>
            </Card>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------- developers

const CURL = `curl -X POST \\
  https://calldesk.tech/api/v1/tenants/$TENANT/agents/from-template \\
  -H "Authorization: Bearer $CALLDESK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"templateId": "medical-receptionist"}'`;

const MCP = `claude mcp add calldesktech \\
  --env CALLDESK_API_KEY=cdk_live_... \\
  -- npx -y calldesktech-mcp`;

function Code({ label, children }: { label: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-[12px] font-medium text-gray-500">{label}</div>
      <pre className="overflow-x-auto p-4 text-[12px] leading-[1.6] text-[#1a1d29]"><code>{children}</code></pre>
    </div>
  );
}

export function Developers() {
  return (
    <Section id="developers" size="secondary">
      <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
        <Reveal className="min-w-0">
          <div>
            <Eyebrow>Developers</Eyebrow>
            <SectionTitle className="mt-6">Everything in the app is also an API.</SectionTitle>
            <SectionLead>
              Create agents, publish versions, place calls and read transcripts from your own code, with keys you can revoke and scope to one workspace.
            </SectionLead>
            <ul className="mt-8 space-y-4 text-[15px] leading-[1.5] text-gray-500">
              <li><span className="font-semibold text-[#1a1d29]">Versioned REST API</span> with an OpenAPI description and interactive docs.</li>
              <li><span className="font-semibold text-[#1a1d29]">Signed webhooks</span> when a call starts, completes, is analysed or is transferred.</li>
              <li><span className="font-semibold text-[#1a1d29]">MCP server</span> so an AI assistant in your editor can manage agents for you.</li>
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <PrimaryButton href="/docs">Read the API docs</PrimaryButton>
              <SecondaryButton href="/api/v1/openapi.json">OpenAPI file</SecondaryButton>
            </div>
          </div>
        </Reveal>
        <Reveal delay={100} className="min-w-0">
          <div className="space-y-4">
            <Code label="Create an agent from a template">{CURL}</Code>
            <Code label="Add it to your editor over MCP">{MCP}</Code>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------- trust

const TRUST = [
  { title: 'Your workspace, your data', body: 'Every request is checked against the workspace it belongs to. An API key works in exactly one workspace and cannot manage other keys.' },
  { title: 'Keys stored as hashes', body: 'API keys are shown once and stored only as a hash. Revoke one and it stops working immediately.' },
  { title: 'Verifiable webhooks', body: 'Each delivery is signed with a secret unique to your endpoint, so you can confirm it came from us.' },
  { title: 'Recording you control', body: 'Choose whether calls are recorded and how long recordings are kept. Expired recordings are removed automatically.' },
  { title: 'Protected numbers', body: 'Outbound calling is rate-limited per workspace and across the platform, which protects your numbers from being flagged.' },
];

export function Trust() {
  return (
    <Section id="trust" size="secondary">
      <Reveal>
        <div className="max-w-[640px]">
          <Eyebrow>Security and control</Eyebrow>
          <SectionTitle className="mt-6">Built so a mistake can&apos;t reach your callers.</SectionTitle>
        </div>
      </Reveal>
      <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {TRUST.map((t, i) => (
          <Reveal key={t.title} delay={(i % 3) * 60}>
            <Card className="h-full" interactive={false}>
              <CardTitle>{t.title}</CardTitle>
              <CardBody>{t.body}</CardBody>
            </Card>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

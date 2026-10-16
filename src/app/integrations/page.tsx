import { SiteHeader } from '@/components/landing/SiteHeader';
import { SiteFooter } from '@/components/landing/Closing';
import { Container, Eyebrow } from '@/components/landing/primitives';

export const metadata = {
  title: 'Calldesk integrations',
  description: 'Connect Calldesk to your stack: REST API, MCP server, HighLevel workflows, and speech API plugins for Vapi, LiveKit, Pipecat, n8n and the Vercel AI SDK.',
};

const H2 = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <h2 id={id} className="mt-14 scroll-mt-[96px] text-[24px] font-semibold tracking-[-0.02em]">{children}</h2>
);
const P = ({ children }: { children: React.ReactNode }) => <p className="mt-3 max-w-[680px] text-[15px] leading-[1.6] text-gray-600">{children}</p>;

type Item = { name: string; body: string; href: string; cta: string; external?: boolean };

function Grid({ items }: { items: Item[] }) {
  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      {items.map((i) => (
        <a
          key={i.name}
          href={i.href}
          {...(i.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="block rounded-xl border border-gray-200 bg-white p-5 transition hover:border-gray-300"
        >
          <p className="text-[16px] font-semibold tracking-[-0.01em]">{i.name}</p>
          <p className="mt-2 text-[14px] leading-[1.55] text-gray-600">{i.body}</p>
          <p className="mt-3 text-[13.5px] font-medium underline">{i.cta}</p>
        </a>
      ))}
    </div>
  );
}

const SPEECH = 'https://readaloudai.org/integrations';

const BUILD: Item[] = [
  { name: 'REST API', body: 'Create and publish agents, place calls, read transcripts and summaries. The same routes the dashboard uses, authenticated with an API key.', href: '/docs', cta: 'API reference' },
  { name: 'OpenAPI file', body: 'The machine-readable description of the API, for client generators and agent tooling.', href: '/api/v1/openapi.json', cta: 'openapi.json' },
  { name: 'MCP server', body: 'Let an AI assistant build, test and manage your agents through the Model Context Protocol.', href: '/docs#mcp', cta: 'MCP setup' },
];

const TOOLS: Item[] = [
  { name: 'HighLevel', body: 'Two workflows: one places a Calldesk call for a contact, one receives the result and updates the contact. Uses HighLevel’s built-in Custom Webhook action and Inbound Webhook trigger.', href: '/docs/highlevel', cta: 'HighLevel guide' },
  { name: 'Webhooks', body: 'Call-completed events can arrive as a flat, single-level JSON object, which suits workflow tools such as HighLevel, Zapier and Make.', href: '/docs', cta: 'Webhook reference' },
];

const SPEECH_ITEMS: Item[] = [
  { name: 'Vapi', body: 'Use ReadAloud as a custom voice in Vapi: Vapi sends the text to your server URL and plays back the audio.', href: `${SPEECH}/vapi`, cta: 'Vapi setup', external: true },
  { name: 'LiveKit Agents', body: 'A text-to-speech plugin for LiveKit Agents, published as livekit-plugins-readaloud.', href: `${SPEECH}/livekit-agents`, cta: 'LiveKit setup', external: true },
  { name: 'Pipecat', body: 'A text-to-speech service for Pipecat voice agents, published as pipecat-readaloud.', href: `${SPEECH}/pipecat`, cta: 'Pipecat setup', external: true },
  { name: 'Vercel AI SDK', body: 'A speech provider for the Vercel AI SDK, published as ai-sdk-provider-readaloud.', href: `${SPEECH}/vercel-ai-sdk`, cta: 'AI SDK setup', external: true },
  { name: 'n8n', body: 'A community node for n8n workflows, published as n8n-nodes-readaloud.', href: `${SPEECH}/n8n`, cta: 'n8n setup', external: true },
  { name: 'OpenAI and ElevenLabs SDKs', body: 'The API answers the OpenAI audio.speech route and the ElevenLabs text-to-speech routes, so code written for those SDKs can point at it.', href: `${SPEECH}/openai-sdk`, cta: 'SDK setup', external: true },
];

const MOVE: Item[] = [
  { name: 'From Vapi', body: 'A checklist for moving a phone agent from Vapi to Calldesk.', href: '/migrate/from-vapi', cta: 'Migration checklist' },
  { name: 'From Retell', body: 'A checklist for moving a phone agent from Retell to Calldesk.', href: '/migrate/from-retell-ai', cta: 'Migration checklist' },
  { name: 'From Bland', body: 'A checklist for moving a phone agent from Bland to Calldesk.', href: '/migrate/from-bland-ai', cta: 'Migration checklist' },
];

export default function IntegrationsPage() {
  return (
    <div className="min-h-screen bg-white text-[#00122e]">
      <SiteHeader />
      <main className="pb-24 pt-[120px] md:pt-[136px]">
        <Container>
          <div className="max-w-[720px]">
            <Eyebrow>Integrations</Eyebrow>
            <h1 className="mt-6 text-[36px] font-semibold leading-[1.05] tracking-[-0.03em] md:text-[48px]">Connect Calldesk to your stack</h1>
            <P>
              Build on the API, connect call results to the tools you already use, bring Calldesk speech to a voice framework, or move an agent over from another platform.
              Phone agents start at 2 cents a minute, with the voice and language model included.
            </P>
          </div>

          <div className="max-w-[900px]">
            <H2 id="build">Build on the API</H2>
            <Grid items={BUILD} />

            <H2 id="tools">Connect your tools</H2>
            <Grid items={TOOLS} />

            <H2 id="vapi">Speech for Vapi, LiveKit, Pipecat and more</H2>
            <P>
              If you run your own voice stack, the ReadAloud speech API (text-to-speech from $0.004 per 1,000 characters) plugs into the frameworks below.
              These setups are documented on readaloudai.org.
            </P>
            <Grid items={SPEECH_ITEMS} />

            <H2 id="move">Moving from another platform</H2>
            <Grid items={MOVE} />

            <P>
              Looking for something that is not listed? Email <a className="underline" href="mailto:support@calldesk.tech">support@calldesk.tech</a> and tell us what you are connecting.
            </P>
          </div>
        </Container>
      </main>
      <SiteFooter />
    </div>
  );
}

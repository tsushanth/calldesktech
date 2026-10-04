import { buildOpenApi } from '@/lib/openapi';
import { MCP_TOOL_GROUPS } from '@/lib/mcp/toolDocs';
import { getModelCatalog } from '@/lib/modelCatalog';
import { EXPERT_BACKUP_ROUTING_MODE } from '@/lib/expertBackup';
import { PRICING_TIERS, ADD_ONS, CARRIER_NOTE, INCLUDED_ON_ALL } from '@/lib/pricingTiers';
import { EXPERT_BACKUP_LINE, PHONE_NUMBERS_LINE, workedExample } from '@/lib/pricingCopy';
import { TierRatingRows } from '@/components/pricing/PricingParts';
import { SiteHeader } from '@/components/landing/SiteHeader';
import { SiteFooter } from '@/components/landing/Closing';
import { Container, Eyebrow, PrimaryButton, SecondaryButton } from '@/components/landing/primitives';

export const metadata = { title: 'API reference — CallDeskTech' };

type Op = {
  tags: string[]; summary: string; description?: string;
  parameters?: { name: string; in: string; description?: string }[];
  requestBody?: { content: { 'application/json': { schema: { properties: Record<string, { description: string }>; required?: string[] } } } };
  responses: Record<string, { description: string }>;
};

const BADGE: Record<string, string> = {
  get: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  post: 'border-blue-200 bg-blue-50 text-blue-700',
  patch: 'border-amber-200 bg-amber-50 text-amber-700',
  put: 'border-amber-200 bg-amber-50 text-amber-700',
  delete: 'border-red-200 bg-red-50 text-red-700',
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

// Renders `inline code` spans in the spec's plain-text descriptions.
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) =>
        i % 2 === 1 ? <code key={i} className="rounded bg-white px-1.5 py-0.5 text-[0.88em] text-[#1a1d29]">{part}</code> : <span key={i}>{part}</span>
      )}
    </>
  );
}

function Code({ children, label }: { children: string; label?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      {label && <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-[12px] font-medium text-gray-500">{label}</div>}
      <pre className="overflow-x-auto p-4 text-[12.5px] leading-[1.6] text-[#1a1d29]"><code>{children}</code></pre>
    </div>
  );
}

export default function DocsPage() {
  const base = 'https://calldesk.tech/api/v1';
  const spec = buildOpenApi(base);
  const groups = new Map<string, { method: string; path: string; op: Op }[]>();
  for (const [path, methods] of Object.entries(spec.paths as Record<string, Record<string, Op>>)) {
    for (const [method, op] of Object.entries(methods)) {
      const tag = op.tags[0];
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push({ method, path, op });
    }
  }
  const tags = [...groups.keys()];
  const catalog = getModelCatalog();

  return (
    <div className="min-h-screen bg-white text-[#00122e]">
      <SiteHeader />
      <main className="pb-24 pt-[120px] md:pt-[136px]">
        <Container>
          <div className="max-w-[720px]">
            <Eyebrow>API reference</Eyebrow>
            <h1 className="mt-6 text-[36px] font-semibold leading-[1.05] tracking-[-0.03em] md:text-[48px]">Build on CallDeskTech.</h1>
            <p className="mt-5 max-w-[600px] text-[16px] leading-[1.55] text-gray-500"><Inline text={spec.info.description} /></p>
            <div className="mt-7 flex flex-wrap gap-3">
              <PrimaryButton href="/dashboard/settings">Create an API key</PrimaryButton>
              <SecondaryButton href="/api/v1/openapi.json">OpenAPI file</SecondaryButton>
            </div>
          </div>

          <div className="mt-14 grid gap-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14">
            <nav aria-label="API sections" className="lg:sticky lg:top-[104px] lg:self-start">
              <ul className="flex flex-wrap gap-2 lg:block lg:space-y-1">
                <li><a href="#quickstart" className="block rounded-md px-3 py-1.5 text-[14px] text-gray-600 transition-colors hover:bg-white hover:text-[#1a1d29]">Quick start</a></li>
                <li><a href="#mcp" className="block rounded-md px-3 py-1.5 text-[14px] text-gray-600 transition-colors hover:bg-white hover:text-[#1a1d29]">MCP server</a></li>
                <li><a href="#mcp-tools" className="block rounded-md px-3 py-1.5 text-[14px] text-gray-600 transition-colors hover:bg-white hover:text-[#1a1d29]">MCP tools</a></li>
                <li><a href="#pricing-tiers" className="block rounded-md px-3 py-1.5 text-[14px] text-gray-600 transition-colors hover:bg-white hover:text-[#1a1d29]">Pricing tiers</a></li>
                <li><a href="#models" className="block rounded-md px-3 py-1.5 text-[14px] text-gray-600 transition-colors hover:bg-white hover:text-[#1a1d29]">Advanced: choose models yourself</a></li>
                <li><a href="#sdks" className="block rounded-md px-3 py-1.5 text-[14px] text-gray-600 transition-colors hover:bg-white hover:text-[#1a1d29]">Official SDKs</a></li>
                {tags.map((t) => (
                  <li key={t}><a href={`#${slug(t)}`} className="block rounded-md px-3 py-1.5 text-[14px] text-gray-600 transition-colors hover:bg-white hover:text-[#1a1d29]">{t}</a></li>
                ))}
              </ul>
            </nav>

            <div className="min-w-0">
              <section id="quickstart" className="scroll-mt-[96px]">
                <h2 className="text-[24px] font-semibold tracking-[-0.02em]">Quick start</h2>
                <p className="mt-2 max-w-[600px] text-[15px] leading-[1.55] text-gray-500">
                  Send your key as a bearer token. Ask who it belongs to first: the response includes the workspace id used in the paths below.
                </p>
                <div className="mt-5 space-y-4">
                  <Code label="1. Find your workspace">{`curl ${base}/me \\
  -H "Authorization: Bearer cdk_live_..."`}</Code>
                  <Code label="2. Create an agent from a template">{`curl -X POST \\
  ${base}/tenants/$TENANT/agents/from-template \\
  -H "Authorization: Bearer cdk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"templateId": "medical-receptionist"}'`}</Code>
                </div>
                <p className="mt-4 text-[14px] text-gray-500">Errors return <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">401</code> for missing or bad credentials, <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">404</code> for anything outside your workspace, and <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">429</code> when rate limited.</p>
              </section>

              <section id="mcp" className="mt-14 scroll-mt-[96px]">
                <h2 className="text-[24px] font-semibold tracking-[-0.02em]">MCP server</h2>
                <p className="mt-2 max-w-[600px] text-[15px] leading-[1.55] text-gray-500">
                  Connect an AI assistant to your workspace. Add the URL, sign in when your browser opens, and pick the workspace to share. No API key needed.
                </p>
                <div className="mt-5 space-y-4">
                  <Code label="Claude Code">{`claude mcp add --transport http calldesktech https://calldesk.tech/mcp`}</Code>
                  <Code label="Claude, Cursor and other clients: add a remote MCP server with this URL">{`https://calldesk.tech/mcp`}</Code>
                </div>
                <p className="mt-4 text-[14px] text-gray-500">Each connection is a workspace API key named after the app. Revoke it under Settings, API Keys. Clients that only support keys can send one as <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">Authorization: Bearer cdk_live_...</code>.</p>
              </section>

              <section id="mcp-tools" className="mt-14 scroll-mt-[96px]">
                <h2 className="text-[24px] font-semibold tracking-[-0.02em]">MCP tools</h2>
                <p className="mt-2 max-w-[600px] text-[15px] leading-[1.55] text-gray-500">
                  Everything the MCP server exposes. Tools that cost money or delete data say so in their description, and assistants ask before calling them.
                </p>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {MCP_TOOL_GROUPS.map((g) => (
                    <div key={g.group} className="rounded-xl border border-gray-200 bg-white p-5">
                      <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{g.group}</h3>
                      <ul className="mt-2 space-y-2">
                        {g.tools.map((t) => (
                          <li key={t.name} className="text-[13px] leading-[1.45] text-gray-500"><code className="rounded bg-gray-100 px-1.5 py-0.5 text-[12px] text-[#1a1d29]">{t.name}</code> {t.summary}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>

              <section id="pricing-tiers" className="mt-14 scroll-mt-[96px]">
                <h2 className="text-[24px] font-semibold tracking-[-0.02em]">Pricing tiers</h2>
                <p className="mt-2 max-w-[640px] text-[15px] leading-[1.55] text-gray-500">
                  The tier is the engine: pick one when you publish a version and we choose the right voice and intelligence for it. You never need to pick a model. Pass <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">tier</code> to <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">POST /agents/{'{agentId}'}/versions</code> or the <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">publish_agent_version</code> tool, and read the list from <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">GET /pricing</code> (no sign-in needed) or <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">list_pricing_tiers</code>.
                </p>
                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  {PRICING_TIERS.map((t) => (
                    <div key={t.id} className="rounded-xl border border-gray-200 bg-white p-5">
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{t.name}</h3>
                        {t.availability === 'coming_soon' && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">Coming soon</span>}
                      </div>
                      <p className="mt-1 text-[22px] font-normal tracking-[-0.03em] text-[#00122e]">${(t.pricePerMinuteCents / 100).toFixed(2)}<span className="text-[13px] text-gray-400"> / min</span></p>
                      <p className="mt-1 text-[13px] leading-[1.45] text-gray-500">{t.tagline}</p>
                      <TierRatingRows tier={t} className="mt-3" />
                    </div>
                  ))}
                </div>
                <ul className="mt-4 max-w-[640px] list-disc space-y-1 pl-5 text-[14px] leading-[1.5] text-gray-500">
                  <li>Included on every plan: {INCLUDED_ON_ALL.join('; ')}.</li>
                  <li>{CARRIER_NOTE} {PHONE_NUMBERS_LINE}</li>
                  <li>{workedExample().text}.</li>
                  <li>{EXPERT_BACKUP_LINE} Publish with <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">&quot;routingMode&quot;: &quot;{EXPERT_BACKUP_ROUTING_MODE}&quot;</code> and <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">&quot;acceptExpertBackup&quot;: true</code> (voiceEngine poc, tier lite or standard).</li>
                  <li>Optional add-ons are coming soon and cannot be bought yet; amounts will be announced when they launch. Planned: {ADD_ONS.map((a) => a.label.toLowerCase()).join(', ')}.</li>
                  <li>Lite uses our efficient voice, built for fast, high-volume calls. Publishing with <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">&quot;tier&quot;: &quot;lite&quot;</code> needs <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">&quot;acceptLowerQuality&quot;: true</code> to confirm you are choosing the Lite voice for the lower price.</li>
                  <li>Agents published without a tier keep their current per-minute price. Choosing a tier is optional.</li>
                </ul>
                <div className="mt-4"><Code label="Publish a version on the Standard tier">{`curl -X POST ${base}/agents/$AGENT/versions \\
  -H "Authorization: Bearer cdk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"flowName":"Front desk","startNodeId":"greet","nodes":[...],
       "voiceEngine":"poc","tier":"standard"}'`}</Code></div>
              </section>

              <section id="models" className="mt-14 scroll-mt-[96px]">
                <h2 className="text-[24px] font-semibold tracking-[-0.02em]">Advanced: choose models yourself</h2>
                <p className="mt-2 max-w-[640px] text-[15px] leading-[1.55] text-gray-500">
                  You do not need this to use a pricing tier. For API and MCP users who want control, an agent version can also choose the language model that runs the conversation and the voice model that speaks it. Models you set override the tier’s choice, and the tier’s price does not change. Pass <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">llmModel</code> and <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">ttsModel</code> when you publish a version, or read the same list from <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">GET /models</code> or the <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">list_model_options</code> tool. Leave them out and the tier (or the default) chooses.
                </p>
                <ul className="mt-3 max-w-[640px] list-disc space-y-1 pl-5 text-[14px] leading-[1.5] text-gray-500">
                  {catalog.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
                <h3 className="mt-6 text-[15px] font-semibold tracking-[-0.01em]">Language models (<code className="text-[13px]">llmModel</code>)</h3>
                <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200 bg-white">
                  <table className="w-full min-w-[640px] text-left text-[13px]">
                    <thead className="border-b border-gray-200 bg-gray-50 text-[12px] uppercase tracking-[0.04em] text-gray-500"><tr><th className="px-3 py-2">Id</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Notes</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {catalog.llmModels.map((m) => (
                        <tr key={m.id}><td className="px-3 py-2 align-top"><code>{m.id}</code>{m.default && <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">default</span>}</td><td className="px-3 py-2 align-top text-gray-500">{m.status}</td><td className="px-3 py-2 align-top text-gray-500">{m.notes}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h3 className="mt-6 text-[15px] font-semibold tracking-[-0.01em]">Voice models (<code className="text-[13px]">ttsModel</code>, with <code className="text-[13px]">ttsBackend</code>)</h3>
                <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200 bg-white">
                  <table className="w-full min-w-[640px] text-left text-[13px]">
                    <thead className="border-b border-gray-200 bg-gray-50 text-[12px] uppercase tracking-[0.04em] text-gray-500"><tr><th className="px-3 py-2">Id</th><th className="px-3 py-2">Backend</th><th className="px-3 py-2">Notes</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {catalog.ttsModels.map((m) => (
                        <tr key={m.id}><td className="px-3 py-2 align-top"><code>{m.id}</code>{m.default && <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">default</span>}</td><td className="px-3 py-2 align-top text-gray-500">{m.backend}</td><td className="px-3 py-2 align-top text-gray-500">{m.notes}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4"><Code label="Publish a version with a cheaper voice and language model">{`curl -X POST ${base}/agents/$AGENT/versions \\
  -H "Authorization: Bearer cdk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"flowName":"Front desk","startNodeId":"greet","nodes":[...],
       "voiceEngine":"poc","ttsBackend":"elevenlabs",
       "ttsModel":"eleven_flash_v2_5","llmModel":"gpt-6-luna"}'`}</Code></div>
                <p className="mt-3 max-w-[640px] text-[13px] leading-[1.5] text-gray-500">What you pay per minute is set by your pricing tier (or, for agents published without one, the flat price of your voice backend), not by the models you choose. See Pricing tiers above.</p>
              </section>

              <section id="sdks" className="mt-14 scroll-mt-[96px]">
                <h2 className="text-[24px] font-semibold tracking-[-0.02em]">Official SDKs</h2>
                <p className="mt-2 max-w-[600px] text-[15px] leading-[1.55] text-gray-500">
                  Client libraries that wrap this API. Both are thin, typed wrappers — the routes below are the source of truth.
                </p>
                <div className="mt-5 space-y-4">
                  <Code label="Python">{`pip install calldesktech
# or: pip install git+https://github.com/calldesktech/calldesktech-python`}</Code>
                  <Code label="TypeScript / Node (source, not yet on npm — clone and build)">{`git clone https://github.com/calldesktech/calldesktech-node
cd calldesktech-node && npm install && npm run build
# npm install calldesktech   <- once published`}</Code>
                  <Code label="Quickstart">{`import { CallDeskTech } from "calldesktech";

const client = new CallDeskTech({ apiKey: process.env.CALLDESK_API_KEY! });

const { agentId, versionId } = await client.agents.createFromTemplate({
  templateId: "medical-receptionist",
});

const { phoneNumbers } = await client.phoneNumbers.list();
await client.phoneNumbers.setRouting(phoneNumbers[0].id, {
  direction: "inbound",
  agentVersionId: versionId,
});

await client.phoneNumbers.call(phoneNumbers[0].id, { toNumber: "+15551234567" });`}</Code>
                </div>
              </section>

              {tags.map((tag) => (
                <section key={tag} id={slug(tag)} className="mt-14 scroll-mt-[96px]">
                  <h2 className="border-b border-gray-200 pb-3 text-[24px] font-semibold tracking-[-0.02em]">{tag}</h2>
                  <div className="mt-5 space-y-3">
                    {groups.get(tag)!.map(({ method, path, op }) => {
                      const props = op.requestBody?.content['application/json'].schema;
                      return (
                        <div key={method + path} className="rounded-xl border border-gray-200 bg-white p-5">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] ${BADGE[method]}`}>{method}</span>
                            <code className="break-all text-[13px] text-[#1a1d29]">{path}</code>
                          </div>
                          <p className="mt-3 text-[15px] font-medium tracking-[-0.01em]">{op.summary}</p>
                          {op.description && <p className="mt-1 max-w-[680px] text-[14px] leading-[1.5] text-gray-500"><Inline text={op.description} /></p>}
                          {op.parameters?.filter((p) => p.in === 'query').map((p) => (
                            <p key={p.name} className="mt-2 text-[13px] text-gray-500"><code className="rounded bg-gray-100 px-1.5 py-0.5">?{p.name}</code> {p.description}</p>
                          ))}
                          {props && (
                            <dl className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-100 text-[13px]">
                              {Object.entries(props.properties).map(([k, v]) => (
                                <div key={k} className="grid gap-1 px-3 py-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
                                  <dt><code>{k}</code>{props.required?.includes(k) && <span className="ml-1 text-red-600" title="required">*</span>}</dt>
                                  <dd className="text-gray-500">{v.description}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                          <p className="mt-3 text-[13px] text-gray-500">{op.responses['200'].description}</p>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </Container>
      </main>
      <SiteFooter />
    </div>
  );
}

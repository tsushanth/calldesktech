import { buildOpenApi } from '@/lib/openapi';
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

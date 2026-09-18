import { buildOpenApi } from '@/lib/openapi';

export const metadata = { title: 'API reference — CallDeskTech' };

type Op = {
  tags: string[]; summary: string; description?: string;
  parameters?: { name: string; in: string; description?: string }[];
  requestBody?: { content: { 'application/json': { schema: { properties: Record<string, { description: string }>; required?: string[] } } } };
  responses: Record<string, { description: string }>;
};

const BADGE: Record<string, string> = {
  get: 'bg-emerald-100 text-emerald-800', post: 'bg-blue-100 text-blue-800',
  patch: 'bg-amber-100 text-amber-800', put: 'bg-amber-100 text-amber-800', delete: 'bg-red-100 text-red-800',
};

export default function DocsPage() {
  const spec = buildOpenApi('https://calldesk-tech.fly.dev/api/v1');
  const groups = new Map<string, { method: string; path: string; op: Op }[]>();
  for (const [path, methods] of Object.entries(spec.paths as Record<string, Record<string, Op>>)) {
    for (const [method, op] of Object.entries(methods)) {
      const tag = op.tags[0];
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push({ method, path, op });
    }
  }
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-[#1a1d29]">
      <h1 className="text-3xl font-semibold">CallDeskTech API</h1>
      <p className="mt-3 text-[15px] text-gray-600">{spec.info.description}</p>
      <pre className="mt-5 overflow-x-auto rounded-lg bg-[#1a1d29] p-4 text-[12.5px] leading-relaxed text-gray-100">{`curl ${spec.servers[0].url}/me \\
  -H "Authorization: Bearer cdk_live_..."`}</pre>
      <p className="mt-3 text-[13px] text-gray-500">
        Machine-readable spec: <a className="text-blue-600 underline" href="/api/v1/openapi.json">/api/v1/openapi.json</a>
      </p>
      {[...groups.entries()].map(([tag, items]) => (
        <section key={tag} className="mt-10">
          <h2 className="mb-3 border-b border-gray-200 pb-2 text-lg font-semibold">{tag}</h2>
          <div className="space-y-4">
            {items.map(({ method, path, op }) => {
              const props = op.requestBody?.content['application/json'].schema;
              return (
                <div key={method + path} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase ${BADGE[method]}`}>{method}</span>
                    <code className="break-all text-[13px]">{path}</code>
                  </div>
                  <p className="mt-2 text-[14px] font-medium">{op.summary}</p>
                  {op.description && <p className="mt-1 text-[13px] text-gray-600">{op.description}</p>}
                  {op.parameters?.filter((p) => p.in === 'query').map((p) => (
                    <p key={p.name} className="mt-1 text-[12.5px] text-gray-500"><code>?{p.name}</code> — {p.description}</p>
                  ))}
                  {props && (
                    <div className="mt-2 text-[12.5px] text-gray-600">
                      <span className="font-medium">Body:</span>{' '}
                      {Object.entries(props.properties).map(([k, v]) => (
                        <span key={k} className="mr-2"><code>{k}{props.required?.includes(k) ? '*' : ''}</code> <span className="text-gray-400">{v.description}</span></span>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-[12.5px] text-gray-500">{op.responses['200'].description}</p>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}

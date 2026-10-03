// Test receiver for the builder regression. The call engine is pointed at these URLs by scenarios, and the
// harness reads back what arrived. It holds no customer data: only requests made by our own test calls.
//
//   POST|GET /hook/<run>[?delay=ms][&body=<url-encoded json>]   function-node webhook; records the request, answers JSON
//   POST     /mcp/<run>                                          minimal MCP server (initialize, tools/call lookup_order)
//   GET|DELETE /events/<run>   (header X-Reg-Secret)             what arrived for that run / clear it
//   GET      /health
// <run> is a random id per scenario run (4-40 chars of a-z 0-9 and dashes).

const RUN_RE = /^[a-z0-9-]{4,40}$/;
const MAX_BODY = 4000;
const MAX_DELAY_MS = 5000;
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function record(env, run, kind, req, bodyText) {
  const url = new URL(req.url);
  const data = {
    method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams),
    headers: { authorization: req.headers.get('authorization'), 'x-test-header': req.headers.get('x-test-header'), 'content-type': req.headers.get('content-type'), 'mcp-session-id': req.headers.get('mcp-session-id') },
    body: bodyText.slice(0, MAX_BODY),
  };
  await env.DB.prepare('INSERT INTO events (run, kind, at, data) VALUES (?, ?, ?, ?)').bind(run, kind, Date.now(), JSON.stringify(data)).run();
  if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM events WHERE at < ?').bind(Date.now() - 3 * 86400000).run();
}

function mcpReply(rpc) {
  const id = rpc.id ?? null;
  if (rpc.method === 'initialize') return { rpc: { jsonrpc: '2.0', id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'regression-receiver', version: '1.0.0' } } }, headers: { 'Mcp-Session-Id': 'reg-session' } };
  if (rpc.method === 'tools/call' && rpc.params?.name === 'lookup_order') {
    const orderId = String(rpc.params?.arguments?.id ?? 'unknown');
    return { rpc: { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ order_id: orderId, status: 'shipped', eta: 'Tuesday' }) }] } } };
  }
  return { rpc: { jsonrpc: '2.0', id, error: { code: -32601, message: `unsupported: ${rpc.method}` } } };
}

const handler = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const [kind, run] = url.pathname.split('/').filter(Boolean);
    if (kind === 'health') return json({ ok: true });
    if (!run || !RUN_RE.test(run)) return json({ error: 'bad run id' }, 400);

    if (kind === 'events') {
      if (!env.REG_SECRET || req.headers.get('x-reg-secret') !== env.REG_SECRET) return json({ error: 'unauthorized' }, 401);
      if (req.method === 'DELETE') { await env.DB.prepare('DELETE FROM events WHERE run = ?').bind(run).run(); return json({ ok: true }); }
      const { results } = await env.DB.prepare('SELECT id, kind, at, data FROM events WHERE run = ? ORDER BY id ASC LIMIT 50').bind(run).all();
      return json({ events: results.map((r) => ({ id: r.id, kind: r.kind, at: r.at, ...JSON.parse(r.data) })) });
    }

    const bodyText = req.method === 'GET' ? '' : await req.text();

    if (kind === 'hook') {
      await record(env, run, 'hook', req, bodyText);
      const delay = Math.min(Number(url.searchParams.get('delay')) || 0, MAX_DELAY_MS);
      if (delay) await sleep(delay);
      let reply = { status: 'ok', slots: ['10am', '2pm'] };
      const custom = url.searchParams.get('body');
      if (custom) { try { reply = JSON.parse(custom); } catch { /* keep default */ } }
      return json(reply);
    }

    if (kind === 'mcp') {
      await record(env, run, 'mcp', req, bodyText);
      let rpc; try { rpc = JSON.parse(bodyText); } catch { return json({ error: 'bad json' }, 400); }
      if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const { rpc: out, headers } = mcpReply(rpc);
      return json(out, 200, headers || {});
    }

    return json({ error: 'not found' }, 404);
  },
};

export default handler;

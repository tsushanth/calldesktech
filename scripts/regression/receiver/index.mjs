// Test receiver for the builder regression. The call engine is pointed at these URLs by scenarios, and the
// harness reads back what arrived. It holds no customer data: only requests made by our own test calls.
//
//   POST|GET /hook/<run>[?delay=ms][&body=<url-encoded json>]   function-node webhook; records the request, answers JSON
//   POST     /mcp/<run>                                          minimal MCP server (initialize, tools/call lookup_order)
//   GET|DELETE /events/<run>   (header X-Reg-Secret)             what arrived for that run / clear it
//   POST     /current  {run, mode}  (header X-Reg-Secret)       choose what the receiver NUMBER does for the next call
//   POST     /twiml, /twiml/done                                  Twilio voice webhook for that number: mode ivr | voicemail | silent
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

const xml = (body) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { headers: { 'Content-Type': 'text/xml' } });

async function currentState(env) {
  const row = await env.DB.prepare("SELECT v FROM state WHERE k = 'current'").first();
  try { return row ? JSON.parse(row.v) : { run: 'unset-run', mode: 'silent' }; } catch { return { run: 'unset-run', mode: 'silent' }; }
}

const IVR = '<Gather numDigits="3" timeout="15" action="/twiml/done" method="POST"><Say>Welcome to the regression test line. Please enter your three digit extension now.</Say></Gather><Say>No input received. Goodbye.</Say><Hangup/>';
const VOICEMAIL = '<Pause length="2"/><Say>Hi, you have reached the voicemail of Quillbert Hardware. We are unable to take your call right now. Please leave a message after the tone.</Say><Pause length="20"/><Hangup/>';
// A bare <Pause> does not answer the call (it would ring until the caller gives up), so answer with an inaudible
// half-second DTMF wait first.
const SILENT = '<Play digits="w"/><Pause length="60"/>';

const handler = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const [kind, run] = url.pathname.split('/').filter(Boolean);
    if (kind === 'health') return json({ ok: true });

    // The receiver NUMBER's voice webhook has no run id in its path: the harness sets the current run and mode first.
    if (kind === 'current') {
      if (!env.REG_SECRET || req.headers.get('x-reg-secret') !== env.REG_SECRET) return json({ error: 'unauthorized' }, 401);
      const body = await req.json().catch(() => ({}));
      if (!RUN_RE.test(body.run || '') || !['ivr', 'voicemail', 'silent'].includes(body.mode)) return json({ error: 'need {run, mode: ivr|voicemail|silent}' }, 400);
      await env.DB.prepare("INSERT INTO state (k, v) VALUES ('current', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify(body)).run();
      return json({ ok: true });
    }
    if (kind === 'twiml') {
      const { run: current, mode } = await currentState(env);
      const form = req.method === 'POST' ? Object.fromEntries(await req.formData().then((f) => [...f.entries()]).catch(() => [])) : {};
      const done = run === 'done';
      await record(env, current, done ? 'dtmf' : 'twiml', req, JSON.stringify({ mode, from: form.From, to: form.To, callSid: form.CallSid, digits: form.Digits }));
      if (done) return xml(`<Say>Received ${String(form.Digits || '').split('').join(' ')}. Goodbye.</Say><Hangup/>`);
      return xml(mode === 'ivr' ? IVR : mode === 'voicemail' ? VOICEMAIL : SILENT);
    }
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

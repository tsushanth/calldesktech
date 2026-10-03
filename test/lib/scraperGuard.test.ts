import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { scrapeUrl, fetchRendered } from '@/lib/scraper';
import { SsrfBlockedError } from '@/lib/safeFetch';

const CHROME = process.env.CHROMIUM_EXECUTABLE_PATH || process.env.E2E_CHROME
  || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((p) => existsSync(p));

describe('scrapeUrl refuses internal targets before doing anything', () => {
  for (const url of ['http://127.0.0.1:3000/', 'http://localhost:8090/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://call-loop-poc.internal:8090/', 'file:///etc/passwd', 'ftp://example.com/', 'http://user:pw@example.com/']) {
    it(`rejects ${url}`, async () => { await expect(scrapeUrl(url)).rejects.toBeInstanceOf(SsrfBlockedError); });
  }
});

// Real Chrome, local servers. Hostnames decide what the test guard allows: *.ok.test is "public", everything else is private.
describe.skipIf(!CHROME)('headless scraping cannot be used to read internal servers', () => {
  const servers: http.Server[] = [];
  const start = (handler: http.RequestListener) => new Promise<number>((resolve) => {
    const s = http.createServer(handler); servers.push(s);
    s.listen(0, '127.0.0.1', () => resolve((s.address() as { port: number }).port));
  });
  afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((r) => { s.closeAllConnections?.(); s.close(r); }))); });
  const deps = { lookup: async () => [{ address: '127.0.0.1', family: 4 }], isAllowedIp: (_ip: string, host: string) => /\.ok\.test$/.test(host) };

  it('renders a normal public page', async () => {
    process.env.CHROMIUM_EXECUTABLE_PATH = CHROME;
    const port = await start((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<html><body><h1>Opening hours</h1><p>We are open every day from seven in the morning until three in the afternoon, closed on holidays.</p><script>document.title="rendered"</script></body></html>'); });
    const html = await fetchRendered(`http://site.ok.test:${port}/`, deps);
    expect(html).toContain('Opening hours');
    expect(html).toContain('<title>rendered</title>');
  }, 60000);

  it('lets a page load its own subresources but blocks fetch, XHR, images and WebSocket aimed at private hosts', async () => {
    process.env.CHROMIUM_EXECUTABLE_PATH = CHROME;
    let secretHits = 0;
    const secret = await start((req, res) => { secretHits++; res.setHeader('access-control-allow-origin', '*'); res.end('INTERNAL-SECRET'); });
    const port = await start((req, res) => {
      if (req.url === '/own.js') { res.setHeader('content-type', 'text/javascript'); return res.end('window.ownScript = "loaded";'); }
      res.setHeader('content-type', 'text/html');
      res.end(`<html><body><h1>Page</h1><div id="out">pending</div><script src="/own.js"></script><img src="http://metadata.bad.test:${secret}/pixel.png">
        <script>
          (async () => {
            const results = [];
            try { const r = await fetch('http://internal.bad.test:${secret}/secret'); results.push('fetch:' + (await r.text())); } catch (e) { results.push('fetch:blocked'); }
            try { const x = new XMLHttpRequest(); x.open('GET', 'http://internal.bad.test:${secret}/x', false); x.send(); results.push('xhr:' + x.responseText); } catch (e) { results.push('xhr:blocked'); }
            try { await new Promise((res, rej) => { const w = new WebSocket('ws://internal.bad.test:${secret}/'); w.onopen = () => res(); w.onerror = () => rej(new Error('ws')); w.onclose = () => rej(new Error('ws')); }); results.push('ws:open'); } catch (e) { results.push('ws:blocked'); }
            document.getElementById('out').textContent = results.join('|') + '|own:' + window.ownScript;
          })();
        </script></body></html>`);
    });
    const html = await fetchRendered(`http://site.ok.test:${port}/`, deps);
    expect(secretHits).toBe(0);
    expect(html).not.toContain('INTERNAL-SECRET');
    expect(html).toContain('fetch:blocked');
    expect(html).toContain('ws:blocked');
    expect(html).toContain('own:loaded');
  }, 60000);

  it('does not follow a redirect from a public page into a private host', async () => {
    process.env.CHROMIUM_EXECUTABLE_PATH = CHROME;
    let secretHits = 0;
    const secret = await start((req, res) => { secretHits++; res.setHeader('content-type', 'text/html'); res.end('<h1>INTERNAL-ADMIN</h1>'); });
    const port = await start((req, res) => { res.statusCode = 302; res.setHeader('location', `http://admin.bad.test:${secret}/`); res.end(); });
    await expect(fetchRendered(`http://site.ok.test:${port}/`, deps)).rejects.toThrow();
    expect(secretHits).toBe(0);
  }, 60000);
});

import * as cheerio from 'cheerio';
import { chromium } from 'playwright-core';

// Our own website-knowledge-base scraper — used for 'poc'-engine tenants so
// building a knowledge base never depends on (or pays for) Retell's API.
// Retell's own createKnowledgeBase is only called for 'retell'-engine
// tenants, where Retell is already the thing answering the phone — see
// /api/tenants/[id]/knowledge-bases/route.ts for the engine gate.
//
// Deliberately a single-page fetch, not a sitemap crawl: covers the actual
// reported case (one URL, e.g. a business's location page) without taking
// on a crawl queue/rate-limiting/multi-page dedup design that a real bulk
// crawler needs. Extending to a sitemap is a separate, bigger feature.

export interface ScrapedItem {
  question: string;
  answer: string;
}

const MAX_ANSWER_CHARS = 1200; // keeps each item a reasonable size for the LLM to scan at query time
const MIN_ANSWER_CHARS = 40; // skip fragments too short to be a useful standalone item

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// Shared by the scraper's own heading-less fallback and the "Add text"
// document type (pasted raw text has no DOM/headings to split on at all,
// so it always goes through this path) — splits a wall of text into
// paragraph-bounded chunks near MAX_ANSWER_CHARS rather than one giant item.
export function chunkPlainText(text: string, titlePrefix: string): ScrapedItem[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => cleanText(p))
    .filter((p) => p.length >= MIN_ANSWER_CHARS);

  const items: ScrapedItem[] = [];
  let chunk = '';
  let chunkIndex = 1;
  for (const p of paragraphs) {
    if (chunk.length + p.length > MAX_ANSWER_CHARS && chunk) {
      items.push({ question: `${titlePrefix} — section ${chunkIndex}`, answer: chunk });
      chunk = '';
      chunkIndex += 1;
    }
    chunk += (chunk ? ' ' : '') + p;
  }
  if (chunk) items.push({ question: chunkIndex === 1 ? titlePrefix : `${titlePrefix} — section ${chunkIndex}`, answer: chunk });
  return items;
}

// Extraction logic shared by both the plain-fetch and headless-rendered
// paths below — the two differ only in HOW the HTML was obtained, never in
// how it's turned into items, so this takes already-fetched HTML and never
// touches the network itself.
function extractItemsFromHtml(html: string, url: string): ScrapedItem[] {
  const $ = cheerio.load(html);

  // Strip anything that isn't real page content before extracting text —
  // otherwise script/style bodies and nav/footer/cart-widget boilerplate
  // end up as "knowledge" the agent might actually recite to a caller.
  // Real test against a live site (summermooncoffee.com) surfaced the cart
  // widget specifically ("Your cart is empty... Log in to check out
  // faster.") coming through as an extracted item — common e-commerce
  // chrome, not page content, so it's excluded by class/id pattern too,
  // not just by tag.
  $('script, style, noscript, nav, footer, header, svg, [aria-hidden="true"], form, ' +
    '[class*="cart" i], [id*="cart" i], [class*="popup" i], [class*="modal" i], ' +
    '[class*="cookie" i], [class*="newsletter" i]').remove();

  const pageTitle = cleanText($('title').first().text()) || url;
  const items: ScrapedItem[] = [];

  const headings = $('h1, h2, h3').toArray();
  if (headings.length > 0) {
    for (const el of headings) {
      const heading = cleanText($(el).text());
      if (!heading) continue;
      // Collect text from this heading's following siblings until the next
      // heading of equal-or-higher rank — a simple, real DOM walk rather
      // than a naive "grab everything after" that would duplicate content
      // across sections.
      let content = '';
      let node = $(el).next();
      while (node.length && !node.is('h1, h2, h3')) {
        content += ' ' + node.text();
        node = node.next();
      }
      const answer = cleanText(content).slice(0, MAX_ANSWER_CHARS);
      if (answer.length >= MIN_ANSWER_CHARS) {
        items.push({ question: heading, answer });
      }
    }
  }

  // No usable heading structure (or every section was too short) — fall
  // back to chunking the page's own paragraph text directly.
  if (items.length === 0) {
    const paragraphs = $('p')
      .toArray()
      .map((el) => cleanText($(el).text()))
      .filter((t) => t.length >= MIN_ANSWER_CHARS);

    let chunk = '';
    let chunkIndex = 1;
    for (const p of paragraphs) {
      if (chunk.length + p.length > MAX_ANSWER_CHARS && chunk) {
        items.push({ question: `${pageTitle} — section ${chunkIndex}`, answer: chunk });
        chunk = '';
        chunkIndex += 1;
      }
      chunk += (chunk ? ' ' : '') + p;
    }
    if (chunk) items.push({ question: `${pageTitle} — section ${chunkIndex}`, answer: chunk });
  }

  return items;
}

async function fetchStatic(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CallDeskTechBot/1.0; +https://calldesktech.com)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  return res.text();
}

// JS-rendering fallback (2026-09-16 finding, MYSTERY_SHOPPER-adjacent but
// this codebase's own real-call testing): a plain fetch() only ever sees
// server-rendered HTML. Verified directly against summermooncoffee.com's
// raw response — 201KB of markup with zero phone numbers, zero addresses,
// one real heading — because that site's actual location data loads via
// client-side JS after the page arrives. No amount of extraction-logic
// tuning fixes that; the content genuinely isn't in what fetch() receives.
// Uses the system/downloaded Chromium at CHROMIUM_EXECUTABLE_PATH if set
// (production points this at Alpine's apk-installed chromium — see
// Dockerfile — since playwright-core ships no browser of its own and its
// own downloaded builds don't run on musl/Alpine); unset locally, where
// playwright-core finds its shared ms-playwright cache automatically.
async function fetchRendered(url: string): Promise<string> {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'], // required inside the container's restricted /dev/shm
  });
  try {
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (compatible; CallDeskTechBot/1.0; +https://calldesktech.com)',
    });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    return await page.content();
  } finally {
    await browser.close();
  }
}

// Renders first, not as a conditional fallback: tried a "static fetch,
// only render if the result looks thin" heuristic first (char-count based)
// and it demonstrably failed on the exact real case it was built for —
// summermooncoffee.com's static result is a long list of location NAMES
// (well over any reasonable length threshold) with zero real content
// (address/phone/hours) behind it, so a length-based check can't tell
// "genuinely enough content" from "verbose but useless." This is a
// low-frequency, user-initiated action (someone explicitly adding one
// document), not a hot path, so paying the real cost of a full render
// every time is the right trade for actual correctness over a heuristic
// that already demonstrated it can't be trusted.
export async function scrapeUrl(url: string): Promise<ScrapedItem[]> {
  try {
    const renderedHtml = await fetchRendered(url);
    const renderedItems = extractItemsFromHtml(renderedHtml, url);
    if (renderedItems.length > 0) return renderedItems;
  } catch (err) {
    console.error(`[scraper] headless render failed for ${url}, falling back to static fetch:`, err);
  }

  // Rendering can legitimately fail (site blocks headless browsers, a
  // Chromium launch issue, a network timeout) — static fetch as a last
  // resort rather than losing the document entirely.
  const staticHtml = await fetchStatic(url);
  const staticItems = extractItemsFromHtml(staticHtml, url);
  if (staticItems.length === 0) {
    throw new Error(`No extractable text content found on ${url}`);
  }
  return staticItems;
}

import * as cheerio from 'cheerio';

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

// Splits the page into (heading, content-until-next-heading) sections when
// real headings exist, falling back to fixed-size paragraph chunks for
// pages with no heading structure (e.g. a single long block of copy).
export async function scrapeUrl(url: string): Promise<ScrapedItem[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CallDeskTechBot/1.0; +https://calldesktech.com)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  const html = await res.text();
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

  if (items.length === 0) {
    throw new Error(`No extractable text content found on ${url}`);
  }

  return items;
}

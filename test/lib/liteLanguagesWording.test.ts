import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LANGUAGES, TIERS } from '@/content/calldeskFacts';

const ROOT = process.cwd();
// Customer-facing and call-script text. Historical material (bench/ benchmark write-ups, tests) is deliberately not scanned.
const SCAN = ['src/content', 'src/lib/seoLibrary', 'src/lib/outreach', 'src/lib/pricingTiers.ts', 'public/llms.txt', 'outreach/scripts'];
// Files allowed to mention the old rule, as "relative/path". Keep empty unless a file quotes the history on purpose.
const ALLOW: string[] = [];

const OLD_CLAIM = /english[- ]only|only english(?!,)|english alone|limited to english|english-language (voice|option)|speaks english(?!,)/i;

function files(p: string): string[] {
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [p];
  return fs.readdirSync(full).flatMap((n) => files(path.join(p, n)));
}

describe('Lite is no longer described as English only', () => {
  it('no customer-facing file says the Lite voice is English only', () => {
    const hits: string[] = [];
    for (const f of SCAN.flatMap(files)) {
      if (ALLOW.includes(f) || !/\.(ts|tsx|json|md|txt)$/.test(f)) continue;
      const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
      for (const sentence of text.split(/(?<=[.!?])\s+|\n/)) {
        if (/\b(lite|piper)\b/i.test(sentence) && OLD_CLAIM.test(sentence)) hits.push(`${f}: ${sentence.trim().slice(0, 140)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the shared facts give Lite its six languages and Standard and Pro every language', () => {
    expect(LANGUAGES.liteLanguageNames).toEqual(['English', 'German', 'Spanish', 'French', 'Italian', 'Portuguese']);
    expect(LANGUAGES.allLanguageTierNames).toEqual(TIERS.filter((t) => t.id !== 'lite').map((t) => t.name));
    expect(LANGUAGES.limitedTiers.map((t) => t.name)).toEqual(['Lite']);
  });

  it('the cold-call script states the real Lite coverage', () => {
    const script = fs.readFileSync(path.join(ROOT, 'outreach/scripts/cold-call-script-reseller.md'), 'utf8');
    expect(script).toContain('Lite speaks English, German, Spanish, French, Italian and Portuguese');
  });
});

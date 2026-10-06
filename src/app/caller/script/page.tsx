import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { authenticateLink } from '@/lib/callerAuth';
import { renderScript } from '@/lib/scriptMarkdown';

// The cold-call scripts, served from the repo so a caller always sees the current version (no document copies to keep in sync).
// Needs the caller's private link (?k=...), the same one the calling page uses.
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false }, title: 'Call scripts' };

const SCRIPTS = [
  { id: 'reseller', label: 'Resellers and agencies', file: 'cold-call-script-reseller.md' },
  { id: 'freight', label: 'Freight brokers', file: 'cold-call-script-freight.md' },
];

export default async function ScriptPage({ searchParams }: { searchParams: Promise<{ k?: string; s?: string }> }) {
  const { k, s } = await searchParams;
  const user = await authenticateLink(k);
  if (!user) return <main className="mx-auto max-w-xl p-6 text-gray-700">This page needs your private link.</main>;
  const current = SCRIPTS.find((x) => x.id === s) ?? SCRIPTS[0];
  let text = '';
  try { text = await readFile(join(process.cwd(), 'outreach', 'scripts', current.file), 'utf8'); } catch { text = '# Script not available\n\nAsk Sushanth for the script.'; }
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 text-[15px] leading-relaxed text-gray-900">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <a href={`/caller?k=${encodeURIComponent(k!)}`} className="text-blue-700 underline">Back to my calls</a>
        <span className="text-gray-300">|</span>
        {SCRIPTS.map((x) => (
          <a key={x.id} href={`/caller/script?k=${encodeURIComponent(k!)}&s=${x.id}`} className={`rounded-full border px-3 py-1 ${x.id === current.id ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600'}`}>{x.label}</a>
        ))}
      </div>
      {renderScript(text)}
    </main>
  );
}

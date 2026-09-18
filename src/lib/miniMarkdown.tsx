// Lightweight formatter for node instruction text — Retell's own node
// prompts use a real, small markdown-ish vocabulary (### headers, **bold**,
// > quoted example lines, - bullet lists, <Wait for ...> inline directives),
// and ours rendered all of that as flat unstyled text. Deliberately NOT a
// full markdown library (no new dependency, no unsupported syntax like
// tables/links this app's prompts never actually use) — just the small
// fixed set of patterns real node prompts use, matched directly.
import { Fragment, type ReactNode } from 'react';

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  // **bold** and {{template_vars}} within a single line.
  const parts = text.split(/(\*\*[^*]+\*\*|\{\{[^}]+\}\})/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-${i}`} className="font-semibold text-[#1a1d29]">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('{{') && part.endsWith('}}')) {
      return (
        <code key={`${keyPrefix}-${i}`} className="rounded bg-blue-50 px-1 py-0.5 font-mono text-[0.92em] text-blue-700">
          {part}
        </code>
      );
    }
    return <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>;
  });
}

export function renderMiniMarkdown(text: string): ReactNode {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul key={key} className="my-1 list-disc space-y-0.5 pl-4">
        {listBuffer.map((item, i) => (
          <li key={i}>{renderInline(item, `${key}-li-${i}`)}</li>
        ))}
      </ul>
    );
    listBuffer = [];
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    const key = `l${i}`;

    if (!trimmed) {
      flushList(`${key}-flush`);
      return;
    }
    if (trimmed.startsWith('### ')) {
      flushList(`${key}-flush`);
      blocks.push(<p key={key} className="mt-2 text-[0.95em] font-semibold uppercase tracking-wide text-gray-500 first:mt-0">{trimmed.slice(4)}</p>);
      return;
    }
    if (trimmed.startsWith('## ')) {
      flushList(`${key}-flush`);
      blocks.push(<p key={key} className="mt-2 font-semibold text-[#1a1d29] first:mt-0">{trimmed.slice(3)}</p>);
      return;
    }
    if (trimmed.startsWith('> ')) {
      flushList(`${key}-flush`);
      blocks.push(
        <p key={key} className="my-1 border-l-2 border-blue-200 pl-2 italic text-gray-600">
          &ldquo;{renderInline(trimmed.slice(2).replace(/^"|"$/g, ''), key)}&rdquo;
        </p>
      );
      return;
    }
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      listBuffer.push(trimmed.slice(2));
      return;
    }
    // <Wait for customer response>, <no response needed>, etc. — a bare
    // bracketed directive line, not caller-facing prose.
    if (/^<[^<>]+>$/.test(trimmed)) {
      flushList(`${key}-flush`);
      blocks.push(
        <p key={key} className="my-1 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[0.88em] font-medium text-amber-700">
          {trimmed}
        </p>
      );
      return;
    }
    flushList(`${key}-flush`);
    blocks.push(<p key={key} className="my-1">{renderInline(trimmed, key)}</p>);
  });
  flushList('final-flush');

  return <>{blocks}</>;
}

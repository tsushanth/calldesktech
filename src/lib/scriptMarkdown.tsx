import type { ReactNode } from 'react';

// A tiny, safe renderer for the call-script markdown files (headings, bullets, quotes, tables, bold). It builds React elements, so
// nothing from the file is ever injected as raw HTML.

function inline(text: string, key: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={`${key}${i}`}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={`${key}${i}`} className="rounded bg-gray-100 px-1 text-[0.9em]">{part.slice(1, -1)}</code>;
    return part;
  });
}

export function renderScript(md: string): ReactNode[] {
  const lines = md.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let n = 0;
  const next = () => `n${n++}`;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^#{1,3}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length;
      const text = line.replace(/^#+\s*/, '');
      const cls = level === 1 ? 'mt-2 text-2xl font-semibold' : level === 2 ? 'mt-8 text-lg font-semibold border-b border-gray-200 pb-1' : 'mt-5 text-base font-semibold';
      out.push(level === 1 ? <h1 key={next()} className={cls}>{text}</h1> : level === 2 ? <h2 key={next()} className={cls}>{text}</h2> : <h3 key={next()} className={cls}>{text}</h3>);
      i++; continue;
    }
    if (line.startsWith('>')) {
      const parts: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) { parts.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(<blockquote key={next()} className="my-3 border-l-4 border-blue-300 bg-blue-50 px-4 py-2 text-gray-800">{inline(parts.join(' '), next())}</blockquote>);
      continue;
    }
    if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) { if (!/^\|[\s:|-]+\|?$/.test(lines[i])) rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim())); i++; }
      out.push(
        <div key={next()} className="my-3 overflow-x-auto"><table className="text-sm"><tbody>
          {rows.map((r, ri) => <tr key={ri} className={ri === 0 ? 'font-semibold' : ''}>{r.map((c, ci) => <td key={ci} className="border border-gray-200 px-2 py-1">{inline(c, `${ri}-${ci}`)}</td>)}</tr>)}
        </tbody></table></div>,
      );
      continue;
    }
    if (/^\s*-\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && (/^\s*-\s/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (/^\s*-\s/.test(lines[i])) items.push(lines[i].replace(/^\s*-\s/, '')); else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      out.push(<ul key={next()} className="my-2 list-disc space-y-1 pl-6">{items.map((t, ti) => <li key={ti}>{inline(t, `li${ti}`)}</li>)}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|\||\s*-\s)/.test(lines[i])) { para.push(lines[i].trim()); i++; }
    out.push(<p key={next()} className="my-2">{inline(para.join(' '), next())}</p>);
  }
  return out;
}

import Link from 'next/link';
import { Container } from '@/components/landing/primitives';
import type { Block, Crumb, HubModel, LibraryPageModel } from '@/lib/seoLibrary/model';
import { breadcrumbJsonLd, faqJsonLd, jsonLdString } from '@/lib/seoLibrary/seo';
import { longDate } from '@/lib/seoLibrary/helpers';

// Server-rendered, no client JavaScript: everything on a library page is plain HTML. The blocks come from src/lib/seoLibrary/pages.ts;
// the validator reads the same blocks, so the text it checks is the text rendered here.

const LINK = 'text-[#00122e] underline underline-offset-4 hover:text-blue-600';
const EXT_REL = 'noopener noreferrer nofollow';

function host(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'source'; }
}

function SourceLink({ url }: { url?: string }) {
  if (!url) return null;
  return (
    <>
      {' '}
      <a href={url} rel={EXT_REL} className="whitespace-nowrap text-[12.5px] text-gray-500 underline underline-offset-2 hover:text-blue-600">
        (source: {host(url)})
      </a>
    </>
  );
}

function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6 text-[13px] text-gray-500">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {crumbs.map((c, i) => (
          <li key={c.path} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className="text-gray-300">/</span>}
            {i === crumbs.length - 1 ? <span aria-current="page" className="text-gray-700">{c.name}</span> : <Link href={c.path} className="hover:text-blue-600">{c.name}</Link>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.kind) {
    case 'h2':
      return <h2 id={b.id} className="mt-12 scroll-mt-[96px] text-[26px] font-normal leading-[1.1] tracking-[-0.03em] text-[#00122e] md:text-[30px]">{b.text}</h2>;
    case 'h3':
      return <h3 className="mt-8 text-[18px] font-semibold text-[#1a1d29]">{b.text}</h3>;
    case 'verified':
      return <p className="mt-6 inline-flex rounded-full bg-[#f0f0f8] px-3 py-1 text-[13px] font-medium text-[#00122e]">{b.text}</p>;
    case 'p':
      return b.tone === 'note'
        ? <p className="mt-5 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-[14px] leading-[1.6] text-gray-600">{b.text}</p>
        : <p className="mt-4 text-[16px] leading-[1.65] text-gray-700">{b.text}</p>;
    case 'list': {
      const L = b.ordered ? 'ol' : 'ul';
      return (
        <L className={`mt-4 space-y-2.5 pl-5 text-[16px] leading-[1.6] text-gray-700 ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
          {b.items.map((i, n) => <li key={n} className="pl-1">{i.text}<SourceLink url={i.sourceUrl} /></li>)}
        </L>
      );
    }
    case 'table':
      return (
        <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full min-w-[640px] border-collapse text-left text-[14.5px] leading-[1.5]">
            <caption className="sr-only">{b.caption}</caption>
            <thead className="bg-gray-50">
              <tr>
                {b.columns.map((c, i) => <th key={i} scope="col" className="border-b border-gray-200 px-4 py-3 text-[13px] font-semibold text-[#1a1d29]">{c || <span className="sr-only">Topic</span>}</th>)}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri} className="align-top">
                  {r.map((c, ci) => ci === 0
                    ? <th key={ci} scope="row" className="border-b border-gray-100 px-4 py-3 text-[13.5px] font-medium text-[#1a1d29]">{c.text}</th>
                    : <td key={ci} className="border-b border-gray-100 px-4 py-3 text-gray-700">{c.text}<SourceLink url={c.sourceUrl} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'dialogue':
      return (
        <ol className="mt-4 space-y-3 rounded-xl border border-gray-200 p-5">
          {b.turns.map((t, i) => (
            <li key={i} className="grid gap-1 sm:grid-cols-[72px_1fr] sm:gap-4">
              <span className={`text-[12px] font-semibold uppercase tracking-[0.1em] ${t.speaker === 'agent' ? 'text-blue-600' : 'text-gray-500'}`}>{t.speaker === 'agent' ? 'Agent' : 'Caller'}</span>
              <span className="text-[15.5px] leading-[1.55] text-gray-700">{t.text}</span>
            </li>
          ))}
        </ol>
      );
    case 'cards':
      return (
        <ul className="mt-5 grid gap-4 sm:grid-cols-2">
          {b.items.map((c, i) => (
            <li key={i} className="flex flex-col rounded-xl border border-gray-200 bg-white p-6">
              <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[#1a1d29]">
                {c.href ? (c.external ? <a href={c.href} rel={EXT_REL} className={LINK}>{c.title}</a> : <Link href={c.href} className={LINK}>{c.title}</Link>) : c.title}
              </h3>
              <p className="mt-2 text-[14.5px] leading-[1.55] text-gray-600">{c.text}</p>
              {c.meta && <p className="mt-auto pt-3 text-[12.5px] text-gray-400">{c.meta}</p>}
            </li>
          ))}
        </ul>
      );
    case 'links':
      return (
        <nav aria-label={b.title} className="mt-12 rounded-xl border border-gray-200 p-6">
          <p className="text-[14px] font-semibold text-[#1a1d29]">{b.title}</p>
          <ul className="mt-3 space-y-2 text-[15px]">
            {b.items.map((l) => <li key={l.href}><Link href={l.href} className={LINK}>{l.label}</Link></li>)}
          </ul>
        </nav>
      );
    case 'faq':
      return (
        <dl className="mt-4 divide-y divide-gray-100 border-t border-gray-100">
          {b.items.map((f, i) => (
            <div key={i} className="py-4">
              <dt className="text-[16px] font-semibold text-[#1a1d29]">{f.q}</dt>
              <dd className="mt-1.5 text-[15.5px] leading-[1.6] text-gray-700">{f.a}</dd>
            </div>
          ))}
        </dl>
      );
    case 'sources':
      return (
        <ul className="mt-4 space-y-2 text-[14.5px] leading-[1.5] text-gray-600">
          {b.items.map((s) => (
            <li key={s.url}>
              <a href={s.url} rel={EXT_REL} className={LINK}>{s.title}</a>
              <span className="text-gray-400"> (retrieved {longDate(s.retrievedAt)})</span>
            </li>
          ))}
        </ul>
      );
  }
}

function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}

function Header({ m, preview }: { m: LibraryPageModel | HubModel; preview: boolean }) {
  return (
    <Container className="pt-12 pb-6 md:pt-20">
      <Breadcrumbs crumbs={m.breadcrumbs} />
      {preview && (
        <p role="note" className="mb-5 inline-block rounded-md bg-amber-50 px-3 py-1.5 text-[13px] font-medium text-amber-800">
          Preview: this page is not published yet, so search engines are told not to index it.
        </p>
      )}
      <h1 className="max-w-[820px] text-[34px] font-normal leading-[1.05] tracking-[-0.045em] text-[#00122e] md:text-[54px]">{m.h1}</h1>
      <p className="mt-5 max-w-[720px] text-[17px] leading-[1.55] text-gray-500">{m.lede}</p>
    </Container>
  );
}

export function LibraryPageView({ page, indexed }: { page: LibraryPageModel; indexed: boolean }) {
  return (
    <main>
      <JsonLd data={breadcrumbJsonLd(page.breadcrumbs)} />
      {page.faqJsonLd && <JsonLd data={faqJsonLd(page.faqJsonLd)} />}
      <Header m={page} preview={!indexed} />
      <Container className="pb-20">
        <article className="max-w-[820px]">
          {page.blocks.map((b, i) => <BlockView key={i} b={b} />)}
        </article>
      </Container>
    </main>
  );
}

export type HubItem = { href: string; title: string; text: string };

export function HubView({ hub, items, indexed, emptyNote }: { hub: HubModel; items: HubItem[]; indexed: boolean; emptyNote: string }) {
  return (
    <main>
      <JsonLd data={breadcrumbJsonLd(hub.breadcrumbs)} />
      <Header m={hub} preview={!indexed} />
      <Container className="pb-20">
        {items.length === 0 ? (
          <p className="max-w-[640px] text-[16px] leading-[1.6] text-gray-600">{emptyNote}</p>
        ) : (
          <ul className="grid gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-100 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((i) => (
              <li key={i.href} className="bg-white">
                <Link href={i.href} className="group block h-full p-6 transition-colors duration-200 hover:bg-[#f8f8fb]">
                  <span className="block text-[15px] font-medium text-[#00122e] group-hover:text-blue-600">{i.title}</span>
                  <span className="mt-2 block text-[13.5px] leading-[1.45] text-gray-500">{i.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Container>
    </main>
  );
}

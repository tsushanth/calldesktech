import { Container } from './primitives';

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main>
      <Container className="pt-16 pb-24 md:pt-24">
        <div className="max-w-[720px]">
          <h1 className="text-[40px] font-normal leading-[1.04] tracking-[-0.05em] text-[#00122e] md:text-[56px]">{title}</h1>
          <p className="mt-3 text-[14px] text-gray-400">Last updated {updated}</p>
          <div className="mt-10 space-y-8 text-[16px] leading-[1.65] text-gray-600 [&_h2]:mb-3 [&_h2]:text-[20px] [&_h2]:font-medium [&_h2]:tracking-[-0.02em] [&_h2]:text-[#00122e] [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_a]:text-blue-600 [&_a]:underline">
            {children}
          </div>
        </div>
      </Container>
    </main>
  );
}

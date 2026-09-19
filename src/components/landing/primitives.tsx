import Link from 'next/link';

/**
 * Shared landing-page primitives.
 *
 * Every measurement here comes from the computed-style sweep of the reference
 * site (docs/research/retellai-polish/FOUNDATION.md):
 *   container   1160px
 *   rhythm      140px major / 80px secondary vertical padding
 *   H2          37.5px, weight 400, line-height 1.05, tracking -0.06em
 *   H3          20px,   weight 400, line-height 1.2,  tracking -0.05em
 *   radii       12px cards / 6px buttons
 * Colours now match the dashboard's light Retell-console reskin (#1a1d29
 * text, gray-200 borders, blue-600 accent, white rounded-xl cards) — the
 * marketing page and the app used to look like two different products.
 */

export function Container({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-[1160px] px-6 ${className}`}>
      {children}
    </div>
  );
}

export function Section({
  id,
  children,
  size = 'major',
  className = '',
}: {
  id?: string;
  children: React.ReactNode;
  /** 'major' = 140px rhythm, 'secondary' = 80px rhythm. */
  size?: 'major' | 'secondary';
  className?: string;
}) {
  const pad =
    size === 'major'
      ? 'py-20 md:py-[140px]'
      : 'py-14 md:py-20';
  return (
    <section id={id} className={`${pad} scroll-mt-[72px] ${className}`}>
      <Container>{children}</Container>
    </section>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-blue-600">
      {children}
    </p>
  );
}

/** Section heading — same weight/tracking rhythm as the dashboard's page titles. */
export function SectionTitle({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`text-[32px] md:text-[44px] font-normal leading-[1.04] tracking-[-0.045em] text-[#00122e] ${className}`}
    >
      {children}
    </h2>
  );
}

export function SectionLead({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-5 max-w-[540px] text-[16px] leading-[1.5] text-gray-500">
      {children}
    </p>
  );
}

const BTN_BASE =
  'inline-flex items-center justify-center rounded-md font-medium transition-[opacity,transform,background-color,border-color] duration-150 hover:-translate-y-px active:translate-y-0';

export function PrimaryButton({
  href,
  children,
  size = 'md',
}: {
  href: string;
  children: React.ReactNode;
  size?: 'md' | 'lg';
}) {
  const s = size === 'lg' ? 'text-[15px] px-6 py-3.5' : 'text-[13px] px-4 py-2.5';
  return (
    <Link
      href={href}
      className={`${BTN_BASE} ${s} bg-[#00122e] text-white hover:bg-[#0a2450]`}
    >
      {children}
    </Link>
  );
}

export function SecondaryButton({
  href,
  children,
  size = 'md',
}: {
  href: string;
  children: React.ReactNode;
  size?: 'md' | 'lg';
}) {
  const s = size === 'lg' ? 'text-[15px] px-6 py-3.5' : 'text-[13px] px-4 py-2.5';
  return (
    <Link
      href={href}
      className={`${BTN_BASE} ${s} border border-transparent bg-[#f0f0f8] text-[#00122e] hover:bg-[#e6e6f2]`}
    >
      {children}
    </Link>
  );
}

/** Rounded-xl card, matching the dashboard's bordered white card treatment. */
export function Card({
  children,
  className = '',
  interactive = true,
}: {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-7 ${
        interactive
          ? 'transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-sm'
          : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[20px] font-semibold leading-[1.2] tracking-[-0.02em] text-[#1a1d29]">
      {children}
    </h3>
  );
}

export function CardBody({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 text-[15px] leading-[1.55] text-gray-500">{children}</p>
  );
}

/** Buttons for use on the dark gradient cards. */
export function LightButton({ href, children, size = 'md' }: { href: string; children: React.ReactNode; size?: 'md' | 'lg' }) {
  const s = size === 'lg' ? 'text-[15px] px-6 py-3.5' : 'text-[13px] px-4 py-2.5';
  return (
    <Link href={href} className={`${BTN_BASE} ${s} bg-white text-[#00122e] hover:bg-[#f0f0f8]`}>
      {children}
    </Link>
  );
}

export function GlassButton({ href, children, size = 'md' }: { href: string; children: React.ReactNode; size?: 'md' | 'lg' }) {
  const s = size === 'lg' ? 'text-[15px] px-6 py-3.5' : 'text-[13px] px-4 py-2.5';
  return (
    <Link href={href} className={`${BTN_BASE} ${s} border border-white/30 bg-white/10 text-white backdrop-blur hover:bg-white/20`}>
      {children}
    </Link>
  );
}

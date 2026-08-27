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
 * Colours are NOT ported — the reference is a light site; this app keeps its
 * own dark palette and the shared globals.css tokens untouched.
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
    <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-blue-400">
      {children}
    </p>
  );
}

/** Section heading — the reference's 37.5px / weight-400 / -0.06em signature. */
export function SectionTitle({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`text-[30px] md:text-[37.5px] font-normal leading-[1.05] tracking-[-0.045em] text-white ${className}`}
    >
      {children}
    </h2>
  );
}

export function SectionLead({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-5 max-w-[540px] text-[16px] leading-[1.5] text-gray-400">
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
      className={`${BTN_BASE} ${s} bg-blue-600 text-white hover:bg-blue-500`}
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
      className={`${BTN_BASE} ${s} border border-white/15 bg-white/[0.03] text-gray-200 hover:border-white/30 hover:bg-white/[0.06]`}
    >
      {children}
    </Link>
  );
}

/** 12px-radius card, matching the reference's dominant card radius. */
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
      className={`rounded-xl border border-white/10 bg-white/[0.025] p-7 ${
        interactive
          ? 'transition-[border-color,background-color,transform] duration-300 hover:-translate-y-0.5 hover:border-blue-500/40 hover:bg-white/[0.05]'
          : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[20px] font-normal leading-[1.2] tracking-[-0.04em] text-white">
      {children}
    </h3>
  );
}

export function CardBody({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 text-[15px] leading-[1.55] text-gray-400">{children}</p>
  );
}

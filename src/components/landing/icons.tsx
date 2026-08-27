/**
 * Minimal 20px stroke icons.
 *
 * Replaces the emoji the landing page previously used. The reference site
 * carries its capability grid on restrained monoline iconography; emoji render
 * at inconsistent weights and colours across platforms and were the single
 * biggest thing making this page read cheaper than the reference.
 */

type IconProps = { className?: string };

function Svg({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  );
}

export const Icons = {
  bolt: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
    </Svg>
  ),
  calendar: ({ className }: IconProps) => (
    <Svg className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="M8.5 14.5h3" />
    </Svg>
  ),
  book: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M4 5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v15a1.5 1.5 0 0 0-1.5-1.5H4V5Z" />
      <path d="M20 5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v15a1.5 1.5 0 0 1 1.5-1.5H20V5Z" />
    </Svg>
  ),
  blocks: ({ className }: IconProps) => (
    <Svg className={className}>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <path d="M17 13v8M13 17h8" />
    </Svg>
  ),
  chart: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 20v-6M13 20V8M18 20v-9" />
    </Svg>
  ),
  phone: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M5 3h4l2 5-2.5 1.5a12 12 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2.2 2A17 17 0 0 1 3 5.2 2 2 0 0 1 5 3Z" />
    </Svg>
  ),
  chat: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5Z" />
      <path d="M9 11h6M9 14.5h3.5" />
    </Svg>
  ),
  transfer: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" />
    </Svg>
  ),
  note: ({ className }: IconProps) => (
    <Svg className={className}>
      <path d="M5 3.5h9.5L19.5 8v12.5h-14z" />
      <path d="M14 3.5V8h5" />
      <path d="M8.5 12.5h7M8.5 16h4.5" />
    </Svg>
  ),
};

export type IconName = keyof typeof Icons;

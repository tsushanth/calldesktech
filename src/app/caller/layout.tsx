import type { Metadata } from 'next';

// Private working pages for the hired callers: never indexed, never cached.
export const metadata: Metadata = {
  title: 'Calls | CallDesk',
  robots: { index: false, follow: false },
};

export default function CallerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

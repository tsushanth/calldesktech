import type { Metadata } from 'next';

// Private working pages for the hired callers: never indexed, never cached.
export const metadata: Metadata = {
  title: 'Calls | CallDesk',
  robots: { index: false, follow: false },
};

// These pages are written with dark text on a white page, so they always use the light theme. Without this, a browser or phone in
// dark mode got the site's near-black page background underneath dark text, which made the pages unreadable.
export default function CallerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-gray-900" style={{ colorScheme: 'light' }}>
      {children}
    </div>
  );
}

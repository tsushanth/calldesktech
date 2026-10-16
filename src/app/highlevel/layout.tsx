import { SiteHeader } from '@/components/landing/SiteHeader';
import { SiteFooter } from '@/components/landing/Closing';

// The HighLevel link pages use the same white navy shell as the other public pages. Without it the page has no background of its own and
// its dark navy text sits on the site's near-black body in dark mode.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="brand-navy min-h-screen bg-white text-[#00122e]">
      <SiteHeader />
      <div className="pt-[72px]">{children}</div>
      <SiteFooter />
    </div>
  );
}

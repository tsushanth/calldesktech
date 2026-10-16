import { SiteHeader } from '@/components/landing/SiteHeader';
import { SiteFooter } from '@/components/landing/Closing';

// Same chrome as the other public pages (privacy, docs): the site header and footer on a white page.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="brand-navy min-h-screen bg-white text-[#00122e]">
      <SiteHeader />
      <div className="pt-[72px]">{children}</div>
      <SiteFooter />
    </div>
  );
}

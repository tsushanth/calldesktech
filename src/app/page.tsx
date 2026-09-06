import Link from "next/link";

import { SiteHeader } from "@/components/landing/SiteHeader";
import { Hero } from "@/components/landing/Hero";
import { CallPreview } from "@/components/landing/CallPreview";
import {
  BuildingBlocks,
  Capabilities,
  HowItWorks,
} from "@/components/landing/Sections";
import { FAQ, FinalCTA, SiteFooter } from "@/components/landing/Closing";

// Light theme, matching the dashboard's own Retell-console reskin — this
// used to be a dark gradient page with a serif/italic display font while the
// dashboard was light and plain Geist sans, so the marketing site and the
// app read as two unrelated products.
export default function Home() {
  return (
    <div className="min-h-screen bg-[#f7f8fa] text-[#1a1d29]">
      <SiteHeader />

      <main>
        <Hero />
        <CallPreview />
        <Capabilities />
        <BuildingBlocks />
        <HowItWorks />
        <FAQ />
        <FinalCTA />
      </main>

      {/* Persistent demo CTA — pre-existing, retained. */}
      <Link
        href="/demo"
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-blue-600 py-3 pl-4 pr-5 text-white shadow-lg shadow-blue-900/40 transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-blue-500"
      >
        <span aria-hidden className="text-lg">
          🎧
        </span>
        <span className="text-sm font-semibold tracking-[-0.01em]">
          Try Live Demo
        </span>
      </Link>

      <SiteFooter />
    </div>
  );
}

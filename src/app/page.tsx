import Link from "next/link";
import { Instrument_Serif } from "next/font/google";

import { SiteHeader } from "@/components/landing/SiteHeader";
import { Hero } from "@/components/landing/Hero";
import { CallPreview } from "@/components/landing/CallPreview";
import {
  BuildingBlocks,
  Capabilities,
  HowItWorks,
} from "@/components/landing/Sections";
import { FAQ, FinalCTA, SiteFooter } from "@/components/landing/Closing";

// Scoped to this page only — the rest of the app stays on Geist (see
// layout.tsx). A serif display face gives the hero an editorial moment
// without touching the body/UI type used everywhere else.
const displayFont = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-display",
});

export default function Home() {
  return (
    <div
      className={`${displayFont.variable} min-h-screen bg-gradient-to-b from-gray-900 to-black text-white`}
    >
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

import Link from "next/link";
import { Instrument_Serif } from "next/font/google";

// Scoped to this page only — the rest of the app stays on Geist (see
// layout.tsx). A serif display face gives the hero an editorial moment
// without touching the body/UI type used everywhere else.
const displayFont = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-display",
});

const NAV_LINKS = [
  { href: "#capabilities", label: "Capabilities" },
  { href: "#how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
];

export default function Home() {
  return (
    <div className={`${displayFont.variable} min-h-screen bg-gradient-to-b from-gray-900 to-black text-white`}>
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-gray-900/70 border-b border-white/5">
        <nav className="container mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold tracking-tight">
            CallDeskTech
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm text-gray-300">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="hover:text-white transition">
                {link.label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="hidden sm:block text-sm text-gray-300 hover:text-white transition">
              Dashboard
            </Link>
            <Link
              href="/auth/login"
              className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium transition"
            >
              Sign In
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <main className="container mx-auto px-6">
        <section className="pt-20 pb-16 md:pt-28 md:pb-24">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-xs font-semibold tracking-[0.2em] text-blue-400 uppercase mb-6">
              AI receptionist, built from real capabilities
            </p>
            <h1
              className="text-5xl md:text-7xl mb-7 leading-[1.05]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Your phone,
              <br />
              <span className="italic text-blue-400">finally handled.</span>
            </h1>
            <p className="text-lg md:text-xl text-gray-400 mb-10 max-w-xl mx-auto leading-relaxed">
              Answer questions, book appointments, transfer callers, or take a message —
              pick what your business needs, hear it work in under a minute, and go live today.
            </p>
            <div className="flex flex-wrap gap-4 justify-center">
              <Link
                href="/demo"
                className="bg-blue-600 hover:bg-blue-700 px-8 py-4 rounded-lg text-lg font-semibold transition"
              >
                Try Free Demo
              </Link>
              <Link
                href="/pricing"
                className="border border-gray-600 hover:border-gray-400 px-8 py-4 rounded-lg text-lg font-semibold transition"
              >
                See Pricing
              </Link>
            </div>
          </div>

          {/* Live capability strip — honest substitute for customer-logo social
              proof: this product has no public customers to show yet, so lead
              with the actual capabilities a prospect can hear demoed instead. */}
          <div className="mt-16 max-w-3xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { icon: "💬", label: "Answers FAQs" },
              { icon: "📅", label: "Books appointments" },
              { icon: "📞", label: "Transfers calls" },
              { icon: "📝", label: "Takes messages" },
            ].map((cap) => (
              <div
                key={cap.label}
                className="flex items-center gap-2 justify-center bg-white/[0.03] border border-white/10 rounded-lg py-3 px-3 text-sm text-gray-300"
              >
                <span>{cap.icon}</span>
                <span>{cap.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="capabilities" className="py-24 scroll-mt-20">
          <h2 className="text-3xl font-bold text-center mb-4">
            Everything you need to automate your phone
          </h2>
          <p className="text-center text-gray-400 mb-12 max-w-xl mx-auto">
            Turn on only what your business needs — every capability below ships as a real,
            testable building block, not a marketing bullet point.
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            <FeatureCard
              icon="phone"
              title="Sub-500ms Latency"
              description="Semantic turn detection instead of dead-air silence timers. No awkward robot pauses."
            />
            <FeatureCard
              icon="calendar"
              title="Calendar Integration"
              description="Sync with Google, Outlook, and iCal via Cal.com. Real-time availability."
            />
            <FeatureCard
              icon="brain"
              title="Knowledge Base"
              description="Upload your FAQ or scrape your website. The AI answers questions accurately."
            />
            <FeatureCard
              icon="flow"
              title="Building Blocks"
              description="Booking, transfer, and message-taking are independent toggles — add or remove them anytime."
            />
            <FeatureCard
              icon="analytics"
              title="Call Analytics"
              description="Track call volume, booking rates, and the questions callers actually ask."
            />
            <FeatureCard
              icon="phone-number"
              title="Phone Numbers"
              description="Get a dedicated number or use your existing one. Works worldwide."
            />
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="py-24 scroll-mt-20">
          <h2 className="text-3xl font-bold text-center mb-12">
            How it works
          </h2>
          <div className="grid md:grid-cols-4 gap-6">
            <Step number={1} title="Try a capability" description="Hear exactly one thing it does — FAQs, booking, transfer, or messages" />
            <Step number={2} title="Pick your blocks" description="Choose which ones your business actually needs, nothing else" />
            <Step number={3} title="Add your info" description="Business hours, services, and calendar — takes a couple minutes" />
            <Step number={4} title="Go live" description="Get your phone number and start taking calls today" />
          </div>
        </section>
      </main>

      {/* Persistent demo CTA */}
      <Link
        href="/demo"
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white pl-4 pr-5 py-3 rounded-full shadow-lg shadow-blue-900/40 transition"
      >
        <span className="text-lg">🎧</span>
        <span className="text-sm font-semibold">Try Live Demo</span>
      </Link>

      {/* Footer */}
      <footer className="container mx-auto px-6 py-12 mt-12 border-t border-gray-800">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="text-gray-500 text-sm">
            © 2026 CallDeskTech.
          </div>
          <div className="flex gap-6 text-gray-500 text-sm">
            <a href="#" className="hover:text-white">Privacy</a>
            <a href="#" className="hover:text-white">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  const icons: Record<string, string> = {
    phone: "📞",
    calendar: "📅",
    brain: "🧠",
    flow: "🧩",
    analytics: "📊",
    "phone-number": "📱",
  };

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 hover:border-blue-500/50 transition">
      <div className="text-4xl mb-4">{icons[icon]}</div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-gray-400">{description}</p>
    </div>
  );
}

function Step({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center">
      <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
        {number}
      </div>
      <h3 className="font-semibold mb-2">{title}</h3>
      <p className="text-gray-400 text-sm">{description}</p>
    </div>
  );
}

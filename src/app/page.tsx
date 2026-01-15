import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white">
      {/* Header */}
      <header className="container mx-auto px-6 py-6">
        <nav className="flex items-center justify-between">
          <div className="text-2xl font-bold">CallDeskTech</div>
          <div className="flex gap-6">
            <Link href="/dashboard" className="hover:text-blue-400 transition">
              Dashboard
            </Link>
            <Link
              href="/auth/login"
              className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition"
            >
              Sign In
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <main className="container mx-auto px-6 py-20">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
            AI Receptionist for
            <span className="text-blue-500"> Any Business</span>
          </h1>
          <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
            Deploy a low-latency AI phone assistant that answers calls, books
            appointments, and handles customer questions - all in under 500ms.
          </p>
          <div className="flex gap-4 justify-center">
            <Link
              href="/dashboard"
              className="bg-blue-600 hover:bg-blue-700 px-8 py-4 rounded-lg text-lg font-semibold transition"
            >
              Get Started Free
            </Link>
            <a
              href="#features"
              className="border border-gray-600 hover:border-gray-400 px-8 py-4 rounded-lg text-lg font-semibold transition"
            >
              Learn More
            </a>
          </div>
        </div>

        {/* Features */}
        <section id="features" className="mt-32">
          <h2 className="text-3xl font-bold text-center mb-12">
            Everything you need to automate your phone
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard
              icon="phone"
              title="Sub-500ms Latency"
              description="Powered by Retell AI's semantic turn detection. No awkward robot pauses."
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
              title="Flow Builder"
              description="Design conversation flows with a visual editor. No code required."
            />
            <FeatureCard
              icon="analytics"
              title="Call Analytics"
              description="Track call volume, booking rates, and common questions."
            />
            <FeatureCard
              icon="phone-number"
              title="Phone Numbers"
              description="Get a dedicated number or use your existing one. Works worldwide."
            />
          </div>
        </section>

        {/* How it works */}
        <section className="mt-32">
          <h2 className="text-3xl font-bold text-center mb-12">
            How it works
          </h2>
          <div className="grid md:grid-cols-4 gap-6">
            <Step number={1} title="Create Account" description="Sign up and create your business profile" />
            <Step number={2} title="Add Knowledge" description="Upload FAQs or connect your website" />
            <Step number={3} title="Connect Calendar" description="Link your Google or Outlook calendar" />
            <Step number={4} title="Go Live" description="Get your phone number and start taking calls" />
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="container mx-auto px-6 py-12 mt-20 border-t border-gray-800">
        <div className="flex justify-between items-center">
          <div className="text-gray-500">
            2026 CallDeskTech. Built with Retell AI.
          </div>
          <div className="flex gap-6 text-gray-500">
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
    flow: "🔀",
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

import { SiteHeader } from "@/components/landing/SiteHeader";
import { Hero } from "@/components/landing/Hero";
import { CallPreview } from "@/components/landing/CallPreview";
import {
  BuildingBlocks,
  Capabilities,
  HowItWorks,
} from "@/components/landing/Sections";
import { FAQ, FinalCTA, SiteFooter } from "@/components/landing/Closing";
import { ContactCenter, Developers, Studio, Trust, UseCases } from "@/components/landing/Platform";
import type { UseCaseGroup } from "@/components/landing/UseCases";
import { listTemplates } from "@/lib/templateInstall";

// Templates grouped by what the caller is trying to do. Any template not listed
// here still counts toward the total but is not shown until it is grouped.
const GROUPS: { id: string; label: string; blurb: string; ids: string[] }[] = [
  { id: 'reception', label: 'Reception and scheduling', blurb: 'Answer, qualify and book, for clinics, shops, law firms and service businesses.', ids: ['receptionist', 'message-taking', 'appointment-booking', 'service-appointment', 'medical-receptionist', 'reminder-no-show-reducer', 'rider-appointment-booking', 'after-hours-law-firm-receptionist', 'legal-intake-screener'] },
  { id: 'support', label: 'Support and routing', blurb: 'Handle common questions, find the right team, and escalate to a person when it matters.', ids: ['after-hours-support-guard', 'support-triage-bot', 'faq-voice-agent', 'multi-department-router', 'order-status-checker', 'delivery-status-caller', 'multilingual-agent', 'live-call-translator'] },
  { id: 'outbound', label: 'Outbound and collections', blurb: 'Reach customers first: reminders, win-backs, lead screening and payment follow-up.', ids: ['outbound-sales-reactivation', 'win-back-campaign', 'payment-reminder-caller', 'payment-collection-agent', 'payment-collection', 'high-intent-lead-screener', 'b2b-demo-qualification', 'event-webinar-reminder', 'lead-reactivation-campaign', 'outreach-dialer'] },
  { id: 'verification', label: 'Verification and phone menus', blurb: 'Call other organisations for you: check coverage, chase records, and navigate their phone menus.', ids: ['insurance-verification-caller', 'pharmacy-refill-caller', 'provider-office-follow-up', 'ivr-navigation', 'ivr-navigation-bot', 'ivr-navigation-payment-bot', 'document-request-caller'] },
];

function useCaseGroups(): { groups: UseCaseGroup[]; total: number } {
  const all = listTemplates();
  const byId = new Map(all.map((t) => [t.id, t]));
  const groups = GROUPS.map((g) => ({
    id: g.id, label: g.label, blurb: g.blurb,
    templates: g.ids.map((id) => byId.get(id)).filter((t): t is NonNullable<typeof t> => !!t).map((t) => ({ id: t.id, label: t.label, description: t.description })),
  }));
  return { groups, total: all.length };
}

// Light theme, matching the dashboard's own Retell-console reskin — this
// used to be a dark gradient page with a serif/italic display font while the
// dashboard was light and plain Geist sans, so the marketing site and the
// app read as two unrelated products.
export default function Home() {
  const { groups, total } = useCaseGroups();
  return (
    <div className="min-h-screen bg-white text-[#00122e]">
      <SiteHeader />

      <main>
        <Hero />
        <CallPreview />
        <UseCases groups={groups} total={total} />
        <Studio />
        <Capabilities />
        <BuildingBlocks />
        <ContactCenter />
        <HowItWorks />
        <Developers />
        <Trust />
        <FAQ />
        <FinalCTA />
      </main>

      <SiteFooter />
    </div>
  );
}

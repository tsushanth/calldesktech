/**
 * Data for the generic /compare/[slug] competitor pages.
 *
 * Sourced from a live research pass (Sept 2026) against each competitor's
 * own pricing pages, docs, and trust/security pages — not from training-data
 * memory, since pricing and certifications drift. Where a fact could only be
 * confirmed via a third-party summary rather than a direct primary-source
 * fetch, the row's note says so explicitly rather than presenting it as
 * confirmed. Retell and ThunderPhone have their own richer, hand-built pages
 * (src/app/compare/retell, src/app/compare/thunderphone) because we have
 * real head-to-head call data for those two — everyone else here is built
 * from public-source research only, which is a lower bar of evidence and the
 * copy is written to reflect that.
 */

export type Verdict = 'ahead' | 'have' | 'partial' | 'gap' | 'neither';

export type CompareRow = {
  group: string;
  item: string;
  us: string;
  them: string;
  verdict: Verdict;
  note?: string;
};

export type CompareStat = {
  label: string;
  us: string;
  them: string;
};

export type CompetitorEntry = {
  slug: string;
  name: string;
  shortName: string;
  metaTitle: string;
  metaDescription: string;
  heroHeadline: string;
  heroSub: string;
  stats: CompareStat[];
  rows: CompareRow[];
  caveat: string;
};

const US_BUILDER =
  'Node-based flow builder: 17 node types (extraction, knowledge-base lookup, payment, MCP call, subflow, agent handoff) built and shipped.';

export const COMPETITORS: CompetitorEntry[] = [
  {
    slug: 'vapi',
    name: 'Vapi',
    shortName: 'Vapi',
    metaTitle: 'CallDeskTech vs Vapi | CallDeskTech',
    metaDescription: 'How CallDeskTech compares with Vapi on pricing, languages, telephony, compliance, and testing tooling.',
    heroHeadline: 'One flat rate instead of five separate bills.',
    heroSub: 'Vapi’s $0.05/min platform fee is just the starting line — transcription, LLM, voice, and telephony are billed separately on top. We priced ours to include all of that.',
    stats: [
      { label: 'Price per minute', us: '$0.10 flat', them: '$0.05 + STT + LLM + TTS + telephony' },
      { label: 'Compliance', us: 'None yet', them: 'SOC 2 Type II, SOC 3' },
      { label: 'Automated call testing', us: 'Not built yet', them: 'Test Suites + Call Analysis' },
    ],
    rows: [
      { group: 'Pricing', item: 'Per-minute cost', us: '$0.10/min flat, all-in (default voice)', them: 'A $0.05/min platform fee plus separate transcription ($0.0095–$0.0099), LLM ($0.0077–$0.0452), voice ($0.0146–$0.0238), and telephony charges', verdict: 'ahead', note: 'Third-party reviews (not Vapi’s own site) estimate the realistic stacked total lands around $0.07–$0.25+/min depending on providers chosen.' },
      { group: 'Pricing', item: 'Plan structure', us: 'No monthly minimum, no concurrency tiers', them: 'Free/Core/Pro/Premier tiers; Pro requires a $999/mo minimum', verdict: 'ahead' },
      { group: 'Languages', item: 'Coverage', us: '49 languages, each verified on a real call', them: 'No single published count — depends on which transcriber/voice provider is selected (e.g. Talkscriber ~100, Gladia 110+ languages)', verdict: 'partial', note: 'Not a like-for-like comparison: their number is provider capability, ours is real-call-verified.' },
      { group: 'Telephony', item: 'SIP trunking', us: 'Not available yet — buy a number or forward one you own', them: 'BYO SIP trunk supported natively, plus native Twilio and Telnyx integrations', verdict: 'gap' },
      { group: 'Compliance', item: 'Certifications', us: 'None yet — audit logging shipped, formal certification not started', them: 'SOC 2 Type II and SOC 3, independently audited (per their public trust center)', verdict: 'gap', note: 'HIPAA is a separate paid add-on on their side, not blanket-included.' },
      { group: 'Testing', item: 'Automated call testing', us: 'In-browser manual test calls; no automated simulation suite yet', them: 'Test Suites (LLM-judged scripted simulations) and automatic per-call Call Analysis', verdict: 'gap' },
      { group: 'Building the agent', item: 'Builder & tools', us: US_BUILDER, them: 'Prompt/config-based assistant definition; MCP support in both directions (agent calls tools, or external MCP clients manage Vapi)', verdict: 'have', note: 'We couldn’t confirm whether Vapi’s builder is visual/flow-based — their docs describe configuration, not a canvas.' },
    ],
    caveat: 'Vapi’s figures come from their own pricing page and public trust center as of September 2026, not a hands-on account audit. Some details (exact HIPAA add-on price, a single language count, batch calling) aren’t published anywhere we could find — we’ve left those out rather than guess.',
  },
  {
    slug: 'bland-ai',
    name: 'Bland AI',
    shortName: 'Bland',
    metaTitle: 'CallDeskTech vs Bland AI | CallDeskTech',
    metaDescription: 'How CallDeskTech compares with Bland AI on pricing, telephony, compliance, and automated testing.',
    heroHeadline: 'Similar builder philosophy, different price floor.',
    heroSub: 'Bland AI also builds agents as a flow graph — the closest philosophical match to how we build. The real differences show up in price, telephony, and how each side proves compliance.',
    stats: [
      { label: 'Starting price per minute', us: '$0.10', them: '$0.14 (Start tier)' },
      { label: 'SIP trunking & number porting', us: 'Not yet', them: 'Yes, both' },
      { label: 'Compliance certifications', us: 'None yet', them: 'SOC 2 Type II, HIPAA, PCI DSS v4.0' },
    ],
    rows: [
      { group: 'Pricing', item: 'Per-minute cost', us: '$0.10/min flat, all-in', them: 'Start: $0.14/min. Build: $0.12/min + $299/mo platform fee. Enterprise: custom.', verdict: 'ahead', note: 'Their rate is stated as fully inclusive, no separate LLM charge — a fair, simple model, just priced higher at entry.' },
      { group: 'Languages', item: 'Coverage', us: '49 languages, each verified on a real call', them: 'Unclear — their own sources conflict between roughly 40 languages and a ~99-language tier ("Babel")', verdict: 'partial', note: 'We couldn’t resolve which number is current; flagging rather than picking one.' },
      { group: 'Telephony', item: 'SIP trunking & number porting', us: 'Not available yet — buy a number or forward one you own', them: 'Full SIP trunking (inbound/outbound/bidirectional) and a documented number-porting process (7–14 business days)', verdict: 'gap' },
      { group: 'Telephony', item: 'Batch calling', us: 'Have', them: 'Have, via a documented API endpoint', verdict: 'have' },
      { group: 'Compliance', item: 'Certifications', us: 'None yet', them: 'SOC 2 Type II, PCI DSS v4.0, GDPR DPA on enterprise contracts; HIPAA BAA available but gated to Enterprise plans', verdict: 'gap' },
      { group: 'Testing', item: 'Automated call testing', us: 'In-browser manual test calls; no automated simulation suite yet', them: 'A per-node "Testbed," plus LLM-judged evaluation tooling described in their docs (Standards/Scenarios/Evals)', verdict: 'gap', note: 'Exact tool names sourced from third-party summaries of their docs, not independently confirmed word-for-word.' },
      { group: 'Building the agent', item: 'Builder philosophy', us: US_BUILDER, them: 'Flow/graph-based builder ("Pathways") with nodes and conditional edges — the same category of tool as ours', verdict: 'have', note: 'This is a genuine parity item, not a win either way — both platforms build agents as a graph.' },
    ],
    caveat: 'Bland’s figures come from their public pricing and trust-and-security pages as of September 2026. Their pricing has changed more than once in the past year, so treat the per-minute numbers as a snapshot, not a permanent rate.',
  },
  {
    slug: 'elevenlabs-agents',
    name: 'ElevenLabs Agents',
    shortName: 'ElevenLabs',
    metaTitle: 'CallDeskTech vs ElevenLabs Agents | CallDeskTech',
    metaDescription: 'How CallDeskTech compares with ElevenLabs Agents on pricing, languages, telephony, compliance, and testing.',
    heroHeadline: 'No subscription tier to outgrow.',
    heroSub: 'ElevenLabs prices agents like a SaaS seat — a monthly plan with an included-minutes bucket, then overage. We price by the minute from the first call.',
    stats: [
      { label: 'Pricing model', us: 'Flat $0.10/min, no plan', them: '$0–$990/mo tiers + $0.08/min overage' },
      { label: 'Automated call testing', us: 'Not built yet', them: 'Simulation, scenario & tool-call tests' },
      { label: 'Compliance', us: 'None yet', them: 'Claimed (not independently confirmed)' },
    ],
    rows: [
      { group: 'Pricing', item: 'Model', us: '$0.10/min flat, no subscription', them: 'Free through Business tiers ($0–$990/mo) with an included-minutes bucket, then $0.08/min pay-as-you-go overage (burst pricing $0.16/min if you exceed your plan’s concurrency)', verdict: 'ahead', note: 'LLM usage is billed separately from the voice rate on their side, deducted from credits — the effective per-minute cost depends on which model you pick.' },
      { group: 'Languages', item: 'Coverage', us: '49 languages, each verified on a real call, consistent across our voice providers', them: 'Depends on the underlying voice model selected — 74 languages on their newest model, as few as 29 on an older one', verdict: 'partial', note: 'Their count is model capability, not per-agent real-call verification.' },
      { group: 'Telephony', item: 'SIP trunking', us: 'Not available yet — buy a number or forward one you own', them: 'BYO number via SIP trunking; batch calling supported', verdict: 'gap', note: 'A formal number-porting service (as opposed to SIP-trunk BYO) isn’t clearly documented on their side either.' },
      { group: 'Compliance', item: 'Certifications', us: 'None yet', them: 'SOC 2, ISO 27001, PCI DSS, and HIPAA/GDPR are claimed on their compliance page', verdict: 'gap', note: 'We could not independently load their compliance page to confirm current badges — treat as vendor-claimed, not verified by us.' },
      { group: 'Testing', item: 'Automated call testing', us: 'In-browser manual test calls; no automated simulation suite yet', them: 'A dedicated Agent Testing framework: simulation tests, scenario tests, tool-call tests, plus a Simulate Conversations API', verdict: 'gap' },
      { group: 'Building the agent', item: 'Builder', us: US_BUILDER, them: 'Prompt/config-based agent definition, tightly integrated with their own voice-cloning and TTS stack', verdict: 'have' },
    ],
    caveat: 'Figures come from ElevenLabs’ own pricing and documentation pages as of September 2026. Their compliance-badge page did not load for us to verify directly — we’re repeating their public claim, not confirming it.',
  },
  {
    slug: 'smith-ai',
    name: 'Smith.ai',
    shortName: 'Smith.ai',
    metaTitle: 'CallDeskTech vs Smith.ai | CallDeskTech',
    metaDescription: 'How CallDeskTech compares with Smith.ai, including its human-backed receptionist model, on pricing, languages, and testing.',
    heroHeadline: 'Two different products wearing the same category label.',
    heroSub: 'Smith.ai’s core offer is a network of live human receptionists, with AI as one path through it. We’re AI-only. That’s worth knowing before comparing a price tag.',
    stats: [
      { label: 'Pricing unit', us: 'Per minute', them: 'Per call' },
      { label: 'Languages', us: '49, real-call-verified', them: 'English + Spanish' },
      { label: 'Live human backup', us: 'No', them: 'Yes — 500+ NA-based receptionists' },
    ],
    rows: [
      { group: 'Pricing', item: 'Unit & rates', us: '$0.10/min flat', them: 'AI Receptionist: free for 25 calls/mo, then $150/mo for 75 calls ($2–$2.50/call overage). Live/Virtual Receptionist (human-staffed): from $300/mo for 30 calls.', verdict: 'ahead', note: 'Per-call pricing means a long call costs the same as a short one on their side — not directly comparable to a per-minute rate without knowing average call length.' },
      { group: 'Product model', item: 'Human backup', us: 'AI-only', them: 'Genuinely hybrid: AI handles routine calls, live North America-based humans available as a built-in escalation network', verdict: 'neither', note: 'Not a gap or a win — a different product decision. If a caller needs a human every time, that’s their advantage; if you want AI-only at scale, it’s ours.' },
      { group: 'Languages', item: 'Coverage', us: '49 languages, each verified on a real call', them: 'English and Spanish only; Spanish is a paid per-call add-on', verdict: 'ahead' },
      { group: 'Telephony', item: 'Number setup', us: 'Buy a number, or forward one you own', them: 'Call forwarding from your existing number — no SIP trunking or BYO-number swap documented', verdict: 'have' },
      { group: 'Compliance', item: 'Certifications', us: 'None yet', them: 'No public SOC 2, HIPAA, or GDPR attestation found', verdict: 'neither', note: 'Third-party review sites claim HIPAA compliance for them, but we couldn’t find a primary-source page confirming it — same open gap on both sides.' },
      { group: 'Testing', item: 'Pre-launch testing', us: 'In-browser manual test calls', them: '"Quality Studio": up to 50 simulated call scenarios per month before going live', verdict: 'gap' },
    ],
    caveat: 'Smith.ai figures come from their public pricing pages as of September 2026. Their per-call pricing and our per-minute pricing measure different things — do the math against your own average call length before treating either number as "cheaper."',
  },
  {
    slug: 'goodcall',
    name: 'Goodcall',
    shortName: 'Goodcall',
    metaTitle: 'CallDeskTech vs Goodcall | CallDeskTech',
    metaDescription: 'How CallDeskTech compares with Goodcall on pricing, telephony, and testing for small-business phone answering.',
    heroHeadline: 'Unlimited minutes, metered callers.',
    heroSub: 'Goodcall doesn’t charge by the minute at all — it caps unique monthly callers instead. A different meter than ours, worth understanding before you compare a bill.',
    stats: [
      { label: 'Pricing unit', us: 'Per minute', them: 'Per agent, metered by unique caller' },
      { label: 'Number porting', us: 'Not yet', them: 'Not supported at all' },
      { label: 'Languages', us: '49, real-call-verified', them: 'Not formally listed' },
    ],
    rows: [
      { group: 'Pricing', item: 'Model', us: '$0.10/min flat', them: 'Starter $79/mo, Growth $129/mo, Scale $249/mo — unlimited minutes, but $0.50 per unique caller past the plan’s monthly cap (100/250/500)', verdict: 'neither', note: 'Genuinely different unit — a business with few long calls could do better on their model; one with many short calls could do better on ours.' },
      { group: 'Languages', item: 'Coverage', us: '49 languages, each verified on a real call', them: 'Marketing copy claims multilingual support with mid-call switching, but no dedicated supported-languages list was published', verdict: 'ahead' },
      { group: 'Telephony', item: 'Number porting', us: 'Not available yet — buy a number or forward one you own', them: 'Explicitly not supported — their own help center states you cannot port a number in, forwarding only', verdict: 'have', note: 'Neither of us supports true porting yet; we’re marking this a wash rather than claiming an edge.' },
      { group: 'Telephony', item: 'SIP trunking, batch calling, public API', us: 'Not available yet', them: 'No public documentation found for any of the three', verdict: 'neither' },
      { group: 'Compliance', item: 'Certifications', us: 'None yet', them: 'SOC 2, HIPAA, and ISO 27001 are claimed on their homepage, but their trust-center page didn’t render enough content for us to verify it', verdict: 'neither', note: 'Both sides are effectively unverified here — we’re just being explicit that we haven’t started, where they’ve claimed without us being able to confirm.' },
      { group: 'Testing', item: 'Pre-launch testing', us: 'In-browser manual test calls', them: 'No sandbox or test-call mode found in their documentation; multiple third-party reviews report changes go live immediately', verdict: 'have' },
    ],
    caveat: 'Goodcall figures come from their public pricing and help-center pages as of September 2026. Compliance claims on their homepage could not be independently verified — treat as their statement, not a confirmed fact.',
  },
  {
    slug: 'synthflow',
    name: 'Synthflow',
    shortName: 'Synthflow',
    metaTitle: 'CallDeskTech vs Synthflow | CallDeskTech',
    metaDescription: 'How CallDeskTech compares with Synthflow on pricing, compliance certifications, and telephony for enterprise voice AI.',
    heroHeadline: 'A five-figure enterprise floor versus a flat rate.',
    heroSub: 'Synthflow’s public pricing page shows one number: a $30,000-a-year enterprise plan. We publish a per-minute rate anyone can start on today.',
    stats: [
      { label: 'Published starting price', us: '$0.10/min, no minimum', them: '$30,000/year (Enterprise, the only published tier)' },
      { label: 'Compliance certifications', us: 'None yet', them: 'SOC 2, ISO 27001, ISO 42001, PCI DSS v4.0.1' },
      { label: 'SIP/PBX trunking', us: 'Not yet', them: 'Yes, Enterprise-tier only' },
    ],
    rows: [
      { group: 'Pricing', item: 'Published rate', us: '$0.10/min flat, all-in', them: 'Their pricing page currently shows only an Enterprise plan starting at $30,000/year; third-party sites report a pay-as-you-go blend of roughly $0.15–$0.37/min, but we couldn’t confirm that on a Synthflow-owned page', verdict: 'ahead' },
      { group: 'Languages', item: 'Coverage', us: '49 languages, each verified on a real call', them: '30+ languages listed in their documentation, with mid-call switching across a named set', verdict: 'partial', note: 'A real, published list on their side — fewer languages than ours, but a fair comparison unlike some competitors with no list at all.' },
      { group: 'Telephony', item: 'SIP/PBX trunking', us: 'Not available yet', them: 'Available, but explicitly gated to their Enterprise plan — not included on lower tiers', verdict: 'gap' },
      { group: 'Compliance', item: 'Certifications', us: 'None yet', them: 'SOC 2 Type 2, ISO/IEC 27001:2022, ISO/IEC 42001:2023 (AI management), and PCI DSS v4.0.1 — all stated as audited certifications on their trust center', verdict: 'gap', note: 'GDPR/HIPAA/DORA are framed as contractual alignment (DPA/BAA), not certifications, on their own page — worth the distinction.' },
      { group: 'Testing', item: 'Pre-launch testing', us: 'In-browser manual test calls', them: 'A sandbox/test-agent workflow is documented, plus an "Auto-QA" claim on their homepage — not as thoroughly documented as their compliance posture', verdict: 'gap' },
      { group: 'Building the agent', item: 'Builder', us: US_BUILDER, them: 'A visual "Flow Designer," the same category of tool as ours, positioned for enterprise/high-volume contact-center use', verdict: 'have' },
    ],
    caveat: 'Synthflow’s Enterprise pricing and compliance certifications are confirmed on their own pricing and trust-center pages as of September 2026. Their self-serve pay-as-you-go rate could not be confirmed on a first-party page — we’ve flagged that number as third-party-sourced rather than presenting it as fact.',
  },
  {
    slug: 'phonely',
    name: 'Phonely',
    shortName: 'Phonely',
    metaTitle: 'CallDeskTech vs Phonely | CallDeskTech',
    metaDescription: 'How CallDeskTech compares with Phonely on pricing, compliance, and testing tooling.',
    heroHeadline: 'No cliff when you run out of included minutes.',
    heroSub: 'Phonely’s plans include a minute bucket, then charge more per minute once you exceed it. Our rate doesn’t change based on how much you use it.',
    stats: [
      { label: 'Overage rate', us: 'Same as base: $0.10/min', them: '$0.25–$0.35/min past plan minutes' },
      { label: 'Compliance', us: 'None yet', them: 'SOC 2 Type II, HIPAA' },
      { label: 'Batch/outbound calling', us: 'Not yet', them: 'Yes, with rate-control' },
    ],
    rows: [
      { group: 'Pricing', item: 'Model', us: '$0.10/min flat, every minute', them: 'Free (100 min), Starter $50/mo (250 min), Pro $150/mo (750 min), Enterprise as low as $0.05/min — but overage on the lower tiers runs $0.25–$0.35/min, higher than the plan rate', verdict: 'ahead', note: 'Their Enterprise floor ($0.05/min) is genuinely cheaper than ours if you qualify for it — the gap is at the self-serve tiers.' },
      { group: 'Languages', item: 'Coverage', us: '49 languages, each verified on a real call', them: '"Multilingual" is claimed in marketing copy; no specific language count or list found', verdict: 'ahead' },
      { group: 'Telephony', item: 'Batch/outbound calling', us: 'Not available yet', them: 'CSV-based batch calling with a rate-control slider (max calls per hour)', verdict: 'gap' },
      { group: 'Compliance', item: 'Certifications', us: 'None yet', them: 'SOC 2 Type II and HIPAA, per their published trust center (93+ controls covering business continuity, disaster recovery, and PHI handling)', verdict: 'gap' },
      { group: 'Testing', item: 'Monitoring', us: 'In-browser manual test calls', them: 'Call History & Monitoring feature with recordings, transcripts, and an analytics dashboard; A/B testing reported on their Pro tier', verdict: 'gap' },
      { group: 'Building the agent', item: 'Concurrency', us: 'Not published', them: 'Unlimited concurrent calls claimed across all tiers, including free', verdict: 'gap', note: 'This is Phonely’s own claim, not independently load-tested by us or, as far as we found, by anyone else.' },
    ],
    caveat: 'Phonely figures come from their public pricing page and trust center as of September 2026. Their latency claim (182ms to first token) is self-reported in their own marketing and not third-party verified.',
  },
  {
    slug: 'telnyx',
    name: 'Telnyx Voice AI Agents',
    shortName: 'Telnyx',
    metaTitle: 'CallDeskTech vs Telnyx Voice AI Agents | CallDeskTech',
    metaDescription: 'How CallDeskTech compares with Telnyx Voice AI Agents on pricing, telephony infrastructure, and compliance.',
    heroHeadline: 'The one comparison where the honest answer is: they’re cheaper.',
    heroSub: 'Telnyx owns its own carrier network end to end, and it shows in the price and the compliance paperwork. We’re not going to pretend otherwise.',
    stats: [
      { label: 'Base voice rate', us: '$0.10/min', them: '$0.05/min + LLM tokens + telephony' },
      { label: 'Compliance', us: 'None yet', them: 'SOC 2, HIPAA (single BAA), PCI DSS, ISO 27001, GDPR' },
      { label: 'Carrier network', us: 'Third-party (Twilio)', them: 'Own Tier-1 network' },
    ],
    rows: [
      { group: 'Pricing', item: 'Base rate', us: '$0.10/min flat, all-in', them: '$0.05/min for the voice engine (STT + TTS + orchestration), plus LLM tokens (~$0.006/min on their hosted model) and telephony (~$0.0032–$0.005/min) separately — their own stated realistic all-in cost is about $0.056–$0.06/min', verdict: 'gap', note: 'This is the one competitor on this list where we’re genuinely not the cheaper option once their stack is added up.' },
      { group: 'Languages', item: 'Coverage', us: '49 languages, each verified on a real call', them: '80+ languages claimed, with sub-200ms latency and in-house TTS voices', verdict: 'gap', note: 'Their count is a larger published number; ours is real-call-verified rather than catalog capability — a different bar, but theirs is still the bigger number.' },
      { group: 'Telephony', item: 'Network & SIP', us: 'Buy a number or forward one you own, riding on Twilio', them: 'Owns its own Tier-1 SIP/PSTN network; SIP trunking with a 99.999% uptime SLA; number porting available in 50+ countries', verdict: 'gap', note: 'This is their core structural advantage — one vendor for voice, model, and telephony instead of three.' },
      { group: 'Compliance', item: 'Certifications', us: 'None yet', them: 'SOC 2 Type II, HIPAA-eligible infrastructure under a single BAA covering the full stack, PCI DSS, ISO 27001, and GDPR with EU-region data locality', verdict: 'gap' },
      { group: 'Building the agent', item: 'Builder', us: US_BUILDER, them: 'Not deeply documented publicly in what we could verify', verdict: 'have', note: 'We’re not claiming an edge here — we just couldn’t confirm enough about their builder to compare it fairly.' },
    ],
    caveat: 'Telnyx publishes some of the most specific, first-party-sourced pricing and compliance detail of anyone on this list. We’re showing it straight rather than downplaying it — if carrier-grade infrastructure and a single BAA matter more to you than a flexible flow builder, that’s a real reason to pick them.',
  },
  {
    slug: 'thoughtly',
    name: 'Thoughtly',
    shortName: 'Thoughtly',
    metaTitle: 'CallDeskTech vs Thoughtly | CallDeskTech',
    metaDescription: 'How CallDeskTech compares with Thoughtly, a sales-ops-focused voice AI platform, on pricing and compliance.',
    heroHeadline: 'A flat monthly rate with a hard concurrency ceiling.',
    heroSub: 'Thoughtly is built for speed-to-lead sales teams, not general phone answering. $500 a month, unlimited minutes — but only 10 calls at once.',
    stats: [
      { label: 'Entry price', us: '$0.10/min, scales with usage', them: '$500/mo flat, unlimited minutes' },
      { label: 'Concurrency at entry tier', us: 'Not published', them: 'Capped at 10 simultaneous calls' },
      { label: 'Compliance at entry tier', us: 'None yet', them: 'None — SOC 2 and HIPAA are gated to higher tiers' },
    ],
    rows: [
      { group: 'Pricing', item: 'Model', us: '$0.10/min, no cap, no tier', them: 'Flex: $500/mo, unlimited minutes across unlimited agents, but hard-capped at 10 concurrent calls. Scale and Enterprise are custom-quoted.', verdict: 'neither', note: 'A high-volume, low-concurrency business could genuinely do better on their flat rate; a business that needs many calls at once could not.' },
      { group: 'Languages', item: 'Coverage', us: '49 languages, each verified on a real call', them: 'Conflicting claims across their own materials — 100+ languages via their speech-to-text vendor’s general capability, 34+ specifically cited for the entry tier', verdict: 'partial', note: 'We couldn’t resolve which number applies to a real Thoughtly agent — flagging the inconsistency rather than picking one.' },
      { group: 'Telephony', item: 'Caller ID & number setup', us: 'Buy a number, or forward one you own', them: 'Branded, verified caller ID (to avoid spam-flagging) is a named feature; SIP trunking and number porting aren’t documented publicly', verdict: 'have' },
      { group: 'Compliance', item: 'Certifications', us: 'None yet, at any tier', them: 'SOC 2 Type II reporting is available starting at their Scale tier; HIPAA/BAA and PCI scope review are Enterprise-only — not included on the $500/mo Flex plan', verdict: 'gap', note: 'The gap narrows if you’re comparing against their entry tier specifically, since Flex itself ships with no compliance certification either.' },
      { group: 'Testing', item: 'Automated QA', us: 'In-browser manual test calls', them: 'Auto-QA and evals are gated to Scale tier and above — not included in the $500/mo Flex plan', verdict: 'gap', note: 'Again, narrower at the entry tier: Flex doesn’t include this either.' },
      { group: 'Positioning', item: 'Target use case', us: 'General-purpose phone answering, booking, and support', them: 'Sales-ops workflow tool: speed-to-lead calling, omnichannel escalation (voice → SMS → email → WhatsApp), CRM auto-notes', verdict: 'neither', note: 'Different product category — if the job is "call every new lead within 10 seconds," that’s their whole reason to exist.' },
    ],
    caveat: 'Thoughtly figures come from their public pricing page and product site as of September 2026. Their language-count claims conflicted between two of their own pages — we’re reporting that conflict rather than resolving it for them.',
  },
  {
    slug: 'livekit-cloud',
    name: 'LiveKit Cloud',
    shortName: 'LiveKit Cloud',
    metaTitle: 'CallDeskTech vs LiveKit Cloud | CallDeskTech',
    metaDescription: 'CallDeskTech vs LiveKit Cloud: a finished phone-agent product versus managed hosting for the LiveKit Agents framework.',
    heroHeadline: 'This isn’t really the same kind of product.',
    heroSub: 'LiveKit Cloud is managed hosting for the open-source LiveKit Agents framework — you still choose your LLM, STT, and TTS, and write the agent logic yourself. We ship a finished receptionist.',
    stats: [
      { label: 'What you get out of the box', us: 'A finished, configured phone agent', them: 'Hosting, scaling, and routing for agent code you write' },
      { label: 'Agent session rate', us: '$0.10/min, all-in', them: '$0.01/min, plus your chosen LLM/STT/TTS provider bills' },
      { label: 'HIPAA BAA availability', us: 'Not yet', them: 'Scale/Enterprise tiers only' },
    ],
    rows: [
      { group: 'What it is', item: 'Product category', us: 'A finished voice-agent product: agent logic, telephony, and hosting all included', them: 'Managed infrastructure for the open-source LiveKit Agents framework — the buyer still picks and wires up an LLM, STT, and TTS provider and writes the agent’s conversation logic', verdict: 'neither', note: 'Not a fair "ahead/gap" comparison — see our build-vs-buy page if you’re actually weighing this path against buying a finished product.' },
      { group: 'Pricing', item: 'Rate structure', us: '$0.10/min flat, includes the full stack', them: 'Free/Ship ($50/mo)/Scale ($500/mo) tiers, each with included session minutes then $0.01/min, plus separate charges for inference, telephony, and WebRTC bandwidth', verdict: 'neither', note: 'Their base rate looks cheaper, but it excludes the LLM/STT/TTS costs a finished product like ours already bundles in.' },
      { group: 'Telephony', item: 'SIP', us: 'Buy a number or forward one you own; no SIP trunking yet', them: 'Broad BYO SIP trunk support (Twilio, Telnyx, Plivo, and others), plus LiveKit-sold phone numbers', verdict: 'gap' },
      { group: 'Compliance', item: 'Certifications', us: 'None yet', them: 'SOC 2 Type II, GDPR DPA, and HIPAA BAAs — but the BAA is only available on Scale and Enterprise plans, not the free or Ship tiers', verdict: 'gap' },
      { group: 'Testing', item: 'Observability', us: 'In-browser manual test calls', them: '"Agent Insights": turn-by-turn transcripts, pipeline traces, and recordings, 30-day retention, available on Cloud deployments only', verdict: 'gap' },
    ],
    caveat: 'LiveKit Cloud figures come from their public pricing and documentation pages as of September 2026. Because this is infrastructure, not a finished product, most rows above are framed as "different category" rather than a straight win or loss — that’s the honest comparison.',
  },
  {
    slug: 'pipecat-cloud',
    name: 'Pipecat Cloud',
    shortName: 'Pipecat Cloud',
    metaTitle: 'CallDeskTech vs Pipecat Cloud | CallDeskTech',
    metaDescription: 'CallDeskTech vs Pipecat Cloud: a finished phone-agent product versus managed hosting for the open-source Pipecat framework.',
    heroHeadline: 'Compute billing versus a phone-agent product.',
    heroSub: 'Pipecat Cloud bills by the minute of compute your agent uses — you still build the agent. We bill by the minute of a call your agent already knows how to handle.',
    stats: [
      { label: 'What you get out of the box', us: 'A finished, configured phone agent', them: 'Compute, scaling, and logging for agent code you write' },
      { label: 'Compute rate', us: '$0.10/min, all-in', them: '$0.01–$0.03/min active compute, plus telephony/transport/recording line items' },
      { label: 'Compliance', us: 'None yet', them: 'Claimed at the parent company level, not Pipecat-Cloud-specific' },
    ],
    rows: [
      { group: 'What it is', item: 'Product category', us: 'A finished voice-agent product: agent logic, telephony, and hosting all included', them: 'Managed hosting for the open-source Pipecat framework — you write the pipeline and choose your own LLM/STT/TTS services, self-hostable with the same code', verdict: 'neither', note: 'See our build-vs-buy page if you’re weighing this path seriously against a finished product.' },
      { group: 'Pricing', item: 'Rate structure', us: '$0.10/min flat, includes the full stack', them: 'Compute billed at $0.01–$0.03/min depending on instance size, plus separate line items for SIP/PSTN telephony, noise reduction past 10k min/mo, and recording/storage', verdict: 'neither', note: 'Cheaper on paper for the compute alone, but it doesn’t include your model or telephony provider bills the way ours does.' },
      { group: 'Telephony', item: 'SIP', us: 'Buy a number or forward one you own; no SIP trunking yet', them: 'SIP via Daily, with documented support for Twilio, Telnyx, Plivo, and Exotel as carriers', verdict: 'gap' },
      { group: 'Compliance', item: 'Certifications', us: 'None yet', them: 'SOC 2 Type 2 and HIPAA BAA availability are stated on their parent company’s (Daily’s) general security page — not confirmed as a Pipecat-Cloud-specific certification', verdict: 'gap', note: 'We couldn’t find a Pipecat-Cloud-specific compliance page distinct from Daily’s video-product security page.' },
      { group: 'Testing', item: 'Observability', us: 'In-browser manual test calls', them: 'Per-session dashboards, CLI/dashboard logs (30-day retention), and built-in latency observers; no first-party automated evaluation framework found', verdict: 'gap' },
    ],
    caveat: 'Pipecat Cloud figures come from Daily’s (its parent company’s) public pricing and documentation pages as of September 2026. Because this is infrastructure, not a finished product, most rows are framed as "different category" rather than a straight win or loss.',
  },
  {
    slug: 'plivo-voice-ai',
    name: 'Plivo Voice AI Agents',
    shortName: 'Plivo',
    metaTitle: 'CallDeskTech vs Plivo Voice AI Agents | CallDeskTech',
    metaDescription: 'How CallDeskTech compares with Plivo Voice AI Agents on pricing, telephony, compliance, and automated testing.',
    heroHeadline: 'A carrier that also builds a finished agent — and it shows in the compliance list.',
    heroSub: 'Plivo ships a no-code builder like ours, but it’s also a telephony carrier in its own right, with the SIP infrastructure and audited certifications that come with owning that stack.',
    stats: [
      { label: 'AI stack rate (excl. telephony)', us: '$0.10/min, all-in', them: '$0.03/min, plus telephony billed separately' },
      { label: 'Compliance', us: 'None yet', them: 'SOC 2, PCI DSS Level 1, GDPR, HIPAA BAA' },
      { label: 'Automated testing', us: 'Manual only', them: 'Auto-generated simulation tests + 6 analytics dashboards' },
    ],
    rows: [
      { group: 'Pricing', item: 'Rate structure', us: '$0.10/min flat, includes the full stack', them: '$0.03/min for the AI stack (voice models, transcription, orchestration) — telephony is billed separately on top; Enterprise plan starts at $1,000/mo and is required for SMS/WhatsApp agents', verdict: 'gap', note: 'Their base AI-stack rate is confirmed cheaper than ours; the honest total depends on what their telephony line item adds, which we couldn’t fully resolve.' },
      { group: 'Telephony', item: 'SIP & numbers', us: 'Buy a number or forward one you own; no SIP trunking yet', them: 'Real SIP trunking, plus phone-number provisioning across (their own pages disagree) 150+ to 190+ countries', verdict: 'gap' },
      { group: 'Compliance', item: 'Certifications', us: 'None yet', them: 'SOC 2 (annual independent audit), PCI DSS Level 1, GDPR compliance, and a HIPAA BAA available on request', verdict: 'gap' },
      { group: 'Testing', item: 'Automated testing', us: 'In-browser manual test calls', them: 'Simulation testing that auto-generates test cases and scores responses for accuracy, hallucinations, and dead ends, plus six built-in analytics dashboards', verdict: 'gap' },
      { group: 'Building the agent', item: 'Builder', us: US_BUILDER, them: 'A natural-language agent generator ("Vibe Agent") plus a visual canvas to inspect and tune the generated flow, with an optional custom-pipeline path over WebSocket for developers', verdict: 'have', note: 'Their AI-generated-then-editable flow is a genuinely different approach from our manually-built node graph — worth naming, not just filing as a loss.' },
    ],
    caveat: 'Plivo figures come from their public pricing and security pages as of September 2026. Number porting isn’t documented on either side, and their published country-coverage number is inconsistent across their own pages — both flagged rather than resolved for them.',
  },
];

export function getCompetitor(slug: string): CompetitorEntry | undefined {
  return COMPETITORS.find((c) => c.slug === slug);
}

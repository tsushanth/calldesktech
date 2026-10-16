// Small, hand-written redirects for addresses people try that do not exist, or that a pasted link has mangled.
// Kept free of "@/..." imports: next.config.ts loads it with a relative path.
//
// 307 (permanent: false) on purpose: /developers and /integrations/<name> could become real pages later, and a 308 is cached by browsers.

export type SiteRedirect = { source: string; destination: string; permanent: false };

export const SITE_REDIRECTS: readonly SiteRedirect[] = [
  { source: '/developers', destination: '/docs', permanent: false },
  { source: '/integration', destination: '/integrations', permanent: false },
  { source: '/integrations/vapi', destination: '/integrations#vapi', permanent: false },
  { source: '/vapi', destination: '/integrations#vapi', permanent: false },
  // A link copied out of a sentence or a markdown line often carries trailing punctuation: "/api/v1/openapi.json)" or "...json,".
  // The exact path (no trailing characters) does not match, so the real file is never redirected.
  { source: '/api/v1/openapi.json:trail(.+)', destination: '/api/v1/openapi.json', permanent: false },
];

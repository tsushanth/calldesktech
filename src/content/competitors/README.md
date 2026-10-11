# Competitor data files

One JSON file per competitor, named `<slug>.json` (lowercase, hyphenated). These files feed the public pages "Calldesk vs X", "X alternatives" and "Migrate from X to Calldesk". Everything here is public: never add costs, margins, secrets, customer data or private notes.

## Schema

```json
{
  "slug": "string",
  "name": "string",
  "url": "string",
  "status": "active | unclear | inactive",
  "retrievedAt": "YYYY-MM-DD",
  "category": "platform | no-code-builder | answering-service | cpaas | enterprise | model-vendor",
  "positioning": "one neutral sentence in our own words",
  "pricing": {
    "model": "string",
    "headline": "string",
    "perMinuteUsd": "number | null  (the vendor's advertised headline per-minute rate; the headline text says what it covers, it is not always all-in)",
    "currency": "USD",
    "planNotes": ["string"],
    "freeTrial": "string | null",
    "whatIsExtra": ["string  (only costs the vendor itself says are billed on top)"],
    "sourceUrls": ["string"]
  },
  "strengths": [{ "claim": "string", "sourceUrl": "string" }],
  "limitations": [{ "claim": "string", "sourceUrl": "string" }],
  "integrations": ["string"],
  "compliance": {
    "hipaa": "stated | not-stated",
    "soc2": "stated | not-stated",
    "gdpr": "stated | not-stated",
    "note": "string",
    "sourceUrl": "string | null"
  },
  "telephony": {
    "bringYourOwnCarrier": "yes | no | unknown",
    "providedNumbers": "string",
    "sourceUrl": "string | null"
  },
  "migration": {
    "exportAgentsPossible": "yes | no | unknown",
    "stepsToLeave": ["string"],
    "sourceUrls": ["string"]
  },
  "bestFor": "string",
  "sources": [{ "url": "string", "title": "string", "retrievedAt": "YYYY-MM-DD" }],
  "unknowns": ["string"]
}
```

A page builder should skip any file whose `status` is `inactive`, and treat `unclear` with care (show less, link to the vendor).

## Verification rules

- Every competitor fact traces to a public page that was actually read, listed in `sources` with its retrieval date.
- Anything that could not be verified is `null` or `unknown` and is listed in `unknowns`. Nothing is guessed.
- Numbers that matter (per-minute price, plan price, included minutes) are checked on the primary pricing page and on at least one other page of the same vendor; otherwise the file says "single-source" under `unknowns`.
- Tone is fair and positive: real strengths are acknowledged, limitations are only facts the vendor states on its own pages, phrased neutrally. No disparagement and no "edge" narrative.
- No marketing copy is copied verbatim beyond short quotes (125 characters or fewer, marked as quotes).
- No gated or logged-in content is used. Pages are fetched sparingly (a few per vendor).
- Compliance claims (HIPAA, SOC 2, GDPR and similar) are recorded as `stated` only when the vendor's own public page states them, and the note says "stated by vendor, self-attested". `not-stated` means the pages read did not state it, not that the vendor lacks it.
- Competitor files describe the competitor only; Calldesk claims belong elsewhere.

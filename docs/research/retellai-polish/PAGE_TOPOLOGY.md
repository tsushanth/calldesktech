# Page topology — retellai.com → calldesktech mapping

Retell's page: 16 layout sections, 14574px tall. Below is each Retell *structural slot*
(described by its role and measured geometry — no Retell copy is reproduced) and what
calldesktech puts in it.

| # | Retell slot | Geometry | calldesktech section | Content decision |
|---|---|---|---|---|
| 0 | Hero, oversized display type | h=740, H2 90px/lh .95 | **Hero** | Keep existing headline + subcopy verbatim. Only the type scale/tracking changes. |
| 1 | Customer logo band | h=212, pad 46px | **Capability strip** | **Diverged — no logos.** calldesktech has no public customers; fabricating a logo wall would be dishonest. Replaced with the 4 real capability chips already on the page. |
| 2–3 | Product visual / large banner | h=672 / 864 | **Live call preview** | A styled mock *transcript* of the product's own demo flow — clearly a product illustration, not a customer claim. |
| 4 | Feature deep-dive, pad 140px | h=2124 | **Capabilities grid** | Existing 6 real capabilities, restructured to Retell's card rhythm. |
| 5 | Spacer/visual, pad 140px | h=622 | — | Dropped; no equivalent asset. |
| 6 | 3-up cards, pad 80px, H3 19.5px | h=1247 | **How it works** (4 steps) | Existing 4 steps, upgraded to card treatment. |
| 7 | 3-up w/ 80px gap, pad 80px | h=1162 | **Building blocks** | The FAQ/booking/transfer/message blocks — calldesktech's actual differentiator. |
| 8 | 5-up list, pad 80px | h=959 | folded into Building blocks | — |
| 9 | Testimonials, pad 80px | h=1004 | **Omitted entirely** | **No fabricated social proof.** No customers to quote. |
| 10 | 5-up cards, pad 140px, gap 80px | h=898 | **Why it's different** | Honest technical claims already made on the page (latency, turn detection). |
| 11 | Accordion list, H3 20px | h=1454 | **FAQ** | New, written from calldesktech's real product behavior. |
| 12 | Pre-footer CTA | h=738 | **Final CTA** | Links to real routes `/demo`, `/pricing`. |
| 13–15 | Footer + large CTA button | h=1806 | **Footer** | Existing footer, upgraded rhythm. Links only to routes that exist. |

## Interaction model per section
- Hero — static (nav is scroll-driven)
- Capability strip, capabilities grid, how-it-works, building blocks, why-different — **scroll-reveal on enter**, staggered
- FAQ — **click-driven** accordion (native `<details>`, no JS)
- Final CTA, footer — static
- Floating demo widget — persistent, pre-existing, retained

## Routes referenced (all verified to exist)
`/demo`, `/pricing`, `/dashboard`, `/auth/login`

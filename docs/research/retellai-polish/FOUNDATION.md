# Foundation — extracted from retellai.com (1440px)

All values from `getComputedStyle()` (see `global-extraction.json`), not eyeballed.

## Container
- Primary content max-width: **1160px** (13 occurrences — the dominant container)
- Secondary wide container: 1300px; prose column: 840px; card column: 330px
- Body base font-size: **14px** (their UI scale is small; calldesktech stays at 16px root
  because the rest of the app depends on it — we scale *ratios*, not absolute px)

## Section vertical rhythm
Two-tier, strictly alternating:
- **Major sections: `padding: 140px 0`**
- **Secondary sections: `padding: 80px 0`**
- Hero block: 72px top, ~740px tall
This is the single biggest polish signal — the current calldesktech page uses a flat
`py-24` (96px) everywhere, which reads as undifferentiated.

## Type scale (the real differentiator)
| Role | size | weight | line-height | letter-spacing |
|---|---|---|---|---|
| Hero display | 90px | 100–500 | 79.2–85.5px (**0.88–0.95**) | −1.8px (−0.02em) |
| Section H2 | 37.5px | 400 | 39.375px (**1.05**) | **−2.25px (−0.06em)** |
| Card H3 | 19.5–20px | 400 | 23.4px (1.2) | −0.975 to −1.17px (−0.05em) |
| Body p | 16px | 400 | 17.6–20px (1.1–1.25) | normal |
| Eyebrow / meta | 12–12.5px | 500 | 18.125px | normal |

Key insight: headings are **light-weight (400) + very tight tracking (−0.05em) + tight
leading (~1.05)**. calldesktech currently uses `font-bold` (700) with default tracking —
that is what makes it read "bootstrap template" next to Retell.

## Radii
- Cards: **12px**; buttons: **6px**; pills: 60px/999px; large feature blocks: 16–20px

## Buttons
- Primary: `padding: 9px 16px`, `border-radius: 6px`, `font-size: 12px`, `font-weight: 500`
- Transition: `opacity .15s, transform .15s, background-color .15s`
- Large CTA easing signature: **`cubic-bezier(0.22, 1, 0.36, 1)`** (used at 0.55–1.1s)

## Palette (Retell — light theme; NOT adopted)
accent `rgb(62,106,239)`, ink `rgb(0,18,46)`, surface `rgb(245,245,250)`, body `rgb(51,51,51)`.
calldesktech keeps its **dark** theme + existing `blue-600`/`primary` tokens. We port the
*structure, rhythm and type scale only* — the palette stays ours, since `globals.css`
tokens are shared with dashboard/pricing/onboarding.

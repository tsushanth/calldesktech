# Interaction sweep — retellai.com

Method: Playwright, 1440×900, scroll 0 → 14574px in 500px steps, sampling
`getComputedStyle()` before and after. Raw data: `behaviors-raw.json`.

## 1. Header
- `position: fixed`, height **72px**, `padding: 12px 10px`
- **Does NOT change on scroll** — sampled at y=0, 600, 2000: background stays
  `rgba(0,0,0,0)`, no blur, no shadow, no height change.
- Decision for calldesktech: we *diverge here*. Retell's page is light with light
  sections behind the nav so transparent works; calldesktech is dark with a gradient,
  so it keeps its existing `backdrop-blur` sticky header — but we add a scroll-state
  (border + stronger blur appearing after 24px) because the transparent-over-dark
  version loses the nav against the hero.

## 2. Scroll-driven horizontal converge (hero banner)
Two text rows start offset horizontally and slide to centre as you scroll:
- left row: `translateX(+371px) → translateX(0)`
- right row: `translateX(−371px) → translateX(0)`
A second banner further down runs the *inverse* (0 → ∓146px), i.e. it diverges as it
leaves. This is a continuous scroll-linked transform, not a one-shot reveal.

## 3. Scroll-driven card stack
`.c-scrolling-cards-item` elements begin at `translateY(330px)` and settle to
`translateY(0)` as the section enters — a staggered rise, several cards at once.

## 4. Buttons
- Nav/primary: `transition: opacity .15s, transform .15s, background-color .15s`
- Section CTAs: `transition: transform .3s, background-color .3s`
- Large footer CTA: `cubic-bezier(0.22, 1, 0.36, 1)` over 1.1s on width/padding/margin,
  opacity 0.55s. This easing is the site's signature "expensive" feel.

## 5. Logo brandmark
Rotates/scales in (`matrix(-0.75, -0.27, 0.27, -0.75, …)` → identity) — decorative,
not adopted.

## What calldesktech adopts
| Retell behavior | calldesktech implementation |
|---|---|
| Scroll-linked converge | Too gimmicky without their art direction — **skipped** |
| Card rise on enter | **Adopted**: IntersectionObserver `fade-up` with 60ms stagger, `translateY(24px)→0`, `cubic-bezier(0.22,1,0.36,1)` 0.7s |
| Button .15s transform/bg | **Adopted** verbatim |
| Signature easing | **Adopted** as `--ease-out-expo` on all reveals/hovers |
| Transparent fixed nav | **Diverged** — scroll-reactive blurred nav (dark theme needs it) |

No animation library added — plain CSS transitions + one small IntersectionObserver
client component (`Reveal`), respecting `prefers-reduced-motion`.

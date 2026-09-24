# Outreach email previews: design notes

Open `plain.html`, `sample-freight.html`, `sample-dental.html` in a browser. Regenerate with `node --experimental-strip-types scripts/render-email-previews.mjs`.

## What was tried
One design: the existing plain paragraphs, then a compact card (label row "Sample call · 1:32 · AI demo", 4-6 chat-style rows, one button-style link, one-line AI disclosure), then the unchanged footer. Caller rows sit left with a grey tint, agent rows right with a blue tint, and each carries a tiny CALLER/AGENT label so meaning does not rely on color. The card sets its own explicit background and text colors so dark-mode inversion cannot produce dark-on-dark text. The plain-text alternative carries the same snippet, the link and the disclosure.

## Why it is restrained
Cold email lives or dies on deliverability and on looking like a note from a person. Heavier "designed" HTML (banners, images, multiple buttons) raises spam-filter risk and reads as marketing. So: tables plus inline CSS only, no images, one call to action, no open-tracking pixel. The only measurement is first-party, on our own page.

## Constraints (honest)
- I verified only that the markup is balanced, contains no `<img>`, and renders in a desktop browser. I could NOT test in real email clients (Gmail, Outlook, Apple Mail, mobile). Everything below is from general knowledge, not from testing this email.
- Outlook desktop uses the Word rendering engine: rounded corners and some padding are likely ignored. The button is a padded table cell, which is the usual workaround, but it is unconfirmed here.
- Gmail clips messages over ~102KB and strips some CSS. This email is a few KB, well under.
- Dark-mode clients may partially invert colors regardless of what we set.
- The CTA is a link to our page rather than an embedded audio player, because email clients do not play audio inline.

## Next experiments (each with a tradeoff)
- Waveform image thumbnail linking to the page: more inviting, but adds a remote image (blocked by default in many clients) and spam-filter weight.
- Name-personalized subject: usually lifts opens, but needs reliable contact names and risks a wrong-name embarrassment.
- Shorter snippet (2-3 lines): faster to scan, but less proof of a real conversation.
- Link-only, no card (text plus the URL): best deliverability, least visual pull. A useful third A/B arm.
- Send real client rendering through a testing tool before any volume send.

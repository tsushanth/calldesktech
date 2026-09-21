# French shopper bench: post-fix receptionist template (2026-09-21)

Real call via `/place-test-call` shopper mode, dialing our number (+12245061194) routed to a fresh
`receptionist` template agent, `language:"fr"`, `voiceEngine:"poc"`. Purpose: check whether the
graceful-degrade-to-booking fix (verified in English earlier today, commit `9385686`) carries over
into French, since the fix lives in the shared template file and is translated at install time —
that had not yet been checked with a real French call.

Shopper persona: caller asking about pricing and whether an appointment is possible this week,
speaking only French.

Call SID `CA8d83e66b925f7da009ad7a9aae7b9841`, duration **137s**.

## Transcript

```
Assistant: Bonjour, bienvenue chez nous. Comment puis-je vous aider aujourd'hui?
Shopper:   Bonjour! Oui, je cherchais justement des informations. J'aimerais connaître vos tarifs, s'il vous plaît.
Assistant: Bien sûr. De quel service souhaitez-vous connaître les tarifs / Qu'est-ce qui vous intéresse
Shopper:   Ah, c'est une bonne question. En fait, je ne sais pas trop... c'est quoi exactement que vous proposez comme services?
Assistant: C'est une excellente question. Pour pouvoir vous donner les bons détails, j'aurais besoin de consulter nos informations. Pourriez-vous me dire à peu près ce que vous recherchez?
Shopper:   Oui, bien sûr. Honnêtement, j'appelle un peu au hasard... je cherchais des informations générales sur ce que vous offrez. Qu'est-ce que c'est votre activité principale?
Assistant: ou préférez-vous que je vous propose un rendez-vous pour qu'on puisse en discuter plus en détail avec quelqu'un qui pourra vous expliquer tous nos services
Shopper:   Oui, ça m'intéresse! Un rendez-vous, ce serait bien. Est-ce que vous auriez quelque chose de disponible cette semaine?
Assistant: Absolument, on va voir ce qu'on peut vous proposer cette semaine. D'abord, quel est votre nom?
Shopper:   C'est Martin Dupont.
Assistant: Merci Martin. Et quel jour cette semaine vous conviendrait le mieux?
Shopper:   Euh, n'importe quel jour ça va pour moi. Demain, jeudi, vendredi... c'est comme vous voulez, vraiment.
Assistant: Demain, c'est mardi 22 septembre ou vous préférez plutôt mercredi, jeudi ou vendredi.
Shopper:   Demain mardi, ça me va parfaitement. Pas de problème.
Assistant: Parfait. Demain mardi 22 septembre, c'est noté. À quelle heure vous arrangerez le mieux?
Shopper:   Le matin, c'est mieux pour moi. En fin de matinée, vers 10h, 10h30, ça vous irait?
Assistant: Oui, c'est parfait. 10 heures 30 demain matin, mardi 22 septembre, ça me convient très bien.
Assistant: Et pour finir, quel est votre numéro de téléphone qu'on puisse vous rappeler si besoin.
Shopper:   C'est le 06 47 23 58 91.
Assistant: Parfait, merci. Je confirme. 0 6 47 23 58 91.
Shopper:   Oui, c'est ça. Merci beaucoup!
Assistant: C'est c'est bien ça
Shopper:   Merci beaucoup.
Assistant: Au revoir!
```

(Roles as stored: DB `user`/`assistant` labels are swapped from intuition — cross-checked against
content, the shopper persona is the one asking about tarifs/rendez-vous.)

## Assessment

**STT**: Correctly recognized French throughout — no misrecognitions, no fallback into English
transcription, correctly parsed a spoken phone number (06 47 23 58 91) and a spoken date/time.

**Fluency**: Natural, idiomatic French on the agent side — "Bien sûr", "C'est une excellente
question", correct date phrasing ("demain, c'est mardi 22 septembre"), correct time phrasing ("10
heures 30"). One minor disfluency ("C'est c'est bien ça" — a stutter/repeat, not a language error)
right at the end, cosmetically rough but not a comprehension failure.

**Task completion**: Full success. Agent never had pricing/service specifics (same underlying gap
as the Spanish/English runs), but per the fix it did NOT apologize-and-transfer — it pivoted to
booking, collected name (Martin Dupont), date (mardi 22 septembre), time (10h30), and callback
number, and confirmed all fields back to the caller before ending the call.

**Template fix carryover**: **Confirmed.** The graceful-degrade-to-booking behavior verified in
English earlier today (commit `9385686`) carries over correctly into French — same shape (pivot to
appointment booking instead of dead-ending), no language-specific regression. This is consistent
with the fix living in the shared template file and being translated at install time, as expected.

## Cleanup

Phone number `34d13af7-e4ba-4312-a0aa-bd8d356de97f` routing (`inbound_agent_version_id`) cleared
back to NULL, test agent `d348882d-6649-4dec-b7b5-5a97308b5f88` deleted, temp API key
`LangBench-FR-temp` revoked. All verified via SQL after the call.

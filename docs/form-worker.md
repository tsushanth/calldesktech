# Contact-form worker (runbook)

Sends our outreach message through companies' own contact forms. Code: `harness/outreach/form-submit.ts` (the loop), `src/lib/outreach/formSubmit.ts` (all decisions: field mapping, challenge detection, caps, eligibility), `src/lib/outreach/formSubmitBrowser.ts` (the browser half). It runs on the Mac mini under launchd (template: `harness/outreach/com.calldesk.outreach-formsubmit.plist.template`, installed with a 5-minute interval) through `harness/outreach/form_submit_cycle.sh`, which pulls main, sources `~/.calldesk-forms/env` and runs the worker. The env file is read by the shell: **quote any value with a space**.

## One attempt, in order
1. Pick leads whose `signals.formOutreach.status` is `queued`, or `ready` when `OUTREACH_FORM_AUTOSUBMIT=1`, highest score first, no stored `skipReason`.
2. Skip: suppressed domain, replied, region blocked, voice-platform provider (platform blocklist), vertical leads outside the US and Canada (`isNonUsCaLead`: domain country code, location suffix like ", GB", country-prefixed source such as `gb-cqc`; `ALLOW_INTL_FORMS=1` lifts it), score below 50, draft outside 40-190 words, caps.
3. Open the stored page (`contactForm.pageUrl`, else `contact_source_url`). Wait up to 6 s for a form with a message box. If none: follow the site's own contact links, then try `/contact`, `/contact-us`, `/get-in-touch` (at most 5 pages). The page the form was really on is recorded.
4. **A visible, interactive challenge stops the attempt** (v2 / hCaptcha widget or "verify you are human" text). We never solve or bypass one. A page that only *loads* a captcha script is tried; failures go to `needs_manual` and the reason says the page loads one.
5. Fill: name, email, subject, message; company and website; required fields we do not recognise get neutral truthful answers (Co-founder / Flexible / To be discussed / Direct outreach / Voice AI partnership / 1-10 / United States, or a neutral select option). **Never invented:** a phone number (a real one from `OUTREACH_FORM_PHONE`, else a human), a postal address (the business address from `OUTREACH_FORM_ADDR_*` on REQUIRED address fields only, else a human), ids, numbers, dates. A required marketing opt-in is never ticked. A form that caps the message length gets the short message.
6. Submit (fallbacks for covered buttons and hidden consent boxes). `submitted` needs positive evidence (thank-you text or URL, success element, form replaced). Otherwise `needs_manual / unconfirmed`.
7. Write the result to the lead (`formOutreach.status`, `attempts[]`) and a row to `calldesk_form_worker_log` (migration 074).

## Confirmation by email
Mail to `outreach@calldesk.tech` runs through the Cloudflare Email Worker `cloudflare-email-workers/inbound-reply-webhook.js` (always forwards to Gmail), which posts the sender, From header and subject to `POST /api/webhooks/inbound-reply`. `src/lib/outreach/formConfirmation.ts` flips a lead whose last attempt was `unconfirmed` to `submitted` when a mail from its own domain (or a subdomain) arrives within 72 h after the attempt, and logs it with `proof = 'email'`.

## Settings (`~/.calldesk-forms/env`)
| name | meaning | default |
|---|---|---|
| `OUTREACH_REPLYTO_EMAIL` | address submitted on forms (required) | none |
| `OUTREACH_FORM_AUTOSUBMIT` | process `ready` leads, not only `queued` | off |
| `OUTREACH_FORM_SCOPE` | `reseller` (plain `calldesk` product, includes hand-entered forms), `verticals`, `all`; unset = form_only leads of the worker's product | unset |
| `OUTREACH_FORM_SUBMIT_MAX_PER_DAY` | daily cap | 15 (ceiling 1000) |
| `OUTREACH_FORM_SUBMIT_MAX_PER_HOUR` | hourly cap | 5 |
| `OUTREACH_FORM_SUBMIT_DELAY_MIN_MS` / `_MAX_MS` | pause between forms | 20000 / 40000 |
| `OUTREACH_FORM_SUBMIT_BREAKER` | consecutive failed or unconfirmed attempts that stop a run | 5 |
| `OUTREACH_FORM_PHONE` | real number to give when a form requires one | none (such forms go to a human) |
| `OUTREACH_FORM_ADDR_LINE1`, `_LINE2`, `_CITY`, `_STATE`, `_ZIP`, `_COUNTRY` | business postal address for required address fields | none (such forms go to a human) |
| `ALLOW_INTL_FORMS` | `1` lifts the US/Canada rule for vertical leads | off |

Always on: one submission per domain per UTC day, one submission per lead ever, suppressed domains, replied leads.

## Operating it
- **Stop at once:** `touch ~/.calldesk-forms/STOP` on the mini (the run stops after its current form). Remove the file to resume.
- **Stop the job:** `launchctl bootout gui/$(id -u)/com.calldesk.outreach-formsubmit`.
- **Logs:** `~/.calldesk-forms/logs/formsubmit_*.log`, `~/.calldesk-forms/runs.jsonl`, screenshots under `~/.calldesk-forms/<lead id>/`.
- **See results:** the outreach queue's **Worker** tab (delivered forms, page-confirmed or auto-reply) and the **forms** tab (needs manual, with the reason on each card).
- **Hand a lead back to the worker:** set its status to `ready` (clear `skipReason` if it has one). Mark `submitted` or `skipped` to take it out.
- **Dry run:** `DRY_RUN=1` plus a throwaway `HOME` to read the queue without touching the real ledger or sending anything.

## Tests
`npx vitest run test/lib/outreachFormSubmit.test.ts test/lib/outreachFormSubmitBrowser.test.ts test/lib/formConfirmation.test.ts`. The browser tests drive real Chromium against local pages (`npx playwright install chromium` once per Playwright version; without it they skip silently).

## Lessons that became code
- A domain ending is not a country: UK care agencies sit on plain `.com` addresses, so country is decided from the lead's location and source as well.
- Count by country (dry run) before switching a bulk sender on.
- Many forms show nothing on the page after sending; the company's auto-reply is the better proof.

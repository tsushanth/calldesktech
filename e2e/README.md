# Browser smoke tests

`builder-smoke.mjs` drives the real dashboard in Chrome: create a voice agent, fill the single-prompt builder,
Publish, check the saved flow, reload, check the builder shows the saved values. It fails on any API error
or uncaught page error along the way.

Run it against a local production build (it needs `.env` with Supabase and `NEXTAUTH_SECRET`):

    npm run build && PORT=3100 npm start      # terminal 1
    npm run e2e:builder                        # terminal 2   (BASE_URL=http://localhost:3100 by default)

- It signs in with a session cookie minted for the throwaway user `demo_e2e_smoke`. User ids starting with
  `demo_` count as internal in every report, so this never shows up as customer activity.
- It writes to the real Supabase project (one tenant, one agent, one version) and deletes all of it at the end,
  pass or fail. A run that was interrupted is cleaned up by the next run.
- It never places a call and never touches Twilio, Telnyx or Retell (default `poc` engine, database only).
- Against production, set `BASE_URL=https://calldesk.tech`. Analytics (PostHog) ignores automated browsers, so to check
  that builder events arrive, add `E2E_ANALYTICS=1`; the run's events appear under `e2e-smoke@calldesk.invalid`.
- Chrome is found at the standard macOS path; set `E2E_CHROME` to use another binary, `E2E_HEADED=1` to watch.
- To add a check, follow the pattern in `builder-smoke.mjs`: type a distinctive value, then assert it in the
  saved flow and again after a reload. Sanity-check a new assertion by running it against a wrong expectation.

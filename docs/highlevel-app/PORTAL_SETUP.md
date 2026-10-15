# HighLevel developer portal: what to enter

Values for the Calldesk Marketplace app. Secrets are never written here; they live in the Fly app's secrets.

## App, Advanced Settings, Auth
- Redirect URL: `https://calldesk.tech/api/highlevel/oauth/callback`
- Scopes: `contacts.readonly`, `contacts.write`, `workflows.readonly`
- Server secrets (calldesk-tech): `HIGHLEVEL_CLIENT_ID`, `HIGHLEVEL_CLIENT_SECRET`, `HIGHLEVEL_REDIRECT_URI`, `HIGHLEVEL_TOKEN_KEY`, `HIGHLEVEL_LINK_SECRET`, `HIGHLEVEL_APP_SECRET` (shared with the action and trigger below).

## Modules, Workflow Actions: "Place a Calldesk call"
- Name: Place a Calldesk call. Key: `place_call` (immutable). Short description: Calls the contact with a Calldesk AI voice agent.
- Fields:
  1. Reference key `phone`, type String, required, default `{{contact.phone}}`. Label: Phone number.
  2. Reference key `call_from`, type String, optional. Label: Call from (optional). Help: one of your Calldesk numbers with an Outbound Call Agent. Leave empty if you have only one.
  3. Reference key `variables`, type Textarea, optional. Label: Call variables, one name=value per line. Default:
     ```
     first_name={{contact.first_name}}
     last_name={{contact.last_name}}
     company={{contact.company_name}}
     ```
     Each name becomes a `{{name}}` placeholder in the agent's prompt for this call.
- Execution: API. URL `https://calldesk.tech/api/highlevel/actions/place-call`. Method POST. Header `x-calldesk-secret` = the value of `HIGHLEVEL_APP_SECRET`.
- Sample response (defines the variables later steps can use):
  ```json
  { "success": true, "call_sid": "CA0123456789abcdef", "to": "+14155550123", "error": "" }
  ```
- Behaviour: a workflow author's mistakes (sub-account not linked, no usable phone number, no outbound number) come back as HTTP 200 with `success: false` and a readable `error`, so a following If/Else step can branch on `success`. Wrong secret is 401, too many calls too fast is 429.

## Phone numbers
HighLevel stores whatever was typed. The action accepts E.164 (`+14155550123`) and US shapes (`(415) 555-0123`). A number with no `+` that is not a valid US number (for example an Australian `0412 345 678`) is refused with a clear error instead of being guessed.

## Modules, Workflow Triggers: "Calldesk call completed"
- Name: Calldesk call completed. Key: `call_completed` (immutable). Short description: Starts a workflow when a Calldesk call ends.
- Subscription URL: `https://calldesk.tech/api/highlevel/triggers/subscription?k=<HIGHLEVEL_APP_SECRET>` (the secret goes in the URL because HighLevel may not send custom headers to this URL; if the portal offers a header field, `x-calldesk-secret` works too).
- Filters: none. Calldesk sends every completed call for the linked workspace; filter inside the workflow with an If/Else on `outcome`, `direction` or `agent_name`.
- Sample payload (defines the variables available in the workflow):
  ```json
  {
    "event": "call.completed",
    "created_at": "2026-10-09T18:01:00.000Z",
    "call_id": "CA0123456789abcdef",
    "phone": "+14155550123",
    "name": "Dana Lee",
    "email": "dana@example.com",
    "summary": "Dana asked to move her appointment to Friday at 3pm. Confirmed.",
    "outcome": "answered",
    "duration_seconds": 42,
    "direction": "outbound",
    "transcript_url": "https://calldesk.tech/dashboard/calls/<call-log-id>",
    "started_at": "2026-10-09T18:00:00.000Z",
    "ended_at": "2026-10-09T18:00:42.000Z",
    "agent_name": "Reminder agent",
    "var_first_name": "Dana"
  }
  ```
- How it runs: when a workflow starts using the trigger, HighLevel calls the Subscription URL with the trigger's execute URL. Calldesk accepts only `https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/<this sub-account or its company>/<trigger id>` and creates a flat `call.completed` webhook for the linked workspace pointing at it. Deleting the workflow's trigger, or uninstalling the app, removes it. Delivery uses the same signed, time-limited sending as every Calldesk webhook.
- Not verified yet (HighLevel does not document it): whether the execute URL needs an authorization header. Test with a real workflow in a sub-account.

# Regression receiver

A tiny Cloudflare Worker (+ one D1 table) that the regression scenarios point the call engine at, so the harness can
check what the engine actually sent. It stores only requests made by our own test calls, for 3 days.

| Endpoint | Used by |
|---|---|
| `POST /hook/<run>` | function-node webhook; records the request, answers `{"status":"ok","slots":["10am","2pm"]}` |
| `POST /mcp/<run>` | minimal MCP server: `initialize`, `notifications/initialized`, `tools/call` (`lookup_order`) |
| `GET/DELETE /events/<run>` | the harness (needs header `X-Reg-Secret`) |
| `POST /current` `{run, mode}` | the harness picks what the receiver NUMBER does for the next call: `ivr` (asks for a 3-digit extension and records the digits), `voicemail` (plays a voicemail greeting), `silent` (answers and says nothing) |
| `POST /twiml`, `/twiml/done` | the Twilio voice webhook of the receiver number (set it once with the Twilio console or API: Voice URL `https://<worker>/twiml`, POST) |

`<run>` is a random id the harness makes per scenario run. The receiver number has no run id in its URL, so the harness sets the
current run and mode just before each call (one call at a time).

## Deploy (one time)

    cd scripts/regression/receiver
    npx wrangler d1 create regression-receiver          # put the printed database_id in wrangler.toml
    npx wrangler d1 execute regression-receiver --remote --file=schema.sql
    openssl rand -hex 16 | npx wrangler secret put REG_SECRET
    npx wrangler deploy

Cloudflare credentials come from the usual wrangler login or `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL`. Then add to the
repo-root `.env` (never committed): `REGRESSION_RECEIVER_URL=https://regression-receiver.<account>.workers.dev` and
`REGRESSION_RECEIVER_SECRET=<the secret above>`.

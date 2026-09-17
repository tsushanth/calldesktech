# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# NEXT_PUBLIC_* vars are inlined into the client JS bundle at build time —
# a Fly *secret* only exists at container runtime, so setting these as Fly
# secrets (which they were) never actually reached the browser bundle. Every
# purely client-side Supabase call (Overview stats, Call Logs, Knowledge
# Base, Settings' tenant load — anywhere using src/lib/api.ts directly
# instead of going through a /api/* route) silently failed with
# "NEXT_PUBLIC_SUPABASE_URL is not configured" in every production build
# since this app's first deploy. These are meant to be public (that's the
# whole point of the NEXT_PUBLIC_ prefix), so real values belong in
# fly.toml's [build.args], not as secrets.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_CALL_LOOP_WS_URL
ARG NEXT_PUBLIC_VOICE_ENGINE
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_CALL_LOOP_WS_URL=$NEXT_PUBLIC_CALL_LOOP_WS_URL
ENV NEXT_PUBLIC_VOICE_ENGINE=$NEXT_PUBLIC_VOICE_ENGINE

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Headless Chromium for src/lib/scraper.ts's JS-rendering fallback (a
# static fetch() can't see content a page only renders client-side after
# load — found and verified against a real site during development).
# playwright-core ships no browser of its own, and its own downloaded
# Chromium builds are glibc binaries that don't run on Alpine's musl libc —
# using Alpine's own apk-packaged chromium instead avoids that mismatch
# entirely, at the cost of a real image-size increase (~300MB) this stage
# now carries. --no-sandbox is passed at launch (see scraper.ts) since this
# container has no unprivileged-user-namespace support Chromium's sandbox
# needs; running as the non-root `nextjs` user below is the real sandbox
# boundary here instead.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# playwright-core's browsers.json (a runtime-read config file, not a JS
# import) isn't picked up by Next's standalone build tracing even with
# serverExternalPackages set — verified by actually running this built
# image locally, not just a type-check: launch failed with "Cannot find
# module '.../playwright-core/browsers.json'" until this explicit copy was
# added. Copying the whole package directly from the builder's real
# node_modules sidesteps the tracer entirely rather than chasing which
# other files it might also be silently dropping.
COPY --from=builder /app/node_modules/playwright-core ./node_modules/playwright-core

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]

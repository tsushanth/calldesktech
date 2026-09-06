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

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]

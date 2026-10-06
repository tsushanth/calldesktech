import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone', // Required for Docker deployment
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  // pdf-parse (via pdfjs-dist) loads its worker script by a real file path
  // at runtime — Next.js's own bundler rewrites/relocates that path when it
  // tries to bundle the package, breaking the worker lookup ("Setting up
  // fake worker failed: Cannot find module '.../pdf.worker.mjs'"). Keeping
  // it external means Node's normal require/import resolves it directly
  // from node_modules at runtime instead, where the packaged paths are
  // intact.
  // playwright-core added here for the same reason as pdf-parse/pdfjs-dist:
  // Next.js's standalone-build file tracing only copies files it can see
  // via static analysis, and misses runtime-read files like
  // playwright-core's browsers.json ("Cannot find module
  // '.../playwright-core/browsers.json'" — caught by actually running the
  // built Docker image locally before deploying, not just a type-check).
  // Public, versioned API surface: /api/v1/* is the same set of routes the
  // dashboard uses, now authenticated (session, mobile JWT, or API key).
  // A rewrite instead of a second copy of every handler; when a route's
  // contract needs to diverge for v2, that route gets its own file.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: '/api/:path*' }];
  },
  // The text simulator's code node loads QuickJS (and its WASM variant) with a dynamic import that static tracing can't
  // see, so without this the standalone image ships without it and every code node fails.
  outputFileTracingIncludes: {
    // The call scripts are read from disk at request time (src/app/caller/script), so they must ship in the standalone image.
    '/caller/script': ['./outreach/scripts/**/*'],
    '/api/chat/**': ['./node_modules/quickjs-emscripten/**/*', './node_modules/quickjs-emscripten-core/**/*', './node_modules/@jitl/**/*'],
    '/api/agents/**': ['./node_modules/quickjs-emscripten/**/*', './node_modules/quickjs-emscripten-core/**/*', './node_modules/@jitl/**/*'],
  },
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist', 'playwright-core'],
  // The landing page's footage and photos are static files that change at most
  // when scripts/hero-ingest.mjs is re-run. Next serves public/ files with
  // max-age=0 by default, so every visit re-checked each clip; cache for a day
  // (matching the daily rotation) and let browsers reuse a stale copy while they
  // refresh it.
  async headers() {
    const cache = [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }];
    return [
      { source: '/hero/:path*', headers: cache },
      { source: '/photos/:path*', headers: cache },
    ];
  },
};

export default nextConfig;

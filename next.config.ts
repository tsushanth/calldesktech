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
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist', 'playwright-core'],
};

export default nextConfig;

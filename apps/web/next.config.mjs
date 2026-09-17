/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship TS source directly (no build step of their own) — Next needs to
  // transpile them itself rather than treating them as pre-built node_modules.
  transpilePackages: [
    '@career-os/shared',
    '@career-os/database',
    '@career-os/ui',
    '@career-os/ai',
    '@career-os/email',
    '@career-os/discovery',
  ],
  // Resume Import (apps/web/lib/pdf-text-extraction.ts): pdfjs-dist dynamically resolves its own
  // worker script (pdf.worker.mjs) at runtime — a real production-build finding, live-verified —
  // webpack's server bundling restructures that path so it can't be found inside
  // .next/server/vendor-chunks, failing with "Setting up fake worker failed: Cannot find module
  // '...vendor-chunks/pdf.worker.mjs'" on every real request. Excluding it from bundling (the
  // standard, documented fix for worker-dependent packages under Next.js's App Router) makes Next
  // require it from node_modules at runtime instead, where the worker file resolves correctly.
  serverExternalPackages: ['pdfjs-dist'],
};

export default nextConfig;
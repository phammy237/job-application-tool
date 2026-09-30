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
  // Baseline hardening headers on every response. Deliberately not a full script-src CSP yet:
  // Next's inline bootstrap scripts, the pdf.js worker, and the Supabase/Google OAuth hops need
  // nonces/allowlists worked out and tested first — a wrong CSP breaks pages silently.
  // `frame-ancestors 'none'` + X-Frame-Options block clickjacking (nothing embeds this app, and
  // the PDF preview renders to <canvas>, not an iframe).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
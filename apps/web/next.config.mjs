/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship TS source directly (no build step of their own) — Next needs to
  // transpile them itself rather than treating them as pre-built node_modules.
  transpilePackages: ['@career-os/shared', '@career-os/database', '@career-os/ui'],
};

export default nextConfig;

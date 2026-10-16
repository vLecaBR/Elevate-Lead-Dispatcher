import path from 'node:path';
import type { NextConfig } from 'next';

// Where the browser's /api/* calls are forwarded. With `output: 'standalone'` rewrites are
// resolved at BUILD time, so the Docker image receives it as a build argument.
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
const isDev = process.env.NODE_ENV !== 'production';

// The page only ever talks to its own origin (the API sits behind the rewrite), so the
// policy can be strict. Next injects inline bootstrap scripts, hence 'unsafe-inline' for
// scripts; dev mode also needs eval for fast refresh.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  // Standalone output gives a minimal server bundle for the Docker image.
  output: 'standalone',
  // Monorepo: trace dependencies hoisted to the root node_modules.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  poweredByHeader: false,
  // Same-origin proxy: no CORS, and the session cookie belongs to the front-end origin.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternalUrl}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;

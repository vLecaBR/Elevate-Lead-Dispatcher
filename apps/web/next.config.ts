import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output gives a minimal server bundle for the Docker image.
  output: 'standalone',
  // Monorepo: trace dependencies hoisted to the root node_modules.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
};

export default nextConfig;

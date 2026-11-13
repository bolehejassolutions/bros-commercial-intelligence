import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    '/api/internal/neon-content-review': ['./content-review-sources/**/*'],
    '/api/internal/neon-content-approval': ['./content-review-sources/**/*'],
    '/api/internal/neon-content-creative-reuse': ['./content-review-sources/**/*']
  }
};

export default nextConfig;

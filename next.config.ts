import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Don't cache dynamic pages in the client-side router cache.
    // Without this, navigating away from a legislation page and back can serve
    // a stale RSC payload that pre-dates any comments the user just posted.
    staleTimes: {
      dynamic: 0,
    },
  },
};

export default nextConfig;

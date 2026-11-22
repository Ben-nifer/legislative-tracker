import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A package-lock.json in the home folder made Next infer ~ as the workspace
  // root, and dev hung watching it. Pin the root to this project (Next runs
  // from the project directory, locally and on Vercel).
  turbopack: {
    root: process.cwd(),
  },
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

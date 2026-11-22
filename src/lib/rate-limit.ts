import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

export const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

export const commentRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '1 h'),
  prefix: 'rl:comment',
})

export const voteRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, '1 h'),
  prefix: 'rl:vote',
})

export const stanceRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, '1 h'),
  prefix: 'rl:stance',
})

export const followRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '1 h'),
  prefix: 'rl:follow',
})

// Address lookups (profile finder, onboarding S1). Keyed by user ID, or IP for
// guests; 20/hour leaves room for a few typos during onboarding.
export const geocodeRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, '1 h'),
  prefix: 'rl:geocode',
})

export const feedbackRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '1 h'),
  prefix: 'rl:feedback',
})

// Free-text interests (/api/interests/resolve). Guests can call it, so keyed by IP.
export const interestRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, '1 h'),
  prefix: 'rl:interest',
})

// Onboarding analytics batches (/api/events), keyed by IP
export const eventsRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(600, '1 h'),
  prefix: 'rl:events',
})

// Feed loads (/api/feed): the onboarding preview refreshes on every toggle. Keyed by IP.
export const feedRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(600, '1 h'),
  prefix: 'rl:feed',
})

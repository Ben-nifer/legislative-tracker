import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

export const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

// Local runs without Upstash keys (next dev or next start): limits pass, so
// routes can be exercised locally. On Vercel, Redis is always used.
const LIMITS_DISABLED = !process.env.KV_REST_API_URL && !process.env.VERCEL
if (LIMITS_DISABLED) console.warn('rate-limit: KV_REST_API_URL is not set; rate limits are off for this local run')

type Limiter = Pick<Ratelimit, 'limit'>
const passThrough: Limiter = {
  limit: async () => ({ success: true, limit: Infinity, remaining: Infinity, reset: 0, pending: Promise.resolve() }) as Awaited<ReturnType<Ratelimit['limit']>>,
}

function limiter(config: ConstructorParameters<typeof Ratelimit>[0]): Limiter {
  return LIMITS_DISABLED ? passThrough : new Ratelimit(config)
}

export const commentRateLimit = limiter({
  redis,
  limiter: Ratelimit.slidingWindow(5, '1 h'),
  prefix: 'rl:comment',
})

export const voteRateLimit = limiter({
  redis,
  limiter: Ratelimit.slidingWindow(60, '1 h'),
  prefix: 'rl:vote',
})

export const stanceRateLimit = limiter({
  redis,
  limiter: Ratelimit.slidingWindow(20, '1 h'),
  prefix: 'rl:stance',
})

export const followRateLimit = limiter({
  redis,
  limiter: Ratelimit.slidingWindow(30, '1 h'),
  prefix: 'rl:follow',
})

// Address lookups (profile finder, onboarding S1). Keyed by user ID, or IP for
// guests; 20/hour leaves room for a few typos during onboarding.
export const geocodeRateLimit = limiter({
  redis,
  limiter: Ratelimit.slidingWindow(20, '1 h'),
  prefix: 'rl:geocode',
})

export const feedbackRateLimit = limiter({
  redis,
  limiter: Ratelimit.slidingWindow(5, '1 h'),
  prefix: 'rl:feedback',
})

// Free-text interests (/api/interests/resolve). Guests can call it, so keyed by IP.
export const interestRateLimit = limiter({
  redis,
  limiter: Ratelimit.slidingWindow(60, '1 h'),
  prefix: 'rl:interest',
})

// Onboarding analytics batches (/api/events), keyed by IP
export const eventsRateLimit = limiter({
  redis,
  limiter: Ratelimit.slidingWindow(600, '1 h'),
  prefix: 'rl:events',
})

// Feed loads (/api/feed): the onboarding preview refreshes on every toggle. Keyed by IP.
export const feedRateLimit = limiter({
  redis,
  limiter: Ratelimit.slidingWindow(600, '1 h'),
  prefix: 'rl:feed',
})

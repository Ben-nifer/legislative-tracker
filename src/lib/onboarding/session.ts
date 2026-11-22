import { z } from 'zod'

// Session cookies for signed-out visitors (onboarding-build-planv1.1.md §3.1, §4.3).
// All are session cookies (no expiry), so they go when the browser closes (B8).

// Random per-browser-session ID: the only identifier for guests in
// analytics_events and feed_impressions. Set by middleware on any page.
export const SESSION_ID_COOKIE = 'sid'

// Set on the first visit to /welcome. Without it, a signed-out visit to `/`
// is sent to /welcome (when the new-onboarding flag is on).
export const ONBOARDING_SEEN_COOKIE = 'onb_session'

// A gated action (stance, save) waiting for sign-in, completed by the auth callback
export const PENDING_ACTION_COOKIE = 'onb_pending'
export const PENDING_ACTION_MAX_AGE_SECONDS = 15 * 60

// Same-origin paths only: "//host" and "/\host" would leave the site
export function safeRedirectPath(next: string | null | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/'
}

export const sessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/)

export function newSessionId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export function readSessionId(value: string | undefined | null): string | null {
  const parsed = sessionIdSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

// Comments aren't carried over: their text doesn't belong in a cookie. The
// sign-in sheet returns the user to the bill with the composer instead.
export const pendingActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('stance'),
    legislationId: z.uuid(),
    stance: z.enum(['support', 'oppose', 'neutral']),
  }),
  z.object({ action: z.literal('follow_legislation'), legislationId: z.uuid() }),
])

export type PendingAction = z.infer<typeof pendingActionSchema>

export function parsePendingAction(raw: string | undefined | null): PendingAction | null {
  if (!raw) return null
  try {
    const parsed = pendingActionSchema.safeParse(JSON.parse(decodeURIComponent(raw)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function serializePendingAction(action: PendingAction): string {
  return encodeURIComponent(JSON.stringify(pendingActionSchema.parse(action)))
}

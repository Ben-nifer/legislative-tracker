import { z } from 'zod'
import { MAX_PHRASE_LENGTH } from '../embeddings/normalize'

// Guest state (onboarding-build-planv1.1.md §3.3, spec §2): a session cookie
// holding IDs only, shaped like the user context the feed reads. It never holds
// the address or coordinates (spec §S1). Written by the client on each change,
// validated here whenever the server reads it.

export const GUEST_CONTEXT_COOKIE = 'onb_ctx'
export const MAX_GUEST_CONTEXT_BYTES = 3000

// Resolved districts (→ user_places) and followed levels/places (→ user_jurisdiction_follows).
// Mirrors the CHECK constraints on those tables.
const userPlaceType = z.enum(['city', 'council_district', 'neighborhood', 'state_senate', 'assembly', 'congressional', 'state'])
const jurisdictionPlaceType = z.enum([...userPlaceType.options, 'federal'])
const placeId = z.string().regex(/^[A-Za-z0-9_-]{1,16}$/)

export const guestContextSchema = z.object({
  v: z.literal(1),
  places: z.array(z.object({ type: userPlaceType, id: placeId })).max(8).default([]),
  jurisdictions: z.array(z.object({ type: jurisdictionPlaceType, id: placeId })).max(12).default([]),
  legislatorIds: z.array(z.uuid()).max(12).default([]),
  topicIds: z.array(z.uuid()).max(15).default([]),
  interests: z
    .array(
      z.object({
        phrase: z.string().min(1).max(MAX_PHRASE_LENGTH), // normalized: interest_phrases key
        display: z.string().min(1).max(MAX_PHRASE_LENGTH), // as typed, for the widget header
      })
    )
    .max(10)
    .default([]),
})

export type GuestContext = z.infer<typeof guestContextSchema>

// The same shape without the cookie's size caps: a signed-in account's saved
// follows, edited in /welcome (never written to the cookie)
export const selectionsSchema = z.object({
  v: z.literal(1),
  places: z.array(z.object({ type: userPlaceType, id: placeId })).max(8),
  jurisdictions: z.array(z.object({ type: jurisdictionPlaceType, id: placeId })).max(100),
  legislatorIds: z.array(z.uuid()).max(500),
  topicIds: z.array(z.uuid()).max(200),
  interests: z
    .array(z.object({ phrase: z.string().min(1).max(MAX_PHRASE_LENGTH), display: z.string().min(1).max(MAX_PHRASE_LENGTH) }))
    .max(100),
})
export type GuestPlace = GuestContext['places'][number]

export function emptyGuestContext(): GuestContext {
  return { v: 1, places: [], jurisdictions: [], legislatorIds: [], topicIds: [], interests: [] }
}

export function isEmptyGuestContext(ctx: GuestContext): boolean {
  return (
    !ctx.places.length &&
    !ctx.jurisdictions.length &&
    !ctx.legislatorIds.length &&
    !ctx.topicIds.length &&
    !ctx.interests.length
  )
}

// JSON's structural characters are valid in a cookie value; leaving them
// unescaped keeps a full context under the cap
const unescapeStructural = (encoded: string) =>
  encoded.replace(/%(3A|7B|7D|5B|5D)/g, (m) => decodeURIComponent(m))

export function serializeGuestContext(ctx: GuestContext): string {
  const value = unescapeStructural(encodeURIComponent(JSON.stringify(guestContextSchema.parse(ctx))))
  if (value.length > MAX_GUEST_CONTEXT_BYTES) throw new Error('Guest context is too large')
  return value
}

// Anything missing, malformed or from another version reads as "no context"
export function parseGuestContext(raw: string | undefined | null): GuestContext | null {
  if (!raw || raw.length > MAX_GUEST_CONTEXT_BYTES) return null
  try {
    const parsed = guestContextSchema.safeParse(JSON.parse(decodeURIComponent(raw)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
